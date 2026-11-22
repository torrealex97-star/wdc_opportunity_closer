// Flujos interactivos nuevos del panel, contra la app real y servicios simulados:
//  1. Fuentes → «Probar ruta» de InfoJobs por Bright Data (fixture del SERP, coste 0,0015 USD).
//  2. Empresas → «Revisar ahora» de Bastida Farina (fixture JSON-LD), y segunda pasada idempotente.
// No hay claves reales ni llamadas de pago: BRIGHTDATA_API_BASE apunta al mock (run.sh) y la página de
// empresa se sirve desde tests/fixtures con COMPANY_REVIEW_FIXTURE.
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { startMocks } from './mock-services.mjs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:3199';
const { state, close } = startMocks({ authPort: Number(process.env.MOCK_AUTH_PORT ?? 8791), enginePort: Number(process.env.MOCK_ENGINE_PORT ?? 8792) });
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE || undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const consoleErrors = [];
const serverErrors = [];
page.on('pageerror', error => consoleErrors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() !== 'error') return;
  const url = message.location()?.url ?? '';
  if (/favicon/.test(url)) return; // el favicon no forma parte de los dos flujos
  consoleErrors.push(`console: ${message.text()} (${url})`);
});
page.on('response', response => {
  const url = response.url();
  // Cualquier 4xx/5xx de estas APIs es un fallo del flujo, no solo los 500.
  if (/\/api\/admin\/(companies|source-routes|connections|external)/.test(url) && response.status() >= 400) serverErrors.push(`${response.status()} ${url}`);
});

const results = [];
const step = async (name, fn) => {
  try { await fn(); results.push(['PASS', name]); }
  catch (error) { results.push(['FAIL', name, String(error.message).split('\n').slice(0, 5).join(' | ')]); }
};

try {
  await step('login del propietario en el panel', async () => {
    await page.goto(BASE + '/admin');
    await page.getByLabel('Email').fill('owner@test.dev');
    await page.getByLabel('Contraseña').fill('Correcta-12345');
    await page.getByRole('button', { name: 'Entrar' }).click();
    await page.getByRole('heading', { name: 'Cómo vamos.' }).waitFor();
  });

  await step('Fuentes: sin clave, «Probar ruta» está desactivado y lo dice', async () => {
    await page.getByRole('button', { name: 'Fuentes', exact: true }).click();
    await page.getByRole('heading', { name: 'Fuentes de datos.' }).waitFor();
    const card = page.locator('article.source-route-card', { hasText: 'InfoJobs' }).first();
    await card.waitFor();
    assert.equal(await card.getByRole('button', { name: 'Probar ruta' }).isEnabled(), false, 'sin clave no debe poder probarse');
    assert.match(await card.innerText(), /Sin clave de (brightdata|serpapi|infojobs)/);
  });

  await step('Fuentes: guardar clave de prueba de Bright Data (guardar no gasta)', async () => {
    const status = await page.evaluate(async () => (await fetch('/api/admin/connections', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'brightdata', secret: 'testkey-1234:serp_zone:unlock_zone' }),
    })).status);
    assert.equal(status, 200);
    // La clave se guarda como `API key:zona SERP:zona Unlocker`: el panel enseña los últimos 4 de la CLAVE
    // (no de la última zona, que no dice nada de la clave y confundía).
    assert.equal(state.connections.get('brightdata')?.last4, '1234');
  });

  await step('APIs: «Probar» Bright Data hace una búsqueda, la anota y descuenta del tope', async () => {
    const result = await page.evaluate(async () => (await fetch('/api/admin/connections', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'brightdata' }),
    })).json());
    assert.equal(result.ok, true);
    assert.match(result.detail, /0,0015 USD/);
    assert.equal(state.connections.get('brightdata')?.last_test_ok, true);
    const run = state.ingestRuns.find(row => row.source === 'brightdata-probe');
    assert.ok(run, 'la prueba de clave debe anotarse como ejecución');
    assert.match(run.note ?? '', /proveedor=brightdata/);
    assert.match(run.note ?? '', /coste_usd=0\.001500/);
    const summary = await page.evaluate(async () => (await fetch('/api/admin/source-routes?summary=1')).json());
    assert.ok(Math.abs(summary.spent.brightdata - 0.0015) < 1e-9);
    assert.ok(summary.budget.brightdata > 4.99 && summary.budget.brightdata < 5);
    assert.equal(summary.unlocker_ready, true, 'la clave de prueba incluye la zona Unlocker');
  });

  await step('Resumen: la tarjeta de objetivo del día y gasto del mes sale con cifras o con «—» y su causa, nunca con 0 inventado', async () => {
    state.waterfallRow = null;
    await page.reload();
    await page.getByRole('button', { name: 'Resumen', exact: true }).click();
    const card = page.getByTestId('summary-money');
    await card.waitFor({ timeout: 15000 });
    await card.getByText(/Leyendo el objetivo y el gasto/).waitFor({ state: 'detached', timeout: 15000 });
    const text = await card.innerText();
    assert.match(text, /META DEL DÍA \(24 H\)/);
    assert.match(text, /Gasto del mes: (—|\$|US\$|\d)/, 'el gasto es una cifra en dólares o una raya: ' + JSON.stringify(text));
    await card.getByRole('button', { name: 'Ver APIs y topes' }).click();
    await page.getByTestId('waterfall').waitFor({ timeout: 15000 });
  });
  await step('APIs: el Objetivo diario muestra lo cualificado de hoy y el plan por etapas, y el propietario cambia el objetivo', async () => {
    state.waterfallRow = null;
    try {
      await page.reload();
      await page.getByRole('button', { name: 'APIs', exact: true }).click();
      const panel = page.getByTestId('waterfall');
      await panel.getByRole('heading', { name: 'Objetivo diario y waterfall' }).waitFor();
      await panel.getByTestId('wf-stages').locator('tbody tr').first().waitFor();
      assert.equal(await panel.getByTestId('wf-stages').locator('tbody tr').count(), 4, 'Google Jobs, respaldo, Apify y manual');
      assert.match(await panel.getByTestId('wf-origin').innerText(), /valor por defecto/, 'sin nada guardado se dice que es el defecto');
      assert.match(await panel.getByTestId('wf-stages').locator('tr[data-stage="unlocker"]').innerText(), /Manual/);
      await panel.getByLabel('Objetivo de ofertas cualificadas al día').fill('0');
      await panel.getByRole('button', { name: 'Guardar objetivo' }).click();
      await panel.getByText(/Objetivo guardado: 0 ofertas cualificadas al día/).waitFor({ timeout: 15000 });
      assert.equal(state.waterfallRow?.qualified_per_day, 0);
      await panel.getByTestId('wf-origin').getByText(/guardado por el propietario/).waitFor({ timeout: 15000 });
      assert.match(await panel.getByTestId('wf-gap').innerText(), /^0$/, 'con objetivo 0 no falta nada');
      assert.match(await panel.getByTestId('wf-stages').innerText(), /Objetivo del día cumplido/, 'las etapas de pago dicen por qué no se lanzan');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'sin scroll horizontal de página');
    } finally { state.waterfallRow = null; }
  });

  await step('APIs: el Control de inversión enseña el gasto de TODOS los proveedores y el propietario cambia un tope', async () => {
    try {
    await page.reload();
    await page.getByRole('button', { name: 'APIs', exact: true }).click();
    const control = page.getByTestId('spend-control');
    await control.getByRole('heading', { name: 'Control de inversión' }).waitFor();
    await control.locator('tbody tr').first().waitFor();
    assert.equal(await control.locator('tbody tr').count(), 6, 'Apify, Bright Data, JSearch, SerpApi, ZenRows y ScrapingBee en el mismo cuadro');
    const bright = control.locator('tr[data-provider="brightdata"]');
    assert.match(await bright.innerText(), /0,0015/, 'el gasto de la prueba de clave ya consta');
    assert.equal((await bright.locator('td.num').innerText()).trim(), '1', 'cuenta las peticiones');
    await bright.getByLabel('Tope mensual de Bright Data en USD').fill('2');
    await bright.getByRole('button', { name: 'Guardar tope de Bright Data' }).click();
    await control.getByText(/Tope mensual guardado: 2 USD/).waitFor({ timeout: 15000 });
    assert.equal(state.providerBudget.find(row => row.provider === 'brightdata')?.monthly_usd, 2);
    // El panel recarga tras guardar: se espera al texto nuevo en vez de leer la fila antes de que cambie.
    await control.locator('tr[data-provider="brightdata"]').getByText(/guardado por el propietario/).waitFor({ timeout: 15000 });
    const overflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth, wide: [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > window.innerWidth + 1).slice(0, 4).map(el => `${el.tagName}.${String(el.className).slice(0, 40)}`) }));
    assert.ok(overflow.scroll <= overflow.inner, `sin scroll horizontal de página: ${JSON.stringify(overflow)}`);
    } finally {
      // Los pasos siguientes miden el gasto contra el tope por defecto (5 USD): el tope guardado aquí se deshace SIEMPRE.
      state.providerBudget = state.providerBudget.filter(row => row.provider !== 'brightdata');
    }
  });

  await step('Apify: un portal con un solo buscador avisa, propone repuestos validados y el propietario añade, retira y reactiva uno', async () => {
    state.storeActors = { 'store-a~infojobs-pro': { users: 500, title: 'InfoJobs Pro' }, 'store-b~infojobs-old': { deprecated: true, title: 'InfoJobs Old' }, 'store-d~infojobs-nofield': { hideDeprecated: true, title: 'InfoJobs Sin Campo' } };
    await page.reload();
    await page.getByRole('button', { name: 'Búsqueda automática', exact: true }).click();
    const card = page.getByTestId('portal-infojobs'); await card.waitFor();
    const ensureOpen = async () => { if (!(await card.locator('details').evaluate(el => el.open))) await card.locator('summary').click(); };
    await ensureOpen();
    await card.getByTestId('needs-more-infojobs').waitFor();
    assert.match(await card.getByTestId('needs-more-infojobs').innerText(), /Solo hay un buscador/);
    await card.getByRole('button', { name: 'Buscar repuestos en la tienda' }).click();
    const list = card.getByTestId('replacements-infojobs'); await list.waitFor({ timeout: 15000 });
    const text = await list.innerText();
    assert.match(text, /InfoJobs Pro[\s\S]*Validado/);
    assert.match(text, /InfoJobs Old[\s\S]*No utilizable/);
    assert.match(text, /InfoJobs Sin Campo[\s\S]*Sin verificar/);
    assert.equal(await list.getByRole('button', { name: /^Añadir / }).count(), 1, 'solo el validado se puede añadir');
    await list.getByRole('button', { name: 'Añadir InfoJobs Pro a InfoJobs' }).click();
    await page.getByText(/InfoJobs Pro añadido como buscador de repuesto de InfoJobs/).waitFor({ timeout: 15000 });
    assert.ok(state.apifyActors.some(a => a.actor === 'store-a/infojobs-pro' && a.source === 'apify-infojobs'));
    await ensureOpen();
    page.once('dialog', dialog => dialog.accept());
    await card.getByRole('button', { name: 'Retirar InfoJobs Pro de la cascada' }).click();
    await page.getByText('Buscador retirado de la cascada.').waitFor({ timeout: 15000 });
    assert.equal(state.apifyActors.find(a => a.actor === 'store-a/infojobs-pro').status, 'inactive');
    await ensureOpen();
    await card.getByRole('button', { name: 'Reactivar InfoJobs Pro' }).click();
    await page.getByText('Buscador reactivado.').waitFor({ timeout: 15000 });
    assert.notEqual(state.apifyActors.find(a => a.actor === 'store-a/infojobs-pro').status, 'inactive');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'sin scroll horizontal de página');
    state.apifyActors = state.apifyActors.filter(a => a.actor !== 'store-a/infojobs-pro');
  });

  await step('Fuentes: «Probar ruta» ejecuta Bright Data, muestra ofertas y coste, y actualiza el gasto', async () => {
    await page.reload();
    await page.getByRole('button', { name: 'Fuentes', exact: true }).click();
    await page.getByRole('heading', { name: 'Fuentes de datos.' }).waitFor();
    const card = page.locator('article.source-route-card', { hasText: 'InfoJobs' }).first();
    await card.waitFor();
    const button = card.getByRole('button', { name: 'Probar ruta' });
    // El resumen de claves y topes llega después de la tarjeta: se espera a que la vía lista habilite el botón.
    await page.waitForFunction(element => !element.disabled, await button.elementHandle(), { timeout: 15000 }).catch(() => undefined);
    assert.equal(await button.isEnabled(), true, 'con clave y tope, la ruta debe estar lista');
    const responsePromise = page.waitForResponse(response => response.url().includes('/api/admin/source-routes') && response.request().method() === 'POST');
    await button.click();
    const response = await responsePromise;
    if (response.status() !== 200) console.log('DEBUG Probar ruta', response.status(), await response.text());
    await card.getByText(/Bright Data devolvió 2 resultados/).waitFor({ timeout: 20000 });
    const text = await card.innerText();
    assert.match(text, /2 guardada\(s\)/);
    assert.match(text, /Coste: 0,0015 USD/);
    const kpi = page.locator('article.dash-kpi', { hasText: 'GASTO DEL MES' });
    assert.match(await kpi.innerText(), /0,003 USD/, 'el KPI debe sumar la prueba de clave y la ruta, no quedarse en 0');
    const summary = await page.evaluate(async () => (await fetch('/api/admin/source-routes?summary=1')).json());
    assert.ok(Math.abs(summary.spent.brightdata - 0.003) < 1e-9);
    assert.ok(summary.budget.brightdata > 4.99 && summary.budget.brightdata < 5);
    const external = await page.evaluate(async () => (await fetch('/api/admin/external?source=brightdata-infojobs&page_size=10')).json());
    assert.equal(external.total, 2, 'las dos ofertas del fixture deben estar guardadas');
    const runs = await page.evaluate(async () => (await fetch('/api/admin/external?source=brightdata-infojobs&page_size=10')).json());
    assert.match(runs.runs[0].note ?? '', /proveedor=brightdata/);
    assert.match(runs.runs[0].note ?? '', /coste_usd=0\.001500/);
  });

  await step('Fuentes: Unlocker de Bright Data extrae, atribuye a brightdata-company y descuenta el tope', async () => {
    const result = await page.evaluate(async () => {
      const response = await fetch('/api/admin/source-routes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test', source: 'company', route: 'company:unlocker', url: 'https://acme.test/careers' }),
      });
      return { status: response.status, body: await response.json() };
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.accepted, 1);
    assert.equal(result.body.cost_usd, 0.0015);
    const offers = await page.evaluate(async () => (await fetch('/api/admin/external?source=brightdata-company&page_size=10')).json());
    assert.equal(offers.total, 1, 'el HTML del Unlocker se guarda con atribución al portal');
    assert.match(offers.offers[0].title, /Closer Unlocker/);
    const summary = await page.evaluate(async () => (await fetch('/api/admin/source-routes?summary=1')).json());
    assert.ok(Math.abs(summary.spent.brightdata - 0.0045) < 1e-9, 'la prueba de clave, la ruta SERP y el Unlocker suman 0,0045 USD');
    assert.ok(summary.budget.brightdata > 4.99 && summary.budget.brightdata < 5);
  });

  await step('Fuentes: «Probar ruta» del Unlocker pide una URL y la usa en la petición', async () => {
    // El orden por coste pone Google Jobs antes que el Unlocker; para ejercitar el botón del Unlocker
    // se sube esa vía en la propia fuente y se restaura al terminar.
    const setOrder = await page.evaluate(async () => (await fetch('/api/admin/source-routes', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'company', order: ['company:unlocker', 'company:brightdata'] }),
    })).status);
    assert.equal(setOrder, 200);
    try {
      await page.reload();
      await page.getByRole('button', { name: 'Fuentes', exact: true }).click();
      await page.getByRole('heading', { name: 'Fuentes de datos.' }).waitFor();
      const group = page.getByRole('button', { name: /Google Jobs/ });
      await group.waitFor();
      if (await group.getAttribute('aria-expanded') !== 'true') await group.click();
      const card = page.locator('article.source-route-card', { hasText: 'Empresas · páginas de empleo / ATS' }).first();
      await card.waitFor();
      const button = card.getByRole('button', { name: 'Probar ruta' });
      assert.equal(await button.isEnabled(), true, 'con zona Unlocker la ruta debe estar lista');
      let prompted = false;
      page.once('dialog', async dialog => {
        prompted = dialog.type() === 'prompt';
        await dialog.accept('https://acme.test/careers');
      });
      const responsePromise = page.waitForResponse(response => response.url().includes('/api/admin/source-routes') && response.request().method() === 'POST');
      await button.click();
      const response = await responsePromise;
      assert.equal(response.status(), 200);
      const body = await response.json();
      assert.equal(prompted, true, 'el botón debe abrir un prompt, no usar la web del catálogo');
      assert.equal(body.received, 1);
      assert.equal(body.cost_usd, 0.0015);
      await card.getByText(/1 detectada\(s\) en el HTML/).waitFor({ timeout: 20000 });
      const summary = await page.evaluate(async () => (await fetch('/api/admin/source-routes?summary=1')).json());
      assert.ok(Math.abs(summary.spent.brightdata - 0.006) < 1e-9, 'la prueba del botón también descuenta el tope');
      const invalid = await page.request.post(BASE + '/api/admin/source-routes', {
        data: { action: 'test', source: 'company', route: 'company:unlocker', url: 'http://acme.test/careers' },
      });
      assert.equal(invalid.status(), 422, 'una URL no HTTPS se rechaza antes de llamar al proveedor');
      assert.match((await invalid.json()).detail, /HTTPS/);
    } finally {
      await page.evaluate(async () => fetch('/api/admin/source-routes', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'company', order: [] }),
      }));
    }
  });

  await step('Fuentes: el orden por fuente se guarda, se ve y se restaura al de coste', async () => {
    const custom = ['infojobs:serpapi', 'infojobs:official'];
    const patched = await page.evaluate(async order => {
      const response = await fetch('/api/admin/source-routes', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'infojobs', order }),
      });
      return { status: response.status, body: await response.json() };
    }, custom);
    assert.equal(patched.status, 200);
    assert.deepEqual(patched.body.order, custom);
    const summary = await page.evaluate(async () => (await fetch('/api/admin/source-routes?summary=1')).json());
    assert.deepEqual(summary.orders.infojobs, custom);
    await page.reload();
    await page.getByRole('button', { name: 'Fuentes', exact: true }).click();
    await page.getByRole('heading', { name: 'Fuentes de datos.' }).waitFor();
    const card = page.locator('article.source-route-card', { hasText: 'InfoJobs' }).first();
    await card.waitFor();
    const routeList = await card.locator('ol.route-list').first().innerText();
    assert.ok(routeList.indexOf('SerpApi') >= 0 && routeList.indexOf('SerpApi') < routeList.indexOf('API oficial'), 'el panel enseña el orden guardado');
    const reset = await page.evaluate(async () => {
      const response = await fetch('/api/admin/source-routes', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'infojobs', order: [] }),
      });
      return response.status;
    });
    assert.equal(reset, 200);
    const after = await page.evaluate(async () => (await fetch('/api/admin/source-routes?summary=1')).json());
    assert.deepEqual(after.orders.infojobs, [], 'volver al orden por coste borra el override');
  });

  await step('Fuentes: «Cómo conectarla» abre la guía paso a paso', async () => {
    const card = page.locator('article.source-route-card', { hasText: 'InfoJobs' }).first();
    await card.getByRole('button', { name: 'Cómo conectarla' }).click();
    const dialog = page.locator('dialog.setup-guide');
    await dialog.waitFor();
    try {
      const text = await dialog.innerText();
      assert.match(text, /INFOJOBS · CÓMO CONECTARLA/);
      assert.match(text, /Qué falta/);
      assert.match(text, /Entra en developers\.infojobs\.net/);
      assert.ok(await dialog.locator('ol.setup-guide-steps li').count() >= 3);
      assert.match(text, /Los tres fallos que verás/);
    } finally {
      // Si una aserción falla, el diálogo no puede quedarse abierto y bloquear los pasos siguientes.
      if (await dialog.isVisible()) await dialog.getByRole('button', { name: 'Cerrar la guía' }).click();
    }
    await dialog.waitFor({ state: 'hidden' });
  });

  await step('Empresas: «Revisar ahora» extrae el JobPosting y enseña el resultado', async () => {
    await page.getByRole('button', { name: 'Empresas', exact: true }).click();
    await page.getByRole('heading', { name: 'Empresas, una a una.' }).waitFor();
    const row = page.locator('tr', { hasText: 'Bastida Farina' }).first();
    await row.waitFor();
    await row.getByRole('button', { name: 'Revisar ahora' }).click();
    await row.getByText(/1 guardada\(s\)/).waitFor({ timeout: 15000 });
    await page.waitForFunction(() => {
      const cell = document.querySelector('[data-testid="company-review-bastida-farina"]');
      return Boolean(cell && cell.textContent && cell.textContent.trim() !== '—');
    }, null, { timeout: 15000 });
    const review = await row.locator('[data-testid="company-review-bastida-farina"]').innerText();
    assert.notEqual(review.trim(), '—', 'la última revisión debe salir de la ejecución ya guardada');
    const text = await row.innerText();
    assert.match(text, /1 en la página/);
    assert.match(text, /1 nueva\(s\)/);
    assert.match(text, /fixture local/);
    const offers = await page.evaluate(async () => (await fetch('/api/admin/external?source=company&page_size=10')).json());
    assert.equal(offers.total, 1);
    assert.match(offers.offers[0].title, /Closer de ventas \(Bastida\)/);
    assert.equal(offers.offers[0].editorial_status, 'draft');
  });

  await step('Empresas: segunda revisión es idempotente (0 nuevas, no duplica)', async () => {
    const row = page.locator('tr', { hasText: 'Bastida Farina' }).first();
    await row.getByRole('button', { name: 'Revisar ahora' }).click();
    await row.getByText(/0 guardada\(s\)/).waitFor({ timeout: 15000 });
    assert.match(await row.innerText(), /0 nueva\(s\)/);
    const offers = await page.evaluate(async () => (await fetch('/api/admin/external?source=company&page_size=10')).json());
    assert.equal(offers.total, 1, 'la huella impide duplicar la misma oferta');
  });

  await step('sin errores de consola ni respuestas 4xx/5xx en los dos flujos', async () => {
    assert.deepEqual(consoleErrors, []);
    assert.deepEqual(serverErrors, []);
  });
} finally {
  await browser.close();
  close();
  for (const [status, name, message] of results) console.log(`${status}  ${name}${message ? '\n      ' + message : ''}`);
  const failed = results.filter(result => result[0] === 'FAIL').length;
  console.log(`\n${results.length - failed}/${results.length} flujos interactivos OK`);
  process.exit(failed ? 1 : 0);
}
