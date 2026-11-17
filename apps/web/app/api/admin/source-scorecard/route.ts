import { NextRequest } from 'next/server';
import { authenticate, withCookies } from '../../../../lib/adminAuth';
import { statsBySource } from '../../../../lib/external';
import { ORG } from '../../../../lib/external';
import { pagedRest, serviceRest } from '../../../../lib/supabaseAuth';
import { scorecard, scorecardTotals, type AppStatusLite } from '../../../../lib/sourceScorecard';
import { recordedCosts, type ActorLite, type NoteLite, type RunLite } from '../../../../lib/sourceCost';
import { eurRate } from '../../../../lib/fx';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Marcador por fuente: qué pasa DESPUÉS de publicar. Cruza `student_applications` (estado declarado
// por la alumna) con la fuente de la oferta (`external_offers.source`) y lo divide entre los anuncios
// vivos de esa fuente. No retira nada: solo mide. Solo lectura, y sin datos personales: se piden
// `offer_ref` y `status`, nunca `user_id` ni textos.
//
// El coste se LEE de donde ya está escrito: `apify_runs.cost_usd` (por su actor → fuente) y la nota
// «respaldo SerpApi · N búsqueda(s), X USD» de `external_ingest_runs`. No se estima ni se completa con
// precios de lista. Si una lectura falla, el marcador se pinta igual y el coste queda en «—» con su causa.
const UUID = /^ext-([0-9a-f-]{36})$/;

async function sourcesOf(offerRefs: string[]): Promise<Map<string, string> | null> {
  const ids = offerRefs.map(ref => UUID.exec(ref)?.[1]).filter((id): id is string => Boolean(id));
  const map = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 80) {
    const batch = ids.slice(i, i + 80);
    const response = await serviceRest(`external_offers?org_id=eq.${ORG}&id=in.(${batch.join(',')})&select=id,source`);
    const rows = response.ok ? await response.json().catch(() => null) : null;
    if (!Array.isArray(rows)) return null;
    for (const row of rows as Array<{ id?: string; source?: string }>) {
      if (typeof row.id === 'string' && typeof row.source === 'string') map.set(`ext-${row.id}`, row.source);
    }
  }
  return map;
}

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth.ok) return Response.json({ detail: auth.detail }, { status: auth.status });

  const [applications, stats, actorsResponse, runs, notes, fx] = await Promise.all([
    pagedRest<AppStatusLite>(`student_applications?org_id=eq.${ORG}&select=offer_ref,status`, 'id.asc'),
    statsBySource(),
    serviceRest(`apify_actors?org_id=eq.${ORG}&select=id,source`).catch(() => null),
    pagedRest<RunLite>(`apify_runs?org_id=eq.${ORG}&select=actor_id,cost_usd,status`, 'id.asc').catch(() => null),
    pagedRest<NoteLite>(`external_ingest_runs?org_id=eq.${ORG}&select=source,note&note=like.${encodeURIComponent('*respaldo SerpApi*')}`, 'id.asc').catch(() => null),
    eurRate().catch(() => null),
  ]);
  if (!applications || !stats) return Response.json({ detail: 'No se pudo cruzar el tablero con las fuentes ahora mismo.' }, { status: 503 });

  const sources = await sourcesOf([...new Set(applications.rows.map(row => row.offer_ref))]);
  if (!sources) return Response.json({ detail: 'No se pudo leer la fuente de las ofertas ahora mismo.' }, { status: 503 });

  const actors = actorsResponse?.ok ? await actorsResponse.json().catch(() => null) : null;
  // Un tope de paginación alcanzado deja el coste incompleto: se declara como hueco en vez de sumar de menos.
  const cost = runs?.truncated || notes?.truncated || !Array.isArray(actors) || !runs || !notes
    ? null
    : recordedCosts(actors as ActorLite[], runs.rows, notes.rows);
  const ingested = new Map(stats.map(stat => [stat.source, stat.live]));
  const rows = scorecard(applications.rows, sources, ingested, cost ? {
    usdBySource: cost.usdBySource, partial: cost.partial, eurPerUsd: fx?.eur_per_usd ?? null,
  } : undefined);
  const totals = scorecardTotals(rows);
  return withCookies(Response.json({
    rows,
    totals,
    // Se declara qué cuenta el denominador: anuncios VIVOS (sin caducar) por fuente, no el histórico.
    basis: 'anuncios vivos por fuente',
    cost: {
      recorded_currency: 'USD',
      display_currency: 'EUR',
      fx: fx ? { eur_per_usd: fx.eur_per_usd, source: fx.source, date: fx.date } : null,
      unattributed_usd: cost?.unattributed_usd ?? null,
      error: cost ? null : 'No se pudo leer el coste registrado (Apify o notas de respaldo de SerpApi): las columnas de coste salen en «—».',
      note: 'Coste registrado de todo el histórico: ejecuciones de Apify (importe real) y respaldo de SerpApi (importe anotado). SerpApi de Google Jobs no guarda importe por ejecución y no suma.',
    },
    truncated: applications.truncated,
    generated_at: new Date().toISOString(),
  }, { headers: { 'Cache-Control': 'no-store' } }), auth.setCookies);
}
