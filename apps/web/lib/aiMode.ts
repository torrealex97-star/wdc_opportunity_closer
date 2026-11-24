import { ORG } from './external';
import { serviceRest } from './supabaseAuth';

// Modo del revisor IA editable desde la app. Orden: tabla `ai_review_settings` (lo que el propietario eligió en el panel)
// → variable de entorno AI_REVIEW_MODE → `shadow`. Un fallo de lectura NO activa `live`: cae a entorno/shadow y lo dice.
export type AiMode = 'shadow' | 'live';
export type AiModeState = { mode: AiMode; source: 'tabla' | 'entorno' | 'defecto'; updated_by: string | null; updated_at: string | null; error: string | null };

export const parseAiMode = (value: unknown): AiMode | null => (value === 'shadow' || value === 'live' ? value : null);

export function modeFromRow(row: { mode?: unknown; updated_by?: unknown; updated_at?: unknown } | undefined, env: NodeJS.ProcessEnv, error: string | null): AiModeState {
  const stored = parseAiMode(row?.mode);
  if (stored) return { mode: stored, source: 'tabla', updated_by: typeof row?.updated_by === 'string' ? row.updated_by : null, updated_at: typeof row?.updated_at === 'string' ? row.updated_at : null, error };
  const fromEnv = parseAiMode(env.AI_REVIEW_MODE);
  return fromEnv ? { mode: fromEnv, source: 'entorno', updated_by: null, updated_at: null, error } : { mode: 'shadow', source: 'defecto', updated_by: null, updated_at: null, error };
}

export async function readAiMode(env: NodeJS.ProcessEnv = process.env): Promise<AiModeState> {
  const response = await serviceRest(`ai_review_settings?org_id=eq.${ORG}&select=mode,updated_by,updated_at&limit=1`).catch(() => null);
  if (!response) return modeFromRow(undefined, env, 'No se pudo consultar ai_review_settings; se usa el entorno.');
  const rows = response.ok ? await response.json().catch(() => null) : null;
  if (!Array.isArray(rows)) return modeFromRow(undefined, env, response.status === 404 ? 'Falta aplicar la migración 20261123_ai_review_settings.sql; se usa el entorno.' : `No se pudo leer ai_review_settings (HTTP ${response.status}); se usa el entorno.`);
  return modeFromRow(rows[0] as { mode?: unknown } | undefined, env, null);
}

export async function writeAiMode(value: unknown, by: string): Promise<{ ok: true; mode: AiMode } | { ok: false; kind: 'invalid' | 'store'; error: string }> {
  const mode = parseAiMode(value);
  if (!mode) return { ok: false, kind: 'invalid', error: 'El modo debe ser «shadow» (la IA solo anota) o «live» (la IA aplica sus decisiones).' };
  const response = await serviceRest('ai_review_settings?on_conflict=org_id', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ org_id: ORG, mode, updated_by: by, updated_at: new Date().toISOString() }),
  }).catch(() => null);
  if (response?.ok) return { ok: true, mode };
  return { ok: false, kind: 'store', error: response?.status === 404 ? 'Falta aplicar la migración 20261123_ai_review_settings.sql en la base: el modo no se pudo guardar.' : `No se pudo guardar el modo${response ? ` (HTTP ${response.status})` : ''}.` };
}

/** Entorno con el modo efectivo ya resuelto, para pasarlo explícito a `config()`/`runAiReview` (sin tocar `process.env`). */
export async function envWithAiMode(base: NodeJS.ProcessEnv = process.env): Promise<NodeJS.ProcessEnv> {
  const state = await readAiMode(base);
  return { ...base, AI_REVIEW_MODE: state.mode };
}
