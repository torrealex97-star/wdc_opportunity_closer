import { NextRequest } from 'next/server';
import { authenticate, withCookies } from '../../../../lib/adminAuth';
import { readSamples } from '../../../../lib/sourceSample';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Muestra por fuente (objetivo de 1.000 ofertas recogidas antes de juzgar una fuente de pago). Solo lectura, para
// cualquier operador: no pausa ni recorta nada.
export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth.ok) return Response.json({ detail: auth.detail }, { status: auth.status });
  const payload = await readSamples();
  if (!payload) return withCookies(Response.json({ detail: 'No se pudo leer la lista de fuentes ahora mismo.' }, { status: 503 }), auth.setCookies);
  return withCookies(Response.json(payload, { headers: { 'Cache-Control': 'no-store' } }), auth.setCookies);
}
