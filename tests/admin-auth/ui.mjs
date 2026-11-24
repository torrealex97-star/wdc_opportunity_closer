// Pruebas de interfaz del panel en navegador real contra la app en BASE con Supabase y motor simulados.
// Uso: PLAYWRIGHT_EXECUTABLE=<chrome> node tests/admin-auth/ui.mjs (lo lanza run.sh).
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { startMocks } from './mock-services.mjs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:3100';
const catalog = JSON.parse(readFileSync(new URL('../../apps/web/lib/sourceCatalog.json', import.meta.url), 'utf8'));
const { state, close } = startMocks({ authPort: Number(process.env.MOCK_AUTH_PORT ?? 8791), enginePort: Number(process.env.MOCK_ENGINE_PORT ?? 8792) });
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_EXECUTABLE || undefined });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('dialog', d => d.accept());
const results = [];
// Navegación por sección: el panel tiene cuatro módulos con pestañas y cada sección conserva su enlace (#quick, #sources…).
const openTab = (page, id) => page.evaluate(h => { if (location.hash !== `#${h}`) location.hash = h; else window.dispatchEvent(new HashChangeEvent('hashchange')); }, id);
const step = async (name, fn) => { try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, String(e.message).split('\n').slice(0, 4).join(' | ')]); } };

await step('login y Resumen: contador del objetivo, pendientes y siguiente paso', async () => {
  await page.goto(BASE + '/admin'); await page.getByLabel('Email').fill('owner@test.dev'); await page.getByLabel('Contraseña').fill('Correcta-12345');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.getByRole('heading', { name: 'Cómo vamos.' }).waitFor();
  await page.getByText('Faltan 13').waitFor();
  assert.equal(await page.getByRole('progressbar').getAttribute('aria-valuenow'), '7');
  // Dos colas separadas: la máquina clasifica los borradores y a la persona le quedan las excepciones.
  const exceptionsCard = page.locator('article.source-card', { hasText: 'EXCEPCIONES PARA TI' });
  await exceptionsCard.waitFor();
  assert.equal(await exceptionsCard.locator('strong').innerText(), '0', 'en el mock no hay excepciones humanas');
  const draftsCard = page.locator('article.source-card', { hasText: 'POR CLASIFICAR' });
  assert.equal(await draftsCard.locator('strong').innerText(), '3', 'los tres borradores del motor son trabajo automático');
  // Las dos colas se declaran por separado: el total esconde cuál tiene trabajo si no se desglosa.
  assert.match(await exceptionsCard.innerText(), /0 del motor · 0 de fuentes externas/);
  assert.match(await draftsCard.innerText(), /3 del motor · 0 de fuentes externas/);
  assert.ok(await page.getByText(/1 fuente\(s\) fallan/).isVisible());
  assert.equal(await page.getByText(/sin revisar/).count(), 0, 'el resumen ya no pide revisar borradores a mano');
});
await step('Centro de mando: embudo, mercados, reparto y gasto con su propio estado, y «Resolver excepciones ahora» lleva a la bandeja', async () => {
  await openTab(page, 'summary'); await page.getByTestId('command-center').waitFor();
  const funnel = page.getByTestId('cc-funnel'); await funnel.waitFor();
  assert.equal(await funnel.locator('li').count(), 5, 'cinco pasos del embudo');
  assert.match(await funnel.innerText(), /recogidas nuevas[\s\S]*retiradas por reglas[\s\S]*aprobadas[\s\S]*a criterio humano[\s\S]*visibles ahora/);
  await page.getByTestId('cc-markets').waitFor(); await page.getByTestId('cc-split').waitFor(); await page.getByTestId('cc-spend').waitFor();
  assert.match(await page.getByTestId('cc-markets').innerText(), /No hay una meta por mercado fijada/, 'no se inventa una meta');
  assert.match(await page.getByTestId('cc-spend').innerText(), /Gasto del mes: /);
  // Filtros de fecha, categoría y mercado: cada cambio pide el embudo con sus parámetros y el título dice la ventana.
  const filters = page.getByTestId('cc-filters');
  assert.equal(await filters.getByRole('button', { name: '7 días' }).getAttribute('aria-pressed'), 'true', 'abre en 7 días');
  const asked = []; page.on('request', r => { if (r.url().includes('/api/admin/funnel')) asked.push(new URL(r.url()).searchParams); });
  await filters.getByRole('button', { name: '30 días' }).click(); await page.waitForFunction(() => /ÚLTIMOS 30 DÍAS/.test(document.querySelector('[data-testid="cc-range"]')?.textContent ?? ''));
  await page.getByTestId('cc-trend').waitFor(); assert.ok(await page.getByTestId('cc-trend').getByRole('img').getAttribute('aria-label').then(t => /por día/.test(t)), 'gráfico por día con su resumen accesible');
  await page.getByTestId('cc-trend').getByText('Ver tabla').click(); assert.equal(await page.getByTestId('cc-trend-table').locator('tbody tr').count(), 30);
  await filters.getByRole('button', { name: 'Año' }).click(); await page.waitForFunction(() => /EL ÚLTIMO AÑO/.test(document.querySelector('[data-testid="cc-range"]')?.textContent ?? ''));
  await page.waitForFunction(() => /por semana/.test(document.querySelector('[data-testid="cc-trend"] svg')?.getAttribute('aria-label') ?? ''), null, { timeout: 10000 }); // en un año, por semana
  await filters.getByLabel('Categoría').selectOption('setter'); await filters.getByLabel('Mercado').selectOption('ES');
  await page.waitForFunction(() => true); await page.waitForTimeout(500);
  const last = asked.at(-1); assert.equal(last.get('days'), '365'); assert.equal(last.get('role'), 'setter'); assert.equal(last.get('market'), 'ES');
  await filters.getByRole('button', { name: 'Hoy' }).click(); await page.waitForFunction(() => /LAS ÚLTIMAS 24 HORAS/.test(document.querySelector('[data-testid="cc-range"]')?.textContent ?? ''));
  await page.getByTestId('cc-trend').waitFor({ state: 'detached', timeout: 10000 }); // hoy no tiene tendencia: es un solo tramo
  await filters.getByLabel('Categoría').selectOption(''); await filters.getByLabel('Mercado').selectOption(''); await filters.getByRole('button', { name: '7 días' }).click();
  // Un fallo del embudo se dice y se puede reintentar sin tumbar el resto del Centro de mando.
  await page.route('**/api/admin/funnel*', r => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'No se pudo leer el embudo ahora.' }) }));
  await page.reload(); await openTab(page, 'summary');
  await page.getByTestId('command-center').getByRole('alert').first().waitFor(); assert.match(await page.getByTestId('command-center').innerText(), /No se pudo leer el embudo ahora/);
  await page.getByTestId('cc-spend').waitFor();
  await page.unroute('**/api/admin/funnel*'); await page.reload(); await openTab(page, 'summary');
  await page.getByRole('button', { name: /Resolver excepciones ahora/ }).click(); await page.getByRole('heading', { name: 'Resuelve solo las dudas.' }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'sin desbordamiento horizontal');
  await openTab(page, 'summary');
});
await step('Menú en cuatro módulos: un botón por módulo, sus pantallas como pestañas, y «Equipo» aparte', async () => {
  const nav = page.getByRole('navigation', { name: 'Secciones del panel' });
  for (const module of ['Centro de mando', 'Bandeja de revisión', 'Motor de fuentes', 'Reglas e infraestructura', 'Voz']) await nav.getByRole('button', { name: module, exact: true }).waitFor();
  assert.equal(await nav.getByRole('button').count(), 5 + 3, 'cinco módulos (Voz aparte) y las tres secciones de Equipo, no trece destinos sueltos');
  // Un módulo abre su primera pantalla y enseña las demás como pestañas.
  await nav.getByRole('button', { name: 'Bandeja de revisión', exact: true }).click();
  const tabs = page.getByRole('tablist', { name: 'Pantallas de Bandeja de revisión' });
  assert.deepEqual((await tabs.getByRole('tab').allInnerTexts()).map(t => t.trim()), ['Bandeja', 'Revisión rápida', 'Revisión una a una', 'Probar ofertas']);
  await tabs.getByRole('tab', { name: 'Revisión una a una' }).click(); await page.getByRole('heading', { name: 'Revisar a fondo lo que lo merece.' }).waitFor();
  assert.equal(await nav.getByRole('button', { name: 'Bandeja de revisión', exact: true }).getAttribute('aria-current'), 'page', 'el módulo queda marcado mientras estás en una de sus pantallas');
  // Volver al módulo devuelve a la última pantalla que usaste dentro de él.
  await nav.getByRole('button', { name: 'Motor de fuentes', exact: true }).click(); await page.getByRole('tablist', { name: 'Pantallas de Motor de fuentes' }).waitFor();
  await nav.getByRole('button', { name: 'Bandeja de revisión', exact: true }).click(); await page.getByRole('heading', { name: 'Revisar a fondo lo que lo merece.' }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'sin desbordamiento horizontal');
  await openTab(page, 'summary');
});
await step('Voz: sección propia con topes, cascada del más barato al más caro, estado de cada proveedor y sin cifras inventadas', async () => {
  await page.getByRole('navigation', { name: 'Secciones del panel' }).getByRole('button', { name: 'Voz', exact: true }).click();
  await page.getByRole('heading', { name: 'Voz: proveedores, uso y gasto.' }).waitFor(); await page.getByTestId('voice-limits').waitFor();
  const text = await page.getByTestId('voice-limits').innerText();
  assert.match(text, /10 min/); assert.match(text, /máximo por alumna y día/); assert.match(text, /Apagada: VOICE_ROLEPLAY no está en «on»/); assert.match(text, /Falta VOICE_WORKER_TOKEN/);
  const rows = page.getByTestId('voice-limits').locator('tbody tr'); assert.ok(await rows.count() >= 4, 'los cuatro proveedores');
  const names = await page.getByTestId('voice-limits').locator('tbody tr th[scope="row"]').allInnerTexts();
  assert.deepEqual(names.slice(0, 4).map(n => n.split('\n')[0].trim()), ['OpenAI Realtime (mini)', 'Deepgram Voice Agent', 'OpenAI Realtime (completo)', 'ElevenLabs Agents'], 'orden por coste');
  assert.equal((await page.getByTestId('voice-limits').getByText('Sin clave').count()), 4, 'sin claves, cada proveedor dice «Sin clave», no «0»');
  assert.match(await page.getByTestId('voice-chosen').innerText(), /Ningún proveedor disponible: guarda una clave en APIs/);
  await page.getByTestId('voice-limits').getByRole('button', { name: 'APIs', exact: true }).click(); await page.getByRole('heading', { name: 'APIs y conexiones.' }).waitFor();
  await page.getByLabel('Clave de ElevenLabs (voz)').waitFor(); await page.getByLabel('Clave de Deepgram (voz)').waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'sin desbordamiento horizontal');
  await openTab(page, 'summary');
});
await step('Panel de fuentes: una tabla separada en de pago, gratuitas y empresas, con la conexión de cada una y las que no han recogido plegadas', async () => {
  await openTab(page, 'engine'); await page.getByRole('heading', { name: 'Todas las fuentes, en una tabla.' }).waitFor();
  const tabs = page.getByRole('tablist', { name: 'Tipo de fuente' }); await tabs.waitFor();
  assert.deepEqual((await tabs.getByRole('tab').allInnerTexts()).map(t => t.replace(/\s*\d+$/, '').trim()), ['De pago', 'Gratuitas', 'Empresas y ATS']);
  await page.waitForFunction(() => [...document.querySelectorAll('[aria-label="Tipo de fuente"] [role="tab"]')].every(t => /\d\s*$/.test(t.textContent ?? '')), null, { timeout: 15000 }); // los recuentos llegan con los datos
  const counts = (await tabs.getByRole('tab').allInnerTexts()).map(t => Number(t.replace(/\s+/g, ' ').trim().match(/(\d+)$/)?.[1])); assert.equal(counts.reduce((a, b) => a + b, 0), catalog.length, 'los tres tipos suman todo el catálogo');
  // De pago: las que no han recogido ni costado se pliegan, y se pueden abrir para ver su causa.
  const engine = page.getByTestId('sources-engine'); await engine.getByLabel(/Mostrar las \d+ que aún no han recogido/).check();
  await engine.getByTestId('engine-table').waitFor(); assert.ok(await engine.locator('tbody tr').count() > 0);
  assert.match(await engine.getByTestId('engine-table').innerText(), /Sin vía verificada|Falta clave|Conectada|Mal conectada|Sin programar/, 'cada fila dice su conexión');
  await tabs.getByRole('tab', { name: /Gratuitas/ }).click(); await engine.getByTestId('engine-table').waitFor();
  await tabs.getByRole('tab', { name: /Empresas/ }).click(); await page.getByText(/Bolsas de empleo de empresas/).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'sin desbordamiento horizontal');
  await openTab(page, 'summary');
});
await step('Fuentes: catálogo completo (todas las del backend + las del motor) con filtros', async () => {
  await openTab(page, 'sources'); await page.getByRole('heading', { name: 'Fuentes de datos.' }).waitFor();
  // Hermes/Manus es un hueco declarado: se ve la insignia y nunca se pinta como conectado.
  assert.match(await page.getByTestId('agent-gap').innerText(), /Hermes \/ Manus: No disponible/);
  assert.match(await page.getByTestId('test-all').innerText(), /Probar todas las fuentes.*tope 5 US\$/, 'hay un botón para probar todas las fuentes con tope');
  // El motor recoge por CONECTOR y el panel agrupa por PORTAL: `jobtoday` + `jobtoday-closers` son
  // una sola fila (rotulada «2 conectores»), así que el total es el del catálogo y no crece con cada
  // búsqueda nueva del motor. Antes esta prueba esperaba una fila suelta por conector.
  const expected = catalog.length;
  await page.getByText(String(expected), { exact: true }).first().waitFor();
  assert.ok(expected >= 60);
  const jobtoday = page.locator('table').first().locator('tbody tr').filter({ hasText: 'JobToday España' }).first();
  assert.match(await jobtoday.innerText(), /2 conectores/, 'el portal agrupa sus dos conectores en una fila');
  await page.getByLabel('Mostrar').selectOption('failed');
  await page.getByText('Pennylane').first().waitFor();
  assert.equal(await page.locator('table').first().locator('tbody tr').count(), 1);
  await page.getByLabel('Mostrar').selectOption('local');
  const rowsOf = () => page.locator('table').first().locator('tbody tr').count();
  assert.equal(await rowsOf(), 25, 'el catálogo se muestra por tandas de 25');
  while (await page.getByRole('button', { name: /^Mostrar \d+ más$/ }).count()) await page.getByRole('button', { name: /^Mostrar \d+ más$/ }).click();
  assert.ok(await rowsOf() >= 50, 'con «Mostrar más» se llega al catálogo completo');
  await page.getByLabel('Buscar').fill('infojobs'); assert.equal(await page.locator('table').first().locator('tbody tr').count(), 1);
});
await step('Revisión rápida: filtra closers, carga ubicación, oculta no-España, verifica y aprueba en bloque', async () => {
  await openTab(page, 'quick'); await page.getByRole('heading', { name: 'Revisa en bloque.' }).waitFor();
  await page.getByText('Closer de ventas B2B (remoto)').waitFor();
  assert.equal(await page.locator('tbody tr').count(), 2); // Backend Developer queda fuera por perfil
  await page.getByRole('button', { name: 'Cargar ubicación' }).click(); await page.getByText('Austin, Texas').waitFor();
  await page.getByLabel('Ocultar las que claramente no son de España').check();
  assert.equal(await page.locator('tbody tr').count(), 1);
  await page.getByLabel('Seleccionar todas las visibles').check();
  await page.getByRole('button', { name: 'Verificar vigencia' }).click(); await page.getByText(/Activa en el origen/).waitFor();
  assert.deepEqual(state.verifies, ['opp-1']);
  await page.getByRole('button', { name: /^Aprobar/ }).click(); await page.getByText('Aprobada · v2').waitFor();
  assert.equal(state.patches.length, 1);
  const sent = state.patches[0];
  assert.equal(sent.id, 'opp-1'); assert.equal(sent.status, 'approved');
  // El motor rechaza campos del payload raw (title, company, url…): solo deben viajar los permitidos.
  for (const k of ['title', 'company', 'url', 'location', 'salary', 'posted_at']) assert.ok(!(k in sent.payload), `campo no permitido enviado: ${k}`);
  assert.equal(sent.payload.role, 'closer'); assert.equal(sent.payload.application_url, 'https://example.com/a'); assert.equal(sent.payload.headline, 'Closer de ventas B2B (remoto)');
});
await step('Revisión una a una: guardar una oferta con payload raw ya no da 422', async () => {
  state.opps[2].editorial_status = 'draft';
  await openTab(page, 'review'); await page.getByRole('heading', { name: 'Revisar a fondo lo que lo merece.' }).waitFor();
  // La cola humana abre por defecto en excepciones; este caso es un borrador que se edita a mano.
  await page.getByLabel('Filtrar por estado editorial').selectOption('draft');
  await page.getByRole('button', { name: /Desarrollador Backend/ }).click(); await page.getByLabel('Título (headline)').waitFor();
  await page.getByRole('button', { name: 'Guardar borrador' }).click(); await page.getByText(/Guardado: Borrador/).waitFor();
});
await step('Bandeja: tres estados, cada duda con su motivo exacto y lo que debe mirar la persona; auto-aprobadas de las últimas 24 h', async () => {
  const mk = (id, over) => state.external.set(id, { id: crypto.randomUUID(), source: 'indeed', external_id: id, title: 'Closer de ventas', company: 'Acme', location: 'Madrid, España', url: 'http://127.0.0.1:8792/page/ok', salary: null, role: 'closer', score: 70, spain: true, editorial_status: 'draft', first_seen_at: new Date().toISOString(), last_seen_at: new Date().toISOString(), expires_at: new Date(Date.now() + 5 * 864e5).toISOString(), ...over });
  mk('b-dudas', { title: 'Closer sin descripción en la bandeja', editorial_status: 'needs_review', auto_review: { why: 'sin_descripcion', decision: 'human' } });
  mk('b-auto', { title: 'Closer aprobada sola reciente', editorial_status: 'approved', reviewed_by: 'auto-reglas', reviewed_at: new Date().toISOString(), auto_review: { why: 'cumple_reglas', decision: 'approve' } });
  mk('b-vieja', { title: 'Closer aprobada sola hace una semana', editorial_status: 'approved', reviewed_by: 'auto-reglas', reviewed_at: new Date(Date.now() - 7 * 864e5).toISOString(), auto_review: { why: 'cumple_reglas', decision: 'approve' } });
  mk('b-persona', { title: 'Closer aprobada por una persona', editorial_status: 'approved', reviewed_by: 'ana@test.dev', reviewed_at: new Date().toISOString() });
  mk('b-fuera', { title: 'Closer descartada por puntuación', editorial_status: 'withdrawn', score: 30, auto_review: { why: 'score_bajo', decision: 'withdraw' } });
  await openTab(page, 'inbox'); await page.getByRole('heading', { name: 'Resuelve solo las dudas.' }).waitFor();
  const states = page.getByRole('tablist', { name: 'Estado de las ofertas' });
  assert.deepEqual((await states.getByRole('tab').allInnerTexts()).map(t => t.replace(/\s+\d[\d.]*$/, '').trim()), ['Requieren atención', 'Auto-aprobadas (24 h)', 'Descartadas']);
  // Requieren atención: la duda con su motivo y qué mirar.
  await page.getByText('Closer sin descripción en la bandeja').waitFor();
  assert.match(await page.locator('[data-why="sin_descripcion"]').first().innerText(), /Sin descripción/);
  await page.getByText(/No trae descripción: no se puede juzgar el idioma/).first().waitFor();
  // Sin los bloques de métricas, embudo y tabla de fuentes (viven en otros módulos) ni el filtro de estado.
  assert.equal(await page.getByTestId('metrics').count(), 0); assert.equal(await page.locator('#ex-status').count(), 0);
  // Auto-aprobadas: solo lo que aprobó una regla en las últimas 24 h; ni la de hace una semana ni la de una persona.
  await states.getByRole('tab', { name: /Auto-aprobadas/ }).click(); await page.getByText('Closer aprobada sola reciente').waitFor();
  assert.equal(await page.getByText('Closer aprobada sola hace una semana').count(), 0, 'fuera de las 24 h'); assert.equal(await page.getByText('Closer aprobada por una persona').count(), 0, 'la aprobó una persona, no una regla');
  // Descartadas con su motivo.
  await states.getByRole('tab', { name: /Descartadas/ }).click(); await page.getByText('Closer descartada por puntuación').waitFor();
  assert.match(await page.locator('[data-why="score_bajo"]').first().innerText(), /Puntuación baja/);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'sin desbordamiento horizontal');
  for (const id of ['b-dudas', 'b-auto', 'b-vieja', 'b-persona', 'b-fuera']) state.external.delete(id);
});
await step('Fuentes externas: filtra closers de España, verifica y aprueba; el catálogo marca la fuente como externa', async () => {
  const mk = (id, over) => state.external.set(id, { id: crypto.randomUUID(), source: 'indeed', external_id: id, title: 'Closer de ventas', company: 'Acme', location: 'Madrid, España', url: 'http://127.0.0.1:8792/page/ok', salary: null, description: 'Buscamos closer con experiencia en ventas para el equipo comercial de la empresa', posted_at: new Date().toISOString(), editorial_status: 'draft', role: 'closer', spain: true, score: 80, also_seen: [], verified_result: null, first_seen_at: new Date().toISOString(), last_seen_at: new Date().toISOString(), expires_at: new Date(Date.now() + 5 * 864e5).toISOString(), ...over });
  mk('x1', {}); mk('x2', { location: 'Austin, Texas', spain: false, score: 20 }); mk('x3', { title: 'Setter de ventas', location: 'Valencia', role: 'setter', score: 60 });
  // Una excepción de verdad: con ella la pestaña abre en «A revisar» (sin excepciones abriría en borradores).
  mk('x0', { title: 'Closer sin condiciones claras', editorial_status: 'needs_review', score: 55 });
  await page.setViewportSize({ width: 1280, height: 900 });
  await openTab(page, 'external'); await page.getByRole('heading', { name: 'Ofertas de España y del mercado en dólares.' }).waitFor();
  // La cola externa abre en las excepciones (needs_review): los borradores los cierra la pasada automática.
  await page.locator('#ex-status').inputValue().then(v => assert.equal(v, 'needs_review', 'con excepciones, abre en A revisar y no en borradores'));
  // La cola entera se ve aunque los filtros de perfil/España dejen menos: si no, «cumplen los filtros» la esconde.
  await page.getByText(/en tu cola de excepciones \(sin filtros\)/).waitFor();
  await page.locator('#ex-status').selectOption('draft'); // el resto del paso trabaja sobre borradores
  await page.getByTestId('metrics').waitFor(); assert.match(await page.getByTestId('metrics').innerText(), /Últimos 14 días: \d+ ofertas buenas/);
  // Contraste: el texto pequeño gris usa --secondary (≥ 4,5:1), no --muted (3,4:1)
  assert.equal(await page.locator('.data-table th').first().evaluate(el => getComputedStyle(el).color), 'rgb(116, 107, 107)', 'cabeceras de tabla con --secondary');
  // Gráfico accesible: resumen en aria-label, color por token (computado = accent), eje en 0 y tabla alternativa con los 14 días
  const chart = page.getByTestId('metrics').getByRole('img'); assert.match(await chart.getAttribute('aria-label'), /Ofertas buenas por día del .* al .*: \d+ en total/);
  assert.equal(await page.getByTestId('metrics').locator('svg rect').first().evaluate(el => getComputedStyle(el).fill), 'rgb(141, 70, 61)', 'barras con el token --accent');
  await page.getByTestId('ai-agreement').waitFor(); await page.getByTestId('ai-agreement').locator('summary').click(); assert.match(await page.getByTestId('agreement-verdict').innerText(), /Aún no hay base: 0 de 30 pares/);
  await page.getByTestId('ai-mode').waitFor(); assert.match(await page.getByTestId('ai-mode').innerText(), /Revisor IA: (SHADOW — solo anota|LIVE — aprueba y retira sola)/); assert.ok(await page.getByTestId('ai-mode-toggle').isVisible(), 'el propietario ve el interruptor del modo de la IA');
  assert.equal(await page.getByTestId('agreement-table').locator('tbody tr').count(), 5);
  await page.getByTestId('metrics').getByText('Ver tabla por día').click(); assert.equal(await page.getByTestId('metrics-days').locator('tbody tr').count(), 14);
  assert.ok(await page.getByTestId('metrics-tiers').isVisible());
  // Error ≠ vacío: si falla la carga se dice y se puede reintentar; después vuelve el panel
  await page.route('**/api/admin/metrics', r => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'No se pudieron calcular las métricas.' }) }));
  await page.reload(); await openTab(page, 'external');
  // Tras recargar vuelve a abrir en excepciones; este paso sigue sobre borradores.
  assert.equal(await page.locator('#ex-status').inputValue(), 'needs_review');
  await page.locator('#ex-status').selectOption('draft');
  await page.getByTestId('metrics-error').waitFor(); assert.match(await page.getByTestId('metrics-error').innerText(), /No se pudieron calcular las métricas/);
  await page.unroute('**/api/admin/metrics'); await page.getByRole('button', { name: 'Reintentar' }).click(); await page.getByTestId('metrics').waitFor();
  // Embudo por fuente y mercado: panel con datos, error ≠ vacío con reintento, tabla accesible
  await page.getByTestId('funnel').waitFor(); assert.match(await page.getByTestId('funnel').locator('summary').innerText(), /Embudo por fuente y mercado: \d+ nuevas en 24 h/);
  assert.ok(await page.getByTestId('funnel-table').locator('th[scope="col"]').count() >= 8, 'tabla con cabeceras');
  await page.route('**/api/admin/funnel*', r => r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'No se pudo calcular el embudo.' }) }));
  await page.reload(); await openTab(page, 'external');
  await page.getByTestId('funnel-error').waitFor(); assert.match(await page.getByTestId('funnel-error').innerText(), /No se pudo calcular el embudo/);
  await page.unroute('**/api/admin/funnel*'); await page.getByTestId('funnel-error').getByRole('button', { name: 'Reintentar' }).click(); await page.getByTestId('funnel').waitFor();
  await page.locator('#ex-status').selectOption('draft'); // tras recargar abre en excepciones; el resto del paso trabaja sobre borradores
  await page.setViewportSize({ width: 390, height: 844 }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'métricas sin scroll horizontal en móvil'); await page.setViewportSize({ width: 1280, height: 900 });
  if (process.env.SHOT) { await page.getByTestId('metrics').getByText('Ver tabla por día').click(); await page.getByTestId('metrics').screenshot({ path: process.env.SHOT }); }
  await page.getByRole('cell', { name: /Closer de ventas/ }).first().waitFor(); // por rol: la frase también está en elementos ocultos (ideas de fuentes, búsquedas de Google Jobs)
  assert.equal(await page.locator('table').last().locator('tbody tr').count(), 1); // closer + España; el de Texas y el setter quedan fuera
  assert.equal(await page.locator('table', { has: page.getByRole('columnheader', { name: 'Vía' }) }).locator('tbody tr').count(), 7); // fuentes conocidas: 3 APIs + 4 de JobSpy
  await page.getByRole('button', { name: 'Pausar InfoJobs' }).click(); await page.getByText(/infojobs: pausada/).waitFor();
  await page.getByRole('button', { name: 'Reanudar InfoJobs' }).waitFor(); // espera a que la tabla recargue con el nuevo estado
  await page.getByRole('button', { name: 'Reanudar InfoJobs' }).click(); await page.getByText(/infojobs: reanudada/).waitFor();
  await page.getByLabel('Seleccionar todas las visibles').check();
  await page.getByRole('button', { name: 'Verificar vigencia' }).click(); await page.getByText(/Activa · content_matches/).waitFor();
  await page.getByText('80', { exact: true }).first().waitFor(); // puntuación visible
  await page.getByRole('button', { name: 'Aprobar 1', exact: true }).click(); await page.getByText(/1 oferta\(s\) → Aprobada/).waitFor();
  assert.equal([...state.external.values()].filter(o => o.editorial_status === 'approved').length, 1);
  // «Aprobar las mejores»: con otro borrador de puntuación alta pendiente, se aprueba por filtros
  mk('x4', { title: 'Closer high ticket', score: 95 });
  await page.getByRole('button', { name: 'Actualizar' }).click(); await page.getByText('Closer high ticket').waitFor();
  await page.getByRole('button', { name: 'Aprobar las mejores' }).click(); await page.getByText(/Aprobadas 1 de 1 que cumplían los filtros/).waitFor();
  assert.equal([...state.external.values()].filter(o => o.editorial_status === 'approved').length, 2);
  // Auditoría del catálogo: un listado de portal YA aprobado antes del arreglo aparece con su motivo y SIGUE
  // aprobado (la lista informa, no retira). Sin este panel, lo aprobado por una versión anterior de la regla
  // quedaba publicado delante de las alumnas y nadie lo veía: la pasada automática solo mira borradores.
  const listing = mk('old-index', { title: 'Ofertas de trabajo de Closer', company: null, url: 'https://www.infojobs.net/ofertas-trabajo/closer', editorial_status: 'approved', score: 90 });
  const auditPanel = page.getByTestId('rule-audit');
  if (!(await auditPanel.evaluate(el => el.open))) await auditPanel.locator('summary').click();
  await auditPanel.getByRole('button', { name: /Comprobar de nuevo/ }).click();
  await page.getByTestId('rule-audit').getByText('Ofertas de trabajo de Closer').waitFor();
  assert.match(await page.getByTestId('rule-audit').innerText(), /Es un listado del portal, no una oferta/);
  assert.match(await page.getByTestId('rule-audit').innerText(), /Solo lectura/);
  assert.equal([...state.external.values()].find(o => o.title === 'Ofertas de trabajo de Closer').editorial_status, 'approved', 'la auditoría no cambia ninguna oferta');
  state.external.delete('old-index'); // fuera del estado para no alterar los recuentos de los pasos siguientes
  await openTab(page, 'sources'); await page.getByRole('heading', { name: 'Fuentes de datos.' }).waitFor();
  // 5 activas: las cuatro de siempre más la excepción 'x0' que crea este paso.
  await page.getByLabel('Buscar').fill('indeed'); await page.getByText(/Externa · 5 activas/).waitFor();
});
await step('Apify: añadir el actor, guardar la clave, lanzar y recoger resultados con coste y presupuesto', async () => {
  await openTab(page, 'apify'); await page.getByRole('heading', { name: 'Buscar ofertas.' }).waitFor();
  await page.getByText(/falta conectar tu cuenta de Apify/).waitFor(); await page.getByText('0.00 USD de 5 USD').waitFor();
  await page.getByTestId('apify-advanced').locator('summary').click(); // las opciones avanzadas empiezan cerradas
  await page.getByRole('button', { name: 'Usar este actor' }).click();
  assert.equal(await page.getByLabel('Actor de Apify').inputValue(), 'aakash19/jobspy'); assert.equal(await page.getByLabel('Código de la fuente').inputValue(), 'apify-jobspy');
  await page.getByLabel('Máximo de elementos por ejecución').fill('300'); await page.getByRole('button', { name: 'Guardar', exact: true }).click(); await page.getByText('Actor guardado.').waitFor();
  await page.getByText('aakash19/jobspy').first().waitFor();
  await page.getByRole('button', { name: 'Lanzar ahora' }).click(); await page.getByText(/Guarda antes la clave de Apify/).first().waitFor(); // sin clave no se lanza
  await openTab(page, 'apis'); await page.getByLabel('Clave de Apify').fill('good-key-1234');
  await page.getByRole('button', { name: 'Guardar', exact: true }).nth(0).click(); await page.getByText('Clave de Apify guardada.').waitFor();
  await openTab(page, 'apify'); await page.getByTestId('apify-advanced').locator('summary').click();
  await page.getByRole('button', { name: 'Lanzar ahora' }).click(); await page.getByText(/Ejecución lanzada en Apify/).waitFor();
  assert.equal(state.apifyCalls.length, 1); assert.equal(state.apifyCalls[0].query.maxItems, '300');
  await page.getByText('Buscando…').first().waitFor();
  state.apifyItems = [1, 2, 3].map(i => ({ id: `u${i}`, site: 'linkedin', job_url: `https://www.linkedin.com/jobs/view/u${i}`, title: 'Closer de ventas', company: `Empresa ${i}`, location: 'Madrid, España', description: 'Buscamos closer con experiencia en ventas para el equipo comercial' }));
  await page.getByRole('button', { name: 'Recoger resultados' }).click(); await page.getByText(/Recogidas 1 ejecución\(es\): 3 elementos/).waitFor();
  await page.getByText('Terminada').first().waitFor(); await page.getByText('0.070').waitFor();
  assert.equal([...state.external.values()].filter(o => o.source === 'apify-jobspy').length, 3);
  await page.getByText('1.07 USD de 5 USD').waitFor().catch(() => {}); // 0,07 gastados (+ nada en curso)
});
await step('Búsqueda automática (modo sencillo): portales en lenguaje llano, prueba de 10 ofertas y repuesto visible', async () => {
  await openTab(page, 'apify'); await page.getByRole('heading', { name: 'Buscar ofertas.' }).waitFor();
  const text = await page.getByText('Cómo funciona, en 3 líneas').locator('..').innerText();
  assert.match(text, /prueba otro sola/); assert.ok(!/scraper|actor|proxy/i.test(text), 'la explicación no usa jerga');
  const card = page.getByTestId('portal-indeed'); await card.waitFor();
  assert.match(await card.innerText(), /Indeed \(España\)[\s\S]*Sin probar|Funciona|Esperando/);
  // El porqué del reparto se lee en la tarjeta: aprobadas medidas por dólar, o el hueco declarado.
  assert.match(await page.getByTestId('portal-priority-indeed').innerText(), /Reparto del mes: .*(aprobadas|Sin recuento)/);
  assert.ok(!/misceres|kaix|actor/i.test(await card.innerText()), 'los nombres técnicos no se ven hasta abrir «repuesto»');
  await card.locator('summary').click(); assert.match(await card.innerText(), /Buscador de Indeed A/); assert.match(await card.innerText(), /Se usan por orden/);
  state.apifyFailActors = new Set(['misceres~indeed-scraper']); const before = state.apifyCalls.length;
  await card.getByRole('button', { name: 'Probar con 10 ofertas' }).click(); await page.getByText(/Prueba lanzada en Indeed \(España\) \(el primer buscador no arrancó; se usó «Buscador de Indeed B»\)/).waitFor();
  assert.equal(state.apifyCalls.length, before + 1); assert.equal(state.apifyCalls.at(-1).query.maxItems, '10');
  await card.locator('.status', { hasText: 'Buscando ahora…' }).waitFor();
  await card.getByLabel('Buscar cada día').click(); await page.getByText('Búsqueda diaria activada en Indeed').waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  state.apifyFailActors = new Set();
});
await step('Alumnas: el panel invita; ella crea contraseña, entra, guarda su perfil con consentimiento y el enlace de su vídeo', async () => {
  await page.getByRole('button', { name: 'Alumnas' }).click(); await page.getByRole('heading', { name: 'Alumnas con acceso.' }).waitFor();
  await page.getByLabel('Invitar a una alumna').fill('lucia@alumna.dev'); await page.getByRole('button', { name: 'Enviar invitación' }).click();
  await page.getByText('Invitación enviada a lucia@alumna.dev.').waitFor(); await page.getByText('lucia@alumna.dev').first().waitFor();
  const alumnaCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'] }); // otro navegador: sin la sesión del panel
  const alumna = await alumnaCtx.newPage();
  const token = state.recoverTokens.get('lucia@alumna.dev'); assert.ok(token);
  if (process.env.UI_DEBUG) alumna.on('response', r => { if (r.url().includes('/api/')) console.log('NET', r.status(), r.url()); });
  await alumna.goto(`${BASE}/alumna/reset#access_token=${token}&type=recovery`);
  await alumna.getByLabel('Contraseña nueva').fill('Contraseña-lucia-1'); await alumna.getByLabel('Repite la contraseña').fill('Contraseña-lucia-1');
  await alumna.getByRole('button', { name: 'Guardar contraseña' }).click(); await alumna.getByRole('heading', { name: 'Contraseña guardada' }).waitFor({ timeout: 8000 }).catch(async e => { throw new Error(`${e.message.split('\n')[0]} · pantalla: ${(await alumna.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 300)}`); });
  await alumna.goto(BASE + '/alumna'); await alumna.getByLabel('Email').fill('lucia@alumna.dev'); await alumna.getByLabel('Contraseña').fill('Contraseña-lucia-1');
  await alumna.getByRole('button', { name: 'Entrar' }).click(); await alumna.getByText('TU PERFIL', { exact: true }).waitFor();
  assert.ok(await alumna.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'sin scroll horizontal en móvil');
  assert.equal(await alumna.getByRole('button', { name: 'Guardar perfil' }).isDisabled(), true, 'sin consentimiento no se puede guardar');
  // `getByLabel('Nombre')` casa también con «Copiar Nombre y apellidos»: se pide el campo, no la etiqueta suelta.
  await alumna.getByLabel('Nombre', { exact: true }).fill('Lucía'); await alumna.getByRole('checkbox', { name: /closer/i }).first().check();
  await alumna.getByLabel(/Enlace a tu vídeo/).fill('https://drive.google.com/file/d/abc/view');
  await alumna.getByLabel(/Acepto que Women Digital Closer/).check(); await alumna.getByRole('button', { name: 'Guardar perfil' }).click();
  await alumna.getByText('Perfil guardado.').waitFor();
  state.external.set('ui|1', { id: '00000000-0000-4000-8000-000000000099', source: 'ui', external_id: '1', title: 'Closer de ventas remoto', company: 'Zeta', location: 'Madrid, España', url: 'https://jobs.example.com/ui1', salary: null, description: 'Buscamos una persona con experiencia en ventas para el equipo comercial de la empresa en España.', posted_at: new Date().toISOString(), expires_at: new Date(Date.now() + 5 * 864e5).toISOString(), first_seen_at: new Date().toISOString(), last_seen_at: new Date().toISOString(), editorial_status: 'approved', role: 'closer', spain: true, score: 70, raw: { is_remote: true }, also_seen: ['google', 'infojobs'] });
  await alumna.reload(); await alumna.getByTestId('matches').getByText('Closer de ventas remoto').waitFor({ timeout: 8000 });
  assert.match(await alumna.getByTestId('matches').innerText(), /Remoto/); assert.match(await alumna.getByTestId('matches').innerText(), /No sabemos:/);
  // Atribución honesta: el anuncio se atribuye a la primera fuente y se dice dónde más se vio.
  assert.match(await alumna.getByTestId('matches').innerText(), /Vista también en: google · infojobs/, 'la oferta enseña las otras fuentes de also_seen');
  await alumna.reload(); await alumna.getByText('TU PERFIL', { exact: true }).waitFor(); await alumna.waitForFunction(() => document.querySelector('#sp-name')?.value === 'Lucía', null, { timeout: 8000 });
  assert.equal(await alumna.getByLabel(/Enlace a tu vídeo/).inputValue(), 'https://drive.google.com/file/d/abc/view');
  assert.equal(await alumna.getByLabel('Nombre', { exact: true }).inputValue(), 'Lucía');
  // Candidatura ASISTIDA: formulario base → preparar → revisar y copiar → abrir → «ya la he enviado». La app no envía nada.
  await alumna.getByTestId('app-form').locator('summary').click();
  await alumna.getByLabel('Email de contacto').fill('lucia@ejemplo.com'); await alumna.getByLabel('Teléfono').fill('600 11 22 33'); await alumna.getByLabel('Tu CV (enlace a tu Drive)').fill('https://drive.google.com/file/d/cv/view');
  await alumna.getByLabel('Presentación breve (2-3 frases)').fill('Cierro llamadas high ticket.'); await alumna.getByLabel('Años de experiencia en ventas').fill('3');
  await alumna.getByRole('button', { name: 'Guardar formulario' }).click(); await alumna.getByText('Formulario guardado.').waitFor();
  assert.match(await alumna.getByTestId('app-form').locator('summary').innerText(), /completado al \d+ %/); assert.match(await alumna.getByTestId('app-missing').innerText(), /Te falta:/);
  await alumna.getByTestId('matches').getByRole('button', { name: 'Preparar candidatura' }).first().click();
  await alumna.getByTestId('application').first().waitFor(); const msg = alumna.locator('textarea[id^="msg-"]').first();
  assert.match(await msg.inputValue(), /Me llamo Lucía y me interesa el puesto de Closer de ventas remoto/); assert.match(await msg.inputValue(), /Cierro llamadas high ticket\./);
  await msg.fill('Mi mensaje revisado por mí.'); await alumna.getByRole('button', { name: 'Guardar mensaje' }).click(); await alumna.getByText('Mensaje guardado.').waitFor();
  await alumna.getByRole('button', { name: 'Copiar mensaje' }).click(); await alumna.getByText('Mensaje copiado.').waitFor(); assert.equal(await alumna.evaluate(() => navigator.clipboard.readText()), 'Mi mensaje revisado por mí.');
  await alumna.getByText('Datos para copiar en los formularios').click(); await alumna.getByRole('button', { name: 'Copiar Email' }).click(); assert.equal(await alumna.evaluate(() => navigator.clipboard.readText()), 'lucia@ejemplo.com');
  // Tablero: abrir el anuncio NO mueve la tarjeta (nada se detecta solo); la alumna la mueve. El enlace
  // sigue abriendo el anuncio en otra pestaña, sin sacarla del tablero.
  const card = () => alumna.getByTestId('application').first();
  const [tab] = await Promise.all([alumnaCtx.waitForEvent('page'), card().getByRole('link', { name: 'Anuncio' }).click()]); await tab.close();
  // Abrir el anuncio SÍ deja huella (paso «vista» del embudo) pero no la saca de «Me interesa».
  await card().getByText('Anuncio abierto').waitFor({ timeout: 8000 });
  assert.equal(await alumna.getByTestId('stage-interested').getByTestId('application').count(), 1, 'abrir el anuncio la deja en «Me interesa»');
  await card().getByTestId('outcome-applied').click();
  await alumna.getByTestId('stage-applied').getByTestId('application').first().waitFor();
  assert.match(await alumna.getByTestId('stage-applied').innerText(), /Enviada por ti/);
  assert.equal(await card().getByTestId('outcome-applied').count(), 0, 'una enviada no se vuelve a enviar');
  if (process.env.SHOT2) await alumna.screenshot({ path: process.env.SHOT2, fullPage: true });
  await card().getByTestId('outcome-responded').click();
  await alumna.getByTestId('stage-follow_up').getByTestId('application').first().waitFor();
  assert.match(await alumna.getByTestId('stage-follow_up').innerText(), /La empresa ha respondido/);
  assert.ok(await alumna.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'sin scroll horizontal en móvil con candidaturas');
  // Progreso: una práctica y un repaso registrados con su sesión; la vista muestra solo datos reales y su tabla alternativa.
  const logged = await alumna.evaluate(async () => {
    const send = body => fetch('/api/student/activity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.status);
    return [await send({ kind: 'practice', ref: 'precio', score: 72, detail: { axes: { empatia: 80, cierre: 64 }, difficulty: 'Media', mode: 'texto' } }), await send({ kind: 'training_review', ref: 'onboarding', detail: { met: 4, total: 4 } })];
  });
  assert.deepEqual(logged, [201, 201]);
  await alumna.goto(BASE + '/'); await alumna.getByRole('button', { name: 'Mi progreso' }).click(); await alumna.getByRole('heading', { name: 'Tu progreso.' }).waitFor();
  await alumna.locator('.stat-strip').waitFor();
  const strip = await alumna.locator('.stat-strip').innerText(); assert.match(strip, /1\s*prácticas/); assert.match(strip, /72\s*nota media/);
  // La formación cuenta cursos: el repaso aprobado (4/4) deja Onboarding como aprobado, no «estudiado».
  assert.match(await alumna.locator('.student-progress .plain-list li', { hasText: 'Onboarding' }).innerText(), /Aprobado/);
  await alumna.getByTestId('this-week').waitFor(); const week = await alumna.getByTestId('this-week').innerText(); assert.match(week, /Completar 3 prácticas en la sala · \d\/3/); assert.match(week, /Enviar 5 candidaturas · \d\/5/); assert.ok(!/sin practicar/.test(week), 'una práctica de hoy no avisa de inactividad');
  await alumna.getByTestId('level').waitFor(); assert.match(await alumna.getByTestId('level').innerText(), /Nivel \d+ · \d+ XP/);
  assert.match(await alumna.locator('.student-progress').innerText(), /Tasa de respuesta\s*100 %/, 'una enviada y respondida = 100 %');
  assert.match(await alumna.locator('.student-progress').innerText(), /Maestría por escenario/);
  await alumna.getByText('Ver como tabla').click(); assert.equal(await alumna.locator('.progress-card details tbody tr').count(), 6, 'seis semanas en la tabla alternativa');
  assert.ok(await alumna.getByRole('img', { name: /Nota media semanal de prácticas/ }).isVisible());
  assert.ok(await alumna.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'sin scroll horizontal en móvil con progreso');
  await Promise.all([page.waitForResponse(r => r.url().includes('/api/admin/students?days=7') && r.ok()), page.getByRole('button', { name: 'Últimos 7 días' }).click()]);
  const board = page.getByTestId('coordinator'); await board.waitFor();
  assert.match(await board.innerText(), /Han practicado\s*\d+ · \d+ %/); assert.ok(await board.getByRole('img', { name: /Actividad de las alumnas en 7 días/ }).isVisible());
  await board.getByText('Ver como tabla').first().click(); assert.equal(await board.getByTestId('alt-table').first().locator('tbody tr').count(), 5, 'cinco pasos en la tabla alternativa');
  assert.match(await board.innerText(), /Hace falta que al menos 5 alumnas/, 'con una sola alumna no hay distribución de notas');
  await board.getByTestId('followup').waitFor(); assert.match(await board.getByTestId('followup').innerText(), /Pendientes de acompañar|por acompañar/, 'la tarjeta de acompañamiento existe');
  assert.match(await board.getByTestId('retention').innerText(), /Elige 30 o 90 días/, 'con 7 días no se mide la retención');
  assert.match(await board.innerText(), /Respuesta de las empresas[\s\S]*Tasa de respuesta\s*100 %/); await board.getByTestId('refer').waitFor();
  if (process.env.SHOT3) await board.screenshot({ path: process.env.SHOT3 });
  assert.match(await board.getByRole('heading', { level: 2 }).first().innerText(), /\d+ de \d+ han practicado/, 'el titular dice la conclusión');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'panel de coordinación sin scroll horizontal en móvil');
  assert.ok(await board.locator('.funnel-row').first().isVisible());
  if (process.env.SHOT4) await board.screenshot({ path: process.env.SHOT4 });
  await page.setViewportSize({ width: 1280, height: 900 });
  const row = page.locator('tbody tr', { hasText: 'lucia@alumna.dev' }); await row.getByText('1 · media 72').waitFor(); assert.match(await row.innerText(), /1\/12/);
  await alumna.goto(BASE + '/alumna'); await alumna.getByText('TU PERFIL', { exact: true }).waitFor();
  await alumna.getByRole('button', { name: 'Salir' }).click(); await alumna.getByRole('heading', { name: 'Tu espacio' }).waitFor();
});
await step('móvil: Resumen sin scroll horizontal', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openTab(page, 'summary'); await page.getByRole('heading', { name: 'Cómo vamos.' }).waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
});
await step('móvil: menú en una sola franja desplazable (no ocupa la pantalla) y Fuentes por tandas con «Mostrar más»', async () => {
  const sidebarBottom = await page.evaluate(() => document.querySelector('.sidebar').getBoundingClientRect().bottom);
  assert.ok(sidebarBottom < 260, `la cabecera del panel mide ${Math.round(sidebarBottom)} px en móvil`);
  const nav = await page.evaluate(() => { const n = document.querySelector('.sidebar nav'); return { scrolls: n.scrollWidth > n.clientWidth, wraps: getComputedStyle(n).flexWrap, overflowX: getComputedStyle(n).overflowX }; });
  assert.deepEqual(nav, { scrolls: true, wraps: 'nowrap', overflowX: 'auto' });
  await openTab(page, 'sources'); await page.getByRole('heading', { name: 'Fuentes de datos.' }).waitFor();
  const more = page.getByRole('button', { name: /^Mostrar \d+ más$/ }).first();
  await more.waitFor();
  const rows = () => page.locator('table').first().locator('tbody tr').count();
  const before = await rows(); await more.click();
  assert.ok(await rows() > before, 'al pulsar «Mostrar más» aparecen más fuentes');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
});

await step('Resumen: la cola humana suma el motor y las fuentes externas, y lleva a la que tiene trabajo', async () => {
  await page.setViewportSize({ width: 1280, height: 900 });
  // Estado conocido: ninguna fila externa en la cola salvo la que se siembra ahora.
  for (const row of state.external.values()) row.editorial_status = 'draft';
  state.external.set('res|1', { id: crypto.randomUUID(), source: 'indeed', external_id: 'res-1', title: 'Closer sin condiciones claras', company: 'Acme', location: 'Madrid, España', url: 'http://127.0.0.1:8792/page/ok', salary: null, description: 'Buscamos closer con experiencia en ventas para el equipo comercial de la empresa', posted_at: new Date().toISOString(), editorial_status: 'needs_review', role: 'closer', spain: true, score: 55, also_seen: [], verified_result: null, first_seen_at: new Date().toISOString(), last_seen_at: new Date().toISOString(), expires_at: new Date(Date.now() + 5 * 864e5).toISOString() });
  const engineNeeds = state.opps.filter(o => o.editorial_status === 'needs_review').length;
  const engineDrafts = state.opps.filter(o => o.editorial_status === 'draft').length;
  const extDrafts = [...state.external.values()].filter(r => r.editorial_status === 'draft').length;
  await openTab(page, 'summary'); await page.getByRole('heading', { name: 'Cómo vamos.' }).waitFor();
  const exceptionsCard = page.locator('article.source-card', { hasText: 'EXCEPCIONES PARA TI' });
  await exceptionsCard.locator('strong').waitFor();
  // Mientras carga, la tarjeta dice «…»: el desglose solo se pinta con las dos colas ya leídas.
  await page.getByText(new RegExp(`${engineNeeds} del motor · 1 de fuentes externas`)).waitFor();
  // El total incluye la excepción externa: antes solo contaba el motor y la cola real quedaba invisible.
  assert.equal(await exceptionsCard.locator('strong').innerText(), String(engineNeeds + 1), 'la tarjeta suma las dos colas');
  const draftsCard = page.locator('article.source-card', { hasText: 'POR CLASIFICAR' });
  await page.getByText(new RegExp(`${engineDrafts} del motor · ${extDrafts} de fuentes externas`)).waitFor();
  assert.equal(await draftsCard.locator('strong').innerText(), String(engineDrafts + extDrafts));
  // El aviso abre la cola externa (la que tiene trabajo), no la del motor.
  await page.getByRole('button', { name: 'Ver excepciones externas' }).click();
  await page.getByRole('heading', { name: 'Ofertas de España y del mercado en dólares.' }).waitFor();
  assert.equal(await page.locator('#ex-status').inputValue(), 'needs_review');
});

await step('motor en pausa por cuota: el Resumen nombra la causa y pone «—» en vez de un error genérico', async () => {
  // Sin externas aprobadas que sirvan de relleno: así se ve el hueco real del motor, que es lo que en
  // producción aparecía como «La consulta falló.» con las cifras en «…».
  for (const row of state.external.values()) if (row.editorial_status === 'approved' || row.editorial_status === 'published') row.editorial_status = 'draft';
  state.enginePaused = 'allowance';
  await openTab(page, 'summary'); await page.getByRole('heading', { name: 'Cómo vamos.' }).waitFor();
  await page.getByRole('button', { name: 'Actualizar' }).click();
  // Se espera al aviso con su causa (solo se pinta con la lectura terminada), no a la primera mención de la
  // pausa: esa sale también en el paso «Ver fuentes» mientras las cifras aún están cargando.
  await page.getByRole('status').filter({ hasText: /pausa por cuota de hosting/ }).waitFor();
  assert.equal(await page.getByText('La consulta falló.').count(), 0, 'la pausa llega explicada, no como error genérico');
  const goal = page.locator('article.source-card', { hasText: 'OBJETIVO' });
  assert.match(await goal.innerText(), /—\s*de\s*20/, 'ni un cero inventado ni un «…» que se queda cargando para siempre');
  assert.equal(await goal.getByText('Sin datos', { exact: true }).count(), 1, 'el estado del objetivo se declara, no se inventa');
  assert.equal(await goal.getByText(/Faltan/).count(), 0, 'sin datos no se puede decir cuántas faltan');
  assert.equal(await page.getByRole('progressbar').count(), 0, 'sin datos no hay barra: un 0 % sería un cero falso');
  for (const label of ['EXCEPCIONES PARA TI', 'POR CLASIFICAR']) {
    assert.equal(await page.locator('article.source-card', { hasText: label }).locator('strong').innerText(), '—', `${label}: el hueco se declara`);
  }
  assert.match(await page.locator('article.source-card', { hasText: 'FUENTES CON FALLO' }).innerText(), /—\s*sin datos del motor cloud/);
  assert.ok(await page.getByRole('button', { name: 'Ver fuentes' }).isVisible(), 'y el paso lleva a donde se ve el estado real');
  state.enginePaused = null;
});

await step('avisos del motor: aparece en CUALQUIER pestaña, con su causa, sin tener que abrir Fuentes', async () => {
  state.enginePaused = 'allowance';
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(BASE + '/admin');
  await page.getByRole('heading', { name: 'Cómo vamos.' }).waitFor();
  const banner = page.getByTestId('engine-alert');
  await banner.waitFor(); // el panel abre en Resumen: el aviso no vive dentro de la pestaña Fuentes
  assert.match(await banner.innerText(), /pausa por cuota de hosting/);
  assert.match(await banner.innerText(), /Aviso por correo desactivado: sin clave de Resend/, 'sin clave guardada, el panel dice por qué no hay correo');
  assert.ok(!/Aviso enviado a/.test(await banner.innerText()), 'y no presume de un aviso que no ha salido');
  // «Comprobar ahora» registra la comprobación y vuelve a intentar el aviso; con la clave ausente lo declara.
  await banner.getByRole('button', { name: 'Comprobar ahora' }).click();
  await page.getByTestId('engine-alert-note').waitFor();
  assert.match(await page.getByTestId('engine-alert-note').innerText(), /Sin clave de Resend/);
  assert.match(await banner.innerText(), /Se detectó el/, 'la comprobación deja fecha de detección, sin inventarla');
  assert.match(await banner.innerText(), /Última comprobación/);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'el aviso no desborda en móvil');
  await page.setViewportSize({ width: 1280, height: 900 });
  // Con el motor bien el aviso desaparece: un aviso que siempre está no se lee.
  state.enginePaused = null;
  await page.goto(BASE + '/admin');
  await page.getByRole('heading', { name: 'Cómo vamos.' }).waitFor();
  await page.getByTestId('engine-alert').waitFor({ state: 'detached', timeout: 8000 });
  assert.equal(await page.getByTestId('engine-alert').count(), 0);
});

await browser.close(); close();
for (const [status, name, msg] of results) console.log(`${status}  ${name}${msg ? '\n      ' + msg : ''}`);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} pasos de interfaz OK`);
process.exit(failed ? 1 : 0);
