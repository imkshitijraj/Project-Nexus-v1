import {chromium} from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';

const local='http://127.0.0.1:4173',remote='http://127.0.0.1:4174';
const password='NexusDemo!26';
const profiles=[
  {email:'admin@nexus.test',role:'admin'},
  {email:'manager@nexus.test',role:'manager'},
  {email:'student@nexus.test',role:'member'},
  {email:'member@nexus.test',role:'member'},
  {email:'viewer@nexus.test',role:'viewer'},
];
const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE_PATH?{executablePath:process.env.BROWSER_EXECUTABLE_PATH}:{})});
const results={checks:[],errors:[],accessibility:[],overflows:[],audits:0,responsiveChecks:0};
await mkdir('test-results',{recursive:true});
const watch=page=>{
  page.on('pageerror',error=>results.errors.push(error.message));
  page.on('console',message=>{
    // An absent refresh session and the explicit invalid-login case produce expected 401s.
    if(message.type()==='error'&&!message.text().includes('401'))results.errors.push(message.text());
  });
};
async function openAccount(page){
  if(await page.locator('#account-toggle').getAttribute('aria-expanded')!=='true')await page.locator('#account-toggle').click();
  await page.locator('#account-menu').waitFor({state:'visible'});
}
async function closeAccount(page){
  if(await page.locator('#account-toggle').getAttribute('aria-expanded')==='true'){
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#account-toggle').getAttribute('aria-expanded'),'false');
  }
}
async function signIn(page,profile){
  await page.locator('#auth-form').waitFor();
  await page.locator(`[data-action="demo-profile"][data-profile="${profile.email}"]`).click();
  assert.equal(await page.locator('#auth-email').inputValue(),profile.email);
  assert.equal(await page.locator('#auth-password').inputValue(),password);
  assert.equal(await page.locator('#auth-form').isVisible(),true,'Selecting a demo profile must not sign in automatically.');
  await page.locator('#auth-form button[type="submit"]').click();
  await page.waitForSelector('.welcome-banner');
  assert.equal(await page.locator('#save-status').textContent(),'Saved to your organization');
  const identity=await page.evaluate(async()=>{const {currentUser}=await import('./connection.js');return currentUser();});
  assert.equal(identity.email,profile.email);
  assert.equal(identity.role,profile.role);
}
async function authMode(page,mode){
  const current=await page.locator('#auth-form').getAttribute('data-mode');
  if(current===mode)return;
  if(current!=='login'){
    await page.locator('#main [data-action="auth-login"]').click();
    await page.locator('#auth-form[data-mode="login"]').waitFor();
  }
  if(mode!=='login'){
    await page.locator(`#main [data-action="auth-${mode}"]`).click();
    await page.locator(`#auth-form[data-mode="${mode}"]`).waitFor();
  }
}
async function auditResponsive(page,surface){
  for(const width of [320,768,1440]){
    await page.setViewportSize({width,height:1000});
    results.responsiveChecks++;
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))results.overflows.push({surface,width});
    const dialog=page.locator('#editor[open]');
    if(await dialog.count()){
      if(await dialog.evaluate(el=>el.scrollWidth>el.clientWidth+1))results.overflows.push({surface,width,element:'dialog'});
    }
    const report=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    results.audits++;
    results.accessibility.push(...report.violations.map(v=>({
      surface,width,id:v.id,impact:v.impact,
      nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary})),
    })));
  }
}
try{
  const context=await browser.newContext({viewport:{width:1440,height:1000},colorScheme:'light'});
  const page=await context.newPage();watch(page);
  await page.goto(remote);await page.locator('#auth-form').waitFor();
  assert.equal(await page.locator('[data-action="demo-profile"]').count(),5);
  for(const profile of profiles){
    await page.locator(`[data-action="demo-profile"][data-profile="${profile.email}"]`).click();
    assert.equal(await page.locator('#auth-email').inputValue(),profile.email);
    assert.equal(await page.locator('#auth-password').inputValue(),password);
    assert.equal(await page.locator('#auth-form').getAttribute('data-mode'),'login');
  }
  results.checks.push('Five demo profile choices fill credentials without bypassing authentication');
  assert.equal(await page.locator('#auth-password').getAttribute('type'),'password');
  await page.locator('[data-action="toggle-password"]').click();
  assert.equal(await page.locator('#auth-password').getAttribute('type'),'text');
  await page.locator('[data-action="toggle-password"]').click();
  assert.equal(await page.locator('#auth-password').getAttribute('type'),'password');
  results.checks.push('Password visibility toggle preserves input and accessible control');
  await page.locator('#auth-email').fill('admin@nexus.test');
  await page.locator('#auth-password').fill('WrongPass!26');
  const denied=page.waitForResponse(response=>response.url().endsWith('/api/auth/login')&&response.request().method()==='POST');
  await page.locator('#auth-form button[type="submit"]').click();
  assert.equal((await denied).status(),401);
  await page.locator('#auth-form .form-error').waitFor({state:'visible'});
  assert.match(await page.locator('#auth-form .form-error').textContent(),/incorrect|password/i);
  assert.equal(await page.locator('.welcome-banner').count(),0);
  results.checks.push('Incorrect password fails at the API and keeps the user on sign-in');
  await page.reload();await page.locator('#auth-form').waitFor();

  // Check every recovery/registration mode without submitting account-creation or email requests.
  for(const theme of ['light','dark']){
    await page.evaluate(mode=>window.NexusAppearance.set({mode,accent:'forest'}),theme);
    await authMode(page,'login');
    await auditResponsive(page,`${theme}/login`);
    await page.screenshot({path:`test-results/nexus-login-${theme}.png`,fullPage:true});
    if(theme==='dark'){
      await page.setViewportSize({width:390,height:844});
      await page.screenshot({path:'test-results/nexus-login-mobile.png',fullPage:true});
    }
    for(const mode of ['register','forgot']){
      await authMode(page,mode);
      if(mode==='register')assert.equal(await page.locator('#auth-password').getAttribute('minlength'),'12');
      await auditResponsive(page,`${theme}/${mode}`);
    }
    for(const mode of ['reset','invite']){
      await page.goto(`${remote}/#${mode}/${'a'.repeat(43)}`);
      await page.locator(`#auth-form[data-mode="${mode}"]`).waitFor();
      assert.equal(await page.locator('#auth-password').getAttribute('minlength'),'12');
      await auditResponsive(page,`${theme}/${mode}`);
    }
    await authMode(page,'login');
  }
  results.checks.push('Login, registration, recovery, reset, and invitation layouts in both themes');

  for(const profile of profiles){
    await signIn(page,profile);
    const canCreate=['admin','manager'].includes(profile.role);
    assert.equal(await page.locator('[data-action="new-project"]').first().isVisible(),canCreate);
    const snapshot=await page.evaluate(async()=>{const {loadRemote}=await import('./connection.js');return loadRemote();});
    if(profile.email==='student@nexus.test'){
      assert.ok(snapshot.projects.length>0);
      assert.ok(snapshot.projects.every(project=>project.category==='study'));
      assert.ok(snapshot.tasks.some(task=>task.assignee==='demo-student'));
    }
    await openAccount(page);
    assert.match(await page.locator('#account-menu').textContent(),new RegExp(profile.email.replaceAll('.','\\.')));
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#account-toggle').getAttribute('aria-expanded'),'false');
    assert.equal(await page.locator('#account-toggle').evaluate(el=>el===document.activeElement),true);
    await openAccount(page);
    await page.locator('h1').click();
    assert.equal(await page.locator('#account-toggle').getAttribute('aria-expanded'),'false');
    await openAccount(page);
    await page.locator('#account-menu [data-action="account-switch"]').click();
    await page.locator('#auth-form').waitFor();
    assert.equal(await page.locator('.welcome-banner').count(),0);
    assert.equal(await page.evaluate(async()=>{const {currentUser}=await import('./connection.js');return currentUser();}),null);
  }
  results.checks.push('All five profiles authenticate with their real API roles','Student access is limited to study projects with assigned work','Menu Escape/outside-click behavior and focus return','Switching accounts revokes local access and requires another sign-in');

  await signIn(page,profiles[0]);
  const originalName=await page.evaluate(async()=>{const {loadRemote}=await import('./connection.js');return (await loadRemote()).profile.name;});
  for(const theme of ['light','dark']){
    await page.evaluate(mode=>window.NexusAppearance.set({mode,accent:'forest'}),theme);
    await openAccount(page);
    await auditResponsive(page,`${theme}/account-menu`);
    await page.screenshot({path:`test-results/nexus-account-${theme}.png`,fullPage:true});
    await page.locator('#account-menu [data-action="account-security"]').click();
    await page.locator('#editor[open]').waitFor();
    assert.match(await page.locator('#editor').textContent(),/admin@nexus\.test/);
    assert.match(await page.locator('#editor').textContent(),/Administrator/);
    assert.match(await page.locator('#editor').textContent(),/session/i);
    await auditResponsive(page,`${theme}/account-security`);
    await page.keyboard.press('Escape');
    await openAccount(page);
    await page.locator('#account-menu [data-action="account-profile"]').click();
    await page.locator('#account-profile-form').waitFor();
    await auditResponsive(page,`${theme}/account-profile`);
    await page.keyboard.press('Escape');
  }
  // Profile changes go through the real workspace API and remain escaped in the account disclosure.
  await openAccount(page);
  await page.locator('#account-menu [data-action="account-profile"]').click();
  await page.locator('#account-name').fill('Nexus <profile> review');
  await page.locator('#account-profile-form button[type="submit"]').click();
  await page.waitForFunction(()=>!document.querySelector('#editor').open);
  await page.reload();await page.waitForSelector('.welcome-banner');
  await openAccount(page);
  assert.match(await page.locator('#account-menu').textContent(),/Nexus <profile> review/);
  assert.equal(await page.locator('#account-menu profile').count(),0);
  await page.locator('#account-menu [data-action="account-profile"]').click();
  await page.locator('#account-name').fill(originalName);
  await page.locator('#account-profile-form button[type="submit"]').click();
  await page.waitForFunction(()=>!document.querySelector('#editor').open);
  results.checks.push('Profile editing persists through the API and escapes user-supplied names');

  // Capture the recovery request; never send actual mail from this browser test.
  let resetRequest;
  await page.route('**/api/auth/forgot',route=>{
    resetRequest=route.request().postDataJSON();
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({message:'If an active account exists, a reset link has been sent.'})});
  });
  await openAccount(page);
  await page.locator('#account-menu [data-action="account-security"]').click();
  await page.locator('#editor [data-action="account-reset"]').click();
  await page.waitForFunction(()=>/reset link/i.test(document.querySelector('#account-security-status')?.textContent??''));
  assert.deepEqual(resetRequest,{email:'admin@nexus.test'});
  await page.unroute('**/api/auth/forgot');
  await page.keyboard.press('Escape');
  results.checks.push('Security panel sends a reset request only for the signed-in email');
  await openAccount(page);
  await page.locator('#account-menu [data-action="logout"]').click();
  await page.locator('#auth-form').waitFor();
  await page.reload();await page.locator('#auth-form').waitFor();
  assert.equal(await page.locator('.welcome-banner').count(),0);
  results.checks.push('Sign-out revokes the session across reload');

  // Exercise reset completion while an existing identity/workspace is loaded.
  // The API suite verifies real reset tokens/passwords; avoid modifying demo
  // credentials here, but keep cookie cleanup and subsequent refresh real.
  await signIn(page,profiles[0]);
  await page.route('**/api/auth/reset',route=>route.fulfill({
    status:200,contentType:'application/json',body:JSON.stringify({ok:true}),
  }));
  await page.goto(`${remote}/#reset/${'b'.repeat(43)}`);
  await page.locator('#auth-form[data-mode="reset"]').waitFor();
  await page.locator('#auth-password').fill('ResetCheck!26');
  await page.locator('#auth-form button[type="submit"]').click();
  await page.locator('#auth-form[data-mode="login"]').waitFor();
  await page.waitForFunction(()=>location.hash==='#overview');
  assert.equal(await page.evaluate(async()=>{const {currentUser}=await import('./connection.js');return currentUser();}),null);
  assert.equal(await page.locator('.welcome-banner').count(),0);
  assert.equal(await page.locator('#account-label').textContent(),'Sign in');
  await page.unroute('**/api/auth/reset');
  await page.reload();await page.locator('#auth-form[data-mode="login"]').waitFor();
  assert.equal(await page.locator('.welcome-banner').count(),0);
  results.checks.push('Reset completion while signed in clears identity, cached workspace, and refresh cookie');
  await context.close();

  const localContext=await browser.newContext(),personal=await localContext.newPage();watch(personal);
  await personal.goto(local);await personal.waitForSelector('.welcome-banner');
  await openAccount(personal);
  assert.match(await personal.locator('#account-menu').textContent(),/personal|browser|local/i);
  await personal.locator('#account-menu [data-action="account-signin"]').click();
  await personal.locator('#editor[open]').waitFor();
  assert.match(await personal.locator('#editor').textContent(),/account|sign.in|connect/i);
  assert.equal(await personal.locator('#auth-form').count(),0);
  assert.equal(await personal.locator('input[type="password"]').count(),0);
  results.checks.push('Static mode explains account access without collecting a password or pretending to authenticate');
  await localContext.close();
  assert.deepEqual(results.errors,[]);
  assert.deepEqual(results.overflows,[]);
  assert.deepEqual(results.accessibility,[]);
  console.log(`Accounts passed: ${results.checks.length} behavior groups, ${results.audits} accessibility audits, ${results.responsiveChecks} responsive checks.`);
}finally{
  await writeFile('test-results/account-results.json',JSON.stringify(results,null,2));
  await browser.close();
}
