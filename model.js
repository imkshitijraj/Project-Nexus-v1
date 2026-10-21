export const STATUSES = ['Backlog', 'In progress', 'Done'];
export const PRIORITIES = ['Low', 'Medium', 'High'];
export const COLORS = ['mint', 'blue', 'peach', 'lavender'];
export const STORAGE_KEY = 'stride.workspace.v1';
export const ROLES = ['admin','manager','member','viewer'];
export const PROJECT_STATUSES = ['Planning','Active','On hold','Completed'];
export const RISK_STATUSES = ['Open','Mitigating','Closed'];
function list(value, max = 1000) { if(value === undefined) return []; if(!Array.isArray(value) || value.length>max) throw new Error('Collection exceeds its limit.'); return value; }
function amount(value = 0) {
  if(typeof value !== 'number' || !Number.isFinite(value) || value<0 || value>1e9) throw new Error('Invalid amount (use a value from 0 to 1 billion).');
  // Shift the decimal representation before rounding; binary multiplication
  // alone turns values such as 1.005 into 100.49999999999999.
  const [coefficient,exponent='0']=String(value).split('e');
  return Math.round(Number(`${coefficient}e${Number(exponent)+2}`))/100;
}
function text(value, max=160) { return str(value ?? '',max,'text',true); }
function date(value, fallback=dateKey()) {if(value===undefined)return fallback;if(!validDate(value))throw new Error('Invalid date.');return value;}
export function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function shiftDate(days) { const d = new Date(); d.setDate(d.getDate() + days); return dateKey(d); }
export function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00`);
  return !Number.isNaN(d.getTime()) && dateKey(d) === value;
}
function str(value, max, label, optional = false) {
  if (typeof value !== 'string' || value.length > max || (!optional && !value.trim())) throw new Error(`Invalid ${label}.`);
  return value.trim();
}
function choice(value, options, label) { if (!options.includes(value)) throw new Error(`Invalid ${label}.`); return value; }
export function validateState(input) {
  if (!input || input.version !== 1 || !Array.isArray(input.projects) || !Array.isArray(input.tasks) || input.projects.length > 100 || input.tasks.length > 2000) throw new Error('Use a Project Nexus version 1 backup with at most 100 projects and 2,000 tasks.');
  const members = list(input.members,200).map(m=>({id:str(m.id,80,'member ID'),name:str(m.name,60,'member name'),email:text(m.email,254),role:choice(m.role??'member',ROLES,'role'),department:text(m.department,80),capacity:amount(m.capacity??40),active:m.active!==false}));
  const memberIds = new Set(members.map(m=>m.id));
  if(memberIds.size!==members.length)throw new Error('Duplicate member IDs.');
  const projects = input.projects.map(p => ({ id: str(p.id, 80, 'project ID'), name: str(p.name, 80, 'project name'), description: str(p.description, 500, 'description', true), category: choice(p.category, ['study', 'work'], 'category'), color: choice(p.color, COLORS, 'color'), due: validDate(p.due) ? p.due : (() => {throw new Error('Invalid project date.');})(), archived: p.archived === true,
    owner:text(p.owner,80),department:text(p.department,80),priority:choice(p.priority??'Medium',PRIORITIES,'priority'),client:text(p.client,100),start:date(p.start,p.due),budget:amount(p.budget),forecast:amount(p.forecast),status:choice(p.status??'Active',PROJECT_STATUSES,'project status'),health:choice(p.health??'On track',['On track','At risk','Delayed'],'project health'),criteria:text(p.criteria,1000),tags:list(p.tags,20).map(x=>text(x,40)),members:list(p.members,200).map(x=>str(x,80,'member reference')),allocations:list(p.allocations,20).map(x=>({category:str(x.category,80,'category'),amount:amount(x.amount)})) }));
  const ids = new Set(projects.map(p => p.id));
  if (ids.size !== projects.length) throw new Error('Duplicate project IDs.');
  const tasks = input.tasks.map(t => {
    if (!ids.has(t.projectId)) throw new Error('A task refers to a missing project.');
    if (!validDate(t.due)) throw new Error('Invalid task date.');
    return { id: str(t.id, 80, 'task ID'), title: str(t.title, 160, 'task title'), notes: str(t.notes, 2000, 'task notes', true), projectId: t.projectId, status: choice(t.status, STATUSES, 'status'), priority: choice(t.priority, PRIORITIES, 'priority'), due: t.due,
      assignee:text(t.assignee,80),estimate:amount(t.estimate),labels:list(t.labels,20).map(x=>text(x,40)),parentId:text(t.parentId,80),dependencies:list(t.dependencies,50).map(x=>str(x,80,'dependency')),watchers:list(t.watchers,200).map(x=>str(x,80,'watcher')),checklist:list(t.checklist,50).map(x=>({text:str(x.text,200,'checklist item'),done:x.done===true})),comments:list(t.comments,100).map(c=>({id:str(c.id,80,'comment ID'),author:text(c.author,80),body:str(c.body,2000,'comment'),date:date(c.date)})),completedAt:t.status==='Done'?date(t.completedAt||undefined,t.due):'',history:list(t.history,200).map(x=>({date:date(x.date),status:choice(x.status,STATUSES,'history status')})) };
  });
  if (new Set(tasks.map(t => t.id)).size !== tasks.length) throw new Error('Duplicate task IDs.');
  const name = str(input.profile?.name ?? 'Your workspace', 60, 'display name');
  const sessions = input.sessions ?? [];
  if (!Array.isArray(sessions) || sessions.length > 10000) throw new Error('Invalid focus history.');
  const cleanSessions = sessions.map(s => { if (!validDate(s.date) || !Number.isInteger(s.minutes) || s.minutes < 1 || s.minutes > 180) throw new Error('Invalid focus session.'); return { date: s.date, minutes: s.minutes }; });
  const taskIds=new Set(tasks.map(t=>t.id));
  for(const p of projects){if(p.start>p.due)throw new Error('Project start must be on or before its target date.');if(p.owner&&!memberIds.has(p.owner)||p.members.some(id=>!memberIds.has(id)))throw new Error('Project references a missing member.');if(p.allocations.reduce((sum,a)=>sum+Math.round(a.amount*100),0)>Math.round(p.budget*100))throw new Error('Category allocations exceed the project budget.');}
  for(const t of tasks){if(t.assignee&&!memberIds.has(t.assignee)||t.watchers.some(id=>!memberIds.has(id)))throw new Error('Task references a missing member.');const p=projects.find(p=>p.id===t.projectId);if(t.assignee&&p.owner!==t.assignee&&!p.members.includes(t.assignee))throw new Error('Assign the person to this project before assigning its tasks.');if(t.dependencies.some(id=>!taskIds.has(id)||id===t.id)||t.parentId&&(!taskIds.has(t.parentId)||t.parentId===t.id))throw new Error('Invalid task dependency or parent.');for(const id of [...t.dependencies,...(t.parentId?[t.parentId]:[])])if(tasks.find(x=>x.id===id)?.projectId!==t.projectId)throw new Error('Dependencies and subtasks must stay in their project.');if(t.status==='Done'&&t.dependencies.some(id=>tasks.find(x=>x.id===id)?.status!=='Done'))throw new Error('Complete a task’s dependencies before marking it done.');}
  const visiting=new Set(),visited=new Set(),byId=new Map(tasks.map(t=>[t.id,t]));
  function visit(id){if(visiting.has(id))throw new Error('Task dependencies or subtasks form a cycle.');if(visited.has(id))return;visiting.add(id);const t=byId.get(id);for(const d of [...t.dependencies,...(t.parentId?[t.parentId]:[])])visit(d);visiting.delete(id);visited.add(id);}for(const t of tasks)visit(t.id);
  const linked=(rows,max=1000)=>list(rows,max).map(r=>{if(!ids.has(r.projectId))throw new Error('Record references a missing project.');return r;});
  const expenses=linked(input.expenses).map(e=>({id:str(e.id,80,'expense ID'),projectId:e.projectId,amount:amount(e.amount),category:str(e.category,80,'category'),date:date(e.date),vendor:text(e.vendor,120),notes:text(e.notes,1000)}));
  const risks=linked(input.risks).map(r=>({id:str(r.id,80,'risk ID'),projectId:r.projectId,title:str(r.title,160,'risk title'),description:text(r.description,1000),category:text(r.category,80),probability:choice(r.probability,[1,2,3,4,5],'probability'),impact:choice(r.impact,[1,2,3,4,5],'impact'),owner:text(r.owner,80),mitigation:text(r.mitigation,2000),due:date(r.due),status:choice(r.status,RISK_STATUSES,'risk status'),progress:choice(r.progress??0,[0,25,50,75,100],'mitigation progress')}));
  const milestones=linked(input.milestones).map(m=>({id:str(m.id,80,'milestone ID'),projectId:m.projectId,title:str(m.title,160,'milestone title'),due:date(m.due),done:m.done===true}));
  const events=list(input.events,1000).map(e=>({id:str(e.id,80,'event ID'),title:str(e.title,160,'event title'),date:date(e.date),type:choice(e.type,['Meeting','Leave','Reminder'],'event type'),notes:text(e.notes,1000)}));
  const resources=list(input.resources,200).map(r=>({id:str(r.id,80,'resource ID'),name:str(r.name,100,'resource name'),type:choice(r.type,['Equipment','License','Room'],'resource type'),projectId:r.projectId?str(r.projectId,80,'project ID'):'',capacity:amount(r.capacity??1),allocated:amount(r.allocated??0)}));
  const notifications=list(input.notifications,2000).map(n=>({id:str(n.id,80,'notification ID'),title:str(n.title,200,'notification title'),date:date(n.date),read:n.read===true,kind:choice(n.kind??'updates',['updates','deadlines','budget','risks'],'notification type'),recipient:text(n.recipient,80)}));
  const activity=list(input.activity,2000).map(a=>({id:str(a.id,80,'activity ID'),message:str(a.message,300,'activity'),actor:text(a.actor,80),actorId:text(a.actorId,80),at:str(a.at,40,'timestamp')}));
  let attachmentBytes=0;
  const files=linked(input.files,100).map(f=>{
    if(!['application/pdf','image/png','image/jpeg','text/plain'].includes(f.type)||typeof f.data!=='string'||f.data.length>2796204||f.data.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(f.data))throw new Error('Invalid attachment (PDF, PNG, JPEG or text; 2 MB max).');
    const bytes=f.data.length/4*3-(f.data.endsWith('==')?2:f.data.endsWith('=')?1:0);
    if(bytes>2*1024*1024)throw new Error('Attachment exceeds 2 MB.');
    attachmentBytes+=bytes;
    if(attachmentBytes>10*1024*1024)throw new Error('The workspace attachment quota is 10 MB.');
    if(f.taskId&&!taskIds.has(f.taskId))throw new Error('Attachment task is missing.');
    return {id:str(f.id,80,'file ID'),projectId:f.projectId,taskId:text(f.taskId,80),name:str(f.name,120,'filename'),type:f.type,data:f.data,riskId:text(f.riskId,80),expenseId:text(f.expenseId,80)};
  });
  for(const [label,rows] of Object.entries({expenses,risks,milestones,events,resources,notifications,activity,files}))if(new Set(rows.map(x=>x.id)).size!==rows.length)throw new Error(`Duplicate ${label} IDs.`);
  for(const r of resources)if(r.projectId&&!ids.has(r.projectId))throw new Error('Resource project is missing.');
  for(const r of risks)if(r.owner&&!memberIds.has(r.owner))throw new Error('Risk owner is missing.');
  for(const f of files)if(f.taskId&&tasks.find(t=>t.id===f.taskId)?.projectId!==f.projectId)throw new Error('Attachment belongs to a different project.');
  for(const f of files){if(f.riskId&&!risks.some(r=>r.id===f.riskId&&r.projectId===f.projectId)||f.expenseId&&!expenses.some(e=>e.id===f.expenseId&&e.projectId===f.projectId))throw new Error('Attachment source record is missing.');}
  return { version: 1, profile: { name }, projects, tasks, sessions: cleanSessions,members,expenses,risks,milestones,events,resources,notifications,activity,files,preferences:{updates:input.preferences?.updates!==false,deadlines:input.preferences?.deadlines!==false,budget:input.preferences?.budget!==false,risks:input.preferences?.risks!==false} };
}
export function seedState() {
  const projects = [
    { id: 'p1', name: 'Brand identity', description: 'A fresh identity for a meaningful launch.', category: 'work', color: 'mint', due: shiftDate(12), archived: false },
    { id: 'p2', name: 'Research paper', description: 'Turn a big question into a clear story.', category: 'study', color: 'blue', due: shiftDate(18), archived: false },
    { id: 'p3', name: 'Product launch', description: 'From the first idea to the first customer.', category: 'work', color: 'peach', due: shiftDate(8), archived: false },
    { id: 'p4', name: 'Learning sprint', description: 'Build skills, one small step at a time.', category: 'study', color: 'lavender', due: shiftDate(24), archived: false }
  ];
  const rows = [
    ['Explore visual directions', 'p1', 'In progress', 'High', 0], ['Outline research methodology', 'p2', 'In progress', 'High', 0], ['Review launch checklist', 'p3', 'Backlog', 'Medium', 1], ['Complete accessibility module', 'p4', 'Backlog', 'Low', 2], ['Gather stakeholder feedback', 'p1', 'Backlog', 'Medium', 3], ['Collect reference papers', 'p2', 'Done', 'Medium', -2], ['Define brand principles', 'p1', 'Done', 'High', -3], ['Write release announcement', 'p3', 'In progress', 'High', 4], ['Practice responsive layouts', 'p4', 'Done', 'Low', -1], ['Prepare interview questions', 'p2', 'Backlog', 'Medium', 5], ['Build launch page', 'p3', 'Done', 'High', -1], ['Create color palette', 'p1', 'In progress', 'Medium', 5]
  ];
  const members=[{id:'m1',name:'Alex Morgan',email:'alex@example.test',department:'Design',role:'manager',capacity:40,active:true},{id:'m2',name:'Sam Patel',email:'sam@example.test',department:'Research',role:'member',capacity:30,active:true},{id:'m3',name:'Riley Chen',email:'riley@example.test',department:'Engineering',role:'member',capacity:40,active:true}];
  return validateState({ version: 1, profile: { name: 'Your workspace' }, projects:projects.map((p,i)=>({...p,owner:members[i%3].id,members:members.map(m=>m.id),start:shiftDate(-10),budget:[5000,1200,12000,800][i],forecast:[4500,1400,10500,650][i],department:i%2?'Research':'Design',health:i===1?'At risk':'On track',allocations:[{category:'General',amount:[5000,1200,12000,800][i]}]})), tasks: rows.map((r,i) => ({ id: `t${i+1}`, title:r[0], projectId:r[1], status:r[2], priority:r[3], due:shiftDate(r[4]), notes:'',assignee:members[i%3].id,estimate:[8,16,5,3][i%4] })), sessions: [],members,expenses:[{id:'e1',projectId:'p1',amount:1250,category:'General',vendor:'Design tools',date:shiftDate(-3),notes:''},{id:'e2',projectId:'p2',amount:950,category:'General',vendor:'Research materials',date:shiftDate(-2),notes:''}],risks:[{id:'r1',projectId:'p2',title:'Participant recruitment delay',description:'The study needs additional interview participants.',category:'Schedule',probability:4,impact:3,owner:'m2',mitigation:'Expand recruitment to the department mailing list.',due:shiftDate(5),status:'Mitigating',progress:25}],milestones:[{id:'ms1',projectId:'p1',title:'Identity review',due:shiftDate(7),done:false}],events:[],resources:[],notifications:[],activity:[],files:[] });
}
export function projectProgress(tasks, id) {
  const items = tasks.filter(t => t.projectId === id);
  const done = items.filter(t => t.status === 'Done').length;
  return { total: items.length, done, percent: items.length ? Math.round(done / items.length * 100) : 0 };
}
export function filterTasks(tasks, {query = '', project = '', status = '', priority = ''} = {}) {
  return tasks.filter(t => (!query || `${t.title} ${t.notes}`.toLowerCase().includes(query.toLowerCase())) && (!project || t.projectId === project) && (!status || t.status === status) && (!priority || t.priority === priority)).sort((a,b) => a.due.localeCompare(b.due) || a.title.localeCompare(b.title));
}
export function deleteProject(state, id) { return { ...state, projects:state.projects.filter(p => p.id !== id), tasks:state.tasks.filter(t => t.projectId !== id),expenses:(state.expenses??[]).filter(x=>x.projectId!==id),risks:(state.risks??[]).filter(x=>x.projectId!==id),milestones:(state.milestones??[]).filter(x=>x.projectId!==id),resources:(state.resources??[]).map(x=>x.projectId===id?{...x,projectId:''}:x),files:(state.files??[]).filter(x=>x.projectId!==id) }; }
export function budgetSummary(state, projectId='') {const projects=state.projects.filter(p=>!projectId||p.id===projectId),ids=new Set(projects.map(p=>p.id));const budget=projects.reduce((n,p)=>n+Math.round(p.budget*100),0),spent=state.expenses.filter(e=>ids.has(e.projectId)).reduce((n,e)=>n+Math.round(e.amount*100),0),forecast=projects.reduce((n,p)=>n+Math.round(p.forecast*100),0);return{budget:budget/100,spent:spent/100,remaining:(budget-spent)/100,utilization:budget?spent/budget*100:null,forecast:forecast/100,variance:(budget-forecast)/100};}
export function projectHealth(p){return p.status==='Completed'?'On track':p.due<dateKey()?'Delayed':p.health;}
export function portfolioSummary(state) {const projects=state.projects.filter(p=>!p.archived),ids=new Set(projects.map(p=>p.id)),tasks=state.tasks.filter(t=>ids.has(t.projectId)),open=tasks.filter(t=>t.status!=='Done'),risks=state.risks.filter(r=>ids.has(r.projectId)&&r.status!=='Closed');return{active:projects.filter(p=>p.status!=='Completed').length,completed:projects.filter(p=>p.status==='Completed').length,delayed:projects.filter(p=>projectHealth(p)==='Delayed').length,atRisk:projects.filter(p=>projectHealth(p)==='At risk').length,completion:tasks.length?Math.round((tasks.length-open.length)/tasks.length*100):0,overdue:open.filter(t=>t.due<dateKey()).length,blocked:open.filter(t=>t.dependencies.some(id=>state.tasks.find(x=>x.id===id)?.status!=='Done')).length,exposure:risks.reduce((n,r)=>n+r.probability*r.impact,0),openRisks:risks.length};}
export function workload(state,id) {return state.tasks.filter(t=>t.assignee===id&&t.status!=='Done'&&!state.projects.find(p=>p.id===t.projectId)?.archived).reduce((n,t)=>n+Math.round(t.estimate*100),0)/100;}
export function escapeHTML(value) { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

export function monthlySpending(state, now = new Date()) {
  return Array.from({length:6}, (_,i) => {
    const month = dateKey(new Date(now.getFullYear(), now.getMonth()-5+i, 1)).slice(0,7);
    const cents = state.expenses.filter(e=>e.date.startsWith(month)).reduce((sum,e)=>sum+Math.round(e.amount*100),0);
    return {month,spent:cents/100};
  });
}
