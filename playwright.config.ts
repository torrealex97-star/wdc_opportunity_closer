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
const workers = Number(process.env.PLAYWRIGHT_WORKERS) || 4;

export default defineConfig({
  testDir: './tests/browser',
  workers,
  use: {
    baseURL: 'http://127.0.0.1:3100',
    headless: true,
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    launchOptions: { executablePath: process.env.PLAYWRIGHT_EXECUTABLE || undefined },
  },
  timeout: 30000,
});
