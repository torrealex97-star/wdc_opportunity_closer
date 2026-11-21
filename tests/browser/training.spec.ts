import { test, expect } from './stubs';
import { TRAINING_COURSES, TOTAL_LESSONS, TOTAL_RESOURCES } from '../../apps/web/lib/trainingCourses';
import { quizFor } from '../../apps/web/lib/trainingQuiz';
import { classLinkForLesson } from '../../apps/web/lib/skoolClass';

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

test('las carpetas de la hoja se respetan: «Clases Grupales» enseña sus cuatro grupos', async ({ page }) => {
  await page.route('**/api/backend/opportunities/search', emptyCatalog);
  await page.goto('/');
  await page.getByRole('button', { name: 'Formación' }).click();

  const groupCourse = page.locator('.training-grid .training-card').last();
  await expect(groupCourse.locator('h2')).toHaveText('Clases Grupales');
  await groupCourse.getByRole('button', { name: 'Abrir curso' }).click();

  // Cuatro carpetas, en el orden y con los tamaños que declara la hoja (9 + 15 + 4 + 7 = 35).
  const folders = groupCourse.locator('.training-folder');
  await expect(folders).toHaveCount(4);
  await expect(folders.locator('h3')).toHaveText([
    'Clases grupales · 9 lecciones',
    'Roleplay Cualificación · 15 lecciones',
    'Objeciones · 4 lecciones',
    'Llamada completa · 7 lecciones',
  ]);
  await expect(groupCourse.locator('.training-lessons > li')).toHaveCount(35);
  // La numeración sigue siendo la del curso completo, no la de cada carpeta.
  await expect(groupCourse.locator('.training-lesson-order').first()).toHaveText('01');
  await expect(groupCourse.locator('.training-lesson-order').last()).toHaveText('35');
});

test('el repaso del curso se responde, no se marca: dos preguntas y queda registrado', async ({ page }) => {
  const logged: Record<string, unknown>[] = [];
  await page.route('**/api/student/activity', route => {
    logged.push(route.request().postDataJSON());
    return route.fulfill({ status: 201, json: { ok: true } });
  });
  await page.route('**/api/backend/opportunities/search', emptyCatalog);
  await page.goto('/');
  await page.getByRole('button', { name: 'Formación' }).click();

  // No hay casillas en ninguna parte de la formación: el avance se gana respondiendo.
  await expect(page.locator('.training input[type=checkbox]')).toHaveCount(0);

  const onboarding = page.locator('.training-grid .training-card').first();
  const quiz = onboarding.locator('.training-quiz-block');
  await expect(quiz.getByText('PREGUNTA 1 DE 2')).toBeVisible();

  // Primera pregunta: se elige, se explica el porqué y no hay registro hasta terminar.
  await quiz.getByRole('button', { name: 'Diagnosticar antes de proponer' }).click();
  await expect(quiz.getByText(/el propósito no es cerrar, es diagnosticar/)).toBeVisible();
  expect(logged).toHaveLength(0);

  await quiz.getByRole('button', { name: 'Siguiente pregunta' }).click();
  await quiz.getByRole('button', { name: 'Un dato estadístico, no un juicio personal' }).click();
  await quiz.getByRole('button', { name: 'Terminar el repaso' }).click();

  await expect(quiz.getByText('2 de 2')).toBeVisible();
  await expect.poll(() => logged.length).toBe(1);
  expect(logged[0]).toMatchObject({ kind: 'training_review', ref: 'onboarding', detail: { met: 2, total: 2 } });
  await expect(onboarding.getByText('Aprobado 2/2')).toBeVisible();

  // Repetir el repaso vuelve a empezar por la primera pregunta y acierta lo mismo.
  await quiz.getByRole('button', { name: 'Repetir las preguntas' }).click();
  await expect(quiz.getByText('PREGUNTA 1 DE 2')).toBeVisible();
});

test('los recursos no se marcan: se abren aparte para quien los necesite', async ({ page }) => {
  await page.route('**/api/backend/opportunities/search', emptyCatalog);
  await page.goto('/');
  await page.getByRole('button', { name: 'Formación' }).click();

  // Los recursos de la lección son opcionales: no se marcan, se abren en otra pestaña.
  const onboarding = page.locator('.training-grid .training-card').first();
  const identity = onboarding.locator('.training-lessons > li').nth(1);
  await expect(identity.locator('.training-resources a')).toHaveAttribute('target', '_blank');
  await expect(onboarding.locator('.training-quiz-block')).toHaveCount(1);
});

test('cada lección y cada curso abren su clase en Skool; la explicación del repaso, la suya', async ({ page }) => {
  await page.route('**/api/backend/opportunities/search', emptyCatalog);
  await page.goto('/');
  await page.getByRole('button', { name: 'Formación' }).click();

  const onboarding = page.locator('.training-grid .training-card').first();
  // El curso abre su módulo del Classroom, con el enlace que trae la hoja.
  await expect(onboarding.locator(':scope > a.skool-link')).toHaveAttribute('href', TRAINING_COURSES[0].url!);
  // Y cada lección abre su clase concreta, no la del módulo.
  const firstLesson = onboarding.locator('.training-lessons > li').first();
  await expect(firstLesson.locator('.training-lesson-title a')).toHaveAttribute('href', TRAINING_COURSES[0].lessons[0].url!);
  await expect(firstLesson.locator('.training-lesson-title a')).toHaveAttribute('target', '_blank');
  await expect(firstLesson.locator('.training-lesson-title a')).toHaveText('Bienvenida a Women Digital Closers');

  // La explicación de una pregunta devuelve a la clase donde se enseña lo que acaba de explicar.
  const question = quizFor('onboarding')[0];
  await onboarding.locator('.quiz-options button').nth(question.correct).click();
  await expect(onboarding.locator('.quiz-why .skool-link')).toHaveAttribute('href', classLinkForLesson(question.lesson)!.url);
  await expect(onboarding.locator('.quiz-why .skool-link')).toContainText(`Ver la clase ${question.lesson} en Skool`);
});

test('repasar sin aprobar no completa el curso y deja sus ideas flojas a la vista', async ({ page }) => {
  const logged: Record<string, unknown>[] = [];
  await page.route('**/api/student/activity', route => {
    logged.push(route.request().postDataJSON());
    return route.fulfill({ status: 201, json: { ok: true } });
  });
  await page.route('**/api/backend/opportunities/search', emptyCatalog);
  await page.goto('/');
  await page.getByRole('button', { name: 'Formación' }).click();

  const onboarding = page.locator('.training-grid .training-card').first();
  const quiz = onboarding.locator('.training-quiz-block');
  // Las dos respuestas, mal: 0/2 no puede valer lo mismo que 2/2.
  await quiz.getByRole('button', { name: 'Cerrar como sea' }).click();
  await quiz.getByRole('button', { name: 'Siguiente pregunta' }).click();
  await quiz.getByRole('button', { name: 'Que la oferta no sirve' }).click();
  await quiz.getByRole('button', { name: 'Terminar el repaso' }).click();

  await expect(quiz.getByText('REPASO SIN APROBAR')).toBeVisible();
  await expect(quiz.getByText('0 de 2')).toBeVisible();
  await expect(onboarding.getByText('Repasado 0/2 · sin aprobar')).toBeVisible();
  await expect(onboarding).toHaveAttribute('data-complete', 'false');

  // Y sus ideas flojas: las dos preguntas falladas, cada una con su clase.
  const missed = quiz.locator('.training-missed');
  await expect(missed.getByRole('heading', { name: 'Tus ideas flojas' })).toBeVisible();
  await expect(missed.locator('li')).toHaveCount(2);
  await expect(missed.locator('li').first()).toContainText('¿Cuál es el trabajo de una closer durante la llamada?');
  await expect(missed.locator('li a').first()).toHaveAttribute('href', classLinkForLesson(quizFor('onboarding')[0].lesson)!.url);

  // El servidor recibe el intento con sus falladas; el aprobado lo decide él (lo prueba `activity.mjs`).
  await expect.poll(() => logged.length).toBe(1);
  expect(logged[0]).toMatchObject({ kind: 'training_review', ref: 'onboarding', detail: { met: 0, total: 2 } });
  expect((logged[0] as { detail: { missed: string[] } }).detail.missed).toEqual(['onboarding-1', 'onboarding-2']);
});

test('«¿Dónde se enseña esto?» responde con módulo, lección, duración y recurso, sin modelo', async ({ page }) => {
  await page.route('**/api/backend/opportunities/search', emptyCatalog);
  await page.goto('/');
  await page.getByRole('button', { name: 'Formación' }).click();

  const finder = page.locator('.where-taught');
  await expect(finder.getByRole('heading', { name: '¿Dónde se enseña esto?' })).toBeVisible();
  await expect(finder.getByText('12 módulos · 130 lecciones · 64 temas', { exact: false })).toBeVisible();
  await expect(finder.locator('.where-list')).toHaveCount(0);

  // La pregunta se escribe como la haría una alumna y la respuesta es una clase concreta del mapa.
  await finder.getByLabel('Qué quieres encontrar').fill('¿dónde se enseña la objeción de pareja?');
  await finder.getByRole('button', { name: 'Buscar' }).click();

  const first = finder.locator('.where-list > li').first();
  await expect(first.locator('.where-code')).toHaveText('7.5');
  await expect(first).toContainText('Lo tengo que consultar con mi pareja');
  await expect(first).toContainText('Módulo 7 · Gestión de las objeciones.');
  await expect(first).toContainText(/\d{1,2}:\d{2}:\d{2}/);
  await expect(first.locator('.where-resource')).toHaveAttribute('href', /^https:\/\//);
  await expect(first.locator('a.skool-link')).toHaveAttribute('href', /^https:\/\/www\.skool\.com\/women-digital-closers\/classroom\//);

  // Lo que no está en el mapa se dice, no se rellena con una clase cualquiera.
  await finder.getByLabel('Qué quieres encontrar').fill('paella valenciana');
  await finder.getByRole('button', { name: 'Buscar' }).click();
  await expect(finder.locator('[role=status]')).toContainText('El mapa del Classroom no tiene ese tema');
  await expect(finder.locator('.where-list')).toHaveCount(0);
});
