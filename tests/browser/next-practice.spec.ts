import { test, expect } from '@playwright/test';

// «Tu siguiente práctica» y la evolución por eje salen de los mismos datos que ya guarda la actividad:
// aquí se simula el progreso y se comprueba que la recomendación se explica y arranca el escenario.
const progress = {
  days: 90, sessions: 2, last_seen: '2026-11-18T09:00:00Z', truncated: false,
  practice: { count: 6, avg: 61, best: 80 },
  training: { modules: [], examBest: null, examPassed: false, examAttempts: 0 },
  streak: { current: 0, best: 0 },
  weekly: [
    { week: '2026-11-16', avg: 61, count: 2 }, { week: '2026-11-09', avg: null, count: 0 }, { week: '2026-11-02', avg: null, count: 0 },
    { week: '2026-10-26', avg: null, count: 0 }, { week: '2026-10-19', avg: null, count: 0 }, { week: '2026-10-12', avg: null, count: 0 },
  ],
  axes: [
    { axis: 'cierre', avg: 40, track: 'closer', count: 4 },
    { axis: 'objecion', avg: 55, track: 'closer', count: 4 },
    { axis: 'encaje', avg: 20, track: 'entrevista', count: 2 },
    { axis: 'empatia', avg: 77, count: 5, track: null },
  ],
  // Hace seis días: la frase usa la fecha real de hoy, así que la prueba busca el patrón, no un número fijo.
  last_practice_at: new Date(Date.now() - 6 * 86_400_000).toISOString(),
  recent: [],
  lifetime: { practice: { count: 6, avg: 61, best: 80 }, training: { modules: [], examBest: null, examPassed: false, examAttempts: 0 }, achievements: [] },
};

const payload = { progress, metrics: { xp: { xp: 120, level: 1, floor: 0, next: 200, parts: [] }, mastery: [], applications: null }, retention: null };

test('la sala recomienda la siguiente práctica con su motivo y la arranca', async ({ page }) => {
  await page.route('**/api/backend/opportunities/search', route => route.fulfill({ json: { items: [], total: 0 } }));
  await page.route('**/api/student/progress*', route => route.fulfill({ json: payload }));
  await page.route('**/api/student/applications', route => route.fulfill({ status: 401, json: { detail: 'Entra con tu cuenta.' } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Sala de práctica' }).click();
  const card = page.getByRole('region', { name: 'Tu siguiente práctica' });
  await expect(card).toBeVisible();
  await expect(card.getByText('TU SIGUIENTE PRÁCTICA')).toBeVisible();
  // El motivo nombra el eje más flojo con datos suficientes y el tiempo sin practicar.
  await expect(card).toContainText(/Tu eje más flojo es «Cierre» \(40\/100 en 4 prácticas\)/);
  await expect(card).toContainText(/Llevas \d+ días sin practicar/);
  const title = (await card.getByRole('heading', { level: 2 }).innerText()).trim();
  await card.getByRole('button', { name: 'Practicar esta' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
});

test('competencias separa cada sala y pone «—» con menos de 3 datos', async ({ page }) => {
  await page.route('**/api/student/progress*', route => route.fulfill({ json: payload }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Mi progreso' }).click();
  await expect(page.getByRole('heading', { name: 'Tus competencias' })).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Cierre en closer (voz)' })).toHaveAttribute('aria-valuenow', '40');
  await expect(page.getByRole('progressbar', { name: 'Objeciones en closer (voz)' })).toHaveAttribute('aria-valuenow', '55');
  // La entrevista tiene 2 datos: no hay media, hay un hueco declarado con su causa.
  await expect(page.getByText('menos de 3 prácticas (2)')).toBeVisible();
  await expect(page.getByRole('progressbar', { name: 'Encaje en entrevista (voz)' })).toHaveCount(0);
  // Un eje sin sala se muestra aparte, no se suma a ninguna de las dos.
  await expect(page.getByRole('progressbar', { name: 'Apertura y marco en prácticas anteriores sin sala' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Prácticas anteriores sin sala' })).toBeVisible();
});
