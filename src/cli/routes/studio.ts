import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import type * as http from 'node:http';
import * as path from 'node:path';
import { StudioPage } from '../../support/custom-dashboard/pages/web-studio';
import { resolveAppEnv } from '../../utils/app-env';
import { persistRunSettings } from '../studio-run';
import { htmlResponse, isRecord, jsonResponse, readBody, validationError } from './helpers';

const REPO_ROOT = path.resolve(__dirname, '../../..');
export const SLUG_RE = /^[a-z0-9-]+$/;

export interface StudioRequirementInput {
  slug: string;
  title: string;
  module: string;
  feature: string;
  authState: string;
  halamanAwal: string;
  scenarioTitle: string;
  steps: string;
  expected: string;
  /** Extra scenarios. Absent/empty → the single SC-01 path above, byte-identical. */
  scenarios?: Array<{ title?: string; steps?: string; expected?: string }>;
}

/**
 * Shared markdown shape for one scenario block (SC-01 == TC-01).
 * Table form: label column keeps the exact names the parsers read.
 */
export function scenarioBlock(
  index: number,
  title: string,
  steps: string,
  expected: string,
): string {
  const n = String(index).padStart(2, '0');
  const stepItems = numbered(steps)
    .split('\n')
    .map((line) => line.replace(/\|/g, '\\|'))
    .join('<br>');
  const expectedItems = expected
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*]\s*/, '').replace(/\|/g, '\\|'))
    .join('<br>');
  return `### SC-${n}: ${title} (@success)

| Field | Nilai |
| --- | --- |
| Test ID | TC-${n} |
| Covers | AC-01 |
| Langkah | ${stepItems} |
| Hasil yang Diharapkan | ${expectedItems} |`;
}

function str(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === 'string' ? value.trim() : '';
}

function numbered(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const items = lines.length > 0 ? lines : ['Buka halaman awal'];
  return items.map((line, i) => `${i + 1}. ${line.replace(/^\d+\.\s*/, '')}`).join('\n');
}

/** Pure markdown matching requirements/_TEMPLATE.md shape. */
export function buildRequirementMarkdown(input: StudioRequirementInput): string {
  const expected = input.expected.trim() || 'Halaman menampilkan hasil yang diharapkan.';
  const title = input.title.trim() || input.slug;
  const blocks = (input.scenarios ?? []).map((s, i) => {
    const exp = (s.expected ?? '').trim() || expected;
    return scenarioBlock(i + 1, (s.title ?? '').trim() || title, s.steps ?? '', exp);
  });
  const scenarios =
    blocks.length > 0
      ? blocks.join('\n\n')
      : scenarioBlock(1, input.scenarioTitle.trim() || title, input.steps, expected);
  return `# REQ-XXX: ${title}

## Metadata

| Field | Nilai |
| --- | --- |
| Tags | #ui |
| Prioritas | medium |
| Auth state | ${input.authState} |
| Halaman awal | ${input.halamanAwal.trim() || '/'} |
| Module | ${input.module.trim() || 'general'} |
| Feature | ${input.feature.trim() || input.slug} |

## Kriteria Penerimaan

| ID | Kriteria |
| --- | --- |
| AC-01 | ${expected.replace(/\|/g, '\\|')} |

## Skenario Uji
${scenarios}
`;
}

/**
 * The /studio page — the dashboard-styled control panel.
 *
 * The markup lives in `StudioPage` (custom-dashboard pages) so it inherits the
 * dashboard shell/tokens; only the ONE behavioural script stays here, next to
 * the server-side markdown builder it must stay byte-identical to.
 */
export function renderStudioPage(): string {
  return String(StudioPage({ serveMode: true })).replace(
    '</body>',
    `${renderStudioScript()}</body>`,
  );
}

/**
 * Single inline `<script>` binding every control on /studio.
 *
 * Contract: the browser suite asserts this script loads with ZERO pageerror /
 * console error, and that its `markdown()` output is byte-identical to the
 * server's `buildRequirementMarkdown`. Keep the two in step.
 */
export function renderStudioScript(): string {
  return `<script>
const ids=['slug','title','module','feature','authState','halamanAwal','scenarioTitle','steps','expected'];
function val(id){var el=document.getElementById(id);return el?el.value.trim():''}
function NL(){return String.fromCharCode(10)}
function numbered(text){
  const lines=text.split(NL()).map(s=>s.trim()).filter(Boolean);
  const items=lines.length?lines:['Buka halaman awal'];
  return items.map((line,i)=>{const m=line.match(/^[0-9]+[.] */);return (i+1)+'. '+(m?line.slice(m[0].length):line)}).join(NL());
}
function escPipe(v){return String(v).split(String.fromCharCode(124)).join(String.fromCharCode(92)+String.fromCharCode(124))}
function scenarioBlock(i,title,steps,expected){
  const n=(''+i).padStart(2,'0');
  const stepItems=numbered(steps).split(NL()).map(escPipe).join('<br>');
  const expectedItems=expected.split(NL()).map(s=>s.trim()).filter(Boolean).map(s=>s.replace(/^[-*] */,'').replace(/^[*]+ */,'')).map(escPipe).join('<br>');
  const rows=[['Test ID','TC-'+n],['Covers','AC-01'],['Langkah',stepItems],['Hasil yang Diharapkan',expectedItems]];
  return ['### SC-'+n+': '+title+' (@success)','','| Field | Nilai |','| --- | --- |'].concat(rows.map(r=>'| '+r[0]+' | '+r[1]+' |')).join(NL());
}
function extraScenarios(){
  return [...document.querySelectorAll('.scenario')].map(b=>({title:b.querySelector('.sc-title').value,steps:b.querySelector('.sc-steps').value,expected:b.querySelector('.sc-expected').value}));
}
function addBlock(title,steps,expected){
  const box=document.getElementById('scenarios');
  const n=box.children.length+1;
  const wrap=document.createElement('div');
  wrap.className='scenario';
  [['sc-title','input','Skenario '+n+' — judul',title],['sc-steps','textarea','Langkah',steps],['sc-expected','textarea','Hasil yang diharapkan',expected]].forEach(f=>{
    const l=document.createElement('label');
    l.className='studio-field studio-field--wide';
    const cap=document.createElement('span');
    cap.className='studio-field__label';
    cap.textContent=f[2];
    const el=document.createElement(f[1]);
    el.className=f[0]+(f[1]==='textarea'?' form-textarea':' form-input');
    el.value=f[3];
    l.append(cap,el);
    wrap.append(l);
  });
  box.append(wrap);
}
function markdown(){
  const slug=val('slug'), title=val('title')||slug, expected=val('expected')||'Halaman menampilkan hasil yang diharapkan.';
  const extra=extraScenarios();
  const blocks=extra.length?extra.map((s,i)=>scenarioBlock(i+1,s.title.trim()||title,s.steps,s.expected.trim()||expected)):[scenarioBlock(1,val('scenarioTitle')||title,val('steps'),expected)];
  const metaRows=[['Tags','#ui'],['Prioritas','medium'],['Auth state',val('authState')],['Halaman awal',val('halamanAwal')||'/'],['Module',val('module')||'general'],['Feature',val('feature')||slug]];
  const acRows=[['AC-01',escPipe(expected)]];
  const table=(rows)=>['| Field | Nilai |','| --- | --- |'].concat(rows.map(r=>'| '+r[0]+' | '+r[1]+' |')).join(NL());
  const acTable=['| ID | Kriteria |','| --- | --- |'].concat(acRows.map(r=>'| '+r[0]+' | '+r[1]+' |')).join(NL());
  return ['# REQ-XXX: '+title,'','## Metadata','',table(metaRows),'','## Kriteria Penerimaan','',acTable,'','## Skenario Uji',blocks.join(NL()+NL()),''].join(NL());
}
function refresh(){document.getElementById('preview').textContent=markdown()}
ids.forEach(id=>{const el=document.getElementById(id);if(el)el.addEventListener('input',refresh)});
document.getElementById('scenarios').addEventListener('input',refresh);
document.getElementById('addScenario').addEventListener('click',()=>{
  if(!document.querySelector('.scenario')){
    addBlock(val('scenarioTitle'),val('steps'),val('expected'));
    document.getElementById('legacy').hidden=true;
  }else{
    addBlock('','','');
  }
  refresh();
});
refresh();
// ── Inline Lucide icons (no emoji, no network) ───────────────────────────────
const ICONS={
  ok:'<path d="M21.801 10A10 10 0 1 1 17 3.335"/><path d="m9 11 3 3L22 4"/>',
  bad:'<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
  unknown:'<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  warn:'<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  close:'<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'
};
function iconSvg(name,size){
  const body=ICONS[name]||ICONS.unknown;
  return '<svg viewBox="0 0 24 24" width="'+(size||14)+'" height="'+(size||14)+'" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+body+'</svg>';
}
function toast(type,title,desc){ if(window.studioToast)window.studioToast({type:type,title:title,desc:desc}); }

// ── Tabs (shadcn anatomy: tablist of triggers + panels) ──────────────────────
(function(){
  const tabs=[...document.querySelectorAll('[data-studio-tab]')];
  const panels=[...document.querySelectorAll('[data-studio-panel]')];
  if(!tabs.length)return;
  function activate(id,focus){
    tabs.forEach(t=>{
      const on=t.getAttribute('data-studio-tab')===id;
      t.setAttribute('aria-selected',on?'true':'false');
      t.tabIndex=on?0:-1;
      if(on&&focus)t.focus();
    });
    panels.forEach(p=>{p.hidden=p.getAttribute('data-studio-panel')!==id});
    try{history.replaceState(null,'','#'+id)}catch(e){}
  }
  tabs.forEach(t=>t.addEventListener('click',()=>activate(t.getAttribute('data-studio-tab'))));
  document.querySelector('.studio-tablist').addEventListener('keydown',(ev)=>{
    const i=tabs.findIndex(t=>t.getAttribute('aria-selected')==='true');
    if(ev.key==='ArrowRight'||ev.key==='ArrowDown'){ev.preventDefault();activate(tabs[(i+1)%tabs.length].getAttribute('data-studio-tab'),true)}
    else if(ev.key==='ArrowLeft'||ev.key==='ArrowUp'){ev.preventDefault();activate(tabs[(i-1+tabs.length)%tabs.length].getAttribute('data-studio-tab'),true)}
    else if(ev.key==='Home'){ev.preventDefault();activate(tabs[0].getAttribute('data-studio-tab'),true)}
    else if(ev.key==='End'){ev.preventDefault();activate(tabs[tabs.length-1].getAttribute('data-studio-tab'),true)}
  });
  const hash=(location.hash||'').replace('#','');
  activate(tabs.some(t=>t.getAttribute('data-studio-tab')===hash)?hash:tabs[0].getAttribute('data-studio-tab'));
})();

// ── Requirement save ────────────────────────────────────────────────────────
document.getElementById('f').addEventListener('submit',async (ev)=>{
  ev.preventDefault();
  const body={};
  ids.forEach(id=>body[id]=val(id));
  const extra=extraScenarios();
  if(extra.length)body.scenarios=extra;
  const slug=val('slug');
  const proceed=await window.studioConfirm({
    title:'Simpan requirement?',
    desc:'File requirements/'+(slug||'…')+'.md akan ditulis dan divalidasi. Bila slug sudah ada, penyimpanan ditolak.',
    confirmLabel:'Simpan',
    cancelLabel:'Batal'
  });
  if(!proceed)return;
  try{
    const res=await fetch('/api/studio/requirement',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await res.json().catch(()=>({}));
    if(res.ok)toast('success','Requirement tersimpan',data.path||'File requirement dibuat & lolos validasi.');
    else toast('error','Gagal menyimpan',data.error||res.statusText);
  }catch(e){toast('error','Gagal menyimpan',String(e))}
});

// ── Preview toggle (side-by-side ⇄ full width) ───────────────────────────────
(function(){
  const btn=document.getElementById('previewToggle');
  const label=document.getElementById('previewToggleLabel');
  const split=document.getElementById('studio-split');
  if(!btn||!split)return;
  btn.addEventListener('click',()=>{
    const hidden=split.classList.toggle('studio-split--preview-hidden');
    btn.setAttribute('aria-expanded',hidden?'false':'true');
    if(label)label.textContent=hidden?'Tampilkan pratinjau':'Sembunyikan pratinjau';
  });
})();

// ── Environment + role status ────────────────────────────────────────────────
function roleTone(status){
  if(status==='valid')return {icon:'ok',cls:'studio-role--ok',label:'siap'};
  if(status==='expired')return {icon:'bad',cls:'studio-role--bad',label:'kedaluwarsa'};
  if(status==='malformed')return {icon:'bad',cls:'studio-role--bad',label:'rusak'};
  return {icon:'unknown',cls:'studio-role--unknown',label:'belum ada'};
}
function showEnv(data){
  const box=document.getElementById('env');
  if(!box)return;
  box.replaceChildren();
  const head=document.createElement('p');
  head.className='studio-envstatus__head';
  head.textContent='Environment aktif: '+(data&&data.appEnv!=null?data.appEnv:'—');
  box.append(head);
  const roles=data&&Array.isArray(data.roles)?data.roles:[];
  if(roles.length===0){
    const p=document.createElement('p');
    p.className='studio-hint';
    p.textContent='Belum ada sesi login. Klik "Refresh sesi login" untuk membuat sesi.';
    box.append(p);
    return;
  }
  const ul=document.createElement('ul');
  ul.className='studio-roles';
  roles.forEach(r=>{
    const t=roleTone(r&&r.status);
    const li=document.createElement('li');
    li.className='studio-role '+t.cls;
    li.innerHTML=iconSvg(t.icon,14);
    li.append(document.createTextNode(' '+(r&&r.role!=null?r.role:'?')+' — '+t.label));
    if(r&&r.reason){li.title=r.reason}
    ul.append(li);
  });
  box.append(ul);
  const sel=document.getElementById('appenv');
  if(sel&&data&&data.appEnv){sel.value=data.appEnv}
}
fetch('/api/studio/env').then(r=>r.json()).then(showEnv).catch(()=>{});
document.getElementById('envbtn').addEventListener('click',async ()=>{
  const appEnv=document.getElementById('appenv').value;
  const proceed=await window.studioConfirm({
    title:'Pakai environment '+appEnv+'?',
    desc:appEnv==='production'
      ?'Ini environment PRODUCTION. Sesi login akan perlu di-refresh setelah berganti.'
      :'Environment aktif berganti ke '+appEnv+'. Sesi login mungkin perlu di-refresh.',
    confirmLabel:'Pakai '+appEnv,
    tone:appEnv==='production'?'danger':'default'
  });
  if(!proceed)return;
  try{
    const res=await fetch('/api/studio/env',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({appEnv,confirmProduction:appEnv==='production'})});
    const txt=await res.text();
    if(res.ok){toast('success','Environment berganti','Aktif: '+appEnv);fetch('/api/studio/env').then(r=>r.json()).then(showEnv)}
    else toast('error','Gagal berganti environment',txt);
  }catch(e){toast('error','Gagal berganti environment',String(e))}
});
document.getElementById('authbtn').addEventListener('click',async ()=>{
  try{
    const res=await fetch('/api/studio/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({headed:document.getElementById('headed').checked})});
    const txt=await res.text();
    if(!res.ok){toast('error','Gagal memulai refresh sesi',txt);return}
    toast('loading','Refresh sesi login','Menunggu proses login selesai…',0);
    for(let i=0;i<30;i++){
      await new Promise(r=>setTimeout(r,2000));
      const st=await fetch('/api/studio/auth').then(r=>r.json());
      if(st.running)continue;
      if(st.lastCode===0)toast('success','Sesi login siap','Sesi berhasil dibuat & disimpan.');
      else toast('error','Refresh sesi gagal','Kode keluar: '+st.lastCode);
      fetch('/api/studio/env').then(r=>r.json()).then(showEnv);
      return;
    }
  }catch(e){toast('error','Gagal refresh sesi',String(e))}
});

// ── Spec combobox (multi-select, searchable) ─────────────────────────────────
const selectedSpecs=new Set();
(function(){
  const input=document.getElementById('spec');
  const menu=document.getElementById('specmenu');
  const chips=document.getElementById('specchips');
    const native=document.getElementById('speclist');
  let allSpecs=[];
  function syncHidden(){
    const arr=[...selectedSpecs];
    if(native){
      [...native.options].forEach(o=>{o.selected=selectedSpecs.has(o.value)});
    }
    if(chips){
      chips.replaceChildren();
      arr.forEach(s=>{
        const c=document.createElement('span');
        c.className='studio-chip';
        c.append(document.createTextNode(s));
        const x=document.createElement('button');
        x.type='button';
        x.className='studio-chip__x';
        x.setAttribute('aria-label','Hapus '+s);
        x.innerHTML=iconSvg('close',12);
        x.addEventListener('click',()=>{selectedSpecs.delete(s);syncHidden();renderMenu()});
        c.append(x);
        chips.append(c);
      });
    }
  }
  function renderMenu(){
    if(!menu)return;
    const q=(input?input.value:'').trim().toLowerCase();
    const items=allSpecs.filter(s=>!q||s.toLowerCase().includes(q));
    menu.replaceChildren();
    if(!items.length){
      const e=document.createElement('p');
      e.className='studio-combo__empty';
      e.textContent='Tidak ada spec cocok.';
      menu.append(e);
      return;
    }
    items.forEach(s=>{
      const o=document.createElement('button');
      o.type='button';
      o.className='studio-combo__item'+(selectedSpecs.has(s)?' is-selected':'');
      o.setAttribute('role','option');
      o.setAttribute('aria-selected',selectedSpecs.has(s)?'true':'false');
      o.append(document.createTextNode(s));
      if(selectedSpecs.has(s))o.insertAdjacentHTML('beforeend',iconSvg('ok',13));
      o.addEventListener('click',()=>{
        if(selectedSpecs.has(s))selectedSpecs.delete(s);else selectedSpecs.add(s);
        syncHidden();
        renderMenu();
        if(input)input.focus();
      });
      menu.append(o);
    });
  }
  function openMenu(){ if(menu){menu.hidden=false; if(input)input.setAttribute('aria-expanded','true'); renderMenu(); } }
  function closeMenu(){ if(menu){menu.hidden=true; if(input)input.setAttribute('aria-expanded','false'); } }
  if(input){
    input.addEventListener('focus',openMenu);
    input.addEventListener('input',()=>{openMenu();renderMenu()});
    input.addEventListener('keydown',(ev)=>{ if(ev.key==='Escape')closeMenu(); });
  }
  document.addEventListener('click',(ev)=>{
    const combo=document.getElementById('speccombo');
    const path=typeof ev.composedPath==='function'?ev.composedPath():[];
    const inside=combo&&(combo.contains(ev.target)||path.indexOf(combo)!==-1);
    if(!inside)closeMenu();
  });
  fetch('/api/studio/specs').then(r=>r.json()).then(data=>{
    allSpecs=Array.isArray(data)?data:(data&&Array.isArray(data.specs)?data.specs:[]);
    if(native){
      native.replaceChildren();
      native.append(new Option('Pilih spec', ''));
      allSpecs.forEach(s=>{const o=document.createElement('option');o.value=s;o.textContent=s;native.append(o)});
    }
    renderMenu();
  }).catch(()=>{});
})();

// ── Run controls ─────────────────────────────────────────────────────────────
const logEl=document.getElementById('log');
const logWrap=document.getElementById('logwrap');
let es=null;
function logLine(text){ if(logEl)logEl.textContent+=text+NL() }
function listen(){
  if(es)es.close();
  es=new EventSource('/events');
  es.addEventListener('run-log',ev=>{const d=JSON.parse(ev.data);logLine(d.line)});
  es.addEventListener('run-done',ev=>{
    const d=JSON.parse(ev.data);
    logLine('exit '+d.code);
    setRunning(false);
    loadSummary();
    if(d.code===0)toast('success','Run selesai','Semua langkah berjalan tanpa kegagalan.');
    else toast('warning','Run selesai dengan catatan','Ada kegagalan atau skip — lihat ringkasan & dashboard.');
  });
}
listen();
// Slow-mo only matters when a real browser window is shown (headed).
(function(){
  const mode=document.getElementById('headlessmode');
  const field=document.getElementById('slowmofield');
  if(!mode||!field)return;
  function sync(){ field.hidden = mode.value!=='false'; }
  mode.addEventListener('change',sync);
  sync();
})();
function runSettings(){
  const width=val('vpwidth'), height=val('vpheight');
  const mode=document.getElementById('headlessmode').value;
  const order=document.getElementById('runorder').value;
  const out={headless:mode==='true',serial:order==='serial'};
  if(mode==='false')out.slowMo=Number(val('slowmo')||0)||0;
  if(width&&height)out.viewport=width+'x'+height;
  return out;
}
function summaryChip(icon,text,tone){
  const span=document.createElement('span');
  span.className='studio-summary__chip'+(tone?' studio-summary__chip--'+tone:'');
  span.innerHTML=iconSvg(icon,13);
  span.append(document.createTextNode(' '+text));
  return span;
}
function loadSummary(){
  fetch('/api/dashboard').then(r=>r.json()).then(d=>{
    const s=d&&d.latestRun?d.latestRun:null;
    const box=document.getElementById('runsummary');
    if(!s||!box)return;
    box.replaceChildren();
    if(s.passed!=null)box.append(summaryChip('ok',s.passed+' lulus','ok'));
    if(s.failed!=null)box.append(summaryChip(s.failed>0?'bad':'ok',s.failed+' gagal',s.failed>0?'bad':null));
    if(s.skipped!=null)box.append(summaryChip('unknown',s.skipped+' di-skip',null));
    if(s.notImplemented!=null)box.append(summaryChip('warn',s.notImplemented+' belum dibangun',null));
    if(!box.children.length)box.append(document.createTextNode('Ringkasan tidak tersedia.'));
    const a=document.createElement('a');
    a.className='btn btn-secondary';
    a.href='/dashboard';
    a.textContent='Lihat detail di Dashboard';
    box.append(a);
    box.hidden=false;
  }).catch(()=>{});
}
function setRunning(on){
  const stop=document.getElementById('stopbtn');
  const run=document.getElementById('runbtn');
  if(stop)stop.hidden=!on;
  if(run)run.disabled=on;
}
async function doRun(){
  const specs=[...selectedSpecs];
  if(!specs.length){toast('warning','Pilih spec dulu','Cari dan pilih satu atau beberapa spec dari daftar.');return}
  const s=runSettings();
  if(logWrap){logWrap.hidden=false;logWrap.open=true}
  if(logEl)logEl.textContent='';
  const res=await fetch('/api/studio/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({specs:specs,slowMo:s.slowMo,headless:s.headless,viewport:s.viewport,serial:s.serial})});
  const txt=await res.text();
  if(res.ok){setRunning(true);toast('info','Menjalankan '+specs.length+' spec',specs.join(', '))}
  else{setRunning(false);logLine(txt);toast('error','Tidak bisa menjalankan',txt)}
}
document.getElementById('runbtn').addEventListener('click',doRun);
document.getElementById('stopbtn').addEventListener('click',async ()=>{
  const res=await fetch('/api/studio/run',{method:'DELETE'});
  logLine(await res.text());
  setRunning(false);
  toast('warning','Run dihentikan','Proses Playwright dihentikan oleh QA.');
});
</script>`;
}

function containedRequirementPath(slug: string): string | null {
  const root = path.resolve(REPO_ROOT, 'requirements');
  const candidate = path.resolve(root, `${slug}.md`);
  const rel = path.relative(root, candidate);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return candidate;
}

export async function handleStudioRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string,
  method: string,
): Promise<boolean> {
  if (pathname === '/studio' && method === 'GET') {
    htmlResponse(res, 200, renderStudioPage());
    return true;
  }
  if (pathname === '/api/studio/run-settings' && method === 'POST') {
    const body = await readBody(req);
    const settings = isRecord(body)
      ? {
          slowMo: typeof body.slowMo === 'number' ? body.slowMo : Number(body.slowMo),
          headless: typeof body.headless === 'boolean' ? body.headless : undefined,
          viewport: typeof body.viewport === 'string' ? body.viewport : undefined,
        }
      : {};
    const appEnv = resolveAppEnv({ repoRoot: REPO_ROOT }).appEnv;
    const result = persistRunSettings(settings, appEnv);
    jsonResponse(res, result.ok ? 200 : 400, result);
    return true;
  }
  if (pathname !== '/api/studio/requirement' || method !== 'POST') return false;

  try {
    const body = await readBody(req);
    if (!isRecord(body)) {
      validationError(res, 'body', 'INVALID_BODY', 'request body must be a JSON object');
      return true;
    }
    const slug = str(body, 'slug');
    if (!SLUG_RE.test(slug)) {
      validationError(res, 'slug', 'INVALID_SLUG', 'slug must match ^[a-z0-9-]+$');
      return true;
    }
    const filePath = containedRequirementPath(slug);
    if (!filePath) {
      validationError(res, 'slug', 'INVALID_PATH', 'path must stay under requirements/');
      return true;
    }
    if (fs.existsSync(filePath)) {
      jsonResponse(res, 409, {
        error: 'requirement already exists',
        path: `requirements/${slug}.md`,
      });
      return true;
    }

    const markdown = buildRequirementMarkdown({
      slug,
      title: str(body, 'title'),
      module: str(body, 'module'),
      feature: str(body, 'feature'),
      authState: str(body, 'authState') === 'unauthenticated' ? 'unauthenticated' : 'authenticated',
      halamanAwal: str(body, 'halamanAwal'),
      scenarioTitle: str(body, 'scenarioTitle'),
      steps: typeof body['steps'] === 'string' ? body['steps'] : '',
      expected: typeof body['expected'] === 'string' ? body['expected'] : '',
      scenarios: Array.isArray(body['scenarios'])
        ? body['scenarios'].filter(isRecord).map((s) => ({
            title: str(s, 'title'),
            steps: typeof s['steps'] === 'string' ? s['steps'] : '',
            expected: typeof s['expected'] === 'string' ? s['expected'] : '',
          }))
        : undefined,
    });

    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, markdown, 'utf8');

    // Validate through the local tsx entry — spawning npx.cmd with shell:false
    // fails with EINVAL on Windows (CVE-2024-27980 hardening).
    const tsxCli = path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.cjs');
    const result = spawnSync(
      process.execPath,
      [tsxCli, 'tools/validators/validate-requirement.ts', `requirements/${slug}.md`],
      { cwd: REPO_ROOT, shell: false, windowsHide: true, encoding: 'utf8' },
    );
    if (result.status !== 0) {
      fs.rmSync(filePath, { force: true });
      jsonResponse(res, 400, {
        error: (
          result.stderr ||
          result.stdout ||
          result.error?.message ||
          'validation failed'
        ).trim(),
      });
      return true;
    }

    jsonResponse(res, 200, { path: `requirements/${slug}.md` });
  } catch (err) {
    const status = (err as { code?: number }).code === 413 ? 413 : 400;
    jsonResponse(res, status, { error: err instanceof Error ? err.message : 'bad request' });
  }
  return true;
}
