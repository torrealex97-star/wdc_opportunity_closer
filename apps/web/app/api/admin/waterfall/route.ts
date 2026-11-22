import { NextRequest } from 'next/server';
import { authenticate, originBlocked, withCookies } from '../../../../lib/adminAuth';
import { apifyToken, listActors, monthSpent } from '../../../../lib/apify';
import { listConnections } from '../../../../lib/integrations';
import { readBudget } from '../../../../lib/paidBudget';
import { PROVIDER_METERS } from '../../../../lib/providerBudget';
import { spendOverview, type SpendRow } from '../../../../lib/providerCaps';
import { maxSearches } from '../../../../lib/serpapiFallback';
import { rapidApiMaxRequests } from '../../../../lib/rapidapiCollect';
import { planStages, type StageInput } from '../../../../lib/waterfall';
import { readTarget, waterfallState, writeTarget } from '../../../../lib/waterfallStore';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;

// Objetivo diario de ofertas cualificadas y plan del waterfall. Leer: cualquier operador. Cambiar el objetivo: solo
// el propietario. El plan es el MISMO que sigue el cron (`/api/cron/collect`): lo gratuito primero y, mientras falte
// objetivo, las vías de pago por coste, cada una con su tope. Aquí se calcula en vivo; no se guarda ningún historial.
async function gate(request: NextRequest, ownerOnly: boolean) {
  if (originBlocked(request)) return { error: Response.json({ detail: 'Origen no permitido' }, { status: 403 }) };
  const auth = await authenticate(request);
  if (!auth.ok) return { error: Response.json({ detail: auth.detail }, { status: auth.status }) };
  if (ownerOnly && auth.admin.role !== 'owner') return { error: Response.json({ detail: 'Solo el propietario puede cambiar el objetivo.' }, { status: 403 }) };
  return { auth };
}
const reply = (auth: { setCookies: string[] }, body: unknown, status = 200) => withCookies(Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } }), auth.setCookies);

/** ¿Queda tope para al menos una petición? `unreadable` si el gasto no se pudo leer (entonces no se gasta). */
const room = (row: SpendRow | undefined): { ok: boolean; why: string | null } => {
  if (!row) return { ok: false, why: 'Proveedor desconocido.' };
  if (row.spent_usd === null) return { ok: false, why: `No se pudo leer lo gastado con ${row.name}: no se gasta.` };
  if ((row.remaining_usd ?? 0) < row.usd_per_request) return { ok: false, why: `Tope mensual de ${row.name} agotado (quedan ${(row.remaining_usd ?? 0).toFixed(2)} USD).` };
  return { ok: true, why: null };
};

export async function GET(request: NextRequest) {
  const { auth, error } = await gate(request, false);
  if (error) return error;
  const [state, overview, connections, token, actors, budget, apifySpent] = await Promise.all([
    waterfallState(), spendOverview(), listConnections(), apifyToken(), listActors(), readBudget(), monthSpent(),
  ]);
  const keys = new Set((connections ?? []).map(row => row.provider));
  const keysKnown = connections !== null;
  const noKey = (name: string) => keysKnown ? `Sin clave de ${name}.` : `No se pudieron leer las conexiones: no se sabe si hay clave de ${name}.`;
  const row = (provider: string) => overview.rows.find(r => r.provider === provider);
  const bright = row('brightdata'), jsr = row('jsearch'), serp = row('serpapi');
  const brightOk = keysKnown && keys.has('brightdata') && room(bright).ok, jsrOk = keysKnown && keys.has('jsearch') && room(jsr).ok, serpOk = keysKnown && keys.has('serpapi') && room(serp).ok;
  const fallbackMax = maxSearches();
  const googleWhy = !brightOk && !jsrOk && !serpOk
    ? [
        !keysKnown || !keys.has('brightdata') ? noKey('Bright Data') : room(bright).why,
        !keysKnown || !keys.has('jsearch') ? noKey('JSearch') : room(jsr).why,
        !keysKnown || !keys.has('serpapi') ? noKey('SerpApi') : room(serp).why,
      ].filter(Boolean).join(' ')
    : null;
  const dailyPortals = actors === null ? null : actors.filter(a => a.schedule_daily).length;
  const apifyLeft = apifySpent === null ? null : Math.max(0, budget.usd - apifySpent);
  const stages: StageInput[] = [
    {
      id: 'google-jobs', label: 'Google Jobs', automatic: true,
      unit: `Bright Data ${PROVIDER_METERS.brightdata.usdPerRequest} USD primero; JSearch ${PROVIDER_METERS.jsearch.usdPerRequest} USD; SerpApi ${PROVIDER_METERS.serpapi.usdPerRequest} USD de respaldo, por búsqueda`,
      available: brightOk || jsrOk || serpOk, reason: googleWhy,
    },
    {
      id: 'rapidapi', label: 'APIs de empleo de RapidAPI', automatic: true,
      unit: `~${PROVIDER_METERS.rapidapi.usdPerRequest} USD por búsqueda (según el plan de cada API), hasta ${rapidApiMaxRequests()} por pasada`,
      available: keysKnown && keys.has('rapidapi') && room(row('rapidapi')).ok && rapidApiMaxRequests() > 0,
      reason: !keysKnown || !keys.has('rapidapi') ? noKey('RapidAPI') : rapidApiMaxRequests() === 0 ? 'Desactivado (RAPIDAPI_MAX_REQUESTS=0).' : room(row('rapidapi')).why,
    },
    {
      id: 'respaldo', label: 'Respaldo por portal (SerpApi)', automatic: true,
      unit: `${PROVIDER_METERS.serpapi.usdPerRequest} USD por búsqueda, hasta ${fallbackMax} por pasada`,
      available: serpOk && fallbackMax !== 0,
      reason: !keysKnown || !keys.has('serpapi') ? noKey('SerpApi') : fallbackMax === 0 ? 'Respaldo desactivado (SERPAPI_FALLBACK_MAX_SEARCHES=0).' : room(serp).why,
    },
    {
      id: 'apify', label: 'Actores de Apify', automatic: true,
      unit: 'Pago por resultado, con el tope mensual de Apify',
      available: Boolean(token) && dailyPortals !== null && dailyPortals > 0 && apifyLeft !== null && apifyLeft > 0,
      reason: !token ? 'Sin token de Apify.' : dailyPortals === null ? 'No se pudieron leer los portales de Apify: no se gasta.' : dailyPortals === 0 ? 'Ningún portal con búsqueda diaria activada.' : apifyLeft === null ? 'No se pudo leer lo gastado en Apify: no se gasta.' : apifyLeft <= 0 ? 'Tope mensual de Apify agotado.' : null,
    },
    {
      id: 'unlocker', label: 'Unlocker, ZenRows y ScrapingBee', automatic: false,
      unit: `Desde ${PROVIDER_METERS.brightdata.usdPerRequest} USD por página`,
      available: keysKnown && (keys.has('brightdata') || keys.has('zenrows') || keys.has('scrapingbee')),
      reason: 'Se lanzan a mano (Fuentes → Probar ruta): leer el HTML de una empresa necesita un extractor por página y aún no se automatiza.',
    },
  ];
  return reply(auth!, {
    state, stages: planStages(state.gap, stages),
    free: 'Motor y APIs oficiales: gratis, corren siempre antes que las de pago.',
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { qualified_per_day?: unknown };
  const { auth, error } = await gate(request, true);
  if (error) return error;
  const saved = await writeTarget(body.qualified_per_day, auth!.admin.email);
  if (!saved.ok) return Response.json({ detail: saved.error }, { status: saved.kind === 'invalid' ? 422 : 503 });
  const target = await readTarget();
  return reply(auth!, { ok: true, target: saved.target, source: target.source, message: `Objetivo guardado: ${saved.target} ofertas cualificadas al día. Manda desde la siguiente recogida automática.` });
}
