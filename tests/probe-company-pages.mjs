// Sonda de páginas de empleo (C1): los filtros que deciden qué se mide y cómo se evita repetir.
// Sin red: la lectura real se hace a mano y queda en docs/evidence/.
// Uso: node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/probe-company-pages.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { httpsPublic, rowsOf, merge, keyOf, cell } from '../scripts/probe_company_pages.mjs';

const results = [];
const step = (name, fn) => { try { fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]); } };

step('solo se miden URLs HTTPS públicas', () => {
  assert.equal(httpsPublic('https://careers.monestcapital.com/jobs.rss'), true);
  for (const bad of ['http://example.com/jobs', 'https://localhost/jobs', 'https://127.0.0.1/jobs', 'https://10.0.0.2/jobs', 'https://192.168.1.5/jobs', 'no es una url']) {
    assert.equal(httpsPublic(bad), false, bad);
  }
});

step('la lista del motor se filtra por seguimiento y por URL usable', () => {
  const pages = rowsOf([
    { slug: 'a', name: 'A', monitoring: 'careers_page', careers_url: 'https://a.example/jobs' },
    { slug: 'b', name: 'B', monitoring: 'manual', careers_url: 'https://b.example/jobs' },
    { slug: 'c', name: 'C', monitoring: 'ats_page', careers_url: '' },
    { slug: 'd', name: 'D', monitoring: 'teamtailor_feed', careers_url: 'http://d.example/jobs' },
    { slug: 'e', name: 'E', monitoring: 'careers_page', careers_url: 'https://e.example/jobs' },
  ], 'Motor');
  assert.deepEqual(pages.map(p => p.code), ['a', 'e']);
  assert.equal(pages[0].note, 'Motor (careers_page).');
});

step('la misma página no se mide dos veces (repo y motor)', () => {
  const repo = [{ code: 'r', name: 'R', url: 'https://www.example.com/jobs/', note: 'repo' }];
  const engine = [
    { code: 'e', name: 'E', url: 'https://example.com/jobs', note: 'motor' },
    { code: 'x', name: 'X', url: 'https://otra.example/jobs', note: 'motor' },
  ];
  const merged = merge(repo, engine);
  assert.equal(merged.length, 2, 'la de www y sin www con la misma ruta es la misma página');
  assert.equal(keyOf('https://WWW.Example.com/jobs//'), keyOf('https://example.com/jobs'));
});

step('la lista semilla del motor tiene páginas medibles', () => {
  const seed = JSON.parse(readFileSync(new URL('../apps/api/career/data/company_targets.json', import.meta.url), 'utf8'));
  const pages = rowsOf(seed, 'Semilla');
  assert.ok(pages.length >= 10, `solo ${pages.length} páginas con URL usable en la semilla`);
  assert.ok(pages.some(p => p.url.includes('teamtailor')), 'falta el feed de Teamtailor');
});

step('el informe no rompe la tabla con barras ni saltos', () => {
  assert.equal(cell('a | b\nc'), 'a \\| b c');
  assert.equal(cell(null), '—');
});

for (const [status, name, message] of results) console.log(`${status}  ${name}${message ? '\n      ' + message : ''}`);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} pasos OK`);
process.exit(failed ? 1 : 0);
