import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';

const local='http://127.0.0.1:4173',remote='http://127.0.0.1:4174';
const routes=['overview','projects','tasks','teams','calendar','timeline','budget','risks','reports','notifications','focus','settings'];
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE_PATH?{executablePath:process.env.BROWSER_EXECUTABLE_PATH}:{})});
const result={errors:[],accessibility:[],overflows:[],audits:0,responsiveChecks:0,checks:[],timings:[]};
await mkdir('test-results',{recursive:true});
const watch=page=>{
  page.on('pageerror',error=>result.errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'&&!message.text().includes('401'))result.errors.push(message.text());});
};
const appearance=(page,mode,accent)=>page.evaluate(({mode,accent})=>window.NexusAppearance.set({mode,accent}),{mode,accent});
async function audit(page,screen){
  const report=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
  result.audits++;
  result.accessibility.push(...report.violations.map(v=>({screen,id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})));
}
try{
  const context=await browser.newContext({viewport:{width:1440,height:1000},colorScheme:'light'});
  const page=await context.newPage();watch(page);
  await page.goto(local);await page.waitForSelector('.welcome-banner');
  assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
  await page.goto(`${local}/#settings`);
  await page.locator('input[name="appearance-mode"][value="dark"]').check();
  await page.locator('input[name="appearance-accent"][value="ocean"]').check();
  await page.reload();await page.waitForSelector('#appearance-status');
  assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  assert.equal(await page.locator('html').getAttribute('data-accent'),'ocean');
  assert.equal(await page.locator('input[name="appearance-mode"][value="dark"]').isChecked(),true);
  await page.locator('#theme-toggle').click();
  assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
  await page.locator('input[name="appearance-mode"][value="system"]').check();
  await page.emulateMedia({colorScheme:'dark'});
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
  await page.emulateMedia({colorScheme:'light'});
  await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
  result.checks.push('UI controls and reload persistence','Quick toggle','Live operating-system preference');
  // Native radio keyboard behavior, without replacing focused elements.
  await page.locator('input[name="appearance-mode"][value="light"]').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('input[name="appearance-mode"][value="dark"]').isChecked(),true);
  assert.equal(await page.locator('input[name="appearance-mode"][value="dark"]').evaluate(el=>el===document.activeElement),true);
  result.checks.push('Keyboard radio selection preserves focus');
  const sibling=await context.newPage();watch(sibling);
  await sibling.goto(`${local}/#settings`);await sibling.waitForSelector('#appearance-status');
  await page.locator('input[name="appearance-accent"][value="violet"]').check();
  await sibling.waitForFunction(()=>document.documentElement.dataset.accent==='violet');
  await sibling.evaluate(()=>localStorage.removeItem('nexus.appearance.v1'));
  await page.waitForFunction(()=>document.documentElement.dataset.themeMode==='system'&&document.documentElement.dataset.accent==='forest');
  await sibling.close();
  result.checks.push('Cross-tab settings update and reset');
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches),true);
  for(const mode of ['light','dark']){
    for(const accent of ['forest','ocean','violet','amber']){
      await appearance(page,mode,accent);
      for(const route of routes){
        const started=performance.now();
        await page.goto(`${local}/#${route}`);await page.waitForSelector('h1');
        result.timings.push({mode,accent,route,ms:Math.round(performance.now()-started)});
        await audit(page,`${mode}/${accent}/${route}`);
        // Every route at all supported widths in both modes; palettes do not alter geometry.
        if(accent==='forest'){
          for(const width of [320,768,1024,1440]){
            await page.setViewportSize({width,height:1000});
            result.responsiveChecks++;
            if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))result.overflows.push({mode,route,width});
          }
        }
      }
      console.log(`Audited ${mode}/${accent}: 12 screens`);
    }
  }
  // Modal form, expanded advanced fields, focus trap, and mobile navigation.
  await appearance(page,'dark','ocean');
  await page.goto(`${local}/#projects`);await page.waitForSelector('.project-grid');
  await page.getByRole('button',{name:'+ New project',exact:true}).click();
  await page.locator('#project-form summary').click();
  await audit(page,'dark/ocean/project-dialog');
  await page.setViewportSize({width:320,height:700});
  assert.equal(await page.locator('#editor').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>document.querySelector('#editor').contains(document.activeElement)),true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#editor').evaluate(el=>el.open),false);
  await page.locator('#menu-toggle').click();
  assert.equal(await page.locator('#menu-toggle').getAttribute('aria-expanded'),'true');
  await page.locator('#navigation').getByRole('link',{name:/My tasks/}).click();
  assert.equal(await page.locator('#menu-toggle').getAttribute('aria-expanded'),'false');
  result.checks.push('Expanded modal and keyboard focus','Narrow-screen modal','Mobile navigation');
  // Appearance must remain usable when storage contains invalid input or is unavailable.
  for(const scenario of ['corrupt','invalid-enums','unavailable']){
    const isolated=await browser.newContext({colorScheme:'dark'});
    await isolated.addInitScript(scenario=>{
      if(scenario==='unavailable')Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Blocked','SecurityError');}});
      else localStorage.setItem('nexus.appearance.v1',scenario==='corrupt'?'{bad':JSON.stringify({version:1,mode:'<script>',accent:'url(javascript:alert(1))'}));
    },scenario);
    const probe=await isolated.newPage();watch(probe);
    await probe.goto(`${local}/#settings`);await probe.waitForSelector('#appearance-status');
    assert.equal(await probe.locator('html').getAttribute('data-theme'),'dark');
    assert.equal(await probe.locator('html').getAttribute('data-accent'),'forest');
    await probe.locator('input[name="appearance-mode"][value="light"]').check();
    assert.equal(await probe.locator('html').getAttribute('data-theme'),'light');
    await isolated.close();
  }
  result.checks.push('Corrupt, invalid, and blocked appearance storage');
  // Real API mode and unauthenticated screens honor the same preference.
  const connected=await browser.newContext({viewport:{width:1440,height:1000},colorScheme:'dark'});
  const account=await connected.newPage();watch(account);
  await account.goto(remote);await account.waitForSelector('#auth-form');
  await audit(account,'dark/forest/sign-in');
  await account.getByLabel('Email',{exact:true}).fill('admin@nexus.test');
  await account.getByLabel('Password',{exact:true}).fill('NexusDemo!26');
  await account.locator('#auth-form').getByRole('button',{name:'Sign in',exact:true}).click();
  await account.waitForSelector('.welcome-banner');
  await account.goto(`${remote}/#settings`);
  await account.locator('input[name="appearance-accent"][value="amber"]').check();
  await account.reload();await account.waitForSelector('#appearance-status');
  assert.equal(await account.locator('html').getAttribute('data-accent'),'amber');
  await audit(account,'dark/amber/connected-settings');
  assert.equal(await account.evaluate(()=>localStorage.getItem('stride.workspace.v1')),null);
  result.checks.push('Connected session restoration retains theme without caching organization data');
  await connected.close();
  await page.setViewportSize({width:1440,height:1000});
  for(const mode of ['light','dark']){
    await appearance(page,mode,'forest');
    await page.goto(`${local}/#overview`);await page.waitForSelector('.welcome-banner');
    await page.screenshot({path:`test-results/nexus-${mode}.png`});
    if(mode==='dark'){
      await page.setViewportSize({width:390,height:844});
      await page.screenshot({path:'test-results/nexus-dark-mobile.png',fullPage:true});
      await page.setViewportSize({width:1440,height:1000});
      await page.goto(`${local}/#settings`);await page.screenshot({path:'test-results/nexus-appearance.png',fullPage:true});
    }
  }
  await writeFile('test-results/appearance-results.json',JSON.stringify(result,null,2));
  assert.deepEqual(result.errors,[]);
  assert.deepEqual(result.overflows,[]);
  assert.deepEqual(result.accessibility,[]);
  console.log(`Appearance passed: ${result.audits} accessibility audits, ${result.responsiveChecks} responsive checks, ${result.checks.length} behavior groups.`);
}finally{
  await writeFile('test-results/appearance-results.json',JSON.stringify(result,null,2));
  await browser.close();
}
