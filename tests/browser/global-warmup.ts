import type { FullConfig } from '@playwright/test';

// `next dev` compila cada ruta la primera vez que la piden. Con la suite en paralelo, cuatro workers pueden
// pedir `/` y `/admin` a la vez y el primero que llega paga la compilación dentro de su propio tiempo de
// prueba: en una máquina lenta eso agota el `timeout` de la prueba y aparece un rojo que no es del producto
// (pasó con «Formación», «Guardar …», el checkbox de BANT y el setup de fuente). Este paso previo pide esas
// rutas en serie, una sola vez, antes de que arranque ningún worker: cada prueba empieza con el servidor ya
// caliente y su tiempo solo mide lo suyo.
const ROUTES = ['/', '/admin', '/api/backend/config', '/api/student/session'];
const ATTEMPT_MS = 90_000;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export default async function globalWarmup(config: FullConfig) {
  const baseURL = config.projects[0]?.use?.baseURL ?? 'http://127.0.0.1:3100';
  for (const route of ROUTES) {
    const url = new URL(route, baseURL).toString();
    const started = Date.now();
    let last = '';
    // El servidor de desarrollo puede no estar listo al arrancar la suite: se reintenta hasta el tope.
    while (Date.now() - started < ATTEMPT_MS) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(ATTEMPT_MS), redirect: 'manual' });
        if (response.status < 500) {
          // Se consume el cuerpo para que la compilación termine antes de pasar a la siguiente ruta.
          await response.text();
          console.log(`[warmup] ${route} ${response.status} en ${Date.now() - started} ms`);
          last = '';
          break;
        }
        last = `HTTP ${response.status}`;
      } catch (error) {
        last = error instanceof Error ? error.message : String(error);
      }
      await sleep(2_000);
    }
    if (last) throw new Error(`[warmup] ${url} no respondió en ${ATTEMPT_MS} ms (${last}). ¿Está ` + '`npm run dev` en el puerto 3100? La suite no lo arranca sola.');
  }
}
