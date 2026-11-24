// STUDENT_LOGIN_REQUIRED=true: `/` y la búsqueda hospedada exigen sesión de alumna. Arranca su propia app (puerto 3198) y sus mocks.
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { startMocks } from './mock-services.mjs';

const PORT = 3198, BASE = `http://127.0.0.1:${PORT}`;
const { state, close } = startMocks({ authPort: 8793, enginePort: 8794 });
state.students = [{ id: crypto.randomUUID(), user_id: null, status: 'invited', email: 'ana@alumna.dev', created_at: new Date().toISOString() }];
state.users.set('ana@alumna.dev', { id: crypto.randomUUID(), password: 'Contraseña-alumna-1' });
const env = { ...process.env, PORT: String(PORT), SUPABASE_URL: 'http://127.0.0.1:8793', SUPABASE_PUBLISHABLE_KEY: 'anon-key', SUPABASE_SERVICE_ROLE_KEY: 'service-key', CAREER_ENGINE_URL: 'http://127.0.0.1:8794', CAREER_ADMIN_TOKEN: 'engine-token', STUDENT_AUTH_CACHE_MS: '0' };
const run = (flag) => spawn('npx', ['--no-install', 'next', 'start', 'apps/web', '--hostname', '127.0.0.1', '--port', String(PORT)], { env: { ...env, ...(flag ? { STUDENT_LOGIN_REQUIRED: flag } : {}) }, stdio: 'ignore', detached: true });
const up = async () => { for (let i = 0; i < 60; i++) { try { await fetch(BASE + '/'); return; } catch { await new Promise(r => setTimeout(r, 500)); } } throw new Error('la app no arrancó'); };
const search = (cookie) => fetch(BASE + '/api/backend/opportunities/search', { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE, host: `127.0.0.1:${PORT}`, ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ market: 'any', days: 10 }) });

const results = []; let child;
const step = async (name, fn) => { try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message]); } };
// Esperar a que el puerto quede LIBRE de verdad: con 800 ms fijos, bajo carga el servidor anterior seguía vivo cuando arrancaba el siguiente, este no podía abrir el
// puerto y `up()` daba por bueno al viejo (con la bandera activa): «307 !== 200» intermitente (2 de 4 ejecuciones el 2026-11-24).
// Diagnóstico para un fallo intermitente: qué procesos `next` hay vivos y con qué STUDENT_LOGIN_REQUIRED sirven (lee /proc/<pid>/environ).
const procs = () => {
  try {
    return execSync("pgrep -f 'next-server|next start'").toString().trim().split('\n').map(pid => {
      let flag = '?'; try { flag = readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0').find(x => x.startsWith('STUDENT_LOGIN_REQUIRED=')) ?? 'sin variable'; } catch {}
      return `${pid}:${flag}`;
    }).join(' ');
  } catch { return 'sin procesos next'; }
};
// Petición con una conexión NUEVA (`agent: false`): `fetch` reutiliza sockets keep-alive y el servidor anterior, ya sin escuchar pero todavía vivo,
// seguía contestando por el socket viejo (con la bandera activa): 307 en vez de 200. Causa hallada con el diagnóstico de `procs()` (2026-11-24).
const fresh = (method, path, { headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: PORT, path, method, headers: { connection: 'close', ...headers }, agent: false }, res => { res.resume(); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers })); });
  req.on('error', reject); if (body) req.write(body); req.end();
});
const busy = () => new Promise(resolve => { const socket = net.connect(PORT, '127.0.0.1'); socket.once('connect', () => { socket.destroy(); resolve(true); }); socket.once('error', () => resolve(false)); });
const stop = async () => {
  try { process.kill(-child.pid); } catch {}
  for (let i = 0; i < 60 && await busy(); i++) await new Promise(r => setTimeout(r, 250));
  if (await busy()) throw new Error('el servidor anterior no liberó el puerto en 15 s');
};

try {
  child = run('true'); await up();
  await step('flag activo: `/` sin sesión redirige a /alumna', async () => {
    const r = await fetch(BASE + '/', { redirect: 'manual' });
    assert.ok([307, 308].includes(r.status), `status ${r.status}`); assert.match(r.headers.get('location') ?? '', /\/alumna$/);
  });
  await step('flag activo: la búsqueda sin sesión responde 401 y con cookie falsa también', async () => {
    assert.equal((await search()).status, 401); assert.equal((await search('wdc_student_at=falsa')).status, 401);
  });
  await step('flag activo: con sesión de alumna `/` y la búsqueda funcionan', async () => {
    const login = await fetch(BASE + '/api/student/session', { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE }, body: JSON.stringify({ email: 'ana@alumna.dev', password: 'Contraseña-alumna-1' }) });
    assert.equal(login.status, 200);
    const cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
    assert.equal((await fetch(BASE + '/', { redirect: 'manual', headers: { cookie } })).status, 200);
    assert.notEqual((await search(cookie)).status, 401);
  });
  await step('flag activo: sesión caducada (solo refresh) se renueva y los tokens nuevos llegan al navegador', async () => {
    const login = await fetch(BASE + '/api/student/session', { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE }, body: JSON.stringify({ email: 'ana@alumna.dev', password: 'Contraseña-alumna-1' }) });
    const refresh = login.headers.getSetCookie().map(c => c.split(';')[0]).find(c => c.startsWith('wdc_student_rt='));
    const r = await search(refresh); assert.notEqual(r.status, 401);
    assert.ok(r.headers.getSetCookie().some(c => c.startsWith('wdc_student_at=') && /HttpOnly/.test(c)), 'el proxy debe reenviar la cookie renovada');
  });
  await stop();
  child = run(''); await up();
  await step('flag apagado (por defecto): `/` y la búsqueda siguen abiertas', async () => {
    const r = await fresh('GET', '/', { headers: { host: `127.0.0.1:${PORT}` } });
    assert.equal(r.status, 200, `status ${r.status}, location ${r.headers.location}, procesos next: ${procs()}`);
    const found = await fresh('POST', '/api/backend/opportunities/search', { headers: { 'content-type': 'application/json', origin: BASE, host: `127.0.0.1:${PORT}` }, body: JSON.stringify({ market: 'any', days: 10 }) });
    assert.notEqual(found.status, 401, `la búsqueda respondió ${found.status}; procesos next: ${procs()}`);
  });
} finally { await stop(); close(); }
for (const [s, n, m] of results) console.log(`${s}  ${n}${m ? '\n      ' + m : ''}`);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} pasos OK`);
process.exit(failed || !results.length ? 1 : 0);
