import { NextRequest } from 'next/server';
import { authenticate, withCookies } from '../../../../lib/adminAuth';
import { statsBySource } from '../../../../lib/external';
import { ORG } from '../../../../lib/external';
import { pagedRest, serviceRest } from '../../../../lib/supabaseAuth';
import { scorecard, scorecardTotals, type AppStatusLite } from '../../../../lib/sourceScorecard';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Marcador por fuente: qué pasa DESPUÉS de publicar. Cruza `student_applications` (estado declarado
// por la alumna) con la fuente de la oferta (`external_offers.source`) y lo divide entre los anuncios
// vivos de esa fuente. No retira nada: solo mide. Solo lectura, y sin datos personales: se piden
// `offer_ref` y `status`, nunca `user_id` ni textos.
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

  const [applications, stats] = await Promise.all([
    pagedRest<AppStatusLite>(`student_applications?org_id=eq.${ORG}&select=offer_ref,status`, 'id.asc'),
    statsBySource(),
  ]);
  if (!applications || !stats) return Response.json({ detail: 'No se pudo cruzar el tablero con las fuentes ahora mismo.' }, { status: 503 });

  const sources = await sourcesOf([...new Set(applications.rows.map(row => row.offer_ref))]);
  if (!sources) return Response.json({ detail: 'No se pudo leer la fuente de las ofertas ahora mismo.' }, { status: 503 });

  const ingested = new Map(stats.map(stat => [stat.source, stat.live]));
  const rows = scorecard(applications.rows, sources, ingested);
  return withCookies(Response.json({
    rows,
    totals: scorecardTotals(rows),
    // Se declara qué cuenta el denominador: anuncios VIVOS (sin caducar) por fuente, no el histórico.
    basis: 'anuncios vivos por fuente',
    truncated: applications.truncated,
    generated_at: new Date().toISOString(),
  }, { headers: { 'Cache-Control': 'no-store' } }), auth.setCookies);
}
