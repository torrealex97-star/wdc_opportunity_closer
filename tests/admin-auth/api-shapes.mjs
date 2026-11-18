// Los conectores oficiales leen los campos de la documentación vigente, no los del mock; y una respuesta con
// otra forma se declara como error (nunca como «0 ofertas»). Sin red: fixtures guardados en tests/fixtures/api.
// Uso: node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/api-shapes.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';

const fixture = name => JSON.parse(readFileSync(new URL(`../fixtures/api/${name}`, import.meta.url), 'utf8'));
const adzunaBody = fixture('adzuna-search.json');
const joobleBody = fixture('jooble-search.json');
const infojobsList = fixture('infojobs-offers.json');
const infojobsDetail = fixture('infojobs-detail.json');

// ── Supabase REST simulado ────────────────────────────────────────────────────────────────────────
const upserts = []; let ciphers = { adzuna: '', jooble: '' };
const rest = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c); req.on('end', () => {
    const url = new URL(req.url, 'http://x'); const send = (s, d) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(d)); };
    if (url.pathname === '/rest/v1/source_settings') return send(200, []);
    if (url.pathname === '/rest/v1/integration_connections') {
      const provider = (url.searchParams.get('provider') ?? '').replace('eq.', '');
      return send(200, [{ secret_ciphertext: ciphers[provider] }]);
    }
    if (url.pathname === '/rest/v1/rpc/external_upsert') { const rows = JSON.parse(body).p_rows; upserts.push(...rows); return send(200, rows.length); }
    if (url.pathname === '/rest/v1/external_ingest_runs') return send(201, {});
    send(200, []);
  });
});
await new Promise(r => rest.listen(0, '127.0.0.1', r));
process.env.SUPABASE_URL = `http://127.0.0.1:${rest.address().port}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.SUPABASE_PUBLISHABLE_KEY = 'a';
delete process.env.ADZUNA_API_BASE; delete process.env.JOOBLE_API_BASE;

const { encryptSecret } = await import('../../apps/web/lib/secrets.ts');
ciphers = { adzuna: encryptSecret('aid:good-key'), jooble: encryptSecret('good-key') };
const C = await import('../../apps/web/lib/collectors.ts');
const E = await import('../../apps/web/lib/external.ts');

// ── 1) Adzuna: los campos del ejemplo oficial de «Search ads» ─────────────────────────────────────
const adzuna = C.adzunaCandidates(adzunaBody);
assert.equal(adzuna.length, 1);
const a = adzuna[0];
assert.equal(a.external_id, '129698749', '`id` numérico o texto, siempre a texto');
assert.equal(a.title, 'Closer de ventas high ticket');
assert.equal(a.company, 'Acme', '`company.display_name`');
assert.equal(a.location, 'Madrid, Comunidad de Madrid', '`location.display_name`');
assert.equal(a.url, 'https://www.adzuna.es/jobs/land/ad/129698749', '`redirect_url`');
assert.equal(a.salary, '28000–32000 €', '`salary_min`/`salary_max` numéricos');
assert.equal(a.posted_at, '2026-11-16T08:12:39Z', '`created`');
assert.match(a.description, /closer con experiencia/, '`description` (la doc avisa: es un fragmento)');
assert.equal(a.raw.category, 'Sales Jobs', '`category.label`');
assert.ok('candidate' in E.classify(a), 'el candidato pasa la validación de entrada');

// ── 2) Jooble: los campos del ejemplo oficial de la REST API ──────────────────────────────────────
const jooble = C.joobleCandidates(joobleBody);
assert.equal(jooble.length, 1);
const j = jooble[0];
assert.equal(j.external_id, '1234567890', '`id` numérico del ejemplo de la doc');
assert.equal(j.title, 'Closer de ventas');
assert.equal(j.company, 'ABC Corp');
assert.equal(j.location, 'Madrid');
assert.equal(j.url, 'https://es.jooble.org/jdp/12345', 'la doc da `link` sin esquema: se normaliza para no perder la oferta');
assert.equal(j.salary, '30.000 €');
assert.equal(j.raw.job_type, 'Full-time', '`type`');
assert.equal(j.description, joobleBody.jobs[0].snippet, '`snippet` es el texto disponible');
assert.ok(Number.isFinite(Date.parse(j.posted_at)), '`updated` con 7 decimales se puede leer');
const jClassified = E.classify(j);
assert.ok('candidate' in jClassified, 'sin el `https://` añadido, la entrada la descartaría como `url_no_http`');
assert.ok(Number.isFinite(Date.parse(jClassified.candidate.posted_at)) && jClassified.candidate.posted_at.endsWith('Z'), 'la fecha se guarda normalizada');

// ── 3) InfoJobs: listado y ficha con los nombres de la doc v9 ─────────────────────────────────────
const offers = C.infojobsOffers(infojobsList);
assert.equal(offers.length, 2);
const closer = C.infojobsCandidate(offers[1]);
assert.equal(closer.external_id, 'eb371a01c14f97838d790d19d606ce');
assert.equal(closer.salary, '30.000–36.000 € bruto/año');
assert.equal(closer.raw.is_remote, true, '`teleworking` del listado');
assert.equal(closer.location, 'Madrid, Madrid');
const peon = C.infojobsCandidate(offers[0]);
assert.equal(peon.salary, '12 € bruto/hora');
assert.equal(peon.raw.is_remote, false);
const detailed = C.infojobsCandidate(offers[1], infojobsDetail);
assert.match(detailed.description, /experiencia en ventas high ticket/, 'la ficha aporta `description`');
assert.equal(detailed.salary, '30.000–36.000 € bruto/año', '`amountValue` + `periodValue` dan el mismo salario que la lista');

// ── 4) Una forma distinta es un error declarado, no un cero silencioso ────────────────────────────
assert.throws(() => C.adzunaCandidates({ data: [] }), /Adzuna.*results/, 'Adzuna sin `results` no es 0 ofertas');
assert.throws(() => C.adzunaCandidates(null), /Adzuna/);
assert.throws(() => C.joobleCandidates({ result: [] }), /Jooble.*jobs/, 'Jooble sin `jobs` no es 0 ofertas');
assert.throws(() => C.infojobsOffers({ items: [] }), /InfoJobs.*offers/, 'InfoJobs sin `offers` no es 0 ofertas');
assert.deepEqual(C.adzunaCandidates({ results: [] }), [], 'una lista vacía de verdad sí es cero');
assert.deepEqual(C.joobleCandidates({ totalCount: 0, jobs: [] }), []);
assert.deepEqual(C.infojobsOffers({ offers: [] }), []);

// ── 5) Cableado: el fetch real usa esos mapeos y el error llega al run ─────────────────────────────
const calls = [];
const realFetch = globalThis.fetch;
let bodies = { adzuna: adzunaBody, jooble: joobleBody };
globalThis.fetch = async (url, init) => {
  const target = String(url);
  if (target.startsWith('https://api.adzuna.com') || target.startsWith('https://es.jooble.org')) {
    const provider = target.includes('adzuna') ? 'adzuna' : 'jooble';
    calls.push({ provider, target, init });
    return new Response(JSON.stringify(bodies[provider]), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return realFetch(url, init);
};

upserts.length = 0; calls.length = 0;
bodies.adzuna = { data: [] };
const changed = await C.collectProvider('adzuna', 'test', Date.now() + 30_000);
assert.equal(changed.ok, false, 'una respuesta cambiada no puede cerrar la pasada como buena');
assert.match(changed.error, /Adzuna.*results/, `motivo declarado: ${changed.error}`);
assert.equal(upserts.length, 0);
const adzunaCall = new URL(calls[0].target);
assert.equal(adzunaCall.pathname, '/v1/api/jobs/es/search/1');
assert.equal(adzunaCall.searchParams.get('results_per_page'), '50');
assert.equal(adzunaCall.searchParams.get('max_days_old'), '10');
assert.equal(adzunaCall.searchParams.get('sort_by'), 'date');
assert.equal(adzunaCall.searchParams.get('what'), 'closer de ventas');

upserts.length = 0;
bodies.adzuna = adzunaBody;
const adzunaOk = await C.collectProvider('adzuna', 'test', Date.now() + 30_000);
assert.equal(adzunaOk.ok, true, `recogida Adzuna: ${adzunaOk.error}`);
const adzunaRows = [...new Set(upserts.map(r => r.external_id))];
assert.deepEqual(adzunaRows, ['129698749']);
assert.equal(upserts[0].salary, '28000–32000 €');
assert.equal(upserts[0].raw.category, 'Sales Jobs');

upserts.length = 0; calls.length = 0;
bodies.jooble = { result: [] };
const joobleChanged = await C.collectProvider('jooble', 'test', Date.now() + 30_000);
assert.equal(joobleChanged.ok, false, 'Jooble sin `jobs` tampoco se declara como cero');
assert.match(joobleChanged.error, /Jooble.*jobs/);
const joobleCall = calls[0];
assert.ok(joobleCall.target.startsWith('https://es.jooble.org/api/'), 'la clave va en el dominio de España');
assert.equal(JSON.parse(joobleCall.init.body).location, 'España');
assert.equal(JSON.parse(joobleCall.init.body).keywords, 'closer de ventas');
assert.equal(JSON.parse(joobleCall.init.body).searchMode, undefined, 'solo los campos documentados');

upserts.length = 0;
bodies.jooble = joobleBody;
const joobleOk = await C.collectProvider('jooble', 'test', Date.now() + 30_000);
assert.equal(joobleOk.ok, true, `recogida Jooble: ${joobleOk.error}`);
const row = upserts[0];
assert.equal(row.url, 'https://es.jooble.org/jdp/12345', 'la URL guardada es la normalizada');
assert.equal(row.external_id, '1234567890');
assert.ok(row.posted_at && row.posted_at.endsWith('Z'), 'la fecha se guarda, no se pierde');

globalThis.fetch = realFetch;
rest.closeAllConnections?.(); rest.close();
console.log('PASS  conectores oficiales: campos de la doc (Adzuna results/company.display_name, Jooble jobs/link sin esquema/type, InfoJobs listado+ficha), y una respuesta con otra forma se declara como error, no como 0 ofertas');
