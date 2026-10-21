import { mkdir,copyFile,writeFile,readFile,rm,lstat } from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),dist=path.join(root,'dist');
const api=process.env.NEXUS_API_URL??'';
if(api){const url=new URL(api);if(url.protocol!=='https:'||url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw new Error('NEXUS_API_URL must be a bare HTTPS origin.');}
// Rebuild only this known generated directory. Never follow a substituted symlink.
if(path.dirname(dist)!==root||path.basename(dist)!=='dist')throw new Error('Unexpected output directory.');
const existing=await lstat(dist).catch(error=>{if(error.code!=='ENOENT')throw error;return null;});
if(existing?.isSymbolicLink())throw new Error('The output directory must not be a symbolic link.');
await rm(dist,{recursive:true,force:true});
await mkdir(path.join(dist,'assets'),{recursive:true});
for(const file of ['index.html','appearance.js','auth-ui.js','account-ui.js','account.css','app.js','model.js','management.js','connection.js','styles.css','.nojekyll'])await copyFile(path.join(root,file),path.join(dist,file));
for(const file of ['mark.svg','pdf-lib.js','pdf-lib-LICENSE.md'])await copyFile(path.join(root,'assets',file),path.join(dist,'assets',file));
await writeFile(path.join(dist,'runtime-config.js'),`export const API_BASE = ${JSON.stringify(api.replace(/\/$/,''))};\nexport const DEMO_ENABLED = false;\n`);
if(api){let html=await readFile(path.join(dist,'index.html'),'utf8');html=html.replace("connect-src 'self'",`connect-src 'self' ${new URL(api).origin}`);await writeFile(path.join(dist,'index.html'),html);}
console.log(`GitHub Pages package: ${dist} (${api?'connected API':'local demo'})`);
