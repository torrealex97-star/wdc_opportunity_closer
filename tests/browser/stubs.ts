import { test as base, expect } from '@playwright/test';

// La suite comparte un servidor de desarrollo. Una prueba no debe escribir en él: lo que persiste
// (configuración del panel, sesión de operador, actividad de la alumna, candidaturas) se declara con
// `page.route` en la propia prueba, y así cada worker tiene su estado y ninguna corrida deja datos en
// la base. Las lecturas pasan tal cual al servidor; una escritura que nadie simuló se corta y hace
// fallar la prueba, para que el hueco se arregle en vez de ensuciar el estado compartido.
// Las pruebas que necesitan escribir de verdad arrancan su propio servidor (admin-practice.spec.ts) y
// usan `test` de `@playwright/test`, no esta base.
export const test = base.extend<{ unstubbedWrites: string[] }>({
  unstubbedWrites: [async ({ page }, use) => {
    const blocked: string[] = [];
    // Registrado antes que las rutas de la prueba: en Playwright la última ruta registrada gana, así que
    // cualquier `page.route` de la prueba se resuelve primero y esto solo cubre lo que nadie simuló.
    await page.route('**/api/**', (route, request) => {
      const method = request.method();
      if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return route.fallback();
      blocked.push(`${method} ${new URL(request.url()).pathname}`);
      return route.fulfill({ status: 501, json: { detail: 'Escritura no simulada en la prueba.' } });
    });
    await use(blocked);
    expect(blocked, 'escrituras sin simular contra el servidor compartido (usa page.route en la prueba)').toEqual([]);
  }, { auto: true }],
});

export { expect };
