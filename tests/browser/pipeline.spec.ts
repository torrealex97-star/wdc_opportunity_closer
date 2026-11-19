import { test, expect, type Page } from '@playwright/test';

// Tablero de /alumna: el seguimiento pasó de lista a pipeline y este test fija lo que no debe
// romperse —mover una tarjeta de columna, guardar una nota y la puerta del asistente— con la API
// simulada, sin Supabase ni proveedor de IA.
type App = { id: string; offer_ref: string; offer_title: string; offer_company: string; offer_url: string; status: string; cover_message: string; notes: string; created_at: string; updated_at: string; applied_at: string | null };

const base = (over: Partial<App> = {}): App => ({
  id: '11111111-1111-4111-8111-111111111111', offer_ref: 'ext-22222222-2222-4222-8222-222222222222',
  offer_title: 'Closer de ventas', offer_company: 'Acme', offer_url: 'https://example.com/oferta',
  status: 'draft', cover_message: 'Hola, equipo de Acme:', notes: '', created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(), applied_at: null, ...over,
});

// Devuelve el estado mutable: las rutas lo leen y lo escriben, así el refetch tras guardar refleja
// el cambio real en vez de una respuesta fija que taparía un fallo de persistencia.
async function mockPortal(page: Page) {
  const state = { applications: [base()] };
  const calls: Array<{ path: string; body: Record<string, unknown> }> = [];

  await page.route('**/api/student/session', route => route.fulfill({ json: { authenticated: true, email: 'bea@ejemplo.com' } }));
  await page.route('**/api/student/profile', route => route.fulfill({ json: { profile: { full_name: 'Bea Ruiz', city: 'Sevilla', target_roles: ['closer'], languages: ['es'], availability: null, video_url: null, consent_at: new Date().toISOString() } } }));
  await page.route('**/api/student/matches', route => route.fulfill({ json: { ready: true, matches: [] } }));
  await page.route('**/api/student/application-profile', route => route.fulfill({ json: { profile: null, completeness: { pct: 10, missing: [] }, options: { work_authorization: {}, levels: {}, contracts: {}, answers: {} }, base_consent: true } }));

  await page.route('**/api/student/applications*', async route => {
    const request = route.request();
    if (request.method() === 'GET') return route.fulfill({ json: { applications: state.applications, copy: [], assisted_only: true } });
    const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
    calls.push({ path: new URL(request.url()).pathname, body });
    const row = state.applications.find(item => item.id === body.id);
    if (!row) return route.fulfill({ status: 404, json: { detail: 'Candidatura no encontrada.' } });
    if (typeof body.status === 'string') row.status = body.status;
    if (typeof body.notes === 'string') row.notes = body.notes;
    if (typeof body.cover_message === 'string') row.cover_message = body.cover_message;
    if (row.status === 'applied' && !row.applied_at) row.applied_at = new Date().toISOString();
    row.updated_at = new Date().toISOString();
    return route.fulfill({ json: { ok: true, application: row } });
  });

  // La puerta del asistente tal como se comporta sin clave: 503 con su motivo, nunca una respuesta inventada.
  const assistant: Array<Record<string, unknown>> = [];
  await page.route('**/api/student/answer-assistant', route => {
    assistant.push((route.request().postDataJSON() ?? {}) as Record<string, unknown>);
    return route.fulfill({ status: 503, json: { detail: 'El asistente de respuestas no está configurado en este despliegue.' } });
  });
  return { state, calls, assistant };
}

test('el tablero mueve la tarjeta de columna, guarda la nota y el asistente contesta su puerta', async ({ page }) => {
  const { state, calls, assistant } = await mockPortal(page);
  await page.goto('/alumna');

  const interested = page.getByTestId('stage-interested');
  const applied = page.getByTestId('stage-applied');
  await expect(interested.getByText('Closer de ventas', { exact: true })).toBeVisible();
  await expect(applied.getByTestId('application')).toHaveCount(0);

  // 1) Mover: borrador → enviada, con el estado que acepta el servidor.
  await page.getByTestId('outcome-applied').click();
  await expect.poll(() => calls.some(call => call.body.status === 'applied')).toBe(true);
  await expect(applied.getByText('Closer de ventas', { exact: true })).toBeVisible();
  await expect(interested.getByTestId('application')).toHaveCount(0);
  expect(state.applications[0].status).toBe('applied');

  // 1b) La candidatura enviada se celebra sin tapar el resto del tablero: confeti decorativo,
  // contador real y un cierre explícito. El primer hito es 1, no una promesa de resultados.
  await expect(page.getByRole('heading', { name: '¡Hito: 1 candidatura!' })).toBeVisible();
  await expect(page.locator('.confetti span')).toHaveCount(26);
  await expect(page.getByText('Enviadas en total').locator('..')).toContainText('1');
  await page.getByRole('button', { name: 'Cerrar la celebración' }).click();
  await expect(page.getByRole('heading', { name: '¡Hito: 1 candidatura!' })).toHaveCount(0);

  // 2) Nota: se guarda en su candidatura y no toca el estado.
  await page.getByText('Notas y preguntas de la empresa').click();
  await page.getByLabel('Qué te han dicho / cuándo llamar').fill('Llamar el lunes a las 10');
  await page.getByRole('button', { name: 'Guardar nota' }).click();
  await expect.poll(() => calls.some(call => call.body.notes === 'Llamar el lunes a las 10')).toBe(true);
  expect(state.applications[0].status).toBe('applied');

  // 3) Asistente: la vista manda las preguntas y muestra el motivo del 503 sin inventar respuestas.
  // El botón está apagado hasta que hay preguntas: sin texto no se gasta una llamada al proveedor.
  const ask = page.getByRole('button', { name: 'Preparar respuestas' });
  await expect(ask).toBeDisabled();
  await page.getByLabel(/Pega aquí las preguntas de la empresa/).fill('¿Por qué quieres trabajar con nosotros?');
  await ask.click();
  await expect.poll(() => assistant.length).toBe(1);
  expect(assistant[0].application_id).toBe(state.applications[0].id);
  expect(assistant[0].include_profile).toBe(false);
  await expect(page.getByTestId('answer-assistant').getByRole('alert')).toContainText('El asistente de respuestas no está configurado en este despliegue.');
  await expect(page.getByTestId('answer-list')).toHaveCount(0);
});

test('una candidatura descartada vuelve a borrador desde el tablero', async ({ page }) => {
  const { state, calls } = await mockPortal(page);
  state.applications = [base({ status: 'discarded' })];
  await page.goto('/alumna');

  await expect(page.getByTestId('stage-closed').getByText('Closer de ventas', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Volver a borrador' }).click();
  await expect.poll(() => calls.some(call => call.body.status === 'draft')).toBe(true);
  await expect(page.getByTestId('stage-interested').getByText('Closer de ventas', { exact: true })).toBeVisible();
  expect(state.applications[0].status).toBe('draft');
});
