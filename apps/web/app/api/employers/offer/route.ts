import { NextRequest } from 'next/server';
import { clientIp } from '../../../../lib/practiceBudget';
import { submitEmployerOffer } from '../../../../lib/employerStore';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

// Entrada PÚBLICA del formulario de empleadores: sin sesión. Lo que la protege son los límites del almacén (por origen y por email al día),
// el honeypot, el tamaño del cuerpo y que solo entra como borrador. Se rechaza una petición de otro sitio web (Origin distinto del propio).
const MAX_BODY = 30_000;
const json = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin'), host = request.headers.get('host');
  if (origin) { let same = false; try { same = new URL(origin).host === host; } catch { same = false; } if (!same) return json(403, { detail: 'Origen no permitido.' }); }
  const text = await request.text().catch(() => '');
  if (text.length > MAX_BODY) return json(413, { detail: 'La oferta es demasiado larga.' });
  let body: unknown = null; try { body = JSON.parse(text); } catch { return json(422, { detail: 'Cuerpo no válido.' }); }
  const result = await submitEmployerOffer(body, clientIp(request.headers));
  return json(result.status, result.body);
}
