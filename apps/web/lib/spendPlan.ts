// Reglas puras del gasto en medios de pago: cuánto es un límite válido y cómo se reparte entre las rutas
// que quieren gastar. Sin red y sin estado, para poder probarlas y para que las use cualquier proveedor.
export const MIN_MONTHLY_USD = 1, MAX_MONTHLY_USD = 5000, DEFAULT_MONTHLY_USD = 10;
// Lo mínimo que merece la pena lanzar: por debajo, se aplaza y se dice, no se lanza una búsqueda raquítica.
export const MIN_RUN_USD = 0.5;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Importe válido en USD (1–5.000, dos decimales) o null si no lo es. No se recorta en silencio. */
export function parseMonthlyUsd(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const usd = round2(n);
  return usd >= MIN_MONTHLY_USD && usd <= MAX_MONTHLY_USD ? usd : null;
}

// Cada ruta de pago (un portal, un actor) recibe como mucho su parte del dinero que queda, y las de mejor
// rendimiento medido van primero. Sin medición no se le supone rendimiento: va al final, declarado.
export type Route = { code: string; yield_per_usd: number | null };
export type Plan = {
  order: string[]; caps: Record<string, number>; deferred: Array<{ code: string; reason: string }>;
  remaining: number; per_route_usd: number | null;
};

export function spendPlan(limitUsd: number, spentUsd: number | null, routes: Route[], runCapUsd: number): Plan {
  if (spentUsd === null) {
    return { order: [], caps: {}, deferred: routes.map(r => ({ code: r.code, reason: 'no se pudo leer lo gastado este mes; por seguridad no se lanza gasto nuevo' })), remaining: 0, per_route_usd: null };
  }
  const ranked = routes
    .map((r, i) => ({ ...r, i }))
    .sort((a, b) => (b.yield_per_usd ?? -1) - (a.yield_per_usd ?? -1) || a.i - b.i);
  let remaining = Math.max(0, round2(limitUsd - spentUsd));
  const caps: Record<string, number> = {}, order: string[] = [], deferred: Array<{ code: string; reason: string }> = [];
  for (let i = 0; i < ranked.length; i++) {
    const route = ranked[i];
    // A partes iguales entre lo que queda por lanzar: ninguna ruta se come el mes de las demás.
    const share = Math.floor((remaining / (ranked.length - i)) * 100) / 100;
    const cap = Math.min(runCapUsd, share);
    if (cap < MIN_RUN_USD) {
      // Lo que queda no da para otra búsqueda: se dice cuánto queda y cuánto hace falta, no se lanza.
      for (const rest of ranked.slice(i)) deferred.push({ code: rest.code, reason: `quedan ${remaining.toFixed(2)} USD de ${limitUsd} USD este mes (mínimo ${MIN_RUN_USD} USD por búsqueda)` });
      break;
    }
    caps[route.code] = cap; order.push(route.code); remaining = round2(remaining - cap);
  }
  return { order, caps, deferred, remaining, per_route_usd: ranked.length ? Math.floor((limitUsd / ranked.length) * 100) / 100 : null };
}

/** Ofertas recogidas por dólar registrado de una ruta. null = sin medición (no se le supone rendimiento). */
export function measuredYield(runs: Array<{ cost_usd: number | null; harvested: number; status: string; finished_at: string | null }>): number | null {
  const done = runs.filter(r => r.status === 'SUCCEEDED' && r.finished_at && Number(r.cost_usd) > 0);
  const cost = done.reduce((sum, r) => sum + Number(r.cost_usd), 0);
  if (!done.length || cost <= 0) return null;
  return round2(done.reduce((sum, r) => sum + r.harvested, 0) / cost);
}
