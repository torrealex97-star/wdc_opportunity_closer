import { defineConfig } from '@playwright/test';
// Un solo worker: todas las pruebas comparten el mismo servidor de desarrollo y algunas escriben su
// configuración; en paralelo se pisan entre ellas (y la prueba de criterios arranca su propio Next).
export default defineConfig({ testDir: './tests/browser', workers: 1, use: { baseURL: 'http://127.0.0.1:3100', headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || undefined, launchOptions: { executablePath: process.env.PLAYWRIGHT_EXECUTABLE || undefined } }, timeout: 30000 });
