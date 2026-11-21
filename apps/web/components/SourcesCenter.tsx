'use client';
import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, ChevronDown, LoaderCircle, PlugZap, RefreshCcw, Route } from 'lucide-react';
import sourceCatalog from '../lib/sourceCatalog.json';
import { catalogCodeFor, groupByFamily } from '../lib/sourceFamilies';
import { setupFor, type Setup } from '../lib/sourceSetup';
import {
  COST_LABEL, EVIDENCE_LABEL, GROUP_LABEL, groupForSource, orderRoutes, planCascade, routeReadiness,
  routesForCatalog, type RouteState, type SourceGroup, type SourceRoute,
} from '../lib/sourceRoutes';
import SourceSetupGuide from './SourceSetupGuide';

// Hub de Fuentes: estado real, rutas por fuente y la guía de conexión, en un solo sitio.
// Debajo sigue la tabla completa del catálogo (por tandas de 25) porque es la que responde «¿esta
// fuente entra o no?» sin abrir tarjeta por tarjeta. El orden de las vías se ve en cada tarjeta y la
// cascada explica por qué se salta un paso: nada se marca «conectado» por tener una clave guardada.

type CloudSource = { code: string; name: string; run_status: string | null; fetched: number | null; catalog: number; eligible: number; selected: number; warning: string | null };
type ExtSource = { source: string; live: number; approved: number; last_seen: string | null };
type Conn = { id: string; name: string; status: 'ok' | 'error' | 'not_configured'; detail: string; ms?: number };
type Engine = { catalog_active: number; raw_items: number; raw_items_by_route: { collection: number | null; verification: number | null } | null; last_run: { day: string; status: string; completed_at: string | null } | null } | null;
type CatalogEntry = { code: string; name: string; category: string | null; website: string | null; acquisition_method: string | null; validation_status: string | null; requires: string | null; note: string | null };
type Row = CatalogEntry & { cloud: (CloudSource & { connectors: number }) | null; ext: ExtSource | null };
type Filter = 'all' | 'cloud' | 'failed' | 'local';
type Summary = { budget: Record<string, number | null>; spent: Record<string, number | null>; proxies: { configured: boolean; healthy: boolean }; unlocker_ready?: boolean; orders?: Record<string, string[]> | null; orders_error?: string; detail?: string };

const CATALOG = sourceCatalog as CatalogEntry[];
const CONN: Record<string, string> = { ok: 'Conectado', error: 'Con fallo', not_configured: 'Sin configurar' };
const RUN: Record<string, string> = { completed: 'Completada', failed: 'Fallida', running: 'En curso', queued: 'En cola', skipped: 'Omitida', deferred: 'Aplazada' };
const statusClass = (s: string | null) => s === 'ok' || s === 'completed' ? 'status ok' : s === 'error' || s === 'failed' ? 'status bad' : 'status';
const PROVIDER_NAMES: Record<string, string> = { brightdata: 'Bright Data', serpapi: 'SerpApi', apify: 'Apify', zenrows: 'ZenRows', scrapingbee: 'ScrapingBee', infojobs: 'InfoJobs', adzuna: 'Adzuna', jooble: 'Jooble' };
const PAID = new Set(['apify', 'brightdata', 'serpapi', 'zenrows', 'scrapingbee']);
const GROUP_ORDER: SourceGroup[] = ['multi', 'keyed', 'google', 'apify', 'other', 'none'];
// Seis decimales: un gasto de 0,0015 USD no puede pintarse como «0 USD» (el coste de una búsqueda real).
const usd = (value: number | null | undefined) => value === null || value === undefined ? '—' : `${value.toLocaleString('es', { maximumFractionDigits: 6 })} USD`;

export default function SourcesCenter({ sources, external = [], paused = [], engineDown = false, connections = [], paid = [], engine = null, owner = false, onOpenApis }: {
  sources: CloudSource[]; external?: ExtSource[]; paused?: string[]; engineDown?: boolean;
  connections?: Conn[]; paid?: Conn[]; engine?: Engine; owner?: boolean; onOpenApis?: () => void;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [category, setCategory] = useState('');
  const [text, setText] = useState('');
  const [limit, setLimit] = useState(25);
  const [guide, setGuide] = useState<{ name: string; code: string; setup: Setup } | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryError, setSummaryError] = useState('');
  const [tested, setTested] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [openGroup, setOpenGroup] = useState<SourceGroup | null>('keyed');
  useEffect(() => setLimit(25), [filter, category, text]);

  const loadSummary = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/source-routes?summary=1', { cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof (body as { detail?: string }).detail === 'string' ? (body as { detail: string }).detail : 'No se pudo leer el gasto de los proveedores.');
      setSummary(body as Summary);
      setSummaryError('');
    } catch (error) { setSummaryError((error as Error).message); }
  }, []);
  useEffect(() => { void loadSummary(); }, [loadSummary]);

  const ext = new Map(external.map(item => [item.source, item]));
  const cloud = groupByFamily(sources);
  const known = new Set(CATALOG.map(entry => entry.code));
  const rows: Row[] = [
    ...CATALOG.map(entry => ({ ...entry, cloud: cloud.get(entry.code) ?? null, ext: ext.get(entry.code) ?? null })),
    ...sources.filter(source => !known.has(catalogCodeFor(source.code))).map(source => ({ code: source.code, name: source.name, category: 'Motor cloud', website: null, acquisition_method: 'Recogida del motor cloud', validation_status: null, requires: 'none', note: null, cloud: cloud.get(catalogCodeFor(source.code)) ?? null, ext: null })),
    ...external.filter(item => !known.has(item.source) && !cloud.has(item.source)).map(item => ({ code: item.source, name: item.source, category: 'Fuentes externas', website: null, acquisition_method: 'API o recolector externo', validation_status: null, requires: 'none', note: null, cloud: null, ext: item })),
  ];
  const failed = (row: Row) => row.cloud?.run_status === 'failed';
  const categories = [...new Set(rows.map(row => row.category ?? 'Otras'))].sort();
  const q = text.trim().toLowerCase();
  const shown = rows.filter(row => (filter === 'all' || (filter === 'cloud' && (row.cloud || row.ext)) || (filter === 'failed' && failed(row)) || (filter === 'local' && !row.cloud && !row.ext))
    && (!category || (row.category ?? 'Otras') === category) && (!q || `${row.name} ${row.code} ${row.note ?? ''}`.toLowerCase().includes(q)));
  const inCloud = rows.filter(row => row.cloud || row.ext).length;
  const cell = (row: Row) => paused.includes(row.code) ? <span className="status bad">Pausada</span> : row.ext && !row.cloud ? <span className="status ok">Externa · {row.ext.live} activas</span> : row.cloud
    ? <span className={statusClass(row.cloud.run_status)}>{row.cloud.run_status ? RUN[row.cloud.run_status] ?? row.cloud.run_status : 'Sin recogida'}{row.cloud.connectors > 1 && <span className="sub">{row.cloud.connectors} conectores</span>}</span>
    : engineDown ? <span className="status">Sin datos del motor</span>
    : <span className="status">{row.requires === 'input' ? 'Requiere configurar' : 'Fuera del cloud'}</span>;

  // Claves realmente guardadas: `not_configured` es la única que significa «sin clave».
  const keys = new Set([...connections, ...paid].filter(item => item.status !== 'not_configured').map(item => item.id));
  const budget: Record<string, number | null> = { ...(summary?.budget ?? {}), apify: summary?.budget?.apify ?? null };
  const routeState: RouteState = {
    keys,
    paused: false,
    budget,
    proxiesHealthy: Boolean(summary?.proxies?.healthy),
    unlockerReady: summary?.unlocker_ready,
  };
  const bySource = routesForCatalog(CATALOG);
  const orders = summary?.orders ?? {};
  const orderOf = (code: string) => orders[code] ?? [];
  const routesOf = (code: string) => bySource.get(code) ?? [];
  const groupOf = (code: string) => groupForSource(routesOf(code), keys);
  const pinnedLast = (route?: SourceRoute) => Boolean(route && (route.provider === 'jobspy' || route.provider === 'agent'));
  const withInput = rows.filter(row => row.requires === 'input');
  const groups = GROUP_ORDER
    .map(id => ({ id, items: withInput.filter(row => groupOf(row.code) === id) }))
    .filter(group => group.items.length > 0);

  // KPIs calculados con datos reales. Un hueco se declara: no se pinta 0 por comodidad.
  // JobSpy no cobra por petición, pero sin proxies sanos no es «operativa»: no engorda este KPI.
  const freeSources = rows.filter(row => routesOf(row.code).some(route => route.cost === 'free' && route.evidence !== 'bloqueado' && route.provider !== 'jobspy')).length;
  const keyedSources = withInput.filter(row => routesOf(row.code).some(route => ((route.requiresKey && keys.has(route.requiresKey)) || route.requiresAnyKey?.some(key => keys.has(key))) && route.provider !== 'jobspy')).length;
  const paidActive = [...PAID].filter(id => keys.has(id)).length;
  const spendKeys: Array<'brightdata' | 'serpapi' | 'zenrows' | 'scrapingbee'> = ['brightdata', 'serpapi', 'zenrows', 'scrapingbee'];
  const spend = spendKeys.map(id => ({ id, spent: summary?.spent?.[id] ?? null, cap: summary?.budget?.[id] ?? null })).filter(item => keys.has(item.id));
  const spendTotal = spend.length && spend.every(item => item.spent !== null) ? spend.reduce((sum, item) => sum + (item.spent ?? 0), 0) : null;
  const spendCap = spend.length && spend.every(item => item.cap !== null) ? spend.reduce((sum, item) => sum + (item.cap ?? 0), 0) : null;

  async function testRoute(row: Row, route: SourceRoute, url?: string) {
    setBusy(`${row.code}:${route.id}`);
    setTested(old => ({ ...old, [row.code]: '' }));
    try {
      const response = await fetch('/api/admin/source-routes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'test', source: row.code, route: route.id, ...(url ? { url } : {}) }) });
      const body = await response.json().catch(() => ({})) as { detail?: string; note?: string; accepted?: number; cost_usd?: number };
      if (!response.ok) throw new Error(body.detail ?? 'La prueba falló.');
      // El gasto y el saldo se acaban de mover: se releen para que el KPI no siga enseñando el valor anterior.
      await loadSummary();
      setTested(old => ({ ...old, [row.code]: (body.note ?? (body.accepted !== undefined ? `${body.accepted} oferta(s) guardadas.` : 'Prueba completada.')) + (body.cost_usd ? ` Coste: ${usd(body.cost_usd)}.` : '') }));
    } catch (error) {
      setTested(old => ({ ...old, [row.code]: (error as Error).message }));
    } finally { setBusy(null); }
  }

  async function saveOrder(row: Row, order: string[]) {
    setBusy(`order:${row.code}`);
    setTested(old => ({ ...old, [row.code]: '' }));
    try {
      const response = await fetch('/api/admin/source-routes', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: row.code, order }) });
      const body = await response.json().catch(() => ({})) as { detail?: string };
      if (!response.ok) throw new Error(body.detail ?? 'No se pudo guardar el orden.');
      await loadSummary();
      setTested(old => ({ ...old, [row.code]: order.length ? 'Orden personalizado guardado. JobSpy sigue al final.' : 'Orden por coste restaurado.' }));
    } catch (error) {
      setTested(old => ({ ...old, [row.code]: (error as Error).message }));
    } finally { setBusy(null); }
  }

  function moveRoute(ordered: SourceRoute[], index: number, delta: number): string[] {
    const ids = ordered.map(route => route.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return ids;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    return ids;
  }

  return <>
    <h2 className="section-title">Fuentes de datos</h2>
    {engineDown && <p className="card-meta" style={{ marginBottom: 12 }}>Sin datos del motor cloud en esta consulta: el estado de las fuentes que no son externas no se puede comprobar ahora mismo.</p>}

    <div className="source-dashboard" data-testid="sources-kpis">
      <article className="dash-kpi"><span className="eyebrow">GRATIS Y OPERATIVAS</span><strong>{freeSources}</strong><p>Sin clave ni coste por petición. Siempre van primero.</p></article>
      <article className="dash-kpi"><span className="eyebrow">CON CLAVE</span><strong>{keyedSources}</strong><p>Fuentes con alguna vía de clave ya guardada. Guardar no gasta.</p></article>
      <article className="dash-kpi"><span className="eyebrow">DE PAGO ACTIVAS</span><strong>{paidActive}</strong><p>{paidActive ? [...PAID].filter(id => keys.has(id)).map(id => PROVIDER_NAMES[id] ?? id).join(' · ') : 'Ningún proveedor de pago configurado.'}</p></article>
      <article className="dash-kpi"><span className="eyebrow">CON FALLO</span><strong>{engineDown ? '—' : rows.filter(failed).length}</strong><p>{engineDown ? 'Sin datos del motor en esta consulta.' : 'La causa está en la fila; una caída no oculta las demás.'}</p></article>
      <article className="dash-kpi is-money"><span className="eyebrow">GASTO DEL MES</span><strong>{summaryError ? '—' : spendTotal === null ? '—' : usd(spendTotal)}</strong><p>{summaryError ? summaryError : spendCap === null ? 'Sin tope legible: no se lanza gasto nuevo.' : `Tope ${usd(spendCap)} · ${spend.map(item => `${PROVIDER_NAMES[item.id] ?? item.id} ${usd(item.spent)}`).join(' · ') || 'sin proveedores de pago configurados'}`}</p></article>
      <article className="dash-kpi"><span className="eyebrow">APROBADAS POR DÓLAR</span><strong>—</strong><p>Se calcula en «Resultados por fuente» con las candidaturas reales; aquí no se estima.</p></article>
    </div>

    <div className="sources-hub">
      <div className="sources-hub-head">
        <div><span className="eyebrow">CÓMO SE CONECTA CADA UNA</span><h3>La cascada va de lo gratis a lo que se paga.</h3></div>
        <p className="card-meta">Cada tarjeta enseña sus vías en orden. Si la primera falla o vuelve vacía, se prueba la siguiente; JobSpy es la última y solo se lanza con proxies sanos. Sin clave no hay conexión: dice «sin clave».</p>
        {summary?.orders_error && <p className="inline-hint" role="alert">{summary.orders_error}</p>}
      </div>
      {!groups.length && <p className="muted">No hay fuentes pendientes de configurar.</p>}
      {groups.map(group => <section className="source-group" key={group.id}>
        <button type="button" className="source-group-head" aria-expanded={openGroup === group.id} onClick={() => setOpenGroup(openGroup === group.id ? null : group.id)}>
          <span><strong>{GROUP_LABEL[group.id]}</strong><span className="status">{group.items.length}</span></span>
          <ChevronDown size={16} style={{ transform: openGroup === group.id ? 'rotate(180deg)' : undefined }} />
        </button>
        {openGroup === group.id && <div className="source-group-grid">
          {group.items.map(row => {
            const routes = routesOf(row.code);
            const order = orderOf(row.code);
            const steps = planCascade(routes, routeState, order);
            const ordered = orderRoutes(routes, order);
            const firstReady = steps.find(step => step.ready);
            return <article className="source-card source-route-card" key={row.code}>
              <div className="card-head"><div><h3>{row.name}</h3><span className="sub">{row.code} · {row.category ?? 'Otras'}</span></div><span className={row.cloud ? statusClass(row.cloud.run_status) : 'status'}>{row.cloud ? (row.cloud.run_status ? RUN[row.cloud.run_status] ?? row.cloud.run_status : 'Sin recogida') : 'Sin recoger'}</span></div>
              <ol className="route-list">
                {steps.map(step => <li key={step.route.id} className={step.ready ? 'is-ready' : 'is-off'}>
                  <span className="route-name">{step.route.label}</span>
                  <span className="route-cost">{COST_LABEL[step.route.cost]}{step.route.costUsd !== null && step.route.costUsd > 0 ? ` · ${step.route.costUsd} USD` : ''}</span>
                  <span className={step.ready ? 'status ok' : 'status'}>{step.ready ? (step.route.evidence === 'documentado' ? 'Lista · sin probar' : 'Lista') : step.reason}</span>
                </li>)}
              </ol>
              {owner && <details className="route-order">
                <summary>Orden de vías: {order.length ? 'personalizado' : 'por coste'}</summary>
                <p className="card-meta">Sin cambios manda el orden por coste. Puedes subir o bajar una vía; JobSpy y el agente quedan siempre al final.</p>
                <ol className="route-list">
                  {steps.map((step, index) => <li key={`order-${step.route.id}`} className={step.ready ? 'is-ready' : 'is-off'}>
                    <span className="route-name">{step.route.label}</span>
                    <span className="card-actions">
                      <button type="button" aria-label={`Subir ${step.route.label}`} disabled={busy !== null || index === 0 || pinnedLast(step.route) || pinnedLast(ordered[index - 1])}
                        onClick={() => void saveOrder(row, moveRoute(ordered, index, -1))}>↑</button>
                      <button type="button" aria-label={`Bajar ${step.route.label}`} disabled={busy !== null || index === ordered.length - 1 || pinnedLast(step.route) || pinnedLast(ordered[index + 1])}
                        onClick={() => void saveOrder(row, moveRoute(ordered, index, 1))}>↓</button>
                    </span>
                  </li>)}
                </ol>
                {order.length > 0 && <button type="button" disabled={busy !== null} onClick={() => void saveOrder(row, [])}>Volver al orden por coste</button>}
                {busy === `order:${row.code}` && <p className="inline-hint"><LoaderCircle size={12} className="spin" /> Guardando el orden…</p>}
              </details>}
              {tested[row.code] && <p className="inline-hint" role="status">{tested[row.code]}</p>}
              <div className="card-actions">
                <button type="button" disabled={!firstReady || busy !== null} title={firstReady ? `Prueba: ${firstReady.route.label}` : 'Ninguna vía está lista: falta clave o tope.'} onClick={() => {
                  if (!firstReady) return;
                  if (firstReady.route.provider === 'unlocker') {
                    const url = window.prompt('URL pública con JobPosting o RSS:', '');
                    if (url) void testRoute(row, firstReady.route, url);
                    return;
                  }
                  void testRoute(row, firstReady.route);
                }}>
                  {busy === `${row.code}:${firstReady?.route.id}` ? <LoaderCircle size={14} className="spin" /> : <PlugZap size={14} />} Probar ruta
                </button>
                <button type="button" onClick={() => setGuide({ name: row.name, code: row.code, setup: setupFor(row) })}>Cómo conectarla</button>
                {row.website && <a href={row.website} target="_blank" rel="noopener noreferrer">Ver portal<ArrowUpRight size={12} /></a>}
              </div>
              <p className="card-meta">Ruta activa: <strong>{firstReady ? `${steps.filter(step => step.ready).indexOf(firstReady) + 1} de ${steps.length}` : `0 de ${steps.length}`}</strong>{firstReady ? ` · ${firstReady.route.label}` : ' · sin clave o sin tope'}</p>
            </article>;
          })}
        </div>}
      </section>)}
    </div>

    <div className="stat-strip"><span><strong>{rows.length}</strong>fuentes catalogadas</span><span><strong>{inCloud}</strong>recogidas (motor cloud o externas)</span><span><strong>{engineDown ? '—' : rows.filter(failed).length}</strong>con fallo</span><span><strong>{engineDown ? '—' : rows.length - inCloud}</strong>fuera del cloud (app local o con configuración)</span></div>
    <div className="search-panel admin-toolbar">
      <label className="grow" htmlFor="src-q">Buscar<input id="src-q" placeholder="Nombre o código" value={text} onChange={e => setText(e.target.value)} /></label>
      <label htmlFor="src-filter">Mostrar<select id="src-filter" value={filter} onChange={e => setFilter(e.target.value as Filter)}><option value="all">Todas</option><option value="cloud">En el motor cloud</option><option value="failed">Con fallo</option><option value="local">Fuera del cloud</option></select></label>
      <label htmlFor="src-cat">Categoría<select id="src-cat" value={category} onChange={e => setCategory(e.target.value)}><option value="">Todas</option>{categories.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
    </div>
    {!shown.length ? <div className="empty"><h3>Ninguna fuente con estos filtros.</h3></div> : <div className="table-wrap"><table className="data-table">
      <thead><tr><th>Fuente</th><th>Categoría</th><th>Método</th><th>Estado</th><th className="num">Leídas</th><th className="num">Catálogo</th><th className="num">Elegibles</th></tr></thead>
      <tbody>{shown.slice(0, limit).map(row => <tr key={row.code}>
        <td className="primary-cell"><strong>{row.website ? <a href={row.website} target="_blank" rel="noopener noreferrer">{row.name}</a> : row.name}</strong><span>{row.code}</span>
          {row.cloud?.warning && <span style={{ color: 'var(--warning)' }}>{row.cloud.warning}</span>}{!row.cloud && row.note && <span>{row.note}</span>}
          {!row.cloud && !row.ext && row.requires === 'input' && <button type="button" className="source-setup-open"
            aria-haspopup="dialog" onClick={() => setGuide({ name: row.name, code: row.code, setup: setupFor(row) })}>Cómo conectarla · guía paso a paso</button>}</td>
        <td>{row.category ?? '—'}</td><td>{row.acquisition_method ?? '—'}{row.validation_status && <span className="sub">{row.validation_status}</span>}</td>
        <td>{cell(row)}</td><td className="num">{row.cloud?.fetched ?? '—'}</td><td className="num">{row.cloud?.catalog ?? '—'}</td><td className="num">{row.cloud?.eligible ?? '—'}</td></tr>)}</tbody></table></div>}
    {shown.length > limit && <p className="card-meta" style={{ marginTop: 12 }}><button onClick={() => setLimit(value => value + 25)}>Mostrar {Math.min(25, shown.length - limit)} más</button> <span aria-live="polite">Mostrando {limit} de {shown.length}</span></p>}

    {(connections.length > 0 || paid.length > 0) && <>
      <h2 className="section-title">Conexiones del sistema</h2>
      <p className="card-meta">Solo lectura: las claves se guardan y se prueban en <button type="button" className="link-button" onClick={onOpenApis}>Panel → APIs</button>. «Con fallo» no es «sin clave»: la clave está guardada y la última prueba la rechazó.</p>
      <div className="card-grid">{[...connections, ...paid].map(item => <article className="source-card" key={item.id}>
        <div className="card-head"><h3>{item.name}</h3><span className={statusClass(item.status)}>{CONN[item.status]}</span></div>
        <p className="card-meta">{item.detail}{item.ms ? ` · ${item.ms} ms` : ''}</p></article>)}</div>
    </>}

    {guide && <SourceSetupGuide name={guide.name} code={guide.code} setup={guide.setup} onClose={() => setGuide(null)} onOpenApis={onOpenApis} />}
  </>;
}
