// Límite mensual de gasto en medios de pago y su reparto: un control que se guarda desde el panel y que
// gobierna lo que se lanza. Se prueban las reglas puras (validación y plan); la base y la UI se comprueban
// en el panel, no aquí.
// Uso: node --experimental-strip-types tests/paid-budget.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = new URL('../apps/web/lib/spendPlan.ts', import.meta.url);
const { MIN_RUN_USD, approvedPerUsd, measuredCost, parseMonthlyUsd, spendPlan, measuredYield } = await import(src.href);

// 1) Validación: un importe fuera de rango no se recorta en silencio, se rechaza.
assert.equal(parseMonthlyUsd(25), 25, '25 USD es válido');
assert.equal(parseMonthlyUsd('12.5'), 12.5, 'acepta texto numérico del formulario');
assert.equal(parseMonthlyUsd(1), 1, 'el mínimo es válido');
assert.equal(parseMonthlyUsd(5000), 5000, 'el máximo es válido');
assert.equal(parseMonthlyUsd(0.5), null, 'por debajo del mínimo no vale');
assert.equal(parseMonthlyUsd(5001), null, 'por encima del máximo no vale');
assert.equal(parseMonthlyUsd(''), null, 'vacío no vale');
assert.equal(parseMonthlyUsd('abc'), null, 'texto no numérico no vale');

// 2) El límite reparte: con 10 USD y cinco rutas de 2 USD de tope, cada una recibe su parte.
const five = ['a', 'b', 'c', 'd', 'e'].map(code => ({ code, qualified_per_usd: null }));
const full = spendPlan(10, 0, five, 2);
assert.deepEqual(full.order, ['a', 'b', 'c', 'd', 'e'], 'sin medición se respeta el orden recibido');
assert.equal(full.caps.a, 2, 'cada ruta recibe hasta su tope');
assert.equal(full.remaining, 0, 'el plan no deja dinero sin asignar cuando cabe');
assert.deepEqual(full.deferred, [], 'nada se aplaza si el dinero cabe');

// 3) Primero el que más ofertas APROBADAS da por dólar; sin medición, al final y declarado.
const ranked = spendPlan(100, 0, [
  { code: 'sin-medir', qualified_per_usd: null },
  { code: 'malo', qualified_per_usd: 0.4 },
  { code: 'bueno', qualified_per_usd: 6 },
], 2);
assert.deepEqual(ranked.order, ['bueno', 'malo', 'sin-medir'], 'primero el que más aprobadas da por dólar');

// 4) Si el mes no da ni para una búsqueda mínima, no se lanza ninguna y se dice cuánto queda.
const broke = spendPlan(10, 9.7, five, 2);
assert.deepEqual(broke.order, [], 'sin dinero suficiente no se lanza nada');
assert.equal(broke.deferred.length, 5, 'todas las rutas quedan aplazadas y visibles');
assert.match(broke.deferred[0].reason, /0\.30 USD de 10 USD/, 'el motivo dice cuánto queda, no un «error» genérico');
assert.ok(MIN_RUN_USD > 0 && broke.deferred[0].reason.includes(String(MIN_RUN_USD)), 'el motivo declara el mínimo por búsqueda');

// 5) Reparto justo cuando queda poco: 3 USD entre tres rutas de tope 2.
const tight = spendPlan(10, 7, ['x', 'y', 'z'].map(code => ({ code, qualified_per_usd: null })), 2);
assert.deepEqual(tight.order, ['x', 'y', 'z'], 'todas caben');
assert.deepEqual(Object.values(tight.caps), [1, 1, 1], 'se reparte a partes iguales, no todo a la primera');

// 6) Gasto ilegible = no se lanza gasto nuevo (nunca se supone cero).
const unknown = spendPlan(10, null, five, 2);
assert.deepEqual(unknown.order, [], 'sin saber lo gastado no se lanza nada');
assert.match(unknown.deferred[0].reason, /no se pudo leer lo gastado/);

// 7) Rendimiento medido: ofertas por dólar de las ejecuciones cerradas; sin coste, no se supone.
assert.equal(measuredYield([{ cost_usd: null, harvested: 50, status: 'SUCCEEDED', finished_at: '2026-11-18T10:00:00Z' }]), null);
assert.equal(measuredYield([{ cost_usd: 2, harvested: 100, status: 'SUCCEEDED', finished_at: '2026-11-18T10:00:00Z' }]), 50);
assert.equal(measuredYield([{ cost_usd: 2, harvested: 100, status: 'RUNNING', finished_at: null }]), null, 'una ejecución en curso no mide nada todavía');

// 8) LA PRUEBA DEL CAMBIO: manda lo que se aprueba, no lo que se recoge. Dos portales con el mismo coste; el que
// recoge diez veces más pero no se aprueba va después del que trae poco y bueno.
const cerrado = (cost, harvested) => ({ cost_usd: cost, harvested, status: 'SUCCEEDED', finished_at: '2026-11-18T10:00:00Z' });
const muchoYmalo = [cerrado(1, 400)], pocoYbueno = [cerrado(1, 40)];
assert.equal(measuredYield(muchoYmalo), 400, 'recogidas por dólar: el ruidoso gana con la medida vieja');
assert.equal(measuredYield(pocoYbueno), 40);
assert.equal(approvedPerUsd(muchoYmalo, 2), 2, '2 aprobadas por 1 USD');
assert.equal(approvedPerUsd(pocoYbueno, 12), 12, '12 aprobadas por 1 USD');
const byQualified = spendPlan(100, 0, [
  { code: 'recoge-mucho', qualified_per_usd: approvedPerUsd(muchoYmalo, 2) },
  { code: 'aprueba-mucho', qualified_per_usd: approvedPerUsd(pocoYbueno, 12) },
], 2);
assert.deepEqual(byQualified.order, ['aprueba-mucho', 'recoge-mucho'], 'el dinero va a quien da ofertas que apruebas');
assert.equal(byQualified.caps['aprueba-mucho'], 2, 'y el primero cobra su parte completa antes que el otro');

// 9) Aprobadas y coste: sin coste o sin recuento no hay rendimiento (hueco declarado, nunca cero).
assert.equal(approvedPerUsd([cerrado(null, 10)], 5), null, 'sin coste registrado no se presume rendimiento');
assert.equal(approvedPerUsd([cerrado(1, 10)], null), null, 'si no se pudieron contar las aprobadas, no hay medida');
assert.equal(approvedPerUsd([{ ...cerrado(1, 10), status: 'RUNNING', finished_at: null }], 5), null, 'una ejecución en curso no cuenta');
assert.equal(approvedPerUsd([cerrado(1, 10)], 0), 0, 'cero aprobadas con coste es un cero medido, no un hueco');
assert.equal(measuredCost([cerrado(0.5, 3), cerrado(0.25, 1), { ...cerrado(9, 1), status: 'FAILED' }]), 0.75, 'solo suma lo terminado con coste');

// 8) El límite guardado tiene que existir como tabla versionada y usarse en los dos sitios que gastan.
const sql = readFileSync(new URL('../supabase/migrations/20261118_paid_budget.sql', import.meta.url), 'utf8');
assert.match(sql, /create table if not exists public\.paid_budget/, 'la migración crea la tabla');
assert.match(sql, /check \(monthly_usd >= 1 and monthly_usd <= 5000\)/, 'la tabla valida el rango, como el formulario');
assert.match(sql, /enable row level security/, 'solo la clave de servicio la alcanza');
const apify = readFileSync(new URL('../apps/web/lib/apify.ts', import.meta.url), 'utf8');
assert.match(apify, /await budgetLimitUsd\(\)/, 'el lanzamiento de pago usa el límite guardado, no solo el entorno');
const auto = readFileSync(new URL('../apps/web/lib/apifyAuto.ts', import.meta.url), 'utf8');
assert.match(auto, /spendPlan\(/, 'la búsqueda diaria reparte según el límite');
assert.match(auto, /qualified_per_usd: approvedPerUsd\(/, 'el cron reparte por aprobadas por dólar, no por recogidas');
assert.match(auto, /approvedBySource\(/, 'las aprobadas salen de la base, no de una suposición');
const ui = readFileSync(new URL('../apps/web/components/ApifyTab.tsx', import.meta.url), 'utf8');
assert.match(ui, /aprobadas por dólar/, 'el panel explica por qué se prioriza');
assert.match(ui, /p\.priority\.note/, 'y cada tarjeta dice su puesto y su medida');

console.log('PASS  límite de gasto: validación, reparto por ofertas aprobadas por dólar, aplazamiento declarado y uso en el lanzamiento');
