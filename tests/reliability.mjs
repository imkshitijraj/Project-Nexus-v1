import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const local='http://127.0.0.1:4173',remote='http://127.0.0.1:4174';
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE_PATH?{executablePath:process.env.BROWSER_EXECUTABLE_PATH}:{})});
const results={checks:[],errors:[],localPerformance:{}};
const watch=page=>page.on('pageerror',e=>results.errors.push(e.message));
async function login(page,email){
  await page.goto(remote);
  await page.getByLabel('Email',{exact:true}).fill(email);
  await page.getByLabel('Password',{exact:true}).fill('NexusDemo!26');
  await page.locator('#auth-form').getByRole('button',{name:'Sign in',exact:true}).click();
  await page.waitForSelector('.welcome-banner');
}
try{
  const context=await browser.newContext(),page=await context.newPage();watch(page);
  for(const name of ['.env','package.json','server/app.ts','tests/model.test.mjs','node_modules/typescript/package.json']){
    assert.equal((await context.request.get(`${local}/${name}`)).status(),404);
  }
  assert.equal((await context.request.post(local,{data:{}})).status(),405);
  results.checks.push('Local static server exposes only public assets');
  await page.goto(`${local}/#tasks`);await page.waitForSelector('.task-row');
  await page.getByRole('button',{name:'▥ Board',exact:true}).click();
  const select=page.locator('.move-task').first(),before=await select.inputValue();
  await page.evaluate(()=>{window.savedSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException('Full','QuotaExceededError');};});
  await select.selectOption(before==='Backlog'?'In progress':'Backlog');
  await page.locator('#storage-warning').waitFor({state:'visible'});
  assert.equal(await select.inputValue(),before);
  await page.evaluate(()=>{Storage.prototype.setItem=window.savedSetItem;});
  results.checks.push('Failed immediate status save restores the saved value');
  // Another tab changes the workspace while the first tab holds a draft.
  await page.getByRole('button',{name:'+ Add task',exact:true}).first().click();
  await page.getByLabel('Task name',{exact:true}).fill('Unsaved conflict draft');
  const sibling=await context.newPage();watch(sibling);await sibling.goto(`${local}/#settings`);
  await sibling.getByLabel('Display name',{exact:true}).fill('Other tab update');
  await sibling.getByRole('button',{name:'Save profile',exact:true}).click();
  await page.getByRole('button',{name:'Create task',exact:true}).click();
  await page.locator('.form-error').waitFor({state:'visible'});
  assert.equal(await page.getByLabel('Task name',{exact:true}).inputValue(),'Unsaved conflict draft');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('stride.workspace.v1')).profile.name),'Other tab update');
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('stride.workspace.v1')).tasks.some(t=>t.title==='Unsaved conflict draft')),false);
  results.checks.push('Cross-tab conflict preserves both saved data and the unsaved draft');
  await context.close();
  // A browser snapshot at the supported task limit is a local rendering check, not a load SLA.
  const stress=await browser.newContext(),large=await stress.newPage();watch(large);
  await large.goto(local);await large.waitForSelector('.welcome-banner');
  await large.evaluate(async()=>{
    const {seedState,validateState}=await import('./model.js');
    const state=seedState(),template=state.tasks[0];
    state.tasks=Array.from({length:2000},(_,i)=>({...template,id:`scale-${i}`,title:`Scale task ${i}`,status:'Backlog',completedAt:'',parentId:'',dependencies:[],history:[],comments:[],checklist:[],watchers:[]}));
    localStorage.setItem('stride.workspace.v1',JSON.stringify(validateState(state)));
  });
  let started=performance.now();
  await large.goto(`${local}/#tasks`);await large.reload();await large.waitForSelector('.task-row');
  assert.equal(await large.locator('.task-row').count(),2000);
  results.localPerformance.tasks2000LoadMs=Math.round(performance.now()-started);
  started=performance.now();
  await large.locator('#task-search').fill('Scale task 1999');
  assert.equal(await large.locator('.task-row').count(),1);
  results.localPerformance.filter2000Ms=Math.round(performance.now()-started);
  results.checks.push('2,000-task rendering and search');
  await stress.close();
  const account=await browser.newContext(),first=await account.newPage();watch(first);
  await first.goto(remote);await first.locator('#auth-form').waitFor();
  await first.locator('h1').click();await first.keyboard.press('n');
  assert.equal(await first.locator('#editor').evaluate(el=>el.open),false);
  await login(first,'admin@nexus.test');
  const second=await account.newPage();watch(second);
  await second.goto(`${remote}/#settings`);await second.getByLabel('Display name',{exact:true}).waitFor();
  await second.getByLabel('Display name',{exact:true}).fill('Latest organization profile');
  await second.getByRole('button',{name:'Save profile',exact:true}).click();
  await second.waitForFunction(()=>document.querySelector('#save-status').textContent==='Saved to your organization');
  // First tab retains its older revision and must receive a conflict instead of overwriting.
  await first.getByRole('button',{name:'+ New project',exact:true}).click();
  await first.getByLabel('Project name',{exact:true}).fill('Rejected stale project');
  await first.locator('#editor').getByRole('button',{name:'Create project',exact:true}).click();
  await first.locator('.form-error').waitFor({state:'visible'});
  assert.match(await first.locator('.form-error').textContent(),/reload|changed|stale|conflict/i);
  assert.equal(await first.getByLabel('Project name',{exact:true}).inputValue(),'Rejected stale project');
  await first.reload();await first.waitForSelector('.welcome-banner');
  assert.equal(await first.locator('#profile-name').textContent(),'Latest organization profile');
  assert.equal(await first.getByRole('link',{name:'Rejected stale project',exact:true}).count(),0);
  results.checks.push('Unauthenticated shortcuts are inert','Connected stale save rejects overwrites and keeps draft input');
  await account.close();
  const viewerContext=await browser.newContext(),viewer=await viewerContext.newPage();watch(viewer);
  await login(viewer,'viewer@nexus.test');
  await viewer.locator('h1').click();await viewer.keyboard.press('p');
  assert.equal(await viewer.locator('#editor').evaluate(el=>el.open),false);
  await viewer.keyboard.press('n');
  assert.equal(await viewer.locator('#editor').evaluate(el=>el.open),false);
  await viewer.goto(`${remote}/#settings`);
  await viewer.route('**/api/auth/logout',route=>route.abort('failed'));
  await viewer.getByRole('button',{name:'Sign out',exact:true}).click();
  await viewer.locator('#auth-form').waitFor();
  assert.equal(await viewer.locator('#profile-name').textContent(),'Your organization');
  assert.equal(await viewer.locator('#pinned-projects').textContent(),'');
  await viewer.getByRole('button',{name:'Retry sign out',exact:true}).waitFor();
  await viewer.unroute('**/api/auth/logout');
  await viewer.getByRole('button',{name:'Retry sign out',exact:true}).click();
  await viewer.waitForFunction(()=>!document.querySelector('[data-action="logout"]'));
  results.checks.push('Viewer shortcuts respect roles','Failed sign-out clears account labels and offers server revocation retry');
  await viewerContext.close();
  assert.deepEqual(results.errors,[]);
  console.log(JSON.stringify(results,null,2));
}finally{
  await mkdir('test-results',{recursive:true});
  await writeFile('test-results/reliability-results.json',JSON.stringify(results,null,2));
  await browser.close();
}
