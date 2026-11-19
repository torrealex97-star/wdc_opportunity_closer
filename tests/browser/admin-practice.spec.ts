import { test, expect } from '@playwright/test';

// Criterios de práctica en el panel. Como admin-students.spec.ts, /admin solo monta AdminShell en modo
// hospedado (CAREER_ENGINE_URL); sin ese servidor la prueba se omite en vez de mentir:
//   CAREER_ENGINE_URL=https://<engine> WDC_CLOUD_ADMIN=1 npm run dev -w apps/web
test.skip(process.env.WDC_CLOUD_ADMIN !== '1', 'requiere /admin en modo hospedado (CAREER_ENGINE_URL)');

const rooms = [
  { id: 'venta', label: 'Closer · llamada de cierre', note: 'Rúbrica completa.' },
  { id: 'setter', label: 'Setter · cualificación y agenda', note: 'Peso en BANT.' },
  { id: 'frio', label: 'Llamada en frío', note: 'Peso en apertura.' },
  { id: 'entrevista', label: 'Entrevista · criterios generales', note: 'Criterios de contratación.' },
  { id: 'wdc-entrevista', label: 'Entrevista · rúbrica WDC', note: 'Seis criterios.' },
];
const axis = (id: string, label: string, weight: number) => ({ id, label, guide: 'Qué debe demostrar.', weight });
const rubrics = {
  venta: [axis('apertura', 'Apertura y agenda', 10), axis('descubrimiento', 'Clarify, label y pain cycle', 25), axis('objecion', 'Objeciones y cierre', 30), axis('etica', 'Rapport y ética', 35)],
  setter: [axis('apertura', 'Primer mensaje', 15), axis('cualificacion', 'BANT y cualificación', 30), axis('agenda', 'Edificación y agenda', 25), axis('traspaso', 'Traspaso al closer', 30)],
  frio: [axis('apertura', 'Apertura y gancho', 35), axis('siguiente', 'Paso a cita con dos opciones', 30), axis('etica', 'Rapport y ética', 35)],
  entrevista: [axis('evidencia', 'Evidencia y cifras', 40), axis('criterio', 'Criterio comercial', 40), axis('claridad', 'Claridad', 20)],
  'wdc-entrevista': [axis('confianza', 'Confianza y autoridad', 40), axis('claridad', 'Claridad y estructura', 30), axis('evidencia', 'Evidencia y cifras', 30)],
};
const config = { rubrics, priorities: ['No hubo pain cycle.', 'No pidió la venta.'], bant: { venta: true, setter: true, frio: true, entrevista: false, 'wdc-entrevista': false } };

test('el panel edita los pesos, ve el cambio sin guardar y lo manda entero al servidor', async ({ page }) => {
  const saved: Record<string, unknown>[] = [];
  await page.route('**/api/admin/session', route => route.fulfill({ json: { configured: true, authenticated: true, email: 'owner@wdc.test', role: 'owner' } }));
  await page.route('**/api/admin/practice?fresh=1', route => route.fulfill({ json: { config, defaults: config, rooms, source: 'db', reason: null, updated_at: new Date().toISOString(), updated_by: 'owner@wdc.test' } }));
  await page.route('**/api/admin/practice', route => {
    if (route.request().method() !== 'PUT') return route.fulfill({ json: { config, defaults: config, rooms, source: 'db', reason: null, updated_at: null, updated_by: null } });
    saved.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.fulfill({ json: { config, source: 'db', reason: null, updated_at: new Date().toISOString(), updated_by: 'owner@wdc.test' } });
  });

  await page.goto('/admin#practice');
  await expect(page.getByRole('heading', { name: 'Los criterios de las salas.' })).toBeVisible();
  // La sala de closer abre con sus pesos reales y la suma declarada.
  const weight = page.getByLabel('Peso de Apertura y agenda');
  await expect(weight).toHaveValue('10');
  await expect(page.getByText(/Los pesos suman 100/)).toBeVisible();
  await weight.fill('15');
  await expect(page.getByText(/Los pesos suman 105/)).toBeVisible();
  await expect(page.getByText('Cambios sin guardar')).toBeVisible();
  // BANT: la entrevista no se audita; la sala de venta sí.
  await expect(page.getByLabel('Entrevista · criterios generales')).not.toBeChecked();
  await expect(page.getByLabel('Closer · llamada de cierre')).toBeChecked();
  await page.getByRole('button', { name: 'Guardar criterios' }).click();
  await expect(page.getByText('Criterios guardados.')).toBeVisible();
  await expect.poll(() => saved.length).toBe(1);
  const venta = (saved[0].rubrics as typeof rubrics).venta;
  expect(venta[0]).toMatchObject({ id: 'apertura', weight: 15 });
  expect((saved[0].priorities as string[])[0]).toBe('No hubo pain cycle.');
  expect((saved[0].bant as Record<string, boolean>).entrevista).toBe(false);
});
