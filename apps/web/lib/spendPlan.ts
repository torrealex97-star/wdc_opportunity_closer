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

/**
 * Roles que cuentan para el objetivo diario y para repartir el gasto: lo que la academia busca (closer, setter, cold caller, SDR).
 * El «ejecutivo comercial» genérico y los mandos se siguen aprobando y enseñando a las alumnas, pero NO cuentan aquí: medido el
 * 2026-11-26, 708 de ~1.800 ofertas de la semana eran «ejecutivo comercial» y llenaban el objetivo, así que el cron dejaba de buscar
 * closers. Las dos fuentes de verdad (objetivo y reparto) usan este mismo filtro.
 */
export const CORE_ROLES = ['closer', 'setter', 'cold_caller', 'sdr'] as const;
export const CORE_ROLE_FILTER = `role=in.(${CORE_ROLES.join(',')})`;

/**
 * Límite efectivo de HOY: lo gastado antes de hoy + lo que queda del mes repartido entre los días que quedan (hoy incluido).
 * Así el mes no se gasta en los primeros días. `spentTodayUsd` es lo ya gastado hoy (se descuenta de su parte).
 * Nunca pasa de `limitUsd` ni es menor que lo ya gastado.
 */
export function dailyLimit(limitUsd: number, spentMonthUsd: number, spentTodayUsd: number, now: Date = new Date()): number {
  const days = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const left = Math.max(1, days - now.getUTCDate() + 1);
  const before = Math.max(0, round2(spentMonthUsd - Math.max(0, spentTodayUsd)));
  const allowance = Math.floor((round2(Math.max(0, limitUsd - before)) / left) * 100 + 1e-9) / 100;
  return Math.min(limitUsd, Math.max(spentMonthUsd, round2(before + allowance)));
}

// Cada ruta de pago (un portal, un actor) recibe como mucho su parte del dinero que queda, y las de más
// **ofertas aprobadas por dólar** van primero: lo que se recoge sin aprobarlo no justifica el gasto. Sin medición
// no se le supone rendimiento: va al final, declarado.
export type Route = {
  code: string;
  /** Ofertas aprobadas por dólar medido. `null` = sin medición o sin coste: no se le supone rendimiento. */
  qualified_per_usd: number | null;
};
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
    .sort((a, b) => (b.qualified_per_usd ?? -1) - (a.qualified_per_usd ?? -1) || a.i - b.i);
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

/** Coste registrado de las ejecuciones cerradas de una ruta. 0 = ninguna terminó con coste conocido. */
export function measuredCost(runs: Array<{ cost_usd: number | null; status: string; finished_at: string | null }>): number {
  return round2(runs.filter(r => r.status === 'SUCCEEDED' && r.finished_at && Number(r.cost_usd) > 0)
    .reduce((sum, r) => sum + Number(r.cost_usd), 0));
}

/**
 * Ofertas que el propietario aprobó por dólar gastado en su portal. Es la medida con la que se reparte el mes:
 * 400 recogidas y 2 aprobadas valen menos que 40 recogidas y 12 aprobadas. `approved` null = no se pudo contar
 * (hueco, no cero) y `null` de vuelta = esa ruta no tiene rendimiento que presumir, así que va al final.
 */
export function approvedPerUsd(
  runs: Array<{ cost_usd: number | null; status: string; finished_at: string | null }>, approved: number | null,
): number | null {
  if (approved === null || approved < 0) return null;
  const cost = measuredCost(runs);
  if (cost <= 0) return null;
  return round2(approved / cost);
}

/** Ofertas recogidas por dólar (sin filtrar por aprobación). Se conserva para leer el embudo, no para repartir. */
export function measuredYield(runs: Array<{ cost_usd: number | null; harvested: number; status: string; finished_at: string | null }>): number | null {
  const cost = measuredCost(runs);
  if (cost <= 0) return null;
  return round2(runs.filter(r => r.status === 'SUCCEEDED' && r.finished_at && Number(r.cost_usd) > 0)
    .reduce((sum, r) => sum + r.harvested, 0) / cost);
}
