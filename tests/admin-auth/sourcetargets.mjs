// Direcciones a vigilar: validación por fuente (dominio, forma, normalización) sin red.
// node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/sourcetargets.mjs
import assert from 'node:assert/strict';
import { validateTarget, targetName, TARGET_SOURCES, MAX_TARGETS } from '../../apps/web/lib/sourceTargets.ts';

const results = [];
const step = (name, fn) => { try { fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]); } };
const ok = (source, raw, label) => { const r = validateTarget(source, raw, label); assert.equal(r.ok, true, `${raw}: ${r.error}`); return r; };
const bad = (source, raw, re) => { const r = validateTarget(source, raw); assert.equal(r.ok, false, `${raw} debía rechazarse`); if (re) assert.match(r.error, re); return r; };

step('Facebook: grupo y página, normalizados (m. → www., sin parámetros de rastreo), y lo que no es del dominio se rechaza', () => {
  const g = ok('apify-facebook', 'https://m.facebook.com/groups/closers.espana/?fbclid=abc#x');
  assert.equal(g.kind, 'facebook_group'); assert.equal(g.url, 'https://www.facebook.com/groups/closers.espana');
  const p = ok('apify-facebook', 'facebook.com/ventas.high.ticket'); assert.equal(p.kind, 'facebook_page'); assert.equal(p.url, 'https://www.facebook.com/ventas.high.ticket');
  bad('apify-facebook', 'https://evil.com/groups/x', /facebook/i);
  bad('apify-facebook', 'https://facebook.com.evil.com/groups/x', /facebook/i);
  bad('apify-facebook', 'https://www.facebook.com/sharer.php?u=x'); bad('apify-facebook', 'https://www.facebook.com/login');
  bad('apify-facebook', 'https://www.facebook.com/profile.php?id=123', /nombre/i);
});

step('Skool: comunidad con su nombre; sin credenciales ni http ni otro dominio', () => {
  const s = ok('apify-skool', 'https://www.skool.com/closers-club/about?ref=1'); assert.equal(s.kind, 'skool_community'); assert.equal(s.url, 'https://www.skool.com/closers-club');
  assert.equal(ok('apify-skool', 'skool.com/otra-comunidad').url, 'https://www.skool.com/otra-comunidad');
  bad('apify-skool', 'http://www.skool.com/x'); bad('apify-skool', 'https://user:pass@www.skool.com/x', /credenciales/i); bad('apify-skool', 'https://skool.evil.com/x'); bad('apify-skool', 'https://www.skool.com/', /comunidad/i);
});

step('Telegram: @canal, nombre, t.me y t.me/s se igualan; invitación privada y nombres cortos se rechazan', () => {
  for (const raw of ['@empleo_closers', 'empleo_closers', 't.me/empleo_closers', 'https://t.me/s/empleo_closers?before=5']) assert.equal(ok('apify-telegram', raw).url, 'https://t.me/empleo_closers', raw);
  assert.equal(ok('apify-telegram', '@empleo_closers').kind, 'telegram_channel');
  bad('apify-telegram', 'https://t.me/+AbCdEfGh', /privad/i); bad('apify-telegram', 't.me/joinchat/AAAA', /privad/i); bad('apify-telegram', '@ab', /nombre/i); bad('apify-telegram', 'https://telegram.evil.com/x');
});

step('Fuente sin direcciones, entradas vacías o absurdas, etiqueta recortada y tope por fuente', () => {
  bad('apify-indeed', 'https://x.com/a', /no admite/i); bad('apify-telegram', ''); bad('apify-telegram', '   '); bad('apify-telegram', 'x'.repeat(600));
  assert.equal(ok('apify-telegram', '@empleo_closers', '  Closers  '.padEnd(300, 'x')).label.length, 120);
  assert.equal(ok('apify-telegram', '@empleo_closers').label, null);
  assert.ok(MAX_TARGETS >= 10 && MAX_TARGETS <= 100);
  assert.deepEqual(Object.keys(TARGET_SOURCES).sort(), ['apify-facebook', 'apify-skool', 'apify-telegram']);
  bad('apify-reddit', 'r/forhire', /no admite/i); bad('apify-company', 'https://boards.greenhouse.io/acme', /no admite/i);
});

step('targetName: el nombre que piden los actores de Telegram, Facebook y Skool', () => {
  assert.equal(targetName('https://t.me/empleo_closers'), 'empleo_closers'); assert.equal(targetName('https://www.facebook.com/groups/closers.espana'), 'closers.espana');
  assert.equal(targetName('https://www.skool.com/closers-club'), 'closers-club');
});

for (const [status, name, message] of results) console.log(`${status}  ${name}${message ? '\n      ' + message : ''}`);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} pasos OK`);
process.exit(failed ? 1 : 0);
