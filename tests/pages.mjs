import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
const root=path.resolve(import.meta.dirname,'../dist'),prefix='/student-planner/';
const server=http.createServer(async(req,res)=>{try{const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(!name.startsWith(prefix)){res.writeHead(404);res.end();return;}const file=path.resolve(root,name.slice(prefix.length)||'index.html');if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}const data=await readFile(file);res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'})[path.extname(file)]??'application/octet-stream');res.end(data);}catch{res.writeHead(404);res.end();}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE_PATH?{executablePath:process.env.BROWSER_EXECUTABLE_PATH}:{})});
try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`);});
  const url=`http://127.0.0.1:${server.address().port}${prefix}`;
  await page.goto(url);await page.waitForSelector('.welcome-banner');
  await page.locator('#theme-toggle').click();
  const theme=await page.locator('html').getAttribute('data-theme');
  await page.getByRole('button',{name:'+ New project',exact:true}).click();await page.getByLabel('Project name',{exact:true}).fill('Pages subpath acceptance');await page.locator('#editor').getByRole('button',{name:'Create project',exact:true}).click();await page.waitForSelector('.project-summary');await page.reload();await page.waitForSelector('.project-summary');assert.equal(await page.locator('h1').textContent(),'Pages subpath acceptance');assert.deepEqual(errors,[]);
  assert.equal(await page.locator('html').getAttribute('data-theme'),theme);
  assert.equal(await page.locator('html').evaluate(el=>getComputedStyle(el).colorScheme),theme);
  console.log('Pages subpath: assets, styles, hash routes, creation, appearance and reload persistence passed.');
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
