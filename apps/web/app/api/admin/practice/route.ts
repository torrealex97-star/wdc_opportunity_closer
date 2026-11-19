import { NextRequest } from 'next/server';
import { authenticate, originBlocked, withCookies } from '../../../../lib/adminAuth';
import { DEFAULT_BANT, DEFAULT_PRIORITIES, DEFAULT_RUBRICS, ROOMS } from '../../../../lib/practiceRubrics';
import { loadPracticeConfig, resetPracticeConfig, savePracticeConfig } from '../../../../lib/practiceRubricStore';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Criterios de la sala de práctica: el panel los lee y los edita. La escritura exige el mismo
// operador autenticado que el resto del panel y comprueba el origen; el valor se valida entero antes
// de guardar (una rúbrica a medias cambiaría notas sin que nadie lo note).
async function gate(request: NextRequest, write: boolean) {
  if (write && originBlocked(request)) return { error: Response.json({ detail: 'Origen no permitido' }, { status: 403 }) };
  const auth = await authenticate(request);
  if (!auth.ok) return { error: Response.json({ detail: auth.detail }, { status: auth.status }) };
  return { auth };
}
const reply = (auth: { setCookies: string[] }, body: unknown, status = 200) =>
  withCookies(Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } }), auth.setCookies);

export async function GET(request: NextRequest) {
  const { auth, error } = await gate(request, false);
  if (error) return error;
  const config = await loadPracticeConfig(request.nextUrl.searchParams.get('fresh') === '1');
  return reply(auth!, {
    config: { rubrics: config.rubrics, priorities: config.priorities, bant: config.bant },
    defaults: { rubrics: DEFAULT_RUBRICS, priorities: DEFAULT_PRIORITIES, bant: DEFAULT_BANT },
    rooms: ROOMS,
    source: config.source,
    reason: config.reason,
    updated_at: config.updated_at,
    updated_by: config.updated_by,
  });
}

export async function PUT(request: NextRequest) {
  const { auth, error } = await gate(request, true);
  if (error) return error;
  const body = await request.json().catch(() => null);
  const result = await savePracticeConfig(body, auth!.admin.email);
  if (!result.ok) return Response.json({ detail: result.detail }, { status: result.status });
  return reply(auth!, {
    config: { rubrics: result.config.rubrics, priorities: result.config.priorities, bant: result.config.bant },
    source: result.config.source,
    reason: result.config.reason,
    updated_at: result.config.updated_at,
    updated_by: result.config.updated_by,
  });
}

export async function DELETE(request: NextRequest) {
  const { auth, error } = await gate(request, true);
  if (error) return error;
  const result = await resetPracticeConfig();
  if (!result.ok) return Response.json({ detail: result.detail }, { status: 503 });
  return reply(auth!, {
    config: { rubrics: DEFAULT_RUBRICS, priorities: DEFAULT_PRIORITIES, bant: DEFAULT_BANT },
    source: 'defaults',
    reason: null,
    updated_at: null,
    updated_by: null,
  });
}
