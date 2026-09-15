const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const STORE = 'gbpjpy_radar_trades_v1';
let current = null;
let lastNotifiedKey = localStorage.getItem('gbpjpy_last_notified') || '';

function fmt(n){ return Number.isFinite(Number(n)) ? Number(n).toFixed(3) : '—'; }
function nowIso(){ return new Date().toISOString(); }
function uid(){ return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(16).slice(2)}`; }
function trades(){ try{return JSON.parse(localStorage.getItem(STORE)||'[]')}catch{return[]} }
function saveTrades(list){ localStorage.setItem(STORE,JSON.stringify(list)); renderJournal(); renderStats(); }

async function refresh(){
  $('#refreshBtn').disabled = true;
  $('#feedStatus').className = 'dot-label';
  $('#feedStatus').innerHTML = '<i></i> Actualizando';
  try{
    const r = await fetch('/api/market', { cache:'no-store' });
    const data = await r.json();
    if(!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
    current = data;
    renderMarket(data);
    maybeNotify(data);
  }catch(err){
    $('#feedStatus').className = 'dot-label bad';
    $('#feedStatus').innerHTML = '<i></i> Sin feed';
    $('#verdict').className = 'verdict neutral';
    $('#verdict').textContent = 'SIN DATOS';
    $('#signalSubtitle').textContent = err.message || String(err);
  }finally{
    $('#refreshBtn').disabled = false;
  }
}

function renderMarket(d){
  $('#feedStatus').className = 'dot-label ok';
  $('#feedStatus').innerHTML = '<i></i> Feed activo';
  $('#sourceText').textContent = `Feed: ${d.source}`;
  $('#price').textContent = fmt(d.price);
  $('#support').textContent = fmt(d.support);
  $('#resistance').textContent = fmt(d.resistance);
  $('#lastTime').textContent = new Date(d.candleTime).toLocaleString('es-MX',{hour:'2-digit',minute:'2-digit',day:'2-digit',month:'short'});
  const trendMap = {BULLISH:'ALCISTA',BEARISH:'BAJISTA',NEUTRAL:'NEUTRAL'};
  $('#trend').textContent = `${trendMap[d.trend.trend]||d.trend.trend} · ${d.trend.highStructure}/${d.trend.lowStructure}`;
  $('#trend').className = d.trend.trend==='BULLISH'?'trend-bull':d.trend.trend==='BEARISH'?'trend-bear':'';
  $('#score').textContent = `${d.passedChecks}/${d.totalChecks}`;

  const v = $('#verdict');
  const plan = $('#tradePlan');
  if(d.verdict === 'BUY' || d.verdict === 'SELL'){
    v.textContent = `${d.verdict} · TRADE`;
    v.className = `verdict ${d.verdict.toLowerCase()}`;
    $('#signalSubtitle').textContent = `Confluencia completa. Riesgo técnico: ${d.riskPips} pips.`;
    $('#entry').textContent = fmt(d.entry); $('#sl').textContent = fmt(d.sl); $('#tp').textContent = fmt(d.tp); $('#rr').textContent = '1:2';
    plan.classList.remove('hidden');
    $('#recordSignalBtn').classList.remove('hidden');
  } else {
    v.textContent = 'NO TRADE';
    v.className = 'verdict neutral';
    $('#signalSubtitle').textContent = `Faltan condiciones: ${d.totalChecks-d.passedChecks}. Esperar.`;
    plan.classList.add('hidden');
    $('#recordSignalBtn').classList.add('hidden');
  }

  $('#checklist').innerHTML = (d.checklist||[]).map(c=>`<div class="check ${c.pass?'pass':''}"><b>${c.pass?'✓':'×'}</b><span>${escapeHtml(c.label)}</span></div>`).join('');
}

function maybeNotify(d){
  if(!['BUY','SELL'].includes(d.verdict) || Notification.permission!=='granted') return;
  const key = `${d.verdict}_${d.candleTime}`;
  if(key===lastNotifiedKey) return;
  lastNotifiedKey = key; localStorage.setItem('gbpjpy_last_notified',key);
  new Notification(`GBPJPY ${d.verdict} · TRADE`, {body:`Entrada ${fmt(d.entry)} · SL ${fmt(d.sl)} · TP ${fmt(d.tp)} · 2:1`, icon:'/icon-192.png'});
}

async function enableNotifications(){
  if(!('Notification' in window)) return alert('Este navegador no soporta notificaciones web.');
  const p = await Notification.requestPermission();
  $('#notifyBtn').textContent = p==='granted'?'Avisos activados':'Activar avisos';
}

function addCurrentSignal(){
  if(!current || !['BUY','SELL'].includes(current.verdict)) return;
  const list = trades();
  const key = `${current.verdict}_${current.candleTime}`;
  if(list.some(t=>t.signalKey===key)) return alert('Esta señal ya está registrada.');
  list.unshift({
    id:uid(), signalKey:key, source:'RADAR', side:current.verdict,
    entry:current.entry, sl:current.sl, tp:current.tp, rr:2,
    createdAt:nowIso(), candleTime:current.candleTime, result:'OPEN', r:null,
    notes:`Tendencia 15M ${current.trend.trend}. Checklist ${current.passedChecks}/${current.totalChecks}.`
  });
  saveTrades(list);
}

function calcR(t){ if(t.result==='WIN')return 2;if(t.result==='LOSS')return -1;if(t.result==='BE')return 0;return null; }
function renderStats(){
  const closed = trades().filter(t=>['WIN','LOSS','BE'].includes(t.result));
  const wins = closed.filter(t=>t.result==='WIN').length;
  const losses = closed.filter(t=>t.result==='LOSS').length;
  const totalR = closed.reduce((s,t)=>s+(Number.isFinite(Number(t.r))?Number(t.r):calcR(t)||0),0);
  $('#statTrades').textContent = trades().length;
  $('#statWinRate').textContent = (wins+losses) ? `${(wins/(wins+losses)*100).toFixed(1)}%` : '—';
  $('#statR').textContent = `${totalR>=0?'+':''}${totalR.toFixed(2)}R`;
  $('#statExpectancy').textContent = closed.length ? `${totalR>=0?'+':''}${(totalR/closed.length).toFixed(2)}R/trade` : '—';
}

async function renderJournal(){
  const list = trades();
  $('#emptyJournal').classList.toggle('hidden',list.length>0);
  const el = $('#journal'); el.innerHTML='';
  for(const t of list){
    const div=document.createElement('article'); div.className='trade';
    const r=Number.isFinite(Number(t.r))?Number(t.r):calcR(t);
    div.innerHTML=`
      <div class="trade-top"><div><div class="trade-side ${t.side.toLowerCase()}">${t.side} · ${t.result}</div><div class="trade-meta">${new Date(t.createdAt).toLocaleString('es-MX')} · ${t.source||'MANUAL'}</div></div>${r!=null?`<strong class="${r>0?'trend-bull':r<0?'trend-bear':''}">${r>0?'+':''}${r}R</strong>`:''}</div>
      <div class="trade-levels"><span>Entrada <b>${fmt(t.entry)}</b></span><span>SL <b>${fmt(t.sl)}</b></span><span>TP <b>${fmt(t.tp)}</b></span></div>
      <div class="trade-notes">${escapeHtml(t.notes||'Sin notas')}</div>
      <div class="result-buttons"><button data-result="WIN" class="result-win">✓ Win +2R</button><button data-result="LOSS" class="result-loss">× Loss -1R</button><button data-result="BE">BE 0R</button><button data-result="OPEN">Reabrir</button></div>
      <div class="trade-actions"><button data-note class="secondary">Notas</button><label class="file-label">Captura<input type="file" accept="image/*" data-shot></label><button data-delete class="secondary">Eliminar</button></div>
      <div data-shotbox></div>`;
    div.querySelectorAll('[data-result]').forEach(b=>b.onclick=()=>setResult(t.id,b.dataset.result));
    div.querySelector('[data-note]').onclick=()=>editNotes(t.id);
    div.querySelector('[data-delete]').onclick=()=>deleteTrade(t.id);
    div.querySelector('[data-shot]').onchange=e=>saveShot(t.id,e.target.files?.[0]);
    const shot=await getShot(t.id); if(shot){ const img=document.createElement('img');img.src=shot;img.className='shot';div.querySelector('[data-shotbox]').appendChild(img); }
    el.appendChild(div);
  }
}
function setResult(id,result){ const list=trades();const t=list.find(x=>x.id===id);if(!t)return;t.result=result;t.r=result==='WIN'?2:result==='LOSS'?-1:result==='BE'?0:null;saveTrades(list); }
function editNotes(id){ const list=trades();const t=list.find(x=>x.id===id);if(!t)return;const n=prompt('Notas de la operación:',t.notes||'');if(n===null)return;t.notes=n;saveTrades(list); }
function deleteTrade(id){ if(!confirm('¿Eliminar esta operación del diario?'))return;saveTrades(trades().filter(t=>t.id!==id));deleteShot(id); }

function escapeHtml(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

function openDb(){return new Promise((res,rej)=>{const r=indexedDB.open('gbpjpy-radar',1);r.onupgradeneeded=()=>r.result.createObjectStore('shots');r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});}
async function saveShot(id,file){ if(!file)return; if(file.size>4_000_000)return alert('Usa una captura menor a 4 MB.'); const data=await fileToData(file);const db=await openDb();db.transaction('shots','readwrite').objectStore('shots').put(data,id);renderJournal(); }
async function getShot(id){try{const db=await openDb();return await new Promise((res,rej)=>{const r=db.transaction('shots').objectStore('shots').get(id);r.onsuccess=()=>res(r.result||null);r.onerror=()=>rej(r.error);});}catch{return null}}
async function deleteShot(id){try{const db=await openDb();db.transaction('shots','readwrite').objectStore('shots').delete(id);}catch{}}
function fileToData(file){return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(r.error);r.readAsDataURL(file);});}

function openManual(){ $('#manualDialog').showModal(); if(current?.price)$('#manualEntry').value=current.price; }
$$('[data-close]').forEach(b=>b.onclick=()=>$('#manualDialog').close());
$('#manualForm').onsubmit=async e=>{
  e.preventDefault();
  const side=$('#manualSide').value, entry=Number($('#manualEntry').value), sl=Number($('#manualSl').value), tp=Number($('#manualTp').value);
  if(![entry,sl,tp].every(Number.isFinite))return;
  const id=uid(); const list=trades(); list.unshift({id,source:'MANUAL',side,entry,sl,tp,rr:2,createdAt:nowIso(),result:'OPEN',r:null,notes:$('#manualNotes').value.trim()}); saveTrades(list);
  const f=$('#manualShot').files?.[0]; if(f)await saveShot(id,f);
  $('#manualForm').reset(); $('#manualDialog').close(); renderJournal();
};

$('#refreshBtn').onclick=refresh;
$('#notifyBtn').onclick=enableNotifications;
$('#recordSignalBtn').onclick=addCurrentSignal;
$('#manualBtn').onclick=openManual;

if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{});
renderJournal();renderStats();refresh();
setInterval(refresh,5*60*1000);
