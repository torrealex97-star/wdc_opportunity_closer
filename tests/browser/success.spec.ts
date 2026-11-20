import { test, expect } from '@playwright/test';

// La vista de alumna pide oportunidades al montar; aquí solo interesa el Salón del éxito.
const emptyCatalog = (route: import('@playwright/test').Route) => route.fulfill({ json: { items: [], total: 0 } });

test('el Salón del éxito muestra los trece casos y solo carga el vídeo que se abre', async ({ page }) => {
  await page.route('**/api/backend/opportunities/search', emptyCatalog);
  await page.goto('/');
  await page.getByRole('button', { name: 'Salón del éxito' }).click();

  await expect(page.getByRole('heading', { name: 'Ellas estaban donde tú estás.' })).toBeVisible();
  await expect(page.locator('.success-card')).toHaveCount(13);
  for (const name of ['Briana', 'Bea', 'Angy', 'Monica', 'Aranxa', 'Carla Segura', 'Yamila', 'Maitane', 'Jenifer', 'Lisette', 'Anahita', 'Noelia', 'Marta']) {
    await expect(page.locator('.success-card h2', { hasText: name })).toHaveCount(1);
  }
  // Cada caso enseña qué se aprende y su mensaje, no solo un vídeo.
  await expect(page.locator('.success-learn')).toHaveCount(13);
  await expect(page.locator('.success-message')).toHaveCount(13);
  await expect(page.locator('.success-card').first()).toContainText('confiar plenamente en el método');
  await expect(page.locator('.success-card').first()).toContainText('Romper la barrera del miedo inicial');

  // Nada de trece reproductores cargados de golpe: antes del clic no hay iframes.
  await expect(page.locator('iframe')).toHaveCount(0);
  const briana = page.locator('.success-card').first();
  await briana.getByRole('button', { name: 'Ver el vídeo de Briana' }).click();
  await expect(briana.locator('iframe')).toHaveAttribute('src', /youtube-nocookie\.com\/embed\/dpdaZecblNk/);
  await expect(page.locator('iframe')).toHaveCount(1);

  // Abrir otro cierra el anterior: se mantiene un solo vídeo cargado.
  const marta = page.locator('.success-card').last();
  await marta.getByRole('button', { name: 'Ver el vídeo de Marta' }).click();
  await expect(page.locator('iframe')).toHaveCount(1);
  await expect(marta.locator('iframe')).toHaveAttribute('src', /youtube-nocookie\.com\/embed\/WnVgKFSjm1M/);

  // Volver a otra sección no deja la página a medias.
  await page.getByRole('button', { name: 'Oportunidades' }).click();
  await expect(page.getByRole('heading', { name: 'Elige tu próxima oportunidad.' })).toBeVisible();
});
