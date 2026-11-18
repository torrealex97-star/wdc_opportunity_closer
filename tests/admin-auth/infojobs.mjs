// Conector oficial de InfoJobs: paginación, filtros de España/teletrabajo y ficha solo para lo que ya puntúa alto.
// Sin clave real: los cuerpos son fixtures con la forma de la documentación oficial v9
// (offer-list-9 y offer-get-9, leídas el 2026-11-18). Ninguna petición sale a api.infojobs.net.
// Uso: node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/infojobs.mjs
import assert from 'node:assert/strict';
import http from 'node:http';

// --- Supabase REST simulado (el mínimo que toca collectProvider + ingest) ---
const upserts = []; let secretCipher = '';
const rest = http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c); req.on('end', () => {
    const url = new URL(req.url, 'http://x'); const send = (s, d) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(d)); };
    if (url.pathname === '/rest/v1/source_settings') return send(200, []);
    if (url.pathname === '/rest/v1/integration_connections') return send(200, [{ secret_ciphertext: secretCipher }]);
    if (url.pathname === '/rest/v1/rpc/external_upsert') { const rows = JSON.parse(body).p_rows; upserts.push(...rows); return send(200, rows.length); }
    if (url.pathname === '/rest/v1/external_ingest_runs') return send(201, {});
    send(200, []);
  });
});

// --- InfoJobs simulado con la forma de la documentación ---
const listCalls = [], detailCalls = [];
let failDetails = false;
const unauthorized = res => { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{}'); };
const closer = {
  id: 'ij-closer-1', title: 'Closer de ventas high ticket', city: 'Madrid', province: { id: 33, key: 'madrid', value: 'Madrid' },
  link: 'https://www.infojobs.net/madrid/closer-de-ventas/of-iij-closer-1', category: { id: 152, key: 'comercial-ventas', value: 'Comercial y ventas' },
  salaryMin: { id: 1, value: '30.000 €' }, salaryMax: { id: 2, value: '36.000 €' }, salaryPeriod: { id: 1, value: 'Bruto/año' },
  teleworking: { id: 2, key: 'solo-teletrabajo', value: 'Solo teletrabajo' }, published: '2026-11-16T08:00:00.000Z', updated: '2026-11-16T08:00:00.000Z',
  author: { name: 'Acme' },
};
const camarero = {
  id: '258eae420249ffa67cf64681a2ef80', title: 'Camareros/as y 2º de Sala Zona Penedès', city: 'Vilafranca del Penedès', province: { id: 9, key: 'barcelona', value: 'Barcelona' },
  link: 'https://www.infojobs.net/vilafranca-del-penedes/camareros-2-sala/of-i258eae420249ffa67cf64681a2ef80', category: { id: 160, key: 'turismo-restauracion', value: 'Turismo y restauración' },
  salaryMin: { id: 10, value: '12 €' }, salaryMax: { id: 10, value: '12 €' }, salaryPeriod: { id: 1, value: 'Bruto/hora' },
  teleworking: { id: 1, key: 'trabajo-solo-presencial', value: 'Presencial' }, published: '2026-11-15T10:15:00.000Z',
  author: { name: 'Restauración Example' },
};
const setter = {
  id: 'ij-setter-1', title: 'Setter de ventas', city: 'Barcelona', province: { id: 9, key: 'barcelona', value: 'Barcelona' },
  link: 'https://www.infojobs.net/barcelona/setter-de-ventas/of-iij-setter-1', category: { id: 152, key: 'comercial-ventas', value: 'Comercial y ventas' },
  teleworking: { id: 3, key: 'teletrabajo-posible', value: 'Teletrabajo posible' }, published: '2026-11-17T09:00:00.000Z', author: { name: 'Beta' },
};
const infojobs = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.headers.authorization !== 'Basic ' + Buffer.from('cid:good-key-1234').toString('base64')) return unauthorized(res);
  const send = (s, d) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(d)); };
  if (url.pathname === '/api/9/offer') {
    listCalls.push(url);
    const page = Number(url.searchParams.get('page'));
    // La ficha de la documentación: dos páginas reales aunque `totalPages` diga más.
    if (page === 1) return send(200, { currentPage: 1, totalPages: 2, pageSize: 50, offers: [closer, camarero] });
    if (page === 2) return send(200, { currentPage: 2, totalPages: 2, pageSize: 50, offers: [setter] });
    return send(200, { currentPage: page, totalPages: 2, pageSize: 50, offers: [] });
  }
  if (url.pathname.startsWith('/api/9/offer/')) {
    const id = decodeURIComponent(url.pathname.slice('/api/9/offer/'.length));
    detailCalls.push(id);
    if (failDetails) return send(503, {});
    if (id === 'ij-closer-1') return send(200, {
      id, title: closer.title, city: closer.city, province: closer.province, link: closer.link, category: closer.category,
      description: 'Buscamos una persona con experiencia en ventas high ticket para cerrar oportunidades del equipo comercial en España.',
      salaryMin: { amount: 30000, amountId: 1, amountValue: '30.000 €', periodId: 1, periodValue: 'Bruto/año' },
      salaryMax: { amount: 36000, amountId: 2, amountValue: '36.000 €', periodId: 1, periodValue: 'Bruto/año' },
      teleworking: closer.teleworking, minRequirements: 'Experiencia mínima de 2 años en ventas',
    });
    if (id === 'ij-setter-1') return send(200, { id, description: 'Agenda citas con leads interesados; trabajo en remoto con el equipo comercial.' });
    return send(404, {});
  }
  send(404, {});
});

await Promise.all([rest, infojobs].map(s => new Promise(r => s.listen(0, '127.0.0.1', r))));
process.env.SUPABASE_URL = `http://127.0.0.1:${rest.address().port}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.SUPABASE_PUBLISHABLE_KEY = 'a';
process.env.INFOJOBS_API_BASE = `http://127.0.0.1:${infojobs.address().port}`;
for (const name of ['INFOJOBS_PROVINCES', 'INFOJOBS_CATEGORIES', 'INFOJOBS_TELEWORKING', 'INFOJOBS_SINCE', 'INFOJOBS_PAGES', 'INFOJOBS_DETAIL_TOP']) delete process.env[name];
const { encryptSecret } = await import('../../apps/web/lib/secrets.ts');
secretCipher = encryptSecret('cid:good-key-1234');
const C = await import('../../apps/web/lib/collectors.ts');

// ── 1) Parámetros del listado: los cinco de la petición, con las claves oficiales ─────────────────
const declared = C.infojobsListParams('closer de ventas', 1);
assert.equal(declared.get('q'), 'closer de ventas');
assert.equal(declared.get('page'), '1');
assert.equal(declared.get('maxResults'), '50');
assert.equal(declared.get('order'), 'updated-desc');
assert.equal(declared.get('sinceDate'), '_15_DAYS');
assert.deepEqual(declared.getAll('category'), ['comercial-ventas']);
assert.deepEqual(declared.getAll('teleworking'), ['teletrabajo-posible', 'solo-teletrabajo']);
// Las 52 provincias salen del diccionario oficial (dictionary/province?parent=17), no de una lista inventada.
const provinces = declared.getAll('province');
assert.equal(provinces.length, 52, 'las 52 provincias de España');
for (const key of ['madrid', 'barcelona', 'valencia-valencia', 'alicante-alacant', 'vizcaya', 'a-coruna', 'santa-cruz-de-tenerife']) assert.ok(provinces.includes(key), key);
// Acotar es una decisión de entorno: lista corta, sin categoría y solo presencial si se pide.
const narrowed = C.infojobsListParams('x', 2, { INFOJOBS_PROVINCES: 'madrid,barcelona', INFOJOBS_CATEGORIES: '', INFOJOBS_TELEWORKING: 'trabajo-solo-presencial', INFOJOBS_SINCE: '_24_HOURS' });
assert.deepEqual(narrowed.getAll('province'), ['madrid', 'barcelona']);
assert.deepEqual(narrowed.getAll('category'), [], 'vaciar la variable quita el filtro, no lo deja a medias');
assert.deepEqual(narrowed.getAll('teleworking'), ['trabajo-solo-presencial']);
assert.equal(narrowed.get('sinceDate'), '_24_HOURS');
assert.equal(narrowed.get('page'), '2');

// ── 2) Salario y teletrabajo: la forma de lista y la de ficha, y el hueco como hueco ──────────────
assert.equal(C.infojobsSalary({ value: '30.000 €' }, { value: '36.000 €' }, { value: 'Bruto/año' }), '30.000–36.000 € bruto/año');
assert.equal(C.infojobsSalary({ amountValue: '30.000 €', periodValue: 'Bruto/año' }, { amountValue: '30.000 €', periodValue: 'Bruto/año' }, null), '30.000 € bruto/año');
assert.equal(C.infojobsSalary({ amount: 24000 }, null, { periodValue: 'Bruto/año' }), '24.000 € bruto/año');
assert.equal(C.infojobsSalary(null, null, null), null, 'sin importe no se inventa un cero');
assert.equal(C.infojobsRemote({ teleworking: { value: 'Solo teletrabajo' } }), true);
assert.equal(C.infojobsRemote({ teleworking: { value: 'Teletrabajo posible' } }), true);
assert.equal(C.infojobsRemote({ teleworking: { value: 'Presencial' } }), false);
assert.equal(C.infojobsRemote({}), null, 'sin dato es un hueco, no un «no»');

// ── 3) Recogida completa contra la API simulada ───────────────────────────────────────────────────
upserts.length = 0; listCalls.length = 0; detailCalls.length = 0;
const outcome = await C.collectProvider('infojobs', 'test', Date.now() + 30_000);
assert.equal(outcome.ok, true, `recogida: ${outcome.error}`);
assert.equal(outcome.received, 21, '3 ofertas en cada una de las 7 consultas (el dedupe es por lote)');
// Paginación real: dos páginas por término, y las 7 consultas.
assert.equal(listCalls.length, 14, '7 términos × 2 páginas');
assert.deepEqual([...new Set(listCalls.map(u => u.searchParams.get('page')))].sort(), ['1', '2']);
for (const call of listCalls) {
  assert.equal(call.searchParams.get('sinceDate'), '_15_DAYS');
  assert.equal(call.searchParams.get('maxResults'), '50');
  assert.equal(call.searchParams.getAll('category').includes('comercial-ventas'), true);
  assert.equal(call.searchParams.getAll('province').length, 52);
}
// La ficha se pide solo para las que ya puntúan alto: el camarero (sin perfil) nunca.
assert.ok(detailCalls.includes('ij-closer-1') && detailCalls.includes('ij-setter-1'), `fichas pedidas: ${detailCalls.join(', ')}`);
assert.ok(!detailCalls.includes(camarero.id), 'una oferta que no puntúa alto no gasta ficha');
assert.equal(detailCalls.length, 14, 'dos fichas por término (closer y setter)');
const rows = new Map(upserts.map(row => [row.external_id, row]));
const closerRow = rows.get('ij-closer-1');
assert.match(closerRow.description, /experiencia en ventas high ticket/, 'la descripción viene de la ficha');
assert.equal(closerRow.salary, '30.000–36.000 € bruto/año', 'salario con mínimo, máximo y periodo');
assert.equal(closerRow.raw.is_remote, true, 'teletrabajo del anuncio, no supuesto');
assert.equal(closerRow.raw.category, 'Comercial y ventas');
assert.equal(closerRow.company, 'Acme');
assert.equal(closerRow.location, 'Madrid, Madrid');
const peon = rows.get(camarero.id);
assert.equal(peon.description, null, 'sin ficha, la oferta entra sin cuerpo en vez de perderse');
assert.equal(peon.salary, '12 € bruto/hora');
assert.equal(peon.raw.is_remote, false);
assert.equal(peon.raw.category, 'Turismo y restauración');

// ── 4) Tope de fichas por término: solo las mejores, no todas ───────────────────────────────────
upserts.length = 0; detailCalls.length = 0;
process.env.INFOJOBS_DETAIL_TOP = '1';
const capped = await C.collectProvider('infojobs', 'test', Date.now() + 30_000);
delete process.env.INFOJOBS_DETAIL_TOP;
assert.equal(capped.ok, true, `recogida con tope: ${capped.error}`);
assert.equal(detailCalls.length, 7, 'una ficha por término');
assert.ok(detailCalls.every(id => id === 'ij-closer-1'), 'la ficha se lleva la mejor puntuación, no la primera del listado');

// ── 5) Si la ficha falla, la oferta entra igual con lo del listado (no se pierde ni se finge) ─────
upserts.length = 0; detailCalls.length = 0; failDetails = true;
const degraded = await C.collectProvider('infojobs', 'test', Date.now() + 30_000);
failDetails = false;
assert.equal(degraded.ok, true, `recogida con fichas caídas: ${degraded.error}`);
assert.equal(degraded.received, 21, 'las ofertas se recogen aunque la ficha falle');
assert.ok(detailCalls.length <= 14, 'tras dos fallos seguidos se deja de gastar en fichas');
const degradedRows = new Map(upserts.map(row => [row.external_id, row]));
assert.equal(degradedRows.get('ij-closer-1').description, null, 'sin ficha no se inventa la descripción');
assert.equal(degradedRows.get('ij-closer-1').salary, '30.000–36.000 € bruto/año', 'el salario del listado se conserva');

for (const s of [rest, infojobs]) s.closeAllConnections?.(), s.close();
console.log('PASS  InfoJobs: 2 páginas por término con provincia/categoría/antigüedad/teletrabajo, ficha solo para lo que puntúa alto (descripción y salario con periodo) y huecos sin inventar');
