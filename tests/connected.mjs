import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
await mkdir('test-results',{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE_PATH?{executablePath:process.env.BROWSER_EXECUTABLE_PATH}:{})});
const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('401'))errors.push(m.text());});
await page.goto('http://127.0.0.1:4174');
await page.getByLabel('Email',{exact:true}).fill('admin@nexus.test');await page.getByLabel('Password',{exact:true}).fill('NexusDemo!26');await page.locator('#auth-form').getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForSelector('.welcome-banner');
await page.evaluate(async()=>{const {loadRemote,saveRemote}=await import('./connection.js'),{deleteProject}=await import('./model.js');let s=await loadRemote();const old=s.projects.filter(p=>p.name==='Connected acceptance project');for(const p of old)s=deleteProject(s,p.id);if(old.length)await saveRemote(s);});await page.reload();await page.waitForSelector('.welcome-banner');
await page.getByRole('button',{name:'+ New project',exact:true}).click();await page.getByLabel('Project name',{exact:true}).fill('Connected acceptance project');
await page.locator('#project-form summary').click();
await page.getByLabel('Owner',{exact:true}).selectOption('m1');await page.getByLabel('Team members',{exact:true}).selectOption(['m1','m2','m3']);await page.getByLabel('Department',{exact:true}).fill('Engineering');
await page.getByLabel('Budget (USD)',{exact:true}).fill('1000');await page.getByLabel('Forecast total (USD)',{exact:true}).fill('1200');await page.getByLabel('Category allocations (one Category: amount per line)',{exact:true}).fill('General: 1000');
await page.locator('#editor').getByRole('button',{name:'Create project',exact:true}).click();await page.waitForSelector('.project-summary');
assert.equal(await page.locator('h1').textContent(),'Connected acceptance project');
await page.getByRole('button',{name:'+ Add task',exact:true}).click();await page.getByLabel('Task name',{exact:true}).fill('Connected delivery task');await page.locator('#task-form summary').click();await page.getByLabel('Assignee',{exact:true}).selectOption('m2');await page.getByLabel('Estimate (hours)',{exact:true}).fill('36');await page.getByLabel('Checklist (one item per line; [x] for completed)',{exact:true}).fill('[x] Research\n[ ] Ship');await page.getByRole('button',{name:'Create task',exact:true}).click();await page.getByRole('button',{name:'Connected delivery task',exact:true}).waitFor();
const projectHash=await page.evaluate(()=>location.hash);
await page.getByRole('button',{name:'+ Expense',exact:true}).click();await page.getByLabel('Amount (USD)',{exact:true}).fill('1250');await page.getByLabel('Vendor',{exact:true}).fill('Acceptance vendor');await page.getByRole('button',{name:'Save expense',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#editor').open);
await page.getByRole('button',{name:'+ Risk',exact:true}).click();await page.getByLabel('Risk title',{exact:true}).fill('Acceptance delivery risk');await page.getByLabel('Probability (1–5)',{exact:true}).fill('5');await page.getByLabel('Impact (1–5)',{exact:true}).fill('5');await page.getByLabel('Risk owner',{exact:true}).selectOption('m2');await page.getByLabel('Mitigation plan',{exact:true}).fill('Schedule an extra review.');await page.getByRole('button',{name:'Save risk',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#editor').open);
await page.getByRole('button',{name:'+ Milestone',exact:true}).click();await page.getByLabel('Milestone title',{exact:true}).fill('Acceptance handoff');await page.getByRole('button',{name:'Save milestone',exact:true}).click();await page.getByRole('button',{name:'Complete milestone Acceptance handoff',exact:true}).click();await page.getByRole('button',{name:'Reopen milestone Acceptance handoff',exact:true}).waitFor();
await page.getByRole('button',{name:'Attach document',exact:true}).click();await page.locator('#attachment-upload').setInputFiles({name:'acceptance.txt',mimeType:'text/plain',buffer:Buffer.from('A safe text attachment.')});await page.getByRole('button',{name:'acceptance.txt',exact:true}).waitFor();
await page.goto('http://127.0.0.1:4174/#budget');await page.waitForSelector('.data-table');assert.match(await page.locator('body').textContent(),/Over budget/);
await page.goto('http://127.0.0.1:4174/#risks');await page.waitForSelector('.heatmap');assert.equal(await page.locator('.heat-cell').first().locator('b').textContent(),'0');assert.match(await page.locator('body').textContent(),/25 \/ 25/);
await page.goto('http://127.0.0.1:4174/#teams');await page.waitForSelector('.data-table');assert.match(await page.locator('body').textContent(),/Overloaded/);
await page.goto('http://127.0.0.1:4174/#calendar');await page.waitForSelector('.calendar-grid');await page.getByRole('button',{name:'+ Add event',exact:true}).click();await page.getByLabel('Event title',{exact:true}).fill('Acceptance meeting');await page.getByRole('button',{name:'Save calendar event',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#editor').open);assert.match(await page.locator('.calendar-grid').textContent(),/Acceptance meeting/);
await page.goto('http://127.0.0.1:4174/#reports');await page.waitForSelector('.report-grid');
const bytes=await page.evaluate(async()=>{const {loadRemote}=await import('./connection.js'),{reportPDF}=await import('./management.js');return Array.from(await reportPDF(await loadRemote()));});await writeFile('test-results/generated-report.pdf',Buffer.from(bytes));assert.equal(Buffer.from(bytes).subarray(0,5).toString(),'%PDF-');
await page.goto('http://127.0.0.1:4174/#notifications');await page.waitForSelector('.notification-item');await page.getByRole('button',{name:'Mark all as read',exact:true}).click();await page.waitForTimeout(500);assert.equal(await page.locator('.notification-item:not(.read)').count(),0);
await page.goto('http://127.0.0.1:4174/#overview');await page.waitForSelector('.welcome-banner');await page.screenshot({path:'test-results/connected-preview.png'});
const accessibility=[];const overflows=[];
for(const route of ['overview','projects','tasks','teams','calendar','timeline','budget','risks','reports','notifications','focus','settings']){
  await page.goto(`http://127.0.0.1:4174/#${route}`);await page.waitForSelector('h1');
  const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  accessibility.push(...result.violations.map(v=>({route,id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})));
  for(const width of [320,768,1024,1440]){await page.setViewportSize({width,height:1000});if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))overflows.push({route,width});}
}
// Return to the project, remove acceptance fixtures, and confirm persistence after a page reload.
await page.goto(`http://127.0.0.1:4174/${projectHash}`);await page.waitForSelector('.project-summary');await page.getByRole('button',{name:'Edit project',exact:true}).click();await page.getByRole('button',{name:'Delete',exact:true}).click();await page.getByRole('button',{name:'Confirm',exact:true}).click();await page.waitForFunction(()=>location.hash==='#projects');await page.reload();await page.waitForSelector('.project-grid');assert.equal(await page.locator('.project-card h3').filter({hasText:'Connected acceptance project'}).count(),0);
await writeFile('test-results/connected-results.json',JSON.stringify({errors,overflows,accessibility,checks:['Admin sign-in','Rich project creation','Assigned task with estimate and checklist','Expense and budget alert','Risk and heatmap score','Milestone completion','Attachment upload','Resource workload','Calendar event','PDF generation','Notification read state','Reload persistence','48 responsive checks','12 axe page audits']},null,2));
console.log(JSON.stringify({errors,overflows,accessibility},null,2));
assert.deepEqual(errors,[]);assert.deepEqual(overflows,[]);assert.deepEqual(accessibility,[]);
await browser.close();
