'use client';
import { useCallback, useEffect, useState } from 'react';
import { KeyRound, LoaderCircle, PlugZap, Trash2 } from 'lucide-react';
import { cost, money, unit, usd } from '../lib/money';
import { providerBreakdown, providerTotals, type SourceRow } from '../lib/sourceScorecard';
import SpendControl from './SpendControl';

type Connection = { provider: string; name: string; configured: boolean; last4: string | null; updated_by: string | null; updated_at: string | null; last_test_at: string | null; last_test_ok: boolean | null; last_test_detail: string | null };
const fmt = (v: string | null) => v ? new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(v)) : '—';
// Gasto y rendimiento ya medidos para cada proveedor (mismo dato que «Resultados por fuente», agrupado
// por quién cobra). La ruta del marcador es la que lee Apify, el respaldo de SerpApi y el tipo del BCE.
type PerfPayload = {
  rows: SourceRow[];
  truncated: boolean;
  cost: { fx: { eur_per_usd: number; source: 'EUR_PER_USD' | 'BCE'; date: string | null } | null; error: string | null; unattributed_usd: number | null; note: string };
};
const int = (value: number | null) => value === null ? '—' : value.toLocaleString('es');
const SPEND = new Set(['brightdata', 'zenrows', 'scrapingbee']);
const PURPOSE: Record<string, string> = { apify: 'Extracción de portales con actores de Apify.', serpapi: 'Búsqueda de ofertas indexadas en Google (incluye InfoJobs y LinkedIn). El cron la usa 7 veces al día para closer en España y LatAm y hasta 4 más para cubrir los portales sin API oficial propia (~0,275 USD/día).', groq: 'Clasificación y resúmenes con IA (proveedor por defecto).', openai: 'Análisis individual de ofertas con IA.',
  infojobs: 'API oficial de InfoJobs (cuenta de desarrollador gratuita, con aprobación). Formato: client_id:client_secret.', adzuna: 'API de Adzuna (clave gratuita). Formato: app_id:app_key.', brightdata: 'Google Jobs y Web Unlocker. Pega solo la API key (Cuenta → API keys): la zona SERP se detecta sola con la API de cuenta, que es gratis; si prefieres fijarla, vale API key:zona SERP (y :zona Unlocker). Va antes que SerpApi porque cuesta 0,0015 USD/búsqueda frente a 0,025; comparte 5.000 créditos gratis al mes. «Probar» valida primero la clave y la zona sin gastar y luego hace UNA búsqueda real (~0,0015 USD).', zenrows: 'HTML de portales con anti-bot, solo donde ya hay extractor JSON-LD/RSS. Se paga por página (~0,002 USD); «Probar» hace una petición real.', scrapingbee: 'HTML de portales con anti-bot, solo donde ya hay extractor JSON-LD/RSS. Se paga por crédito (~0,002 USD); «Probar» hace una petición real.', resend: 'Correo (Resend). Con la clave guardada, el panel avisa por correo al propietario en cuanto el motor se pausa por cuota o deja de responder (un aviso por estado, nunca a alumnas). El correo entrante sigue sin construirse.', jooble: 'API de Jooble (clave gratuita en es.jooble.org/api/about: cada país tiene su propia clave; la de jooble.org solo trae ofertas de EE. UU.).' };

async function api<T>(init?: RequestInit, query = ''): Promise<T> {
  const response = await fetch(`/api/admin/connections${query}`, { headers: { 'Content-Type': 'application/json' }, ...init });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof (data as { detail?: string }).detail === 'string' ? (data as { detail: string }).detail : 'La operación falló.');
  return data as T;
}

export default function ApisTab({ owner, onSessionLost }: { owner: boolean; onSessionLost: () => void }) {
  const [items, setItems] = useState<Connection[]>([]);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>('load');
  const [perf, setPerf] = useState<PerfPayload | null>(null);
  const [perfError, setPerfError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(() => {
    api<{ connections: Connection[] }>().then(d => { setItems(d.connections); setError(''); })
      .catch(err => { if ((err as Error).message.includes('Sesión')) onSessionLost(); setError((err as Error).message); })
      .finally(() => setBusy(null));
  }, [onSessionLost]);
  useEffect(load, [load]);
  // El gasto no se estima: se lee el importe ya registrado. Si falla, la tarjeta lo dice y no pinta 0.
  useEffect(() => {
    fetch('/api/admin/source-scorecard', { cache: 'no-store' })
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) onSessionLost();
          throw new Error(typeof (body as { detail?: string }).detail === 'string' ? (body as { detail: string }).detail : 'No se pudo leer el gasto por proveedor.');
        }
        setPerf(body as PerfPayload);
      })
      .catch((err: Error) => setPerfError(err.message));
  }, [onSessionLost]);
  // Proveedor = quien cobra por traer las ofertas: `apify-*`, `serpapi-*` y las claves oficiales. Las
  // fuentes gratuitas del motor no tienen proveedor y no entran en esta tabla.
  const providers = perf ? providerBreakdown(perf.rows, items.map(c => ({ provider: c.provider, name: c.name, configured: c.configured }))) : [];
  const perfTotals = providerTotals(providers);
  async function run(provider: string, action: () => Promise<string>) {
    setBusy(provider); setError(''); setNotice('');
    try { setNotice(await action()); load(); } catch (err) { setError((err as Error).message); setBusy(null); }
  }
  return <section aria-label="APIs y conexiones">
    <p className="card-meta" style={{ marginTop: 0, marginBottom: 20, maxWidth: 760 }}>Las claves se guardan cifradas en el servidor y no vuelven al navegador: solo ves los últimos 4 caracteres. Guardar una clave no gasta nada. «Probar» usa la comprobación más barata de cada proveedor: en las APIs oficiales es gratis; en Bright Data, ZenRows y ScrapingBee hace <strong>una</strong> petición real (~0,0015–0,002 USD) porque no hay endpoint de cuenta que valide la zona, y la ficha lo avisa. El motor solo usa un proveedor de pago cuando lo ordenas y hay tope.</p>
    <SpendControl owner={owner} onSessionLost={onSessionLost} />
    <h2 className="section-title">Gasto y rendimiento por proveedor</h2>
    <p className="card-meta" style={{ marginTop: 0, maxWidth: 760 }}>Lo que ya está registrado, no una estimación: el importe real de cada ejecución de Apify y la nota del respaldo de SerpApi (0,025 USD por búsqueda). Una raya (—) significa que ese proveedor no registra importe o que falta el tipo de cambio, no que sea gratis. «Vivos», «enviadas» y «entrevistas» son las ofertas que trajo ese proveedor y las candidaturas de la alumna desde ellas; el coste por envío y por entrevista reparte el gasto entre esas candidaturas.</p>
    {perfError
      ? <div className="alert error" role="alert"><span>{perfError}</span></div>
      : !perf || busy === 'load'
        ? <p className="muted"><LoaderCircle size={14} className="spin" /> Leyendo gasto registrado y candidaturas…</p>
        : <>
          <div className="source-dashboard" data-testid="provider-dashboard">
            <article className="dash-kpi is-money"><span className="eyebrow">GASTO REGISTRADO</span><strong>{money(perfTotals.cost_eur)}{perfTotals.cost_partial ? '*' : ''}</strong><p>{usd(perfTotals.cost_usd)} registrados · {perfTotals.funded} de {perfTotals.providers} proveedores con importe</p></article>
            <article className="dash-kpi"><span className="eyebrow">€ POR ENVÍO</span><strong>{unit(perfTotals.per_send_eur)}</strong><p>Coste registrado entre {int(perfTotals.sent)} enviadas (incluye las de fuentes gratuitas)</p></article>
            <article className="dash-kpi"><span className="eyebrow">€ POR ENTREVISTA</span><strong>{unit(perfTotals.per_interview_eur)}</strong><p>{int(perfTotals.interviews)} entrevistas y ofertas de esas candidaturas</p></article>
          </div>
          <div className="scorecard-scroll" style={{ marginBottom: 22 }}>
            <table className="scorecard-table" data-testid="provider-table">
              <caption>Gasto y rendimiento de todo el histórico por proveedor. El coste sale de `apify_runs.cost_usd` (por su actor) y de las notas de respaldo de SerpApi; el de las claves oficiales no se registra y sale en «—». SerpApi de Google Jobs (7 búsquedas diarias) no anota importe y no suma.</caption>
              <thead>
                <tr>
                  <th scope="col">Proveedor</th>
                  <th scope="col">Clave</th>
                  <th scope="col" title="Importe ya registrado, convertido a euros con el tipo del BCE">Gasto (€)</th>
                  <th scope="col" title="Anuncios vivos que trajeron sus fuentes">Vivos</th>
                  <th scope="col">Enviadas</th>
                  <th scope="col">Entrevistas</th>
                  <th scope="col" title="Gasto registrado dividido por candidaturas enviadas a sus ofertas">€ / envío</th>
                  <th scope="col" title="Gasto registrado dividido por entrevistas (incluye ofertas)">€ / entrevista</th>
                </tr>
              </thead>
              <tbody>
                {providers.map(row => <tr key={`provider-${row.provider}`}>
                  <th scope="row">{row.name}{row.sources ? <span className="card-meta" style={{ display: 'block' }}>{row.sources} fuente{row.sources === 1 ? '' : 's'}</span> : null}</th>
                  <td>{row.configured ? <span className="status ok">Con clave</span> : <span className="status">Sin clave</span>}</td>
                  <td title={row.cost_reason === 'sin_coste' ? 'Sin importe registrado para este proveedor (no significa que sea gratis).' : row.cost_reason === 'sin_tipo_de_cambio' ? `Registrado ${usd(row.cost_usd)}, pero falta el tipo de cambio para pasarlo a euros.` : undefined}>{cost(row.cost_eur)}{row.cost_partial && row.cost_eur !== null ? '*' : ''}</td>
                  <td>{int(row.ingested)}</td>
                  <td>{row.sent}</td>
                  <td>{row.interviews}</td>
                  <td title={row.cost_eur === null ? 'Sin gasto registrado: no hay importe que repartir.' : row.sent === 0 ? 'Sin envíos: no hay denominador.' : undefined}>{unit(row.per_send_eur)}</td>
                  <td title={row.cost_eur === null ? 'Sin gasto registrado: no hay importe que repartir.' : row.interviews === 0 ? 'Sin entrevistas: no hay denominador.' : undefined}>{unit(row.per_interview_eur)}</td>
                </tr>)}
              </tbody>
            </table>
          </div>
          {!providers.some(row => row.cost_usd !== null || row.sent > 0 || row.ingested !== null) && <p className="card-meta">Todavía no hay gasto ni candidaturas atribuibles a un proveedor: la tabla se llenará en cuanto el motor recoja con una API y una alumna envíe desde sus ofertas.</p>}
          {perf.truncated && <p className="inline-hint">Se leyó hasta el tope de candidaturas: el rendimiento es un mínimo, no el total.</p>}
          {perf.cost.error && <p className="inline-hint" role="alert">{perf.cost.error}</p>}
          {perf.cost.unattributed_usd !== null && perf.cost.unattributed_usd > 0 && <p className="card-meta">{usd(perf.cost.unattributed_usd)} de Apify no se pudieron atribuir a una fuente (su actor ya no está en la tabla) y no están en la columna de gasto.</p>}
          {perfTotals.cost_partial && <p className="card-meta">* Gasto mínimo: alguna ejecución no informó su importe, así que el total real puede ser mayor.</p>}
          {perf.cost.fx
            ? <p className="card-meta">Tipo de cambio: 1 USD = {perf.cost.fx.eur_per_usd.toLocaleString('es', { maximumFractionDigits: 4 })} € ({perf.cost.fx.source === 'BCE' ? `BCE${perf.cost.fx.date ? `, ${perf.cost.fx.date}` : ''}` : 'fijado en EUR_PER_USD'}).</p>
            : <p className="card-meta">Sin tipo de cambio EUR/USD: el gasto queda en dólares registrados y las columnas en € en «—».</p>}
        </>}
    <h2 className="section-title">Claves y conexiones</h2>
    {error && <div className="alert error" role="alert"><span>{error}</span></div>}
    {notice && <div className="auth-note" role="status" style={{ marginBottom: 20 }}>{notice}</div>}
    {busy === 'load' ? <p className="muted"><LoaderCircle size={14} className="spin" /> Cargando…</p> : <div className="card-grid">{items.map(c => {
      // Una prueba que falla no siempre es «clave rechazada»: el detalle dice si fue la clave, la zona o la
  // respuesta. El rótulo solo dice «Rechazada» cuando Bright Data rechazó de verdad la clave.
  const state = !c.configured ? ['Sin clave', 'status'] : c.last_test_ok == null ? ['Guardada · sin probar', 'status'] : c.last_test_ok ? ['Válida', 'status ok']
    : /rechaz[oó] la clave|clave rechazada|formato incorrecto|no parece válida/i.test(c.last_test_detail ?? '') ? ['Rechazada', 'status bad'] : ['Con error', 'status bad'];
      const spendBlocked = SPEND.has(c.provider) && !owner;
      return <article className="source-card" key={c.provider}>
        <div className="card-head"><div><h3>{c.name}</h3><p className="card-meta" style={{ marginTop: 4 }}>{PURPOSE[c.provider]}</p></div><span className={state[1]}>{state[0]}</span></div>
        {c.configured && <p className="card-meta">Clave …{c.last4}{c.last_test_at ? ` · ${c.last_test_detail} (${fmt(c.last_test_at)})` : ''}{c.updated_by ? ` · cambiada por ${c.updated_by}, ${fmt(c.updated_at)}` : ''}</p>}
        {SPEND.has(c.provider) && <p className="inline-hint">Probar esta clave hace 1 petición real y se cobra (~0,0015–0,002 USD). Guardar no gasta.</p>}
        <form className="card-form" onSubmit={e => { e.preventDefault(); void run(c.provider, async () => { await api({ method: 'PUT', body: JSON.stringify({ provider: c.provider, secret: secrets[c.provider] }) }); setSecrets(s => ({ ...s, [c.provider]: '' })); return `Clave de ${c.name} guardada.`; }); }}>
          {owner && <input id={`key-${c.provider}`} type="password" autoComplete="off" placeholder={c.configured ? 'Pegar una clave nueva para sustituirla' : 'Pegar la clave de API'} value={secrets[c.provider] ?? ''} onChange={e => setSecrets(s => ({ ...s, [c.provider]: e.target.value }))} aria-label={`Clave de ${c.name}`} />}
          {owner && <button className="primary" disabled={busy !== null || !(secrets[c.provider] ?? '').trim()}><KeyRound size={14} /> Guardar</button>}
          <button type="button" disabled={busy !== null || !c.configured || spendBlocked} title={spendBlocked ? 'Solo el propietario puede hacer una prueba que gasta.' : undefined} onClick={() => void run(c.provider, async () => { const r = await api<{ ok: boolean; detail: string }>({ method: 'POST', body: JSON.stringify({ provider: c.provider }) }); return `${c.name}: ${r.detail}.`; })}>
            {busy === c.provider ? <LoaderCircle size={14} className="spin" /> : <PlugZap size={14} />} Probar</button>
          {owner && c.configured && <button type="button" disabled={busy !== null} onClick={() => { if (window.confirm(`¿Borrar la clave de ${c.name}?`)) void run(c.provider, async () => { await api({ method: 'DELETE' }, `?provider=${c.provider}`); return `Clave de ${c.name} borrada.`; }); }}><Trash2 size={14} /> Borrar</button>}
        </form></article>; })}</div>}
    {!owner && <p className="muted" style={{ marginTop: 20 }}>Solo el propietario puede guardar o borrar claves.</p>}
  </section>;
}
