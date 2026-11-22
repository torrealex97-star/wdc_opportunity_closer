import { NextRequest } from 'next/server';
import { authenticate, originBlocked, publicBaseUrl, withCookies } from '../../../../lib/adminAuth';
import { ACTOR_RE, apifyToken, fetchSchema, harvestPending, listActors, listRuns, monthSpent, PRESETS } from '../../../../lib/apify';
import { readBudget, writeBudget } from '../../../../lib/paidBudget';
import { approvedBySource, ORG, SOURCE_RE } from '../../../../lib/external';
import { startRun } from '../../../../lib/apify';
import { measuredSince, portalViews, recoverAfter, searchPortal, plainError } from '../../../../lib/apifyAuto';
import { PORTALS, portalById } from '../../../../lib/apifyCatalog';
import { checkActor, findReplacements, verdictOf } from '../../../../lib/apifyStore';
import { serviceRest } from '../../../../lib/supabaseAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Actores de Apify desde el panel. Ver y recoger resultados: cualquier operador. Crear, editar, borrar y lanzar (gasta
// crédito de Apify): solo el propietario.
async function gate(request: NextRequest, ownerOnly: boolean) {
  if (originBlocked(request)) return { error: Response.json({ detail: 'Origen no permitido' }, { status: 403 }) };
  const auth = await authenticate(request);
  if (!auth.ok) return { error: Response.json({ detail: auth.detail }, { status: auth.status }) };
  if (ownerOnly && auth.admin.role !== 'owner') return { error: Response.json({ detail: 'Solo el propietario puede configurar o lanzar actores.' }, { status: 403 }) };
  return { auth };
}
const reply = (auth: { setCookies: string[] }, body: unknown, status = 200) => withCookies(Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } }), auth.setCookies);
const int = (v: unknown, min: number, max: number, d: number) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d; };

export async function GET(request: NextRequest) {
  const { auth, error } = await gate(request, false);
  if (error) return error;
  const [actors, runs, spent, token, budget] = await Promise.all([listActors(), listRuns(), monthSpent(), apifyToken(), readBudget()]);
  if (!actors || !runs) return Response.json({ detail: 'No se pudo leer los actores.' }, { status: 503 });
  // El límite que manda es el guardado por el propietario; `source` y `error` declaran de dónde sale (y si el
  // control del panel aún no está activo, p. ej. migración sin aplicar) para que el panel no finja que manda.
  // Las aprobadas se cuentan en la misma ventana que el historial de ejecuciones: así el «por qué» del reparto
  // (aprobadas por dólar) sale del mismo periodo que el coste. Si no se pueden contar, el panel lo dice en la tarjeta.
  const since = measuredSince(runs);
  const approved = since ? await approvedBySource(PORTALS.map(p => p.source), since).catch(() => null) : null;
  return reply(auth!, { portals: portalViews(actors, runs, Date.now(), approved), actors, runs, presets: PRESETS, budget: { spent: spent === null ? null : Number(spent.toFixed(4)), limit: budget.usd, source: budget.source, updated_by: budget.updated_by, updated_at: budget.updated_at, error: budget.error }, has_key: Boolean(token) });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = body.action;
  const { auth, error } = await gate(request, action !== 'harvest' && action !== 'find_replacements');
  if (error) return error;

  // El propietario sube o baja el límite desde el panel: se guarda en la base, se audita quién y cuándo, y
  // desde ese momento manda en cada lanzamiento de pago (no hace falta desplegar ni tocar el entorno).
  if (action === 'budget') {
    const saved = await writeBudget(body.monthly_usd, auth!.admin.email);
    return saved.ok
      ? reply(auth!, { ok: true, budget: { limit: saved.usd }, message: `Límite de gasto del mes guardado: ${saved.usd} USD. El reparto entre portales se ajusta en la siguiente búsqueda.` })
      : Response.json({ detail: saved.error }, { status: 422 });
  }

  if (action === 'harvest') { const base = publicBaseUrl(request); return reply(auth!, { results: await harvestPending(45000, auth!.admin.role === 'owner' ? (run, actor, res) => recoverAfter(run, actor, res, base) : undefined) }); } // solo el propietario dispara repuestos (gastan crédito)

  // Modo sencillo: buscar en un portal con buscadores de repuesto, y activar/desactivar la búsqueda diaria.
  if (action === 'search_now') {
    const portal = typeof body.portal === 'string' ? portalById(body.portal) : undefined;
    if (!portal) return Response.json({ detail: 'Portal no válido.' }, { status: 422 });
    const test = body.test === true;
    const r = await searchPortal(portal, { by: auth!.admin.email, publicBase: publicBaseUrl(request), test });
    if (r.ok) return reply(auth!, { ok: true, recipe: r.recipe, fallback: r.fallback, test, message: `${test ? 'Prueba lanzada' : 'Búsqueda lanzada'} en ${portal.name}${r.fallback ? ` (el primer buscador no arrancó; se usó «${r.recipe}»)` : ''}. Tarda entre 1 y 5 minutos; los resultados entran solos.`, attempts: r.attempts.map(a => ({ recipe: a.recipe, error: plainError(a.error) })) }, 202);
    return Response.json({ detail: r.busy ? 'Ya hay una búsqueda en curso en este portal. Espera a que termine.' : `${plainError(r.error)}${r.attempts.length ? ` Se probó: ${r.attempts.map(a => `${a.recipe} (${plainError(a.error)})`).join('; ')}.` : ''}`, attempts: r.attempts.map(a => ({ recipe: a.recipe, error: plainError(a.error) })) }, { status: 409 });
  }
  // Buscadores de repuesto desde la tienda de Apify. Buscar y validar no gasta crédito (metadatos públicos).
  // Añadir exige que el actor se VUELVA a validar aquí: la app nunca se fía de lo que dice el navegador.
  if (action === 'find_replacements') {
    const portal = typeof body.portal === 'string' ? portalById(body.portal) : undefined;
    if (!portal) return Response.json({ detail: 'Portal no válido.' }, { status: 422 });
    const rows = (await listActors() ?? []).filter(a => a.source === portal.source);
    // Se excluyen los que ya están (activos o retirados) y los del catálogo.
    const known = new Set([...rows.map(a => a.actor), ...portal.recipes.map(r => r.actor)].map(a => a.toLowerCase()));
    const found = await findReplacements(portal, known);
    if (found.error && !found.candidates.length) return Response.json({ detail: `${found.error} No se pudieron buscar repuestos ahora.` }, { status: 502 });
    return reply(auth!, found);
  }
  if (action === 'add_replacement') {
    const portal = typeof body.portal === 'string' ? portalById(body.portal) : undefined;
    const actor = typeof body.actor === 'string' ? body.actor.trim() : '';
    if (!portal || !ACTOR_RE.test(actor)) return Response.json({ detail: 'Portal o actor no válido.' }, { status: 422 });
    const rows = (await listActors() ?? []).filter(a => a.source === portal.source);
    if (rows.some(a => a.actor.toLowerCase() === actor.toLowerCase())) return Response.json({ detail: 'Ese buscador ya está en este portal.' }, { status: 409 });
    const check = await checkActor(actor);
    const verdict = verdictOf(check);
    if (verdict !== 'valid') return Response.json({ detail: `No se añade: ${verdict === 'invalid' ? 'la tienda lo marca como no utilizable' : 'no se pudo verificar'}. ${check.reasons.join(' ')}`.trim(), check }, { status: 422 });
    const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim().slice(0, 80) : actor;
    const response = await serviceRest('apify_actors', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ org_id: ORG, label: title, actor, source: portal.source, input_template: portal.inputTemplate ?? null, max_items: portal.maxItems, memory_mb: 1024, timeout_s: 900, schedule_daily: rows.some(a => a.schedule_daily), created_by: auth!.admin.email }) });
    return response.ok ? reply(auth!, { ok: true, message: `${title} añadido como buscador de repuesto de ${portal.name}. Se probará cuando falle el resto o con «Probar con 10 ofertas».` }, 201) : Response.json({ detail: 'No se pudo guardar el buscador.' }, { status: 503 });
  }
  if (action === 'retire' || action === 'reactivate') {
    if (typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/.test(body.id)) return Response.json({ detail: 'Actor no válido.' }, { status: 422 });
    const response = await serviceRest(`apify_actors?org_id=eq.${ORG}&id=eq.${body.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: action === 'retire' ? 'inactive' : 'pending_validation' }) });
    return response.ok ? reply(auth!, { ok: true, message: action === 'retire' ? 'Buscador retirado de la cascada. Puedes reactivarlo cuando quieras.' : 'Buscador reactivado.' }) : Response.json({ detail: 'No se pudo guardar el cambio.' }, { status: 503 });
  }
  if (action === 'portal_daily') {
    const portal = typeof body.portal === 'string' ? portalById(body.portal) : undefined;
    if (!portal || typeof body.on !== 'boolean') return Response.json({ detail: 'Portal o valor no válido.' }, { status: 422 });
    const rows = (await listActors() ?? []).filter(a => a.source === portal.source);
    if (!rows.length && body.on) {
      for (const r of portal.recipes) await serviceRest('apify_actors', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ org_id: ORG, label: r.name, actor: r.actor, source: portal.source, input_template: portal.inputTemplate ?? null, max_items: portal.maxItems, memory_mb: 1024, timeout_s: 900, schedule_daily: true, created_by: auth!.admin.email }) });
    } else {
      const response = await serviceRest(`apify_actors?org_id=eq.${ORG}&source=eq.${encodeURIComponent(portal.source)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ schedule_daily: body.on }) });
      if (!response.ok) return Response.json({ detail: 'No se pudo guardar el cambio.' }, { status: 503 });
    }
    return reply(auth!, { ok: true });
  }

  if (action === 'save') {
    const label = typeof body.label === 'string' ? body.label.trim().slice(0, 80) : '', actor = typeof body.actor === 'string' ? body.actor.trim() : '', source = typeof body.source === 'string' ? body.source.trim() : '';
    if (!label || !ACTOR_RE.test(actor) || !SOURCE_RE.test(source)) return Response.json({ detail: 'Revisa el nombre, el actor (propietario/nombre) y el código de fuente (minúsculas, números y guiones).' }, { status: 422 });
    let template: unknown = null;
    if (typeof body.input_template === 'string' && body.input_template.trim()) { try { template = JSON.parse(body.input_template); } catch { return Response.json({ detail: 'La plantilla de entrada no es un JSON válido.' }, { status: 422 }); } if (!template || typeof template !== 'object' || Array.isArray(template)) return Response.json({ detail: 'La plantilla debe ser un objeto JSON.' }, { status: 422 }); }
    const row = { org_id: ORG, label, actor, source, input_template: template, max_items: int(body.max_items, 10, 5000, 500), memory_mb: int(body.memory_mb, 256, 4096, 1024), timeout_s: int(body.timeout_s, 60, 3600, 900), schedule_daily: body.schedule_daily === true, created_by: auth!.admin.email };
    const id = typeof body.id === 'string' && /^[0-9a-f-]{36}$/.test(body.id) ? body.id : null;
    const response = id ? await serviceRest(`apify_actors?org_id=eq.${ORG}&id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(row) }) : await serviceRest('apify_actors', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(row) });
    return response.ok ? reply(auth!, { ok: true }, id ? 200 : 201) : Response.json({ detail: 'No se pudo guardar el actor.' }, { status: 503 });
  }

  if (action === 'delete') {
    if (typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/.test(body.id)) return Response.json({ detail: 'Actor no válido.' }, { status: 422 });
    const response = await serviceRest(`apify_actors?org_id=eq.${ORG}&id=eq.${body.id}`, { method: 'DELETE' });
    return response.ok ? reply(auth!, { ok: true }) : Response.json({ detail: 'No se pudo borrar.' }, { status: 503 });
  }

  if (action === 'start') {
    const actors = await listActors(); const actor = actors?.find(a => a.id === body.id);
    if (!actor) return Response.json({ detail: 'Actor no encontrado.' }, { status: 404 });
    const result = await startRun(actor, auth!.admin.email, publicBaseUrl(request));
    return result.ok ? reply(auth!, result, 202) : Response.json({ detail: result.error }, { status: 409 });
  }

  if (action === 'schema') {
    const token = await apifyToken(); const actor = typeof body.actor === 'string' ? body.actor.trim() : '';
    if (!token) return Response.json({ detail: 'Guarda antes la clave de Apify en la pestaña APIs.' }, { status: 409 });
    if (!ACTOR_RE.test(actor)) return Response.json({ detail: 'Actor no válido.' }, { status: 422 });
    const schema = await fetchSchema(actor, token);
    return schema ? reply(auth!, { fields: Object.entries(schema.properties).map(([name, p]) => ({ name, type: p.type ?? '?', required: schema.required.includes(name) })) }) : Response.json({ detail: 'No se pudo leer el esquema del actor.' }, { status: 404 });
  }
  return Response.json({ detail: 'Acción no válida.' }, { status: 422 });
}
