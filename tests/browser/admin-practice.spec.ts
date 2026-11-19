import { test, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
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

test.beforeAll(async () => {
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
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(modelDebrief) } }] }));
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
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  if (distDir) rmSync(path.join(process.cwd(), 'apps/web', distDir), { recursive: true, force: true });
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
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('pageerror', error => consoleErrors.push(error.message));

  await page.goto(`${base}/admin#practice`);
  await expect(page.getByRole('heading', { name: 'Los criterios de las salas.' })).toBeVisible();
  await expect(page.getByText(/Base local de desarrollo/)).toBeVisible();

  // 1) Las cinco salas y los pesos de la skill.
  for (const room of ['Closer · llamada de cierre', 'Setter · cualificación y agenda', 'Llamada en frío', 'Entrevista · criterios generales', 'Entrevista · rúbrica WDC']) {
    await expect(page.getByRole('tab', { name: room })).toBeVisible();
  }
  // Se localizan por id: al cambiar el nombre, las etiquetas accesibles («Peso de …») cambian con él.
  const weight = page.locator('#weight-apertura');
  await expect(weight).toHaveValue('10');
  await expect(page.getByText(/Los pesos suman 100/)).toBeVisible();

  // 2) Editar nombre, peso y guía; el aviso de cambios sin guardar aparece.
  const name = page.locator('#axis-apertura');
  const guide = page.locator('#guide-apertura');
  await name.fill('Apertura con prueba social');
  await weight.fill('100');
  await guide.fill('Abre con una prueba de un caso idéntico y pide permiso antes de preguntar.');
  await expect(page.getByText('Cambios sin guardar')).toBeVisible();
  await expect(page.getByText(/Los pesos suman 190/)).toBeVisible();
  await page.getByRole('button', { name: 'Guardar criterios' }).click();
  await expect(page.getByText('Criterios guardados.')).toBeVisible();
  await expect(page.getByText('Cambios sin guardar')).toHaveCount(0);

  // 3) Recarga real: los tres campos siguen ahí.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Los criterios de las salas.' })).toBeVisible();
  await expect(page.locator('#weight-apertura')).toHaveValue('100');
  await expect(page.locator('#axis-apertura')).toHaveValue('Apertura con prueba social');
  await expect(page.locator('#guide-apertura')).toHaveValue(/prueba de un caso idéntico/);
  await expect(page.getByText('Cambios sin guardar')).toHaveCount(0);

  // 4) Puntuación real después del cambio: 100 de apertura sobre 190 de peso total → 53.
  const changed = await score();
  expect(changed.score).toBe(53);
  expect(changed.label).toBe('Apertura con prueba social');

  // 5) Añadir hasta el límite de 8; el botón se bloquea y quitar devuelve la rúbrica a 7.
  await page.getByRole('button', { name: 'Añadir criterio' }).click();
  await expect(page.locator('input[id^="axis-"]')).toHaveCount(8);
  await expect(page.getByRole('button', { name: 'Añadir criterio' })).toBeDisabled();
  await page.getByRole('button', { name: 'Quitar Nuevo criterio' }).click();
  await expect(page.locator('input[id^="axis-"]')).toHaveCount(7);
  await page.getByRole('button', { name: 'Guardar criterios' }).click();
  await expect(page.getByText('Criterios guardados.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Los criterios de las salas.' })).toBeVisible();
  await expect(page.locator('input[id^="axis-"]')).toHaveCount(7);

  // 6) BANT: activar una entrevista y comprobar que persiste.
  const interviewBant = page.getByLabel('Entrevista · criterios generales');
  await expect(interviewBant).not.toBeChecked();
  await interviewBant.check();
  await expect(page.getByText('Cambios sin guardar')).toBeVisible();
  await page.getByRole('button', { name: 'Guardar criterios' }).click();
  await expect(page.getByText('Criterios guardados.')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Entrevista · criterios generales')).toBeChecked();

  // 7) Reordenar y editar la corrección prioritaria; persiste tras recargar.
  await expect(page.locator('#priority-0')).toHaveValue(/pain cycle/);
  await page.getByRole('button', { name: 'Subir la prioridad 2' }).click();
  await expect(page.locator('#priority-0')).toHaveValue(/BANT, decisor o momento/);
  await page.locator('#priority-1').fill('Regla propia del panel para esta prueba.');
  await page.getByRole('button', { name: 'Guardar criterios' }).click();
  await expect(page.getByText('Criterios guardados.')).toBeVisible();
  await page.reload();
  await expect(page.locator('#priority-0')).toHaveValue(/BANT, decisor o momento/);
  await expect(page.locator('#priority-1')).toHaveValue('Regla propia del panel para esta prueba.');

  // 8) Restaurar vuelve a los pesos de las skills y también cambia la nota (10 sobre 100 → 10).
  page.once('dialog', dialog => void dialog.accept());
  await page.getByRole('button', { name: 'Restaurar los de las skills' }).click();
  await expect(page.getByText('Restaurados los criterios por defecto')).toBeVisible();
  await page.reload();
  await expect(page.locator('#weight-apertura')).toHaveValue('10');
  await expect(page.getByLabel('Entrevista · criterios generales')).not.toBeChecked();
  await expect(page.locator('#priority-0')).toHaveValue(/pain cycle/);
  const restored = await score();
  expect(restored.score).toBe(10);
  expect(restored.label).toBe('Apertura y agenda');

  expect(consoleErrors).toEqual([]);
});
