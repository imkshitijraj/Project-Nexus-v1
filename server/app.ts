import express, {type Request,type Response,type NextFunction} from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { SignJWT,jwtVerify } from 'jose';
import { createHash,randomBytes,randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import nodemailer from 'nodemailer';
import { type Database } from './db.js';
import { type User,fail,readWorkspace,visibleWorkspace,writeWorkspace,audit } from './domain.js';
import { seedState } from '../model.js';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const password=z.string().min(12).max(72).refine(s=>Buffer.byteLength(s,'utf8')<=72,'Password must be 72 UTF-8 bytes or fewer.');
const credentials=z.object({email:z.email().max(254).transform(s=>s.toLowerCase()),password});
const roles=z.enum(['admin','manager','member','viewer']);
export type Options={production?:boolean;secret?:string;origins?:string[];demo?:boolean;mailer?:(email:string,url:string)=>Promise<void>};
export async function createApp(db:Database,options:Options={}){
  const production=options.production??false;
  const secret=options.secret??process.env.JWT_SECRET??(production?'':randomBytes(48).toString('hex'));
  if(secret.length<48)throw new Error('JWT_SECRET must contain at least 48 characters.');
  const key=new TextEncoder().encode(secret);
  const origins=options.origins??(process.env.ALLOWED_ORIGINS??'http://127.0.0.1:4174,http://localhost:4174').split(',');
  if(production&&(!process.env.DATABASE_URL||!process.env.PUBLIC_URL?.startsWith('https://')))throw new Error('Production requires DATABASE_URL and an HTTPS PUBLIC_URL.');
  const app=express();app.disable('x-powered-by');if(process.env.TRUST_PROXY==='1')app.set('trust proxy',1);
  app.use(helmet({contentSecurityPolicy:{directives:{defaultSrc:["'none'"],scriptSrc:["'self'"],styleSrc:["'self'"],imgSrc:["'self'",'data:'],fontSrc:["'self'"],connectSrc:["'self'"],objectSrc:["'none'"],baseUri:["'none'"],formAction:["'none'"],frameAncestors:["'none'"],upgradeInsecureRequests:production?[]:null}},crossOriginEmbedderPolicy:false,hsts:production?undefined:false}));
  app.use((req,res,next)=>{const id=randomUUID(),start=Date.now();res.setHeader('X-Request-Id',id);res.on('finish',()=>{if(process.env.NODE_ENV!=='test')console.log(JSON.stringify({requestId:id,method:req.method,path:req.path,status:res.statusCode,ms:Date.now()-start}));});next();});
  app.use('/api',(req,res,next)=>{
    res.setHeader('Cache-Control','no-store');
    const origin=req.headers.origin;if(origin){if(!origins.includes(origin))return next(Object.assign(new Error('Origin not allowed.'),{status:403}));res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Credentials','true');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');res.setHeader('Access-Control-Allow-Methods','GET, POST, PUT, PATCH, DELETE, OPTIONS');}
    if(req.method==='OPTIONS'){res.sendStatus(204);return;}
    if(!['GET','HEAD'].includes(req.method)&&!req.is('application/json'))return next(Object.assign(new Error('JSON content type required.'),{status:415}));next();
  });
  app.use('/api',rateLimit({windowMs:60_000,limit:300,standardHeaders:'draft-8',legacyHeaders:false}));
  app.use(express.json({limit:'16mb'}));
  const authLimit=rateLimit({windowMs:15*60_000,limit:40,standardHeaders:'draft-8',legacyHeaders:false,skip:()=>process.env.NODE_ENV==='test'});
  app.use('/api/auth',authLimit);
  const cookieName=production?'__Secure-nexus-refresh':'nexus-refresh';
  function cookie(res:Response,value:string,maxAge=7*86400_000){res.cookie(cookieName,value,{httpOnly:true,secure:production,sameSite:production&&process.env.CROSS_SITE_COOKIES==='1'?'none':'strict',path:'/api/auth',maxAge});}
  async function issueTokens(tx:Database,user:User,family=randomUUID(),expiresAt=new Date(Date.now()+7*86400_000)){
    const access=await new SignJWT({org:user.org_id,sid:family}).setProtectedHeader({alg:'HS256'}).setSubject(user.id).setIssuer('nexus-api').setAudience('nexus-web').setIssuedAt().setExpirationTime(Math.floor(Math.min(Date.now()+10*60_000,expiresAt.getTime())/1000)).sign(key);
    const refresh=randomBytes(48).toString('base64url');await tx.query('INSERT INTO refresh_sessions(token_hash,user_id,expires_at,family) VALUES($1,$2,$3,$4)',[hash(refresh),user.id,expiresAt.toISOString(),family]);
    return {refresh,maxAge:Math.max(0,expiresAt.getTime()-Date.now()),payload:{accessToken:access,user:{id:user.id,name:user.name,email:user.email,role:user.role,orgId:user.org_id}}};
  }
  // All session issuance/revocation locks the account first. Rotation and its
  // replacement must commit together so replay/logout cannot miss a new token.
  async function tokens(res:Response,user:User){
    const issued=await db.transaction(async tx=>{
      const current=(await tx.query('SELECT * FROM users WHERE id=$1 AND active=true FOR UPDATE',[user.id])).rows[0];
      if(!current)fail(401,'Account is inactive.');
      return issueTokens(tx,current as User);
    });
    cookie(res,issued.refresh,issued.maxAge);return issued.payload;
  }
  async function userFrom(req:Request){try{const token=req.headers.authorization?.replace(/^Bearer /,'');if(!token)fail(401,'Sign in to continue.');const {payload}=await jwtVerify(token!,key,{issuer:'nexus-api',audience:'nexus-web',algorithms:['HS256']});const u=(await db.query('SELECT * FROM users WHERE id=$1 AND org_id=$2 AND active=true',[payload.sub,payload.org])).rows[0];const active=(await db.query('SELECT 1 FROM refresh_sessions WHERE user_id=$1 AND family=$2 AND revoked=false AND expires_at>now()',[payload.sub,payload.sid])).rows.length;if(!u||!active)fail(401,'Session is no longer active.');return u as User;}catch{fail(401,'Session expired. Sign in again.');}}
  const requireUser=async(req:Request,res:Response,next:NextFunction)=>{try{res.locals.user=await userFrom(req);next();}catch(e){next(e);}};
  async function lockAdministrator(tx:Database,actor:User){
    await tx.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[actor.org_id]);
    const current=(await tx.query('SELECT * FROM users WHERE id=$1 AND org_id=$2 AND active=true',[actor.id,actor.org_id])).rows[0];
    if(!current||current.role!=='admin')fail(403,'Administrator access required.');
    return current as User;
  }
  app.get('/api/health',async(_req,res)=>{await db.query('SELECT 1');res.json({status:'ok',version:1});});
  app.post('/api/auth/register',async(req,res)=>{
    const body=credentials.extend({name:z.string().trim().min(1).max(60),organization:z.string().trim().min(1).max(100)}).parse(req.body);
    const passwordHash=await bcrypt.hash(body.password,12),id=randomUUID(),org=randomUUID();
    try{await db.transaction(async tx=>{await tx.query('INSERT INTO organizations(id,name) VALUES($1,$2)',[org,body.organization]);await tx.query('INSERT INTO users(id,org_id,email,name,password_hash,role) VALUES($1,$2,$3,$4,$5,$6)',[id,org,body.email,body.name,passwordHash,'admin']);});}catch(e){if((e as any).code==='23505')fail(409,'An account with this email already exists.');throw e;}
    const user=(await db.query('SELECT * FROM users WHERE id=$1',[id])).rows[0] as User;res.status(201).json(await tokens(res,user));
  });
  app.post('/api/auth/login',async(req,res)=>{
    const body=credentials.parse(req.body),user=(await db.query('SELECT * FROM users WHERE email=$1',[body.email])).rows[0];
    const dummy='$2b$12$0ZJ1XFHhMHZTXyHLX6Ff6OIBNX6G.HDVUihZnK0TVI4suKRt2EkBS';
    const valid=await bcrypt.compare(body.password,user?.password_hash??dummy);if(!user||!valid||!user.active)fail(401,'Email or password is incorrect.');
    const issued=await db.transaction(async tx=>{
      const current=(await tx.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[user.id])).rows[0];
      if(!current?.active||current.password_hash!==user.password_hash)fail(401,'Email or password is incorrect.');
      return issueTokens(tx,current as User);
    });
    cookie(res,issued.refresh,issued.maxAge);res.json(issued.payload);
  });
  app.post('/api/auth/refresh',async(req,res)=>{
    const value=(req.headers.cookie??'').split(';').map(s=>s.trim()).find(s=>s.startsWith(`${cookieName}=`))?.slice(cookieName.length+1);
    if(!value)fail(401,'No refresh session.');
    const issued=await db.transaction(async tx=>{
      const hint=(await tx.query('SELECT user_id FROM refresh_sessions WHERE token_hash=$1',[hash(value!)])).rows[0];if(!hint)return null;
      const user=(await tx.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[hint.user_id])).rows[0];
      const row=(await tx.query('SELECT * FROM refresh_sessions WHERE token_hash=$1 FOR UPDATE',[hash(value!)])).rows[0];if(!row)return null;
      if(row.revoked){await tx.query('UPDATE refresh_sessions SET revoked=true WHERE family=$1',[row.family]);return null;}
      if(!user?.active||new Date(row.expires_at).getTime()<=Date.now())return null;
      await tx.query('UPDATE refresh_sessions SET revoked=true WHERE token_hash=$1',[hash(value!)]);
      return issueTokens(tx,user as User,row.family,new Date(row.expires_at));
    });
    if(!issued){cookie(res,'',0);fail(401,'Refresh session expired or already used.');}
    cookie(res,issued!.refresh,issued!.maxAge);res.json(issued!.payload);
  });
  app.post('/api/auth/logout',async(req,res)=>{const raw=(req.headers.cookie??'').split(';').map(x=>x.trim()).find(x=>x.startsWith(`${cookieName}=`))?.slice(cookieName.length+1);
    if(raw)await db.transaction(async tx=>{
      const session=(await tx.query('SELECT user_id,family FROM refresh_sessions WHERE token_hash=$1',[hash(raw)])).rows[0];
      if(session){await tx.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[session.user_id]);await tx.query('UPDATE refresh_sessions SET revoked=true WHERE user_id=$1 AND family=$2',[session.user_id,session.family]);}
    });
    cookie(res,'',0);res.json({ok:true});
  });
  async function sendMail(email:string,url:string){
    if(options.mailer){await options.mailer(email,url);return;}
    if(process.env.SMTP_URL){const transport=nodemailer.createTransport(process.env.SMTP_URL,{disableFileAccess:true,disableUrlAccess:true});await transport.sendMail({from:process.env.MAIL_FROM,to:email,subject:'Your Project Nexus account link',text:`Open this link to continue: ${url}`});}
    else if(!production)console.log(JSON.stringify({event:'development-account-link',email,url}));
    else fail(503,'Email delivery has not been configured.');
  }
  app.post('/api/auth/forgot',async(req,res)=>{
    const {email}=z.object({email:z.email().max(254).transform(s=>s.toLowerCase())}).parse(req.body),u=(await db.query('SELECT * FROM users WHERE email=$1 AND active=true',[email])).rows[0];
    if(u){const token=randomBytes(32).toString('base64url');await db.query('INSERT INTO account_tokens(token_hash,user_id,email,kind,expires_at) VALUES($1,$2,$3,$4,$5)',[hash(token),u.id,email,'reset',new Date(Date.now()+30*60_000).toISOString()]);try{await sendMail(email,`${process.env.PUBLIC_URL??origins[0]}/#reset/${token}`);}catch{console.error(JSON.stringify({event:'password-reset-delivery-failed'}));}}
    res.json({message:'If an active account exists, a reset link has been sent.'});
  });
  app.post('/api/auth/reset',async(req,res)=>{
    const body=z.object({token:z.string().min(32).max(100),password}).parse(req.body),pw=await bcrypt.hash(body.password,12);
    await db.transaction(async tx=>{
      const hint=(await tx.query("SELECT user_id FROM account_tokens WHERE token_hash=$1 AND kind='reset'",[hash(body.token)])).rows[0];
      if(!hint)fail(400,'Reset link is expired or invalid.');
      const user=(await tx.query('SELECT id,active FROM users WHERE id=$1 FOR UPDATE',[hint!.user_id])).rows[0];
      const token=(await tx.query("SELECT * FROM account_tokens WHERE token_hash=$1 AND kind='reset' AND used=false AND expires_at>now() FOR UPDATE",[hash(body.token)])).rows[0];
      if(!user?.active||!token)fail(400,'Reset link is expired or invalid.');
      await tx.query('UPDATE users SET password_hash=$1 WHERE id=$2',[pw,token!.user_id]);
      await tx.query("UPDATE account_tokens SET used=true WHERE user_id=$1 AND kind='reset'",[token!.user_id]);
      await tx.query('UPDATE refresh_sessions SET revoked=true WHERE user_id=$1',[token!.user_id]);
    });res.json({ok:true});
  });
  app.post('/api/auth/accept-invite',async(req,res)=>{
    const body=z.object({token:z.string().min(32).max(100),name:z.string().trim().min(1).max(60),password}).parse(req.body),pw=await bcrypt.hash(body.password,12),id=randomUUID();
    await db.transaction(async tx=>{
      const hint=(await tx.query("SELECT org_id FROM account_tokens WHERE token_hash=$1 AND kind='invite'",[hash(body.token)])).rows[0];
      if(!hint)fail(400,'Invitation is expired or invalid.');
      await tx.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[hint!.org_id]);
      const token=(await tx.query("SELECT * FROM account_tokens WHERE token_hash=$1 AND kind='invite' AND used=false AND expires_at>now() FOR UPDATE",[hash(body.token)])).rows[0];if(!token)fail(400,'Invitation is expired or invalid.');
      const count=Number((await tx.query('SELECT count(*) FROM users WHERE org_id=$1',[token!.org_id])).rows[0].count);
      if(count>=200)fail(409,'The organization has reached its 200-account limit.');
      await tx.query('INSERT INTO users(id,org_id,email,name,password_hash,role) VALUES($1,$2,$3,$4,$5,$6)',[id,token!.org_id,token!.email,body.name,pw,token!.role]);
      await tx.query("UPDATE account_tokens SET used=true WHERE org_id=$1 AND email=$2 AND kind='invite'",[token!.org_id,token!.email]);
      await tx.query('UPDATE organizations SET revision=revision+1 WHERE id=$1',[token!.org_id]);
    });
    res.status(201).json(await tokens(res,(await db.query('SELECT * FROM users WHERE id=$1',[id])).rows[0] as User));
  });
  app.use('/api',requireUser);
  app.get('/api/organization',async(_req,res)=>{const org=(await db.query('SELECT name,settings FROM organizations WHERE id=$1',[res.locals.user.org_id])).rows[0];res.json({name:org.name,departments:org.settings.departments??[]});});
  app.patch('/api/organization',async(req,res)=>{const actor=res.locals.user as User;if(actor.role!=='admin')fail(403,'Administrator access required.');const data=z.object({name:z.string().trim().min(1).max(100),departments:z.array(z.string().trim().min(1).max(80)).max(100)}).parse(req.body);await db.transaction(async tx=>{const current=await lockAdministrator(tx,actor);await tx.query('UPDATE organizations SET name=$1,settings=jsonb_set(settings,\'{departments}\',$2::jsonb),revision=revision+1 WHERE id=$3',[data.name,JSON.stringify(data.departments),actor.org_id]);await audit(tx,actor.org_id,'Updated organization settings',current.name,current.id);});res.json({ok:true});});
  app.get('/api/workspace',async(_req,res)=>{
    const actor=res.locals.user as User;
    const result=await db.transaction(async tx=>{
      await tx.query('SELECT id FROM organizations WHERE id=$1 FOR SHARE',[actor.org_id]);
      const current=(await tx.query('SELECT * FROM users WHERE id=$1 AND org_id=$2 AND active=true',[actor.id,actor.org_id])).rows[0];
      if(!current)fail(401,'Account is inactive.');
      const snapshot=await readWorkspace(tx,current as User);
      return {...snapshot,state:visibleWorkspace(snapshot.state,current as User)};
    });
    res.json(result);
  });
  app.put('/api/workspace',async(req,res)=>{const body=z.object({revision:z.number().int().nonnegative(),state:z.record(z.string(),z.unknown())}).parse(req.body);res.json(await writeWorkspace(db,res.locals.user,body.state,body.revision));});
  app.get('/api/tasks',async(req,res)=>{
    const user=res.locals.user as User,page=z.coerce.number().int().min(1).max(10000).parse(req.query.page??1),limit=z.coerce.number().int().min(1).max(100).parse(req.query.limit??50);
    const params:any[]=[user.org_id];let where="r.org_id=$1 AND r.kind='tasks'";
    if(req.query.project){params.push(z.string().max(80).parse(req.query.project));where+=` AND r.project_id=$${params.length}`;}
    if(!['admin','manager'].includes(user.role)){params.push(user.id);where+=` AND EXISTS(SELECT 1 FROM project_links l WHERE l.org_id=r.org_id AND l.project_id=r.project_id AND l.user_id=$${params.length})`;}
    const count=Number((await db.query(`SELECT count(*) FROM records r WHERE ${where}`,params)).rows[0].count);
    params.push(limit,(page-1)*limit);const rows=(await db.query(`SELECT payload FROM records r WHERE ${where} ORDER BY payload->>'due',id LIMIT $${params.length-1} OFFSET $${params.length}`,params)).rows;
    res.json({items:rows.map(r=>r.payload),total:count,page,limit});
  });
  app.post('/api/invitations',async(req,res)=>{
    const user=res.locals.user as User;if(user.role!=='admin')fail(403,'Only administrators may invite users.');
    const body=z.object({email:z.email().max(254).transform(s=>s.toLowerCase()),role:roles}).parse(req.body);
    if((await db.query('SELECT 1 FROM users WHERE email=$1',[body.email])).rows.length)fail(409,'This email already has an account.');
    const token=randomBytes(32).toString('base64url');
    await db.transaction(async tx=>{
      const current=await lockAdministrator(tx,user);
      await tx.query("UPDATE account_tokens SET used=true WHERE org_id=$1 AND email=$2 AND kind='invite'",[user.org_id,body.email]);
      await tx.query('INSERT INTO account_tokens(token_hash,org_id,email,role,kind,expires_at) VALUES($1,$2,$3,$4,$5,$6)',[hash(token),user.org_id,body.email,body.role,'invite',new Date(Date.now()+72*3600_000).toISOString()]);
      await audit(tx,user.org_id,`Invited ${body.email} as ${body.role}`,current.name,current.id);
      await tx.query('UPDATE organizations SET revision=revision+1 WHERE id=$1',[user.org_id]);
    });
    const url=`${process.env.PUBLIC_URL??origins[0]}/#invite/${token}`;await sendMail(body.email,url);res.status(201).json({message:'Invitation created.',...(!production?{developmentLink:url}:{})});
  });
  app.patch('/api/users/:id',async(req,res)=>{
    const actor=res.locals.user as User;if(actor.role!=='admin')fail(403,'Administrator access required.');
    const body=z.object({role:roles,active:z.boolean(),department:z.string().max(80),capacity:z.number().min(0).max(168)}).parse(req.body);
    await db.transaction(async tx=>{const current=await lockAdministrator(tx,actor);const target=(await tx.query('SELECT * FROM users WHERE id=$1 AND org_id=$2',[req.params.id,actor.org_id])).rows[0];if(!target)fail(404,'User not found.');
      if(target.role==='admin'&&(!body.active||body.role!=='admin')){const admins=(await tx.query("SELECT id FROM users WHERE org_id=$1 AND role='admin' AND active=true",[actor.org_id])).rows;if(admins.length<=1)fail(400,'Keep at least one active administrator.');}
      await tx.query('UPDATE users SET role=$1,active=$2,department=$3,capacity=$4 WHERE id=$5 AND org_id=$6',[body.role,body.active,body.department,body.capacity,req.params.id,actor.org_id]);await tx.query('UPDATE refresh_sessions SET revoked=true WHERE user_id=$1',[req.params.id]);await audit(tx,actor.org_id,`Updated account ${target.name}: ${body.role}, ${body.active?'active':'inactive'}`,current.name,current.id);await tx.query('UPDATE organizations SET revision=revision+1 WHERE id=$1',[actor.org_id]);});res.json({ok:true});
  });
  const root=fileURLToPath(new URL('../',import.meta.url));
  app.get('/runtime-config.js',(_req,res)=>{res.type('js').send(`export const API_BASE = location.origin; export const DEMO_ENABLED = ${Boolean(options.demo&&!production)};`);});
  // Only public frontend assets are exposed. Server source, data, tests and environment files are never static.
  for(const file of ['index.html','app.js','model.js','management.js','connection.js','appearance.js','auth-ui.js','account-ui.js','styles.css','account.css'])app.get(`/${file}`,(_req,res)=>res.sendFile(path.join(root,file)));
  app.use('/assets',express.static(path.join(root,'assets'),{dotfiles:'deny',index:false}));
  app.get('/',(_req,res)=>res.sendFile(path.join(root,'index.html')));
  app.use((_req,res)=>res.status(404).json({error:'Not found.'}));
  app.use((error:any,_req:Request,res:Response,_next:NextFunction)=>{const status=error instanceof z.ZodError?400:error.status??(error.code==='23505'?409:500);if(status>=500)console.error(JSON.stringify({event:'server-error',requestId:res.getHeader('X-Request-Id'),code:typeof error.code==='string'?error.code:'INTERNAL_ERROR'}));res.status(status).json({error:status>=500?'The server could not complete this request.':error instanceof z.ZodError?error.issues[0]?.message:error.code==='23505'?'This record conflicts with an existing record.':error.message});});
  if(options.demo&&!production)await seedDemo(db);
  return app;
}
export async function seedDemo(db:Database){
  const org='demo-organization',passwordHash=await bcrypt.hash('NexusDemo!26',12);
  const profiles=[
    {id:'demo-admin',name:'Demo Administrator',email:'admin@nexus.test',role:'admin',department:'Product',capacity:40},
    {id:'m1',name:'Alex Morgan',email:'manager@nexus.test',role:'manager',department:'Product',capacity:40},
    {id:'m2',name:'Sam Patel',email:'member@nexus.test',role:'member',department:'Product',capacity:40},
    {id:'m3',name:'Riley Chen',email:'viewer@nexus.test',role:'viewer',department:'Product',capacity:40},
    {id:'demo-student',name:'Avery Student',email:'student@nexus.test',role:'member',department:'Student Projects',capacity:20}
  ];
  const fresh=await db.transaction(async tx=>{
    const existing=(await tx.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE',[org])).rows[0];
    const anchor=(await tx.query("SELECT id,org_id,email FROM users WHERE id='demo-admin' OR email='admin@nexus.test'")).rows;
    if(!existing){
      // A name/email collision belongs to its existing owner, never to this fixture.
      const collisions=await tx.query('SELECT 1 FROM users WHERE id=ANY($1::text[]) OR email=ANY($2::text[])',[profiles.map(p=>p.id),profiles.map(p=>p.email)]);
      if(collisions.rows.length)return false;
      await tx.query('INSERT INTO organizations(id,name) VALUES($1,$2)',[org,'Nexus demonstration']);
      for(const p of profiles)await tx.query('INSERT INTO users(id,org_id,name,email,password_hash,role,department,capacity) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[p.id,org,p.name,p.email,passwordHash,p.role,p.department,p.capacity]);
      return true;
    }
    if(anchor.length!==1||anchor[0].id!=='demo-admin'||anchor[0].org_id!==org||anchor[0].email!=='admin@nexus.test')return false;
    // Only migrate the old, public fixture password. User-changed passwords,
    // names, roles, activation state and all unrelated organizations are preserved.
    for(const p of profiles){
      const user=(await tx.query('SELECT password_hash FROM users WHERE id=$1 AND org_id=$2 AND email=$3 FOR UPDATE',[p.id,org,p.email])).rows[0];
      if(user&&await bcrypt.compare('NexusDemo!2026',user.password_hash)){
        await tx.query('UPDATE users SET password_hash=$1 WHERE id=$2 AND org_id=$3',[passwordHash,p.id,org]);
        await tx.query('UPDATE refresh_sessions SET revoked=true WHERE user_id=$1',[p.id]);
      }
    }
    const student=profiles[4];
    const collision=(await tx.query('SELECT 1 FROM users WHERE id=$1 OR email=$2',[student.id,student.email])).rows.length;
    const count=Number((await tx.query('SELECT count(*) FROM users WHERE org_id=$1',[org])).rows[0].count);
    if(collision||count>=200)return false;
    await tx.query('INSERT INTO users(id,org_id,name,email,password_hash,role,department,capacity) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[student.id,org,student.name,student.email,passwordHash,student.role,student.department,student.capacity]);
    const projects=(await tx.query("SELECT id,payload FROM records WHERE org_id=$1 AND kind='projects' AND id IN ('p2','p4') AND payload->>'category'='study' ORDER BY id",[org])).rows;
    for(const row of projects){
      const members=Array.from(new Set([...row.payload.members,student.id]));
      await tx.query("UPDATE records SET payload=jsonb_set(payload,'{members}',$1::jsonb) WHERE org_id=$2 AND kind='projects' AND id=$3",[JSON.stringify(members),org,row.id]);
      await tx.query('INSERT INTO project_links(org_id,project_id,user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[org,row.id,student.id]);
    }
    // Existing work keeps its assignments. The new account gets a separate
    // starter task only on its first insertion, within the usual task bound.
    const taskCount=Number((await tx.query("SELECT count(*) FROM records WHERE org_id=$1 AND kind='tasks'",[org])).rows[0].count);
    if(projects.length&&taskCount<2000){
      const template=seedState().tasks.find((task:any)=>task.projectId==='p2')!;
      const task={...template,id:'demo-student-welcome',title:'Plan your next study session',projectId:projects[0].id,assignee:student.id,status:'Backlog',notes:'Choose the next step for your research or learning project.',completedAt:'',history:[]};
      await tx.query("INSERT INTO records(org_id,kind,id,project_id,payload) VALUES($1,'tasks',$2,$3,$4) ON CONFLICT DO NOTHING",[org,task.id,task.projectId,JSON.stringify(task)]);
    }
    await tx.query('UPDATE organizations SET revision=revision+1 WHERE id=$1',[org]);
    return false;
  });
  if(!fresh)return;
  const user=(await db.query("SELECT * FROM users WHERE id='demo-admin' AND org_id=$1",[org])).rows[0] as User,{state}=await readWorkspace(db,user),seed=seedState();
  for(const project of seed.projects)if(project.category==='study')project.members.push('demo-student');
  seed.tasks.find((task:any)=>task.id==='t2')!.assignee='demo-student';
  await writeWorkspace(db,user,{...seed,profile:{name:user.name},members:state.members,activity:[]},0);
}
