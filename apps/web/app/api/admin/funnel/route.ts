import { NextRequest } from 'next/server';
import { authenticate, withCookies } from '../../../../lib/adminAuth';
import { loadFunnel, RANGE_DAYS, type FunnelMarket } from '../../../../lib/funnel';

const MARKETS = ['ES', 'LATAM', 'LATAM_DEFECTO', 'US_LATINO', 'SIN_MERCADO'] as const;

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth.ok) return Response.json({ detail: auth.detail }, { status: auth.status });
  const q = request.nextUrl.searchParams;
  const days = Number(q.get('days')); const role = q.get('role'); const market = q.get('market');
  const filter = {
    days: (RANGE_DAYS as readonly number[]).includes(days) ? days : 7,
    role: role && /^[a-z_]{2,30}$/.test(role) ? role : null,
    market: (MARKETS as readonly string[]).includes(market ?? '') ? market as FunnelMarket : null,
  };
  const funnel = await loadFunnel(new Date(), filter);
  if (!funnel) return Response.json({ detail: 'No se pudo calcular el embudo.' }, { status: 503 });
  return withCookies(Response.json(funnel, { headers: { 'Cache-Control': 'no-store' } }), auth.setCookies);
}
