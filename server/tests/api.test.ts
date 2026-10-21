import { test,before,after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import type { Express } from 'express';
import { openDatabase,migrate,type Database } from '../db.js';
import { createApp,seedDemo } from '../app.js';
import { writeWorkspace,type User } from '../domain.js';
process.env.NODE_ENV='test';process.env.DATA_DIR='memory://';
let db:Database,app:Express;const accounts:Record<string,any>={},mail:Record<string,string>={};
const login=async(email:string)=>{const r=await request(app).post('/api/auth/login').send({email,password:'NexusDemo!26'});assert.equal(r.status,200,r.text);return r;};
const get=async(token:string)=>{const r=await request(app).get('/api/workspace').auth(token,{type:'bearer'});assert.equal(r.status,200,r.text);return r.body;};
const save=(token:string,snapshot:any)=>request(app).put('/api/workspace').auth(token,{type:'bearer'}).send(snapshot);
before(async()=>{db=await openDatabase();await migrate(db);app=await createApp(db,{secret:'t'.repeat(64),demo:true,mailer:async(email,url)=>{mail[email]=url;}});for(const role of ['admin','manager','student','member','viewer'])accounts[role]=(await login(`${role}@nexus.test`)).body;});
after(async()=>{await db.close();});

test('five concise demo logins authenticate and the student sees only assigned study projects',async()=>{
  for(const [profile,role] of [['admin','admin'],['manager','manager'],['student','member'],['member','member'],['viewer','viewer']])assert.equal(accounts[profile].user.role,role);
  const snapshot=await get(accounts.student.accessToken);
  assert.deepEqual(snapshot.state.projects.map((p:any)=>p.id).sort(),['p2','p4']);
  assert(snapshot.state.projects.every((p:any)=>p.category==='study'));
  assert(snapshot.state.tasks.some((task:any)=>task.assignee==='demo-student'));
  snapshot.state.projects[0].name='Forbidden student edit';
  assert.equal((await save(accounts.student.accessToken,snapshot)).status,403);
  assert.equal((await request(app).post('/api/auth/login').send({email:'student@nexus.test',password:'WrongDemo!26'})).status,401);
  assert.equal((await request(app).post('/api/auth/login').send({email:'student@nexus.test',password:'short'})).status,400);
  assert.equal((await request(app).post('/api/auth/register').send({email:'weak@nexus.test',password:'short',name:'Weak password',organization:'Rejected'})).status,400);
});
test('health, protected routes, headers, input and CORS safeguards',async()=>{
  assert.equal((await request(app).get('/api/health')).body.status,'ok');assert.equal((await request(app).get('/api/workspace')).status,401);
  const r=await request(app).get('/');assert.equal(r.status,200);assert.match(r.headers['content-security-policy'],/frame-ancestors 'none'/);assert.equal(r.headers['x-content-type-options'],'nosniff');
  assert.equal((await request(app).get('/server/app.ts')).status,404);assert.equal((await request(app).get('/.env')).status,404);
  assert.equal((await request(app).post('/api/auth/login').set('Origin','https://attacker.test').send({})).status,403);
  assert.equal((await request(app).post('/api/auth/login').send({email:'bad',password:'short'})).status,400);
});
test('administrator and manager can create delivery, budget, risk and milestone records',async()=>{
  const snapshot=await get(accounts.manager.accessToken),s=snapshot.state;
  s.projects[0].budget=10000;s.projects[0].forecast=11000;
  s.expenses.push({id:'test-expense',projectId:s.projects[0].id,amount:230,category:'General',date:'2026-10-20',vendor:'Test vendor',notes:''});
  s.milestones.push({id:'test-milestone',projectId:s.projects[0].id,title:'Acceptance review',due:'2026-11-20',done:false});
  const r=await save(accounts.manager.accessToken,snapshot);assert.equal(r.status,200,r.text);assert(r.body.state.activity.length>s.activity.length);assert(r.body.state.notifications.length>0);
  r.body.state.projects[0].client='Second save without reloading';const second=await save(accounts.manager.accessToken,r.body);assert.equal(second.status,200,second.text);
  const stale=await save(accounts.manager.accessToken,snapshot);assert.equal(stale.status,409);
});
test('members can update assigned progress, but cannot modify other tasks or project financials',async()=>{
  let snap=await get(accounts.member.accessToken);const task=snap.state.tasks.find((t:any)=>t.assignee==='m2');task.status='Done';task.completedAt='2026-10-20';
  let r=await save(accounts.member.accessToken,snap);assert.equal(r.status,200,r.text);
  snap=await get(accounts.member.accessToken);snap.state.projects[0].budget+=1;r=await save(accounts.member.accessToken,snap);assert.equal(r.status,403);
  snap=await get(accounts.member.accessToken);const other=snap.state.tasks.find((t:any)=>t.assignee!=='m2');other.status='Done';other.completedAt='2026-10-20';r=await save(accounts.member.accessToken,snap);assert.equal(r.status,403);
});
test('viewers have read-only project access and own notification read access',async()=>{
  let snap=await get(accounts.viewer.accessToken);snap.state.projects[0].name='Unauthorized';assert.equal((await save(accounts.viewer.accessToken,snap)).status,403);
  snap=await get(accounts.viewer.accessToken);snap.state.notifications=snap.state.notifications.map((n:any)=>({...n,read:true}));const r=await save(accounts.viewer.accessToken,snap);assert.equal(r.status,200,r.text);
});
test('new organizations are isolated, including forged cross-tenant project references',async()=>{
  const registered=await request(app).post('/api/auth/register').send({email:'other@nexus.test',password:'OtherStrong!2026',name:'Other admin',organization:'Other org'});assert.equal(registered.status,201,registered.text);
  const snap=await get(registered.body.accessToken);assert.equal(snap.state.projects.length,0);assert.equal(snap.state.members.length,1);
  snap.state.tasks.push({id:'forged',projectId:'p1',title:'Cross-tenant task',notes:'',status:'Backlog',priority:'High',due:'2026-10-20'});
  assert.equal((await save(registered.body.accessToken,snap)).status,400);
});
test('database constraints protect tenant project links and malformed attachments are rejected',async()=>{
  await assert.rejects(()=>db.query("INSERT INTO records(org_id,kind,id,project_id,payload) VALUES('demo-organization','tasks','foreign-key-test','missing','{}')"));
  const snap=await get(accounts.admin.accessToken);snap.state.files.push({id:'bad-file',projectId:'p1',taskId:'',name:'fake.pdf',type:'application/pdf',data:Buffer.from('not a pdf').toString('base64')});assert.equal((await save(accounts.admin.accessToken,snap)).status,400);
});
test('invitations require admin, one-use tokens create users, last administrator is protected',async()=>{
  assert.equal((await request(app).post('/api/invitations').auth(accounts.manager.accessToken,{type:'bearer'}).send({email:'invite@nexus.test',role:'member'})).status,403);
  const invited=await request(app).post('/api/invitations').auth(accounts.admin.accessToken,{type:'bearer'}).send({email:'invite@nexus.test',role:'member'});assert.equal(invited.status,201,invited.text);
  const token=mail['invite@nexus.test'].split('/').pop(),body={token,name:'New member',password:'Invitation!2026'};
  const accepted=await request(app).post('/api/auth/accept-invite').send(body);assert.equal(accepted.status,201,accepted.text);assert.equal((await get(accepted.body.accessToken)).state.projects.length,0);
  assert.equal((await request(app).post('/api/auth/accept-invite').send(body)).status,400);
  const r=await request(app).patch('/api/users/demo-admin').auth(accounts.admin.accessToken,{type:'bearer'}).send({role:'viewer',active:false,department:'',capacity:40});assert.equal(r.status,400);
});
test('password reset is generic, single-use, and revokes existing sessions',async()=>{
  const user=await request(app).post('/api/auth/register').send({email:'reset@nexus.test',password:'ResetBefore!2026',name:'Reset tester',organization:'Reset org'});assert.equal(user.status,201);
  const found=await request(app).post('/api/auth/forgot').send({email:'reset@nexus.test'}),absent=await request(app).post('/api/auth/forgot').send({email:'absent@nexus.test'});assert.deepEqual(found.body,absent.body);
  const token=mail['reset@nexus.test'].split('/').pop(),body={token,password:'ResetAfter!2026'};
  assert.equal((await request(app).post('/api/auth/reset').send(body)).status,200);
  assert.equal((await request(app).get('/api/workspace').auth(user.body.accessToken,{type:'bearer'})).status,401);
  assert.equal((await request(app).post('/api/auth/reset').send(body)).status,400);
  assert.equal((await request(app).post('/api/auth/login').send({email:'reset@nexus.test',password:'ResetAfter!2026'})).status,200);
});
test('refresh tokens rotate, replay revokes the family, logout invalidates access tokens',async()=>{
  const signed=await login('manager@nexus.test'),cookie=signed.headers['set-cookie'][0].split(';')[0];
  const refreshed=await request(app).post('/api/auth/refresh').set('Cookie',cookie).send({});assert.equal(refreshed.status,200,refreshed.text);assert.notEqual(refreshed.headers['set-cookie'][0],signed.headers['set-cookie'][0]);
  assert.equal((await request(app).post('/api/auth/refresh').set('Cookie',cookie).send({})).status,401);
  assert.equal((await request(app).get('/api/workspace').auth(refreshed.body.accessToken,{type:'bearer'})).status,401);
  const fresh=await login('manager@nexus.test');await request(app).post('/api/auth/logout').set('Cookie',fresh.headers['set-cookie'][0].split(';')[0]).send({});assert.equal((await request(app).get('/api/workspace').auth(fresh.body.accessToken,{type:'bearer'})).status,401);
});
test('task list endpoint paginates and caps page size',async()=>{
  const r=await request(app).get('/api/tasks?page=1&limit=2').auth(accounts.admin.accessToken,{type:'bearer'});assert.equal(r.status,200);assert.equal(r.body.items.length,2);assert(r.body.total>=12);
  assert.equal((await request(app).get('/api/tasks?limit=1000').auth(accounts.admin.accessToken,{type:'bearer'})).status,400);
});
test('organization settings are admin-only and persist across workspace saves',async()=>{
  const body={name:'Updated demo organization',departments:['Design','Research']};assert.equal((await request(app).patch('/api/organization').auth(accounts.manager.accessToken,{type:'bearer'}).send(body)).status,403);
  assert.equal((await request(app).patch('/api/organization').auth(accounts.admin.accessToken,{type:'bearer'}).send(body)).status,200);
  const snap=await get(accounts.admin.accessToken);assert.equal((await save(accounts.admin.accessToken,snap)).status,200);
  const org=await request(app).get('/api/organization').auth(accounts.admin.accessToken,{type:'bearer'});assert.deepEqual(org.body,body);
});

test('malformed scoped snapshots fail safely without changing persisted data',async()=>{
  const before=await get(accounts.member.accessToken);
  for(const invalid of [null,{},42,[null]]){
    const snapshot=structuredClone(before);snapshot.state.tasks=invalid;
    const response=await save(accounts.member.accessToken,snapshot);
    assert.equal(response.status,400,response.text);
    assert.equal((await get(accounts.member.accessToken)).revision,before.revision);
  }
});

test('activity access uses stable actor IDs even when display names collide',async()=>{
  const admin=await get(accounts.admin.accessToken);
  assert(admin.state.activity.some((entry:any)=>entry.actorId==='demo-admin'));
  let snapshot=await get(accounts.member.accessToken);
  const originalName=snapshot.state.profile.name;
  snapshot.state.profile.name='Demo Administrator';
  let response=await save(accounts.member.accessToken,snapshot);assert.equal(response.status,200,response.text);
  snapshot=await get(accounts.member.accessToken);
  assert(snapshot.state.activity.every((entry:any)=>entry.actorId==='m2'));
  assert(!snapshot.state.activity.some((entry:any)=>entry.actorId==='demo-admin'));
  const task=snapshot.state.tasks.find((entry:any)=>entry.assignee==='m2');
  task.notes='A change attributed to the stable member account.';
  response=await save(accounts.member.accessToken,snapshot);assert.equal(response.status,200,response.text);
  assert(response.body.state.activity.some((entry:any)=>entry.actorId==='m2'));
  response.body.state.profile.name=originalName;
  assert.equal((await save(accounts.member.accessToken,response.body)).status,200);
});

test('writes recheck a demoted actor inside the organization transaction',async()=>{
  const actor=(await db.query("SELECT * FROM users WHERE id='m1'")).rows[0] as User;
  const snapshot=await get(accounts.manager.accessToken);snapshot.state.projects[0].budget+=100;
  await db.query("UPDATE users SET role='viewer' WHERE id='m1'");
  try{await assert.rejects(()=>writeWorkspace(db,actor,snapshot.state,snapshot.revision),(error:any)=>error.status===403);}
  finally{await db.query("UPDATE users SET role='manager' WHERE id='m1'");}
  assert.equal((await get(accounts.manager.accessToken)).revision,snapshot.revision);
});

test('concurrent refresh replay and logout cannot leave a surviving replacement session',async()=>{
  const signed=await login('manager@nexus.test'),cookie=signed.headers['set-cookie'][0].split(';')[0];
  const attempts=await Promise.all([
    request(app).post('/api/auth/refresh').set('Cookie',cookie).send({}),
    request(app).post('/api/auth/refresh').set('Cookie',cookie).send({})
  ]);
  assert.deepEqual(attempts.map(response=>response.status).sort(),[200,401]);
  const rotated=attempts.find(response=>response.status===200)!;
  assert.equal((await request(app).get('/api/workspace').auth(rotated.body.accessToken,{type:'bearer'})).status,401);
  assert.equal((await request(app).post('/api/auth/refresh').set('Cookie',rotated.headers['set-cookie'][0].split(';')[0]).send({})).status,401);
  const fresh=await login('manager@nexus.test'),freshCookie=fresh.headers['set-cookie'][0].split(';')[0];
  const [rotation,logout]=await Promise.all([
    request(app).post('/api/auth/refresh').set('Cookie',freshCookie).send({}),
    request(app).post('/api/auth/logout').set('Cookie',freshCookie).send({})
  ]);
  assert.equal(logout.status,200);assert([200,401].includes(rotation.status));
  if(rotation.status===200)assert.equal((await request(app).get('/api/workspace').auth(rotation.body.accessToken,{type:'bearer'})).status,401);
  assert.equal((await request(app).get('/api/workspace').auth(fresh.body.accessToken,{type:'bearer'})).status,401);
});

test('successful reset invalidates every previously issued reset link',async()=>{
  const email='reset-links@nexus.test';
  assert.equal((await request(app).post('/api/auth/register').send({email,password:'OriginalPass!2026',name:'Reset links',organization:'Reset links org'})).status,201);
  await request(app).post('/api/auth/forgot').send({email});const earlier=mail[email].split('/').pop();
  await request(app).post('/api/auth/forgot').send({email});const latest=mail[email].split('/').pop();
  assert.notEqual(earlier,latest);
  assert.equal((await request(app).post('/api/auth/reset').send({token:latest,password:'CurrentPass!2026'})).status,200);
  assert.equal((await request(app).post('/api/auth/reset').send({token:earlier,password:'OutdatedPass!2026'})).status,400);
  assert.equal((await request(app).post('/api/auth/login').send({email,password:'CurrentPass!2026'})).status,200);
});

test('reissuing an invitation revokes the prior role-bearing link',async()=>{
  const email='reinvite@nexus.test';
  const invite=(role:string)=>request(app).post('/api/invitations').auth(accounts.admin.accessToken,{type:'bearer'}).send({email,role});
  assert.equal((await invite('admin')).status,201);const earlier=mail[email].split('/').pop();
  assert.equal((await invite('viewer')).status,201);const latest=mail[email].split('/').pop();
  const accept=(token:string|undefined)=>request(app).post('/api/auth/accept-invite').send({token,name:'Reinvited user',password:'Invitation!2026'});
  assert.equal((await accept(earlier)).status,400);
  const accepted=await accept(latest);assert.equal(accepted.status,201,accepted.text);assert.equal(accepted.body.user.role,'viewer');
});

test('JSON-only mutations, rejected token tampering, and scoped cookie flags are enforced',async()=>{
  assert.equal((await request(app).post('/api/auth/logout').type('form').send({})).status,415);
  const token=accounts.admin.accessToken;
  const segments=token.split('.');segments[1]=Buffer.from(JSON.stringify({sub:'demo-admin',org:'demo-organization',sid:'forged'})).toString('base64url');
  assert.equal((await request(app).get('/api/workspace').auth(segments.join('.'),{type:'bearer'})).status,401);
  const signed=await login('viewer@nexus.test');
  const cookie=signed.headers['set-cookie'][0];
  assert.match(cookie,/HttpOnly/i);assert.match(cookie,/SameSite=Strict/i);assert.match(cookie,/Path=\/api\/auth/i);
  assert.equal(signed.headers['cache-control'],'no-store');
  const allowed=await request(app).options('/api/auth/refresh').set('Origin','http://127.0.0.1:4174').set('Access-Control-Request-Method','POST');
  assert.equal(allowed.status,204);assert.equal(allowed.headers['access-control-allow-origin'],'http://127.0.0.1:4174');
  assert.equal((await request(app).options('/api/auth/refresh').set('Origin','https://attacker.test')).status,403);
});

test('refresh rotation preserves the absolute session deadline and refuses expired sessions',async()=>{
  const signed=await login('manager@nexus.test'),cookie=signed.headers['set-cookie'][0].split(';')[0];
  const hashCookie=(value:string)=>createHash('sha256').update(value.slice(value.indexOf('=')+1)).digest('hex');
  const original=(await db.query('SELECT expires_at FROM refresh_sessions WHERE token_hash=$1',[hashCookie(cookie)])).rows[0];
  const rotated=await request(app).post('/api/auth/refresh').set('Cookie',cookie).send({});assert.equal(rotated.status,200,rotated.text);
  const replacementCookie=rotated.headers['set-cookie'][0].split(';')[0];
  const replacement=(await db.query('SELECT expires_at FROM refresh_sessions WHERE token_hash=$1',[hashCookie(replacementCookie)])).rows[0];
  assert.equal(new Date(replacement.expires_at).getTime(),new Date(original.expires_at).getTime());
  await db.query("UPDATE refresh_sessions SET expires_at=now()-interval '1 minute' WHERE token_hash=$1",[hashCookie(replacementCookie)]);
  assert.equal((await request(app).post('/api/auth/refresh').set('Cookie',replacementCookie).send({})).status,401);
  assert.equal((await request(app).get('/api/workspace').auth(rotated.body.accessToken,{type:'bearer'})).status,401);
});

test('legacy demo upgrades preserve edits and custom credentials while migrating only exact fixture identities',async()=>{
  const fixture=await openDatabase();
  try{
    await migrate(fixture);await seedDemo(fixture);
    // Recreate the previous four-person fixture without replacing its edited work.
    await fixture.query("UPDATE records SET payload=jsonb_set(payload,'{members}',(payload->'members')-'demo-student') WHERE org_id='demo-organization' AND kind='projects'");
    await fixture.query("UPDATE records SET payload=jsonb_set(payload,'{assignee}','\"m2\"') WHERE org_id='demo-organization' AND kind='tasks' AND payload->>'assignee'='demo-student'");
    await fixture.query("UPDATE records SET payload=jsonb_set(payload,'{title}','\"User-edited study work\"') WHERE org_id='demo-organization' AND kind='tasks' AND id='t2'");
    await fixture.query("DELETE FROM project_links WHERE user_id='demo-student'");
    await fixture.query("DELETE FROM records WHERE org_id='demo-organization' AND kind='notifications' AND payload->>'recipient'='demo-student'");
    await fixture.query("DELETE FROM users WHERE id='demo-student'");
    const legacy=await bcrypt.hash('NexusDemo!2026',12),custom=await bcrypt.hash('MyPersonal!2026',12);
    await fixture.query("UPDATE users SET password_hash=$1 WHERE org_id='demo-organization'",[legacy]);
    await fixture.query("UPDATE users SET password_hash=$1,name='Customized manager',department='Engineering' WHERE id='m1'",[custom]);
    await fixture.query("UPDATE users SET email='renamed-viewer@nexus.test' WHERE id='m3'");
    await fixture.query("INSERT INTO organizations(id,name) VALUES('unrelated-demo-test','Unrelated organization')");
    await fixture.query("INSERT INTO users(id,org_id,name,email,password_hash,role) VALUES('unrelated-user','unrelated-demo-test','Unrelated person','unrelated@nexus.test',$1,'admin')",[legacy]);
    await fixture.query("INSERT INTO refresh_sessions(token_hash,user_id,expires_at,family) VALUES('legacy-session','demo-admin',now()+interval '1 day','legacy-family')");
    await seedDemo(fixture);
    let users=(await fixture.query('SELECT id,name,email,password_hash,department,capacity FROM users ORDER BY id')).rows;
    const byId=(id:string)=>users.find(user=>user.id===id)!;
    assert(await bcrypt.compare('NexusDemo!26',byId('demo-admin').password_hash));
    assert(await bcrypt.compare('NexusDemo!26',byId('m2').password_hash));
    assert.equal(byId('m1').password_hash,custom);assert.equal(byId('m1').name,'Customized manager');assert.equal(byId('m1').department,'Engineering');
    assert.equal(byId('m3').password_hash,legacy);assert.equal(byId('unrelated-user').password_hash,legacy);
    assert.equal(byId('demo-student').email,'student@nexus.test');assert.equal(Number(byId('demo-student').capacity),20);
    assert.equal((await fixture.query("SELECT revoked FROM refresh_sessions WHERE token_hash='legacy-session'")).rows[0].revoked,true);
    const tasks=(await fixture.query("SELECT payload FROM records WHERE org_id='demo-organization' AND kind='tasks'")).rows.map(row=>row.payload);
    assert.equal(tasks.find(task=>task.id==='t2').title,'User-edited study work');assert.equal(tasks.find(task=>task.id==='t2').assignee,'m2');
    assert.equal(tasks.find(task=>task.id==='demo-student-welcome').assignee,'demo-student');
    assert.equal(tasks.length,13);
    const revision=(await fixture.query("SELECT revision FROM organizations WHERE id='demo-organization'")).rows[0].revision;
    await seedDemo(fixture);
    assert.equal((await fixture.query("SELECT count(*) FROM records WHERE org_id='demo-organization' AND kind='tasks'")).rows[0].count,13);
    assert.equal((await fixture.query("SELECT revision FROM organizations WHERE id='demo-organization'")).rows[0].revision,revision);
    users=(await fixture.query('SELECT id,name,email,password_hash,department,capacity FROM users ORDER BY id')).rows;
    assert.equal(byId('m1').password_hash,custom);
  }finally{await fixture.close();}
});

test('demo provisioning respects roster limits and does not claim non-demo identities',async()=>{
  const fixture=await openDatabase();
  try{
    await migrate(fixture);
    await fixture.query("INSERT INTO organizations(id,name) VALUES('existing-customer','Existing customer')");
    const hash=await bcrypt.hash('NexusDemo!2026',12);
    await fixture.query("INSERT INTO users(id,org_id,name,email,password_hash,role) VALUES('customer-admin','existing-customer','Customer','admin@nexus.test',$1,'admin')",[hash]);
    await seedDemo(fixture);
    assert.equal((await fixture.query("SELECT 1 FROM organizations WHERE id='demo-organization'")).rows.length,0);
    assert.equal((await fixture.query("SELECT password_hash FROM users WHERE id='customer-admin'")).rows[0].password_hash,hash);
    await fixture.query("UPDATE users SET email='customer@nexus.test' WHERE id='customer-admin'");
    await seedDemo(fixture);
    // The fixture already has five accounts; replace its student with enough
    // other members to reach the supported 200-account ceiling.
    await fixture.query("DELETE FROM project_links WHERE user_id='demo-student'");
    await fixture.query("DELETE FROM users WHERE id='demo-student'");
    await fixture.query("INSERT INTO users(id,org_id,name,email,password_hash,role) SELECT 'limit-'||n,'demo-organization','Limit member '||n,'limit-'||n||'@nexus.test',$1,'member' FROM generate_series(1,196) n",[hash]);
    await seedDemo(fixture);
    assert.equal((await fixture.query("SELECT count(*) FROM users WHERE org_id='demo-organization'")).rows[0].count,200);
    assert.equal((await fixture.query("SELECT 1 FROM users WHERE id='demo-student'")).rows.length,0);
  }finally{await fixture.close();}
});

test('production and demo-disabled applications do not provision public demo accounts',async()=>{
  const fixture=await openDatabase(),previousDatabase=process.env.DATABASE_URL,previousPublic=process.env.PUBLIC_URL;
  try{
    await migrate(fixture);
    const disabled=await createApp(fixture,{secret:'t'.repeat(64),demo:false});
    assert.equal((await fixture.query('SELECT count(*) FROM users')).rows[0].count,0);
    assert.match((await request(disabled).get('/runtime-config.js')).text,/DEMO_ENABLED = false/);
    process.env.DATABASE_URL='postgresql://deployment-configuration-only/nexus';process.env.PUBLIC_URL='https://app.example.test';
    const production=await createApp(fixture,{secret:'t'.repeat(64),production:true,demo:true});
    assert.equal((await fixture.query('SELECT count(*) FROM users')).rows[0].count,0);
    const config=(await request(production).get('/runtime-config.js')).text;
    assert.match(config,/DEMO_ENABLED = false/);assert.doesNotMatch(config,/NexusDemo|@nexus\.test/);
    assert.equal((await request(production).post('/api/auth/login').send({email:'admin@nexus.test',password:'NexusDemo!26'})).status,401);
  }finally{
    if(previousDatabase===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=previousDatabase;
    if(previousPublic===undefined)delete process.env.PUBLIC_URL;else process.env.PUBLIC_URL=previousPublic;
    await fixture.close();
  }
});
