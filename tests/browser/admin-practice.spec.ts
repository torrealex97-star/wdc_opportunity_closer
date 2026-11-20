import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';

// Prueba ACTIVA (sin banderas): arranca su propio `next dev` con el backend local de criterios
// (SQLite), un `/admin` en modo hospedado y un proveedor de modelo simulado. Comprueba la ida y vuelta
// completa: panel → persistencia → puntuación de una práctica con el peso guardado.
test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const freePort = () => new Promise<number>((resolve, reject) => {
  const server = net.createServer();
  server.on('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    server.close(() => resolve(port));
  });
});

// Respuesta fija del modelo: todos los ejes a 0 salvo apertura a 100. Así la nota es
// exactamente el peso guardado de apertura / suma de pesos, sin depender de ninguna estimación.
const modelDebrief = {
  summary: 'Práctica de prueba con un feedback fijo.',
  focus: 'Cerrar con día y hora.',
  strengths: ['Abre con permiso'],
  improvements: ['Cuantifica el coste'],
  axes: [
    { id: 'apertura', score: 100, note: 'Apertura medida.', quote: '' },
    { id: 'descubrimiento', score: 0, note: 'Sin descubrimiento.', quote: '' },
    { id: 'pitch', score: 0, note: 'Sin pitch.', quote: '' },
    { id: 'control', score: 0, note: 'Sin control.', quote: '' },
    { id: 'objecion', score: 0, note: 'Sin objeciones.', quote: '' },
    { id: 'siguiente', score: 0, note: 'Sin siguiente paso.', quote: '' },
    { id: 'etica', score: 0, note: 'Sin evidencia de trato.', quote: '' },
  ],
  bant: {
    budget: { status: '?', quote: '' },
    authority: { status: '?', quote: '' },
    need: { status: '?', quote: '' },
    timing: { status: '?', quote: '' },
    decision: 'paro_demasiado_pronto',
  },
  model: 'Podrías haber dicho: ¿lo dejamos el jueves a las diez?',
  next: 'Agenda una llamada con dos huecos concretos.',
};

let next: ChildProcess | null = null;
let model: Server | null = null;
let base = '';
let dataDir = '';
let distDir = '';
let log = '';

// `next dev` reescribe `apps/web/next-env.d.ts` y `apps/web/tsconfig.json` en cada arranque para apuntar
// los tipos a su distDir, y no hay ajuste de Next que lo redirija: siempre se escriben en el directorio del
// proyecto. Con un distDir propio (para no compartir caché con el `next dev` del operador) el contenido
// cambia y el repo queda sucio. La prueba guarda los bytes originales antes de arrancar y los devuelve
// tal cual al terminar, también si algún paso falla. El distDir `.next-e2e*` ya está en .gitignore.
const PROJECT_FILES = ['next-env.d.ts', 'tsconfig.json'].map(name => path.join(process.cwd(), 'apps/web', name));
const originalProjectFiles = new Map<string, Buffer>();
function restoreProjectFiles() {
  for (const [file, contents] of originalProjectFiles) {
    try { if (!readFileSync(file).equals(contents)) writeFileSync(file, contents); } catch { /* el arranque del servidor no llegó a escribir */ }
  }
}

test.beforeAll(async () => {
  for (const file of PROJECT_FILES) originalProjectFiles.set(file, readFileSync(file));
  // Si el proceso muere sin pasar por afterAll, se restaura igualmente en la salida normal de Node.
  process.once('exit', restoreProjectFiles);
  dataDir = mkdtempSync(path.join(tmpdir(), 'wdc-practice-'));
  // Caché de Turbopack propia por ejecución: reutilizar `.next-e2e` tras matar un servidor deja el
  // directorio de persistencia a medias y el siguiente arranque falla.
  distDir = `.next-e2e-${process.pid}-${Date.now()}`;
  const modelPort = await freePort();
  model = createServer((request, response) => {
    if (request.method !== 'POST') { response.writeHead(404).end(); return; }
    let body = '';
    request.on('data', chunk => { body += String(chunk); });
    request.on('end', () => {
      // La sala pide una réplica en la conversación y el feedback con esquema. La réplica debe ser
      // corta: devolver el JSON de debrief como si fuera un turno rompe el límite de 800 caracteres.
      const payload = (() => { try { return JSON.parse(body) as { response_format?: unknown }; } catch { return {}; } })();
      const content = payload.response_format ? JSON.stringify(modelDebrief) : 'Entiendo. ¿Y cómo lo estaríais midiendo?';
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content } }] }));
    });
  });
  await new Promise<void>(resolve => model!.listen(modelPort, '127.0.0.1', resolve));

  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  next = spawn('npx', ['--no-install', 'next', 'dev', 'apps/web', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: process.cwd(),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      CAREER_ENGINE_URL: 'http://127.0.0.1:9',
      NEXT_DIST_DIR: distDir,
      NEXT_TELEMETRY_DISABLED: '1',
      PRACTICE_DB_PATH: path.join(dataDir, 'practice-rubrics.sqlite'),
      GROQ_BASE_URL: `http://127.0.0.1:${modelPort}/v1`,
      GROQ_API_KEY: 'test-key',
      SUPABASE_URL: '',
      SUPABASE_PUBLISHABLE_KEY: '',
      SUPABASE_SERVICE_ROLE_KEY: '',
    },
  });
  next.stdout?.on('data', chunk => { log += String(chunk); });
  next.stderr?.on('data', chunk => { log += String(chunk); });

  for (let attempt = 0; attempt < 240; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/admin/session`);
      const data = await response.json() as { authenticated?: boolean };
      if (data.authenticated) return;
    } catch { /* el servidor aún compila */ }
    if (next.exitCode !== null) break;
    await sleep(500);
  }
  throw new Error(`El servidor de la prueba no arrancó.\n${log.slice(-4000)}`);
});

test.afterAll(async () => {
  if (next?.pid) { try { process.kill(-next.pid, 'SIGTERM'); } catch { /* ya cerrado */ } }
  await new Promise<void>(resolve => model?.close(() => resolve()) ?? resolve());
  await sleep(500);
  // Antes de borrar el distDir: el servidor ya no corre y los ficheros vuelven a su contenido versionado.
  restoreProjectFiles();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  // El caché de Turbopack puede seguir escribiendo al recibir SIGTERM; no es parte del resultado.
  try { if (distDir) rmSync(path.join(process.cwd(), 'apps/web', distDir), { recursive: true, force: true }); } catch { /* caché de prueba */ }
});

async function score(): Promise<{ score: number; label: string }> {
  const response = await fetch(`${base}/api/practice`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      scenario: 'venta-fria',
      mode: 'debrief',
      messages: [
        { role: 'user', content: 'Hola Marta, te llamo porque he visto que perdéis seguimientos. ¿Te importa que te haga una pregunta?' },
        { role: 'coach', content: 'Dime, tengo cinco minutos.' },
        { role: 'user', content: 'Entiendo. ¿Cuántas citas se caen al mes por el correo?' },
      ],
    }),
  });
  const data = await response.json() as { debrief?: { score?: number; axes?: Array<{ id: string; label: string }> }; detail?: string };
  expect(response.status, data.detail ?? 'la práctica debe puntuar').toBe(200);
  const axis = data.debrief?.axes?.find(item => item.id === 'apertura');
  return { score: data.debrief?.score ?? -1, label: axis?.label ?? '' };
}

test('el panel guarda de verdad, sobrevive a la recarga y ese peso cambia la nota y el feedback', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', message => {
    if (message.type() !== 'error') return;
    // La home intenta el motor local, que en esta prueba está apagado a propósito (CAREER_ENGINE_URL
    // apunta a un puerto cerrado). El 503 es un fallo de red esperado y la app lo declara; no es un
    // error de JavaScript del panel.
    if (/Failed to load resource: the server responded with a status of 503/.test(message.text())) return;
    consoleErrors.push(message.text());
  });
  page.on('pageerror', error => consoleErrors.push(error.message));

  await page.goto(`${base}/admin#practice`);
  await expect(page.getByRole('heading', { name: 'Los criterios de las salas.' })).toBeVisible();
  await expect(page.getByText(/Base local de desarrollo/)).toBeVisible();

  // 1) Las cinco salas y los pesos de la skill.
  for (const room of ['Closer · llamada de cierre', 'Setter · cualificación y agenda', 'Llamada en frío', 'Entrevista · contratación', 'Evaluación de llamadas']) {
    await expect(page.getByRole('tab', { name: room })).toBeVisible();
  }
  // Se localizan por id: al cambiar el nombre, las etiquetas accesibles («Peso de …») cambian con él.
  const weight = page.locator('#weight-apertura');
  await expect(weight).toHaveValue('10');
  await expect(page.getByText(/Los pesos activos suman 100/)).toBeVisible();
  await expect(page.locator('#source-apertura')).toHaveValue('analisis-llamadas-ventas');

  // 2) Editar nombre, peso y guía; el aviso de cambios sin guardar aparece.
  const name = page.locator('#axis-apertura');
  const guide = page.locator('#guide-apertura');
  await name.fill('Apertura con prueba social');
  await weight.fill('100');
  await guide.fill('Abre con una prueba de un caso idéntico y pide permiso antes de preguntar.');
  await expect(page.getByText('Cambios sin guardar')).toBeVisible();
  await expect(page.getByText(/Los pesos activos suman 190/)).toBeVisible();
  await page.getByRole('button', { name: 'Guardar criterios' }).click();
  await expect(page.getByText('Criterios guardados.')).toBeVisible();
  await expect(page.getByText('Cambios sin guardar')).toHaveCount(0);
  await expect(page.getByText('Historial de cambios')).toBeVisible();
  await expect(page.locator('.rubric-versions li').filter({ hasText: 'v1' })).toBeVisible();

  // 3) Recarga real: los tres campos siguen ahí.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Los criterios de las salas.' })).toBeVisible();
  await expect(page.locator('#weight-apertura')).toHaveValue('100');
  await expect(page.locator('#axis-apertura')).toHaveValue('Apertura con prueba social');
  await expect(page.locator('#guide-apertura')).toHaveValue(/prueba de un caso idéntico/);
  await expect(page.getByText('Cambios sin guardar')).toHaveCount(0);

  // 3b) El historial dice quién, cuándo y qué peso y guía cambiaron en cada versión.
  const version = page.locator('.rubric-versions>li').first();
  await expect(version).toContainText('v1');
  await version.locator('summary').click();
  await expect(version.locator('.rubric-diff')).toContainText('peso 10 → 100');
  await expect(version.locator('.rubric-diff')).toContainText('guía actualizada');

  // 4) Puntuación real después del cambio: 100 de apertura sobre 190 de peso total → 53.
  const changed = await score();
  expect(changed.score).toBe(53);
  expect(changed.label).toBe('Apertura con prueba social');

  // 5) Desactivar un criterio lo saca de la nota y persiste; reactivarlo lo devuelve.
  const ethics = page.getByLabel('Activar Rapport y ética');
  await ethics.uncheck();
  await expect(page.getByText('6/7')).toBeVisible();
  await expect(page.getByText(/Los pesos activos suman 185/)).toBeVisible();
  await page.getByRole('button', { name: 'Guardar criterios' }).click();
  await expect(page.getByText('Criterios guardados.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Los criterios de las salas.' })).toBeVisible();
  await expect(page.getByLabel('Activar Rapport y ética')).not.toBeChecked();
  await expect(page.getByText('6/7')).toBeVisible();
  await page.getByLabel('Activar Rapport y ética').check();
  await page.getByRole('button', { name: 'Guardar criterios' }).click();
  await expect(page.getByText('Criterios guardados.')).toBeVisible();

  // 6) La evaluación de llamadas tiene su propia rúbrica editable y versionada.
  await page.getByRole('tab', { name: 'Evaluación de llamadas' }).click();
  await expect(page.locator('#weight-apertura')).toHaveValue('10');
  await expect(page.locator('#source-apertura')).toHaveValue('analisis-llamadas-ventas');
  await page.locator('#axis-apertura').fill('Apertura de la llamada revisada');
  await page.locator('#weight-apertura').fill('100');
  await page.getByRole('button', { name: 'Guardar criterios' }).click();
  await expect(page.getByText('Criterios guardados.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Los criterios de las salas.' })).toBeVisible();
  await page.getByRole('tab', { name: 'Evaluación de llamadas' }).click();
  await expect(page.locator('#weight-apertura')).toHaveValue('100');
  await expect(page.locator('#axis-apertura')).toHaveValue('Apertura de la llamada revisada');

  // 7) BANT: activar una entrevista y comprobar que persiste.
  const interviewBant = page.getByLabel('Entrevista · contratación');
  await expect(interviewBant).not.toBeChecked();
  await interviewBant.check();
  await expect(page.getByText('Cambios sin guardar')).toBeVisible();
  await page.getByRole('button', { name: 'Guardar criterios' }).click();
  await expect(page.getByText('Criterios guardados.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Entrevista · contratación')).toBeChecked();

  // 7b) En el panel estrecho la tabla se apila en tarjetas: las etiquetas siguen visibles y la guía se lee
  // entera sin desplazamiento horizontal en el contenedor.
  await page.setViewportSize({ width: 390, height: 900 });
  const wrap = page.locator('.rubric-wrap');
  await expect(wrap).toBeVisible();
  expect(await wrap.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
  const wrapBox = (await wrap.boundingBox())!;
  const guideBox = (await page.locator('#guide-apertura').boundingBox())!;
  expect(guideBox.width).toBeGreaterThan(wrapBox.width - 60);
  await page.setViewportSize({ width: 1280, height: 900 });

  // 8) Reordenar y editar la corrección prioritaria; persiste tras recargar.
  await expect(page.locator('#priority-0')).toHaveValue(/pain cycle/);
  await page.getByRole('button', { name: 'Subir la prioridad 2' }).click();
  await expect(page.locator('#priority-0')).toHaveValue(/BANT, decisor o momento/);
  await page.locator('#priority-1').fill('Regla propia del panel para esta prueba.');
  await page.getByRole('button', { name: 'Guardar criterios' }).click();
  await expect(page.getByText('Criterios guardados.')).toBeVisible();
  await page.reload();
  await expect(page.locator('#priority-0')).toHaveValue(/BANT, decisor o momento/);
  await expect(page.locator('#priority-1')).toHaveValue('Regla propia del panel para esta prueba.');

  // 9) La misma configuración se aplica en el navegador: un roleplay real puntúa con el peso editado.
  await page.goto(base);
  await page.getByRole('button', { name: 'Práctica' }).click();
  await page.getByRole('tab', { name: 'Closer · voz' }).click();
  await page.locator('.practice-card').first().getByRole('button', { name: 'Practicar' }).click();
  const reply = page.getByLabel('Tu respuesta');
  await reply.fill('Hola Marta, te llamo porque he visto que perdéis seguimientos.');
  await page.getByRole('button', { name: 'Enviar respuesta' }).click();
  await reply.fill('Me interesa entender cómo gestionáis los seguimientos.');
  await page.getByRole('button', { name: 'Enviar respuesta' }).click();
  await expect(page.locator('.practice-turn.is-mine')).toHaveCount(2);
  await page.getByRole('button', { name: 'Terminar y ver feedback' }).click();
  await expect(page.getByRole('heading', { name: 'Qué ha funcionado y qué pulir.' })).toBeVisible();
  await expect(page.locator('.practice-score-total b')).toHaveText('53');
  await expect(page.getByText('Apertura con prueba social')).toBeVisible();
  await expect(page.getByText('Cerrar con día y hora.')).toBeVisible();

  // 10) La evaluación de una llamada real usa su propio criterio editado y la misma nota ponderada.
  await page.getByRole('button', { name: 'Elegir otra situación' }).click();
  await page.getByRole('button', { name: 'Revisión de llamada' }).click();
  await page.getByLabel('Transcripción').fill([
    'VENDEDOR: Hola, te llamo por el formulario que dejaste. ¿Te importa que te haga una pregunta?',
    'CLIENTE: Dime, tengo cinco minutos.',
    'VENDEDOR: ¿Qué te hizo buscar una solución ahora?',
    'CLIENTE: Se me caen diez citas al mes y cada una vale 2.000 euros.',
  ].join('\n'));
  await page.getByRole('button', { name: 'Evaluar llamada' }).click();
  await expect(page.getByRole('heading', { name: 'Qué pasó en la llamada.' })).toBeVisible();
  await expect(page.locator('.practice-score-total b')).toHaveText('53');
  await expect(page.getByText('Apertura de la llamada revisada')).toBeVisible();
  await expect(page.getByText('LA CORRECCIÓN PRIORITARIA · UNA SOLA')).toBeVisible();

  // 11) Restaurar una versión anterior crea una nueva y devuelve la rúbrica de llamada a 10.
  await page.goto(`${base}/admin#practice`);
  page.once('dialog', dialog => void dialog.accept());
  await page.locator('.rubric-versions li').filter({ hasText: 'v1' }).getByRole('button', { name: 'Restaurar' }).click();
  await expect(page.getByText(/Versión 1 restaurada como versión \d+/)).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: 'Evaluación de llamadas' }).click();
  await expect(page.locator('#weight-apertura')).toHaveValue('10');

  // 12) Restaurar vuelve a los pesos de las skills y también cambia la nota (10 sobre 100 → 10).
  page.once('dialog', dialog => void dialog.accept());
  await page.getByRole('button', { name: 'Restaurar los de las skills' }).click();
  await expect(page.getByText('Restaurados los criterios por defecto')).toBeVisible();
  await page.reload();
  await expect(page.locator('#weight-apertura')).toHaveValue('10');
  await expect(page.getByLabel('Entrevista · contratación')).not.toBeChecked();
  await expect(page.locator('#priority-0')).toHaveValue(/pain cycle/);
  const restored = await score();
  expect(restored.score).toBe(10);
  expect(restored.label).toBe('Apertura y agenda');

  expect(consoleErrors).toEqual([]);
});
