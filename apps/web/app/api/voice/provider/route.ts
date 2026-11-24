import type { NextRequest } from 'next/server';
import { workerAuthorized, workerConfigured } from '../../../../lib/voiceWorker';
import { currentCascade, secretFor } from '../../../../lib/voiceEvents';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// El servicio de voz pregunta con qué proveedor abrir la sesión: el más barato con clave y sano. Devuelve también la clave de ESE proveedor
// (solo a quien presenta VOICE_WORKER_TOKEN, nunca al navegador) para que bastee con guardarla en APIs. Si ninguno sirve: 503 y el motivo de cada uno.
export async function GET(request: NextRequest) {
  if (!workerConfigured()) return Response.json({ detail: 'El servicio de voz no está configurado.' }, { status: 503 });
  if (!workerAuthorized(request)) return Response.json({ detail: 'No autorizado.' }, { status: 401 });
  const cascade = await currentCascade();
  const headers = { 'Cache-Control': 'no-store' };
  const order = cascade.order.map(e => ({ id: e.id, state: e.state, reason: e.reason, until: e.until }));
  if (!cascade.chosen) return Response.json({ detail: cascade.readable ? 'Ningún proveedor de voz disponible.' : 'No se pudieron leer las claves o las incidencias.', order }, { status: 503, headers });
  const secret = await secretFor(cascade.chosen);
  if (!secret) return Response.json({ detail: 'No se pudo leer la clave del proveedor elegido.', order }, { status: 503, headers });
  return Response.json({ provider: cascade.chosen, api_key: secret, fallbacks: order.filter(e => e.state === 'activo' && e.id !== cascade.chosen).map(e => e.id), order }, { headers });
}
