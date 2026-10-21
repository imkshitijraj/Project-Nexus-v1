import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { readFile,mkdir } from 'node:fs/promises';
import path from 'node:path';
export type Row = Record<string, any>;
export interface Database { query(sql:string,params?:any[]):Promise<{rows:Row[]}>; transaction<T>(fn:(db:Database)=>Promise<T>):Promise<T>; close():Promise<void> }
export async function openDatabase(url?:string):Promise<Database> {
  if (url) {
    const pool=new pg.Pool({connectionString:url,max:10});
    const wrap=(client:pg.Pool|pg.PoolClient):Database=>({query:async(s,p)=>client.query(s,p),transaction:async(fn)=>{
      const conn=await pool.connect();try{await conn.query('BEGIN');const result=await fn(wrap(conn));await conn.query('COMMIT');return result;}catch(e){await conn.query('ROLLBACK');throw e;}finally{conn.release();}
    },close:()=>pool.end()});return wrap(pool);
  }
  const directory=process.env.DATA_DIR ?? './.data/postgres';if(directory!=='memory://')await mkdir(path.dirname(path.resolve(directory)),{recursive:true});
  const lite=new PGlite(directory);
  const wrap=(client:any):Database=>({query:(sql,params)=>client.query(sql,params),transaction:fn=>lite.transaction(tx=>fn(wrap(tx))),close:()=>lite.close()});
  return wrap(lite);
}
export async function migrate(db:Database){const sql=await readFile(new URL('./migrations/001_initial.sql',import.meta.url),'utf8');await db.transaction(async tx=>{for(const statement of sql.split(';').map(x=>x.trim()).filter(Boolean))await tx.query(statement);});}
