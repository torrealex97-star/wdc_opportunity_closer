// Ida y vuelta panel → persistencia → puntuación sin banderas de entorno: usa el backend local de
// desarrollo (SQLite) en un directorio temporal, guarda con la MISMA función que llama la ruta del
// panel, recarga con `loadPracticeConfig` y puntúa un feedback fijo con esas rúbricas.
// node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/practice-persistence.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dir = mkdtempSync(path.join(tmpdir(), 'wdc-rubric-store-'));
process.env.NODE_ENV = 'development';
process.env.SUPABASE_URL = '';
process.env.NEXT_PUBLIC_SUPABASE_URL = '';
process.env.SUPABASE_PUBLISHABLE_KEY = '';
process.env.SUPABASE_ANON_KEY = '';
process.env.SUPABASE_SERVICE_ROLE_KEY = '';
process.env.PRACTICE_DB_PATH = path.join(dir, 'practice-rubrics.sqlite');

const { loadPracticeConfig, resetPracticeConfig, savePracticeConfig, usesLocalPracticeStore } = await import('../../apps/web/lib/practiceRubricStore.ts');
const { cleanDebrief } = await import('../../apps/web/app/api/practice/debrief.ts');
const { DEFAULT_BANT, DEFAULT_PRIORITIES, DEFAULT_RUBRICS } = await import('../../apps/web/lib/practiceRubrics.ts');
const { scenarioById } = await import('../../apps/web/components/practiceScenarios.ts');

const results = [];
const step = async (name, fn) => { try { await fn(); results.push(['PASS', name]); } catch (error) { results.push(['FAIL', name, error.message.split('\n')[0]]); } };
const clone = value => JSON.parse(JSON.stringify(value));

function debriefFor(rubrics) {
  return JSON.stringify({
    summary: 'Práctica de prueba.', focus: 'Cerrar.', strengths: [], improvements: [], model: '',
    next: 'Repite con un cierre concreto.',
    axes: rubrics.venta.map((axis, index) => ({ id: axis.id, score: index === 0 ? 100 : 0, note: '', quote: '' })),
    bant: {
      budget: { status: '?', quote: '' }, authority: { status: '?', quote: '' },
      need: { status: '?', quote: '' }, timing: { status: '?', quote: '' },
      decision: 'paro_demasiado_pronto',
    },
  });
}
const turns = [{ role: 'user', content: 'Hola Marta, te llamo porque he visto que perdéis seguimientos. ¿Te importa que te haga una pregunta?' }];

await step('sin Supabase en desarrollo se usa el backend local y se empieza por los valores de las skills', async () => {
  assert.equal(usesLocalPracticeStore(), true);
  const config = await loadPracticeConfig(true);
  assert.equal(config.backend, 'local');
  assert.equal(config.source, 'defaults');
  assert.equal(config.rubrics.venta[0].weight, 10);
});

await step('guardar en el backend local persiste y se relee (sobrevive a una instancia nueva)', async () => {
  const rubrics = clone(DEFAULT_RUBRICS);
  rubrics.venta[0] = { ...rubrics.venta[0], label: 'Apertura con prueba social', weight: 100, guide: 'Abre con una prueba de un caso idéntico y pide permiso.' };
  const saved = await savePracticeConfig({ rubrics, priorities: DEFAULT_PRIORITIES, bant: DEFAULT_BANT }, 'owner@local');
  assert.ok(saved.ok, saved.ok ? '' : saved.detail);
  const reloaded = await loadPracticeConfig(true);
  assert.equal(reloaded.backend, 'local');
  assert.equal(reloaded.source, 'db');
  assert.equal(reloaded.rubrics.venta[0].weight, 100);
  assert.equal(reloaded.rubrics.venta[0].label, 'Apertura con prueba social');
  assert.equal(reloaded.version, 1);
  assert.equal(reloaded.history.length, 1);
  assert.equal(reloaded.history[0].config.rubrics.venta[0].weight, 100);
});

await step('la puntuación usa el peso guardado: 100 de apertura sobre 190 → 53', async () => {
  const config = await loadPracticeConfig(true);
  const scenario = scenarioById('venta-fria');
  const debrief = cleanDebrief(debriefFor(config.rubrics), turns, scenario, config.rubrics, config.bant);
  assert.ok(debrief);
  assert.equal(debrief.score, 53);
  assert.equal(debrief.axes[0].label, 'Apertura con prueba social');
});

await step('cada guardado crea una versión y restaurar una anterior crea otra (no reescribe el historial)', async () => {
  const rubrics = clone(DEFAULT_RUBRICS);
  rubrics.venta[0] = { ...rubrics.venta[0], weight: 20 };
  const second = await savePracticeConfig({ rubrics, priorities: DEFAULT_PRIORITIES, bant: DEFAULT_BANT }, 'owner@local');
  assert.ok(second.ok, second.ok ? '' : second.detail);
  assert.equal((await loadPracticeConfig(true)).version, 2);
  const restored = await savePracticeConfig({ restore_version: 1 }, 'owner@local');
  assert.ok(restored.ok, restored.ok ? '' : restored.detail);
  const config = await loadPracticeConfig(true);
  assert.equal(config.version, 3);
  assert.equal(config.rubrics.venta[0].weight, 100);
  assert.equal(config.history.length, 3);
  assert.match(config.history[2].note, /Restaurada la versión 1/);
  assert.equal((await savePracticeConfig({ restore_version: 99 }, 'owner@local')).ok, false);
});

await step('restaurar borra lo guardado y devuelve los pesos y la nota a la skill (10 → 10)', async () => {
  const reset = await resetPracticeConfig();
  assert.ok(reset.ok, reset.ok ? '' : reset.detail);
  const config = await loadPracticeConfig(true);
  assert.equal(config.source, 'defaults');
  assert.equal(config.rubrics.venta[0].weight, 10);
  const debrief = cleanDebrief(debriefFor(config.rubrics), turns, scenarioById('venta-fria'), config.rubrics, config.bant);
  assert.ok(debrief);
  assert.equal(debrief.score, 10);
});

await step('una configuración guardada inválida se declara y no se sirve a medias', async () => {
  const rubrics = clone(DEFAULT_RUBRICS);
  rubrics.setter = [];
  const saved = await savePracticeConfig({ rubrics, priorities: DEFAULT_PRIORITIES, bant: DEFAULT_BANT }, 'owner@local');
  assert.equal(saved.ok, false);
  assert.match(saved.detail, /entre 3 y 8 criterios/);
});

rmSync(dir, { recursive: true, force: true });
for (const [status, name, detail] of results) console.log(status, ' ', name, detail ?? '');
const failed = results.filter(result => result[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} pasos OK`);
process.exit(failed ? 1 : 0);
