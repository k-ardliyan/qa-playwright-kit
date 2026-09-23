import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import type * as http from 'node:http';
import * as path from 'node:path';
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

/** Shared markdown shape for one scenario block (SC-01 == TC-01). */
export function scenarioBlock(
  index: number,
  title: string,
  steps: string,
  expected: string,
): string {
  const n = String(index).padStart(2, '0');
  return `### SC-${n}: ${title} (@success)
- **Test ID:** TC-${n}
- **Covers:** AC-01
**Langkah:**
${numbered(steps)}
**Hasil yang Diharapkan:**
${expected}`;
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
- **Tags:** #ui
- **Prioritas:** medium
- **Auth state:** ${input.authState}
- **Halaman awal:** ${input.halamanAwal.trim() || '/'}
- **Module:** ${input.module.trim() || 'general'}
- **Feature:** ${input.feature.trim() || input.slug}

## Kriteria Penerimaan
- **AC-01:** ${expected}

## Skenario Uji
${scenarios}
`;
}

export function renderStudioPage(): string {
  return `<!DOCTYPE html>
<html lang="id"><head><meta charset="utf-8"><title>Web Studio</title>
<style>
body{font-family:system-ui,sans-serif;background:#1a1a1a;color:#e0d6c8;margin:0;padding:24px}
main{max-width:960px;margin:0 auto;display:grid;grid-template-columns:1fr 1fr;gap:20px}
h1{grid-column:1/-1;font-size:1.25rem;margin:0}
label{display:block;font-size:.85rem;margin:10px 0 4px}
input,select,textarea{width:100%;box-sizing:border-box;background:#2a2a2a;color:#e0d6c8;border:1px solid #4a3a2c;border-radius:6px;padding:8px}
textarea{min-height:90px}
button{margin-top:14px;background:#c4956a;color:#1a1a1a;border:none;padding:8px 16px;border-radius:6px;font-weight:600;cursor:pointer}
label.inline{display:flex;align-items:center;gap:8px;font-size:.85rem;margin:10px 0 4px}
label.inline input{width:auto}
pre{white-space:pre-wrap;background:#111;padding:12px;border-radius:6px;min-height:280px}
#msg{grid-column:1/-1}
section{grid-column:1/-1}
#log{min-height:160px}
@media(max-width:800px){main{grid-template-columns:1fr}}
</style></head><body><main>
<h1>Web Studio — requirement</h1>
<form id="f">
<label for="slug">Feature slug</label><input id="slug" name="slug" required pattern="[a-z0-9-]+" autocomplete="off">
<label for="title">Title</label><input id="title" name="title">
<label for="module">Module</label><input id="module" name="module">
<label for="feature">Feature</label><input id="feature" name="feature">
<label for="authState">Auth state</label>
<select id="authState" name="authState"><option>authenticated</option><option>unauthenticated</option></select>
<label for="halamanAwal">Halaman awal</label><input id="halamanAwal" name="halamanAwal" value="/">
<div id="legacy">
<label for="scenarioTitle">Scenario title</label><input id="scenarioTitle" name="scenarioTitle">
<label for="steps">Steps</label><textarea id="steps" name="steps"></textarea>
<label for="expected">Expected</label><textarea id="expected" name="expected"></textarea>
</div>
<div id="scenarios"></div>
<button type="button" id="addScenario">Tambah skenario</button>
<button type="submit">Simpan</button>
<p id="msg" role="status"></p>
</form>
<pre id="preview" aria-live="polite"></pre>
<section>
<h2>Auth</h2>
<p id="env"></p>
<label for="appenv">Environment</label>
<select id="appenv">
<option>local</option><option>dev</option><option>staging</option><option>production</option>
</select>
<button type="button" id="envbtn">Pakai environment</button>
<p id="envmsg" role="status"></p>
<button type="button" id="authbtn">Refresh auth</button>
<p>OTP atau CAPTCHA selesai di jendela browser yang terbuka.</p>
<label class="inline" for="headed"><input type="checkbox" id="headed">Buka browser (OTP/CAPTCHA)</label>
<p id="authmsg" role="status"></p>
<h2>Run</h2>
<label for="speclist">Spec</label>
<select id="speclist"><option value="">Pilih spec</option></select>
<input id="spec" placeholder="tests/feature.spec.ts" autocomplete="off">
<button type="button" id="runbtn">Run</button>
<button type="button" id="stopbtn">Stop</button>
<pre id="log" aria-live="polite"></pre>
</section>
</main>
<script>
const ids=['slug','title','module','feature','authState','halamanAwal','scenarioTitle','steps','expected'];
function val(id){return document.getElementById(id).value.trim()}
function numbered(text){
  const lines=text.split(/\\r?\\n/).map(s=>s.trim()).filter(Boolean);
  const items=lines.length?lines:['Buka halaman awal'];
  return items.map((line,i)=>(i+1)+'. '+line.replace(/^\\d+\\.\\s*/,'')).join('\\n');
}
function scenarioBlock(i,title,steps,expected){
  const n=(''+i).padStart(2,'0');
  return '### SC-'+n+': '+title+' (@success)\\n- **Test ID:** TC-'+n+'\\n- **Covers:** AC-01\\n**Langkah:**\\n'+numbered(steps)+'\\n**Hasil yang Diharapkan:**\\n'+expected;
}
function extraScenarios(){
  return [...document.querySelectorAll('.scenario')].map(b=>({title:b.querySelector('.sc-title').value,steps:b.querySelector('.sc-steps').value,expected:b.querySelector('.sc-expected').value}));
}
function addBlock(title,steps,expected){
  const box=document.getElementById('scenarios');
  const n=box.children.length+1;
  const wrap=document.createElement('div');
  wrap.className='scenario';
  [['sc-title','input','Skenario '+n+' — title',title],['sc-steps','textarea','Steps',steps],['sc-expected','textarea','Expected',expected]].forEach(f=>{
    const l=document.createElement('label');
    l.textContent=f[2];
    const el=document.createElement(f[1]);
    el.className=f[0];
    el.value=f[3];
    l.append(el);
    wrap.append(l);
  });
  box.append(wrap);
}
function markdown(){
  const slug=val('slug'), title=val('title')||slug, expected=val('expected')||'Halaman menampilkan hasil yang diharapkan.';
  const extra=extraScenarios();
  const blocks=extra.length?extra.map((s,i)=>scenarioBlock(i+1,s.title.trim()||title,s.steps,s.expected.trim()||expected)):[scenarioBlock(1,val('scenarioTitle')||title,val('steps'),expected)];
  return '# REQ-XXX: '+title+'\\n\\n## Metadata\\n- **Tags:** #ui\\n- **Prioritas:** medium\\n- **Auth state:** '+val('authState')+'\\n- **Halaman awal:** '+(val('halamanAwal')||'/')+'\\n- **Module:** '+(val('module')||'general')+'\\n- **Feature:** '+(val('feature')||slug)+'\\n\\n## Kriteria Penerimaan\\n- **AC-01:** '+expected+'\\n\\n## Skenario Uji\\n'+blocks.join('\\n\\n')+'\\n';
}
function refresh(){document.getElementById('preview').textContent=markdown()}
ids.forEach(id=>document.getElementById(id).addEventListener('input',refresh));
document.getElementById('scenarios').addEventListener('input',refresh);
document.getElementById('addScenario').addEventListener('click',()=>{
  if(!document.querySelector('.scenario')){
    // First click seeds the block from the legacy single-scenario inputs.
    addBlock(val('scenarioTitle'),val('steps'),val('expected'));
    document.getElementById('legacy').hidden=true;
  }else{
    addBlock('','','');
  }
  refresh();
});
refresh();
document.getElementById('f').addEventListener('submit',async (ev)=>{
  ev.preventDefault();
  const body={};
  ids.forEach(id=>body[id]=document.getElementById(id).value);
  const extra=extraScenarios();
  if(extra.length)body.scenarios=extra;
  const msg=document.getElementById('msg');
  const res=await fetch('/api/studio/requirement',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const data=await res.json().catch(()=>({}));
  msg.textContent=res.ok?(data.path||'saved'):(data.error||res.statusText);
});
function showEnv(data){
  const box=document.getElementById('env');
  box.replaceChildren();
  box.append(document.createTextNode('appEnv '+(data&&data.appEnv!=null?data.appEnv:'')));
  const roles=data&&Array.isArray(data.roles)?data.roles:[];
  roles.forEach(r=>{
    const ready=r&&r.ready===true?'true':r&&r.ready===false?'false':'null';
    box.append(document.createElement('br'), document.createTextNode((r&&r.role!=null?r.role:'')+' '+ready));
  });
}
fetch('/api/studio/env').then(r=>r.json()).then(showEnv).catch(e=>{document.getElementById('env').textContent=String(e)});
document.getElementById('envbtn').addEventListener('click',async ()=>{
  const appEnv=document.getElementById('appenv').value;
  const confirmProduction=appEnv!=='production'||window.confirm('Pin production? Login ulang setelah ini.');
  if(!confirmProduction){document.getElementById('envmsg').textContent='dibatalkan';return;}
  const res=await fetch('/api/studio/env',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({appEnv,confirmProduction:appEnv==='production'})});
  document.getElementById('envmsg').textContent=await res.text();
  if(res.ok)fetch('/api/studio/env').then(r=>r.json()).then(showEnv);
});
document.getElementById('authbtn').addEventListener('click',async ()=>{
  const res=await fetch('/api/studio/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({headed:document.getElementById('headed').checked})});
  document.getElementById('authmsg').textContent=await res.text();
  if(!res.ok)return;
  for(let i=0;i<30;i++){
    await new Promise(r=>setTimeout(r,2000));
    const st=await fetch('/api/studio/auth').then(r=>r.json());
    if(st.running)continue;
    document.getElementById('authmsg').textContent='auth selesai, kode '+st.lastCode;
    fetch('/api/studio/env').then(r=>r.json()).then(showEnv);
    return;
  }
  document.getElementById('authmsg').textContent='auth masih berjalan. Cek lagi sebentar, atau buka jendela browser kalau ada OTP/CAPTCHA.';
});
const log=document.getElementById('log');
let es=null;
function listen(){
  if(es)es.close();
  es=new EventSource('/events');
  es.addEventListener('run-log',ev=>{
    const data=JSON.parse(ev.data);
    log.append(document.createTextNode(data.line+'\\n'));
  });
  es.addEventListener('run-done',ev=>{
    const data=JSON.parse(ev.data);
    log.append(document.createTextNode('exit '+data.code+'\\n'));
  });
}
listen();
// Keep the idle watchdog fed while this page is open: the studio has no
// history view to emit heartbeats, so a non-coder filling the form would
// otherwise lose the server (and any running spec) after 20s.
setInterval(()=>{fetch('/heartbeat',{method:'POST'}).catch(()=>{})},5000);
fetch('/api/studio/specs').then(r=>r.json()).then(data=>{
  const list=document.getElementById('speclist');
  const specs=Array.isArray(data)?data:(data&&Array.isArray(data.specs)?data.specs:[]);
  specs.forEach(p=>{
    const o=document.createElement('option');
    o.value=p;o.textContent=p;list.append(o);
  });
}).catch(()=>{});
document.getElementById('speclist').addEventListener('change',()=>{
  const v=document.getElementById('speclist').value;
  if(v)document.getElementById('spec').value=v;
});
document.getElementById('runbtn').addEventListener('click',async ()=>{
  const spec=document.getElementById('spec').value.trim();
  const res=await fetch('/api/studio/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({spec})});
  log.append(document.createTextNode(await res.text()+'\\n'));
});
document.getElementById('stopbtn').addEventListener('click',async ()=>{
  const res=await fetch('/api/studio/run',{method:'DELETE'});
  log.append(document.createTextNode(await res.text()+'\\n'));
});
</script></body></html>`;
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
