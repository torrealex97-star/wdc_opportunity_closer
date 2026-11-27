import { ORG } from './external';
import { pagedRest } from './supabaseAuth';
import { readSamples } from './sourceSample';
import { routesForCatalog } from './sourceRoutes';
import { kindOf, type SourceKind } from './sourceKinds';
import { apifyPortalHealth, summarize, type ControlInput, type ControlSummary } from './sourceControl';
import { PORTALS } from './apifyCatalog';
import { apifyToken, listActors, listRuns } from './apify';
import { portalViews } from './apifyAuto';
import { activeCounts } from './sourceTargetsStore';
import { TARGET_SOURCES } from './sourceTargets';

// Datos del control total: la muestra por fuente (con el informe del motor) más lo que entró y se aprobó en la ventana de 7 días.
// ATS que lee el colector de tableros (`scripts/boards_collect.py`); el código de fuente es `ats-<id>`.
const BOARD_ATS = [{ id: 'greenhouse', name: 'Greenhouse' }, { id: 'ashby', name: 'Ashby' }, { id: 'smartrecruiters', name: 'SmartRecruiters' }, { id: 'recruitee', name: 'Recruitee' }, { id: 'teamtailor', name: 'Teamtailor' }] as const;
export const WINDOW_DAYS = 7;
type Recent = { source: string; editorial_status: string };
const QUALIFIED = new Set(['approved', 'published']);

type CatalogEntry = { code: string; name: string; category?: string | null };
/** `seen`/`approved` por fuente de lo visto por primera vez en la ventana; `null` si no se pudo leer. */
export async function recentBySource(now = Date.now(), days = WINDOW_DAYS): Promise<Map<string, { seen: number; approved: number; drafts: number }> | null> {
  const since = new Date(now - days * 86_400_000).toISOString();
  const rows = await pagedRest<Recent>(`external_offers?org_id=eq.${ORG}&first_seen_at=gte.${encodeURIComponent(since)}&select=source,editorial_status`, 'id.asc').catch(() => null);
  if (!rows || rows.truncated) return null; // un tope alcanzado deja cuentas incompletas: hueco, no cifras de menos
  const out = new Map<string, { seen: number; approved: number; drafts: number }>();
  for (const row of rows.rows) {
    const entry = out.get(row.source) ?? { seen: 0, approved: 0, drafts: 0 };
    entry.seen += 1; if (QUALIFIED.has(row.editorial_status)) entry.approved += 1; if (row.editorial_status === 'draft') entry.drafts += 1;
    out.set(row.source, entry);
  }
  return out;
}

type Judged = { source: string; editorial_status: string; auto_review: { why?: unknown } | null };
/** Motivos de descarte por fuente de lo revisado en la ventana (retiradas y excepciones). `null` = no se pudo leer. */
export async function reasonsBySource(now = Date.now(), days = WINDOW_DAYS): Promise<Map<string, Array<{ why: string; n: number }>> | null> {
  const since = new Date(now - days * 86_400_000).toISOString();
  const rows = await pagedRest<Judged>(`external_offers?org_id=eq.${ORG}&first_seen_at=gte.${encodeURIComponent(since)}&editorial_status=in.(withdrawn,needs_review)&select=source,editorial_status,auto_review`, 'id.asc').catch(() => null);
  if (!rows || rows.truncated) return null;
  const counts = new Map<string, Map<string, number>>();
  for (const row of rows.rows) {
    const why = typeof row.auto_review?.why === 'string' ? row.auto_review.why : null;
    if (!why) continue;
    const inner = counts.get(row.source) ?? new Map<string, number>(); inner.set(why, (inner.get(why) ?? 0) + 1); counts.set(row.source, inner);
  }
  return new Map([...counts].map(([source, inner]) => [source, [...inner].map(([why, n]) => ({ why, n }))]));
}

export type SourceControlPayload = ControlSummary & { window_days: number; generated_at: string; recent_note: string | null };

export async function loadSourceControl(): Promise<SourceControlPayload | null> {
  const [samples, recent, reasons, targets, actors, runs, token] = await Promise.all([readSamples(), recentBySource(), reasonsBySource(), activeCounts(), listActors().catch(() => null), listRuns(200).catch(() => null), apifyToken().catch(() => null)]);
  if (!samples) return null;
  const catalog = (await import('./sourceCatalog.json')).default as CatalogEntry[];
  const routes = routesForCatalog(catalog as never);
  const byCode = new Map(catalog.map(entry => [entry.code, entry]));
  const inputs: ControlInput[] = samples.rows.filter(row => byCode.has(row.source)).map(row => {
    const entry = byCode.get(row.source)!;
    const kind: SourceKind = kindOf({ code: entry.code, category: entry.category ?? null }, routes.get(row.source) ?? []);
    const window = recent ? recent.get(row.source) ?? { seen: 0, approved: 0, drafts: 0 } : null;
    return { source: row.source, name: entry.name, kind, health: row.health, seen7: window ? window.seen : null, approved7: window ? window.approved : null, engine: row.engine,
      reasons: reasons ? reasons.get(row.source) ?? [] : null, drafts7: window ? window.drafts : null,
      targets: TARGET_SOURCES[row.source] ? (targets ? targets.get(row.source) ?? 0 : null) : undefined };
  });
  // Los portales de Apify no están en el catálogo de fuentes (69 códigos, ningún `apify-*`): antes el control los omitía en silencio, justo
  // las fuentes de pago que más recogen. Se miden igual que el resto: ofertas vistas y aprobadas en la ventana y salud real del portal.
  const known = actors !== null && runs !== null;
  const views = known ? new Map(portalViews(actors!, runs!).map(v => [v.id, v])) : null;
  for (const portal of PORTALS) {
    if (byCode.has(portal.source)) continue;
    const view = views?.get(portal.id) ?? null;
    const window = recent ? recent.get(portal.source) ?? { seen: 0, approved: 0, drafts: 0 } : null;
    inputs.push({ source: portal.source, name: portal.name, kind: 'pago', engine: null,
      health: apifyPortalHealth({ source: portal.source, hasKey: Boolean(token), known, view: view ? { state: view.state, detail: view.detail, daily: view.daily } : null }),
      seen7: window ? window.seen : null, approved7: window ? window.approved : null, reasons: reasons ? reasons.get(portal.source) ?? [] : null, drafts7: window ? window.drafts : null,
      targets: TARGET_SOURCES[portal.source] ? (targets ? targets.get(portal.source) ?? 0 : null) : undefined });
  }
  // Formulario público de empleadores (`/empleadores`): fuente propia que no está en el catálogo ni es de Apify. Siempre abierta si la app
  // responde; lo que da se mide igual que el resto (vistas y aprobadas en la ventana) y sin ofertas aparece como «sin recoger», no como cero fingido.
  const form = recent ? recent.get('empleadores') ?? { seen: 0, approved: 0, drafts: 0 } : null;
  inputs.push({ source: 'empleadores', name: 'Formulario de empleadores', kind: 'gratuitas', engine: null,
    health: { source: 'empleadores', state: 'conectada', cause: 'Formulario público abierto en /empleadores: las empresas envían su oferta y entra como borrador.', next: 'Difundir el enlace entre empresas, agencias e infoproductores.' },
    seen7: form ? form.seen : null, approved7: form ? form.approved : null, reasons: reasons ? reasons.get('empleadores') ?? [] : null, drafts7: form ? form.drafts : null });
  // Colector directo de tableros de empresas (`scripts/boards_collect.py`, flujo `boards-collect.yml` en GitHub Actions): una fuente por ATS para medir
  // cada una por separado. Sin ofertas recibidas en la ventana NO se da por conectada: sale «sin programar» con su causa (la primera ejecución real
  // aún no consta) y se mide igual que el resto en cuanto envía algo.
  for (const ats of BOARD_ATS) {
    const code = `ats-${ats.id}`, window = recent ? recent.get(code) ?? { seen: 0, approved: 0, drafts: 0 } : null;
    inputs.push({ source: code, name: `Tableros de empresas · ${ats.name}`, kind: 'gratuitas', engine: null,
      health: window && window.seen > 0
        ? { source: code, state: 'conectada', cause: `Colector de tableros (${ats.name}) en GitHub Actions: llegaron ofertas en los últimos ${WINDOW_DAYS} días.`, next: 'Revisar cuántas cualifican en la tabla.' }
        : { source: code, state: 'sin_programar', cause: `El colector de tableros (${ats.name}) corre en GitHub Actions y no ha enviado ofertas en los últimos ${WINDOW_DAYS} días; su contrato con ${ats.name} aún no está verificado contra el servicio real.`, next: 'Lanzar el flujo «Boards collect» con dry_run=1, leer su resumen y, si cuadra, dejarlo correr a diario.' },
      seen7: window ? window.seen : null, approved7: window ? window.approved : null, reasons: reasons ? reasons.get(code) ?? [] : null, drafts7: window ? window.drafts : null });
  }
  return {
    ...summarize(inputs), window_days: WINDOW_DAYS, generated_at: new Date().toISOString(),
    recent_note: recent ? null : `No se pudo leer lo que entró en los últimos ${WINDOW_DAYS} días: las fuentes que no son del motor salen sin medir («—»), no en cero.`,
  };
}
