import { openDatabase,migrate } from './db.js';
import { createApp } from './app.js';
const production=process.env.NODE_ENV==='production';
const db=await openDatabase(process.env.DATABASE_URL);
await migrate(db);
const app=await createApp(db,{production,demo:process.env.DEMO_SEED==='1'});
const port=Number(process.env.PORT??4174);
const server=app.listen(port,process.env.HOST??'127.0.0.1',()=>console.log(`Project Nexus: http://127.0.0.1:${port}`));
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>server.close(()=>{db.close().then(()=>process.exit(0));}));
