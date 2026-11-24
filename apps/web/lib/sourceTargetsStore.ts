import { ORG } from './external';
import { serviceRest } from './supabaseAuth';
import { MAX_PER_RUN, MAX_TARGETS, validateTarget, type TargetKind } from './sourceTargets';

// Lectura y escritura de `source_targets` (migración 20261124_source_targets.sql). Siempre acotado por organización.
// Cada escritura devuelve su resultado: un fallo se dice, nunca se cuenta como hecho. Leer las direcciones para lanzar un
// actor NUNCA rompe el resto de fuentes: sin tabla o sin respuesta devuelve «sin direcciones».
export type TargetRow = { id: string; source: string; kind: TargetKind; url: string; label: string | null; enabled: boolean; created_by: string | null; created_at: string };
export type TargetList = { ok: true; rows: TargetRow[] } | { ok: false; pending: boolean; error: string };
export type TargetWrite = { ok: true; row?: TargetRow } | { ok: false; status: number; error: string };

const COLS = 'id,source,kind,url,label,enabled,created_by,created_at';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isMissingTable = async (response: Response) => { if (response.status === 404) return true; const body = await response.clone().json().catch(() => null) as { code?: string } | null; return body?.code === 'PGRST205' || body?.code === '42P01'; };

export async function listTargets(): Promise<TargetList> {
  const response = await serviceRest(`source_targets?org_id=eq.${ORG}&select=${COLS}&order=created_at.asc&limit=500`).catch(() => null);
  if (!response) return { ok: false, pending: false, error: 'No se pudo leer las direcciones: la base no respondió.' };
  if (!response.ok) { const pending = await isMissingTable(response); return { ok: false, pending, error: pending ? 'La tabla de direcciones aún no está creada en la base (migración 20261124_source_targets.sql pendiente).' : `No se pudo leer las direcciones (HTTP ${response.status}).` }; }
  const rows = await response.json().catch(() => null);
  return Array.isArray(rows) ? { ok: true, rows: rows as TargetRow[] } : { ok: false, pending: false, error: 'La base devolvió las direcciones en un formato inesperado.' };
}

export async function addTarget(source: string, raw: string, label: string | null | undefined, by: string): Promise<TargetWrite> {
  const checked = validateTarget(source, raw, label);
  if (!checked.ok) return { ok: false, status: 422, error: checked.error };
  const current = await listTargets();
  if (!current.ok) return { ok: false, status: current.pending ? 503 : 502, error: current.error };
  if (current.rows.filter(r => r.source === source).length >= MAX_TARGETS) return { ok: false, status: 422, error: `Máximo ${MAX_TARGETS} direcciones por fuente: quita alguna antes de añadir otra.` };
  if (current.rows.some(r => r.source === source && r.url === checked.url)) return { ok: false, status: 409, error: 'Esa dirección ya está añadida.' };
  const response = await serviceRest('source_targets', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ org_id: ORG, source, kind: checked.kind, url: checked.url, label: checked.label, created_by: by.slice(0, 254) }) }).catch(() => null);
  if (!response) return { ok: false, status: 502, error: 'No se pudo guardar: la base no respondió.' };
  if (response.status === 409) return { ok: false, status: 409, error: 'Esa dirección ya está añadida.' };
  if (!response.ok) return { ok: false, status: 502, error: `No se pudo guardar la dirección (HTTP ${response.status}).` };
  const rows = await response.json().catch(() => null);
  return { ok: true, row: Array.isArray(rows) ? rows[0] as TargetRow : undefined };
}

export async function setTargetEnabled(id: string, enabled: boolean): Promise<TargetWrite> {
  if (!UUID.test(id)) return { ok: false, status: 422, error: 'Identificador no válido.' };
  const response = await serviceRest(`source_targets?id=eq.${id}&org_id=eq.${ORG}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ enabled }) }).catch(() => null);
  if (!response?.ok) return { ok: false, status: 502, error: 'No se pudo cambiar la dirección.' };
  const rows = await response.json().catch(() => null);
  return Array.isArray(rows) && rows.length ? { ok: true, row: rows[0] as TargetRow } : { ok: false, status: 404, error: 'Esa dirección ya no existe.' };
}

export async function removeTarget(id: string): Promise<TargetWrite> {
  if (!UUID.test(id)) return { ok: false, status: 422, error: 'Identificador no válido.' };
  const response = await serviceRest(`source_targets?id=eq.${id}&org_id=eq.${ORG}`, { method: 'DELETE', headers: { Prefer: 'return=representation' } }).catch(() => null);
  if (!response?.ok) return { ok: false, status: 502, error: 'No se pudo quitar la dirección.' };
  const rows = await response.json().catch(() => null);
  return Array.isArray(rows) && rows.length ? { ok: true } : { ok: false, status: 404, error: 'Esa dirección ya no existe.' };
}

/** Direcciones activas de una fuente para lanzar un actor (las más antiguas primero, con tope por ejecución). `[]` si no se pueden leer. */
export async function activeUrls(source: string): Promise<string[]> {
  const list = await listTargets();
  return list.ok ? list.rows.filter(r => r.source === source && r.enabled).map(r => r.url).slice(0, MAX_PER_RUN) : [];
}

/** Direcciones activas por fuente; `null` si no se pudieron leer (el Control de fuentes lo dice en vez de contar 0). */
export async function activeCounts(): Promise<Map<string, number> | null> {
  const list = await listTargets();
  if (!list.ok) return null;
  const out = new Map<string, number>();
  for (const row of list.rows) if (row.enabled) out.set(row.source, (out.get(row.source) ?? 0) + 1);
  return out;
}
