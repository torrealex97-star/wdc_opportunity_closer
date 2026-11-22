import { randomUUID } from 'node:crypto';
import { timeLeft, MIN_STEP_MS } from './cronBudget';
import { dailyApify, listActors, listRuns, monthSpent, RUN_CAP_USD, startRun, TEST_CAP_USD, type ActorRow, type HarvestResult, type RunRow } from './apify';
import { approvedBySource, ORG } from './external';
import { approvedPerUsd, measuredCost, readBudget, spendPlan } from './paidBudget';
import { PORTALS, portalBySource, portalById, type Portal, type Recipe } from './apifyCatalog';
import { normalizeActor } from './apifyStore';
import { serviceRest } from './supabaseAuth';

// Búsqueda automática con buscadores de repuesto. Si el primero no arranca, falla o termina sin ofertas, se prueba el
// siguiente hasta que uno funcione (con tope de intentos y respetando el presupuesto). Todo queda anotado en el historial.
const DAY = 24 * 3600 * 1000, FAIL = new Set(['FAILED', 'TIMED-OUT', 'TIMED_OUT', 'ABORTED']);
export const MAX_ATTEMPTS = 3, MAX_PER_DAY = 6;
const isActive = (r: RunRow) => r.status === 'RUNNING' || (r.status === 'SUCCEEDED' && !r.finished_at);
const isFailed = (r: RunRow) => FAIL.has(r.status) || (r.status === 'SUCCEEDED' && Boolean(r.finished_at) && r.harvested === 0);
const isGood = (r: RunRow) => r.status === 'SUCCEEDED' && Boolean(r.finished_at) && r.harvested > 0;
const age = (r: RunRow, now: number) => now - Date.parse(r.started_at);

export type RecipeState = 'ok' | 'failed' | 'running' | 'unknown';
export function recipeState(actorId: string | undefined, runs: RunRow[], now = Date.now()): { state: RecipeState; error?: string; items?: number } {
  const last = actorId ? runs.filter(r => r.actor_id === actorId && age(r, now) < DAY).sort((a, b) => b.started_at.localeCompare(a.started_at))[0] : undefined;
  if (!last) return { state: 'unknown' };
  if (isActive(last)) return { state: 'running' };
  if (isFailed(last)) return { state: 'failed', error: last.error ?? (last.harvested === 0 ? 'No devolvió ofertas.' : undefined) };
  return { state: 'ok', items: last.harvested };
}

// Buscadores de un portal: los del catálogo que NO están retirados más los que se añadieron desde la tienda (filas de
// `apify_actors` de ese portal que el catálogo no trae). El catálogo es el punto de partida; la app lo va actualizando.
export const isRetired = (row: Pick<ActorRow, 'status'> | undefined) => row?.status === 'inactive';
export function recipesOf(portal: Portal, rows: ActorRow[]): Recipe[] {
  const same = (a: string, b: string) => normalizeActor(a) === normalizeActor(b);
  const inCatalog = new Set(portal.recipes.map(r => normalizeActor(r.actor)));
  const fromCatalog = portal.recipes.filter(r => !isRetired(rows.find(a => same(a.actor, r.actor))));
  const added = rows.filter(a => a.source === portal.source && !inCatalog.has(normalizeActor(a.actor)) && !isRetired(a))
    .map((a): Recipe => ({ actor: a.actor, name: a.label || a.actor }));
  return [...fromCatalog, ...added];
}

// Los que fallaron en las últimas 24 h van al final; el resto conserva el orden del catálogo.
export function orderRecipes(portal: Portal, rows: ActorRow[], runs: RunRow[], now = Date.now()): Recipe[] {
  const failed = (r: Recipe) => recipeState(rows.find(a => normalizeActor(a.actor) === normalizeActor(r.actor))?.id, runs, now).state === 'failed';
  const usable = recipesOf(portal, rows);
  return [...usable.filter(r => !failed(r)), ...usable.filter(failed)];
}

// Retirada automática: un buscador con 3 fallos seguidos que NO caen el mismo día y ninguna ejecución buena en 14
// días sale de la cascada (`status = inactive`, reversible desde el panel). Tres salvaguardas contra retirar buenos
// buscadores por un mal día: (1) los tres fallos abarcan al menos 24 h y dos días distintos; (2) si TODOS los
// buscadores del portal han fallado en su última ejecución es una caída del proveedor, no de un actor: no se retira
// ninguno; (3) nunca se retira el último que queda.
export const RETIRE_AFTER = 3, RETIRE_WINDOW_DAYS = 14;
export function retirementCandidates(portal: Portal, rows: ActorRow[], runs: RunRow[], now = Date.now()): ActorRow[] {
  const usable = recipesOf(portal, rows);
  if (usable.length < 2) return [];
  const mine = rows.filter(a => a.source === portal.source && !isRetired(a) && usable.some(r => normalizeActor(r.actor) === normalizeActor(a.actor)));
  const recentOf = (row: ActorRow) => runs.filter(r => r.actor_id === row.id && age(r, now) < RETIRE_WINDOW_DAYS * DAY).sort((a, b) => b.started_at.localeCompare(a.started_at));
  // Caída del proveedor: todos los buscadores con historial reciente fallaron en su última ejecución.
  const withHistory = mine.filter(row => recentOf(row).length > 0);
  if (withHistory.length >= 2 && withHistory.every(row => isFailed(recentOf(row)[0]))) return [];
  const out: ActorRow[] = [];
  for (const row of mine) {
    const recent = recentOf(row);
    if (recent.length < RETIRE_AFTER) continue;
    const last3 = recent.slice(0, RETIRE_AFTER);
    if (!last3.every(isFailed) || recent.some(isGood)) continue;
    const newest = Date.parse(last3[0].started_at), oldest = Date.parse(last3[RETIRE_AFTER - 1].started_at);
    const days = new Set(last3.map(r => r.started_at.slice(0, 10)));
    if (newest - oldest < DAY || days.size < 2) continue; // un solo mal día no retira a nadie
    if (out.length < usable.length - 1) out.push(row);
  }
  return out;
}

async function ensureRows(portal: Portal, by: string): Promise<ActorRow[]> {
  let rows = (await listActors() ?? []).filter(a => a.source === portal.source);
  for (const r of portal.recipes.filter(x => !rows.some(a => normalizeActor(a.actor) === normalizeActor(x.actor)))) {
    // La plantilla del portal (si la tiene) viaja a cada fila: los repuestos de un mismo portal comparten
    // contrato de búsqueda; si alguno no lo acepta, el intento se anota y se pasa al siguiente.
    await serviceRest('apify_actors', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ org_id: ORG, label: r.name, actor: r.actor, source: portal.source, input_template: portal.inputTemplate ?? null, max_items: portal.maxItems, memory_mb: 1024, timeout_s: 900, schedule_daily: rows.some(a => a.schedule_daily), created_by: by }) }).catch(() => null);
  }
  rows = (await listActors() ?? []).filter(a => a.source === portal.source);
  return rows;
}

// Un intento que ni siquiera arrancó se anota en el historial (coste 0) para que cuente en la salud del buscador.
async function recordStartFailure(row: ActorRow, error: string, by: string) {
  await serviceRest('apify_runs', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ org_id: ORG, actor_id: row.id, run_id: `noarranco${randomUUID().replace(/-/g, '').slice(0, 14)}`, status: 'FAILED', started_by: by, finished_at: new Date().toISOString(), harvested: 0, items_total: 0, error: error.slice(0, 300) }) }).catch(() => null);
}

// Errores que NO dependen del buscador: probar otro no sirve (presupuesto, clave, ya hay una búsqueda, base de datos).
const GLOBAL_STOP = /Presupuesto|gasto del mes|Guarda antes la clave|rechaz[oó] la clave|Ya hay una ejecuci|registrar/i;

export type SearchResult = { ok: true; recipe: string; actor: string; fallback: boolean; attempts: Array<{ recipe: string; error: string }> }
  | { ok: false; busy?: boolean; stopped?: boolean; error: string; attempts: Array<{ recipe: string; error: string }> };
export async function searchPortal(portal: Portal, opts: { by: string; publicBase: string; test?: boolean; maxAttempts?: number; now?: number; maxChargeUsd?: number }): Promise<SearchResult> {
  const now = opts.now ?? Date.now(), attempts: Array<{ recipe: string; error: string }> = [];
  const [rows, runs] = [await ensureRows(portal, opts.by), await listRuns(80) ?? []];
  const todays = runs.filter(r => rows.some(a => a.id === r.actor_id) && age(r, now) < DAY).length;
  if (todays >= MAX_PER_DAY * 2) return { ok: false, stopped: true, error: 'Ya se han hecho muchos intentos hoy en este portal; se vuelve a intentar mañana.', attempts };
  for (const recipe of orderRecipes(portal, rows, runs, now).slice(0, opts.maxAttempts ?? MAX_ATTEMPTS)) {
    const row = rows.find(a => normalizeActor(a.actor) === normalizeActor(recipe.actor)); if (!row) continue;
    const usable = opts.test ? { ...row, max_items: portal.testItems } : row;
    const r = await startRun(usable, opts.by, opts.publicBase, { maxChargeUsd: opts.test ? TEST_CAP_USD : (opts.maxChargeUsd ?? RUN_CAP_USD), vars: { max_items: usable.max_items, ...(portal.query ? { query: portal.query } : {}) } });
    if (r.ok) return { ok: true, recipe: recipe.name, actor: recipe.actor, fallback: attempts.length > 0, attempts };
    if (GLOBAL_STOP.test(r.error)) return { ok: false, busy: /Ya hay una ejecuci/i.test(r.error), stopped: true, error: r.error, attempts };
    attempts.push({ recipe: recipe.name, error: r.error }); await recordStartFailure(row, r.error, opts.by);
  }
  return { ok: false, error: attempts.length ? 'Ningún buscador de este portal ha podido arrancar ahora.' : 'Este portal no tiene buscadores disponibles.', attempts };
}

// Tras recoger una ejecución: si terminó mal o sin ofertas, se lanza el siguiente buscador del mismo portal (una vez por incidente).
export async function recoverAfter(run: RunRow, actor: ActorRow, result: HarvestResult, publicBase: string) {
  const portal = portalBySource(actor.source); if (!portal || !result.done) return undefined;
  if (!(result.error || FAIL.has(result.status) || result.harvested === 0)) return undefined;
  const [rows, runs] = [(await listActors() ?? []).filter(a => a.source === portal.source), await listRuns(80) ?? []];
  const ids = new Set(rows.map(a => a.id)), now = Date.now();
  const portalRuns = runs.filter(r => ids.has(r.actor_id) && r.run_id !== run.run_id);
  if (portalRuns.some(r => (isGood(r) || isActive(r)) && age(r, now) < 20 * 3600 * 1000)) return undefined; // ya hay otra búsqueda sana o en curso
  if (!rows.some(a => a.schedule_daily) && run.started_by === 'cron') return undefined;
  const out = await searchPortal(portal, { by: 'auto-recuperacion', publicBase, now });
  return { portal: portal.id, ok: out.ok, ...(out.ok ? { recipe: out.recipe } : { error: out.error }) };
}

// Cron: cada portal activado hace UNA búsqueda al día (con repuestos); los actores sueltos siguen la lógica antigua.
// El orden y el tope de cada búsqueda salen del límite mensual guardado: primero los portales de más **ofertas
// aprobadas por dólar** —lo recogido sin aprobarlo no justifica el gasto— y, si el mes no da para más, se aplaza
// y se dice por qué.
// Ventana de medida: desde la ejecución más antigua del historial leído, para que aprobadas y coste hablen del
// mismo periodo. Sin historial no hay medición y no se le supone rendimiento a nadie.
export function measuredSince(runs: Array<{ started_at: string }>): string | null {
  const times = runs.map(r => Date.parse(r.started_at)).filter(Number.isFinite);
  return times.length ? new Date(Math.min(...times)).toISOString() : null;
}
export async function dailyAuto(publicBase: string, opts: { start?: boolean; deadline?: number } = {}) {
  const [actors, runs] = [await listActors() ?? [], await listRuns(80) ?? []]; const started: Array<{ actor: string; ok: boolean; error?: string }> = []; const now = Date.now();
  // Primero se retiran los buscadores que llevan fallando (reversible desde el panel): así la búsqueda de hoy ya no
  // gasta un intento en uno que no funciona. Cada retirada se comprueba: un PATCH fallido no se cuenta como hecho.
  const retired: Array<{ portal: string; actor: string; ok: boolean }> = [];
  if (opts.start !== false) {
    for (const portal of PORTALS) {
      for (const row of retirementCandidates(portal, actors, runs, now)) {
        const response = await serviceRest(`apify_actors?org_id=eq.${ORG}&id=eq.${row.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'inactive' }) }).catch(() => null);
        retired.push({ portal: portal.id, actor: row.actor, ok: Boolean(response?.ok) });
        if (response?.ok) row.status = 'inactive'; // los pasos siguientes de esta pasada ya no lo cuentan
      }
    }
  }
  const pending = (opts.start === false ? [] : PORTALS).filter(portal => {
    const rows = actors.filter(a => a.source === portal.source); if (!rows.some(a => a.schedule_daily)) return false;
    const ids = new Set(rows.map(a => a.id));
    return !runs.some(r => ids.has(r.actor_id) && (isGood(r) || isActive(r)) && age(r, now) < 20 * 3600 * 1000);
  });
  if (pending.length) {
    const [budget, spent] = await Promise.all([readBudget(), monthSpent()]);
    const since = measuredSince(runs);
    // Si las aprobadas no se pueden contar, el reparto se queda sin medición (van todos al final, en orden del
    // catálogo) en vez de suponer cero aprobadas y castigar a un portal por un fallo de lectura.
    const approved = since ? await approvedBySource(pending.map(p => p.source), since).catch(() => null) : null;
    const plan = spendPlan(budget.usd, spent, pending.map(p => {
      const ids = new Set(actors.filter(a => a.source === p.source).map(a => a.id));
      const mine = runs.filter(r => ids.has(r.actor_id));
      return { code: p.id, qualified_per_usd: approvedPerUsd(mine, approved ? approved[p.source] ?? 0 : null) };
    }), RUN_CAP_USD);
    for (const code of plan.order) {
      const portal = pending.find(p => p.id === code); if (!portal) continue;
      if (timeLeft(opts.deadline) < MIN_STEP_MS * 2) { started.push({ actor: portal.recipes[0].actor, ok: false, error: 'Sin tiempo en el presupuesto del cron: se lanzará en la próxima ejecución.' }); continue; }
      const r = await searchPortal(portal, { by: 'cron', publicBase, now, maxChargeUsd: plan.caps[code] });
      started.push({ actor: r.ok ? r.actor : portal.recipes[0].actor, ok: r.ok, ...(r.ok ? {} : { error: r.error }) });
    }
    for (const d of plan.deferred) {
      const portal = portalById(d.code); if (!portal) continue;
      started.push({ actor: portal.recipes[0].actor, ok: false, error: `Aplazada: ${d.reason}. Súbelo en Apify → «Límite de gasto del mes».` });
    }
  }
  const legacy = await dailyApify(publicBase, { ...opts, skip: a => Boolean(portalBySource(a.source)), after: (run, actor, res) => recoverAfter(run, actor, res, publicBase) });
  return { ...legacy, started: [...started, ...legacy.started], ...(retired.length ? { retired } : {}) };
}

// ---- Vista en lenguaje llano para el panel ----
export type PortalView = {
  id: string; name: string; plain: string; caution?: string; daily: boolean; maxItems: number;
  state: 'off' | 'new' | 'running' | 'ok' | 'trying' | 'down'; headline: string; detail: string;
  last: { when: string; items: number; cost: number | null } | null;
  recipes: Array<{ name: string; actor: string; id: string | null; state: RecipeState; detail: string; added: boolean }>;
  /** Buscadores retirados de la cascada (a mano o por fallos repetidos): se pueden reactivar. */
  retired: Array<{ id: string; name: string; actor: string }>;
  /** Menos de dos buscadores activos: no hay repuesto si falla el único que queda. */
  needs_more: boolean;
  // Por qué este portal está donde está en el reparto del mes: aprobadas medidas, coste y puesto.
  priority: { approved: number | null; usd: number; per_usd: number | null; rank: number | null; note: string };
};
const priorityNote = (approved: number | null, usd: number, per: number | null, rank: number | null) => {
  if (approved === null) return 'Sin recuento de aprobadas: no se le supone rendimiento, así que va al final del reparto.';
  if (per === null) return `${approved} aprobadas y ${usd > 0 ? `${usd.toFixed(2)} USD gastados` : 'ningún coste registrado'}: sin coste no hay rendimiento que comparar, así que va al final.`;
  return `${approved} aprobadas por ${usd.toFixed(2)} USD (${per} por dólar)${rank ? ` · ${rank}º en el reparto del mes` : ' · aún sin búsqueda diaria'}.`;
};
const ago = (iso: string, now: number) => { const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60000)); return m < 60 ? `hace ${m} min` : m < 48 * 60 ? `hace ${Math.round(m / 60)} h` : `hace ${Math.round(m / 1440)} días`; };
// Mensajes técnicos → frase que entiende cualquiera.
export function plainError(error: string | null | undefined): string {
  const e = error ?? '';
  if (!e) return 'No dio ningún motivo.';
  if (/esquema|plantilla|campos|exige/i.test(e)) return 'Este buscador cambió su forma de funcionar.';
  if (/HTTP 4(04|10)|no encontrado|not found/i.test(e)) return 'Este buscador ya no está disponible en Apify.';
  if (/TIMED|Tiempo/i.test(e)) return 'Tardó demasiado y se cortó.';
  if (/FAILED|ABORTED|terminó como/i.test(e)) return 'Se detuvo con un error.';
  if (/0 ofertas|devolvi/i.test(e)) return 'No encontró ofertas.';
  return e.length > 140 ? `${e.slice(0, 137)}…` : e;
}
export function portalViews(actors: ActorRow[], runs: RunRow[], now = Date.now(), approved: Record<string, number> | null = null): PortalView[] {
  const measured = PORTALS.map(p => {
    const rows = actors.filter(a => a.source === p.source), ids = new Set(rows.map(a => a.id));
    const mine = runs.filter(r => ids.has(r.actor_id));
    const ap = approved ? approved[p.source] ?? 0 : null;
    return { p, rows, mine, ap, usd: measuredCost(mine), per: approvedPerUsd(mine, ap) };
  });
  // Solo compiten los portales con búsqueda diaria y rendimiento medido: el resto se enseña sin puesto en vez de
  // con uno falso. Las aprobadas mandan sobre lo recogido (400 recogidas con 2 aprobadas pierden contra 40 con 12).
  const ranked = measured.filter(m => m.per !== null && m.rows.some(a => a.schedule_daily)).sort((a, b) => b.per! - a.per!);
  const rank = new Map(ranked.map((m, i) => [m.p.id, i + 1]));
  return measured.map(({ p, rows, mine: unsorted, ap, usd, per }) => {
    const mine = [...unsorted].sort((a, b) => b.started_at.localeCompare(a.started_at));
    const inCatalog = new Set(p.recipes.map(r => normalizeActor(r.actor)));
    const recipes = recipesOf(p, rows).map(r => { const row = rows.find(a => normalizeActor(a.actor) === normalizeActor(r.actor)); const s = recipeState(row?.id, runs, now);
      // Los buscadores generados desde la auditoría declaran qué campos exige el actor: se dice en la tarjeta
      // para que nadie se pregunte por qué un intento no arrancó por falta de un dato.
      const needs = r.needs?.length ? ` · pide ${r.needs.join(', ')}` : '';
      return { name: r.name, actor: r.actor, id: row?.id ?? null, added: !inCatalog.has(normalizeActor(r.actor)), state: s.state, detail: s.state === 'ok' ? `Funcionó: ${s.items} ofertas` : s.state === 'failed' ? plainError(s.error) : s.state === 'running' ? 'Buscando ahora…' : `Aún sin probar${needs}` }; });
    const retired = rows.filter(isRetired).map(a => ({ id: a.id, name: a.label || a.actor, actor: a.actor }));
    const good = mine.find(isGood), daily = rows.some(a => a.schedule_daily);
    const last = good ? { when: ago(good.finished_at ?? good.started_at, now), items: good.harvested, cost: good.cost_usd == null ? null : Number(good.cost_usd) } : null;
    const failedN = recipes.filter(r => r.state === 'failed').length;
    let state: PortalView['state'], headline: string, detail: string;
    if (mine.some(isActive)) { state = 'running'; headline = 'Buscando ahora…'; detail = 'Tarda entre 1 y 5 minutos. Las ofertas aparecen solas en «Fuentes externas».'; }
    else if (good && mine[0] === good && now - Date.parse(good.started_at) < 48 * 3600 * 1000) { state = 'ok'; headline = 'Funciona'; detail = `Última búsqueda ${last!.when}: ${last!.items} ofertas${last!.cost != null ? ` (${last!.cost.toFixed(2)} USD)` : ''}.`; }
    else if (recipes.length && failedN === recipes.length) { state = 'down'; headline = 'Ahora mismo ningún buscador funciona'; detail = daily ? 'La app lo reintentará mañana sola. También puedes pulsar «Buscar ahora».' : 'Pulsa «Buscar ahora» para reintentar; la app probará todos los buscadores por orden.'; }
    else if (failedN > 0) { state = 'trying'; headline = 'Un buscador falló; se usa el siguiente'; detail = 'No tienes que hacer nada: la app cambia de buscador sola.'; }
    else if (!mine.length) { state = daily ? 'new' : 'off'; headline = daily ? 'Activado, aún sin primera búsqueda' : 'Sin probar'; detail = 'Pulsa «Probar con 10 ofertas»: cuesta céntimos y comprueba que todo funciona.'; }
    else { state = 'trying'; headline = 'Esperando la próxima búsqueda'; detail = 'Pulsa «Buscar ahora» o espera a la búsqueda diaria.'; }
    return { id: p.id, name: p.name, plain: p.plain, caution: p.caution, daily, maxItems: p.maxItems, state, headline, detail, last, recipes, retired, needs_more: recipes.length < 2 && p.id !== 'multi',
      priority: { approved: ap, usd, per_usd: per, rank: rank.get(p.id) ?? null, note: priorityNote(ap, usd, per, rank.get(p.id) ?? null) } };
  });
}
