// Enriquecer la descripción: una lectura gratuita y acotada del anuncio, con la guarda de URL, que se marca aunque no salga nada.
// node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/descriptionenrich.mjs
import assert from 'node:assert/strict';
import http from 'node:http';

const rows = new Map(); const patches = [];
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x'); let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    const send = (s, d) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(d)); };
    if (!url.pathname.endsWith('/external_offers')) return send(200, []);
    if (req.method === 'PATCH') { const id = url.searchParams.get('id')?.replace('eq.', ''); patches.push({ id, query: url.search, body: JSON.parse(body) }); const r = rows.get(id); if (r && r.editorial_status === 'draft') Object.assign(r, JSON.parse(body)); return send(200, []); }
    return send(200, [...rows.values()].filter(r => r.editorial_status === 'draft'));
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`; process.env.SUPABASE_SERVICE_ROLE_KEY = 'k'; process.env.SUPABASE_PUBLISHABLE_KEY = 'a';
process.env.URL_GUARD_ALLOWED_HOSTS = 'example.com';
const { descriptionFromPage, enrichDescriptions, MIN_USEFUL, MAX_PER_PASS } = await import('../../apps/web/lib/descriptionEnrich.ts');

let passed = 0, failed = 0;
const step = async (name, fn) => { try { await fn(); passed++; console.log(`PASS  ${name}`); } catch (err) { failed++; console.log(`FAIL  ${name}\n      ${err.message}`); } };
const long = 'Buscamos un closer con experiencia en ventas consultivas de programas de alto valor para incorporarse a nuestro equipo comercial remoto. Gestionarás llamadas con clientes cualificados.';
const page = (desc) => `<html><head><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'JobPosting', title: 'Closer', description: desc, hiringOrganization: { '@type': 'Organization', name: 'Acme' }, jobLocation: { '@type': 'Place', address: { '@type': 'PostalAddress', addressLocality: 'Madrid', addressCountry: 'ES' } } })}</script></head><body></body></html>`;
const offer = (n, over = {}) => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, title: `Closer de ventas ${n}`, company: 'Acme', location: 'Madrid', salary: null, description: null, posted_at: new Date().toISOString(), url: `https://jobs.example.com/oferta/${n}`, role: 'closer', score: 60, editorial_status: 'draft', raw: { provider: 'apify' }, ...over });
const seed = () => { rows.clear(); patches.length = 0; };

await step('descripción de la página: JobPosting primero, meta descripción después, y nada si es corta', () => {
  assert.equal(descriptionFromPage(page(long), 'https://jobs.example.com/x')?.source, 'jsonld');
  const meta = `<html><head><meta name="description" content="${long}"></head></html>`; assert.equal(descriptionFromPage(meta, 'https://jobs.example.com/x')?.source, 'meta');
  assert.equal(descriptionFromPage(page('Corta.'), 'https://jobs.example.com/x'), null); assert.equal(descriptionFromPage('<html></html>', 'https://jobs.example.com/x'), null);
  assert.ok(MIN_USEFUL >= 100);
});

await step('lee el anuncio, guarda la descripción y vuelve a puntuar; marca el intento', async () => {
  seed(); rows.set(offer(1).id, offer(1));
  const out = await enrichDescriptions({ fetchImpl: async () => new Response(page(long), { status: 200 }) });
  assert.equal(out.checked, 1); assert.equal(out.enriched, 1);
  const r = rows.get(offer(1).id); assert.equal(r.description, long); assert.ok(r.raw.detail_checked_at); assert.equal(r.raw.detail_source, 'jsonld'); assert.equal(typeof r.score, 'number'); assert.ok(patches[0].query.includes('editorial_status=eq.draft'), 'solo toca borradores');
});

await step('una página sin descripción útil se MARCA y no se vuelve a pedir; ya intentadas y con descripción se saltan', async () => {
  seed(); rows.set(offer(2).id, offer(2)); rows.set(offer(3).id, offer(3, { raw: { detail_checked_at: '2026-11-20T00:00:00Z' } })); rows.set(offer(4).id, offer(4, { description: long }));
  let calls = 0; const out = await enrichDescriptions({ fetchImpl: async () => { calls++; return new Response('<html></html>', { status: 200 }); } });
  assert.equal(calls, 1, 'solo la que faltaba'); assert.equal(out.checked, 1); assert.equal(out.enriched, 0); assert.equal(out.skipped, 2);
  assert.ok(rows.get(offer(2).id).raw.detail_checked_at, 'queda marcada'); assert.equal(rows.get(offer(2).id).description, null, 'sin inventar nada');
  calls = 0; await enrichDescriptions({ fetchImpl: async () => { calls++; return new Response('<html></html>', { status: 200 }); } }); assert.equal(calls, 0, 'la marcada ya no se pide');
});

await step('la guarda de URL manda: un host fuera de la lista o una IP no recibe la petición, y se marca igual', async () => {
  seed(); rows.set(offer(5).id, offer(5, { url: 'https://evil.example.net/x' })); rows.set(offer(6).id, offer(6, { url: 'https://127.0.0.1/admin' })); rows.set(offer(7).id, offer(7, { url: 'http://jobs.example.com/inseguro' }));
  let calls = 0; const out = await enrichDescriptions({ fetchImpl: async () => { calls++; return new Response(page(long), { status: 200 }); } });
  assert.equal(calls, 0, 'ninguna petición salió'); assert.equal(out.enriched, 0);
});

await step('máximo de lecturas por pasada: aunque haya 20 pendientes solo se leen y enriquecen 6', async () => {
  seed(); for (let n = 10; n < 30; n++) rows.set(offer(n).id, offer(n));
  const out = await enrichDescriptions({ fetchImpl: async () => new Response(page(long), { status: 200 }) });
  assert.equal(out.checked, MAX_PER_PASS); assert.equal(out.enriched, MAX_PER_PASS);
});

server.close();
console.log(`\n${passed}/${passed + failed} pasos OK`);
if (failed) process.exit(1);
