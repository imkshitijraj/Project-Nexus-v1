import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,copyFile,mkdir,writeFile,readdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const run=promisify(execFile);
const project=path.resolve(import.meta.dirname,'..');
test('Pages builds exclude stale/private files and validate API origins',async()=>{
  const fixture=await mkdtemp(path.join(tmpdir(),'nexus-build-'));
  try{
    await mkdir(path.join(fixture,'scripts'));
    await mkdir(path.join(fixture,'assets'));
    await mkdir(path.join(fixture,'dist'));
    await copyFile(path.join(project,'scripts/build-pages.mjs'),path.join(fixture,'scripts/build-pages.mjs'));
    for(const file of ['index.html','appearance.js','auth-ui.js','account-ui.js','account.css','app.js','model.js','management.js','connection.js','styles.css','.nojekyll'])await copyFile(path.join(project,file),path.join(fixture,file));
    for(const file of ['mark.svg','pdf-lib.js','pdf-lib-LICENSE.md'])await copyFile(path.join(project,'assets',file),path.join(fixture,'assets',file));
    await writeFile(path.join(fixture,'assets/private.json'),'private asset sentinel');
    await writeFile(path.join(fixture,'dist/stale-secret.txt'),'stale build sentinel');
    const build=api=>run(process.execPath,['scripts/build-pages.mjs'],{cwd:fixture,env:{...process.env,NEXUS_API_URL:api}});
    await build('');
    assert.ok(!(await readdir(path.join(fixture,'dist'))).includes('stale-secret.txt'));
    assert.ok(!(await readdir(path.join(fixture,'dist/assets'))).includes('private.json'));
    assert.match(await readFile(path.join(fixture,'dist/index.html'),'utf8'),/src="\.\/appearance\.js"/);
    for(const api of ['http://insecure.example','https://api.example/v1','https://api.example?x=1','https://user:password@api.example','https://api.example/#fragment']){
      await assert.rejects(build(api),/bare HTTPS origin/);
    }
    await build('https://api.example/');
    assert.match(await readFile(path.join(fixture,'dist/runtime-config.js'),'utf8'),/API_BASE = "https:\/\/api.example"/);
    assert.match(await readFile(path.join(fixture,'dist/index.html'),'utf8'),/connect-src 'self' https:\/\/api.example/);
    await build('');
    assert.doesNotMatch(await readFile(path.join(fixture,'dist/index.html'),'utf8'),/api\.example/);
  }finally{
    if(path.dirname(fixture)!==path.resolve(tmpdir())||!path.basename(fixture).startsWith('nexus-build-'))throw new Error('Unexpected fixture path');
    await rm(fixture,{recursive:true,force:true});
  }
});
