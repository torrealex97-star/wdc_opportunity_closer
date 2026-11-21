// Tope mensual: el gasto se suma desde el día 1 del mes, con TODAS las ejecuciones paginadas.
// Antes `recentRuns(200)` dejaba fuera gasto real a mitad de mes y podía autorizar de más.
// Prueba con 10.001 ejecuciones (supera el tope artificial anterior de 10.000 y las 200 últimas) y con
// una ejecución de octubre que no debe entrar en noviembre. Sin red externa: usa el PostgREST simulado.
import assert from 'node:assert/strict';
import { startMocks } from './mock-services.mjs';
import { monthStart, spentFromNotes } from '../../apps/web/lib/providerBudget.ts';
import { runsThisMonth } from '../../apps/web/lib/external.ts';

const AUTH_PORT = Number(process.env.SPEND_WINDOW_AUTH_PORT ?? 8795);
const ENGINE_PORT = Number(process.env.SPEND_WINDOW_ENGINE_PORT ?? 8796);
process.env.SUPABASE_URL = `http://127.0.0.1:${AUTH_PORT}`;
process.env.SUPABASE_PUBLISHABLE_KEY = 'anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';

const { state, close } = startMocks({ authPort: AUTH_PORT, enginePort: ENGINE_PORT });
const note = (usd) => `proveedor=brightdata · coste_usd=${usd.toFixed(6)}`;
const row = (created_at, usd) => ({ source: 'brightdata', via: 'test', received: 0, accepted: 0, note: note(usd), created_at });

try {
  assert.equal(monthStart(new Date('2026-11-21T12:00:00Z')), '2026-11-01T00:00:00.000Z', 'noviembre empieza el día 1');
  assert.equal(monthStart(new Date('2026-12-01T00:30:00Z')), '2026-12-01T00:00:00.000Z', 'el cambio de mes no arrastra diciembre a noviembre');
  assert.equal(monthStart(new Date('2026-10-31T23:59:59Z')), '2026-10-01T00:00:00.000Z', 'octubre conserva su propio inicio');

  // 10.001 ejecuciones de noviembre: más de las 200 antiguas y del tope de 10.000 del paginador.
  state.ingestRuns = [];
  for (let i = 0; i < 10001; i++) state.ingestRuns.push(row(`2026-11-${String((i % 28) + 1).padStart(2, '0')}T12:00:00.000Z`, 0.001));
  state.ingestRuns.push(row('2026-10-31T23:59:59.000Z', 99));

  const november = await runsThisMonth(new Date('2026-11-21T12:00:00Z'));
  assert.ok(november, 'la lectura del mes no puede devolver null');
  assert.equal(november.length, 10001, 'se pagina hasta el final, no se corta en 10.000');
  assert.ok(Math.abs((spentFromNotes(november, 'brightdata').usd ?? 0) - 10.001) < 1e-9, 'la suma incluye las 10.001 ejecuciones');
  assert.ok(!november.some(item => item.note?.includes('99.000000')), 'la ejecución de octubre queda fuera de noviembre');

  // Cruce real: al entrar diciembre, una ejecución del día 1 entra y la de noviembre deja de contar.
  state.ingestRuns = [row('2026-11-30T23:59:59.000Z', 5), row('2026-12-01T00:00:00.000Z', 0.0015)];
  const december = await runsThisMonth(new Date('2026-12-01T00:30:00Z'));
  assert.ok(december);
  assert.equal(december.length, 1, 'diciembre empieza en su día 1, no arrastra noviembre');
  assert.ok(Math.abs((spentFromNotes(december, 'brightdata').usd ?? 0) - 0.0015) < 1e-9);

  console.log('PASS  tope mensual: 10.001 ejecuciones paginadas, sin truncar en 10.000 y con el corte de mes correcto');
} finally {
  close();
}
