// Lectura y escritura de la configuración de rúbricas (tabla `practice_rubrics`, solo service role).
// Un hueco no es un cero: si la tabla no está migrada o Supabase no responde, se juega con los valores
// por defecto y se DECLARA (`source: 'defaults'` + `reason`), nunca se finge que está guardado.
import { ORG } from './external';
import { allowlistConfigured, serviceRest } from './supabaseAuth';
import { deleteLocalConfig, readLocalConfig, writeLocalConfig } from './practiceLocalDb';
import {
  DEFAULT_BANT, DEFAULT_PRIORITIES, DEFAULT_RUBRICS,
  validateBant, validatePriorities, validateRubrics,
  type BantConfig, type RoomRubrics,
} from './practiceRubrics';

const TABLE = 'practice_rubrics';
const COLUMNS = 'rubrics,priorities,bant,updated_at,updated_by';
const TTL_MS = 20_000;

export type PracticeConfig = { rubrics: RoomRubrics; priorities: string[]; bant: BantConfig };
export type LoadedPracticeConfig = PracticeConfig & {
  /** De dónde salen y a dónde van los criterios. `local` = SQLite de desarrollo, nunca producción. */
  backend: 'supabase' | 'local';
  source: 'db' | 'defaults';
  // `null` cuando la tabla existe y está vacía (aún no se ha guardado nada): no es un error.
  reason: string | null;
  updated_at: string | null;
  updated_by: string | null;
};

export const DEFAULT_CONFIG: PracticeConfig = { rubrics: DEFAULT_RUBRICS, priorities: DEFAULT_PRIORITIES, bant: DEFAULT_BANT };

// El backend local solo existe para desarrollo: sin claves de Supabase y fuera de producción.
// En un despliegue real (Vercel) siempre hay Supabase y esta rama no se toma.
export const usesLocalPracticeStore = () => !allowlistConfigured() && process.env.NODE_ENV !== 'production';

const backend = (): 'supabase' | 'local' => usesLocalPracticeStore() ? 'local' : 'supabase';
const defaults = (reason: string | null): LoadedPracticeConfig =>
  ({ ...DEFAULT_CONFIG, backend: backend(), source: 'defaults', reason, updated_at: null, updated_by: null });

let cache: { at: number; value: LoadedPracticeConfig } | null = null;

export async function loadPracticeConfig(force = false): Promise<LoadedPracticeConfig> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.value;
  if (usesLocalPracticeStore()) return loadLocal();
  const response = await serviceRest(`${TABLE}?org_id=eq.${ORG}&select=${COLUMNS}&limit=1`).catch(() => null);
  if (!response) {
    const value = defaults('No se pudo contactar con la base de datos: se usan los criterios por defecto y el panel no puede guardar.');
    cache = { at: Date.now(), value };
    return value;
  }
  if (!response.ok) {
    const value = defaults(`La configuración guardada no se pudo leer (HTTP ${response.status}). Se usan los criterios por defecto.`);
    cache = { at: Date.now(), value };
    return value;
  }
  const rows = await response.json().catch(() => null);
  if (!Array.isArray(rows)) {
    const value = defaults('La base de datos devolvió una respuesta que no se puede leer: se usan los criterios por defecto.');
    cache = { at: Date.now(), value };
    return value;
  }
  if (!rows.length) {
    const value = defaults(null);
    cache = { at: Date.now(), value };
    return value;
  }
  const row = rows[0] as Record<string, unknown>;
  const rubrics = validateRubrics(row.rubrics);
  const priorities = validatePriorities(row.priorities);
  const bant = validateBant(row.bant);
  if (!rubrics.ok || !priorities.ok || !bant.ok) {
    const detail = !rubrics.ok ? rubrics.detail : !priorities.ok ? priorities.detail : !bant.ok ? bant.detail : '';
    const value = defaults(`La configuración guardada no es válida (${detail}). Se usan los criterios por defecto hasta corregirla.`);
    cache = { at: Date.now(), value };
    return value;
  }
  const value: LoadedPracticeConfig = {
    rubrics: rubrics.value,
    priorities: priorities.value,
    bant: bant.value,
    backend: 'supabase',
    source: 'db',
    reason: null,
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : null,
    updated_by: typeof row.updated_by === 'string' ? row.updated_by : null,
  };
  cache = { at: Date.now(), value };
  return value;
}

// Lee la tabla local y valida lo guardado con las mismas reglas que Postgres. Un JSON inválido no
// se sirve a medias: se declara y se vuelve a los valores por defecto.
function loadLocal(): LoadedPracticeConfig {
  const read = readLocalConfig(ORG);
  if (!read.ok) {
    const value = defaults(read.reason);
    cache = { at: Date.now(), value };
    return value;
  }
  if (!read.row) {
    const value = defaults(null);
    cache = { at: Date.now(), value };
    return value;
  }
  let parsed: { rubrics?: unknown; priorities?: unknown; bant?: unknown };
  try {
    parsed = {
      rubrics: JSON.parse(read.row.rubrics),
      priorities: JSON.parse(read.row.priorities),
      bant: JSON.parse(read.row.bant),
    };
  } catch {
    const value = defaults('La configuración local guardada no es JSON válido. Se usan los criterios por defecto.');
    cache = { at: Date.now(), value };
    return value;
  }
  const rubrics = validateRubrics(parsed.rubrics);
  const priorities = validatePriorities(parsed.priorities);
  const bant = validateBant(parsed.bant);
  if (!rubrics.ok || !priorities.ok || !bant.ok) {
    const detail = !rubrics.ok ? rubrics.detail : !priorities.ok ? priorities.detail : !bant.ok ? bant.detail : '';
    const value = defaults(`La configuración local guardada no es válida (${detail}). Se usan los criterios por defecto.`);
    cache = { at: Date.now(), value };
    return value;
  }
  const value: LoadedPracticeConfig = {
    rubrics: rubrics.value, priorities: priorities.value, bant: bant.value,
    backend: 'local', source: 'db', reason: null,
    updated_at: read.row.updated_at, updated_by: read.row.updated_by,
  };
  cache = { at: Date.now(), value };
  return value;
}

export type SaveResult = { ok: true; config: LoadedPracticeConfig } | { ok: false; detail: string; status: number };

export async function savePracticeConfig(input: unknown, updatedBy: string): Promise<SaveResult> {
  if (!input || typeof input !== 'object') return { ok: false, detail: 'Falta la configuración.', status: 422 };
  const body = input as Record<string, unknown>;
  const rubrics = validateRubrics(body.rubrics);
  if (!rubrics.ok) return { ok: false, detail: rubrics.detail, status: 422 };
  const priorities = validatePriorities(body.priorities);
  if (!priorities.ok) return { ok: false, detail: priorities.detail, status: 422 };
  const bant = validateBant(body.bant);
  if (!bant.ok) return { ok: false, detail: bant.detail, status: 422 };

  if (usesLocalPracticeStore()) {
    const written = writeLocalConfig(ORG, { rubrics: rubrics.value, priorities: priorities.value, bant: bant.value }, updatedBy);
    if (!written.ok) return { ok: false, detail: written.reason, status: 503 };
    cache = null;
    return { ok: true, config: await loadPracticeConfig(true) };
  }

  const response = await serviceRest(`${TABLE}?on_conflict=org_id`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({
      org_id: ORG,
      rubrics: rubrics.value,
      priorities: priorities.value,
      bant: bant.value,
      updated_at: new Date().toISOString(),
      updated_by: updatedBy.slice(0, 200),
    }),
  }).catch(() => null);
  if (!response) return { ok: false, detail: 'No se pudo contactar con la base de datos: los cambios no se han guardado.', status: 503 };
  if (!response.ok) {
    // 404/42P01 = la tabla no existe: la migración está preparada pero no aplicada. Se dice tal cual.
    const missing = response.status === 404 || response.status === 400;
    return {
      ok: false,
      status: 503,
      detail: missing
        ? 'No se pudo guardar: falta aplicar la migración `20261119_practice_rubrics.sql` en Supabase. Los criterios por defecto siguen funcionando.'
        : `No se pudo guardar la configuración (HTTP ${response.status}). Inténtalo otra vez; no se ha cambiado nada.`,
    };
  }
  cache = null;
  return { ok: true, config: await loadPracticeConfig(true) };
}

export async function resetPracticeConfig(): Promise<{ ok: true } | { ok: false; detail: string }> {
  if (usesLocalPracticeStore()) {
    const removed = deleteLocalConfig(ORG);
    if (!removed.ok) return { ok: false, detail: removed.reason };
    cache = null;
    return { ok: true };
  }
  const response = await serviceRest(`${TABLE}?org_id=eq.${ORG}`, { method: 'DELETE' }).catch(() => null);
  if (!response) return { ok: false, detail: 'No se pudo contactar con la base de datos.' };
  if (!response.ok) return { ok: false, detail: `No se pudo restaurar (HTTP ${response.status}).` };
  cache = null;
  return { ok: true };
}
