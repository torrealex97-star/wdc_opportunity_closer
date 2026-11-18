// El aviso de una oferta publicada con reservas tiene que llegar a la tarjeta de la alumna SIN perderse por
// el camino: Supabase (auto_review) → externalForStudent (`caution`) → fusión con el motor en la ruta que sirve
// la búsqueda (/api/backend/opportunities/search) → JSON → recomendaciones de /api/student/matches.
// Uso: node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/caution.mjs
//
// Se ejecuta la MISMA función que usa la ruta para fusionar (`mergeStudentSearch`) y se comprueba que la ruta
// sigue llamándola: si alguien reconstruye las ofertas campo a campo (que es como se pierde `caution`), falla.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';

const UUID = '3f2a8c1e-1111-4aaa-8bbb-000000000001';
const offer = {
  id: UUID,
  role: 'closer', spain: true, score: 82, also_seen: [], raw: {},
  source: 'apify-indeed', external_id: 'indeed-1',
  title: 'Closer de ventas high ticket',
  company: 'Acme Formación',
  location: 'Madrid, España',
  url: 'https://jobs.example.com/closer-ventas',
  salary: null,
  description: 'Buscamos closer para cerrar ventas del programa con el equipo comercial. Trabajo 100% a comisión.',
  posted_at: new Date(Date.now() - 3600_000).toISOString(),
  first_seen_at: null, last_seen_at: null,
  expires_at: new Date(Date.now() + 5 * 864e5).toISOString(),
  editorial_status: 'approved',
  verified_at: null, verified_result: null,
  ai_review: null,
  market: 'ES', market_basis: 'ubicacion_espana', currency: null,
  apply_url: null, company_url: null, contact: null,
  // Lo que guarda la aprobación automática con aviso: el motivo y las banderas que pinta el banner.
  auto_review: { decision: 'approve', why: 'cumple_reglas_con_aviso', rule: 'reglas_v1', at: new Date().toISOString(), flags: ['COMMISSION_ONLY'] },
};

// ── Supabase simulado: la fila aprobada con aviso y ninguna fuente pausada ────────────────────
const db = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (data) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
  if (url.pathname.includes('/external_offers')) return send([offer]);
  return send([]);
});
await new Promise(r => db.listen(0, '127.0.0.1', r));

process.env.SUPABASE_URL = `http://127.0.0.1:${db.address().port}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.SUPABASE_PUBLISHABLE_KEY = 'anon-key';

const { externalForStudent, mergeStudentSearch } = await import('../../apps/web/lib/externalSurface.ts');
const { recommendForStudent } = await import('../../apps/web/lib/matching.ts');

// Lo que devuelve el motor (una oferta suya, distinta de la externa).
const engineItems = [{ id: 'job-engine-1', source_url: 'https://motor.example/oferta/1', company: 'Motor SL', original_title: 'Setter comercial', role: 'setter', role_label: 'Setter', modality: 'Remoto', location: 'Remoto', language: 'Anuncio en español', compensation: 'Importe no publicado', description: 'Oferta del motor.', published_at: null }];
const query = { role: null, market: 'any', days: 10, include_bilingual: false, starred_only: false };
const warned = (items) => items.find(i => i.source_url === offer.url);

const results = [];
const step = async (name, fn) => { try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]); } };

await step('la oferta externa con avisos conserva `caution` al fusionarse con el motor', async () => {
  const extra = await externalForStudent(query);
  assert.equal(extra.length, 1, 'la oferta aprobada se sirve a la alumna');
  const items = mergeStudentSearch(engineItems, extra);
  assert.equal(items.length, 2, 'la del motor y la externa, sin duplicar');
  const item = warned(items);
  assert.ok(item, 'la oferta con aviso llega a la respuesta');
  assert.ok(item.caution, 'el campo caution no se pierde al fusionar');
  assert.equal(item.caution.title, 'Publicada con avisos');
  assert.equal(item.caution.flags.length, 1, 'una bandera, la de solo comisión');
  assert.match(item.caution.flags[0], /comisi[oó]n/i, 'la bandera viaja como texto para la alumna, no como código');
  assert.match(item.caution.note, /condiciones por escrito/i);
});

await step('la ruta de la búsqueda usa esa fusión (nadie reconstruye la oferta campo a campo)', async () => {
  const source = readFileSync(new URL('../../apps/web/app/api/backend/[...path]/route.ts', import.meta.url), 'utf8');
  assert.match(source, /mergeStudentSearch\(/, 'la ruta fusiona con la función probada');
  assert.doesNotMatch(source, /items:\s*extra\.map/, 'una copia campo a campo puede volver a perder el aviso');
  // Y el camino degradado (motor caído) responde las externas tal cual, sin reshaped.
  assert.match(source, /items:\s*extra,/, 'degradar devuelve las externas íntegras');
});

await step('con el motor caído (camino degradado) el aviso sigue en la tarjeta', async () => {
  // Degradado = la ruta responde `{ items: extra }` sin pasar por la fusión; basta con que `extra` lo lleve.
  const extra = await externalForStudent(query);
  const item = warned(extra);
  assert.ok(item?.caution, 'degradar no puede borrar el aviso');
  assert.equal(item.caution.title, 'Publicada con avisos');
});

await step('las recomendaciones de la alumna (/api/student/matches) también lo conservan', async () => {
  const profile = async () => ({ city: null, target_roles: ['closer'], languages: ['es'], consent_at: '2026-01-01T00:00:00Z' });
  const recommendation = await recommendForStudent('alumna-1', profile, externalForStudent);
  assert.equal(recommendation.ready, true);
  const match = recommendation.matches.find(m => m.opportunity.source_url === offer.url);
  assert.ok(match, 'la oferta entra en las recomendaciones');
  assert.ok(match.opportunity.caution, 'puntuar y ordenar no puede recortar el aviso');
  assert.equal(match.opportunity.caution.title, 'Publicada con avisos');
  // Y sobrevive a la serialización que envía la ruta al navegador.
  const json = JSON.parse(JSON.stringify(match.opportunity));
  assert.match(json.caution.flags[0], /comisi[oó]n/i);
});

for (const [s, n, m] of results) console.log(s, ' ', n, m ?? '');
const bad = results.filter(r => r[0] === 'FAIL').length;
db.close();
console.log(`\n${results.length - bad}/${results.length} pasos OK`);
if (bad) process.exit(1);
