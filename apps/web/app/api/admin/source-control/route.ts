import { NextRequest } from 'next/server';
import { authenticate, withCookies } from '../../../../lib/adminAuth';
import { loadSourceControl } from '../../../../lib/sourceControlData';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Control total de fuentes: cuántas dan ofertas cualificadas y la lista de las que hay que trabajar, con causa y siguiente paso. Solo lectura para cualquier operador.
export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth.ok) return Response.json({ detail: auth.detail }, { status: auth.status });
  const payload = await loadSourceControl();
  if (!payload) return withCookies(Response.json({ detail: 'No se pudo leer el estado de las fuentes ahora mismo.' }, { status: 503 }), auth.setCookies);
  return withCookies(Response.json(payload, { headers: { 'Cache-Control': 'no-store' } }), auth.setCookies);
}
