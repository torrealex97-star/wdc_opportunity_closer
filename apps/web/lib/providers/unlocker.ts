import { resolveBrightDataConfig, unlockHtml, BrightDataError } from './brightdata';

// Proveedores que devuelven el HTML de una página (no una lista estructurada). Se usan SOLO donde ya
// existe un extractor probado —JSON-LD `JobPosting` o RSS—, nunca como sustituto de un portal que la app
// no sabe leer. Dos presets documentados: ZenRows y ScrapingBee (una petición GET con `url` + clave).
// Ninguno se marca «operativo» sin una llamada real; el panel enseña su estado real de clave.

export type UnlockerProvider = 'brightdata' | 'zenrows' | 'scrapingbee';

export type UnlockerPreset = {
  id: UnlockerProvider;
  name: string;
  usdPerRequest: number;
  docs: string;
  /** Lo que hay que pegar en el panel. */
  secretHint: string;
  /** ZenRows y ScrapingBee construyen la URL; Bright Data usa su propio cliente y no la necesita. */
  build?: (secret: string, url: string) => string;
};

export const UNLOCKER_PRESETS: Record<UnlockerProvider, UnlockerPreset> = {
  brightdata: {
    id: 'brightdata',
    name: 'Bright Data · Web Unlocker',
    usdPerRequest: 0.0015,
    docs: 'https://docs.brightdata.com/products/web-unlocker/quickstart',
    secretHint: 'API key:zona SERP:zona Unlocker',
  },
  zenrows: {
    id: 'zenrows',
    name: 'ZenRows',
    usdPerRequest: 0.002,
    docs: 'https://www.zenrows.com/documentation',
    secretHint: 'API key de ZenRows',
    build: (secret, url) => `https://api.zenrows.com/v1/?apikey=${encodeURIComponent(secret)}&url=${encodeURIComponent(url)}&js_render=true`,
  },
  scrapingbee: {
    id: 'scrapingbee',
    name: 'ScrapingBee',
    usdPerRequest: 0.002,
    docs: 'https://www.scrapingbee.com/documentation/',
    secretHint: 'API key de ScrapingBee',
    build: (secret, url) => `https://app.scrapingbee.com/api/v1/?api_key=${encodeURIComponent(secret)}&url=${encodeURIComponent(url)}&render_js=true`,
  },
};

export type HtmlResult = { html: string; requests: number; costUsd: number };

/**
 * Trae el HTML de una URL con el proveedor elegido. Bright Data exige la zona del Unlocker en su
 * secreto (`API key:zona SERP:zona Unlocker`); ZenRows y ScrapingBee llevan la clave en la URL.
 */
export async function fetchHtml(
  provider: UnlockerProvider,
  secret: string,
  url: string,
  options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<HtmlResult> {
  if (!/^https:\/\//i.test(url)) throw new BrightDataError('Solo se leen páginas HTTPS públicas', 422);
  const { timeoutMs = 20_000, fetchImpl = fetch } = options;
  if (provider === 'brightdata') {
    // La API key sola es válida: la zona del Unlocker se descubre en la cuenta (gratis) si no vino escrita.
    const { config } = await resolveBrightDataConfig(secret, { timeoutMs, fetchImpl, useCache: false });
    if (!config) throw new BrightDataError('Formato de clave de Bright Data incorrecto', 422);
    return unlockHtml(config, url, { timeoutMs, fetchImpl });
  }
  const preset = UNLOCKER_PRESETS[provider];
  const target = preset.build!(secret, url);
  let last: BrightDataError | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    let response: Response;
    try {
      response = await fetchImpl(target, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      last = new BrightDataError(`No se pudo contactar con ${preset.name}: ${(err as Error).message}`, null, attempt);
      if (attempt === 1) continue;
      throw last;
    }
    const text = await response.text().catch(() => '');
    // Se cobra por intento: el tope reserva los dos antes de lanzar.
    if (response.ok && text.trim()) return { html: text, requests: attempt, costUsd: attempt * preset.usdPerRequest };
    const retryable = response.status === 429 || response.status >= 500;
    last = new BrightDataError(`${preset.name} respondió HTTP ${response.status}${text ? `: ${text.slice(0, 160)}` : ''}`, response.status, attempt);
    if (!retryable || attempt === 2) throw last;
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  throw last ?? new BrightDataError(`${preset.name} no respondió`, null, 2);
}

export const unlockerProvider = (value: unknown): value is UnlockerProvider =>
  typeof value === 'string' && value in UNLOCKER_PRESETS;
