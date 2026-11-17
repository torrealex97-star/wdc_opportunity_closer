// Marcador por fuente: cruza los estados del tablero de candidaturas con la fuente de la oferta.
// Es lo que convierte el tablero de la alumna en una señal de calidad del motor — y solo eso: aquí
// no se retira nada. Piezas puras para poder medirlas sin base de datos; el lector vive en la ruta.

export type AppStatusLite = { offer_ref: string; status: string };
// Coste YA registrado (USD) por fuente y tipo de cambio para pasarlo a euros. Ausente = no se pudo leer:
// todas las columnas de coste salen en `null` (—), nunca en 0.
export type CostInput = {
  usdBySource: Map<string, number>;
  // Fuentes con alguna ejecución sin importe informado: su coste es un mínimo.
  partial: Set<string>;
  // Euros por dólar. `null` = no se pudo leer el tipo: el coste en € queda en «—».
  eurPerUsd: number | null;
};
export type SourceRow = {
  source: string;
  // Anuncios ingeridos vivos de esa fuente (la base los cuenta, no una muestra).
  ingested: number | null;
  sent: number;
  responded: number;
  interviews: number;
  offers: number;
  rejected: number;
  // Por cada 1.000 anuncios ingeridos. `null` cuando no hay denominador: un hueco no es un cero.
  per_1000: { sent: number | null; responded: number | null; interviews: number | null; offers: number | null };
  // Coste registrado en USD (Apify + respaldo de SerpApi). `null` = no hay coste registrado (no es 0).
  cost_usd: number | null;
  // El mismo coste en euros. `null` si falta el tipo de cambio o el coste.
  cost_eur: number | null;
  // Coste registrado dividido por envíos y por entrevistas. `null` sin coste o sin denominador.
  per_send_eur: number | null;
  per_interview_eur: number | null;
  // El coste es un mínimo: alguna ejecución no informó importe.
  cost_partial: boolean;
  // Candidaturas cuya oferta ya no está en la tabla (borrada o caducada): se cuentan aparte en vez de
  // inventarles una fuente.
  unlinked?: boolean;
};

export const SENT_STATUSES = ['applied', 'responded', 'interview', 'offer', 'rejected'] as const;
const RESPONDED = ['responded', 'interview', 'offer', 'rejected'];
// `interview` incluye la oferta: una oferta es una entrevista que salió bien, y contarla en las dos
// columnas sería contar dos veces el mismo éxito.
const INTERVIEW = ['interview', 'offer'];

const rate = (count: number, base: number | null): number | null => {
  if (base === null || base <= 0) return null;
  return Math.round((count / base) * 1000 * 10) / 10;
};
const money = (value: number, digits = 4) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Agrupa candidaturas por fuente y calcula el marcador. `sourcesOf` mapea `offer_ref` → fuente. */
export function scorecard(
  applications: AppStatusLite[],
  sourcesOf: Map<string, string>,
  ingested: Map<string, number | null>,
  costs?: CostInput,
): SourceRow[] {
  const rows = new Map<string, SourceRow>();
  const row = (source: string): SourceRow => {
    const found = rows.get(source);
    if (found) return found;
    const created: SourceRow = {
      source, ingested: ingested.get(source) ?? null, sent: 0, responded: 0, interviews: 0, offers: 0, rejected: 0,
      per_1000: { sent: null, responded: null, interviews: null, offers: null },
      cost_usd: null, cost_eur: null, per_send_eur: null, per_interview_eur: null, cost_partial: false,
    };
    rows.set(source, created);
    return created;
  };

  let unlinked = 0;
  for (const application of applications) {
    const source = sourcesOf.get(application.offer_ref);
    if (!source) { unlinked += 1; continue; }
    const target = row(source);
    if ((SENT_STATUSES as readonly string[]).includes(application.status)) target.sent += 1;
    if (RESPONDED.includes(application.status)) target.responded += 1;
    if (INTERVIEW.includes(application.status)) target.interviews += 1;
    if (application.status === 'offer') target.offers += 1;
    if (application.status === 'rejected') target.rejected += 1;
  }

  // Las fuentes ingeridas sin ninguna candidatura también salen: son justo las que hay que mirar.
  for (const [source, count] of ingested) if (!rows.has(source)) row(source).ingested = count;
  // Y una fuente que gastó dinero sin dejar anuncios vivos también: el coste sin catálogo es una señal.
  // Su denominador queda en «—» porque no hay anuncios vivos que contar.
  for (const source of costs?.usdBySource.keys() ?? []) if (!rows.has(source)) row(source);

  const out = [...rows.values()].map(item => {
    const usd = costs?.usdBySource.get(item.source);
    const cost_usd = usd === undefined ? null : money(usd, 6);
    const cost_eur = cost_usd === null || costs?.eurPerUsd == null ? null : money(cost_usd * costs.eurPerUsd);
    return {
      ...item,
      cost_usd, cost_eur,
      per_send_eur: cost_eur === null || item.sent === 0 ? null : money(cost_eur / item.sent),
      per_interview_eur: cost_eur === null || item.interviews === 0 ? null : money(cost_eur / item.interviews),
      cost_partial: costs?.partial.has(item.source) ?? false,
      per_1000: {
        sent: rate(item.sent, item.ingested),
        responded: rate(item.responded, item.ingested),
        interviews: rate(item.interviews, item.ingested),
        offers: rate(item.offers, item.ingested),
      },
    };
  });
  // Orden por lo que sirve para decidir: rendimiento (entrevistas por 1.000), después volumen y nombre.
  out.sort((a, b) => (b.per_1000.interviews ?? -1) - (a.per_1000.interviews ?? -1)
    || (b.per_1000.sent ?? -1) - (a.per_1000.sent ?? -1)
    || b.sent - a.sent
    || (b.ingested ?? 0) - (a.ingested ?? 0)
    || a.source.localeCompare(b.source));
  if (unlinked) out.push({ source: 'sin fuente localizable', ingested: null, sent: unlinked, responded: 0, interviews: 0, offers: 0, rejected: 0, per_1000: { sent: null, responded: null, interviews: null, offers: null }, cost_usd: null, cost_eur: null, per_send_eur: null, per_interview_eur: null, cost_partial: false, unlinked: true });
  return out;
}

/** Totales de la tabla, para el rótulo de arriba. */
export function scorecardTotals(rows: SourceRow[]) {
  const sum = (pick: (row: SourceRow) => number) => rows.reduce((total, row) => total + pick(row), 0);
  const linked = rows.filter(row => !row.unlinked);
  // El coste total solo suma lo que tiene importe; si nada lo tiene, es un hueco (—), no 0.
  const usd = rows.filter(row => row.cost_usd !== null);
  const eur = rows.filter(row => row.cost_eur !== null);
  const cost_usd = usd.length ? money(usd.reduce((total, row) => total + (row.cost_usd ?? 0), 0), 6) : null;
  const cost_eur = eur.length ? money(eur.reduce((total, row) => total + (row.cost_eur ?? 0), 0)) : null;
  const sent = sum(row => row.sent), interviews = sum(row => row.interviews);
  return {
    sources: linked.length,
    ingested: sum(row => row.ingested ?? 0),
    sent, responded: sum(row => row.responded),
    interviews, offers: sum(row => row.offers),
    cost_sources: eur.length,
    cost_usd, cost_eur,
    per_send_eur: cost_eur === null || sent === 0 ? null : money(cost_eur / sent),
    per_interview_eur: cost_eur === null || interviews === 0 ? null : money(cost_eur / interviews),
    cost_partial: rows.some(row => row.cost_partial),
  };
}
