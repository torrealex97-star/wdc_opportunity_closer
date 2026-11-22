import type { Candidate } from '../external';
import { jobsFromPayload } from './brightdata';

// RapidAPI: UNA clave (X-RapidAPI-Key) sirve para todas las APIs del marketplace a las que el propietario se
// suscriba; cada API se elige con la cabecera X-RapidAPI-Host. Solo se incluyen APIs de empleo cuya ruta, parámetros
// y forma de respuesta se leyeron en su documentación pública (2026-11-22); una API sin ruta verificada no entra.
// Un 403 de RapidAPI suele ser «no estás suscrito a esta API»: se declara como tal y se pasa a la siguiente.
// La respuesta se lee con el lector universal de empleos (cualquier forma JSON, nombres de campo de cualquier
// proveedor): nada se inventa y lo que no trae título y enlace no es oferta.

export type RapidApiJobApi = {
  id: string;
  label: string;
  host: string;
  path: string;
  docs: string;
  params: (query: string, gl: string) => Record<string, string>;
};

const COUNTRY: Record<string, string> = { es: 'Spain', mx: 'Mexico', co: 'Colombia', ar: 'Argentina', cl: 'Chile', pe: 'Peru', us: 'United States' };
const countryName = (gl: string) => COUNTRY[gl] ?? 'Spain';

export const RAPIDAPI_JOB_APIS: readonly RapidApiJobApi[] = [
  {
    // Documentado: GET /search · respuesta { status, request_id, data: [...] } con job_title, employer_name, job_apply_link.
    id: 'jsearch', label: 'JSearch (Google for Jobs)', host: 'jsearch.p.rapidapi.com', path: '/search',
    docs: 'https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch',
    params: (query, gl) => ({ query, page: '1', num_pages: '1', country: gl }),
  },
  {
    // Documentado: GET /v2/linkedin/search con query y location · campos title, companyName, location, applyUrl/linkedinUrl.
    id: 'jobsapi-linkedin', label: 'Jobs API · LinkedIn', host: 'jobs-api14.p.rapidapi.com', path: '/v2/linkedin/search',
    docs: 'https://rapidapi.com/Pat92/api/jobs-api14',
    params: (query, gl) => ({ query, location: countryName(gl), datePosted: 'week' }),
  },
  {
    // Documentado: GET /v2/indeed/search con query, location y countryCode.
    id: 'jobsapi-indeed', label: 'Jobs API · Indeed', host: 'jobs-api14.p.rapidapi.com', path: '/v2/indeed/search',
    docs: 'https://rapidapi.com/Pat92/api/jobs-api14',
    params: (query, gl) => ({ query, location: countryName(gl), countryCode: gl }),
  },
];

/** Coste por petición: depende del plan de cada API en RapidAPI; se usa una estimación prudente configurable. */
export const rapidApiUsdPerRequest = (env: NodeJS.ProcessEnv = process.env) => {
  const n = Number(env.RAPIDAPI_USD_PER_REQUEST);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.005;
};
export const rapidApiBase = (api: RapidApiJobApi, env: NodeJS.ProcessEnv = process.env) =>
  (env.RAPIDAPI_API_BASE ?? `https://${api.host}`).replace(/\/+$/, '');

export class RapidApiError extends Error {
  readonly status: number | null;
  /** RapidAPI respondió (aunque fuera un error): la petición pudo contarse en el plan. */
  readonly billed: boolean;
  constructor(message: string, status: number | null, billed = false) {
    super(message);
    this.name = 'RapidApiError';
    this.status = status;
    this.billed = billed;
  }
}

export type RapidApiResult = { api: string; candidates: Candidate[]; rawItems: number };

export async function rapidApiJobs(key: string, api: RapidApiJobApi, query: string, gl = 'es', options: { timeoutMs?: number; fetchImpl?: typeof fetch; now?: number } = {}): Promise<RapidApiResult> {
  const { timeoutMs = 15_000, fetchImpl = fetch, now = Date.now() } = options;
  const url = `${rapidApiBase(api)}${api.path}?${new URLSearchParams(api.params(query, gl)).toString()}`;
  let response: Response;
  try {
    response = await fetchImpl(url, { method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(timeoutMs), headers: { 'X-RapidAPI-Key': key, 'X-RapidAPI-Host': api.host } });
  } catch (err) {
    throw new RapidApiError(`No se pudo contactar con ${api.label}: ${(err as Error).message}`, null);
  }
  const text = await response.text().catch(() => '');
  if (response.status === 403) throw new RapidApiError(`${api.label}: sin suscripción en RapidAPI (HTTP 403). Suscríbete a esta API en rapidapi.com o se omite.`, 403);
  if (response.status === 401) throw new RapidApiError(`${api.label}: RapidAPI rechazó la clave (HTTP 401).`, 401);
  if (response.status === 429) throw new RapidApiError(`${api.label}: cuota del plan de RapidAPI agotada (HTTP 429).`, 429);
  if (!response.ok) throw new RapidApiError(`${api.label} respondió HTTP ${response.status}${text ? `: ${text.slice(0, 160)}` : ''}`, response.status, response.status < 500);
  let payload: unknown;
  try { payload = JSON.parse(text); } catch { throw new RapidApiError(`${api.label} devolvió algo que no es JSON.`, 200, true); }
  const record = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
  if (record.status === 'ERROR' || record.hasError === true) {
    const err = record.error && typeof record.error === 'object' ? (record.error as Record<string, unknown>).message : record.errors;
    throw new RapidApiError(`${api.label}: ${typeof err === 'string' ? err : JSON.stringify(err ?? 'error').slice(0, 160)}`, 200, true);
  }
  const candidates = jobsFromPayload(payload, now).map(c => ({ ...c, external_id: `ra-${api.id}-${c.external_id.replace(/^bd-/, '')}`, raw: { ...c.raw, provider: 'rapidapi', api: api.id } }));
  return { api: api.id, candidates, rawItems: candidates.length };
}
