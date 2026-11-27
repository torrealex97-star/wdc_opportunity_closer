import { NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { runAlerts } from '../../../../lib/studentAlerts';
import { liveAlertDeps } from '../../../../lib/studentAlertsStore';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
const BUDGET_MS = 40_000; // muy por debajo de maxDuration; si se corta, se declara `truncated` y la siguiente pasada continúa (idempotente)

// Vercel Cron llama aquí con `Authorization: Bearer $CRON_SECRET`. Apagado por defecto (STUDENT_ALERTS_ENABLED): sin autorización del propietario no sale ningún correo.
export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET ?? '', given = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(given), b = Buffer.from(expected);
  if (expected.length < 16 || a.length !== b.length || !timingSafeEqual(a, b)) return Response.json({ detail: 'No autorizado.' }, { status: 401 });
  const end = Date.now() + BUDGET_MS;
  const result = await runAlerts(await liveAlertDeps(() => Date.now() > end));
  return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
}
