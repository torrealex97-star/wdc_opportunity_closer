import { decryptSecret, encryptSecret } from './secrets';
import { serviceRest } from './supabaseAuth';
import { recordSpend, runsThisMonth } from './external';
import { canSpend, PROVIDER_METERS, spendNote, spentFromNotes, type MeteredProvider } from './providerBudget';
import { parseBrightDataSecret, resolveBrightDataConfig, serpProbeRequest, unwrapPayload, type BrightDataZone } from './providers/brightdata';

// Conexiones con proveedores externos. Las comprobaciones usan SOLO endpoints gratuitos que no gastan
// crédito (listar modelos, ver cuenta): probar una conexión nunca cuesta dinero. Guardar una clave no
// activa gasto: el motor cloud público no usa proveedores de pago (se activan aparte, con orden explícita).
const bearer = (k: string) => ({ Authorization: `Bearer ${k}` });
const basic = (id: string, secret: string) => ({ Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}` });
const pair = (k: string) => { const i = k.indexOf(':'); return i > 0 ? [k.slice(0, i), k.slice(i + 1)] as const : null; };
const get = (url: string, headers?: Record<string, string>) => fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000), headers });

// `probe` hace una llamada gratuita o de coste nulo; `hint` explica el formato de la clave en el panel.
export const PROVIDERS = {
  apify: { name: 'Apify', hint: 'Token de API', probe: (k: string) => get(`${process.env.APIFY_API_BASE ?? 'https://api.apify.com'}/v2/users/me`, bearer(k)) },
  serpapi: { name: 'SerpApi', hint: 'API key', probe: (k: string) => get(`${process.env.SERPAPI_API_BASE ?? 'https://serpapi.com'}/account.json?api_key=${encodeURIComponent(k)}`) },
  groq: { name: 'Groq', hint: 'API key', probe: (k: string) => get(`${process.env.GROQ_API_BASE ?? 'https://api.groq.com'}/openai/v1/models`, bearer(k)) },
  openai: { name: 'OpenAI', hint: 'API key', probe: (k: string) => get(`${process.env.OPENAI_API_BASE ?? 'https://api.openai.com'}/v1/models`, bearer(k)) },
  adzuna: { name: 'Adzuna', hint: 'app_id:app_key (separados por dos puntos)', probe: (k: string) => { const p = pair(k); return p ? get(`${process.env.ADZUNA_API_BASE ?? 'https://api.adzuna.com'}/v1/api/jobs/es/search/1?app_id=${encodeURIComponent(p[0])}&app_key=${encodeURIComponent(p[1])}&results_per_page=1`) : Promise.resolve(new Response(null, { status: 400 })); } },
  jooble: { name: 'Jooble', hint: 'Clave de es.jooble.org (España)', probe: (k: string) => fetch(`${process.env.JOOBLE_API_BASE ?? 'https://es.jooble.org'}/api/${encodeURIComponent(k)}`, { method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keywords: 'closer', location: 'España', page: 1 }) }) },
  infojobs: { name: 'InfoJobs', hint: 'client_id:client_secret (separados por dos puntos)', probe: (k: string) => { const p = pair(k); return p ? get(`${process.env.INFOJOBS_API_BASE ?? 'https://api.infojobs.net'}/api/9/offer?maxResults=1`, basic(p[0], p[1])) : Promise.resolve(new Response(null, { status: 400 })); } },
  resend: { name: 'Resend', hint: 'API key (empieza por re_)', probe: (k: string) => get(`${process.env.RESEND_API_BASE ?? 'https://api.resend.com'}/domains`, bearer(k)) },
  // Bright Data: se pega solo la API key (Cuenta → API keys); las zonas se descubren con
  // `GET /zone/get_active_zones`, que es gratis, y también se acepta `API key:zona SERP[:zona Unlocker]`
  // para fijarlas a mano. La prueba hace UNA búsqueda real de Google Jobs (0,0015 USD) solo después de
  // haber validado clave y zona sin gastar; se avisa en la tarjeta y nunca se ejecuta al guardar.
  brightdata: {
    name: 'Bright Data',
    hint: 'API key (la zona SERP se detecta sola); también API key:zona SERP[:zona Unlocker]',
    probe: async (k: string) => {
      const { config } = await resolveBrightDataConfig(k);
      if (!config?.serpZone) return new Response(JSON.stringify({ detail: 'Sin zona SERP' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      return serpProbeRequest(config);
    },
  },
  // ZenRows y ScrapingBee: una página de prueba por el proxy. También cuesta una petición (~0,002 USD).
  zenrows: { name: 'ZenRows', hint: 'API key de ZenRows', probe: (k: string) => get(`https://api.zenrows.com/v1/?apikey=${encodeURIComponent(k)}&url=${encodeURIComponent('https://example.com')}`) },
  scrapingbee: { name: 'ScrapingBee', hint: 'API key de ScrapingBee', probe: (k: string) => get(`https://app.scrapingbee.com/api/v1/?api_key=${encodeURIComponent(k)}&url=${encodeURIComponent('https://example.com')}`) },
} as const;

/** Proveedores cuya prueba hace una petición real y se cobra (se avisa en la tarjeta). */
export const SPEND_PROBES: ReadonlySet<Provider> = new Set<Provider>(['brightdata', 'zenrows', 'scrapingbee']);
export type Provider = keyof typeof PROVIDERS;
// `in` también acepta nombres heredados del prototipo (`toString`, `constructor`): se comprueba que la clave
// sea propia, o el panel guardaría filas para un proveedor que no existe.
export const isProvider = (v: unknown): v is Provider =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(PROVIDERS, v);

export type ConnectionRow = { provider: Provider; last4: string; updated_by: string; updated_at: string; last_test_at: string | null; last_test_ok: boolean | null; last_test_detail: string | null };

export async function listConnections(): Promise<ConnectionRow[] | null> {
  const response = await serviceRest('integration_connections?select=provider,last4,updated_by,updated_at,last_test_at,last_test_ok,last_test_detail');
  const rows = response.ok ? await response.json().catch(() => null) : null;
  return Array.isArray(rows) ? rows : null;
}

/** Últimos 4 de la CLAVE, no de la zona: Bright Data se guarda como `API key:zona SERP[:zona Unlocker]`. */
const last4Of = (provider: Provider, secret: string) =>
  (provider === 'brightdata' ? secret.split(':')[0] : secret).slice(-4);

export async function saveConnection(provider: Provider, secret: string, by: string): Promise<boolean> {
  const response = await serviceRest('integration_connections?on_conflict=provider', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ provider, secret_ciphertext: encryptSecret(secret), last4: last4Of(provider, secret), updated_by: by, updated_at: new Date().toISOString(), last_test_at: null, last_test_ok: null, last_test_detail: null }),
  });
  return response.ok;
}

export async function deleteConnection(provider: Provider): Promise<boolean> {
  return (await serviceRest(`integration_connections?provider=eq.${provider}`, { method: 'DELETE' })).ok;
}

export async function getSecret(provider: Provider): Promise<string | null> {
  const response = await serviceRest(`integration_connections?provider=eq.${provider}&select=secret_ciphertext&limit=1`);
  const rows = response.ok ? await response.json().catch(() => []) : [];
  try { return Array.isArray(rows) && rows[0] ? decryptSecret(rows[0].secret_ciphertext) : null; } catch { return null; }
}

const describeZones = (zones: BrightDataZone[]) =>
  zones.length ? zones.map(zone => `${zone.name} (${zone.type ?? 'tipo no indicado'})`).join(', ') : 'ninguna';

/**
 * Prueba de Bright Data en dos pasos: primero valida clave y zona con la API de cuenta (`GET
 * /zone/get_active_zones`, gratis) y solo después hace la búsqueda real que se cobra. Antes se exigía el
 * formato `API key:zona SERP` y cualquier fallo se anunciaba como «clave rechazada», incluso con la clave
 * correcta: ahora se acepta la API key sola y cada fallo declara su causa (clave, zona o respuesta).
 */
async function testBrightDataConnection(secret: string): Promise<{ ok: boolean; detail: string }> {
  const parsed = parseBrightDataSecret(secret);
  if (!parsed) return { ok: false, detail: 'Formato incorrecto: pega la API key de Bright Data (vale también API key:zona SERP).' };
  const resolved = await resolveBrightDataConfig(secret);
  if (!resolved.config) return { ok: false, detail: 'Formato incorrecto: pega la API key de Bright Data.' };
  // Una zona fijada a mano que la cuenta no tiene se declara sin gastar crédito.
  if (resolved.zones && parsed.serpZone && !resolved.zones.some(zone => zone.name === parsed.serpZone)) {
    return { ok: false, detail: `La clave es válida, pero la zona «${parsed.serpZone}» no está activa. Zonas de la cuenta: ${describeZones(resolved.zones)}.` };
  }
  const config = resolved.config;
  if (!config.serpZone) {
    return {
      ok: false,
      detail: resolved.error
        ? `La clave tiene el formato correcto, pero no se pudieron leer las zonas activas (${resolved.error}). Pega la clave como API key:zona SERP.`
        : 'La clave es válida, pero la cuenta no tiene una zona SERP activa: crea la de SERP API en Bright Data y vuelve a probar.',
    };
  }
  const zone = resolved.zones?.find(item => item.name === config.serpZone);
  if (zone?.type && !/^serp/i.test(zone.type)) {
    return { ok: false, detail: `La zona «${config.serpZone}» es de tipo ${zone.type}, no SERP: Google Jobs solo responde por una zona SERP API. Zonas: ${describeZones(resolved.zones ?? [])}.` };
  }
  // La búsqueda real se cobra: tope e historial primero, igual que en cualquier otro gasto.
  const runs = await runsThisMonth();
  const spent = runs === null ? null : (spentFromNotes(runs.map(run => ({ note: run.note })), 'brightdata').usd ?? 0);
  const check = canSpend('brightdata', spent);
  if (!check.ok) return { ok: false, detail: check.reason ?? 'No se puede gastar ahora.' };
  let response: Response;
  try {
    response = await serpProbeRequest(config);
  } catch (err) {
    return { ok: false, detail: `No se pudo contactar con Bright Data: ${(err as Error).message}` };
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let detail = text.slice(0, 160);
    try {
      const body = JSON.parse(text) as Record<string, unknown>;
      const message = [body.error, body.detail, body.message].find(value => typeof value === 'string') as string | undefined;
      if (message) detail = message.slice(0, 160);
    } catch { /* respuesta sin JSON: se enseña el texto tal cual */ }
    if (response.status === 401 || response.status === 403) {
      return { ok: false, detail: `Bright Data rechazó la clave (HTTP ${response.status})${detail ? `: ${detail}` : ''}` };
    }
    return { ok: false, detail: `Bright Data respondió HTTP ${response.status}${detail ? `: ${detail}` : ''} (la clave y la zona sí pasaron la comprobación de cuenta).` };
  }
  // El 200 ya se pagó aunque el cuerpo no sirva: se anota SIEMPRE antes de validar el contenido.
  const cost = PROVIDER_METERS.brightdata.usdPerRequest;
  const recorded = await recordSpend('brightdata-probe', 'probe', spendNote({ route: 'prueba', provider: 'brightdata', requests: 1, costUsd: cost, detail: 'prueba de clave' }));
  let payload: Record<string, unknown> | null = null;
  try {
    const unwrapped = unwrapPayload(JSON.parse(await response.text()));
    payload = unwrapped && typeof unwrapped === 'object' && !Array.isArray(unwrapped) ? unwrapped as Record<string, unknown> : null;
  } catch { /* cuerpo sin JSON */ }
  const jobs = payload?.jobs && typeof payload.jobs === 'object' ? (payload.jobs as Record<string, unknown>).items : null;
  const failure = typeof payload?.error === 'string' && payload.error
    ? `Bright Data: ${payload.error.slice(0, 160)}`
    : !Array.isArray(jobs)
      ? 'La clave y la zona son válidas (HTTP 200), pero la respuesta no trae jobs.items[]: comprueba que la zona sea SERP API.'
      : null;
  if (!recorded) return { ok: false, detail: 'La clave respondió, pero no se pudo anotar el gasto; no se vuelve a probar hasta reparar el historial.' };
  return failure ? { ok: false, detail: failure } : { ok: true, detail: `Clave válida · 1 petición de prueba (${cost.toFixed(4).replace('.', ',')} USD anotada)` };
}

export async function testConnection(provider: Provider): Promise<{ ok: boolean; detail: string } | null> {
  const row = await serviceRest(`integration_connections?provider=eq.${provider}&select=secret_ciphertext&limit=1`);
  const rows = row.ok ? await row.json().catch(() => []) : [];
  if (!Array.isArray(rows) || !rows[0]) return null;
  let outcome: { ok: boolean; detail: string } = { ok: false, detail: 'No se pudo probar el proveedor.' };
  try {
    const secret = decryptSecret(rows[0].secret_ciphertext);
    if (provider === 'brightdata') {
      outcome = await testBrightDataConnection(secret);
    } else if (SPEND_PROBES.has(provider)) {
      const meter = provider as MeteredProvider;
      // La prueba hace una petición real: antes de lanzarla se comprueba el tope y, si responde, se anota
      // el gasto en `external_ingest_runs` para que el marcador lo sume. Sin nota no se da por contado.
      const runs = await runsThisMonth();
      const spent = runs === null ? null : (spentFromNotes(runs.map(run => ({ note: run.note })), meter).usd ?? 0);
      const check = canSpend(meter, spent);
      if (!check.ok) {
        outcome = { ok: false, detail: check.reason ?? 'No se puede gastar ahora.' };
      } else {
        const response = await PROVIDERS[provider].probe(secret);
        if (!response.ok) {
          outcome = response.status === 401 || response.status === 403
            ? { ok: false, detail: `Clave rechazada (HTTP ${response.status})` }
            : { ok: false, detail: `El proveedor respondió HTTP ${response.status}` };
        } else {
          // El HTTP 200 ya se pagó aunque el cuerpo no sirva: se anota SIEMPRE antes de validar.
          const cost = PROVIDER_METERS[meter].usdPerRequest;
          const recorded = await recordSpend(`${provider}-probe`, 'probe', spendNote({ route: 'prueba', provider: meter, requests: 1, costUsd: cost, detail: 'prueba de clave' }));
          outcome = recorded
            ? { ok: true, detail: `Clave válida · 1 petición de prueba (${cost.toFixed(4).replace('.', ',')} USD anotada)` }
            : { ok: false, detail: 'La clave respondió, pero no se pudo anotar el gasto; no se vuelve a probar hasta reparar el historial.' };
        }
      }
    } else {
      const response = await PROVIDERS[provider].probe(secret);
      // Una clave de Resend restringida a «solo envío» es válida pero no puede listar dominios: responde 401 `restricted_api_key`.
      const restricted = provider === 'resend' && response.status === 401 && (await response.clone().json().catch(() => null))?.name === 'restricted_api_key';
      outcome = response.status === 400 && (provider === 'adzuna' || provider === 'infojobs') ? { ok: false, detail: 'Formato de clave incorrecto (usa id:clave)' }
        : restricted ? { ok: true, detail: 'Clave válida (permiso solo de envío)' }
        : response.ok ? { ok: true, detail: 'Clave válida' }
        : response.status === 401 || response.status === 403 ? { ok: false, detail: `Clave rechazada (HTTP ${response.status})` }
        : { ok: false, detail: `El proveedor respondió HTTP ${response.status}` };
    }
  } catch { outcome = { ok: false, detail: 'No se pudo contactar con el proveedor' }; }
  await serviceRest(`integration_connections?provider=eq.${provider}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ last_test_at: new Date().toISOString(), last_test_ok: outcome.ok, last_test_detail: outcome.detail }),
  });
  return outcome;
}
