import { test, expect } from '@playwright/test';
import { DEFAULT_CURRICULUM, resourcesOf } from '../../apps/web/lib/trainingCurriculum';

// La ruta importable, sus tests y el hub de recursos con el currículo versionado (la API se simula para
// que la prueba no dependa de que la migración esté aplicada). El catálogo de ofertas se neutraliza.
const emptyCatalog = (route: import('@playwright/test').Route) => route.fulfill({ json: { items: [], total: 0 } });
const first = DEFAULT_CURRICULUM.modules[0];
const lesson = first.lessons[0];

test('la formación recorre lección, corrige, reintenta y consolida el progreso', async ({ page }) => {
  await page.route('**/api/backend/opportunities/search', emptyCatalog);
  await page.route('**/api/training', route => route.fulfill({ json: { curriculum: DEFAULT_CURRICULUM, source: 'defaults' } }));
  await page.route('**/api/student/progress*', route => route.fulfill({ json: { progress: { streak: { current: 3 }, training: { lessons: [] } } } }));
  await page.route('**/api/student/activity', route => route.fulfill({ json: { ok: true } }));

  await page.goto('/');
  await page.getByRole('button', { name: 'Formación' }).click();

  // Frase del día y ruta: cuatro módulos, doce lecciones y los nueve módulos de método debajo.
  await expect(page.getByRole('heading', { name: 'De cero a tu primera candidatura, paso a paso.' })).toBeVisible();
  await expect(page.locator('.curriculum-module')).toHaveCount(4);
  await expect(page.locator('.training-grid .training-card')).toHaveCount(9);
  await expect(page.locator('.daily-quote blockquote')).toContainText(/\S/);
  await expect(page.getByText('Racha actual:')).toContainText('3');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByRole('button', { name: 'Guardada', exact: true })).toBeVisible();

  // Lección: contenido, recursos y test con feedback inmediato.
  await page.getByRole('button', { name: new RegExp(lesson.title) }).click();
  await expect(page.getByRole('heading', { name: lesson.title })).toBeVisible();
  await expect(page.locator('.lesson-resources .resource-card')).toHaveCount(lesson.resources.length);
  const questions = page.locator('.quiz-question');
  await expect(questions).toHaveCount(lesson.questions.length);

  // Todas mal: el feedback explica el porqué y ofrece reintentar solo las falladas.
  for (let index = 0; index < lesson.questions.length; index += 1) {
    const correct = lesson.questions[index].correct;
    await questions.nth(index).getByRole('radio').nth(correct === 0 ? 1 : 0).check();
  }
  for (let index = 0; index < lesson.questions.length; index += 1) await page.getByRole('button', { name: 'Comprobar la siguiente' }).click();
  await expect(page.locator('.quiz-feedback[data-ok="false"]')).toHaveCount(lesson.questions.length);
  await expect(page.locator('.quiz-fail')).toContainText('por consolidar');
  await page.getByRole('button', { name: 'Reintentar las falladas' }).click();
  await expect(page.locator('.quiz-feedback')).toHaveCount(0);

  // Todas bien: test superado, lección completada y guardada en este navegador.
  for (let index = 0; index < lesson.questions.length; index += 1) {
    await questions.nth(index).getByRole('radio').nth(lesson.questions[index].correct).check();
  }
  for (let index = 0; index < lesson.questions.length; index += 1) await page.getByRole('button', { name: 'Comprobar la siguiente' }).click();
  await expect(page.locator('.quiz-passed')).toContainText('Test superado');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('wdc_training_lessons') ?? '[]') as string[]);
  expect(stored).toContain(lesson.id);

  // Volver: el progreso real sube y el hub permite filtrar por tipo de recurso.
  await page.getByRole('button', { name: 'Toda la ruta' }).click();
  await expect(page.locator('.curriculum-badge')).toContainText('1/12');
  const templates = resourcesOf(DEFAULT_CURRICULUM).filter(item => item.resource.type === 'template').length;
  await page.locator('.resources-filters label').filter({ hasText: 'Tipo' }).getByRole('combobox').selectOption('template');
  await expect(page.locator('.resources-hub .resource-card')).toHaveCount(templates);

  // Móvil: la ruta y los filtros no generan scroll horizontal.
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
