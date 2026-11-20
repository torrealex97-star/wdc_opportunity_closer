import { defineConfig } from '@playwright/test';

// La suite corre en paralelo porque cada prueba que escribe aísla su estado:
//
// - `admin-practice.spec.ts` es la única que guarda configuración de verdad. Arranca su propio `next dev`
//   en un puerto libre, con `PRACTICE_DB_PATH` en un directorio temporal, `NEXT_DIST_DIR` propio por
//   ejecución (no comparte caché con el servidor del operador) y las claves de Supabase vacías; al
//   terminar borra su base y su caché y devuelve `next-env.d.ts` y `tsconfig.json` a su contenido
//   versionado, que Next reescribe al arrancar con otro distDir.
// - El resto declara sus escrituras con `page.route` (sesión de operador, configuración del panel,
//   actividad de la alumna, candidaturas) y guarda lo suyo en localStorage, que Playwright aísla por
//   contexto: cada prueba estrena navegador y no hereda nada de la anterior.
//
// Lo único que se comparte es el servidor de desarrollo, para lecturas (catálogo, fuentes, progreso) y
// el proxy al motor. Si una prueba necesita escribir ahí, no es paralelizable: dale su propio servidor
// como hace `admin-practice.spec.ts`. `PLAYWRIGHT_WORKERS` baja el paralelismo en una máquina lenta.
//
// Determinismo con 4 workers: `global-warmup.ts` compila `/` y `/admin` en serie antes de que arranque
// ningún worker, así que la compilación en frío de `next dev` no la paga la primera prueba que llega
// (era la causa de los rojos por carga en «Formación», el guardado de oportunidad, el checkbox de BANT
// y el setup de fuente). Los tiempos son de carga, no del producto: prueba 60 s y aserción 10 s, para
// que una máquina lenta tarde más sin convertir la lentitud en un falso rojo.
const workers = Number(process.env.PLAYWRIGHT_WORKERS) || 4;

export default defineConfig({
  testDir: './tests/browser',
  globalSetup: './tests/browser/global-warmup.ts',
  workers,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://127.0.0.1:3100',
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    launchOptions: { executablePath: process.env.PLAYWRIGHT_EXECUTABLE || undefined },
  },
  timeout: 30000,
});
