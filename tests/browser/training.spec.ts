import { test, expect } from './stubs';
import { TRAINING_COURSES, TOTAL_LESSONS, TOTAL_RESOURCES } from '../../apps/web/lib/trainingCourses';

// La vista de alumna carga oportunidades al montar: se neutraliza para aislar formación.
const emptyCatalog = (route: import('@playwright/test').Route) => route.fulfill({ json: { items: [], total: 0 } });

// Marcar un curso completo registra actividad (una vez): se simula en toda la prueba.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/student/activity', route => route.fulfill({ status: 201, json: { ok: true } }));
});

test('la formación es la hoja del propietario: sus cursos, sus lecciones y sus recursos', async ({ page }) => {
  await page.route('**/api/backend/opportunities/search', emptyCatalog);
  await page.goto('/');
  await page.getByRole('button', { name: 'Formación' }).click();

  await expect(page.getByRole('heading', { name: 'Aprende el método antes de improvisar.' })).toBeVisible();
  // Exactamente los doce cursos de la hoja, en su orden, sin módulos añadidos.
  await expect(page.locator('.training-grid .training-card')).toHaveCount(12);
  await expect(page.locator('.training-grid .training-card h2')).toHaveText(TRAINING_COURSES.map(course => course.title));
  await expect(page.getByText(`${TOTAL_LESSONS} lecciones`, { exact: false }).first()).toBeVisible();
  await expect(page.getByText(`${TOTAL_RESOURCES} recursos enlazados`, { exact: false })).toBeVisible();

  // El primer curso abre con sus lecciones y la duración que declara la hoja.
  const onboarding = page.locator('.training-grid .training-card').first();
  await expect(onboarding.getByText('0:19:23')).toBeVisible();
  await expect(onboarding.locator('.training-lessons > li')).toHaveCount(4);
  await expect(onboarding.locator('.training-lesson-title').first()).toHaveText('Bienvenida a Women Digital Closers');

  // Los recursos de la lección enlazan al material original (documento de Drive/Google Docs).
  const identity = onboarding.locator('.training-lessons > li').nth(1);
  await expect(identity.locator('.training-resources a')).toHaveCount(1);
  await expect(identity.locator('.training-resources a')).toHaveAttribute('href', /^https:\/\/docs\.google\.com\//);
  await expect(identity.locator('.training-resources a')).toHaveAttribute('target', '_blank');
});

test('marcar todas las lecciones de un curso lo registra una sola vez como formación estudiada', async ({ page }) => {
  const logged: Record<string, unknown>[] = [];
  await page.route('**/api/student/activity', route => {
    logged.push(route.request().postDataJSON());
    return route.fulfill({ status: 201, json: { ok: true } });
  });
  await page.route('**/api/backend/opportunities/search', emptyCatalog);
  await page.goto('/');
  await page.getByRole('button', { name: 'Formación' }).click();

  const onboarding = page.locator('.training-grid .training-card').first();
  const checks = onboarding.locator('.training-lessons input[type=checkbox]');
  await expect(checks).toHaveCount(4);
  for (const index of [0, 1, 2]) await checks.nth(index).check();
  // Con una lección pendiente todavía no hay registro.
  expect(logged).toHaveLength(0);
  await checks.nth(3).check();
  await expect.poll(() => logged.length).toBe(1);
  expect(logged[0]).toMatchObject({ kind: 'training_review', ref: 'onboarding', detail: { met: 4, total: 4 } });
  await expect(onboarding.getByText('Estudiado', { exact: true })).toBeVisible();

  // Desmarcar y volver a completar no duplica el registro.
  await checks.nth(0).uncheck();
  await expect(onboarding.getByText('Estudiado', { exact: true })).toHaveCount(0);
  await checks.nth(0).check();
  await expect.poll(() => logged.length).toBe(1);
});
