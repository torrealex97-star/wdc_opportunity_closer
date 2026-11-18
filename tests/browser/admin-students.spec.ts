import { test, expect } from '@playwright/test';

// La tabla de alumnas y su ficha viven en AdminShell, que /admin solo monta con CAREER_ENGINE_URL
// (modo hosted). Igual que admin-cloud.spec.ts, sin ese servidor la prueba se omite en vez de mentir:
//   CAREER_ENGINE_URL=https://<engine> npm run dev -w apps/web
//   WDC_CLOUD_ADMIN=1 PLAYWRIGHT_CHANNEL=chrome npx playwright test tests/browser/admin-students.spec.ts
test.skip(process.env.WDC_CLOUD_ADMIN !== '1', 'requiere servidor con CAREER_ENGINE_URL y WDC_CLOUD_ADMIN=1');

test('el panel abre la ficha de una alumna concreta, no el agregado', async ({ page }) => {
  const students = [
    { id: '11111111-1111-4111-8111-111111111111', email: 'ana@alumna.dev', status: 'active', invited_by: 'owner', created_at: new Date().toISOString() },
    { id: '22222222-2222-4222-8222-222222222222', email: 'bea@alumna.dev', status: 'active', invited_by: 'owner', created_at: new Date().toISOString() },
  ];
  // La lista del panel trae el agregado; la ficha debe leer SOLO a la alumna elegida.
  const progress = (avg: number, count: number) => ({
    days: 30, sessions: 4, last_seen: new Date().toISOString(), truncated: false,
    practice: { count, avg, best: avg }, training: { modules: [], examBest: null, examPassed: false, examAttempts: 0 },
    streak: { current: 2, best: 5 },
    weekly: Array.from({ length: 6 }, (_, i) => ({ week: new Date(Date.now() - (5 - i) * 7 * 86400000).toISOString().slice(0, 10), avg: i === 5 ? avg : null, count: i === 5 ? count : 0 })),
    axes: [{ axis: 'objecion', avg }],
    recent: [{ id: 'r1', kind: 'practice', ref: 'objeciones-precio', score: avg, detail: {}, created_at: new Date().toISOString() }],
    lifetime: { practice: { count, avg, best: avg }, training: { modules: [], examBest: null, examPassed: false, examAttempts: 0 }, achievements: [] },
  });
  const asked: string[] = [];
  await page.route('**/api/admin/session', route => route.fulfill({ json: { configured: true, authenticated: true, email: 'owner@wdc.test', role: 'owner' } }));
  await page.route(/\/api\/admin\/students\?/, route => route.fulfill({
    json: {
      students, days: 30, activity_available: true, applications_available: true, applications_truncated: false,
      activity: [{ student: { id: students[0].id }, summary: { sessions: 3, last_seen: null, practice: { count: 9, avg: 88 }, training: { modules: [], examBest: null, examPassed: false }, streak: { current: 1 } } }],
      totals: { entered7: 2, active: 2, practices: 9, exams_passed: 0 }, truncated: false,
    },
  }));
  await page.route(/\/api\/admin\/students\/[^/]+\/progress/, route => {
    const id = route.request().url().match(/students\/([^/]+)\/progress/)?.[1] ?? '';
    asked.push(id);
    const student = students.find(s => s.id === id)!;
    const avg = student.email.startsWith('ana') ? 88 : 42;
    return route.fulfill({
      json: {
        student, days: 30, progress: progress(avg, avg === 88 ? 9 : 3),
        metrics: { xp: { level: 3, xp: 1200, floor: 1000, next: 2000, parts: [] }, mastery: [], applications: null, applications_truncated: null },
        retention: null,
      },
    });
  });
  await page.goto('/admin#students');
  await expect(page.getByRole('heading', { name: 'Alumnas con acceso.' })).toBeVisible();
  await page.getByRole('button', { name: 'Ver progreso de bea@alumna.dev' }).click();
  const dialog = page.getByRole('dialog', { name: 'Progreso de bea@alumna.dev' });
  await expect(dialog).toBeVisible();
  // El titular es la alumna abierta y sus cifras son las suyas, no la media del panel.
  await expect(dialog.getByRole('heading', { name: 'bea@alumna.dev', exact: true })).toBeVisible();
  await expect(dialog.locator('.stat-strip')).toContainText('42');
  await expect(dialog.locator('.stat-strip')).not.toContainText('88');
  expect(asked).toEqual(['22222222-2222-4222-8222-222222222222']);
  await page.getByRole('button', { name: 'Cerrar el progreso' }).click();
  await expect(dialog).not.toBeVisible();
  // La misma ficha, otra alumna: otra lectura y otro id en la petición.
  await page.getByRole('button', { name: 'Ver progreso de ana@alumna.dev' }).click();
  const second = page.getByRole('dialog', { name: 'Progreso de ana@alumna.dev' });
  await expect(second.locator('.stat-strip')).toContainText('88');
  expect(asked.at(-1)).toBe('11111111-1111-4111-8111-111111111111');
  await page.keyboard.press('Escape');
  await expect(second).not.toBeVisible();
});
