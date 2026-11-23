import { deriveOffice } from './office-model.mjs';

/* Original office presentation. Locations and motion illustrate observed events. */
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const statusLabels = { running:'Đang làm', waiting:'Chờ bạn', idle:'Tạm nghỉ', completed:'Đã kết thúc', error:'Có lỗi', unknown:'Chưa rõ' };
const toolLabels = { running:'Đang chạy', success:'Thành công', error:'Có lỗi', denied:'Bị từ chối', cancelled:'Đã ngắt' };
const taskLabels = { pending:'Đang chờ', in_progress:'Đang làm', completed:'Đã hoàn thành' };
const pins = { model:'···', processing:'···', reading:'⌕', editing:'⌨', terminal:'>_', tool:'◇', delegating:'↗', waiting:'!', idle:'○', completed:'✓', error:'!', unknown:'?' };
const palettes = [['#b6beab','#66745b'],['#cbc7b5','#827c65'],['#b6c1be','#5f7770'],['#c2beca','#7c7287'],['#ccbcaf','#8a7360'],['#bac3a8','#74805f']];
const state = {
  snapshot:null, pending:null, office:null, selected:null, slots:{}, paused:false,
  connected:false, error:null, source:null, request:0, loading:false,
  static:Boolean(window.__AGENT_OBSERVATORY_SNAPSHOT__ || window.__AGENT_OBSERVATORY_OFFICE_FRAMES__),
  demo:params.get('demo') === '1', frames:[], frame:0, demoPlaying:false, demoTimer:null,
  filters:{project:params.get('project') || '',session:params.get('session') || '',search:params.get('q') || '',showCompleted:true},
  nodes:new Map(), rosterNodes:new Map(), reservations:new Map(), lastFetch:null, optionSignature:'', demoRequested:false,
};

function el(tag, className, text) { const n=document.createElement(tag); if(className)n.className=className; if(text!==undefined&&text!==null)n.textContent=String(text); return n; }
function number(v) { return typeof v==='number'&&Number.isFinite(v)?v:null; }
function date(v) { const n=Date.parse(v); return Number.isFinite(n)?n:null; }
function numeric(v) { return number(v)===null?'—':new Intl.NumberFormat('vi-VN').format(v); }
function short(v) { return number(v)===null?'—':v>=1000?`${new Intl.NumberFormat('vi-VN',{maximumFractionDigits:1}).format(v/1000)}k`:numeric(v); }
function now() { return state.demo||state.static?date(state.snapshot?.generatedAt)??Date.now():Date.now(); }
function clock(v, seconds=false) { const d=date(v); return d===null?'—':new Intl.DateTimeFormat('vi-VN',{hour:'2-digit',minute:'2-digit',...(seconds?{second:'2-digit'}:{})}).format(d); }
function duration(start,end) { const a=date(start),b=date(end)??now(); if(a===null||b<a)return'—';const s=Math.floor((b-a)/1000);return s<60?`${s}s`:s<3600?`${Math.floor(s/60)}m ${s%60}s`:`${Math.floor(s/3600)}h ${Math.floor(s%3600/60)}m`; }
function money(v,estimated=true) { return number(v)===null?'—':`${estimated?'≈ ':''}${new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:4}).format(v)}`; }
function hash(value) { let n=2166136261; for(const char of String(value))n=Math.imul(n^char.codePointAt(0),16777619); return n>>>0; }
function allActors() { return state.office?[...state.office.agents,...state.office.overflow]:[]; }
function announce(text) { $('announcement').textContent=text; }
function svgNode(tag,attrs={}) { const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);return n; }
function avatar(key,extraClass='') {
  const svg=svgNode('svg',{viewBox:'0 0 44 52',class:`avatar-graphic ${extraClass}`,'aria-hidden':'true'});
  const colors=palettes[hash(key)%palettes.length]; svg.style.setProperty('--avatar-fill',colors[0]);svg.style.setProperty('--avatar-dark',colors[1]);
  svg.append(svgNode('ellipse',{cx:22,cy:49,rx:17,ry:3,class:'avatar-shadow'}));
  svg.append(svgNode('path',{d:'M15 40v8m14-8v8',class:'avatar-line'}));
  svg.append(svgNode('rect',{x:11,y:27,width:22,height:17,rx:5,class:'avatar-body'}));
  svg.append(svgNode('path',{d:'M13 32l-5 8',class:'avatar-hand left-hand'}),svgNode('path',{d:'M31 32l5 8',class:'avatar-hand right-hand'}));
  const head=svgNode('g',{class:'avatar-head-group'});
  head.append(svgNode('path',{d:'M22 5V2',class:'avatar-line'}),svgNode('circle',{cx:22,cy:2,r:2,fill:colors[1]}));
  head.append(svgNode('rect',{x:6,y:7,width:32,height:24,rx:8,class:'avatar-head'}));
  head.append(svgNode('rect',{x:10,y:12,width:24,height:13,rx:4,class:'avatar-face'}));
  const eyes=svgNode('g',{class:'avatar-eyes'});eyes.append(svgNode('rect',{x:15,y:16,width:3,height:5,rx:1,class:'avatar-eye'}),svgNode('rect',{x:26,y:16,width:3,height:5,rx:1,class:'avatar-eye'}));head.append(eyes);
  head.append(svgNode('path',{d:'M19 27h6',stroke:'#f5f6ef','stroke-width':1.5}));svg.append(head);
  svg.append(svgNode('path',{d:hash(key)%2?'M18 34h8m-8 4h5':'M18 34h8v5h-8z',stroke:'#dfe5d6','stroke-width':1.3,fill:'none'}));return svg;
}

function validSnapshot(snapshot) { return snapshot&&snapshot.schemaVersion===1&&Array.isArray(snapshot.sessions); }
function setSnapshot(snapshot,force=false) {
  if(!validSnapshot(snapshot))throw new Error('Snapshot không đúng định dạng');
  if(state.paused&&!force){state.pending=snapshot;return;}
  state.snapshot=snapshot;state.demo=state.static||snapshot.source?.mode==='demo';state.connected=snapshot.source?.connected!==false;
  state.error=null;state.lastFetch=Date.now();render();
}
function setFrames(frames) {
  if(!Array.isArray(frames))return false;
  const usable=frames.map((item,index)=>({label:typeof item?.label==='string'?item.label:`Bước ${index+1}`,snapshot:item?.snapshot||item})).filter(item=>validSnapshot(item.snapshot)&&item.snapshot.source?.mode==='demo');
  if(!usable.length)return false;
  state.source?.close();state.source=null;state.frames=usable;state.frame=0;state.demo=true;
  $('demo-range').max=String(usable.length-1);$('demo-player').hidden=usable.length<2;
  applyFrame(0);setDemoPlaying(usable.length>1&&!reducedMotion.matches);return true;
}
function applyFrame(index) {
  if(!state.frames.length)return;
  state.frame=Math.max(0,Math.min(state.frames.length-1,index));
  setSnapshot(state.frames[state.frame].snapshot,true);
  $('demo-range').value=String(state.frame);$('frame-label').textContent=state.frames[state.frame].label;$('frame-count').textContent=`${state.frame+1} / ${state.frames.length}`;
}
function setDemoPlaying(value) {
  state.demoPlaying=Boolean(value)&&state.frames.length>1;clearInterval(state.demoTimer);state.demoTimer=null;
  if(state.demoPlaying){state.paused=false;state.demoTimer=setInterval(()=>{if(!document.hidden&&!state.paused)applyFrame((state.frame+1)%state.frames.length);},4200);}
  $('demo-play').textContent=state.demoPlaying?'Dừng phát lại':'Phát lại mẫu';$('demo-play').setAttribute('aria-pressed',String(state.demoPlaying));updatePause();
}
function updatePause() {
  document.body.classList.toggle('is-paused',state.paused);$('pause-button').setAttribute('aria-pressed',String(state.paused));$('pause-label').textContent=state.paused?'Tiếp tục cập nhật':'Tạm dừng màn hình';$('pause-icon').textContent=state.paused?'▷':'Ⅱ';$('paused-notice').hidden=!state.paused;
  $('paused-notice').querySelector('span').textContent=state.demo?'Kịch bản mẫu và chuyển động đang được giữ nguyên. Nhấn tiếp tục để xem lại.':'Agents vẫn làm việc. Bản cập nhật mới nhất sẽ xuất hiện khi tiếp tục.';
  if(state.office)for(const actor of state.office.agents){const n=state.nodes.get(actor.key);if(n)n.dataset.animated=String(actor.animate&&!state.paused);}
}
function togglePause() {
  state.paused=!state.paused;
  if(state.frames.length)setDemoPlaying(!state.paused);
  if(!state.paused&&state.pending){const pending=state.pending;state.pending=null;setSnapshot(pending,true);}
  updatePause();announce(state.paused?'Đã tạm dừng màn hình; agents vẫn làm việc.':'Tiếp tục cập nhật màn hình.');
}
function setTheme(theme) { document.documentElement.dataset.theme=theme;try{localStorage.setItem('agent-observatory-theme',theme);}catch{}$('theme-button').setAttribute('aria-label',theme==='dark'?'Chuyển sang giao diện sáng':'Chuyển sang giao diện tối'); }
function selectAgent(key) { state.selected=key;renderSelection();renderInspector();const actor=allActors().find(a=>a.key===key);if(actor)announce(`${actor.name}: ${actor.label}`); }
function updateOptions() {
  const sessions=state.office?.sessions||[];
  const signature=JSON.stringify([sessions.map(s=>[s.id,s.project]),state.filters.project]);if(signature===state.optionSignature)return;state.optionSignature=signature;
  const projects=[...new Set(sessions.map(s=>s.project))].sort((a,b)=>a.localeCompare(b,'vi'));
  const update=(select,list,first,value)=>{select.replaceChildren(el('option','',first));select.options[0].value='';for(const item of list){const o=el('option','',item.label);o.value=item.value;select.append(o);}select.value=value;};
  update($('project-filter'),projects.map(p=>({value:p,label:p})),'Tất cả dự án',state.filters.project);
  update($('session-filter'),sessions.filter(s=>!state.filters.project||s.project===state.filters.project).map(s=>({value:s.id,label:`${s.project} · ${s.id.slice(0,10)}`})),'Tất cả phiên',state.filters.session);
}
function updateConnection() {
  const source=state.office?.source;const offline=Boolean(state.error)||!state.connected;
  let label=state.demo?'Dữ liệu mẫu':state.snapshot?'Trực tiếp':'Đang kết nối';
  if(offline&&state.snapshot&&!state.demo)label='Mất kết nối';else if(state.error&&!state.snapshot)label='Chưa kết nối';else if(source?.stale&&!state.demo)label='Dữ liệu đã cũ';
  $('connection-label').textContent=label;$('connection-dot').className=`connection-dot ${offline?'offline':'live'}`;document.body.classList.toggle('is-offline',offline);
  $('demo-notice').hidden=!state.demo;$('demo-description').textContent=state.frames.length?'Phát lại một kịch bản minh họa. Không phải agents thật trên máy của bạn.':'Các hoạt động minh họa, không phải agent thật trên máy của bạn.';
  const warnings=source?.warnings||[];
  const message=state.error||(!state.demo&&source?.stale?'Một số agents chưa có sự kiện mới. Chuyển động đã dừng ở trạng thái cuối đã biết.':!state.demo&&warnings.length?warnings.join(' '):'');
  $('connection-notice').hidden=!message;$('connection-heading').textContent=state.error?'KẾT NỐI GIÁN ĐOẠN':'DỮ LIỆU CẦN CHÚ Ý';$('connection-message').textContent=message;$('retry-button').hidden=!state.error||state.static;
  $('updated-at').textContent=state.snapshot?`${state.demo?'Thời điểm mẫu':'Snapshot'}: ${clock(state.snapshot.generatedAt,true)}`:'Chưa nhận dữ liệu';
  $('local-clock').textContent=new Intl.DateTimeFormat('vi-VN',{hour:'2-digit',minute:'2-digit'}).format(now());
}
const ZONES={desk:{x:[.146,.313,.480],y:[.29,.497],dense:{x:[.112,.244,.376,.508],y:[.22,.36,.50]}},library:{x:[.718,.867],y:[.31],dense:{x:[.675,.754,.833,.912],y:[.21,.285,.36]}},terminal:{x:[.701,.793,.884],y:[.54],dense:{x:[.675,.754,.833,.912],y:[.46,.53,.60]}},meeting:{x:[.12,.265],y:[.81],dense:{x:[.082,.155,.228,.301],y:[.72,.80,.88]}},waiting:{x:[.421,.526],y:[.81],dense:{x:[.394,.448,.502,.556],y:[.72,.80,.88]}},lounge:{x:[.705,.815,.91],y:[.84],dense:{x:[.674,.753,.832,.911],y:[.73,.80,.88]}}};
function destinations(actors) {
  const result=new Map();
  for(const zone of Object.keys(ZONES)){
    const members=actors.filter(a=>a.zone===zone).sort((a,b)=>a.seat-b.seat);const cfg=ZONES[zone];const normal=cfg.x.length*cfg.y.length;const dense=members.length>normal;
    const grid=dense?cfg.dense:cfg;const occupied=new Set();
    for(const actor of members){const old=state.reservations.get(actor.key);let slot=old&&old.zone===zone&&old.dense===dense&&!occupied.has(old.slot)&&old.slot<grid.x.length*grid.y.length?old.slot:0;while(occupied.has(slot))slot++;occupied.add(slot);state.reservations.set(actor.key,{zone,slot,dense});result.set(actor.key,{x:grid.x[slot%grid.x.length]*100,y:grid.y[Math.floor(slot/grid.x.length)]*100,dense});}
  }
  return result;
}
function renderActors() {
  const actors=state.office?.agents||[];const visible=new Set(actors.map(a=>a.key));const positions=destinations(actors);
  for(const [key,node] of state.nodes)if(!visible.has(key)){clearTimeout(node._moveTimer);node.remove();state.nodes.delete(key);}
  for(const actor of actors){
    let node=state.nodes.get(actor.key);const position=positions.get(actor.key);
    if(!node){node=el('button','office-agent');node.type='button';node.append(avatar(actor.key),el('span','status-pin'),el('span','agent-name'),el('span','agent-phase'),el('span','speech-bubble'));node.addEventListener('click',()=>selectAgent(actor.key));$('agent-layer').append(node);state.nodes.set(actor.key,node);}
    node.dataset.phase=actor.phase;node.dataset.zone=actor.zone;node.dataset.animated=String(actor.animate&&!state.paused&&!state.error);node.classList.toggle('is-stale',actor.stale||!state.connected);node.classList.toggle('is-dense',position.dense);
    node.querySelector('.agent-name').textContent=actor.name;node.querySelector('.agent-phase').textContent=actor.stale?'Dữ liệu đã cũ':actor.label;node.querySelector('.status-pin').textContent=pins[actor.phase]||'?';node.querySelector('.speech-bubble').textContent=actor.tool?`${actor.tool.name} · ${actor.activity}`:actor.activity;
    node.setAttribute('aria-label',`${actor.name}, ${actor.label}, ${actor.activity}${actor.stale?', dữ liệu đã cũ':''}`);node.title=`${actor.name} · ${actor.project}\n${actor.label}\n${actor.activity}`;
    const changed=node.dataset.position&&node.dataset.position!==`${position.x},${position.y}`;
    node.style.left=`${position.x}%`;node.style.top=`${position.y}%`;node.dataset.position=`${position.x},${position.y}`;
    if(changed&&!state.paused&&state.connected&&!state.error&&!actor.stale&&!reducedMotion.matches){node.classList.add('is-moving');clearTimeout(node._moveTimer);node._moveTimer=setTimeout(()=>node.classList.remove('is-moving'),1100);}else if(!changed||state.paused||actor.stale||state.error)node.classList.remove('is-moving');
  }
  $('map-count').textContent=numeric(actors.length);const empty=actors.length===0;$('scene-empty').hidden=!empty;
  const filtering=state.filters.project||state.filters.session||state.filters.search||!state.filters.showCompleted;
  $('empty-title').textContent=filtering?'Không có agent phù hợp':state.error?'Chưa kết nối được văn phòng':'Văn phòng đang trống';$('empty-copy').textContent=filtering?'Thay đổi hoặc xóa bộ lọc để xem các agents khác.':state.error?'Kiểm tra local server rồi nhấn Thử lại. Không tự thay bằng dữ liệu mẫu.':'Nạp plugin trong Claude Code để nhận hoạt động agent.';
}
function renderRoster() {
  const actors=allActors();const keys=new Set(actors.map(a=>a.key));const visible=new Set(state.office.agents.map(a=>a.key));
  for(const [key,node]of state.rosterNodes)if(!keys.has(key)){node.remove();state.rosterNodes.delete(key);}
  for(const actor of actors){let node=state.rosterNodes.get(actor.key);if(!node){node=el('button','roster-agent');node.type='button';node.append(el('span'),el('span','roster-name'),el('small'));node.addEventListener('click',()=>selectAgent(actor.key));state.rosterNodes.set(actor.key,node);$('agent-roster').append(node);}node.querySelector('.roster-name').textContent=actor.name;node.querySelector('small').textContent=visible.has(actor.key)?actor.label:'Ngoài bản đồ';node.classList.toggle('overflow',!visible.has(actor.key));node.setAttribute('aria-label',`${actor.name}, ${actor.label}${visible.has(actor.key)?'':', ngoài bản đồ'}`);}
  $('overflow-note').textContent=state.office.overflow.length?`${state.office.overflow.length} agent ngoài bản đồ · chọn tên để xem`:`${actors.length} agents · ${new Set(actors.map(a=>a.sessionId)).size} phiên`;
}
function renderSelection() { for(const [key,n]of [...state.nodes,...state.rosterNodes]){n.classList.toggle('selected',key===state.selected);n.setAttribute('aria-pressed',String(key===state.selected));} }
function dataItem(label,value,wide=false) { const n=el('div',`data-item${wide?' wide':''}`);n.append(el('span','',label),el('strong','',value??'—'));return n; }
function section(title) { const n=el('section','inspector-section');n.append(el('h3','',title));return n; }
function renderInspector() {
  const container=$('inspector-content');const actor=allActors().find(a=>a.key===state.selected);
  if(!actor){container.replaceChildren();const empty=el('div','inspector-empty');empty.append(el('div','empty-mark','[ · · ]'),el('h2','','Gặp một agent'),el('p','','Chọn nhân vật hoặc tên để xem công việc và bằng chứng hoạt động.'));container.append(empty);$('inspector-indicator').textContent='—';return;}
  const session=state.snapshot.sessions.find(s=>s.id===actor.sessionId);const raw=session?.agents?.find(a=>a.id===actor.agentId)||{};
  const identity=el('div','inspector-identity'), title=el('div','inspector-title-row'), copy=el('div');copy.append(el('h2','inspector-title',actor.name),el('div','inspector-role',`${actor.role} · ${actor.project}`));title.append(avatar(actor.key,'inspector-avatar'),copy);identity.append(title,el('div','phase-badge',`${pins[actor.phase]||'—'}  ${actor.label}`),el('p','agent-current-activity',actor.activity));
  identity.append(el('p','evidence-note',`${actor.evidence.kind==='observed'?'Tín hiệu ghi nhận':actor.evidence.kind==='inferred'?'Trạng thái suy ra':'Chưa đủ tín hiệu'} · ${actor.evidence.detail}`));
  if(actor.stale||!state.connected)identity.append(el('p','inspector-note','Đang hiển thị trạng thái cuối đã biết. Chuyển động đã dừng.'));
  const task=section('CÔNG VIỆC');task.append(el('p','task-copy',actor.task||'Chưa có task được gán trong dữ liệu.'));
  const uniqueName=(session?.agents||[]).filter(a=>a.name===actor.name).length===1;
  const tasks=(session?.tasks||[]).filter(t=>t.owner===actor.agentId||(uniqueName&&t.owner===actor.name)).slice(0,4);
  for(const t of tasks){const item=el('div','task-row',t.subject||t.id);item.append(el('span','task-status',`${taskLabels[t.status]||t.status||'Chưa rõ'}${t.blockedBy?.length?` · Chờ: ${t.blockedBy.join(', ')}`:''}`));task.append(item);}
  const info=section('AGENT');const grid=el('div','data-grid');grid.append(dataItem('Tool calls',numeric(raw.toolCalls)),dataItem('Lỗi ghi nhận',numeric(raw.errors)),dataItem('Thời gian',duration(actor.startedAt,actor.endedAt)),dataItem('Sự kiện mới nhất',clock(actor.lastEventAt,true)),dataItem('Model',raw.model||'—',true));
  const parent=actor.parentId?session?.agents?.find(a=>a.id===actor.parentId):null;grid.append(dataItem('Agent cha',parent?.name||actor.parentId||'Chưa được báo',true));info.append(grid);
  const usage=section('USAGE ĐƯỢC BÁO');const tokens=el('div','data-grid');for(const [name,key]of [['Input','input'],['Output','output'],['Cache read','cacheRead'],['Cache write','cacheWrite']])tokens.append(dataItem(name,short(raw.tokens?.[key])));usage.append(tokens,el('p','inspector-note','— nghĩa là chưa có dữ liệu. Không suy ra token từ hoạt ảnh.'));
  const sessionInfo=section('PHIÊN CHỨA AGENT');const metrics=el('div','data-grid');metrics.append(dataItem('Context',number(session?.contextPercent)===null?'—':`${Math.round(session.contextPercent)}%`),dataItem('Chi phí phiên',money(session?.costUsd,session?.costEstimated!==false)),dataItem('Phiên',actor.sessionId,true));sessionInfo.append(metrics,el('p','inspector-note','Chi phí trên là tổng của phiên; không gán cho agent đang chọn.'));
  const history=section('TOOLS GẦN ĐÂY');const tools=Array.isArray(raw.tools)?raw.tools:[];if(!tools.length)history.append(el('p','inspector-note','Chưa ghi nhận tool.'));
  for(const t of tools.slice(0,5)){const row=el('div','tool-row'),head=el('div','tool-row-header');head.append(el('strong','',t.name||'Tool'),el('span','',toolLabels[t.status]||'Chưa rõ'));row.append(head,el('p','tool-summary',t.summary||'Chưa có metadata'),el('p','tool-summary',`${clock(t.startedAt,true)} · ${duration(t.startedAt,t.endedAt)}`));history.append(row);}
  if(raw.toolCalls>tools.length)history.append(el('p','inspector-note',`Đang giữ ${tools.length} tool gần đây trong ${raw.toolCalls} lần gọi đã ghi nhận.`));
  if(actor.phase==='completed')history.append(el('p','inspector-note','Đã kết thúc vòng đời không đồng nghĩa mọi bài kiểm tra đã pass.'));
  container.replaceChildren(identity,task,info,usage,sessionInfo,history);$('inspector-indicator').textContent=actor.stale?'Dữ liệu cũ':state.demo?'Dữ liệu mẫu':'Đã chọn';
}
function eventTitle(event) { const tool=event.title||event.type||'Sự kiện';return ({'agent.start':'Agent bắt đầu','agent.end':'Agent kết thúc','turn.start':'Bắt đầu lượt','turn.end':'Kết thúc lượt','model.start':'Bắt đầu gọi model','model.end':'Kết thúc gọi model','waiting':'Chờ phản hồi','task.update':'Cập nhật task'})[event.type]||tool; }
function renderEvents() {
  const actors=allActors();const events=[];for(const actor of actors){const session=state.snapshot.sessions.find(s=>s.id===actor.sessionId);const raw=session?.agents?.find(a=>a.id===actor.agentId);for(const event of raw?.events||[])if(!['usage','agent.metadata'].includes(event.type))events.push({...event,name:actor.name});}
  events.sort((a,b)=>(date(b.timestamp)||0)-(date(a.timestamp)||0));const list=$('recent-events');list.replaceChildren();
  for(const event of events.slice(0,3)){const n=el('div','recent-event');n.append(el('time','',clock(event.timestamp,true)),el('strong','',`${event.name} · ${eventTitle(event)}`),el('p','',event.detail||'Sự kiện được ghi nhận từ runtime'));list.append(n);}if(!events.length)list.append(el('span','muted','Chưa có sự kiện trong bộ lọc.'));
}
function render() {
  state.office=deriveOffice(state.snapshot,{now:now(),connected:state.connected&&!state.error,sessionId:state.filters.session,project:state.filters.project,search:state.filters.search,showCompleted:state.filters.showCompleted,previousSlots:state.slots,capacity:12});state.slots=state.office.slots;
  const actors=allActors();if(!actors.some(a=>a.key===state.selected))state.selected=actors.find(a=>a.phase==='waiting'||a.phase==='error')?.key||actors.find(a=>a.status==='running')?.key||actors[0]?.key||null;
  updateOptions();const counts=state.office.counts;const summary=$('office-summary');summary.replaceChildren();for(const [value,label]of [[counts.running,'đang làm'],[counts.waiting+counts.error,'cần chú ý'],[counts.total,'agents']]){const item=el('span','summary-item');item.append(el('strong','',numeric(value)),el('span','',label));summary.append(item);}
  $('reset-button').hidden=!(state.filters.project||state.filters.session||state.filters.search||!state.filters.showCompleted);
  renderActors();renderRoster();renderSelection();renderInspector();renderEvents();updateConnection();updatePause();
}
async function fetchSnapshot() {
  if(state.static){render();announce('Đây là bản xem thử độc lập với dữ liệu mẫu.');return;}
  const request=++state.request;state.loading=true;$('refresh-button').disabled=true;
  try{const response=await fetch(`/api/state${params.get('demo')==='1'?'?demo=1':''}`,{cache:'no-store',signal:AbortSignal.timeout(8000)});if(!response.ok)throw new Error(`HTTP ${response.status}`);const snapshot=await response.json();if(request!==state.request)return;setSnapshot(snapshot);if(snapshot.source?.mode==='demo'&&!state.demoRequested){state.demoRequested=true;try{const r=await fetch('/api/office-demo',{cache:'no-store',signal:AbortSignal.timeout(8000)});if(!r.ok)throw new Error();const data=await r.json();if(!setFrames(data.frames))throw new Error();}catch{state.error='Đã có snapshot mẫu, nhưng chưa tải được kịch bản phát lại.';updateConnection();}}}
  catch{if(request!==state.request)return;state.connected=false;state.error='Chưa đọc được local server. Giữ trạng thái cuối đã biết; agents không bị tác động.';render();}
  finally{if(request===state.request){state.loading=false;$('refresh-button').disabled=false;}}
}
function connectStream() {
  if(state.static||state.frames.length||!window.EventSource)return;state.source?.close();const source=new EventSource(`/api/events${params.get('demo')==='1'?'?demo=1':''}`);state.source=source;
  source.onopen=()=>{state.connected=true;state.error=null;render();};source.addEventListener('snapshot',event=>{try{setSnapshot(JSON.parse(event.data));}catch{state.error='Snapshot cập nhật chưa đúng định dạng.';state.connected=false;render();}});source.addEventListener('source-error',()=>{state.error='Collector chưa đọc được dữ liệu cục bộ. Giữ trạng thái cuối đã biết.';state.connected=false;render();});source.onerror=()=>{state.error='Kết nối realtime bị gián đoạn. Đang chờ kết nối lại.';state.connected=false;render();};
}
let theme=null;try{theme=localStorage.getItem('agent-observatory-theme');}catch{}setTheme(theme==='dark'?'dark':'light');
$('timezone-label').textContent=Intl.DateTimeFormat().resolvedOptions().timeZone;$('search-input').value=state.filters.search;
// The standalone exporter sets its sibling preview link; preserve that offline.
if(!state.static)$('dashboard-link').href=state.demo?'/?demo=1':'/';
$('theme-button').addEventListener('click',()=>setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark'));
$('pause-button').addEventListener('click',togglePause);$('refresh-button').addEventListener('click',()=>fetchSnapshot().then(connectStream));$('retry-button').addEventListener('click',()=>fetchSnapshot().then(connectStream));
$('project-filter').addEventListener('change',event=>{state.filters.project=event.target.value;state.filters.session='';render();});$('session-filter').addEventListener('change',event=>{state.filters.session=event.target.value;render();});$('search-input').addEventListener('input',event=>{state.filters.search=event.target.value;render();});$('show-completed').addEventListener('change',event=>{state.filters.showCompleted=event.target.checked;render();});$('reset-button').addEventListener('click',()=>{state.filters={project:'',session:'',search:'',showCompleted:true};state.optionSignature='';$('search-input').value='';$('show-completed').checked=true;render();});
$('demo-play').addEventListener('click',()=>{setDemoPlaying(!state.demoPlaying);});$('demo-prev').addEventListener('click',()=>{setDemoPlaying(false);applyFrame(state.frame-1);});$('demo-next').addEventListener('click',()=>{setDemoPlaying(false);applyFrame(state.frame+1);});$('demo-range').addEventListener('input',event=>{setDemoPlaying(false);applyFrame(Number(event.target.value));});
document.addEventListener('keydown',event=>{if(event.key==='/'&&!event.metaKey&&!event.ctrlKey&&!event.altKey&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){event.preventDefault();$('search-input').focus();}if(event.key==='Escape'&&document.activeElement===$('search-input')){state.filters.search='';$('search-input').value='';render();}});
document.addEventListener('visibilitychange',()=>{document.body.classList.toggle('is-paused',state.paused||document.hidden);});window.addEventListener('beforeunload',()=>{state.source?.close();clearInterval(state.demoTimer);});
window.AgentOffice=Object.freeze({setSnapshot,setFrames,getState:()=>({selected:state.selected,filters:{...state.filters},paused:state.paused,frame:state.frame,mode:state.demo?'demo':'live',visible:state.office?.agents.length||0,overflow:state.office?.overflow.length||0})});
if(!setFrames(window.__AGENT_OBSERVATORY_OFFICE_FRAMES__)){if(window.__AGENT_OBSERVATORY_SNAPSHOT__){const snapshot=window.__AGENT_OBSERVATORY_SNAPSHOT__;setSnapshot({...snapshot,source:{...snapshot.source,mode:'demo'}});}else{render();fetchSnapshot().then(connectStream);}}
setInterval(()=>{if(!state.paused&&!state.static&&!state.demo&&state.snapshot)render();},10000);
