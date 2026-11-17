// Marcador por fuente: cruza los estados del tablero de candidaturas con la fuente de la oferta.
// Es lo que convierte el tablero de la alumna en una señal de calidad del motor — y solo eso: aquí
// no se retira nada. Piezas puras para poder medirlas sin base de datos; el lector vive en la ruta.

export type AppStatusLite = { offer_ref: string; status: string };
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

/** Agrupa candidaturas por fuente y calcula el marcador. `sourcesOf` mapea `offer_ref` → fuente. */
export function scorecard(
  applications: AppStatusLite[],
  sourcesOf: Map<string, string>,
  ingested: Map<string, number | null>,
): SourceRow[] {
  const rows = new Map<string, SourceRow>();
  const row = (source: string): SourceRow => {
    const found = rows.get(source);
    if (found) return found;
    const created: SourceRow = { source, ingested: ingested.get(source) ?? null, sent: 0, responded: 0, interviews: 0, offers: 0, rejected: 0, per_1000: { sent: null, responded: null, interviews: null, offers: null } };
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

  const out = [...rows.values()].map(item => ({
    ...item,
    per_1000: {
      sent: rate(item.sent, item.ingested),
      responded: rate(item.responded, item.ingested),
      interviews: rate(item.interviews, item.ingested),
      offers: rate(item.offers, item.ingested),
    },
  }));
  // Orden por lo que sirve para decidir: rendimiento (entrevistas por 1.000), después volumen y nombre.
  out.sort((a, b) => (b.per_1000.interviews ?? -1) - (a.per_1000.interviews ?? -1)
    || (b.per_1000.sent ?? -1) - (a.per_1000.sent ?? -1)
    || b.sent - a.sent
    || (b.ingested ?? 0) - (a.ingested ?? 0)
    || a.source.localeCompare(b.source));
  if (unlinked) out.push({ source: 'sin fuente localizable', ingested: null, sent: unlinked, responded: 0, interviews: 0, offers: 0, rejected: 0, per_1000: { sent: null, responded: null, interviews: null, offers: null }, unlinked: true });
  return out;
}

/** Totales de la tabla, para el rótulo de arriba. */
export function scorecardTotals(rows: SourceRow[]) {
  const sum = (pick: (row: SourceRow) => number) => rows.reduce((total, row) => total + pick(row), 0);
  const linked = rows.filter(row => !row.unlinked);
  return {
    sources: linked.length,
    ingested: sum(row => row.ingested ?? 0),
    sent: sum(row => row.sent), responded: sum(row => row.responded),
    interviews: sum(row => row.interviews), offers: sum(row => row.offers),
  };
}
