import { escapeHTML as h } from './model.js';

// Public local-demo identities. The API never seeds these in production.
export const DEMO_PASSWORD = 'NexusDemo!26';
export const DEMO_PROFILES = Object.freeze([
  {id:'admin',email:'admin@nexus.test',label:'Administrator',name:'Demo Administrator',role:'admin',description:'People, permissions, and every project',initials:'AD'},
  {id:'manager',email:'manager@nexus.test',label:'Professional',name:'Alex Morgan',role:'manager',description:'Plan delivery, budgets, and team work',initials:'AM'},
  {id:'student',email:'student@nexus.test',label:'Student',name:'Avery Student',role:'member',description:'Study projects and assigned tasks',initials:'AS'},
  {id:'member',email:'member@nexus.test',label:'Teammate',name:'Sam Patel',role:'member',description:'Assigned work and project updates',initials:'SP'},
  {id:'viewer',email:'viewer@nexus.test',label:'Viewer',name:'Riley Chen',role:'viewer',description:'Project progress and reports',initials:'RC'},
].map(profile=>Object.freeze(profile)));

const shield = `<svg viewBox="0 0 80 88" fill="none" aria-hidden="true" focusable="false"><path d="M40 5 69 16v25c0 19-12 33-29 42C23 74 11 60 11 41V16L40 5Z" stroke="currentColor" stroke-width="2"/><path d="m27 43 9 9 18-21" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M40 14 61 22v18c0 14-8 25-21 33-13-8-21-19-21-33V22L40 14Z" stroke="currentColor" opacity=".2"/></svg>`;
const modes = {
  login:{title:'Welcome back.',description:'Sign in to pick up where you left off.',submit:'Sign in'},
  register:{title:'Make room for better work.',description:'Create your account and a new organization.',submit:'Create organization'},
  forgot:{title:'Let’s get you back in.',description:'Enter your account email. We’ll send a reset link if an active account exists.',submit:'Send reset link'},
  reset:{title:'A fresh start.',description:'Choose a unique password for your account.',submit:'Reset password'},
  invite:{title:'Your team is waiting.',description:'Finish setting up your invited account.',submit:'Accept invitation'},
};

function demoProfiles() {
  return `<section class="auth-demo" aria-labelledby="demo-profiles-title">
    <div class="auth-demo-heading"><h3 id="demo-profiles-title">Try a profile</h3><span class="auth-demo-label">LOCAL DEMO</span></div>
    <p>Choose a profile to fill in its login details, then sign in.</p>
    <div class="auth-demo-profiles">${DEMO_PROFILES.map(profile=>`<button type="button" class="demo-profile" data-action="demo-profile" data-profile="${h(profile.email)}" aria-pressed="false">
      <span class="demo-profile-avatar" aria-hidden="true">${profile.initials}</span>
      <span class="demo-profile-content"><strong>${profile.label}</strong><span>${profile.email}</span><small>${profile.description}</small></span>
      <span class="demo-profile-check" aria-hidden="true">✓</span>
    </button>`).join('')}</div>
    <div class="demo-password"><span>Demo password</span><code>${DEMO_PASSWORD}</code></div>
    <p class="demo-address-note">These are local test accounts, not email inboxes. Use sample data only.</p>
  </section>`;
}

export function renderAuthScreen({mode='login',token='',demoEnabled=false,signOutPending=false}={}) {
  const selected=Object.hasOwn(modes,mode)?mode:'login',copy=modes[selected];
  const newPassword=selected!=='login';
  return `<div class="auth-layout nexus-auth">
    <section class="auth-message auth-story">
      <div class="auth-story-eyebrow"><span class="auth-story-mark" aria-hidden="true">n.</span><span>PROJECT NEXUS<br><small>WORKSPACE ACCESS</small></span></div>
      <h1>Your work.<br>Your people.<br>A clearer way forward.</h1>
      <p>From your next assignment to your next launch, keep your plans and progress in one place.</p>
      <div class="auth-assurance">
        <div class="auth-shield">${shield}</div>
        <div><h2>A space with the right access.</h2><p>Your account connects you to your organization. Your role determines what you can view and change.</p></div>
      </div>
      <ul class="auth-story-points">
        <li><span aria-hidden="true">01</span><div><strong>Start with a plan</strong><p>Projects, milestones, and a clear next step.</p></div></li>
        <li><span aria-hidden="true">02</span><div><strong>Work with your people</strong><p>Responsibilities and permissions that fit each role.</p></div></li>
        <li><span aria-hidden="true">03</span><div><strong>Keep the whole picture</strong><p>Progress, costs, and risks in one workspace.</p></div></li>
      </ul>
      <div class="auth-audiences"><span>For students</span><span>For professionals</span><span>For teams</span></div>
    </section>
    <section class="auth-card auth-entry" aria-labelledby="auth-title">
      <span class="auth-card-eyebrow">${selected==='login'?'YOUR NEXT STEP STARTS HERE':'YOUR ACCOUNT'}</span>
      <h2 id="auth-title">${copy.title}</h2><p class="auth-description">${copy.description}</p>
      <form id="auth-form" data-mode="${selected}" data-token="${h(token)}">
        ${['register','invite'].includes(selected)?'<div class="auth-field"><label for="auth-name">Full name</label><input id="auth-name" name="name" maxlength="60" autocomplete="name" placeholder="Your name" required></div>':''}
        ${selected==='register'?'<div class="auth-field"><label for="auth-org">Organization</label><input id="auth-org" name="organization" maxlength="100" autocomplete="organization" placeholder="Your team or organization" required></div>':''}
        ${['login','register','forgot'].includes(selected)?`<div class="auth-field"><label for="auth-email">Email</label><input id="auth-email" name="email" type="email" maxlength="254" autocomplete="${selected==='login'?'username':'email'}" placeholder="you@example.com" autocapitalize="none" spellcheck="false" required></div>`:''}
        ${selected!=='forgot'?`<div class="auth-field"><div class="auth-password-label"><label for="auth-password">Password</label>${selected==='login'?'<button type="button" class="text-button" data-action="auth-forgot">Forgot password?</button>':''}</div><div class="auth-password-wrap"><input id="auth-password" name="password" type="password" minlength="${newPassword?12:1}" maxlength="72" autocomplete="${newPassword?'new-password':'current-password'}" ${newPassword?'aria-describedby="auth-password-help"':''} required><button type="button" class="password-visibility" data-action="toggle-password" aria-controls="auth-password" aria-pressed="false" aria-label="Show password">Show</button></div>${newPassword?'<p id="auth-password-help" class="auth-password-help">Use at least 12 characters and a password you don’t use elsewhere.</p>':''}</div>`:''}
        <p class="form-error" role="alert" hidden></p>
        <p id="auth-status" class="auth-status" role="status" aria-live="polite"></p>
        <button class="button primary auth-submit" type="submit">${copy.submit}<span aria-hidden="true">↗</span></button>
      </form>
      <div class="auth-links">${selected==='login'?'<p>New to Nexus? <button type="button" data-action="auth-register" class="text-button">Create account</button></p>':'<button type="button" data-action="auth-login" class="text-button">← Back to sign in</button>'}</div>
      ${demoEnabled&&selected==='login'?demoProfiles():''}
      ${signOutPending?'<div class="auth-retry" role="status"><p>This tab is cleared. Reconnect and retry sign out to revoke the server session before leaving a shared device.</p><button type="button" class="button" data-action="logout">Retry sign out</button></div>':''}
      <p class="auth-session-note"><span aria-hidden="true">◇</span>Sign out when you finish on a shared device.</p>
    </section>
  </div>`;
}
