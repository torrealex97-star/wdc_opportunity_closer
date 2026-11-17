// Tipo de cambio para pasar a euros un coste que se registra en dólares.
//
// El coste de Apify y de SerpApi se guarda en USD (es la moneda que factura el proveedor). Para
// enseñar «€ por envío» hace falta un tipo de cambio, y no se inventa: se usa el de referencia del
// BCE, el mismo origen que `apps/api/career/collection.py`, con una hora de caché por proceso.
// Si el BCE no responde, el resultado es `null` y quien pinta enseña «—» con su causa; el coste en
// dólares sigue disponible. `EUR_PER_USD` permite fijar el tipo a mano (multiplicador: € = USD × tasa).
export type FxRate = { eur_per_usd: number; source: 'EUR_PER_USD' | 'BCE'; date: string | null };

const ECB_URL = () => process.env.ECB_FX_URL ?? 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
let cache: { at: number; value: FxRate | null } | null = null;

export async function eurRate(
  { now = Date.now(), fetchImpl = fetch, ttlMs = 3_600_000 }: { now?: number; fetchImpl?: typeof fetch; ttlMs?: number } = {},
): Promise<FxRate | null> {
  const override = Number(process.env.EUR_PER_USD);
  if (Number.isFinite(override) && override > 0.5 && override < 2) return { eur_per_usd: override, source: 'EUR_PER_USD', date: null };
  if (cache && now - cache.at < ttlMs) return cache.value;
  try {
    const response = await fetchImpl(ECB_URL(), { cache: 'no-store', signal: AbortSignal.timeout(2_500) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const xml = await response.text();
    // El BCE publica USD por 1 EUR; se invierte para multiplicar dólares.
    const usdPerEur = Number(/<Cube[^>]*currency=['"]USD['"][^>]*rate=['"]([\d.]+)['"]/.exec(xml)?.[1]);
    const date = /<Cube\s+time=['"](\d{4}-\d{2}-\d{2})['"]/.exec(xml)?.[1] ?? null;
    if (!(usdPerEur > 0.5 && usdPerEur < 2)) throw new Error('tipo fuera de rango');
    const value: FxRate = { eur_per_usd: Math.round((1 / usdPerEur) * 1e6) / 1e6, source: 'BCE', date };
    cache = { at: now, value };
    return value;
  } catch {
    // Se cachea también el fallo: el panel no reintenta el BCE en cada carga.
    cache = { at: now, value: null };
    return null;
  }
}

export const __testFx = { reset: () => { cache = null; } };
