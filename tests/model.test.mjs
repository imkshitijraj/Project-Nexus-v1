import test from 'node:test';
import assert from 'node:assert/strict';
import {seedState,validateState,projectProgress,filterTasks,deleteProject,escapeHTML,validDate,dateKey,budgetSummary,monthlySpending,portfolioSummary,workload} from '../model.js';
import {managementView,removeTask} from '../management.js';
test('example workspace is valid and survives a JSON backup round trip',()=>{
  const state=seedState();assert.deepEqual(validateState(JSON.parse(JSON.stringify(state))),state);
});
test('progress is derived from completed tasks, including empty projects',()=>{
  assert.deepEqual(projectProgress([{projectId:'p',status:'Done'},{projectId:'p',status:'Backlog'}],'p'),{done:1,total:2,percent:50});
  assert.deepEqual(projectProgress([],'p'),{done:0,total:0,percent:0});
});
test('filters combine case-insensitive search, project, priority and status',()=>{
  const {tasks}=seedState();const found=filterTasks(tasks,{query:'VISUAL',project:'p1',status:'In progress',priority:'High'});
  assert.equal(found.length,1);assert.equal(found[0].title,'Explore visual directions');assert.equal(filterTasks(tasks,{query:'nonexistent'}).length,0);
});
test('deleting a project removes only its dependent tasks',()=>{
  const state=seedState(),next=deleteProject(state,'p1');assert(!next.projects.some(p=>p.id==='p1'));assert(!next.tasks.some(t=>t.projectId==='p1'));assert.equal(next.tasks.length,8);assert.equal(state.projects.length,4);
});
test('invalid and oversized backups are rejected',()=>{
  const s=seedState();assert.throws(()=>validateState({...s,version:2}));assert.throws(()=>validateState({...s,projects:Array(101).fill(s.projects[0])}));assert.throws(()=>validateState({...s,tasks:Array(2001).fill(s.tasks[0])}));
  for(const bad of [{...s.tasks[0],projectId:'missing'},{...s.tasks[0],due:'2026-02-30'},{...s.tasks[0],status:'root'},{...s.tasks[0],title:' '},{...s.tasks[0],notes:'x'.repeat(2001)}])assert.throws(()=>validateState({...s,tasks:[bad]}));
});
test('duplicate IDs and malformed focus history are rejected',()=>{
  const s=seedState();assert.throws(()=>validateState({...s,projects:[...s.projects,s.projects[0]]}));assert.throws(()=>validateState({...s,tasks:[...s.tasks,s.tasks[0]]}));assert.throws(()=>validateState({...s,sessions:[{date:dateKey(),minutes:Infinity}]}));
});
test('untrusted object fields are discarded, text is escaped at render boundary',()=>{
  const state=seedState();state.projects[0].isAdmin=true;state.projects[0].name='<img src=x onerror=alert(1)>';
  const clean=validateState(state);assert.equal(clean.projects[0].isAdmin,undefined);assert.equal(escapeHTML(clean.projects[0].name),'&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(escapeHTML('"\'&'),'&quot;&#39;&amp;');
});
test('dates reject rollover and accept real leap days',()=>{assert(validDate('2028-02-29'));assert(!validDate('2026-02-29'));assert(!validDate('2026-13-01'));assert(!validDate('not a date'));});
test('financial totals, negative variance and portfolio risk exposure are calculated from records',()=>{const s=seedState(),b=budgetSummary(s,'p2');assert.equal(b.budget,1200);assert.equal(b.spent,950);assert.equal(b.remaining,250);assert.equal(b.variance,-200);assert.equal(portfolioSummary(s).exposure,12);assert.equal(portfolioSummary(s).openRisks,1);assert(workload(s,'m2')>0);});
test('dependencies reject cycles, missing references, cross-project links and premature completion',()=>{const s=seedState(),t=s.tasks.find(t=>t.id==='t1'),other=s.tasks.find(t=>t.id==='t5');t.dependencies=[other.id];other.dependencies=[t.id];assert.throws(()=>validateState(s),/cycle/);other.dependencies=[];t.status='Done';assert.throws(()=>validateState(s),/dependencies/);t.status='Backlog';t.dependencies=['missing'];assert.throws(()=>validateState(s),/dependency/);t.dependencies=['t2'];assert.throws(()=>validateState(s),/project/);});
test('budget allocation and member assignment invariants reject inconsistent state',()=>{const s=seedState();s.projects[0].allocations=[{category:'General',amount:999999}];assert.throws(()=>validateState(s),/allocations/);s.projects[0].allocations=[];s.projects[0].members=[];s.tasks.find(t=>t.projectId==='p1').assignee='m2';assert.throws(()=>validateState(s),/Assign/);});
test('currency arithmetic uses integer cents',()=>{const s=seedState();s.expenses=[{...s.expenses[0],amount:.1},{...s.expenses[0],id:'e-cent',amount:.2}];assert.equal(budgetSummary(s,'p1').spent,.3);});

test('imported amounts round decimal half cents consistently without floating point drift',()=>{
  const s=seedState();s.projects[0].allocations=[];s.projects[0].budget=1.005;s.projects[0].forecast=20.075;
  s.expenses[0].amount=1e-8;s.tasks[0].estimate=1.005;
  const clean=validateState(s);
  assert.equal(clean.projects[0].budget,1.01);assert.equal(clean.projects[0].forecast,20.08);
  assert.equal(clean.expenses[0].amount,0);assert.equal(clean.tasks[0].estimate,1.01);
  for(const value of [Infinity,NaN,-1,1000000000.01])assert.throws(()=>validateState({...s,expenses:[{...s.expenses[0],amount:value}]}),/Invalid amount/);
});

test('zero-budget spending remains an overspend without a misleading utilization percentage',()=>{
  const s=seedState();s.projects[0].budget=0;s.projects[0].allocations=[];
  const b=budgetSummary(s,'p1');
  assert.equal(b.utilization,null);assert.equal(b.remaining,-1250);
  const rendered=managementView('budget',s);
  assert.match(rendered,/No budget set <strong class="danger">Over budget/);
  assert.doesNotMatch(rendered,/NaN|Infinity|null%/);
});

test('spending trends contain six distinct calendar months across month-end and year boundaries',()=>{
  const s=seedState();
  s.expenses=[{...s.expenses[0],amount:.1,date:'2026-12-15'},{...s.expenses[0],id:'e-cent',amount:.2,date:'2026-12-31'}];
  const months=monthlySpending(s,new Date(2027,0,31));
  assert.deepEqual(months.map(x=>x.month),['2026-08','2026-09','2026-10','2026-11','2026-12','2027-01']);
  assert.equal(months[4].spent,.3);
  assert.equal(new Set(monthlySpending(s,new Date(2028,2,31)).map(x=>x.month)).size,6);
});

test('fractional workload totals are exact and exclude completed and archived work',()=>{
  const s=seedState();
  s.tasks=[
    {...s.tasks[0],estimate:.1,assignee:'m1'},
    {...s.tasks[0],id:'fraction',estimate:.2,assignee:'m1'},
    {...s.tasks[0],id:'done',estimate:90,status:'Done',assignee:'m1'},
    {...s.tasks[0],id:'archived',projectId:'p2',estimate:90,assignee:'m1'}
  ];
  s.projects[1].archived=true;
  assert.equal(workload(s,'m1'),.3);
});

test('attachment imports reject malformed base64 and enforce decoded size and aggregate quotas',()=>{
  const s=seedState(),file={id:'f1',projectId:'p1',type:'text/plain',name:'example.txt',data:'YQ=='};
  assert.equal(validateState({...s,files:[file]}).files[0].data,'YQ==');
  for(const data of ['A','===','AA=A','%%%%','AAAA='])assert.throws(()=>validateState({...s,files:[{...file,data}]}),/attachment/i);
  const limit=Buffer.alloc(2*1024*1024,97).toString('base64');
  assert.equal(validateState({...s,files:[{...file,data:limit}]}).files.length,1);
  assert.throws(()=>validateState({...s,files:[{...file,data:Buffer.alloc(2*1024*1024+1,97).toString('base64')}]}),/2 MB/);
  const files=Array.from({length:5},(_,i)=>({...file,id:`f${i}`,data:limit}));
  assert.equal(validateState({...s,files}).files.length,5);
  assert.throws(()=>validateState({...s,files:[...files,{...file,id:'extra',data:'YQ=='}]}),/quota/);
});

test('attachment references cannot cross project boundaries and deletion cleans dependent links',()=>{
  const s=seedState();
  const file={id:'f1',projectId:'p1',taskId:'t2',type:'text/plain',name:'example.txt',data:'YQ=='};
  assert.throws(()=>validateState({...s,files:[file]}),/different project/);
  file.taskId='t1';s.files=[file];
  s.tasks.find(t=>t.id==='t5').dependencies=['t1'];
  s.tasks.find(t=>t.id==='t12').parentId='t1';
  const next=validateState(removeTask(s,'t1'));
  assert.equal(next.files.length,0);
  assert.deepEqual(next.tasks.find(t=>t.id==='t5').dependencies,[]);
  assert.equal(next.tasks.find(t=>t.id==='t12').parentId,'');
  assert.equal(s.tasks.length,12);
});

test('activity preserves the stable actor identity used by API authorization',()=>{
  const s=seedState();s.activity=[{id:'audit-1',actor:'Same display name',actorId:'user-a',message:'Updated task',at:new Date().toISOString()}];
  assert.equal(validateState(s).activity[0].actorId,'user-a');
  delete s.activity[0].actorId;
  assert.equal(validateState(s).activity[0].actorId,'');
});

test('management views escape malicious names, notes, and record identifiers',()=>{
  const s=seedState(),payload='<img src=x onerror="alert(1)">';
  s.projects[0].name=payload;s.expenses[0].vendor=payload;s.risks[0].mitigation=payload;
  s.members[0].name=payload;s.activity=[{id:'audit',actor:payload,message:payload,at:new Date().toISOString()}];
  for(const view of ['teams','budget','risks','timeline','reports','notifications']){
    const html=managementView(view,s);
    assert(!html.includes(payload),`${view} must escape user text`);
    assert.match(html,/&lt;img/,`${view} should render the escaped value`);
  }
});

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
const isolatedConnection=()=>import(`../connection.js?test=${crypto.randomUUID()}`);

test('simultaneous and late expired responses share one session rotation',async t=>{
  const connection=await isolatedConnection();
  let rotations=0,releaseRefresh,releaseLate;
  t.mock.method(globalThis,'fetch',async (url,options)=>{
    if(url.endsWith('/login'))return response({accessToken:'old',user:{id:'user-1'}});
    if(url.endsWith('/refresh')){rotations++;return new Promise(resolve=>{releaseRefresh=()=>resolve(response({accessToken:'new',user:{id:'user-1'}}));});}
    if(options.headers.Authorization==='Bearer old'){
      if(url.endsWith('/late'))return new Promise(resolve=>{releaseLate=()=>resolve(response({error:'Expired'},401));});
      return response({error:'Expired'},401);
    }
    assert.equal(options.headers.Authorization,'Bearer new');
    return response({ok:true});
  });
  await connection.signIn('login',{});
  const first=connection.api('/api/first'),second=connection.api('/api/second'),late=connection.api('/api/late');
  await tick();assert.equal(rotations,1);releaseRefresh();
  assert.deepEqual(await Promise.all([first,second]),[{ok:true},{ok:true}]);
  releaseLate();assert.deepEqual(await late,{ok:true});assert.equal(rotations,1);
});

test('logout waits for an in-flight cookie rotation and cannot restore the user',async t=>{
  const connection=await isolatedConnection();
  let releaseRefresh,logoutCalls=0;
  t.mock.method(globalThis,'fetch',async url=>{
    if(url.endsWith('/login'))return response({accessToken:'old',user:{id:'user-1'}});
    if(url.endsWith('/refresh'))return new Promise(resolve=>{releaseRefresh=()=>resolve(response({accessToken:'new',user:{id:'user-1'}}));});
    if(url.endsWith('/logout')){logoutCalls++;return response({ok:true});}
    assert.fail(`Unexpected request ${url}`);
  });
  await connection.signIn('login',{});
  const refreshing=assert.rejects(connection.refresh(),/session changed/);
  const signingOut=connection.signOut();
  assert.equal(connection.currentUser(),null);assert.equal(logoutCalls,0);
  releaseRefresh();await refreshing;await signingOut;
  assert.equal(logoutCalls,1);assert.equal(connection.currentUser(),null);
});

test('late unauthorized requests cannot initiate a new refresh after logout',async t=>{
  const connection=await isolatedConnection();
  let releaseOld;
  t.mock.method(globalThis,'fetch',async url=>{
    if(url.endsWith('/login'))return response({accessToken:'old',user:{id:'user-1'}});
    if(url.endsWith('/logout'))return response({ok:true});
    if(url.endsWith('/workspace'))return new Promise(resolve=>{releaseOld=()=>resolve(response({error:'Expired'},401));});
    assert.fail(`Unexpected request ${url}`);
  });
  await connection.signIn('login',{});
  const request=assert.rejects(connection.api('/api/workspace'),/session changed/);
  await connection.signOut();releaseOld();await request;
});

test('failed refresh removes expired identity and reports safe proxy and network errors',async t=>{
  const connection=await isolatedConnection();
  t.mock.method(globalThis,'fetch',async url=>{
    if(url.endsWith('/login'))return response({accessToken:'old',user:{id:'user-1'}});
    return response({error:'Session expired.'},401);
  });
  await connection.signIn('login',{});
  await assert.rejects(connection.refresh(),/Session expired/);
  assert.equal(connection.currentUser(),null);
  globalThis.fetch=async()=>new Response('<html>proxy details</html>',{status:502});
  await assert.rejects(connection.api('/api/workspace'),error=>error.status===502&&error.message==='Request failed (502). Please try again.');
  globalThis.fetch=async()=>{throw new TypeError('Failed to fetch');};
  await assert.rejects(connection.api('/api/workspace'),/Check your connection/);
});

test('failed workspace save keeps its revision for an explicit retry',async t=>{
  const connection=await isolatedConnection();let saves=0;
  t.mock.method(globalThis,'fetch',async (url,options)=>{
    if(options.method==='GET')return response({revision:7,state:{name:'saved'}});
    const body=JSON.parse(options.body);assert.equal(body.revision,7);
    return ++saves===1?response({error:'Workspace changed.'},409):response({revision:8,state:body.state});
  });
  assert.deepEqual(await connection.loadRemote(),{name:'saved'});
  await assert.rejects(connection.saveRemote({name:'next'}),error=>error.status===409);
  assert.deepEqual(await connection.saveRemote({name:'next'}),{name:'next'});
});

test('browser tabs serialize cookie rotations through the same Web Lock',async t=>{
  const first=await isolatedConnection(),second=await isolatedConnection();
  let queue=Promise.resolve(),active=0,maxActive=0;
  const lockNames=[];
  const previous=Object.getOwnPropertyDescriptor(globalThis.navigator,'locks');
  Object.defineProperty(globalThis.navigator,'locks',{configurable:true,value:{
    request(name,callback){
      lockNames.push(name);const next=queue.then(callback);queue=next.catch(()=>{});return next;
    }
  }});
  t.after(()=>previous?Object.defineProperty(globalThis.navigator,'locks',previous):delete globalThis.navigator.locks);
  t.mock.method(globalThis,'fetch',async()=>{
    active++;maxActive=Math.max(maxActive,active);await tick();active--;
    return response({accessToken:'token',user:{id:'user-1'}});
  });
  await Promise.all([first.refresh(),second.refresh()]);
  assert.equal(maxActive,1);
  assert.equal(lockNames.length,2);
  assert.equal(new Set(lockNames).size,1);
});
