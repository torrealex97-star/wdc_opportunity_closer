// Cualificación automática de fuentes externas: lo claro se aprueba y lo dudoso ACABA en la cola
// humana. Antes solo se contaba: cada pasada dejaba todo en borrador y el panel mostraba «0 a
// revisar», así que la pestaña de excepciones nunca tenía nada.
// Uso: node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/autoreview.mjs
import assert from 'node:assert/strict';
import http from 'node:http';

// PostgREST simulado: external_offers con las guardas que usa el código (in., eq.draft, count=exact).
const rows = new Map();
const patches = [];   // cada PATCH, para comprobar la guarda de estado
let failWrites = false;
let beforePatch = null;   // simula a una persona moviendo una fila entre la lectura y la escritura
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    const send = (s, d, headers = {}) => { res.writeHead(s, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(d)); };
    if (!url.pathname.endsWith('/external_offers')) return send(200, []);
    const q = Object.fromEntries(url.searchParams);
    const all = [...rows.values()];
    const ids = q.id?.startsWith('in.(') ? q.id.slice(4, -1).split(',') : null;

    if (req.method === 'PATCH') {
      patches.push({ query: url.search, body });
      if (failWrites) return send(500, { message: 'escritura rechazada' });
      const patch = JSON.parse(body || '{}');
      if (beforePatch) beforePatch(patch, all);
      let hit = ids ? all.filter(r => ids.includes(r.id)) : all;
      if (q.editorial_status === 'eq.draft') hit = hit.filter(r => r.editorial_status === 'draft');
      hit.forEach(r => Object.assign(r, patch));
      return send(200, hit);
    }
    // approvalsToday: cuenta con content-range, como PostgREST con Prefer: count=exact. Acepta `eq.x` y `in.(x,y)`.
    if (q.reviewed_by) {
      const since = q.reviewed_at?.replace('gte.', '') ?? '';
      const wanted = q.reviewed_by.startsWith('in.(') ? q.reviewed_by.slice(4, -1).split(',') : [q.reviewed_by.replace('eq.', '')];
      const n = all.filter(r => wanted.includes(r.reviewed_by) && r.reviewed_at && r.reviewed_at >= since).length;
      return send(200, [], { 'content-range': `0-0/${n}` });
    }
    let list = all;
    if (q.editorial_status === 'eq.draft') list = list.filter(r => r.editorial_status === 'draft');
    if (ids) list = list.filter(r => ids.includes(r.id));
    if (q.order === 'first_seen_at.asc') list.sort((a, b) => String(a.first_seen_at ?? '').localeCompare(String(b.first_seen_at ?? '')));
    else list.sort((a, b) => b.score - a.score);
    return send(200, list.slice(0, Number(q.limit) || 100));
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.SUPABASE_PUBLISHABLE_KEY = 'anon-key';
process.env.AI_REVIEW_MODE = 'shadow';

const { judgeOffer, runAutoReview, reviewWindow, OLDEST_SHARE, MIN_SCORE, DAILY_CAP } = await import('../../apps/web/lib/autoReview.ts');

const uuid = (n) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const offer = (n, extra = {}) => ({
  id: uuid(n), title: `Closer de ventas ${n}`, company: 'Acme', location: 'Madrid, España',
  url: `https://jobs.example.com/${n}`,
  description: 'Buscamos closer para cerrar ventas del programa con el equipo comercial de la empresa.',
  salary: '30.000 €/año', role: 'closer', score: 70, spain: true, verified_result: null,
  market: 'ES', market_basis: 'ubicacion_espana', red_flags: [],
  editorial_status: 'draft', reviewed_by: null, reviewed_at: null, ai_review: null,
  expires_at: new Date(Date.now() + 5 * 864e5).toISOString(), ...extra,
});
const seed = () => {
  rows.clear(); patches.length = 0; failWrites = false; beforePatch = null;
  rows.set(uuid(1), offer(1));                                               // clara
  rows.set(uuid(2), offer(2));                                               // clara
  rows.set(uuid(3), offer(3));                                               // clara
  rows.set(uuid(4), offer(4, { title: 'Senior Sales Closer', description: 'Wir suchen einen Closer für unser Team in Madrid und bieten ein gutes Gehalt.' })); // idioma no ofrecible
  rows.set(uuid(5), offer(5, { red_flags: ['pide_inversion'] }));            // bandera roja
  rows.set(uuid(6), offer(6, { score: 30 }));                                // puntuación baja
  rows.set(uuid(7), offer(7, { role: null }));                               // sin perfil
  rows.set(uuid(8), offer(8, { verified_result: 'closed' }));                // enlace cerrado
};
const face = (n) => rows.get(uuid(n));
const run = (deps = {}) => runAutoReview({ deadline: Date.now() + 60_000, ...deps });

// 1) La regla, caso por caso: aprueba lo comprobable, remite lo dudoso y RETIRA lo que no es un anuncio.
assert.equal(judgeOffer(offer(1)).decision, 'approve');
for (const [row, why, decision] of [
  [offer(4, { title: 'Senior Sales Closer', description: 'Wir suchen einen Closer für unser Team in Madrid und bieten ein gutes Gehalt.' }), 'idioma_dudoso', 'withdraw'],
  [offer(5, { red_flags: ['pide_inversion'] }), 'banderas_rojas', 'human'],
  [offer(6, { score: 30 }), 'score_bajo', 'withdraw'],
  [offer(7, { role: null }), 'sin_perfil', 'withdraw'],
]) {
  assert.equal(judgeOffer(row).why, why, why);
  // Decisión del propietario (2026-11-18): lo que la máquina no puede arreglar no ocupa la cola humana.
  assert.equal(judgeOffer(row).decision, decision, `${why} → ${decision}`);
}
// El inglés SÍ se publica: antes se retiraba por «idioma dudoso» y era el 59 % del pool de LatAm.
const english = offer(30, { title: 'Senior Sales Closer', description: 'We are hiring a closer for our growing team in Madrid. You will work with clients and the sales team.' });
assert.equal(judgeOffer(english).decision, 'approve', 'un anuncio en inglés se aprueba como uno en español');
// Una página de resultados de un portal no es una oferta: ni se aprueba ni ocupa la cola humana.
const index = judgeOffer(offer(9, { title: 'Ofertas de trabajo de Closer', company: null, url: 'https://www.infojobs.net/ofertas-trabajo/closer' }));
assert.equal(index.decision, 'withdraw');
assert.equal(index.why, 'no_es_oferta');
assert.equal(judgeOffer(offer(9, { url: 'https://es.trabajo.org/empleos/closer' })).decision, 'withdraw', 'basta la URL del listado');
// Y no se pasa de listo: la URL de la FICHA de una oferta concreta no es un listado. Son casos reales del
// catálogo de producción (Jobijoba `/oferta-empleo/69/<hash>`, Univision `/empleo/23-14660_…`), y la primera
// la había aprobado una persona a mano: retirarla habría borrado una oferta real del catálogo.
assert.equal(judgeOffer(offer(12, { title: 'Closer de Ventas Inbound | Altos Ingresos y Crecimiento (Palma)', company: 'Tradeando', url: 'https://www.jobijoba.es/oferta-empleo/69/da8f172d91a5ff0ef3d3f7c8fadc7652' })).decision, 'approve', 'la ficha de Jobijoba es una oferta, no un listado');
assert.equal(judgeOffer(offer(13, { title: 'Elite B2B Closer - 100% de comisión', company: 'Univision', url: 'https://trabajos.univision.com/empleo/23-14660_608E2EDCF80F36D92D0D730987D3176C' })).decision, 'approve', 'la ficha de Univision es una oferta, no un listado');
// Un enlace cerrado no se revisa a mano: se retira (la vigencia automática ya lo hacía por otra vía).
assert.equal(judgeOffer(offer(10, { verified_result: 'closed' })).decision, 'withdraw');
assert.equal(judgeOffer(offer(10, { verified_result: 'closed' })).why, 'enlace_cerrado');
// Estados de EE. UU. que el gazetteer español conoce como municipios: manda el dato literal del anuncio.
const florida = judgeOffer(offer(11, { title: 'Closer high ticket', location: 'Miramar, FL', salary: '$90k', spain: true, market: 'ES', market_basis: 'ubicacion_espana' }));
assert.equal(florida.market, 'US_LATINO', 'Miramar, FL no es España');
assert.equal(florida.basis, 'ubicacion_estados_unidos');
assert.equal(florida.decision, 'approve', 'una oferta real en dólares sí entra sola');
console.log('PASS  la regla distingue lo claro, lo dudoso y lo que ni es una oferta');

// 2) Ejecución completa: lo claro se aprueba, lo dudoso se MUEVE a la cola humana y lo que no es una oferta se retira.
seed();
const r = await run();
assert.equal(r.checked, 8, 'se miran los ocho borradores');
assert.equal(r.approved, 3, 'tres claras');
assert.equal(r.withdrawn, 4, 'idioma, puntuación, perfil y enlace cerrado se retiran');
assert.equal(r.exceptions, 1, 'solo el riesgo real necesita criterio');
assert.equal(r.moved, 1, 'y esa sí se mueve a la cola');
assert.equal(r.failed_writes, undefined, 'sin escrituras fallidas');
for (const n of [1, 2, 3]) {
  assert.equal(face(n).editorial_status, 'approved', `clara ${n}`);
  assert.equal(face(n).reviewed_by, 'auto-reglas');
}
assert.equal(face(5).editorial_status, 'needs_review', 'la bandera roja sí llega a una persona');
assert.equal(face(5).reviewed_by, 'auto-excepcion', 'no consume el tope de aprobaciones');
assert.equal(typeof face(5).auto_review?.why, 'string', 'con su motivo guardado');
for (const n of [4, 6, 7]) {
  assert.equal(face(n).editorial_status, 'withdrawn', `lo irrecuperable ${n} se retira`);
  assert.equal(face(n).reviewed_by, 'auto-retira');
  assert.equal(typeof face(n).auto_review?.why, 'string', 'con su motivo guardado');
}
assert.equal(face(4).auto_review.why, 'idioma_dudoso');
assert.equal(face(8).editorial_status, 'withdrawn', 'un enlace cerrado sale del catálogo');
assert.equal(face(8).reviewed_by, 'auto-retira', 'retirar no gasta cupo de aprobaciones');
assert.equal(face(8).auto_review.why, 'enlace_cerrado');
console.log('PASS  solo el riesgo real llega a la cola humana; lo irrecuperable se retira con motivo');

// 3) Guarda de estado: solo se escriben borradores (una persona pudo mover la oferta mientras se decidía).
for (const p of patches) assert.match(p.query, /editorial_status=eq\.draft/, 'la escritura no pisa lo que ya movió alguien');
console.log('PASS  las escrituras llevan WHERE editorial_status=draft');

// 4) Tope diario: lo que cumple las reglas pero no cabe se queda en BORRADOR para mañana, no va a la cola.
seed();
const capped = await run({ cap: 2 });
assert.equal(capped.approved, 2);
assert.ok([1, 2, 3].some(n => face(n).editorial_status === 'draft'), 'la que no cabe sigue en borrador');
assert.equal(capped.by_reason.tope_diario, 1);
assert.equal(capped.withdrawn, 4, 'las retiradas no dependen del cupo de aprobaciones');
assert.equal(capped.moved, 1, 'las excepciones se mueven igual: no dependen del cupo de aprobaciones');
console.log('PASS  el tope diario no manda a una persona lo que la máquina sabía cerrar');

// 5) Escritura fallida: se declara y no se cuenta como hecha.
seed(); failWrites = true;
const failed = await run();
assert.equal(failed.moved, undefined, 'nada confirmado');
assert.equal(failed.failed_writes, 8, 'las 3 aprobaciones, la excepción y las 4 retiradas se declaran fallidas');
for (const n of [1, 4]) assert.equal(face(n).editorial_status, 'draft', 'sin escritura no hay cambio');
console.log('PASS  si la base falla, se declara y nada se da por hecho');

// 6) El tope diario lo gasta TODA la máquina, no solo las reglas. Antes se contaban únicamente las filas de
// `auto-reglas`, así que en una pasada posterior del mismo día la IA volvía a tener sus 25 y el día podía
// cerrar con más de 100 aprobaciones automáticas.
seed();
const today = new Date().toISOString();
for (let i = 0; i < 98; i++) rows.set(uuid(500 + i), offer(500 + i, { editorial_status: 'approved', reviewed_by: 'ai-review', reviewed_at: today }));
const nearlyFull = await run({ cap: 100 });
assert.equal(nearlyFull.used_before, 98, 'la IA también cuenta en el cupo del día');
assert.equal(nearlyFull.approved, 2, 'solo caben las que faltan hasta 100');
assert.equal(nearlyFull.by_reason.tope_diario, 1, 'la que no cabe se queda en borrador');
// Y una pasada que ya no tiene hueco no escribe NADA (ni aprobaciones ni cola humana).
const escriturasAntes = patches.length;
const noRoom = await run({ cap: 100 });
assert.equal(noRoom.used_before, 100);
assert.equal(noRoom.approved, 0);
assert.equal(noRoom.checked, 0, 'sin cupo ni se miran los borradores');
assert.equal(patches.length, escriturasAntes, 'sin cupo no se toca la base');
console.log('PASS  el tope diario lo gasta toda la máquina (reglas + IA), también entre pasadas');

// 7) El cupo de la IA viaja como entorno explícito de SU llamada: no se escribe `process.env`.
seed();
delete process.env.AI_REVIEW_MAX_APPROVALS;
process.env.AI_REVIEW_MODE = 'live';
const seen = [];
const aiStub = async (deps) => { seen.push(deps?.env?.AI_REVIEW_MAX_APPROVALS); return { mode: 'live', reviewed: 0, would_approve: 0, would_withdraw: 0, human: 0, applied: 0 }; };
const conIa = await run({ cap: 5, ai: aiStub });
assert.equal(conIa.approved, 3, 'las reglas siguen cerrando lo claro');
assert.equal(seen.length, 1, 'la IA se llama una vez');
assert.equal(seen[0], '2', 'el hueco que queda (5 menos 3) es el cupo que recibe la IA');
assert.equal(process.env.AI_REVIEW_MAX_APPROVALS, undefined, 'no se escribe en el entorno del proceso');
process.env.AI_REVIEW_MODE = 'shadow';
console.log('PASS  el cupo de la IA va en su propio entorno, sin tocar el del proceso');

// 8) Lo que ni es una oferta ni se puede mostrar sale del catálogo sin gastar cupo y sin ocupar la cola humana.
seed();
rows.set(uuid(9), offer(9, { title: 'Ofertas de trabajo de Closer de ventas', company: null, url: 'https://www.infojobs.net/ofertas-trabajo/closer-de-ventas', score: 90 }));
rows.set(uuid(10), offer(10, { title: 'Empleos de closer en España', company: null, url: 'https://es.trabajo.org/empleos/closer', score: 80 }));
const mixed = await run({ cap: 100 });
assert.equal(mixed.checked, 10, 'se miran los diez borradores');
assert.equal(mixed.approved, 3, 'solo las tres claras se aprueban');
assert.equal(mixed.withdrawn, 6, 'los dos listados y las cuatro irrecuperables');
assert.equal(mixed.by_reason.no_es_oferta, 2);
assert.equal(mixed.by_reason.enlace_cerrado, 1);
assert.equal(mixed.exceptions, 1, 'la cola humana no se llena con lo que no es revisable');
assert.equal(face(9).editorial_status, 'withdrawn');
assert.equal(face(9).reviewed_by, 'auto-retira');
assert.ok(face(9).reviewed_at, 'queda registrado cuándo se retiró');
for (const p of patches) assert.match(p.query, /editorial_status=eq\.draft/, 'la retirada tampoco pisa lo que ya movió alguien');
// Las retiradas no son aprobaciones: el cupo del día solo cuenta lo que la máquina puso delante de una alumna.
const after = await run({ cap: 100 });
assert.equal(after.used_before, 3, 'las retiradas no consumen el cupo de aprobaciones');
assert.equal(after.checked, 0, 'y no queda nada por clasificar');
console.log('PASS  listados y enlaces cerrados se retiran sin gastar cupo ni ensuciar la cola');

// 9) Publicar con aviso: lo que solo avisa (solo comisión, publicidad a su cargo…) sí entra, con sus banderas
// guardadas para que la alumna vea el banner. Lo crítico (pago previo, multinivel) sigue en la cola humana.
seed();
rows.set(uuid(20), offer(20, { description: offer(20).description + ' Trabajo 100% a comisión.' }));
rows.set(uuid(21), offer(21, { description: 'Debes pagar una licencia para empezar.' }));
const aviso = await run({ cap: 100 });
assert.equal(aviso.checked, 10, 'se miran los dos nuevos');
assert.equal(aviso.approved, 4, 'las tres claras y la del aviso');
assert.equal(face(20).editorial_status, 'approved', 'el aviso se publica');
assert.equal(face(20).auto_review.why, 'cumple_reglas_con_aviso');
assert.deepEqual(face(20).auto_review.flags, ['COMMISSION_ONLY'], 'la bandera queda guardada para el banner');
assert.equal(aviso.by_reason.cumple_reglas_con_aviso, 1, 'el panel puede contarlas');
assert.equal(face(21).editorial_status, 'needs_review', 'lo crítico no se publica solo');
assert.equal(face(21).auto_review.why, 'oferta_peligrosa');
assert.equal(aviso.by_reason.oferta_peligrosa, 1);
console.log('PASS  lo leve se publica con aviso y lo crítico sigue esperando a una persona');

// 10) `cumple_reglas_con_aviso` cuenta lo que la base CONFIRMA, como el resto de motivos: si una persona
// mueve la oferta entre la lectura y la escritura, la guarda la descarta y no puede aparecer en el recuento
// (antes se contaban las que se intentaban aprobar, así que el panel inflaba el número).
seed();
rows.set(uuid(20), offer(20, { description: offer(20).description + ' Trabajo 100% a comisión.' }));
rows.set(uuid(22), offer(22, { description: offer(22).description + ' Trabajo 100% a comisión.' }));
beforePatch = (patch, all) => {
  if (patch.auto_review?.why !== 'cumple_reglas_con_aviso') return;
  const raced = all.find(r => r.id === uuid(22));
  raced.editorial_status = 'needs_review';
  raced.reviewed_by = 'persona';
};
const raced = await run({ cap: 100 });
beforePatch = null;
assert.equal(face(20).editorial_status, 'approved', 'la que seguía en borrador sí se publica');
assert.equal(face(22).reviewed_by, 'persona', 'la guarda no pisa lo que movió una persona');
assert.equal(face(22).auto_review, undefined, 'y no se le anota un motivo que no se aplicó');
assert.equal(raced.approved, 4, 'tres claras y una con aviso confirmada');
assert.equal(raced.by_reason.cumple_reglas_con_aviso, 1, 'solo la confirmada, no las dos intentadas');
console.log('PASS  el recuento de aprobadas con aviso es el que confirma la base');

// 2) Sin descripción no se puede juzgar el idioma: cola humana con su motivo, no retirada por «otro idioma». Con descripción real en otro idioma, sigue retirándose.
const noText = judgeOffer(offer(40, { title: 'Verkaufsleiter Abschluss', description: '' }));
assert.equal(noText.decision, 'human'); assert.equal(noText.why, 'sin_descripcion');
assert.equal(judgeOffer(offer(41, { title: 'Verkaufsleiter Abschluss', description: null })).why, 'sin_descripcion', 'una descripción ausente (null) también');
assert.equal(judgeOffer(offer(42, { title: 'Senior Sales Closer', description: '' })).why, 'sin_descripcion', 'solo con el título tampoco se reconoce el idioma: antes se retiraba como «otro idioma»; ahora la mira una persona');
assert.equal(judgeOffer(offer(43, { title: 'Senior Sales Closer', description: 'Wir suchen einen Closer für unser Team in Madrid und bieten ein gutes Gehalt.' })).why, 'idioma_dudoso', 'con descripción real en otro idioma se retira como siempre');
assert.equal(judgeOffer(offer(44, { title: 'Verkaufsleiter Abschluss', description: '', score: 30 })).why, 'score_bajo', 'el umbral de puntuación no cambia');
assert.equal(MIN_SCORE, 55); assert.equal(DAILY_CAP, 100);
console.log('PASS  sin descripción: cola humana con su motivo; nada se aprueba sin datos y los umbrales no se tocan');

// 3) Ventana de revisión: casi todo por puntuación y una parte reservada a los más antiguos, para que ninguna fuente quede sin juzgar.
const mk = (id, score) => ({ id, score });
const byScore = Array.from({ length: 12 }, (_, i) => mk(`s${i}`, 90 - i));
const oldest = [mk('old1', 40), mk('old2', 41), mk('s0', 90)];
const window = reviewWindow(byScore, oldest, 9);
assert.equal(window.length, 9);
assert.ok(window.some(r => r.id === 'old1') && window.some(r => r.id === 'old2'), 'los antiguos entran aunque puntúen poco');
assert.equal(new Set(window.map(r => r.id)).size, 9, 'sin repetidos');
assert.ok(window.some(r => r.id === 's0'), 'las mejores por puntuación siguen entrando');
assert.ok(Math.floor(9 * OLDEST_SHARE) >= 2);
assert.deepEqual(reviewWindow(byScore, [], 5).map(r => r.id), ['s0', 's1', 's2', 's3', 's4'], 'sin antiguos es lo de siempre');
assert.equal(reviewWindow(byScore.slice(0, 2), oldest, 9).length, 4, 'con pocas filas devuelve las que hay, sin inventar');
console.log('PASS  la ventana reserva una parte a los borradores más antiguos');

// 4) De punta a punta: con el frente de la ventana ocupado por borradores buenos que no caben en el tope, un borrador antiguo de poca puntuación se juzga igual.
rows.clear(); patches.length = 0;
for (let n = 100; n < 160; n++) rows.set(uuid(n), offer(n, { score: 95, first_seen_at: new Date(Date.now() - 1000 * 60).toISOString() }));
rows.set(uuid(200), offer(200, { score: 30, source: 'apify-linkedin', first_seen_at: new Date(Date.now() - 6 * 864e5).toISOString() }));
const fair = await run({ cap: 5 });
assert.equal(face(200).editorial_status, 'withdrawn', JSON.stringify(fair));
assert.equal(face(200).auto_review.why, 'score_bajo', 'el borrador antiguo y flojo SÍ llegó a juzgarse (antes se quedaba sin mirar)');
console.log('PASS  un borrador antiguo y de poca puntuación se juzga aunque el frente de la ventana esté lleno');

server.close();
