// Marcador por fuente: solo las cuentas (por 1.000 anuncios vivos, sin denominador no hay tasa,
// ofertas sin fuente localizable aparte). Sin red ni base de datos.
// Uso: node --experimental-strip-types tests/source-scorecard.mjs
import assert from 'node:assert/strict';
import { scorecard, scorecardTotals, providerBreakdown, providerTotals, providerOfSource, MIN_SENDS_TO_COMPARE } from '../apps/web/lib/sourceScorecard.ts';
import { parseSerpapiCost, recordedCosts } from '../apps/web/lib/sourceCost.ts';
import { eurRate, __testFx } from '../apps/web/lib/fx.ts';
import { cost, money } from '../apps/web/lib/money.ts';

const sources = new Map([
  ['ext-1', 'jobtoday'], ['ext-2', 'jobtoday'], ['ext-3', 'infojobs'], ['ext-4', 'infojobs'], ['ext-5', 'infojobs'], ['ext-6', 'infojobs'],
]);
const ingested = new Map([['jobtoday', 1000], ['infojobs', 500], ['remotive', 0]]);
const apps = [
  { offer_ref: 'ext-1', status: 'applied' },
  { offer_ref: 'ext-2', status: 'interview' },
  { offer_ref: 'ext-3', status: 'applied' },
  { offer_ref: 'ext-4', status: 'rejected' },
  { offer_ref: 'ext-5', status: 'offer' },
  { offer_ref: 'ext-6', status: 'draft' },
  { offer_ref: 'ext-999', status: 'applied' },
];

const rows = scorecard(apps, sources, ingested);
const by = new Map(rows.map(row => [row.source, row]));

// jobtoday: 2 enviadas (applied + interview), 1 entrevista; el borrador no cuenta.
assert.equal(by.get('jobtoday').sent, 2);
assert.equal(by.get('jobtoday').interviews, 1);
assert.equal(by.get('jobtoday').per_1000.sent, 2);
assert.equal(by.get('jobtoday').per_1000.interviews, 1);
// infojobs: 3 enviadas (el borrador no viaja), 2 respuestas (rejected + offer), 1 entrevista (la oferta), 1 oferta.
assert.equal(by.get('infojobs').sent, 3);
assert.equal(by.get('infojobs').responded, 2);
assert.equal(by.get('infojobs').interviews, 1);
assert.equal(by.get('infojobs').offers, 1);
assert.equal(by.get('infojobs').per_1000.interviews, 2, '1 entre 500 → 2 por mil');
// Sin anuncios vivos el denominador es un hueco, no un cero.
assert.ok(by.has('remotive'), 'la fuente ingerida sin candidaturas también sale');
assert.equal(by.get('remotive').per_1000.sent, null);
// Una oferta borrada no se atribuye a una fuente inventada.
assert.equal(by.get('sin fuente localizable').sent, 1);
assert.equal(by.get('sin fuente localizable').per_1000.sent, null);
// Orden: primero quien más entrevistas por mil saca, y los huecos al final.
assert.deepEqual(rows.slice(0, 2).map(row => row.source), ['infojobs', 'jobtoday']);
assert.equal(rows.at(-1).source, 'sin fuente localizable');
// Los totales suman las filas y no cuentan el cajón de «sin fuente» como fuente.
const totals = scorecardTotals(rows);
assert.equal(totals.sources, 3, 'jobtoday, infojobs y remotive');
assert.equal(totals.ingested, 1500);
// Las enviadas reales incluyen la que no se pudo atribuir a una fuente (5 + 1).
assert.equal(totals.sent, 6);
assert.equal(totals.interviews, 2);

// ── Coste ya registrado: solo lo que consta, con «—» cuando falta ──────────────────────────────
const costs = { usdBySource: new Map([['jobtoday', 0.5], ['infojobs', 0.1], ['solo-coste', 1]]), partial: new Set(['infojobs']), eurPerUsd: 0.8 };
const paid = scorecard(apps, sources, ingested, costs);
const p = new Map(paid.map(row => [row.source, row]));
// jobtoday: 0,50 USD → 0,40 €; 2 enviadas y 1 entrevista.
assert.equal(p.get('jobtoday').cost_usd, 0.5);
assert.equal(p.get('jobtoday').cost_eur, 0.4);
assert.equal(p.get('jobtoday').per_send_eur, 0.2);
assert.equal(p.get('jobtoday').per_interview_eur, 0.4);
assert.equal(p.get('jobtoday').cost_partial, false);
// infojobs: coste mínimo declarado, 3 enviadas y 1 entrevista.
assert.equal(p.get('infojobs').cost_eur, 0.08);
assert.equal(p.get('infojobs').per_send_eur, 0.0267, '0,08 € entre 3 envíos');
assert.equal(p.get('infojobs').per_interview_eur, 0.08);
assert.equal(p.get('infojobs').cost_partial, true);
// Sin coste registrado no se inventa un cero.
assert.equal(p.get('remotive').cost_usd, null);
assert.equal(p.get('remotive').cost_eur, null);
assert.equal(p.get('remotive').per_send_eur, null);
// Una fuente que gastó sin dejar anuncios vivos sale con su coste y sin denominador.
assert.equal(p.get('solo-coste').ingested, null);
assert.equal(p.get('solo-coste').cost_eur, 0.8);
assert.equal(p.get('solo-coste').per_send_eur, null, 'sin envíos no hay € por envío');
assert.equal(p.get('solo-coste').per_1000.sent, null);
// El cajón sin fuente no lleva coste.
assert.equal(p.get('sin fuente localizable').cost_eur, null);
// Totales: 0,40 + 0,08 + 0,80; y 1,28 € entre 6 enviadas (incluye la no atribuida).
const paidTotals = scorecardTotals(paid);
assert.equal(paidTotals.cost_eur, 1.28);
assert.equal(paidTotals.cost_sources, 3);
assert.equal(paidTotals.per_send_eur, 0.2133);
assert.equal(paidTotals.per_interview_eur, 0.64);
assert.equal(paidTotals.cost_partial, true);
// Sin tipo de cambio, el coste en dólares se conserva pero el de euros queda en «—».
const noFx = new Map(scorecard(apps, sources, ingested, { ...costs, eurPerUsd: null }).map(row => [row.source, row]));
assert.equal(noFx.get('jobtoday').cost_usd, 0.5);
assert.equal(noFx.get('jobtoday').cost_eur, null);
assert.equal(noFx.get('jobtoday').per_send_eur, null);
assert.equal(scorecardTotals([...noFx.values()]).cost_eur, null);

// ── Embudo: preparada → vista (abrió) → enviada → respuesta, y cuándo se puede comparar ─────────
const funnelApps = [
  { offer_ref: 'ext-1', status: 'opened', created_at: '2026-11-01T00:00:00Z', applied_at: null },
  { offer_ref: 'ext-2', status: 'applied', created_at: '2026-11-02T00:00:00Z', applied_at: '2026-11-03T00:00:00Z' },
  { offer_ref: 'ext-3', status: 'responded', created_at: '2026-11-04T00:00:00Z', applied_at: '2026-11-05T00:00:00Z' },
  { offer_ref: 'ext-4', status: 'draft', created_at: '2026-11-06T00:00:00Z', applied_at: null },
];
const funnel = new Map(scorecard(funnelApps, sources, ingested).map(row => [row.source, row]));
// jobtoday (ext-1 y ext-2): una sigue «vista» y otra llegó a enviarse.
assert.equal(funnel.get('jobtoday').prepared, 2);
assert.equal(funnel.get('jobtoday').opened, 1);
assert.equal(funnel.get('jobtoday').sent_ever, 1);
assert.equal(funnel.get('jobtoday').responded, 0);
assert.equal(funnel.get('jobtoday').conclusive, false);
assert.equal(funnel.get('jobtoday').sends_missing, MIN_SENDS_TO_COMPARE - 1);
// infojobs (ext-3 y ext-4): una respondida y una en borrador; ninguna «vista» ahora.
assert.equal(funnel.get('infojobs').prepared, 2);
assert.equal(funnel.get('infojobs').opened, 0);
assert.equal(funnel.get('infojobs').sent_ever, 1);
assert.equal(funnel.get('infojobs').responded, 1);
assert.equal(funnel.get('infojobs').sends_missing, MIN_SENDS_TO_COMPARE - 1);
assert.equal(funnel.get('infojobs').conclusive, false);
const funnelTotals = scorecardTotals([...funnel.values()]);
assert.equal(funnelTotals.prepared, 4);
assert.equal(funnelTotals.opened, 1);
assert.equal(funnelTotals.sent_ever, 2);
assert.equal(funnelTotals.conclusive_sources, 0);
// Con 30 envíos acumulados la fuente ya se puede comparar; con 29, todavía no.
const sent = (n) => Array.from({ length: n }, () => ({ offer_ref: 'ext-1', status: 'applied', created_at: '2026-10-01T00:00:00Z', applied_at: '2026-10-02T00:00:00Z' }));
const almost = new Map(scorecard(sent(MIN_SENDS_TO_COMPARE - 1), sources, ingested).map(row => [row.source, row]));
assert.equal(almost.get('jobtoday').conclusive, false);
assert.equal(almost.get('jobtoday').sends_missing, 1);
const enough = new Map(scorecard(sent(MIN_SENDS_TO_COMPARE), sources, ingested).map(row => [row.source, row]));
assert.equal(enough.get('jobtoday').conclusive, true);
assert.equal(enough.get('jobtoday').sends_missing, 0);

// ── Lectura del coste registrado (Apify + nota del respaldo) ────────────────────────────────────
assert.equal(parseSerpapiCost('respaldo SerpApi · 1 búsqueda(s), 0.025 USD'), 0.025);
assert.equal(parseSerpapiCost('20 recibidas, 19 aceptadas'), null);
assert.equal(parseSerpapiCost(null), null);
const recorded = recordedCosts(
  [{ id: 'a1', source: 'apify-indeed' }, { id: 'a2', source: 'apify-indeed' }],
  [{ actor_id: 'a1', cost_usd: '0.10', status: 'SUCCEEDED' }, { actor_id: 'a2', cost_usd: null, status: 'RUNNING' }, { actor_id: 'ghost', cost_usd: 0.5, status: 'SUCCEEDED' }],
  [{ source: 'serpapi-infojobs', note: 'respaldo SerpApi · 1 búsqueda(s), 0.025 USD' }, { source: 'serpapi-adzuna', note: null }],
);
assert.equal(recorded.usdBySource.get('apify-indeed'), 0.1);
assert.ok(recorded.partial.has('apify-indeed'), 'una ejecución sin importe deja el coste como mínimo');
assert.equal(recorded.usdBySource.get('serpapi-infojobs'), 0.025);
assert.ok(recorded.partial.has('serpapi-adzuna'), 'una nota sin importe no se cuenta como cero');
assert.equal(recorded.unattributed_usd, 0.5, 'lo que no tiene actor no se atribuye a una fuente');
assert.equal(recordedCosts(null, [], []), null, 'una lectura fallida no produce una suma parcial');

// ── Gasto y rendimiento por PROVEEDOR (panel de APIs) ─────────────────────────────────────────
// El marcador agrupa por fuente; el panel de APIs necesita saber quién cobra por traerlas.
assert.equal(providerOfSource('apify-indeed'), 'apify');
assert.equal(providerOfSource('serpapi-infojobs'), 'serpapi');
assert.equal(providerOfSource('infojobs'), 'infojobs');
assert.equal(providerOfSource('himalayas'), null, 'una fuente gratuita del motor no tiene proveedor');
const pSources = new Map([['ext-1', 'apify-indeed'], ['ext-2', 'apify-indeed'], ['ext-3', 'serpapi-infojobs'], ['ext-4', 'serpapi-infojobs'], ['ext-5', 'himalayas'], ['ext-6', 'infojobs']]);
const pApps = [
  { offer_ref: 'ext-1', status: 'applied' },
  { offer_ref: 'ext-2', status: 'interview' },
  { offer_ref: 'ext-3', status: 'applied' },
  { offer_ref: 'ext-4', status: 'offer' },
  { offer_ref: 'ext-5', status: 'applied' },
  { offer_ref: 'ext-6', status: 'applied' },
];
const pIngested = new Map([['apify-indeed', 1000], ['serpapi-infojobs', 400], ['himalayas', 900], ['infojobs', 300]]);
const pCosts = { usdBySource: new Map([['apify-indeed', 2], ['serpapi-infojobs', 0.1]]), partial: new Set(['serpapi-infojobs']), eurPerUsd: 0.8 };
const pRows = scorecard(pApps, pSources, pIngested, pCosts);
const providers = providerBreakdown(pRows, [
  { provider: 'apify', name: 'Apify', configured: true },
  { provider: 'serpapi', name: 'SerpApi', configured: true },
  { provider: 'infojobs', name: 'InfoJobs', configured: false },
  { provider: 'groq', name: 'Groq', configured: true },
]);
const prov = new Map(providers.map(row => [row.provider, row]));
// Apify: 2 USD → 1,60 €; 1.000 anuncios vivos, 2 enviadas y 1 entrevista desde sus ofertas.
assert.equal(prov.get('apify').cost_usd, 2);
assert.equal(prov.get('apify').cost_eur, 1.6);
assert.equal(prov.get('apify').ingested, 1000);
assert.equal(prov.get('apify').sent, 2);
assert.equal(prov.get('apify').interviews, 1);
assert.equal(prov.get('apify').per_send_eur, 0.8);
assert.equal(prov.get('apify').per_interview_eur, 1.6);
assert.equal(prov.get('apify').cost_reason, null);
assert.equal(prov.get('apify').sources, 1);
assert.equal(prov.get('apify').configured, true);
// SerpApi: nota de respaldo 0,10 USD → 0,08 €, con el coste declarado como mínimo.
assert.equal(prov.get('serpapi').cost_eur, 0.08);
assert.equal(prov.get('serpapi').cost_partial, true);
assert.equal(prov.get('serpapi').sent, 2);
assert.equal(prov.get('serpapi').interviews, 1);
assert.equal(prov.get('serpapi').per_interview_eur, 0.08);
// InfoJobs con clave oficial: trae ofertas pero NO registra importe, así que su coste es hueco, no 0.
assert.equal(prov.get('infojobs').sent, 1);
assert.equal(prov.get('infojobs').ingested, 300);
assert.equal(prov.get('infojobs').cost_eur, null);
assert.equal(prov.get('infojobs').cost_reason, 'sin_coste');
assert.equal(prov.get('infojobs').per_send_eur, null);
assert.equal(prov.get('infojobs').configured, false);
// Groq no trae ofertas, pero es un proveedor de la pestaña: sale con su estado de clave y sin datos.
assert.equal(prov.get('groq').name, 'Groq');
assert.equal(prov.get('groq').cost_eur, null);
assert.equal(prov.get('groq').sources, 0);
// Una fuente gratuita del motor (Himalayas) no se mete en la tabla de proveedores.
assert.equal(prov.has('himalayas'), false);
// Orden: primero quien tiene gasto (más gasto arriba); los proveedores sin importe al final.
assert.deepEqual(providers.map(row => row.provider), ['apify', 'serpapi', 'infojobs', 'groq']);
// Sin tipo de cambio se conserva el importe en dólares y el de euros queda en «—» con su causa.
const noFxProviders = new Map(providerBreakdown(scorecard(pApps, pSources, pIngested, { ...pCosts, eurPerUsd: null }), []).map(row => [row.provider, row]));
assert.equal(noFxProviders.get('apify').cost_usd, 2);
assert.equal(noFxProviders.get('apify').cost_eur, null);
assert.equal(noFxProviders.get('apify').cost_reason, 'sin_tipo_de_cambio');
assert.equal(noFxProviders.get('apify').per_send_eur, null);
// Totales por proveedor: 1,68 € entre 5 enviadas y 2 entrevistas (las de fuentes gratuitas cuentan como envíos).
const pTotals = providerTotals(providers);
assert.equal(pTotals.providers, 4);
assert.equal(pTotals.funded, 2);
assert.equal(pTotals.cost_usd, 2.1);
assert.equal(pTotals.cost_eur, 1.68);
assert.equal(pTotals.sent, 5);
assert.equal(pTotals.interviews, 2);
assert.equal(pTotals.per_send_eur, 0.336);
assert.equal(pTotals.per_interview_eur, 0.84);
assert.equal(pTotals.cost_partial, true);
// Sin ningún importe registrado el total es «—», no 0.
assert.equal(providerTotals(providerBreakdown(scorecard(pApps, pSources, pIngested), [])).cost_eur, null);

// ── Tipo de cambio: del BCE, y fallo declarado ──────────────────────────────────────────────────
__testFx.reset();
const fx = await eurRate({ now: Date.now(), fetchImpl: async () => new Response("<Cube time='2026-11-17'><Cube currency='USD' rate='1.25'/></Cube>", { status: 200 }) });
assert.equal(fx.source, 'BCE');
assert.equal(fx.date, '2026-11-17');
assert.ok(Math.abs(fx.eur_per_usd - 0.8) < 1e-9, 'USD por EUR se invierte');
__testFx.reset();
assert.equal(await eurRate({ now: Date.now(), fetchImpl: async () => new Response('no', { status: 500 }) }), null);
// ── Formato del coste: un gasto de céntimos no se pinta como «0,00 €» ──────────────────────────
// Visto en producción: `apify-indeed` gastó 0,004 € y la tabla del marcador decía 0,00 €, que se lee
// como «gratis». Un importe por debajo de un céntimo se declara; un cero medido sigue siendo cero.
assert.equal(cost(0.004), '< 0,01 €', 'un gasto real por debajo de un céntimo se dice, no se redondea a cero');
assert.equal(cost(0.0009), '< 0,01 €');
assert.notEqual(cost(0.004), money(0.004), 'ya no se confunde con 0,00 €');
assert.equal(cost(0), money(0), 'un cero registrado sigue siendo 0,00 €');
assert.equal(cost(0.01), money(0.01), 'desde un céntimo se pinta el importe');
assert.equal(cost(0.03), money(0.03));
assert.equal(cost(0.27), money(0.27));
assert.equal(cost(null), '—', 'sin importe registrado el hueco es una raya, no un cero');
console.log('PASS  marcador por fuente y por proveedor: tasas por 1.000 anuncios vivos, coste registrado en €, € por envío y por entrevista, huecos en «—» y ofertas sin fuente aparte');
