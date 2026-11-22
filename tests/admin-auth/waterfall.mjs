// Waterfall de recogida: objetivo de ofertas cualificadas, hueco del día y plan por etapas (módulo puro).
// node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/waterfall.mjs
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'http://127.0.0.1:1'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'; process.env.SUPABASE_PUBLISHABLE_KEY = 'anon';
const { parseTarget, targetFromRow, approvalRate, expectedQualified, stateOf, planStages, dayStart, weekStart, DEFAULT_TARGET, MIN_SAMPLE } = await import('../../apps/web/lib/waterfall.ts');

// ---- el objetivo: solo un entero 0–10.000; 0 es válido y no es «sin objetivo» ----
assert.equal(parseTarget(60), 60); assert.equal(parseTarget('60'), 60); assert.equal(parseTarget(0), 0);
for (const bad of [-1, 10001, 2.5, '2.5', '', ' ', null, undefined, true, [5], 'abc', '5 ofertas', NaN]) assert.equal(parseTarget(bad), null, `no es un objetivo: ${JSON.stringify(bad)}`);

// ---- origen del objetivo: tabla → entorno → defecto, siempre declarado ----
const fromTable = targetFromRow({ qualified_per_day: 40, updated_by: 'dueño', updated_at: '2026-11-22T08:00:00Z' }, { DAILY_TARGET_OFFERS: '99' });
assert.deepEqual([fromTable.target, fromTable.source, fromTable.updated_by], [40, 'tabla', 'dueño'], 'lo guardado en el panel manda sobre el entorno');
assert.deepEqual([targetFromRow(null, { DAILY_TARGET_OFFERS: '99' }).target, targetFromRow(null, { DAILY_TARGET_OFFERS: '99' }).source], [99, 'entorno']);
assert.deepEqual([targetFromRow(null, {}).target, targetFromRow(null, {}).source], [DEFAULT_TARGET, 'defecto'], 'sin nada, el 60 de siempre, declarado como defecto');
assert.equal(targetFromRow({ qualified_per_day: 0 }, { DAILY_TARGET_OFFERS: '99' }).target, 0, '0 guardado es un objetivo, no un hueco');
const bad = targetFromRow({ qualified_per_day: 'mucho' }, { DAILY_TARGET_OFFERS: '30' });
assert.deepEqual([bad.target, bad.source], [30, 'entorno']); assert.match(bad.error, /no es un número válido/, 'una fila inválida cae al entorno y lo dice');
assert.match(targetFromRow(null, {}, 'sin tabla').error, /sin tabla/, 'un fallo de lectura se declara');

// ---- la tasa de aprobación solo existe con muestra suficiente ----
assert.equal(approvalRate(10, MIN_SAMPLE - 1), null, 'con muestra pequeña no se supone tasa');
assert.equal(approvalRate(15, 60), 0.25);
assert.equal(approvalRate(null, 100), null); assert.equal(approvalRate(10, null), null, 'un recuento que falló no es una tasa');
assert.equal(approvalRate(80, 60), 1, 'la tasa no pasa de 1');
assert.equal(expectedQualified(40, 0.25), 10); assert.equal(expectedQualified(40, null), 0, 'sin tasa, lo recogido no se cuenta como cualificado');
assert.equal(expectedQualified(-5, 0.5), 0);

// ---- el hueco del día ----
const target = targetFromRow({ qualified_per_day: 50 }, {});
let s = stateOf(target, { qualified: 12, pending: 40, week_total: 200, week_qualified: 50 });
assert.equal(s.approval_rate, 0.25); assert.equal(s.expected_from_pending, 10);
assert.equal(s.gap, 28, '50 − 12 cualificadas − 10 esperadas de lo pendiente');
s = stateOf(target, { qualified: 12, pending: 40, week_total: 5, week_qualified: 2 });
assert.equal(s.approval_rate, null); assert.equal(s.expected_from_pending, 0); assert.equal(s.gap, 38, 'sin tasa medida, lo pendiente no cuenta'); assert.match(s.basis, /Sin tasa de aprobación medida/);
s = stateOf(target, { qualified: 60, pending: 0, week_total: 0, week_qualified: 0 });
assert.equal(s.gap, 0, 'objetivo superado: hueco 0, nunca negativo');
s = stateOf(target, { qualified: null, pending: 5, week_total: 100, week_qualified: 20 });
assert.equal(s.gap, null, 'sin poder contar las cualificadas de hoy el hueco es desconocido, no 0'); assert.match(s.basis, /no se lanza gasto/);
s = stateOf(target, { qualified: 10, pending: null, week_total: 100, week_qualified: 40 });
assert.equal(s.gap, 40, 'un pendiente que no se pudo contar no se supone: cuenta 0');
s = stateOf(targetFromRow({ qualified_per_day: 0 }, {}), { qualified: 0, pending: 0, week_total: 0, week_qualified: 0 });
assert.equal(s.gap, 0, 'objetivo 0 = no se gasta en vías de pago');

// ---- el plan por etapas ----
const stage = (id, extra = {}) => ({ id, label: id, unit: '—', available: true, reason: null, automatic: true, ...extra });
const stages = [stage('google-brightdata'), stage('google-serpapi', { available: false, reason: 'Sin clave de SerpApi.' }), stage('fallback'), stage('apify'), stage('unlocker', { automatic: false, reason: 'Se lanza a mano.' })];
let plan = planStages(30, stages);
assert.deepEqual(plan.map(p => p.decision), ['run', 'skip', 'if-gap', 'if-gap', 'skip'], 'la primera disponible se lanza, las siguientes solo si aún falta');
assert.equal(plan[1].why, 'Sin clave de SerpApi.', 'una etapa no disponible dice su motivo');
assert.equal(plan[4].why, 'Se lanza a mano.', 'lo manual no lo lanza el cron');
plan = planStages(0, stages);
assert.ok(plan.filter(p => p.automatic).every(p => p.decision === 'skip' && /cumplido/.test(p.why)), 'con el objetivo cumplido no se lanza ninguna de pago');
plan = planStages(null, stages);
assert.ok(plan.filter(p => p.automatic).every(p => p.decision === 'skip' && /No se pudo contar/.test(p.why)), 'sin saber el hueco no se gasta');
plan = planStages(10, [stage('a', { available: false, reason: 'x' }), stage('b')]);
assert.deepEqual(plan.map(p => p.decision), ['skip', 'run'], 'si la primera no está disponible, la siguiente pasa a ser la primera');
assert.deepEqual(planStages(10, []).length, 0);

// ---- el día y la semana son UTC ----
assert.equal(dayStart(new Date('2026-11-22T23:59:59Z')), '2026-11-22T00:00:00.000Z');
assert.equal(weekStart(new Date('2026-11-22T10:00:00Z')), '2026-11-16T00:00:00.000Z', 'siete días contando hoy');

console.log('PASS  waterfall: objetivo con origen declarado, hueco que no supone lo que no mide y plan por etapas');
