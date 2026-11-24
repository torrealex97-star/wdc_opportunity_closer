import type { NextRequest } from 'next/server';
import { workerAuthorized, workerConfigured } from '../../../../lib/voiceWorker';
import { recordVoiceEvent } from '../../../../lib/voiceEvents';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// El servicio de voz avisa de lo que le pasó con un proveedor: `ok`, `error` (red, 5xx, 429), `payment` (402, sin saldo) o `auth` (401/403).
// La cascada lo usa para saltar al siguiente. Una anotación que no se pudo guardar se declara (503): no se da por hecha.
export async function POST(request: NextRequest) {
  if (!workerConfigured()) return Response.json({ detail: 'El servicio de voz no está configurado.' }, { status: 503 });
  if (!workerAuthorized(request)) return Response.json({ detail: 'No autorizado.' }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { provider?: unknown; kind?: unknown; detail?: unknown };
  const result = await recordVoiceEvent(String(body.provider ?? ''), String(body.kind ?? ''), typeof body.detail === 'string' ? body.detail : undefined);
  if (result.ok) return Response.json({ recorded: true }, { headers: { 'Cache-Control': 'no-store' } });
  return Response.json({ detail: result.error }, { status: result.kind === 'invalid' ? 422 : 503 });
}
