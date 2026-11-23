// Embudo por fuente y mercado: node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/funnel.mjs
import assert from 'node:assert/strict';
import { computeFunnel } from '../../apps/web/lib/funnel.ts';

const now = new Date('2026-11-08T12:00:00Z');
const ago = h => new Date(now.getTime() - h * 3600e3).toISOString();
const offer = (o) => ({ source: 'freehire-latam', market: 'LATAM', market_basis: 'ubicacion_latam', first_seen_at: ago(2), editorial_status: 'draft', reviewed_by: null, reviewed_at: null, expires_at: ago(-240), auto_review: null, ...o });

const offers = [
  offer({}), // nueva hace 2 h (LATAM por ubicación)
  offer({ first_seen_at: ago(100), editorial_status: 'approved', reviewed_by: 'auto-reglas', reviewed_at: ago(90) }), // nueva 7 d, aprobada 7 d (no 24 h)
  offer({ market_basis: 'sin_senal', first_seen_at: ago(3), editorial_status: 'approved', reviewed_by: 'auto-reglas', reviewed_at: ago(1) }), // LATAM por defecto
  offer({ source: 'google-jobs', market: 'ES', market_basis: 'ubicacion_espana', first_seen_at: ago(5), editorial_status: 'needs_review', reviewed_by: 'auto-excepcion', reviewed_at: ago(4), auto_review: { why: 'score_bajo' } }),
  offer({ source: 'google-jobs', market: 'ES', market_basis: 'ubicacion_espana', first_seen_at: ago(300), editorial_status: 'withdrawn', reviewed_by: 'auto-retira', reviewed_at: ago(2), auto_review: { why: 'sin_perfil' } }), // vista hace 12 d: no es nueva en 7 d, sí retirada en 24 h
  offer({ source: 'google-jobs', market: null, market_basis: null, first_seen_at: ago(6), editorial_status: 'withdrawn', reviewed_by: 'persona@x.dev', reviewed_at: ago(5) }), // retirada por una PERSONA: no cuenta como regla
];
const live = [{ source: 'freehire-latam', market: 'LATAM', market_basis: 'ubicacion_latam' }, { source: 'freehire-latam', market: 'LATAM', market_basis: 'sin_senal' }, { source: 'google-jobs', market: 'ES', market_basis: 'ubicacion_espana' }];
const runs = [
  { source: 'freehire-latam', received: 50, accepted: 12, created_at: ago(3) },
  { source: 'freehire-latam', received: 40, accepted: 8, created_at: ago(60) },
  { source: 'google-jobs', received: 30, accepted: 10, created_at: ago(400) }, // fuera de los 7 días
];
const f = computeFunnel(offers, live, runs, now);
const get = (source, market) => f.rows.find(r => r.source === source && r.market === market);

assert.equal(get('freehire-latam', 'LATAM').new24, 1); assert.equal(get('freehire-latam', 'LATAM').new7, 2);
assert.equal(get('freehire-latam', 'LATAM').approved7, 1); assert.equal(get('freehire-latam', 'LATAM').approved24, 0, 'aprobada hace 90 h: 7 d sí, 24 h no');
assert.equal(get('freehire-latam', 'LATAM_DEFECTO').approved24, 1, 'LATAM por defecto va aparte del LATAM con ubicación');
assert.equal(get('freehire-latam', 'LATAM').visible, 1); assert.equal(get('freehire-latam', 'LATAM_DEFECTO').visible, 1);
assert.equal(get('google-jobs', 'ES').human7, 1); assert.equal(get('google-jobs', 'ES').withdrawn24, 1); assert.equal(get('google-jobs', 'ES').new7, 1, 'la vista hace 12 días no es nueva');
assert.equal(get('google-jobs', 'SIN_MERCADO').withdrawn7, 0, 'la retirada de una persona no es una regla');
assert.deepEqual(f.totals.reasons, { score_bajo: 1, sin_perfil: 1 }, 'motivos solo de reglas');
assert.equal(f.totals.visible, 3);
assert.deepEqual(f.ingest.find(i => i.source === 'freehire-latam'), { source: 'freehire-latam', received24: 50, accepted24: 12, received7: 90, accepted7: 20 });
assert.equal(f.ingest.find(i => i.source === 'google-jobs'), undefined, 'fuera de la ventana no cuenta');
// Un hueco no es un cero: sin lectura de ingesta es null; vacío es lista vacía.
assert.equal(computeFunnel(offers, live, null, now).ingest, null);
assert.deepEqual(computeFunnel([], [], [], now).ingest, []);
assert.equal(computeFunnel([], [], [], now, true).truncated, true);
// Fechas futuras o nulas no cuentan.
const odd = computeFunnel([offer({ first_seen_at: ago(-5), reviewed_at: null }), offer({ first_seen_at: null })], [], [], now);
assert.equal(odd.totals.new7, 0);
console.log('PASS  embudo: ventanas 24 h/7 d, LATAM por defecto aparte, motivos solo de reglas, hueco ≠ 0');

// ---- Rango del Centro de mando: ventana, categoría y mercado ----
{
  const { computeRange } = await import('../../apps/web/lib/funnel.ts');
  const day = (n) => new Date(now.getTime() - n * 864e5).toISOString();
  const base = { market: 'ES', market_basis: 'ubicacion_espana', editorial_status: 'draft', reviewed_by: null, reviewed_at: null, role: 'closer' };
  const items = [
    { ...base, source: 'a', first_seen_at: day(0.2) },                                                                         // nueva hoy
    { ...base, source: 'a', first_seen_at: day(3), editorial_status: 'approved', reviewed_by: 'auto-reglas', reviewed_at: day(2) },   // aprobada hace 2 d
    { ...base, source: 'b', role: 'setter', first_seen_at: day(10), editorial_status: 'approved', reviewed_by: 'auto-reglas', reviewed_at: day(9) }, // setter, hace 9 d
    { ...base, source: 'c', market: 'LATAM', first_seen_at: day(200), editorial_status: 'approved', reviewed_by: 'auto-reglas', reviewed_at: day(199) }, // LATAM, hace 200 d
    { ...base, source: 'a', first_seen_at: day(1.2), editorial_status: 'needs_review', reviewed_by: 'auto-excepcion', reviewed_at: day(0.5) },
  ];
  const live2 = [{ source: 'a', role: 'closer', market: 'ES', market_basis: 'ubicacion_espana' }, { source: 'b', role: 'setter', market: 'ES', market_basis: 'ubicacion_espana' }, { source: 'c', role: 'closer', market: 'LATAM', market_basis: 'ubicacion_latam' }];
  const r1 = computeRange(items, live2, now, { days: 1 });
  assert.equal(r1.new, 1, 'hoy: una recogida nueva'); assert.equal(r1.approved, 0); assert.equal(r1.human, 1); assert.equal(r1.series.length, 1, 'hoy = un tramo');
  const r7 = computeRange(items, live2, now, { days: 7 });
  assert.equal(r7.new, 3, '7 d: nuevas'); assert.equal(r7.approved, 1); assert.equal(r7.series.length, 7, 'una barra por día'); assert.equal(r7.bucket, 'dia');
  assert.equal(r7.series.reduce((n, p) => n + p.approved, 0), 1, 'la serie suma lo aprobado en la ventana');
  const r30 = computeRange(items, live2, now, { days: 30 });
  assert.equal(r30.approved, 2, '30 d: la aprobada hace 9 d entra'); assert.equal(r30.series.length, 30);
  const y = computeRange(items, live2, now, { days: 365 });
  assert.equal(y.approved, 3, 'año: entra la de hace 200 d'); assert.equal(y.bucket, 'semana'); assert.equal(y.series.length, 53, 'una barra por semana');
  assert.equal(y.series.reduce((n, p) => n + p.approved, 0), 3, 'cada aprobada cae en una semana de la serie');
  // Filtros: categoría y mercado.
  const setter = computeRange(items, live2, now, { days: 30, role: 'setter' });
  assert.equal(setter.approved, 1); assert.equal(setter.visible, 1, 'visibles solo de setter');
  const latam = computeRange(items, live2, now, { days: 365, market: 'LATAM' });
  assert.equal(latam.approved, 1); assert.deepEqual({ ...latam.visible_by_market }, { LATAM: 1 });
  assert.equal(computeRange(items, live2, now, { days: 7, role: 'none' }).new, 0, '«sin perfil» no coge las que tienen perfil');
  // Una ventana sin nada es 0 con su serie completa (no un hueco): lo que falta de lectura lo declara `truncated`.
  const empty = computeRange([], [], now, { days: 7 }); assert.equal(empty.new, 0); assert.equal(empty.series.length, 7);
  console.log('PASS  rango del Centro de mando: ventanas, serie por día/semana y filtros de categoría y mercado');
}
