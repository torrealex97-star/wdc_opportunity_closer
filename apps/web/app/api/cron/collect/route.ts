import { NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { collectAll } from '../../../../lib/collectors';
import { collectFallback } from '../../../../lib/serpapiFallback';
import { loadMeter } from '../../../../lib/providerCaps';
import { waterfallState } from '../../../../lib/waterfallStore';
import { collectGoogleJobs } from '../../../../lib/googleJobs';
import { collectBrightAsync } from '../../../../lib/brightdataAsync';
import { collectRapidApi } from '../../../../lib/rapidapiCollect';
import { collectTavily } from '../../../../lib/tavilyCollect';
import { runFeedStage } from '../../../../lib/brightdataFeedRun';
import { collectCompanyPages, enginePagesOrSeed, mergePages } from '../../../../lib/companyPagesCollect';
import { COMPANY_WATCHLIST } from '../../../../lib/companyWatchlist';
import { dailyAuto as dailyApify } from '../../../../lib/apifyAuto';
import { publicBaseUrl } from '../../../../lib/adminAuth';
import { weeklyAiReport } from '../../../../lib/aiReview';
import { runAutoReview } from '../../../../lib/autoReview';
import { enrichDescriptions } from '../../../../lib/descriptionEnrich';
import { activateEngine } from '../../../../lib/engineActivate';
import { loadMetrics } from '../../../../lib/metrics';
import { skipPaidTier } from '../../../../lib/sourceTiers';
import { CRON_LOG_SOURCE, ORG, recordSpend, refreshVigencia } from '../../../../lib/external';
import { FLOOR_LIMITS, floorDue, lastRanByStage, stageNote, type StageRow } from '../../../../lib/spendFloor';
import { pagedRest } from '../../../../lib/supabaseAuth';
import { checkEngine } from '../../../../lib/engineAlert';
import { createBudget, MIN_STEP_MS, totalFromEnv } from '../../../../lib/cronBudget';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Un paso que falla no tumba el cron, pero deja rastro en los logs de Vercel (antes parecía «truncado» o «sin motor»).
const failed = <T,>(step: string, fallback: T) => (error: unknown): T => {
  console.error(JSON.stringify({ event: 'cron_step_failed', step, error: String((error as Error)?.message ?? error) }));
  return fallback;
};

// Vercel Cron llama aquí con `Authorization: Bearer $CRON_SECRET`. Recoge las APIs oficiales que tengan clave guardada.
export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET ?? '';
  const given = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(given), b = Buffer.from(expected);
  if (expected.length < 16 || a.length !== b.length || !timingSafeEqual(a, b)) return Response.json({ detail: 'No autorizado.' }, { status: 401 });
  // Salud del motor ANTES de nada y FUERA del presupuesto de la recogida: es una sola llamada (≤ 8 s) y su
  // aviso no debe depender de que quede tiempo para recoger. Registra la comprobación y avisa por correo al
  // propietario en cuanto el motor se pausa o deja de responder (un aviso por estado). El total del cron sigue
  // muy por debajo de maxDuration (60 s): 8 s aquí + 40 s de presupuesto.
  const engineAlert = await checkEngine({ by: 'cron' }).catch(failed('engine_alert', null));
  // Un solo reloj para todo el cron (40 s de 60): cada paso recibe su fin, comprueba el reloj antes de cada llamada externa y, si se
  // queda sin tiempo, se corta y lo DECLARA (`truncated`). Todo es idempotente: la siguiente ejecución continúa. Orden por prioridad:
  // datos nuevos (APIs oficiales → Google Jobs, que cuesta por búsqueda) → lo ya pagado en Apify →
  // vigencia (las más antiguas primero) → revisor IA (shadow).
  const budget = createBudget(totalFromEnv());
  const outcomes = await collectAll('cron', undefined, budget.deadline(10_000)).catch(failed('collect', []));
  if (outcomes.some(o => o.truncated)) budget.cut('apis');
  // WATERFALL: lo gratuito (motor y APIs oficiales) ya corrió. Las vías de pago se recorren por coste —Google Jobs
  // (Bright Data → JSearch → SerpApi), respaldo por portal y actores de Apify— y SOLO mientras falte objetivo de ofertas
  // CUALIFICADAS (aprobadas o publicadas) del día, que el propietario fija en el panel. Tras cada etapa se descuenta
  // lo que se espera que aporte (con la tasa de aprobación medida; sin tasa, nada). Sin poder contar lo cualificado
  // de hoy no se gasta: un hueco no es un cero. Cada etapa además respeta el tope mensual de su proveedor.
  const wfTime = budget.remaining() >= MIN_STEP_MS;
  if (!wfTime) budget.cut('waterfall');
  const wf = wfTime ? await waterfallState().catch(failed('waterfall_state', null)) : null;
  let gap: number | null = wf?.gap ?? null;
  const stages: Array<{ id: string; ran: boolean; why: string; accepted?: number; cost_usd?: number }> = [];
  const canSpend = () => gap !== null && gap > 0;
  // MÍNIMO DIARIO por etapa de pago: con el objetivo cumplido una fuente bien conectada igual corre un poco cada día (con su tope
  // propio, `FLOOR_LIMITS`) para acumular muestra; no es una cuota de resultados. Solo si se pudo leer el objetivo (`gap` conocido)
  // y el registro de etapas de las últimas 24 h: un hueco no es un cero. Cada proveedor sigue limitado por su tope y por el global.
  const stageHistory = wfTime && gap !== null
    ? await pagedRest<StageRow>(`external_ingest_runs?org_id=eq.${ORG}&source=eq.${CRON_LOG_SOURCE}&created_at=gte.${encodeURIComponent(new Date(Date.now() - 24 * 3600_000).toISOString())}&select=note,created_at`, 'created_at.desc', 500).then(page => (page && !page.truncated ? lastRanByStage(page.rows) : null)).catch(() => null)
    : null;
  const floorOf = (id: string) => !canSpend() && floorDue(id, stageHistory);
  // Tras cada etapa se RECUENTA lo cualificado y pendiente (no se estima con `accepted`, que incluye ofertas ya vistas
  // que solo se actualizaron). Sin tiempo para recontar se mantiene el hueco; si el recuento falla, es desconocido y no se gasta.
  const recount = async (current: number | null): Promise<number | null> => {
    if (current === null) return null;
    if (budget.remaining() < MIN_STEP_MS) return current;
    const next = await waterfallState().catch(failed('waterfall_recount', null));
    return next === null ? null : next.gap;
  };
  const noSpendWhy = () => !wfTime ? 'Sin tiempo en el presupuesto del cron para leer el objetivo: no se gasta (cortado, no fallo).' : wf === null ? 'No se pudo leer el objetivo o lo cualificado de hoy: no se gasta.' : gap === null ? 'No se pudo contar lo cualificado de hoy: no se gasta.' : 'Objetivo del día cumplido: no se gasta más.';
  // Un solo medidor de gasto para Google Jobs y el respaldo: lo gastado por el primero cuenta para el segundo y el
  // historial del mes se lee una vez (es paginado), y solo si queda tiempo para gastar.
  let meterRead: ReturnType<typeof loadMeter> | undefined;
  const sharedMeter = () => (meterRead ??= loadMeter());
  // Encargos asíncronos de Bright Data de pasadas anteriores: recogerlos es gratis y lo que traen cuenta ya para el
  // objetivo, así que va antes de decidir si se gasta más. Sin clave de Bright Data no hace nada.
  const brightAsync = budget.remaining() >= MIN_STEP_MS ? await collectBrightAsync('cron', budget.deadline(6_000)).catch(failed('brightdata_async', null)) : null;
  if (brightAsync?.truncated) budget.cut('brightdataAsync');
  if (brightAsync?.accepted) gap = await recount(gap);
  // Google Jobs (Bright Data primero, JSearch y SerpApi de respaldo): dorks de closer/ES y LatAm. 18 s: Bright Data tarda 10–25 s
  // en devolver el Full JSON; con el tramo antiguo (6,5 s) cada llamada se cortaba y SerpApi ya no tenía tiempo. Entra después de las APIs
  // oficiales porque cuesta por búsqueda; si no hay tiempo se corta y se declara, sin tocar los demás pasos.
  const googleFloor = floorOf('google-jobs');
  const googleJobs = !canSpend() && !googleFloor
    ? (stages.push({ id: 'google-jobs', ran: false, why: noSpendWhy() }), { source: 'google-jobs' as const, ok: false, error: noSpendWhy(), skipped: true })
    : budget.remaining() >= MIN_STEP_MS
      ? await collectGoogleJobs('cron', budget.deadline(18_000), undefined, { meter: await sharedMeter().catch(() => undefined), ...(googleFloor ? { maxDorks: FLOOR_LIMITS.googleDorks } : {}) }).catch(() => ({ source: 'google-jobs' as const, ok: false, error: 'fallo inesperado' }))
      : (budget.cut('googleJobs'), { source: 'google-jobs' as const, ok: false, error: 'sin tiempo en el presupuesto del cron' });
  if ('truncated' in googleJobs && googleJobs.truncated) budget.cut('googleJobs');
  if (!('skipped' in googleJobs)) {
    const accepted = 'accepted' in googleJobs ? googleJobs.accepted ?? 0 : 0;
    gap = await recount(gap);
    stages.push({ id: 'google-jobs', ran: googleJobs.ok || accepted > 0, why: `${googleFloor ? '[mínimo diario] ' : ''}${googleJobs.ok ? 'Recogida hecha.' : googleJobs.error ?? 'Sin resultado.'}`, accepted, cost_usd: 'cost_usd' in googleJobs ? googleJobs.cost_usd : undefined });
  }
  // RapidAPI (APIs de empleo verificadas con una sola clave): entra tras Google Jobs solo si aún falta objetivo; cada
  // API respeta el tope mensual de RapidAPI y una sin suscripción se salta sin cobrarse.
  const rapidFloor = floorOf('rapidapi');
  const rapidapi = !canSpend() && !rapidFloor
    ? (stages.push({ id: 'rapidapi', ran: false, why: noSpendWhy() }), null)
    : budget.remaining() >= MIN_STEP_MS
      ? await sharedMeter().then(meter => collectRapidApi('cron', budget.deadline(8_000), meter, rapidFloor ? { maxRequests: FLOOR_LIMITS.rapidapiRequests } : {})).catch(failed('rapidapi', null))
      : (budget.cut('rapidapi'), null);
  if (rapidapi?.truncated) budget.cut('rapidapi');
  if (rapidapi) {
    gap = await recount(gap);
    stages.push({ id: 'rapidapi', ran: rapidapi.requests > 0, why: `${rapidFloor ? '[mínimo diario] ' : ''}${rapidapi.ok ? `${rapidapi.requests} búsqueda(s).` : rapidapi.error ?? 'Sin resultado.'}`, accepted: rapidapi.accepted, cost_usd: rapidapi.cost_usd });
  }
  // Tavily (buscador con IA): búsquedas semánticas con el banco de términos (`searchBank`), rotando mercado y perfil por día.
  // Entra solo si aún falta objetivo (o por el mínimo diario) y respeta su tope mensual y el global.
  const tavilyFloor = floorOf('tavily');
  const tavily = !canSpend() && !tavilyFloor
    ? (stages.push({ id: 'tavily', ran: false, why: noSpendWhy() }), null)
    : budget.remaining() >= MIN_STEP_MS
      ? await sharedMeter().then(meter => collectTavily('cron', budget.deadline(8_000), meter, tavilyFloor ? { maxSearches: FLOOR_LIMITS.tavilySearches } : {})).catch(failed('tavily', null))
      : (budget.cut('tavily'), null);
  if (tavily?.truncated) budget.cut('tavily');
  if (tavily) {
    gap = await recount(gap);
    stages.push({ id: 'tavily', ran: tavily.searches > 0, why: `${tavilyFloor ? '[mínimo diario] ' : ''}${tavily.ok ? `${tavily.searches} búsqueda(s), ${tavily.received} resultado(s).` : tavily.error ?? 'Sin resultado.'}`, accepted: tavily.accepted, cost_usd: tavily.cost_usd });
  }
  // Feeds estructurados de Bright Data (LinkedIn Jobs): recoger lo ya pedido es gratis y corre siempre; pedir una búsqueda
  // nueva solo si falta objetivo (o por el mínimo diario) y quedan los topes propio y global. Un encargo en marcha no se duplica.
  const feedFloor = floorOf('brightdata-feed');
  const feedMayOrder = canSpend() || feedFloor;
  const feed = budget.remaining() >= MIN_STEP_MS
    ? await sharedMeter().then(meter => runFeedStage('cron', budget.deadline(8_000), meter, feedMayOrder ? (feedFloor && !canSpend() ? { maxSearches: FLOOR_LIMITS.feedSearches } : {}) : { maxSearches: 0 })).catch(failed('brightdata-feed', null))
    : (budget.cut('brightdata-feed'), null);
  if (feed?.truncated) budget.cut('brightdata-feed');
  if (feed) {
    if (feed.accepted) gap = await recount(gap);
    stages.push({ id: 'brightdata-feed', ran: feed.searches > 0 || (feed.collected?.collected ?? 0) > 0, why: `${feedFloor && !canSpend() ? '[mínimo diario] ' : ''}${feed.ok ? `${feed.searches} búsqueda(s) pedida(s), ${feed.collected?.collected ?? 0} recogida(s) (${feed.accepted} guardada(s)).` : feed.error ?? 'Sin resultado.'}`, accepted: feed.accepted, cost_usd: feed.cost_usd });
  }
  // Páginas de empleo propias de las empresas vigiladas (JSON-LD JobPosting o RSS). La lectura directa es gratis y
  // corre siempre; un desbloqueador de pago (ZenRows → ScrapingBee → Bright Data) solo si la página bloquea, falta
  // objetivo y queda tope. Una página que responde sin ofertas no se paga.
  const paying = canSpend();
  let pagesOrigin = 'semilla' as 'motor' | 'semilla'; // se asigna dentro del cierre: el cast evita que TS lo estreche a 'semilla'
  const companyPages = budget.remaining() >= MIN_STEP_MS
    ? await (paying ? sharedMeter().catch(() => null) : Promise.resolve(null))
      .then(async meter => {
        // Lista viva del motor si responde; en el Worker hospedado esa ruta da 404 y se usa su semilla (se declara abajo).
        const source = await enginePagesOrSeed();
        pagesOrigin = source.origin;
        return collectCompanyPages('cron', budget.deadline(8_000), { allowPaid: paying, meter, list: mergePages(COMPANY_WATCHLIST, source.pages) });
      })
      .catch(failed('company_pages', null))
    : (budget.cut('companyPages'), null);
  if (companyPages?.truncated) budget.cut('companyPages');
  if (companyPages) {
    if (companyPages.accepted > 0) gap = await recount(gap);
    stages.push({ id: 'unlocker', ran: companyPages.checked > 0, why: companyPages.ok ? `${companyPages.checked} página(s) revisada(s) (lista: ${pagesOrigin === 'motor' ? 'viva del motor' : 'semilla del motor, su ruta no responde'})${paying ? '' : ' (lectura gratuita; sin objetivo pendiente no se paga desbloqueador)'}.` : companyPages.error ?? 'Sin resultado.', accepted: companyPages.accepted, cost_usd: companyPages.cost_usd });
  }
  // Respaldo de cobertura: los portales que NO tienen API oficial conectada (sin clave, clave rechazada
  // o fallo) se buscan en Google acotados a ese portal con SerpApi. Acotado por
  // `SERPAPI_FALLBACK_MAX_SEARCHES` y por lo que FALTA del objetivo; cada búsqueda declara su coste. Una
  // fuente pausada a propósito no cuenta como ausente y no se paga su respaldo.
  const missingApis = outcomes.filter(o => !o.ok && o.error !== 'Fuente pausada').map(o => o.provider);
  const fallbackNeed = gap !== null && gap > 0 ? (wf?.approval_rate != null && wf.approval_rate > 0 ? Math.ceil(gap / wf.approval_rate) : gap) : 0;
  const fallbackFloor = floorOf('respaldo');
  const fallback = !canSpend() && !fallbackFloor
    ? (stages.push({ id: 'respaldo', ran: false, why: noSpendWhy() }), null)
    : budget.remaining() >= MIN_STEP_MS
      ? await collectFallback('cron', { deadline: budget.deadline(5_000), missing: missingApis, need: fallbackFloor ? 1 : fallbackNeed, ...(fallbackFloor ? { max: FLOOR_LIMITS.fallbackSearches } : {}), meter: await sharedMeter().catch(() => undefined) }).catch(() => null)
      : (budget.cut('fallback'), null);
  if (fallback?.truncated) budget.cut('fallback');
  if (fallback) {
    const accepted = fallback.outcomes.reduce((sum, o) => sum + (o.accepted ?? 0), 0);
    gap = await recount(gap);
    stages.push({ id: 'respaldo', ran: fallback.ok || accepted > 0, why: `${fallbackFloor ? '[mínimo diario] ' : ''}${fallback.ok ? 'Búsquedas hechas.' : 'Sin resultado.'}`, accepted, cost_usd: fallback.cost_usd });
  }
  // Nivel de pago opt-in: con APIFY_SKIP_IF_GOOD_PER_DAY, si las fuentes gratuitas ya cubren el objetivo no se lanza gasto nuevo
  // (lo ya lanzado sí se recoge). Sin esa variable, comportamiento de siempre. El waterfall añade su propio freno:
  // sin hueco de objetivo no se lanza ningún actor nuevo.
  const paid = budget.remaining() >= MIN_STEP_MS ? skipPaidTier(await loadMetrics().catch(() => null)) : { skip: true as const };
  const apifyFloor = floorOf('apify');
  // Apify gasta por ejecución y no pasa por el medidor: antes de lanzar se comprueba el tope global del mes con una ejecución de reserva (1 US$).
  const globalRoom = apifyFloor || canSpend() ? await sharedMeter().then(meter => meter.global.check(1)).catch(() => ({ ok: false, reason: 'No se pudo leer el gasto del mes.' })) : { ok: true as boolean, reason: undefined as string | undefined };
  const apifyStart = !paid.skip && (canSpend() || apifyFloor) && globalRoom.ok;
  if (!apifyStart) stages.push({ id: 'apify', ran: false, why: !canSpend() && !apifyFloor ? noSpendWhy() : !globalRoom.ok ? (globalRoom.reason ?? 'Tope global del mes.') : ('reason' in paid && paid.reason ? paid.reason : 'Sin tiempo en el presupuesto del cron.') });
  let apifyError: string | null = null;
  const apify = await dailyApify(publicBaseUrl(request), { start: apifyStart, deadline: budget.deadline(9_000) }).catch(error => { apifyError = String((error as Error)?.message ?? error); return failed('apify', { started: [], harvested: [], truncated: false } as Awaited<ReturnType<typeof dailyApify>>)(error); });
  if (apifyStart) stages.push({ id: 'apify', ran: apifyError === null, why: `${apifyFloor && !canSpend() ? '[mínimo diario] ' : ''}${apifyError !== null ? `Fallo al lanzar Apify: ${apifyError}` : apify.started.length ? `${apify.started.length} búsqueda(s) lanzada(s); los resultados llegan después.` : 'Ningún portal con búsqueda diaria pendiente.'}` });
  if ('truncated' in apify && apify.truncated) budget.cut('apify');
  const vigencia = budget.remaining() >= MIN_STEP_MS ? await refreshVigencia(20, budget.deadline(5_000)).catch(() => ({ checked: 0, withdrawn: 0 })) : (budget.cut('vigencia'), { checked: 0, withdrawn: 0 });
  if ('truncated' in vigencia && vigencia.truncated) budget.cut('vigencia');
  // Descripción de las ofertas que entraron solo con título: una lectura gratuita y acotada del anuncio (como la verificación de vigencia). Sin
  // descripción no se puede juzgar el idioma ni las condiciones. Va antes de la revisión para que lo enriquecido se juzgue en esta misma pasada.
  const detail = budget.remaining() >= MIN_STEP_MS ? await enrichDescriptions({ deadline: budget.deadline(8_000) }).catch(failed('description_enrich', null)) : (budget.cut('detail'), null);
  if (detail?.truncated) budget.cut('detail');
  // Cualificación automática al final: primero aprueba por reglas lo que cumple hechos comprobables y,
  // si queda hueco de tope y la IA está en vivo, le pasa solo las dudosas. Un fallo no tumba el resto.
  const auto = budget.remaining() >= MIN_STEP_MS
    ? await runAutoReview({ deadline: budget.end }).catch(failed('auto_review', { checked: 0, approved: 0, exceptions: 0, used_before: null, cap: 0, by_reason: {}, ai: null, truncated: true }))
    : (budget.cut('auto'), { checked: 0, approved: 0, exceptions: 0, used_before: null, cap: 0, by_reason: {}, ai: null, truncated: true });
  if (auto.truncated) budget.cut('auto');
  // Pool del motor cloud (catálogo de la superficie de alumna): el mismo criterio, al final del
  // presupuesto. Clasifica con reglas, verifica el enlace y publica lo abierto; lo que no encaja se
  // retira con su motivo en vez de esperar a una persona. Sin motor configurado devuelve null y el
  // panel ya lo declara; un fallo no tumba el resto de la recogida.
  const motor = budget.remaining() >= MIN_STEP_MS
    // De 3 a 8 pasadas (sesión 209): el motor tenía miles de borradores y publicaba ~25 por pasada.
    // El reloj sigue mandando: si no queda tiempo, `activateEngine` corta y lo declara.
    ? await activateEngine({ passes: 8, deadline: budget.deadline(40_000) }).catch(failed('engine', null))
    : (budget.cut('motor'), null);
  if (motor?.truncated) budget.cut('motor');
  const report = new Date().getUTCDay() === 1 && budget.remaining() >= MIN_STEP_MS ? await weeklyAiReport().catch(() => false) : null;
  // Una fila por etapa (corrió o se saltó, y por qué) bajo la fuente «cron-waterfall»: así el panel puede decir por qué una
  // fuente de pago no recogió hoy. No es gasto (la nota no lleva «coste_usd=»), solo registro; si falla no tumba el cron.
  await Promise.all(stages.map(stage => recordSpend(CRON_LOG_SOURCE, 'cron', stageNote(stage.id, stage.ran, stage.why)).catch(() => false)));
  return Response.json({ waterfall: wf ? { target: wf.target.target, source: wf.target.source, qualified_today: wf.qualified_today, pending_today: wf.pending_today, approval_rate: wf.approval_rate, gap_before: wf.gap, gap_after: gap, basis: wf.basis, stages } : { stages, error: 'No se pudo leer el estado del waterfall.' }, outcomes, fallback, googleJobs, rapidapi, tavily, feed, companyPages, brightAsync, vigencia, apify, auto, aiReview: auto.ai, detail, motor, engineAlert, weeklyReport: report, paidTierSkipped: paid.skip ? ('reason' in paid ? paid.reason : 'sin tiempo') : null, truncated: budget.truncated, spent_ms: budget.spent() });
}
