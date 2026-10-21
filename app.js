import { STATUSES, PRIORITIES, COLORS, STORAGE_KEY, dateKey, shiftDate, validateState, seedState, projectProgress, filterTasks, deleteProject, escapeHTML as h } from './model.js';
import { extraViews,managementView,analyticsPanel,projectExtraFields,projectData,taskExtraFields,taskData,projectControls,recordDialog,saveRecord,removeRecord,removeTask,reportPDF,downloadBlob } from './management.js';
import { connected,demoEnabled,currentUser,refresh,signIn,signOut,loadRemote,saveRemote,api } from './connection.js';
import {renderAuthScreen,DEMO_PROFILES,DEMO_PASSWORD} from './auth-ui.js';
import {accountMenu,accountDetails,securityDetails,ROLE_LABELS,initials} from './account-ui.js';

const $ = s => document.querySelector(s);
const appearance = window.NexusAppearance;
function updateAppearanceControls() {
  const value = appearance.get(), toggle = $('#theme-toggle');
  const label = `Switch to ${value.resolved === 'dark' ? 'light' : 'dark'} mode`;
  toggle.setAttribute('aria-label', label);
  toggle.title = `${label} · Appearance options in Settings`;
  toggle.firstElementChild.textContent = value.resolved === 'dark' ? '☀' : '◐';
  for (const input of document.querySelectorAll('[data-appearance]')) input.checked = input.value === value[input.dataset.appearance];
  const hint = $('#appearance-status');
  if (hint) hint.textContent = value.persisted
    ? `Saved for this browser. ${value.mode === 'system' ? `Following your device’s ${value.resolved} appearance.` : 'Applies across your workspaces.'}`
    : 'Applied for this tab. Browser storage is unavailable, so this choice may reset when you reload.';
}
window.addEventListener('nexus:appearance', updateAppearanceControls);
updateAppearanceControls();
let state, storageBlocked = false;
try { const raw = localStorage.getItem(STORAGE_KEY); state = raw ? validateState(JSON.parse(raw)) : seedState(); }
catch { state = seedState(); storageBlocked = true; }
let workspace = 'all', view = 'overview', projectId = '', layout = 'list', projectTab = 'active';
let filters = { query:'', status:'', priority:'', project:'' }, overviewTab = 'upcoming';
let month = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let timer = { minutes:25, remaining:1500, end:0, running:false }, toastTimeout;
let authMode='login',saving=false,booting=connected,draggedTask='',remoteReady=false,connectionError='',signOutPending=false;
const icons = { overview:'▦', projects:'▱', tasks:'☑', calendar:'▦', focus:'◷', settings:'⚙' };
const views = { overview:'Dashboard', projects:'Projects', tasks:'My tasks',teams:'Teams', calendar:'Calendar',timeline:'Timeline',budget:'Budget',risks:'Risks',reports:'Reports',notifications:'Notifications', focus:'Focus room', settings:'Settings' };
const fmt = (d, opts = {month:'short',day:'numeric'}) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined,opts);
const activeProjects = () => state.projects.filter(p => !p.archived && (workspace === 'all' || p.category === workspace));
const scopedTasks = () => { const ids = new Set(activeProjects().map(p => p.id)); return state.tasks.filter(t => ids.has(t.projectId)); };
const projectFor = id => state.projects.find(p => p.id === id);
const btn = (label, action, cls = 'button', extra = '') => `<button class="${cls}" data-action="${action}" ${extra}>${label}</button>`;
const empty = (title, text, action = '') => `<div class="empty"><span class="empty-icon" aria-hidden="true">◇</span><h3>${title}</h3><p>${text}</p>${action}</div>`;
function closeAccountMenu(restoreFocus=false){
  const open=!$('#account-menu').hidden;$('#account-menu').hidden=true;$('#account-toggle').setAttribute('aria-expanded','false');
  if(open&&restoreFocus)$('#account-toggle').focus();
}
function updateAccountUI(){
  const user=connected?currentUser():null;
  $('#workspace option[value="all"]').textContent=connected?'Organization workspace':'Personal workspace';
  $('.workspace-icon').textContent=connected?'N':'S';
  const name=booting?'Opening account':connected?(user&&remoteReady?state.profile.name:'Sign in'):state.profile.name;
  $('#account-avatar').textContent=connected&&!user?'NX':initials(name);
  $('#account-label').textContent=name;
  $('#account-role').textContent=booting?'Please wait':user?ROLE_LABELS[user.role]:connected?'Organization account':'Personal workspace';
  $('#account-toggle').setAttribute('aria-label',`Account menu for ${name}`);
  $('#account-toggle').disabled=booting;
  $('#account-menu').innerHTML=accountMenu({connected,user,profile:user&&!remoteReady?{name:user.name}:state.profile,loading:booting});
  if(user&&remoteReady)$('.profile .avatar').textContent=initials(state.profile.name);
  else $('.profile .avatar').textContent=connected?'NX':initials(state.profile.name);
}
function accountSecurity(){
  closeAccountMenu();
  const localLoginURL=!connected&&['127.0.0.1','localhost'].includes(location.hostname)?'http://127.0.0.1:4174/':'';
  showDialog(`${dialogHead('Security & sign-in','Understand your account access.')} ${securityDetails({connected,user:currentUser(),demoEnabled,localLoginURL})}`);
  dialog.dataset.returnAccount='true';
}
async function endAccountSession({afterReset=false}={}){
  closeAccountMenu();if(dialog.open)dialog.close();
  // A reset has already superseded pending API responses via sessionGeneration.
  // Normal sign-out waits for a save so its result cannot reopen the workspace.
  if(saving&&!afterReset){toast('Wait for your current save to finish, then sign out.');return;}
  try{await signOut();signOutPending=false;}
  catch(error){signOutPending=true;throw error;}
  finally{
    timer.running=false;remoteReady=false;state=seedState();authMode='login';workspace='all';projectId='';
    portfolioFilter={owner:'',department:'',priority:'',status:'',category:'',from:'',to:''};
    $('#workspace').value='all';$('#storage-warning').hidden=true;location.hash='overview';renderAuth();
  }
}
function toast(text) { $('#toast').textContent = text; $('#toast').hidden = false; clearTimeout(toastTimeout); toastTimeout = setTimeout(() => { $('#toast').hidden = true; },4000); }
function warning(text) { $('#storage-warning').textContent = text; $('#storage-warning').hidden = false; }
async function commit(next, message) {
  if(saving){toast('A save is already in progress. Please wait.');return false;}
  saving=true;
  $('#save-status').textContent='Saving…';$('#main').setAttribute('aria-busy','true');
  try {
    let clean = validateState(next);
    if(connected){if(!remoteReady)throw new Error('Organization data has not loaded. Reload the workspace.');clean=validateState(await saveRemote(clean));}
    else{
      if (storageBlocked) throw new Error('Storage needs recovery. Export your work, then use Settings to start fresh or import a backup.');
      const updates=[];for(const key of ['projects','tasks','expenses','risks','milestones','members','resources','events','files'])for(const row of clean[key]){const old=state[key]?.find(x=>x.id===row.id);if(JSON.stringify(old)!==JSON.stringify(row))updates.push(`${old?'Updated':'Created'} ${row.name??row.title??key.slice(0,-1)}`);}
      clean.activity=[...clean.activity,...updates.map(message=>({id:crypto.randomUUID(),message:message.slice(0,300),actor:clean.profile.name,at:new Date().toISOString()}))].slice(-2000);
      clean.notifications=[...clean.notifications,...updates.map(title=>({id:crypto.randomUUID(),title:title.slice(0,200),date:dateKey(),read:false,kind:'updates',recipient:''}))].slice(-2000);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
    }
    state = clean; $('#save-status').textContent = connected?'Saved to your organization':'Saved on this device';
    $('#storage-warning').hidden=true;
    if (message) toast(message); render(); return true;
  } catch (error) {
    // Keep unsaved modal input for correction, but restore immediate controls to saved values.
    for(const select of document.querySelectorAll('.move-task')){
      const task=state.tasks.find(t=>t.id===select.dataset.id);if(task)select.value=task.status;
    }
    for(const input of document.querySelectorAll('.notification-pref'))input.checked=state.preferences[input.dataset.key];
    const message=`Could not save: ${error.message} Your previous saved data is unchanged.`;warning(message);formError(message);return false;
  }
  finally{saving=false;$('#main').removeAttribute('aria-busy');if($('#save-status').textContent==='Saving…')$('#save-status').textContent='Save failed';}
}
function nav(target, id = '') { location.hash = id ? `${target}/${encodeURIComponent(id)}` : target; if (location.hash.slice(1) === target && !id) route(); }
function route() {
  closeAccountMenu();
  const [path, query] = location.hash.slice(1).split('?');
  const [page, id] = path.split('/');
  if(connected&&['reset','invite'].includes(page)){authMode=page;}
  view = Object.hasOwn(views,page) ? page : 'overview';
  try { projectId = page === 'projects' && id ? decodeURIComponent(id) : ''; } catch { projectId = ''; }
  filters = {query:'',status:'',priority:'',project:'',dueOnly:new URLSearchParams(query).get('due') === '1',assignee:connected&&view==='tasks'&&currentUser()?.role==='member'?currentUser().id:''};
  document.body.classList.remove('nav-open'); $('#menu-toggle').setAttribute('aria-expanded','false'); render();
}
function render() {
  document.body.classList.toggle('auth-shell',connected&&(booting||!currentUser()||/^#(reset|invite)\//.test(location.hash)));
  closeAccountMenu();updateAccountUI();
  if(booting){$('#main').innerHTML='<div class="empty"><h1>Opening your workspace…</h1><p>Restoring your secure session.</p></div>';return;}
  if(connected&&(!currentUser()||/^#(reset|invite)\//.test(location.hash))){renderAuth();return;}
  if(connected&&!remoteReady){$('#main').innerHTML=empty('Workspace unavailable',h(connectionError||'Organization data could not be loaded.'),btn('Retry connection','reload-remote','button primary'));return;}
  if(connected&&!saving&&['Signed out','Saved on this device'].includes($('#save-status').textContent))$('#save-status').textContent='Saved to your organization';
  $('#navigation').innerHTML = Object.entries(views).map(([key,label]) => `<a href="#${key}" class="nav-link ${view === key ? 'selected' : ''}" ${view === key ? 'aria-current="page"' : ''}><span class="nav-icon" aria-hidden="true">${icons[key]??({teams:'♧',timeline:'≋',budget:'＄',risks:'◇',reports:'▤',notifications:'♧'}[key])}</span>${label}${key === 'tasks' ? `<span class="nav-count">${scopedTasks().filter(t=>t.status !== 'Done').length}</span>` : ''}</a>`).join('');
  $('#pinned-projects').innerHTML = activeProjects().slice(0,4).map(p => `<a href="#projects/${encodeURIComponent(p.id)}" class="pinned"><span class="project-dot ${p.color}"></span><span>${h(p.name)}</span></a>`).join('') || '<p class="muted small-text">Your projects will appear here.</p>';
  $('#breadcrumb').textContent = projectId ? (projectFor(projectId)?.name ?? 'Project') : views[view];
  $('#profile-name').textContent = state.profile.name;
  document.title = `${projectId ? (projectFor(projectId)?.name ?? 'Project') : views[view]} · Project Nexus`;
  const content = { overview:overviewView, projects:projectsView, tasks:tasksView, calendar:calendarView, focus:focusView, settings:settingsView };
  $('#main').innerHTML = content[view] ? content[view]() : managementView(view,managementScope());
  updateAppearanceControls();
  if(connected&&$('#profile-form'))$('#profile-form').previousElementSibling.textContent='Your name is visible to people in your organization.';
  if(connected){$('.local-note').innerHTML=`<span class="local-indicator"></span><div><strong>Connected organization</strong><p>Server-enforced ${h(currentUser().role)} role.</p></div>`;$('.profile small').textContent=`${currentUser().role} · Secure API`;applyPermissions();}
  if (view === 'focus') updateClock();
  if(view==='settings'&&connected){const panels=document.querySelectorAll('.settings-panel');for(const panel of panels){if(panel.textContent.includes('A clear picture of privacy'))panel.innerHTML='<span class="tag">CONNECTED EDITION</span><h2>Your organization workspace</h2><p>Data is stored by your configured API and PostgreSQL database. The server authorizes every change based on your current role and project memberships. Session access tokens stay in memory; refresh tokens use an HttpOnly cookie.</p><p>Production hosting requires HTTPS, database backups, SMTP for account links, monitoring, and a dedicated API origin allowed by the frontend CSP. Ask your administrator about your organization’s retention policy.</p>';if(panel.classList.contains('danger-zone'))panel.hidden=true;}$('#main').insertAdjacentHTML('beforeend',`<div class="management-section">${btn('Sign out','logout','button danger')}</div>`);}
  if(connected){applyPermissions();if(view==='settings'&&currentUser().role==='admin'){
    $('#main').insertAdjacentHTML('beforeend','<section class="settings-panel management-section"><h2>Organization settings</h2><form id="organization-form"><label for="organization-name">Organization name</label><input id="organization-name" name="name" maxlength="100" required disabled><label for="organization-departments">Departments (comma separated)</label><input id="organization-departments" name="departments" maxlength="8000" disabled><p class="form-error" role="alert" hidden></p><button class="button primary" type="submit" disabled>Save organization</button></form></section>');
    api('/api/organization').then(org=>{const form=$('#organization-form');if(!form)return;form.elements.name.value=org.name;form.elements.departments.value=org.departments.join(', ');for(const el of form.elements)el.disabled=false;}).catch(e=>toast(e.message));
  }}
}
function pageHead(kicker, title, description, action = '') {
  return `<div class="page-head"><div><p class="eyebrow">${kicker}</p><h1>${h(title)}</h1><p class="page-description">${description}</p></div>${action}</div>`;
}
function projectCard(p) {
  const progress = projectProgress(state.tasks,p.id);
  return `<article class="project-card"><div class="project-card-top"><span class="project-symbol ${p.color}" aria-hidden="true">${p.category === 'study' ? '⌑' : '▱'}</span><span class="category">${p.category === 'study' ? 'Study' : 'Work'}</span></div><h3><a href="#projects/${encodeURIComponent(p.id)}">${h(p.name)}</a></h3><p>${h(p.description || 'Every great project starts with a small step.')}</p><div class="progress-label"><span>${progress.done} of ${progress.total} tasks</span><strong>${progress.percent}%</strong></div><progress value="${progress.percent}" max="100" aria-label="${h(p.name)} completion">${progress.percent}%</progress><div class="project-card-bottom"><span>◷ ${fmt(p.due)}</span><span class="text-link">Open project ↗</span></div></article>`;
}
function overviewView() {
  const tasks = scopedTasks(), open = tasks.filter(t=>t.status !== 'Done'), done = tasks.filter(t=>t.status === 'Done');
  const today = dateKey(), due = open.filter(t=>t.due <= today), focusMinutes = state.sessions.filter(s=>s.date === today).reduce((n,s)=>n+s.minutes,0);
  const hour = new Date().getHours(); const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  return pageHead(new Date().toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'}),`${greeting}. Make room for progress.`, 'Your ideas, deadlines, and next steps. All in one place.', btn('+ New project','new-project','button primary')) +
    `<section class="welcome-banner"><div><span class="banner-label">A LITTLE FOCUS GOES A LONG WAY</span><h2>Big plans. Small steps.<br>Your next chapter starts here.</h2><p>Bring your study goals and work projects into a clearer view.</p>${btn('Find your focus <span aria-hidden="true">↗</span>','focus','button banner-button')}</div><div class="banner-art" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="art-card art-back"><span></span><i></i><i></i></div><div class="art-card art-front"><div class="art-check">✓</div><b>One step closer.</b><span>Great things take small steps.</span><div class="art-progress"></div></div><div class="art-spark">✳</div></div></section>` +
    `<section class="stats" aria-label="Workspace summary"><a class="stat" href="#projects"><span class="stat-icon mint">▱</span><div><span>Active projects</span><strong>${activeProjects().length}</strong><small>Space for your big ideas</small></div></a><a class="stat" href="#tasks"><span class="stat-icon blue">☑</span><div><span>Tasks completed</span><strong>${done.length}<em> / ${tasks.length}</em></strong><small>${tasks.length ? Math.round(done.length/tasks.length*100) : 0}% of all your tasks</small></div></a><button class="stat" data-action="due-tasks"><span class="stat-icon peach">◷</span><div><span>Needs your attention</span><strong>${due.length}</strong><small>Due today or overdue</small></div></button><a class="stat" href="#focus"><span class="stat-icon lavender">◴</span><div><span>Focus time today</span><strong>${focusMinutes}<em> min</em></strong><small>Time well invested</small></div></a></section>` +
    `<section class="projects-section"><div class="section-heading"><div><h2>Your projects <span class="count">${activeProjects().length}</span></h2><p>A bird’s-eye view of what you’re building.</p></div><a class="text-link" href="#projects">View all projects <span aria-hidden="true">→</span></a></div><div class="project-grid">${activeProjects().slice(0,4).map(projectCard).join('') || empty('A fresh start','Create your first project and make a little progress.',btn('Create project','new-project','button primary'))}</div></section>` + portfolioFilters() + `<div id="portfolio-analytics">${analyticsPanel(scopedState())}</div>` +
    `<div class="overview-bottom"><section class="task-panel"><div class="section-heading"><h2>Next on your list</h2>${btn('+ Add task','new-task','text-button')}</div><div class="tabs"><button data-action="overview-upcoming" class="tab ${overviewTab === 'upcoming' ? 'active' : ''}">Upcoming <span>${open.length}</span></button><button data-action="overview-done" class="tab ${overviewTab === 'done' ? 'active' : ''}">Completed <span>${done.length}</span></button><a class="text-link push-right" href="#tasks">View all →</a></div>${taskRows((overviewTab === 'done' ? done : filterTasks(open)).slice(0,5),true)}</section><aside class="week-panel"><div class="section-heading"><h2>The week ahead</h2><a class="icon-button" href="#calendar" aria-label="Open calendar">↗</a></div>${weekStrip()}<div class="week-deadlines">${filterTasks(open).filter(t=>t.due >= today).slice(0,3).map(t=>`<button class="deadline" data-action="edit-task" data-id="${h(t.id)}"><span class="date-block"><b>${new Date(t.due+'T12:00:00').getDate()}</b><small>${fmt(t.due,{month:'short'})}</small></span><span><strong>${h(t.title)}</strong><small>${h(projectFor(t.projectId).name)}</small></span></button>`).join('') || '<p class="muted">No upcoming deadlines. Enjoy the breathing room.</p>'}</div></aside></div>`;
}
function weekStrip() {
  const now = new Date(), start = new Date(now); start.setDate(now.getDate() - (now.getDay()+6)%7);
  return `<div class="week-strip">${Array.from({length:7},(_,i)=>{const d=new Date(start);d.setDate(start.getDate()+i);return `<div class="${dateKey(d) === dateKey() ? 'today' : ''}"><small>${d.toLocaleDateString(undefined,{weekday:'short'}).slice(0,1)}</small><b>${d.getDate()}</b></div>`;}).join('')}</div>`;
}
function taskRows(tasks, compact = false) {
  if (!tasks.length) return empty('You’re all clear','No tasks in this view. Add a task or try another filter.');
  return `<div class="task-list ${compact ? 'compact' : ''}">${!compact ? '<div class="task-table-head"><span>Task name</span><span>Project</span><span>Priority</span><span>Due date</span><span>Status</span></div>' : ''}${tasks.map(t=>`<div class="task-row ${t.status === 'Done' ? 'is-done' : ''}"><div class="task-name"><button class="check ${t.status === 'Done' ? 'checked' : ''}" data-action="toggle-task" data-id="${h(t.id)}" aria-label="${t.status === 'Done' ? 'Reopen' : 'Complete'} ${h(t.title)}" aria-pressed="${t.status === 'Done'}">${t.status === 'Done' ? '✓' : ''}</button><button class="task-title" data-action="edit-task" data-id="${h(t.id)}">${h(t.title)}${compact ? `<small><span class="project-dot ${projectFor(t.projectId).color}"></span>${h(projectFor(t.projectId).name)}</small>` : ''}</button></div>${!compact ? `<span class="project-cell">${h(projectFor(t.projectId).name)}</span>` : ''}<span class="priority ${t.priority.toLowerCase()}">${t.priority === 'High' ? '↑' : t.priority === 'Medium' ? '−' : '↓'} ${t.priority}</span><span class="due-date ${t.due < dateKey() && t.status !== 'Done' ? 'overdue' : ''}">${t.due === dateKey() ? 'Today' : fmt(t.due)}${t.due < dateKey() && t.status !== 'Done' ? ' · Overdue' : ''}</span>${!compact ? `<span class="status ${t.status === 'Done' ? 'done' : t.status === 'In progress' ? 'in-progress' : ''}">${t.status}</span>` : ''}</div>`).join('')}</div>`;
}
function projectsView() {
  if (projectId) {
    const p = projectFor(projectId);
    if (!p) return empty('Project not found','It may have been deleted.', '<a class="button primary" href="#projects">Back to projects</a>');
    const progress = projectProgress(state.tasks,p.id);
    return pageHead(`${p.category === 'study' ? 'Student project' : 'Professional project'}${p.archived ? ' · Archived' : ''}`,p.name,h(p.description),`<div class="actions">${btn('Edit project','edit-project','button',`data-id="${h(p.id)}"`)}${btn('+ Add task','new-task','button primary',`data-project="${h(p.id)}"`)}</div>`) + `<div class="project-summary"><span>◷ Due ${fmt(p.due,{year:'numeric',month:'long',day:'numeric'})}</span><span>${progress.done} of ${progress.total} tasks complete</span><strong>${progress.percent}% complete</strong><progress value="${progress.percent}" max="100" aria-label="Project completion"></progress></div>${projectControls(state,p.id)}${taskToolbar(true)}<div id="task-results">${taskResults()}</div>`;
  }
  const projects = state.projects.filter(p=>(workspace === 'all' || p.category === workspace) && (projectTab === 'archived' ? p.archived : !p.archived));
  return pageHead('BUILD SOMETHING THAT MATTERS','Your projects','From semester goals to your next launch. Give every idea a home.',btn('+ New project','new-project','button primary')) + `<div class="tabs spaced">${btn('Active projects','active-projects',`tab ${projectTab === 'active' ? 'active' : ''}`)}${btn('Archived','archived-projects',`tab ${projectTab === 'archived' ? 'active' : ''}`)}</div><div class="project-grid projects-page">${projects.map(projectCard).join('') || empty('Room for your next idea','Create a project to organize your tasks and deadlines.',btn('Create project','new-project','button primary'))}</div>`;
}
function taskToolbar(inProject = false) {
  return `<div class="task-toolbar"><div class="search-field"><span aria-hidden="true">⌕</span><input id="task-search" type="search" placeholder="Search tasks…" aria-label="Search tasks" maxlength="160" value="${h(filters.query)}"><kbd>/</kbd></div><div class="filter-controls">${!inProject ? `<select id="project-filter" aria-label="Filter by project"><option value="">All projects</option>${activeProjects().map(p=>`<option value="${h(p.id)}" ${filters.project===p.id?'selected':''}>${h(p.name)}</option>`).join('')}</select>` : ''}<select id="assignee-filter" aria-label="Filter by assignee"><option value="">All assignees</option>${state.members.map(m=>`<option value="${h(m.id)}" ${filters.assignee===m.id?'selected':''}>${h(m.name)}</option>`).join('')}</select><select id="status-filter" aria-label="Filter by status"><option value="">All statuses</option>${STATUSES.map(s=>`<option ${filters.status===s?'selected':''}>${s}</option>`).join('')}</select><select id="priority-filter" aria-label="Filter by priority"><option value="">All priorities</option>${PRIORITIES.map(s=>`<option ${filters.priority===s?'selected':''}>${s}</option>`).join('')}</select><div class="segmented" aria-label="Task layout">${btn('☷ List','list-view',layout==='list'?'active':'',`aria-pressed="${layout==='list'}"`)}${btn('▥ Board','board-view',layout==='board'?'active':'',`aria-pressed="${layout==='board'}"`)}</div></div></div>`;
}
function tasksView() { return pageHead('ONE STEP AT A TIME','My tasks',filters.dueOnly ? 'Showing incomplete tasks due today or overdue. <a class="text-link" href="#tasks">Show all tasks →</a>' : 'Less juggling. More doing. Find your next small win.',btn('+ Add task','new-task','button primary')) + taskToolbar() + `<div id="task-results">${taskResults()}</div>`; }
function taskResults() {
  const list = projectId ? state.tasks.filter(t=>t.projectId===projectId) : scopedTasks();
  const assigned=filters.assignee?list.filter(t=>t.assignee===filters.assignee):list;
  const tasks = filterTasks(filters.dueOnly ? assigned.filter(t=>t.status !== 'Done' && t.due <= dateKey()) : assigned,{...filters,project:projectId || filters.project});
  if (layout === 'list') return taskRows(tasks);
  return `<div class="board">${STATUSES.map(status=>`<section class="board-column" data-drop-status="${status}"><h2><span class="status-dot ${status==='Done'?'done':status==='In progress'?'in-progress':''}"></span>${status} <span class="count">${tasks.filter(t=>t.status===status).length}</span></h2>${tasks.filter(t=>t.status===status).map(t=>`<article class="board-card" draggable="true" data-task-id="${h(t.id)}"><button class="board-title" data-action="edit-task" data-id="${h(t.id)}">${h(t.title)}</button><p>${h(projectFor(t.projectId).name)}</p><div class="board-meta"><span class="priority ${t.priority.toLowerCase()}">${t.priority}</span><span class="muted">${fmt(t.due)}</span></div><label class="sr-only" for="move-${h(t.id)}">Status for ${h(t.title)}</label><select id="move-${h(t.id)}" class="move-task" data-id="${h(t.id)}">${STATUSES.map(s=>`<option ${s===status?'selected':''}>${s}</option>`).join('')}</select></article>`).join('') || '<p class="board-empty">Nothing here yet.</p>'}${btn('+ Add task','new-task','text-button',`data-status="${status}"`)}</section>`).join('')}</div>`;
}
function calendarView() {
  const first = new Date(month.getFullYear(),month.getMonth(),1), offset = (first.getDay()+6)%7;
  const days = new Date(month.getFullYear(),month.getMonth()+1,0).getDate();
  const cells = Math.ceil((days+offset)/7)*7;
  return pageHead('THE BIGGER PICTURE','Your calendar','A little planning today makes tomorrow feel lighter.',`<div class="actions">${btn('+ Add event','record-new','button','data-kind="events"')}${btn('+ Add task','new-task','button primary')}</div>`) + `<section class="calendar-panel"><div class="calendar-heading"><h2>${month.toLocaleDateString(undefined,{month:'long',year:'numeric'})}</h2><div class="actions">${btn('Today','month-today')}${btn('←','month-prev','icon-button','aria-label="Previous month"')}${btn('→','month-next','icon-button','aria-label="Next month"')}</div></div><div class="calendar-grid">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d=>`<div class="calendar-weekday">${d}</div>`).join('')}${Array.from({length:cells},(_,i)=>{const d=new Date(first);d.setDate(1-offset+i);const key=dateKey(d), outside=d.getMonth()!==month.getMonth(), tasks=filterTasks(scopedTasks().filter(t=>t.due===key));return `<div class="calendar-day ${outside?'outside':''} ${key===dateKey()?'is-today':''}"><button class="day-number" data-action="new-task" data-date="${key}" aria-label="Add task for ${fmt(key,{month:'long',day:'numeric',year:'numeric'})}">${d.getDate()}</button>${tasks.slice(0,3).map(t=>`<button class="calendar-task ${projectFor(t.projectId).color} ${t.status==='Done'?'completed':''}" data-action="edit-task" data-id="${h(t.id)}" title="${h(t.title)}">${t.status==='Done'?'✓ ':''}${h(t.title)}</button>`).join('')}${state.milestones.filter(m=>m.due===key).map(m=>`<button class="calendar-task mint" data-action="record-edit" data-kind="milestones" data-id="${h(m.id)}" title="Milestone: ${h(m.title)}">◇ ${h(m.title)}</button>`).join('')}${state.events.filter(e=>e.date===key).map(e=>`<button class="calendar-task lavender" data-action="record-edit" data-kind="events" data-id="${h(e.id)}" title="${e.type}: ${h(e.title)}">${h(e.type)}: ${h(e.title)}</button>`).join('')}${tasks.length>3?btn(`+${tasks.length-3} more`,'day-tasks','text-button',`data-date="${key}"`):''}</div>`;}).join('')}</div></section>`;
}
function focusView() {
  const sessions = state.sessions.filter(s=>s.date===dateKey()), minutes=sessions.reduce((sum,s)=>sum+s.minutes,0);
  return pageHead('DO ONE THING WELL','Find your focus','Close the extra tabs. Give one thing your full attention.') + `<div class="focus-layout"><section class="focus-card"><span class="focus-leaf" aria-hidden="true">✳</span><h2>A little uninterrupted time.</h2><p>Pick a session length, settle in, and start.</p><div class="segmented duration-controls">${[15,25,50].map(n=>btn(`${n} min`,'timer-duration',timer.minutes===n?'active':'',`data-minutes="${n}" ${timer.running?'disabled':''}`)).join('')}</div><div class="timer-dial"><span id="timer-display" role="timer" aria-label="Time remaining"></span><small id="timer-caption">${timer.running?'You’ve got this. Keep going.':'Ready when you are.'}</small></div><div class="actions timer-actions">${btn(timer.running?'Pause session':'Start session','timer-toggle','button primary', 'id="timer-toggle"')}${btn('Reset','timer-reset')}</div><p class="focus-hint">Keep this tab open. Sessions are recorded when the timer finishes.</p></section><aside class="focus-aside"><h2>Your focus, today</h2><div class="focus-total">${minutes}<small>minutes of dedicated time</small></div><div class="session-count">${sessions.length} completed ${sessions.length===1?'session':'sessions'}</div><hr><h3>Make space for good work.</h3><ul><li>Choose one specific task.</li><li>Put your phone out of reach.</li><li>Take a short break afterward.</li></ul><div class="quiet-note">Progress isn’t always loud.<br>Sometimes it’s just showing up.</div></aside></div>`;
}
function appearancePanel() {
  const value = appearance.get();
  const modeOptions = [['light','☀','Light','Bright and clear'],['dark','◐','Dark','Easy on the eyes'],['system','▣','System','Follow your device']];
  const accentOptions = [['forest','Forest'],['ocean','Ocean'],['violet','Violet'],['amber','Amber']];
  return `<section class="settings-panel wide appearance-panel" aria-labelledby="appearance-heading"><div class="appearance-heading"><div><h2 id="appearance-heading">Make yourself at home</h2><p>Choose a look that helps you focus. Changes apply immediately.</p></div><span class="tag">APPEARANCE</span></div><fieldset class="appearance-fieldset"><legend>Color mode</legend><div class="theme-options">${modeOptions.map(([key,icon,label,description])=>`<label class="theme-option"><input type="radio" name="appearance-mode" data-appearance="mode" value="${key}" ${value.mode===key?'checked':''}><span class="theme-choice"><span class="theme-preview preview-${key}" aria-hidden="true"><span class="preview-sidebar"></span><span class="preview-content"><i></i><i></i><i></i></span><span class="preview-icon">${icon}</span></span><strong>${label}<span class="choice-check" aria-hidden="true">✓</span></strong><small>${description}</small></span></label>`).join('')}</div></fieldset><fieldset class="appearance-fieldset accent-fieldset"><legend>Accent color</legend><p class="field-help">Your accent highlights actions and navigation. Status and risk colors keep their meaning.</p><div class="accent-options">${accentOptions.map(([key,label])=>`<label class="accent-option"><input type="radio" name="appearance-accent" data-appearance="accent" value="${key}" ${value.accent===key?'checked':''}><span class="accent-choice"><span class="accent-swatch swatch-${key}" aria-hidden="true">✓</span><span>${label}</span></span></label>`).join('')}</div></fieldset><p id="appearance-status" class="appearance-status" role="status" aria-live="polite"></p></section>`;
}
function settingsView() {
  return pageHead('MAKE IT YOURS','Workspace settings','A workspace that fits the way you work.') + `<div class="settings-grid">${appearancePanel()}<section class="settings-panel"><h2>Your profile</h2><p>This name is stored only on this device.</p><form id="profile-form"><label for="display-name">Display name</label><input id="display-name" name="name" value="${h(state.profile.name)}" maxlength="60" required><button class="button primary" type="submit">Save profile</button></form></section><section class="settings-panel"><h2>Your data, in your hands</h2><p>Export a backup regularly. Importing replaces your current workspace after confirmation.</p><div class="actions">${btn('↓ Export backup','export')}${btn('↑ Import backup','import')}</div><p class="small-text muted">${state.projects.length} projects · ${state.tasks.length} tasks · ${state.sessions.length} focus sessions</p></section><section class="settings-panel wide"><span class="tag">LOCAL-FIRST EDITION</span><h2>A clear picture of privacy</h2><p>Your projects stay in this browser’s local storage. Project Nexus sends no app data over the network and includes no analytics, tracking, third-party scripts, or login forms.</p><p>This is a personal workspace. Data is not encrypted, does not sync across devices, and can be lost if browser storage is cleared. Anyone with access to your browser profile, or other scripts hosted on the same origin, may access it. Use a dedicated origin for private work and keep sensitive information out of this edition.</p><p>Shared accounts, team roles, cloud backups, and audited access controls require a secured backend. They are not part of this static edition.</p></section><section class="settings-panel wide danger-zone"><h2>Start a new chapter</h2><p>These actions replace your local workspace. Export a backup first.</p><div class="actions">${btn('Start with an empty workspace','clear-data','button danger')}${btn('Restore example projects','demo-data')}</div></section></div>`;
}
const dialog = $('#editor');
function showDialog(content) {
  $('#dialog-content').innerHTML = content;if(!dialog.open)dialog.showModal();
  if(connected){
    applyPermissions();const role=currentUser()?.role,taskForm=$('#task-form'),recordForm=$('#record-form');
    if(taskForm&&['member','viewer'].includes(role)){
      const assigned=state.tasks.find(t=>t.id===taskForm.dataset.id)?.assignee===currentUser().id;
      for(const input of taskForm.querySelectorAll('input,select,textarea'))if(role==='viewer'||!assigned||!['task-status','task-notes','field-checklist','field-newComment'].includes(input.id))input.disabled=true;
      if(role==='viewer'||!assigned)taskForm.querySelector('button[type="submit"]').hidden=true;
    }
    if(recordForm&&role==='member'&&recordForm.dataset.kind==='risks')for(const input of recordForm.querySelectorAll('input,select,textarea'))if(!['field-mitigation','field-status','field-progress'].includes(input.id))input.disabled=true;
  }
}
const dialogHead = (title, subtitle = '') => `<div class="dialog-head"><div><h2 id="dialog-title">${title}</h2>${subtitle?`<p>${subtitle}</p>`:''}</div>${btn('×','close-dialog','icon-button','aria-label="Close dialog"')}</div>`;
function projectEditor(id = '') {
  if(connected&&!['admin','manager'].includes(currentUser()?.role)){toast('A project manager can edit project plans.');return;}
  const p = projectFor(id), value = p || {name:'',description:'',category:workspace==='study'?'study':'work',color:'mint',due:shiftDate(14)};
  showDialog(`${dialogHead(p?'Edit project':'Make room for a new idea','A name, a goal, and a first step.')}<form id="project-form" data-id="${h(id)}"><label for="project-name">Project name</label><input id="project-name" name="name" value="${h(value.name)}" placeholder="e.g. Final year research" maxlength="80" required autofocus><label for="project-description">What are you working toward?</label><textarea id="project-description" name="description" maxlength="500" rows="3" placeholder="A little context goes a long way.">${h(value.description)}</textarea><div class="form-row"><div><label for="project-category">Workspace</label><select id="project-category" name="category"><option value="study" ${value.category==='study'?'selected':''}>Study</option><option value="work" ${value.category==='work'?'selected':''}>Work</option></select></div><div><label for="project-due">Target date</label><input type="date" id="project-due" name="due" value="${value.due}" required></div></div><label for="project-color">Project color</label><select id="project-color" name="color">${COLORS.map(c=>`<option value="${c}" ${value.color===c?'selected':''}>${c[0].toUpperCase()+c.slice(1)}</option>`).join('')}</select>${projectExtraFields(state,p)}<p class="form-error" role="alert" hidden></p><div class="dialog-footer">${p?btn('Delete','delete-project','text-button danger',`data-id="${h(id)}"`):''}${p?btn(p.archived?'Unarchive':'Archive','archive-project','text-button',`data-id="${h(id)}"`):''}${btn('Cancel','close-dialog')}<button class="button primary" type="submit">${p?'Save changes':'Create project'}</button></div></form>`);
}
function refreshTaskAssignees(project, selected = '') {
  const members = state.members.filter(member => (member.active || member.id === selected) && (project?.owner === member.id || project?.members.includes(member.id)));
  $('#field-assignee').innerHTML = '<option value="">Unassigned</option>' + members.map(member => `<option value="${h(member.id)}" ${member.id===selected?'selected':''}>${h(member.name)}${member.active?'':' (inactive)'}</option>`).join('');
}
function taskEditor(id = '', options = {}) {
  if(!id&&connected&&!['admin','manager'].includes(currentUser()?.role)){toast('A project manager can create tasks.');return;}
  if (!state.projects.length) { toast('Create a project first to give your task a home.'); projectEditor(); return; }
  const t = state.tasks.find(t=>t.id===id), p = options.project || projectId || activeProjects()[0]?.id || state.projects[0].id;
  const value = t || {title:'',projectId:p,status:options.status || 'Backlog',priority:'Medium',due:options.date || dateKey(),notes:''};
  showDialog(`${dialogHead(t?'Task details':'One small step','Give your next action a clear home.')}<form id="task-form" data-id="${h(id)}"><label for="task-title">Task name</label><input id="task-title" name="title" value="${h(value.title)}" placeholder="What needs to get done?" maxlength="160" required autofocus><label for="task-project">Project</label><select id="task-project" name="projectId">${state.projects.map(p=>`<option value="${h(p.id)}" ${value.projectId===p.id?'selected':''}>${h(p.name)}${p.archived?' (archived)':''}</option>`).join('')}</select><div class="form-row"><div><label for="task-status">Status</label><select id="task-status" name="status">${STATUSES.map(s=>`<option ${s===value.status?'selected':''}>${s}</option>`).join('')}</select></div><div><label for="task-priority">Priority</label><select id="task-priority" name="priority">${PRIORITIES.map(s=>`<option ${s===value.priority?'selected':''}>${s}</option>`).join('')}</select></div></div><label for="task-due">Due date</label><input id="task-due" type="date" name="due" value="${value.due}" required><label for="task-notes">Notes <span class="muted">(optional)</span></label><textarea id="task-notes" name="notes" maxlength="2000" rows="3" placeholder="Details, thoughts, or a helpful reminder.">${h(value.notes)}</textarea>${taskExtraFields(state,t,value.projectId)}<p class="form-error" role="alert" hidden></p><div class="dialog-footer">${t?btn('Delete task','delete-task','text-button danger',`data-id="${h(id)}"`):''}${btn('Cancel','close-dialog')}<button class="button primary" type="submit">${t?'Save changes':'Create task'}</button></div></form>`);
  refreshTaskAssignees(projectFor(value.projectId), value.assignee);
}
let confirmation = null;
function confirmAction(title, description, callback) { confirmation=callback; showDialog(`${dialogHead(title)}<p class="confirm-description">${h(description)}</p><div class="dialog-footer">${btn('Cancel','close-dialog')}${btn('Confirm','confirm-action','button danger-solid')}</div>`); }
function formError(message) { const node=$('.form-error'); if(node){node.textContent=message;node.hidden=false;}else toast(message); }
document.addEventListener('submit', async event => {
  const form = event.target; if(!['project-form','task-form','profile-form','account-profile-form','record-form','auth-form','invite-form','user-form','organization-form'].includes(form.id)) return; event.preventDefault();
  if(['auth-form','invite-form','user-form','organization-form'].includes(form.id)){await accountSubmit(form);return;}
  if(form.id==='record-form'){try{if(await commit(saveRecord(form,state),'Record saved.'))dialog.close();}catch(e){formError(e.message);}return;}
  const data=Object.fromEntries(new FormData(form)), id=form.dataset.id;
  if(['profile-form','account-profile-form'].includes(form.id)) { if(await commit({...state,profile:{name:data.name}},'Profile saved.')&&form.id==='account-profile-form')dialog.close(); return; }
  try {
    if (form.id === 'project-form') {
      const p = {...projectData(data,form,projectFor(id)),...data,id:id || crypto.randomUUID(),archived:projectFor(id)?.archived || false};
      Object.assign(p,projectData(data,form,p));
      const next={...state,projects:id?state.projects.map(x=>x.id===id?p:x):[...state.projects,p]}; validateState(next);
      if(await commit(next,id?'Project updated.':'A new idea has a home.')) {dialog.close(); if(workspace!=='all'&&workspace!==p.category){workspace=p.category;$('#workspace').value=workspace;} nav('projects',p.id);}
    } else {
      const old=state.tasks.find(t=>t.id===id);let t={...old,...data,...taskData(data,form,old,currentUser()?.id??'local-user'),id:id || crypto.randomUUID()};
      if(connected&&currentUser().role==='member'&&old)t={...old,status:data.status,notes:data.notes,checklist:t.checklist,comments:t.comments,completedAt:t.completedAt,history:t.history}; const next={...state,tasks:id?state.tasks.map(x=>x.id===id?t:x):[...state.tasks,t]}; validateState(next);
      if(await commit(next,id?'Task updated.':'Your next step is ready.')) dialog.close();
    }
  } catch(error) {formError(error.message);}
});
document.addEventListener('click', async event => {
  const el=event.target.closest('[data-action]'); if(!el) return;
  const id=el.dataset.id, action=el.dataset.action;
  if(el.closest('#account-menu'))closeAccountMenu();
  switch(action) {
    case 'account-profile': {
      if(connected&&(!currentUser()||!remoteReady)){authMode='login';renderAuth();break;}
      showDialog(`${dialogHead('My profile','A little about you.')} ${accountDetails({user:currentUser(),profile:state.profile,member:state.members.find(m=>m.id===currentUser()?.id)})}`);dialog.dataset.returnAccount='true';break;
    }
    case 'account-security': accountSecurity();break;
    case 'account-appearance': nav('settings');setTimeout(()=>$('#appearance-status')?.scrollIntoView({block:'center'}),0);break;
    case 'account-signin': if(connected){if(dialog.open)dialog.close();authMode='login';location.hash='overview';renderAuth();}else accountSecurity();break;
    case 'account-register': if(connected){authMode='register';location.hash='overview';renderAuth();}break;
    case 'demo-profile': {
      if(!demoEnabled||authMode!=='login'||$('#auth-form button[type="submit"]')?.disabled)break;
      const selected=DEMO_PROFILES.find(profile=>profile.email===el.dataset.profile);if(!selected)break;
      $('#auth-email').value=selected.email;$('#auth-password').value=DEMO_PASSWORD;
      for(const button of document.querySelectorAll('[data-action="demo-profile"]'))button.setAttribute('aria-pressed',String(button===el));
      $('#auth-form .form-error').hidden=true;$('#auth-form button[type="submit"]').focus();break;
    }
    case 'toggle-password': {
      const input=$('#auth-password');if(!input)break;const show=input.type==='password';input.type=show?'text':'password';
      el.setAttribute('aria-pressed',String(show));el.setAttribute('aria-label',show?'Hide password':'Show password');el.textContent=show?'Hide':'Show';break;
    }
    case 'toggle-theme': appearance.set({mode:appearance.get().resolved==='dark'?'light':'dark'}); break;
    case 'new-project': projectEditor(); break;
    case 'edit-project': projectEditor(id); break;
    case 'new-task': taskEditor('',{project:el.dataset.project,status:el.dataset.status,date:el.dataset.date}); break;
    case 'edit-task': taskEditor(id); break;
    case 'close-dialog': dialog.close(); break;
    case 'confirm-action': {const callback=confirmation;confirmation=null;await callback?.();break;}
    case 'focus': case 'settings': nav(action); break;
    case 'toggle-task': commit({...state,tasks:state.tasks.map(t=>t.id===id?{...t,status:t.status==='Done'?'Backlog':'Done',completedAt:t.status==='Done'?'':dateKey(),history:[...t.history,{date:dateKey(),status:t.status==='Done'?'Backlog':'Done'}].slice(-200)}:t)},'Task updated.'); break;
    case 'delete-task': confirmAction('Delete this task?','This task will be permanently removed from your workspace.',async()=>{if(await commit(removeTask(state,id),'Task deleted.'))dialog.close();}); break;
    case 'delete-project': confirmAction('Delete this project?','The project and all its tasks will be permanently removed. Export a backup first if you need them.',async()=>{if(await commit(deleteProject(state,id),'Project deleted.')){dialog.close();nav('projects');}}); break;
    case 'archive-project': if(await commit({...state,projects:state.projects.map(p=>p.id===id?{...p,archived:!p.archived}:p)},'Project updated.')) dialog.close(); break;
    case 'active-projects': case 'archived-projects': projectTab=action==='active-projects'?'active':'archived'; render(); break;
    case 'overview-upcoming': case 'overview-done': overviewTab=action==='overview-done'?'done':'upcoming'; render(); break;
    case 'list-view': case 'board-view': layout=action==='list-view'?'list':'board'; render(); break;
    case 'due-tasks': nav('tasks?due=1'); break;
    case 'day-tasks': showDialog(`${dialogHead(`Tasks for ${fmt(el.dataset.date)}`)}${taskRows(scopedTasks().filter(t=>t.due===el.dataset.date),true)}`); break;
    case 'month-prev': month=new Date(month.getFullYear(),month.getMonth()-1,1); render(); break;
    case 'month-next': month=new Date(month.getFullYear(),month.getMonth()+1,1); render(); break;
    case 'month-today': month=new Date(new Date().getFullYear(),new Date().getMonth(),1); render(); break;
    case 'timer-duration': timer={minutes:Number(el.dataset.minutes),remaining:Number(el.dataset.minutes)*60,end:0,running:false}; render(); break;
    case 'timer-toggle': if(timer.running){timer.remaining=Math.max(0,Math.ceil((timer.end-Date.now())/1000));timer.running=false;}else{timer.end=Date.now()+timer.remaining*1000;timer.running=true;} render(); break;
    case 'timer-reset': timer.remaining=timer.minutes*60;timer.running=false;timer.end=0;render();break;
    case 'export': exportBackup(); break;
    case 'import': $('#import-file').click(); break;
    case 'clear-data': case 'demo-data': confirmAction(action==='clear-data'?'Start with a clean slate?':'Restore example projects?','This replaces all projects, tasks, and focus history on this browser. Download a backup before continuing.',async()=>{
      const next=action==='demo-data'?seedState():{version:1,profile:state.profile,projects:[],tasks:[],sessions:[]};
      storageBlocked=false;if(await commit(next,'Your workspace is ready.')){ $('#storage-warning').hidden=true;dialog.close();nav('overview'); }
    }); break;
    default: await managementAction(action,el); break;
    case 'help': showDialog(`${dialogHead('A little help goes a long way')}<div class="help-content"><h3>Your everyday shortcuts</h3><p><kbd>N</kbd> Create a task · <kbd>P</kbd> Create a project</p><p><kbd>/</kbd> Search tasks · <kbd>Esc</kbd> Close a dialog</p><h3>Make it your workspace</h3><p>Use the workspace selector to switch between study, work, or everything. Open a project to manage its tasks; use Board view to move work between statuses.</p><h3>Keep your work safe</h3><p>Your data lives in this browser. Export a backup in Settings to move devices or protect against cleared browser storage. Example projects are provided on your first visit; use Settings to start empty.</p></div>`); break;
  }
});
document.addEventListener('click',event=>{
  if(connected&&event.target.closest('[data-action="help"]')){
    const note=$('.help-content p:last-child');if(note)note.textContent='Your organization data is stored by the connected API. Export only to a trusted device and follow your organization’s data policy. Sign out when you finish on a shared device.';
  }
});
document.addEventListener('input', e=>{if(e.target.id==='task-search'){filters.query=e.target.value;$('#task-results').innerHTML=taskResults();}});
document.addEventListener('change',async e=>{
  const el=e.target;
  if(el.dataset.appearance){appearance.set({[el.dataset.appearance]:el.value});return;}
  if(el.id==='workspace'){workspace=el.value;projectId='';if(view==='projects')nav('projects');else render();}
  if(el.id==='task-project'){const form=$('#task-form'),id=form.dataset.id;const siblings=state.tasks.filter(t=>t.projectId===el.value&&t.id!==id);refreshTaskAssignees(projectFor(el.value),$('#field-assignee').value);$('#field-parentId').innerHTML='<option value="">No parent task</option>'+siblings.map(t=>`<option value="${h(t.id)}">${h(t.title)}</option>`).join('');$('#field-dependencies').innerHTML=siblings.map(t=>`<option value="${h(t.id)}">${h(t.title)}</option>`).join('');}
  const field={'assignee-filter':'assignee','project-filter':'project','status-filter':'status','priority-filter':'priority'}[el.id];
  if(field){filters[field]=el.value;$('#task-results').innerHTML=taskResults();}
  if(el.classList.contains('move-task'))await commit({...state,tasks:state.tasks.map(t=>t.id===el.dataset.id?{...t,status:el.value,completedAt:el.value==='Done'?dateKey():'',history:[...t.history,{date:dateKey(),status:el.value}].slice(-200)}:t)},'Task moved.');
});
$('#menu-toggle').addEventListener('click',()=>{document.body.classList.toggle('nav-open');$('#menu-toggle').setAttribute('aria-expanded',document.body.classList.contains('nav-open'));});
$('#account-toggle').addEventListener('click',()=>{
  if($('#account-menu').hidden){updateAccountUI();$('#account-menu').hidden=false;$('#account-toggle').setAttribute('aria-expanded','true');}
  else closeAccountMenu();
});
document.addEventListener('click',event=>{if(!event.target.closest('.account-control'))closeAccountMenu();});
document.addEventListener('focusin',event=>{if(!event.target.closest('.account-control'))closeAccountMenu();});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&!$('#account-menu').hidden){event.preventDefault();closeAccountMenu(true);}
  if(event.key==='ArrowDown'&&event.target.id==='account-toggle'){event.preventDefault();if($('#account-menu').hidden)$('#account-toggle').click();$('#account-menu button')?.focus();}
});
document.addEventListener('input',event=>{
  if(['auth-email','auth-password'].includes(event.target.id)){
    for(const button of document.querySelectorAll('[data-action="demo-profile"]'))button.setAttribute('aria-pressed','false');
  }
});
document.addEventListener('keydown',e=>{
  if(dialog.open || e.ctrlKey || e.metaKey || e.altKey || ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName))return;
  if(connected&&(!currentUser()||!remoteReady))return;
  const canCreate=!connected||['admin','manager'].includes(currentUser()?.role);
  if(e.key.toLowerCase()==='n'&&canCreate){e.preventDefault();taskEditor();}
  if(e.key.toLowerCase()==='p'&&canCreate){e.preventDefault();projectEditor();}
  if(e.key==='/'){e.preventDefault();if(!$('#task-search'))nav('tasks');setTimeout(()=>$('#task-search')?.focus(),0);}
});
function exportBackup(){
  const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}), url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=`nexus-backup-${dateKey()}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);toast('Backup export started. Keep the file somewhere safe.');
}
$('#import-file').addEventListener('change',async e=>{
  const file=e.target.files[0];e.target.value='';if(!file)return;
  try {
    if(file.size>24_000_000)throw new Error('Backup exceeds the 24 MB size limit.');
    const imported=validateState(JSON.parse(await file.text()));
    confirmAction('Replace your workspace?',`Import ${imported.projects.length} projects and ${imported.tasks.length} tasks? Your current workspace will be replaced.`,async()=>{storageBlocked=false;if(await commit(imported,'Backup restored.')){$('#storage-warning').hidden=true;dialog.close();nav('overview');}});
  }catch(error){toast(`Import failed: ${error.message}`);}
});
function updateClock(){const el=$('#timer-display');if(el)el.textContent=`${String(Math.floor(timer.remaining/60)).padStart(2,'0')}:${String(timer.remaining%60).padStart(2,'0')}`;}
setInterval(async()=>{
  if(!timer.running)return;
  timer.remaining=Math.max(0,Math.ceil((timer.end-Date.now())/1000));
  if(timer.remaining===0){timer.running=false;const next={...state,sessions:[...state.sessions,{date:dateKey(),minutes:timer.minutes}]};if(await commit(next,'Focus session complete. Take a well-earned break.')){timer.remaining=timer.minutes*60;render();}}
  updateClock();
},500);
window.addEventListener('hashchange',route);
window.addEventListener('storage',e=>{
  if(connected)return;
  if(e.key!==STORAGE_KEY)return;
  if(dialog.open){storageBlocked=true;warning('Your workspace changed in another tab. Close this editor and reload before saving to avoid overwriting that change.');return;}
  try{if(e.newValue){state=validateState(JSON.parse(e.newValue));render();toast('Workspace updated from another tab.');}else{storageBlocked=true;warning('Saved data was removed in another tab. Export a backup or reload before making changes.');}}catch{storageBlocked=true;warning('Another tab saved unreadable data. Reload or restore a valid backup.');}
});
let portfolioFilter={owner:'',department:'',priority:'',status:'',category:'',from:'',to:''};
function scopedState(){
  const projects=activeProjects().filter(p=>(!portfolioFilter.owner||p.owner===portfolioFilter.owner)&&(!portfolioFilter.department||p.department===portfolioFilter.department)&&(!portfolioFilter.priority||p.priority===portfolioFilter.priority)&&(!portfolioFilter.status||p.status===portfolioFilter.status)&&(!portfolioFilter.category||p.category===portfolioFilter.category)&&(!portfolioFilter.from||p.due>=portfolioFilter.from)&&(!portfolioFilter.to||p.start<=portfolioFilter.to));
  const ids=new Set(projects.map(p=>p.id));return {...state,projects,tasks:state.tasks.filter(t=>ids.has(t.projectId)),expenses:state.expenses.filter(e=>ids.has(e.projectId)),risks:state.risks.filter(r=>ids.has(r.projectId)),milestones:state.milestones.filter(m=>ids.has(m.projectId))};
}
function managementScope(){
  if(workspace==='all')return state;
  const projects=state.projects.filter(p=>p.category===workspace),ids=new Set(projects.map(p=>p.id)),s={...state,projects};
  for(const key of ['tasks','expenses','risks','milestones','files'])s[key]=state[key].filter(r=>ids.has(r.projectId));
  s.resources=state.resources.filter(r=>!r.projectId||ids.has(r.projectId));return s;
}
function portfolioFilters(){
  const options=(values,selected)=>values.map(x=>{const [id,label]=Array.isArray(x)?x:[x,x];return `<option value="${h(id)}" ${selected===id?'selected':''}>${h(label)}</option>`;}).join('');
  return `<div class="portfolio-filters" aria-label="Portfolio filters"><span>Portfolio filters</span>${[['owner','Owner',state.members.map(m=>[m.id,m.name])],['department','Department',[...new Set(state.projects.map(p=>p.department).filter(Boolean))]],['priority','Priority',PRIORITIES],['status','Status',['Planning','Active','On hold','Completed']],['category','Category',[['study','Study'],['work','Work']]]].map(([key,label,values])=>`<select data-portfolio="${key}" aria-label="Portfolio ${label.toLowerCase()}"><option value="">All ${label.toLowerCase()}s</option>${options(values,portfolioFilter[key])}</select>`).join('')}<label>From <input type="date" data-portfolio="from" value="${portfolioFilter.from}" aria-label="Portfolio date from"></label><label>To <input type="date" data-portfolio="to" value="${portfolioFilter.to}" aria-label="Portfolio date to"></label>${btn('Reset','portfolio-reset','text-button')}</div>`;
}
function applyPermissions(){
  const role=currentUser()?.role;if(!role||role==='admin')return;
  for(const el of document.querySelectorAll('[data-action="invite-user"],[data-action="manage-user"]'))el.hidden=true;
  if(role==='manager')return;
  const restricted=['new-project','edit-project','delete-project','archive-project','new-task','record-new','record-delete','invite-user','manage-user','file-remove','clear-data','demo-data','import','milestone-toggle'];
  for(const el of document.querySelectorAll('[data-action]')){
    if(restricted.includes(el.dataset.action))el.hidden=true;
    if(el.dataset.action==='record-edit'&&!(role==='member'&&el.dataset.kind==='risks'&&state.risks.find(r=>r.id===el.dataset.id)?.owner===currentUser().id))el.hidden=true;
    if(['toggle-task'].includes(el.dataset.action)&&(role==='viewer'||state.tasks.find(t=>t.id===el.dataset.id)?.assignee!==currentUser().id))el.disabled=true;
    if(el.dataset.action==='attach-file'&&(role==='viewer'||!el.dataset.task||state.tasks.find(t=>t.id===el.dataset.task)?.assignee!==currentUser().id))el.hidden=true;
  }
  for(const el of document.querySelectorAll('.move-task'))if(role==='viewer'||state.tasks.find(t=>t.id===el.dataset.id)?.assignee!==currentUser().id)el.disabled=true;
  for(const el of document.querySelectorAll('.board-card'))if(role==='viewer'||state.tasks.find(t=>t.id===el.dataset.taskId)?.assignee!==currentUser().id)el.draggable=false;
}
function renderAuth(){
  document.body.classList.add('auth-shell');closeAccountMenu();
  const token=location.hash.split('/')[1]??'';
  $('#main').innerHTML=renderAuthScreen({mode:authMode,token,demoEnabled,signOutPending});
  document.title='Sign in · Project Nexus';
  $('#breadcrumb').textContent='Sign in';$('#navigation').innerHTML='';$('#pinned-projects').innerHTML='';
  $('#profile-name').textContent='Your organization';
  $('.profile small').textContent='Sign in to continue';
  $('.local-note').innerHTML='<span class="local-indicator"></span><div><strong>Organization workspace</strong><p>Sign in to access your projects.</p></div>';
  $('#save-status').textContent='Signed out';
  updateAccountUI();
}
async function accountSubmit(form){
  const data=Object.fromEntries(new FormData(form)),submit=form.querySelector('button[type="submit"]');if(submit?.disabled)return;if(submit)submit.disabled=true;
  const error=form.querySelector('.form-error');if(error)error.hidden=true;
  try{
    if(form.id==='auth-form'){
      const mode=form.dataset.mode;const result=await signIn(mode==='invite'?'accept-invite':mode,{...data,...(['invite','reset'].includes(mode)?{token:form.dataset.token}:{})});
      if(mode==='forgot'){const status=$('#auth-status');if(status)status.textContent=result.message;else formError(result.message);return;}
      if(mode==='reset'){
        // Reset returns no access token and revokes existing sessions. Clear the
        // old identity and cached workspace even if cookie cleanup is offline.
        await endAccountSession({afterReset:true}).catch(()=>{});
        toast('Password reset. Sign in with your new password.');return;
      }
      state=validateState(await loadRemote());remoteReady=true;signOutPending=false;
      workspace=demoEnabled&&currentUser()?.email==='student@nexus.test'?'study':'all';$('#workspace').value=workspace;
      location.hash='overview';route();
    }else if(form.id==='organization-form'){
      await api('/api/organization','PATCH',{name:data.name,departments:String(data.departments).split(',').map(x=>x.trim()).filter(Boolean)});state=validateState(await loadRemote());render();toast('Organization settings saved.');
    }else if(form.id==='invite-form'){
      const result=await api('/api/invitations','POST',data);state=validateState(await loadRemote());render();dialog.close();toast('Invitation created.');if(result.developmentLink)showDialog(`${dialogHead('Development invitation')}<p class="muted small-text">Email delivery is disabled in local development. Share this link with the intended user:</p><textarea readonly aria-label="Invitation link">${h(result.developmentLink)}</textarea>`);
    }else if(form.id==='user-form'){
      await api(`/api/users/${encodeURIComponent(form.dataset.id)}`,'PATCH',{...data,capacity:Number(data.capacity),active:data.active==='true'});if(form.dataset.id===currentUser().id){await signOut();remoteReady=false;dialog.close();renderAuth();toast('Account updated. Sign in again to continue.');}else{state=validateState(await loadRemote());dialog.close();render();toast('Account updated.');}
    }
  }catch(error){formError(error.message);}finally{if(submit)submit.disabled=false;}
}
async function managementAction(action,el){
  try{
    const id=el.dataset.id,kind=el.dataset.kind;
    if(action==='record-new'||action==='record-edit'){if(['expenses','risks','milestones'].includes(kind)&&!state.projects.length){toast('Create a project first.');return;}showDialog(recordDialog(kind,action==='record-edit'?id:'',state,el.dataset.project));applyPermissions();}
    if(action==='record-delete')confirmAction('Delete this record?','This permanently removes the selected record.',async()=>{try{if(await commit(removeRecord(state,kind,id),'Record deleted.'))dialog.close();}catch(e){formError(e.message);}});
    if(action==='milestone-toggle')await commit({...state,milestones:state.milestones.map(m=>m.id===id?{...m,done:!m.done}:m)},'Milestone updated.');
    if(action==='notification-read')await commit({...state,notifications:state.notifications.map(n=>n.id===id?{...n,read:true}:n)},'Marked as read.');
    if(action==='notifications-read')await commit({...state,notifications:state.notifications.map(n=>({...n,read:true}))},'Inbox cleared.');
    if(action==='portfolio-reset'){portfolioFilter={owner:'',department:'',priority:'',status:'',category:'',from:'',to:''};render();}
    if(action==='report-pdf'){toast('Preparing your PDF…');await reportPDF(state,el.dataset.project??'',el.dataset.report??'portfolio');toast('PDF export started.');}
    if(action==='attach-file'){
      let input=$('#attachment-upload');if(!input){input=document.createElement('input');input.type='file';input.id='attachment-upload';input.accept='.pdf,.png,.jpg,.jpeg,.txt';input.hidden=true;document.body.append(input);input.addEventListener('change',uploadAttachment);}
      input.dataset.project=el.dataset.project;input.dataset.task=el.dataset.task??'';input.dataset.risk=el.dataset.risk??'';input.dataset.expense=el.dataset.expense??'';input.click();
    }
    if(action==='file-download'){const f=state.files.find(f=>f.id===id);if(f){const bytes=Uint8Array.from(atob(f.data),c=>c.charCodeAt(0));downloadBlob(new Blob([bytes],{type:f.type}),f.name);}}
    if(action==='file-remove')confirmAction('Remove this attachment?','The file will be permanently removed from the workspace.',async()=>{if(await commit({...state,files:state.files.filter(f=>f.id!==id)},'Attachment removed.'))dialog.close();});
    if(action.startsWith('auth-')){authMode=action.slice(5);location.hash='overview';renderAuth();}
    if(action==='reload-remote'){try{state=validateState(await loadRemote());remoteReady=true;render();}catch(error){connectionError=error.message;render();}}
    if(action==='logout'||action==='account-switch')await endAccountSession();
    if(action==='account-reset'){
      const user=currentUser();if(!user)return;el.disabled=true;
      try{const result=await api('/api/auth/forgot','POST',{email:user.email});const status=$('#account-security-status');if(status)status.textContent=result.message;}
      catch(error){const status=$('#account-security-status');if(status)status.textContent=error.message;else toast(error.message);}
      finally{el.disabled=false;}
    }
    if(action==='invite-user')showDialog(`${dialogHead('Invite a teammate')}<form id="invite-form"><label for="invite-email">Email</label><input id="invite-email" name="email" type="email" maxlength="254" required><label for="invite-role">Role</label><select id="invite-role" name="role"><option value="member">Team member</option><option value="manager">Project manager</option><option value="viewer">Viewer / executive</option><option value="admin">Super admin</option></select><p class="form-error" role="alert" hidden></p><div class="dialog-footer"><button type="submit" class="button primary">Send invitation</button></div></form>`);
    if(action==='manage-user'){
      const m=state.members.find(m=>m.id===id);showDialog(`${dialogHead('Manage account',h(m.name))}<form id="user-form" data-id="${h(id)}"><label for="user-role">Role</label><select id="user-role" name="role">${['admin','manager','member','viewer'].map(r=>`<option ${m.role===r?'selected':''}>${r}</option>`).join('')}</select><label for="user-active">Account status</label><select id="user-active" name="active"><option value="true" ${m.active?'selected':''}>Active</option><option value="false" ${!m.active?'selected':''}>Deactivated</option></select><label for="user-department">Department</label><input id="user-department" name="department" value="${h(m.department)}" maxlength="80"><label for="user-capacity">Capacity (hours)</label><input type="number" id="user-capacity" name="capacity" value="${m.capacity}" min="0" max="168" required><p class="form-error" role="alert" hidden></p><div class="dialog-footer"><button type="submit" class="button primary">Save account</button></div></form>`);
    }
  }catch(error){toast(error.message);}
}
async function uploadAttachment(e){
  const input=e.target,file=input.files[0];input.value='';if(!file)return;
  try{if(file.size>2*1024*1024)throw new Error('Attachments must be 2 MB or smaller.');if(!['application/pdf','image/png','image/jpeg','text/plain'].includes(file.type))throw new Error('Choose a PDF, PNG, JPEG, or text file.');const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});if(await commit({...state,files:[...state.files,{id:crypto.randomUUID(),projectId:input.dataset.project,taskId:input.dataset.task,riskId:input.dataset.risk,expenseId:input.dataset.expense,name:file.name,type:file.type,data}]},'Attachment saved.'))dialog.close();}catch(error){toast(error.message);}
}
document.addEventListener('change',async e=>{
  const el=e.target;if(el.dataset.portfolio){portfolioFilter[el.dataset.portfolio]=el.value;$('#portfolio-analytics').innerHTML=analyticsPanel(scopedState());}
  if(el.classList.contains('notification-pref'))await commit({...state,preferences:{...state.preferences,[el.dataset.key]:el.checked}},'Preference saved.');
});
document.addEventListener('dragstart',e=>{const card=e.target.closest('.board-card');if(card){draggedTask=card.dataset.taskId;e.dataTransfer.setData('text/plain',draggedTask);}});
document.addEventListener('dragover',e=>{if(e.target.closest('[data-drop-status]')&&draggedTask)e.preventDefault();});
document.addEventListener('drop',async e=>{const col=e.target.closest('[data-drop-status]');if(!col||!draggedTask)return;e.preventDefault();const id=draggedTask;draggedTask='';await commit({...state,tasks:state.tasks.map(t=>t.id===id?{...t,status:col.dataset.dropStatus,completedAt:col.dataset.dropStatus==='Done'?dateKey():'',history:[...t.history,{date:dateKey(),status:col.dataset.dropStatus}].slice(-200)}:t)},'Task moved.');});
document.addEventListener('dragend',()=>{draggedTask='';});
dialog.addEventListener('close',()=>{confirmation=null;if(dialog.dataset.returnAccount){delete dialog.dataset.returnAccount;$('#account-toggle').focus();}});
if(storageBlocked&&!connected)warning('Saved storage could not be read. Example data is shown without overwriting it. Use Settings to import a backup or start fresh.');
if(connected){storageBlocked=false;refresh().then(async()=>{state=validateState(await loadRemote());remoteReady=true;}).catch(error=>{connectionError=error.message;}).finally(()=>{booting=false;route();});}else route();
