import { decryptSecret, encryptSecret } from './secrets';
import { serviceRest } from './supabaseAuth';
import { recordSpend, runsThisMonth } from './external';
import { canSpend, PROVIDER_METERS, spendNote, spentFromNotes, type MeteredProvider } from './providerBudget';
import { readCaps } from './providerCaps';
import { googleJobsUrl, parseBrightDataSecret, unwrapBody } from './providers/brightdata';

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
  // Bright Data: la clave se guarda como `API key:zona SERP[:zona Unlocker]`. La prueba hace UNA búsqueda
  // real de Google Jobs (0,0015 USD) porque no hay endpoint de cuenta documentado que valide la zona;
  // se avisa en la tarjeta y no se ejecuta nunca al guardar.
  brightdata: {
    name: 'Bright Data',
    hint: 'API key:zona SERP (y :zona Unlocker si la tienes)',
    probe: (k: string) => {
      const config = parseBrightDataSecret(k);
      if (!config) return Promise.resolve(new Response(null, { status: 400 }));
      return fetch(`${process.env.BRIGHTDATA_API_BASE ?? 'https://api.brightdata.com'}/request`, {
        method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(20000),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
        // `format: raw` + `brd_json=1` en la URL: es lo que devuelve el JSON parseado (contrato de su documentación).
        body: JSON.stringify({ zone: config.serpZone, url: googleJobsUrl('closer de ventas'), format: 'raw' }),
      });
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

export async function testConnection(provider: Provider): Promise<{ ok: boolean; detail: string } | null> {
  const row = await serviceRest(`integration_connections?provider=eq.${provider}&select=secret_ciphertext&limit=1`);
  const rows = row.ok ? await row.json().catch(() => []) : [];
  if (!Array.isArray(rows) || !rows[0]) return null;
  let outcome: { ok: boolean; detail: string } = { ok: false, detail: 'No se pudo probar el proveedor.' };
  try {
    const secret = decryptSecret(rows[0].secret_ciphertext);
    if (SPEND_PROBES.has(provider)) {
      const meter = provider as MeteredProvider;
      // La prueba hace una petición real: antes de lanzarla se comprueba el tope y, si responde, se anota
      // el gasto en `external_ingest_runs` para que el marcador lo sume. Sin nota no se da por contado.
      const runs = await runsThisMonth();
      const spent = runs === null ? null : (spentFromNotes(runs.map(run => ({ note: run.note })), meter).usd ?? 0);
      const check = canSpend(meter, spent, process.env, (await readCaps()).caps[meter].usd);
      if (!check.ok) {
        outcome = { ok: false, detail: check.reason ?? 'No se puede gastar ahora.' };
      } else {
        const response = await PROVIDERS[provider].probe(secret);
        if (provider === 'brightdata' && response.status === 400) {
          outcome = { ok: false, detail: 'Formato incorrecto: usa API key:zona SERP' };
        } else if (!response.ok) {
          outcome = response.status === 401 || response.status === 403
            ? { ok: false, detail: `Clave rechazada (HTTP ${response.status})` }
            : { ok: false, detail: `El proveedor respondió HTTP ${response.status}` };
        } else {
          let failure: string | null = null;
          if (provider === 'brightdata') {
            const text = await response.clone().text().catch(() => '');
            const payload = unwrapBody(text);
            // Clave y zona valen si vuelve JSON parseado. Que Google no muestre el panel de empleos para esta
            // consulta no invalida la clave: solo se declara. HTML o un `error` sí son un fallo.
            if (!payload) failure = 'Bright Data devolvió HTML y no JSON parseado: revisa que la zona sea de SERP API.';
            else if (typeof payload.error === 'string' && payload.error) failure = `Bright Data: ${payload.error.slice(0, 160)}`;
          }
          if (failure) {
            outcome = { ok: false, detail: failure };
          } else {
            const cost = PROVIDER_METERS[meter].usdPerRequest;
            const recorded = await recordSpend(`${provider}-probe`, 'probe', spendNote({ route: 'prueba', provider: meter, requests: 1, costUsd: cost, detail: 'prueba de clave' }));
            outcome = recorded
              ? { ok: true, detail: `Clave válida · 1 petición de prueba (${cost.toFixed(4).replace('.', ',')} USD anotada)` }
              : { ok: false, detail: 'La clave respondió, pero no se pudo anotar el gasto; no se vuelve a probar hasta reparar el historial.' };
          }
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
