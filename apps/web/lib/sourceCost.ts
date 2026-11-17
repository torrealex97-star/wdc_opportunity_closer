// Coste YA registrado por fuente, leído de donde la app lo escribe. No se estima nada:
//   · Apify: `apify_runs.cost_usd` (importe real que informa el proveedor) → `apify_actors.source`.
//   · SerpApi de respaldo: la nota que deja la ingesta en `external_ingest_runs`
//     («respaldo SerpApi · 1 búsqueda(s), 0.025 USD»).
// Lo que no deja importe no se inventa: SerpApi de Google Jobs no guarda coste por ejecución, y una
// ejecución de Apify sin `cost_usd` deja el total de su fuente como mínimo (`partial`).
export type ActorLite = { id: string; source: string };
export type RunLite = { actor_id: string; cost_usd: number | string | null; status?: string | null };
export type NoteLite = { source: string; note: string | null };

export type RecordedCost = {
  usdBySource: Map<string, number>;
  // Fuentes con ejecuciones cuyo importe no consta: su coste es un mínimo, no el total.
  partial: Set<string>;
  // Coste de ejecuciones sin actor conocido: no se atribuye a ninguna fuente.
  unattributed_usd: number;
};

/** Importe en USD anotado por el respaldo de SerpApi, o `null` si la nota no lo trae. */
export function parseSerpapiCost(note: string | null | undefined): number | null {
  const match = /respaldo SerpApi[^0-9]*(\d+)\s*b[uú]squeda\(s\),\s*([\d.]+)\s*USD/i.exec(note ?? '');
  if (!match) return null;
  const value = Number(match[2]);
  return Number.isFinite(value) ? value : null;
}

const amount = (value: number | string | null): number | null => {
  if (value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

/**
 * Suma el coste registrado por fuente. `null` en cualquiera de las tres lecturas significa que no se
 * pudo leer: se devuelve `null` en vez de una suma parcial que parecería completa.
 */
export function recordedCosts(actors: ActorLite[] | null, runs: RunLite[] | null, notes: NoteLite[] | null): RecordedCost | null {
  if (actors === null || runs === null || notes === null) return null;
  const sourceOf = new Map(actors.map(actor => [actor.id, actor.source]));
  const usdBySource = new Map<string, number>();
  const partial = new Set<string>();
  let unattributed = 0;
  const add = (source: string, usd: number) => usdBySource.set(source, Math.round(((usdBySource.get(source) ?? 0) + usd) * 1e6) / 1e6);

  for (const run of runs) {
    const source = sourceOf.get(run.actor_id);
    const usd = amount(run.cost_usd);
    if (!source) {
      if (usd !== null) unattributed += usd;
      continue;
    }
    if (usd === null) { partial.add(source); if (!usdBySource.has(source)) usdBySource.set(source, 0); continue; }
    add(source, usd);
  }
  for (const note of notes) {
    const usd = parseSerpapiCost(note.note);
    if (usd === null) { partial.add(note.source); if (!usdBySource.has(note.source)) usdBySource.set(note.source, 0); continue; }
    add(note.source, usd);
  }
  return { usdBySource, partial, unattributed_usd: Math.round(unattributed * 1e6) / 1e6 };
}
