import { NextRequest } from 'next/server';
import { authenticate, originBlocked, withCookies } from '../../../../lib/adminAuth';
import { apifyToken, monthSpent } from '../../../../lib/apify';
import { listConnections } from '../../../../lib/integrations';
import { readBudget } from '../../../../lib/paidBudget';
import { isMetered, setProviderCap, spendOverview } from '../../../../lib/providerCaps';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

// Control de inversión: UNA vista del gasto del mes y del tope de TODOS los proveedores de pago (Apify,
// Bright Data, SerpApi, ZenRows y ScrapingBee). Leer: cualquier operador. Cambiar un tope: solo el propietario.
// El gasto no se estima: se suma de lo ya registrado (`apify_runs.cost_usd` y las notas `proveedor=… ·
// coste_usd=…`). Sin historial legible el importe sale `null` y el panel lo dice; nunca 0.
async function gate(request: NextRequest, ownerOnly: boolean) {
  if (originBlocked(request)) return { error: Response.json({ detail: 'Origen no permitido' }, { status: 403 }) };
  const auth = await authenticate(request);
  if (!auth.ok) return { error: Response.json({ detail: auth.detail }, { status: auth.status }) };
  if (ownerOnly && auth.admin.role !== 'owner') return { error: Response.json({ detail: 'Solo el propietario puede cambiar un tope de gasto.' }, { status: 403 }) };
  return { auth };
}
const reply = (auth: { setCookies: string[] }, body: unknown, status = 200) => withCookies(Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } }), auth.setCookies);

export async function GET(request: NextRequest) {
  const { auth, error } = await gate(request, false);
  if (error) return error;
  const [overview, connections, apifySpent, apifyBudget, token] = await Promise.all([
    spendOverview(), listConnections(), monthSpent(), readBudget(), apifyToken(),
  ]);
  const keys = new Set((connections ?? []).map(row => row.provider));
  return reply(auth!, {
    month_from: overview.month_from,
    table_ok: overview.table_ok,
    spent_readable: overview.spent_readable,
    keys_readable: connections !== null,
    providers: overview.rows.map(row => ({ ...row, configured: connections === null ? null : keys.has(row.provider) })),
    apify: {
      configured: Boolean(token),
      spent_usd: apifySpent === null ? null : Number(apifySpent.toFixed(4)),
      cap_usd: apifyBudget.usd,
      cap_source: apifyBudget.source,
      cap_updated_by: apifyBudget.updated_by,
      cap_updated_at: apifyBudget.updated_at,
      note: apifyBudget.error,
    },
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { provider?: unknown; monthly_usd?: unknown };
  const { auth, error } = await gate(request, true);
  if (error) return error;
  if (!isMetered(body.provider)) return Response.json({ detail: 'Proveedor no válido. Apify tiene su propio control en la pestaña Apify.' }, { status: 422 });
  // Solo un número o un texto decimal no vacío: `' '`, `true` o `[5]` no son un importe (y un 0 accidental apagaría el gasto).
  const raw = body.monthly_usd;
  const usd = typeof raw === 'number' ? raw : typeof raw === 'string' && /^\s*\d+(?:[.,]\d+)?\s*$/.test(raw) ? Number(raw.replace(',', '.')) : Number.NaN;
  if (!Number.isFinite(usd) || usd < 0 || usd > 5000) {
    return Response.json({ detail: 'El tope mensual debe ser un importe en USD entre 0 y 5000 (0 = no se gasta nada).' }, { status: 422 });
  }
  if (!await setProviderCap(body.provider, usd, auth!.admin.email)) {
    return Response.json({ detail: 'No se pudo guardar el tope. Si es la primera vez, falta la tabla provider_budget (migración 20261121_provider_budget.sql).' }, { status: 503 });
  }
  return reply(auth!, { ok: true, provider: body.provider, monthly_usd: Math.round(usd * 100) / 100, message: `Tope mensual guardado: ${Math.round(usd * 100) / 100} USD. Manda desde la siguiente búsqueda automática.` });
}
