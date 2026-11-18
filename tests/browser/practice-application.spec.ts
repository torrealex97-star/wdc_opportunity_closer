import { test, expect } from '@playwright/test';

// La sala puede practicar una candidatura concreta. El navegador solo manda el id: el anuncio y
// el formulario los resuelve el servidor (ver lib/practiceContext), y el panel lo dice.
test('la sala practica la entrevista de una candidatura con su anuncio', async ({ page }) => {
  const posts: Array<Record<string, unknown>> = [];
  const application = {
    id: '11111111-1111-4111-8111-111111111111', offer_ref: 'ext-22222222-2222-4222-8222-222222222222',
    offer_title: 'Closer de ventas', offer_company: 'Acme', offer_url: 'https://jobs.example.com/1',
    status: 'applied', cover_message: null, notes: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), applied_at: new Date().toISOString(),
  };
  await page.route('**/api/student/applications', route => route.fulfill({ json: { applications: [application], truncated: false, copy: [], assisted_only: true } }));
  await page.route('**/api/student/application-profile', route => route.fulfill({
    json: {
      profile: { autofill_consent_at: '2026-11-01T00:00:00Z' },
      completeness: { pct: 90, missing: [] }, base_consent: true,
      options: { work_authorization: {}, levels: {}, contracts: {}, answers: {} },
    },
  }));
  await page.route('**/api/practice', route => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    posts.push(body);
    if (body.mode === 'debrief') {
      return route.fulfill({
        json: {
          debrief: {
            summary: 'Buena apertura y buen cierre.', focus: 'Faltaron cifras concretas.', strengths: ['Claridad'], improvements: ['Trae un caso con números'],
            score: 72, model: 'Podrías haber dicho: cerraba 30.000 € al mes.', next: 'Repite esta entrevista con dos cifras propias.',
            axes: [
              { id: 'confianza', label: 'Confianza y autoridad', score: 76, note: '', quote: '' },
              { id: 'claridad', label: 'Claridad y estructura', score: 74, note: '', quote: '' },
              { id: 'evidencia', label: 'Evidencia y cifras', score: 60, note: '', quote: '' },
              { id: 'objecion', label: 'Manejo de objeciones', score: 70, note: '', quote: '' },
              { id: 'encaje', label: 'Encaje', score: 72, note: '', quote: '' },
              { id: 'iniciativa', label: 'Cierre e iniciativa', score: 78, note: '', quote: '' },
            ],
          },
        },
      });
    }
    return route.fulfill({ json: { reply: '¿Y qué resultados medías?' } });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'AI roleplay · entrevista' }).click();
  const panel = page.getByRole('region', { name: 'Practica una candidatura tuya' });
  await expect(panel).toBeVisible();
  const profileTick = panel.getByRole('checkbox', { name: /Usar mi formulario base/ });
  await expect(profileTick).not.toBeChecked();
  await panel.getByLabel('Candidatura').selectOption(application.id);
  await profileTick.check();
  await panel.getByRole('button', { name: 'Entrevista de esta oferta' }).click();
  // La sala se titula con la oferta concreta, no con el caso genérico.
  await expect(page.getByRole('heading', { name: 'Closer de ventas', level: 1 })).toBeVisible();
  await expect(page.getByText('Acme · Conversación basada en el anuncio público que estás trabajando.')).toBeVisible();
  const reply = page.getByLabel('Tu respuesta');
  await reply.fill('Vendo con datos y cierro high ticket.');
  await page.getByRole('button', { name: 'Enviar respuesta' }).click();
  await expect(page.getByText('¿Y qué resultados medías?')).toBeVisible();
  await reply.fill('Cerraba 30.000 € al mes.');
  await page.getByRole('button', { name: 'Enviar respuesta' }).click();
  await expect(page.getByRole('button', { name: 'Terminar y ver feedback' })).toBeEnabled();
  await page.getByRole('button', { name: 'Terminar y ver feedback' }).click();
  await expect(page.getByRole('heading', { name: 'Qué ha funcionado y qué pulir.' })).toBeVisible();
  await expect(page.getByText('Práctica de tu candidatura: Closer de ventas · Acme.')).toBeVisible();
  // Lo único que cruza el navegador es el id y el permiso; el anuncio y el formulario los pone el servidor.
  const conversation = posts.find(post => post.mode === 'reply');
  expect(conversation?.application_id).toBe(application.id);
  expect(conversation?.include_profile).toBe(true);
  expect(JSON.stringify(conversation)).not.toContain('ana@');
  expect(posts.find(post => post.mode === 'debrief')?.application_id).toBe(application.id);
});
