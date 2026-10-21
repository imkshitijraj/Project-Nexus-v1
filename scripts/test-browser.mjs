// Runs against an ephemeral seeded database; never loads the developer's .env.
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {randomBytes} from 'node:crypto';
const children=[];
const available=['ui','connected','reliability','appearance','accounts','pages'];
const selected=process.argv.slice(2).length?process.argv.slice(2):available;
if(selected.some(name=>!available.includes(name)))throw new Error(`Choose browser suites from: ${available.join(', ')}`);
const env={...process.env,NODE_ENV:'test',DATA_DIR:'memory://',DATABASE_URL:'',JWT_SECRET:randomBytes(48).toString('hex'),DEMO_SEED:'1',HOST:'127.0.0.1',PORT:'4174',STATIC_PORT:'4173',PUBLIC_URL:'http://127.0.0.1:4174',ALLOWED_ORIGINS:'http://127.0.0.1:4174',SMTP_URL:''};
async function running(url){
  try{await fetch(url,{signal:AbortSignal.timeout(500)});return true;}catch{return false;}
}
function start(args){const child=spawn(process.execPath,args,{env,stdio:['ignore','ignore','inherit']});children.push(child);return child;}
async function ready(child,url){
  for(let attempt=0;attempt<120;attempt++){
    if(child.exitCode!==null)throw new Error(`Server exited (${child.exitCode})`);
    if(await running(url))return;
    await delay(250);
  }
  throw new Error(`Server startup timed out: ${url}`);
}
async function test(file){
  console.log(`Running ${file}`);
  await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,[file],{env,stdio:'inherit'});children.push(child);
    child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(`${file} exited ${code}`)));
  });
}
try{
  for(const port of [4173,4174])if(await running(`http://127.0.0.1:${port}`))throw new Error(`Port ${port} is in use. Stop the development server before running test:browser.`);
  const local=start(['scripts/serve.mjs']);
  const connected=start(['--import','tsx','server/index.ts']);
  await Promise.all([ready(local,'http://127.0.0.1:4173'),ready(connected,'http://127.0.0.1:4174/api/health')]);
  for(const name of selected)await test(`tests/${name}.mjs`);
}finally{
  for(const child of children)if(child.exitCode===null)child.kill('SIGTERM');
}
