import test from 'node:test';
import assert from 'node:assert/strict';
import {renderAuthScreen,DEMO_PROFILES,DEMO_PASSWORD} from '../auth-ui.js';
import {accountMenu,accountDetails,securityDetails,initials} from '../account-ui.js';

test('public login never advertises demo credentials unless explicitly enabled',()=>{
  const production=renderAuthScreen();
  assert.doesNotMatch(production,/nexus\.test|NexusDemo|data-action="demo-profile"/);
  const demo=renderAuthScreen({demoEnabled:true});
  assert.equal(DEMO_PASSWORD.length,12);
  assert.equal(new Set(DEMO_PROFILES.map(p=>p.email)).size,5);
  for(const profile of DEMO_PROFILES)assert.ok(demo.includes(`data-profile="${profile.email}"`));
  assert.match(demo,/type="button" class="demo-profile"/);
  for(const mode of ['register','reset','invite'])assert.match(renderAuthScreen({mode}),/minlength="12"/);
});
test('account screens escape stored identity and reset/invitation token values',()=>{
  const malicious='<img src=x onerror=alert(1)>';
  const user={id:'one',email:malicious,role:'member'};
  for(const html of [renderAuthScreen({mode:'invite',token:malicious}),accountMenu({connected:true,user,profile:{name:malicious}}),accountDetails({user,profile:{name:malicious},member:{department:malicious}}),securityDetails({connected:true,user,demoEnabled:false})]){
    assert.doesNotMatch(html,/<img src=x/);
    assert.match(html,/&lt;img/);
  }
  assert.equal(initials(' Avery   Student '),'AS');
});
test('local account panels describe access without collecting passwords',()=>{
  const html=securityDetails({connected:false,user:null,demoEnabled:false,localLoginURL:''});
  assert.match(html,/personal workspace|browser/i);
  assert.doesNotMatch(html,/type="password"|id="auth-form"|127\.0\.0\.1/);
  assert.doesNotMatch(accountMenu({connected:false,user:null,profile:{name:'Local'}}),/data-action="logout"|data-action="account-switch"/);
});
