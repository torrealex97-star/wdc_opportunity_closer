'use client';
import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, LoaderCircle, RefreshCcw } from 'lucide-react';
import type { Funnel, FunnelMarket } from '../lib/funnel';
import { ROLE_LABELS, type RoleFamily } from '../lib/vocabulary';
import { costPerApproved, paidFreeSplit, type PaidRow } from '../lib/commandCenter';

// Centro de mando: la salud de la selección en pocos segundos. Embudo de 7 días, ofertas visibles por mercado y gasto con coste por oferta
// aprobada. Cada bloque tiene su propio estado de carga/error: si uno falla, los otros siguen y el hueco se pinta «—» con su causa.
const nf = new Intl.NumberFormat('es');
const usd = (v: number | null) => v === null ? '—' : new Intl.NumberFormat('es', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(v);
const MARKET: Record<FunnelMarket, string> = { ES: 'España', LATAM: 'LATAM', LATAM_DEFECTO: 'LATAM por defecto', US_LATINO: 'EE. UU. / dólares', SIN_MERCADO: 'Sin mercado' };
type Sample = { rows: Array<PaidRow & { approved_pct: number | null }>; cost_note: string | null };
type Spend = { providers: Array<{ provider: string; name: string; spent_usd: number | null; cap_usd: number; used_pct: number | null }>; apify: { spent_usd: number | null; cap_usd: number } };

function useJson<T>(url: string, onSessionLost: () => void, fallback: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const load = useCallback(() => {
    setBusy(true); setError('');
    fetch(url, { cache: 'no-store' }).then(async r => {
      const d = await r.json().catch(() => ({}));
      if (r.status === 401 || r.status === 403) onSessionLost();
      if (!r.ok) throw new Error(typeof (d as { detail?: string }).detail === 'string' ? (d as { detail: string }).detail : fallback);
      setData(d as T);
    }).catch((e: Error) => { setData(null); setError(e.message); }).finally(() => setBusy(false));
  }, [url, onSessionLost, fallback]);
  useEffect(load, [load]);
  return { data, error, busy, load };
}

/** Tendencia: barras con base en 0, por día (hasta 30 días) o por semana (año). Alternativa en tabla para quien no ve el gráfico. */
function Trend({ block }: { block: NonNullable<Funnel['range']> }) {
  const rows = block.series;
  if (block.days === 1 || !rows.length) return null;
  const max = Math.max(1, ...rows.map(r => Math.max(r.new, r.approved)));
  const W = 560, H = 120, gap = 3, bar = Math.max(2, (W - gap * (rows.length - 1)) / rows.length / 2);
  const total = rows.reduce((s, r) => s + r.approved, 0);
  const label = (start: string) => dateFmt.format(new Date(`${start}T00:00:00Z`));
  return <div style={{ marginTop: 14 }} data-testid="cc-trend">
    <svg viewBox={`0 0 ${W} ${H + 16}`} width="100%" role="img" aria-label={`Ofertas nuevas y aprobadas por ${block.bucket === 'dia' ? 'día' : 'semana'}: ${total} aprobadas en total`} style={{ maxWidth: W }}>
      <line x1="0" x2={W} y1={H} y2={H} stroke="var(--line)" />
      {rows.map((r, i) => { const x = i * (bar * 2 + gap); const hn = (r.new / max) * H, ha = (r.approved / max) * H; return <g key={r.start}>
        <rect x={x} y={H - hn} width={bar} height={hn} fill="var(--ink)" opacity="0.35" />
        <rect x={x + bar} y={H - ha} width={bar} height={ha} fill="var(--accent)" /></g>; })}
    </svg>
    <p className="card-meta" style={{ margin: '4px 0 0' }}>Barras claras: recogidas nuevas · barras de color: aprobadas · por {block.bucket === 'dia' ? 'día' : 'semana'}, desde {label(rows[0].start)}.</p>
    <details><summary className="card-meta">Ver tabla</summary>
      <div className="table-wrap"><table className="data-table" data-testid="cc-trend-table"><caption className="card-meta" style={{ textAlign: 'left' }}>Recogidas y aprobadas por {block.bucket === 'dia' ? 'día' : 'semana'}</caption>
        <thead><tr><th scope="col">{block.bucket === 'dia' ? 'Día' : 'Semana desde'}</th><th scope="col" className="num">Recogidas</th><th scope="col" className="num">Aprobadas</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.start}><th scope="row" style={{ fontWeight: 400 }}>{label(r.start)}</th><td className="num">{nf.format(r.new)}</td><td className="num">{nf.format(r.approved)}</td></tr>)}</tbody></table></div></details>
  </div>;
}

const Failed = ({ text, retry, busy }: { text: string; retry: () => void; busy: boolean }) => <div className="alert error" role="alert"><span>{text}</span> <button onClick={retry} disabled={busy}><RefreshCcw size={14} /> Reintentar</button></div>;

const RANGES: Array<{ days: number; label: string; text: string }> = [{ days: 1, label: 'Hoy', text: 'las últimas 24 horas' }, { days: 7, label: '7 días', text: 'los últimos 7 días' }, { days: 30, label: '30 días', text: 'los últimos 30 días' }, { days: 365, label: 'Año', text: 'el último año' }];
const dateFmt = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export default function CommandCenter({ onResolve, onSessionLost }: { onResolve: () => void; onSessionLost: () => void }) {
  const [days, setDays] = useState(7);
  const [role, setRole] = useState('');
  const [market, setMarket] = useState('');
  const query = new URLSearchParams({ days: String(days), ...(role ? { role } : {}), ...(market ? { market } : {}) }).toString();
  const funnel = useJson<Funnel>(`/api/admin/funnel?${query}`, onSessionLost, 'No se pudo cargar el embudo.');
  const sample = useJson<Sample>('/api/admin/source-sample', onSessionLost, 'No se pudo leer lo recogido por fuente.');
  const spend = useJson<Spend>('/api/admin/spend', onSessionLost, 'No se pudo leer el gasto.');
  const f = funnel.data;
  const t = f?.range;
  const rangeText = RANGES.find(r => r.days === days)?.text ?? '';
  const costReadable = Boolean(sample.data) && !/No se pudo leer/.test(sample.data?.cost_note ?? '');
  const paidRows = (sample.data?.rows ?? []).filter(r => r.cost_usd !== null && r.cost_usd > 0).sort((a, b) => (b.cost_usd ?? 0) - (a.cost_usd ?? 0));
  const split = sample.data ? paidFreeSplit(sample.data.rows, costReadable) : null;
  const byMarket = (f?.range.visible_by_market ?? {}) as Record<string, number>;
  const markets = (Object.keys(MARKET) as FunnelMarket[]).filter(m => (byMarket[m] ?? 0) > 0);
  const maxVisible = Math.max(1, ...markets.map(m => byMarket[m]));

  return <section aria-label="Centro de mando" data-testid="command-center" style={{ marginBottom: 28 }}>
    <h2 className="section-title">Cómo va la selección</h2>
    <div className="search-panel admin-toolbar" role="group" aria-label="Filtros del Centro de mando" data-testid="cc-filters" style={{ alignItems: 'end' }}>
      <div role="group" aria-label="Rango de fechas" style={{ display: 'flex', gap: 6 }}>
        {RANGES.map(r => <button key={r.days} type="button" aria-pressed={days === r.days} className={days === r.days ? 'primary' : undefined} onClick={() => setDays(r.days)}>{r.label}</button>)}
      </div>
      <label htmlFor="cc-role">Categoría<select id="cc-role" value={role} onChange={e => setRole(e.target.value)}><option value="">Todas</option>{Object.entries(ROLE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}<option value="none">Sin perfil claro</option></select></label>
      <label htmlFor="cc-market">Mercado<select id="cc-market" value={market} onChange={e => setMarket(e.target.value)}><option value="">Todos</option>{(Object.keys(MARKET) as FunnelMarket[]).map(m => <option key={m} value={m}>{MARKET[m]}</option>)}</select></label>
    </div>
    <article className="source-card" style={{ marginBottom: 16 }}>
      <div className="card-head"><div><span className="eyebrow" data-testid="cc-range">EMBUDO · {rangeText.toUpperCase()}</span><h3 style={{ fontSize: 18, marginTop: 4 }}>De lo recogido a lo que ven las alumnas</h3></div>
        <button className="primary" onClick={onResolve}>Resolver excepciones ahora <ArrowRight size={14} /></button></div>
      {funnel.busy && !f ? <p className="muted" role="status"><LoaderCircle size={14} className="spin" /> Leyendo el embudo…</p>
        : funnel.error || !t ? <Failed text={funnel.error || 'No se pudo cargar el embudo.'} retry={funnel.load} busy={funnel.busy} />
        : <>
          {f?.truncated && <div className="alert error" role="alert">Hay más filas de las que se pudieron leer: las cifras son parciales y están por debajo de la realidad.</div>}
          <ol className="stat-strip" style={{ margin: '12px 0 0', listStyle: 'none', padding: 0 }} data-testid="cc-funnel">
            <li><strong>{nf.format(t.new)}</strong>recogidas nuevas</li>
            <li><strong>{nf.format(t.withdrawn)}</strong>retiradas por reglas</li>
            <li><strong>{nf.format(t.approved)}</strong>aprobadas</li>
            <li data-testid="cc-human"><strong>{nf.format(t.human)}</strong>a criterio humano</li>
            <li><strong>{nf.format(t.visible)}</strong>visibles ahora</li>
          </ol>
          <Trend block={t} />
          <p className="card-meta">«Recogidas» = vistas por primera vez; las demás son decisiones tomadas en la ventana elegida, así que no suman exactamente las recogidas. Lo descartado antes de guardarse o repetido entre fuentes no deja marca y no se reconstruye.</p>
        </>}
    </article>
    <div className="card-grid" style={{ marginBottom: 16 }}>
      <article className="source-card" data-testid="cc-markets"><span className="eyebrow">VISIBLES AHORA POR MERCADO</span>
        {funnel.busy && !f ? <p className="muted" role="status">Leyendo…</p> : !f ? <p className="card-meta">—: {funnel.error || 'sin datos'}</p>
          : !markets.length ? <p className="card-meta">Ninguna oferta aprobada y vigente por ahora.</p>
          : <table className="data-table" style={{ marginTop: 8 }}><caption className="card-meta" style={{ textAlign: 'left' }}>Ofertas aprobadas y vigentes por mercado</caption><thead><tr><th scope="col">Mercado</th><th scope="col" className="num">Ofertas</th><th scope="col" aria-hidden="true" /></tr></thead>
            <tbody>{markets.map(m => <tr key={m}><th scope="row" style={{ fontWeight: 400 }}>{MARKET[m]}</th><td className="num">{nf.format(byMarket[m])}</td>
              <td style={{ width: '40%' }}><div style={{ height: 8, borderRadius: 99, background: 'var(--inset)', overflow: 'hidden' }}><div style={{ width: `${Math.round((byMarket[m] / maxVisible) * 100)}%`, height: '100%', background: 'var(--accent)' }} /></div></td></tr>)}</tbody></table>}
        <p className="card-meta">No hay una meta por mercado fijada: solo se enseña lo que hay.</p></article>
      <article className="source-card" data-testid="cc-split"><span className="eyebrow">GRATUITAS FRENTE A DE PAGO</span>
        {sample.busy && !sample.data ? <p className="muted" role="status">Leyendo…</p> : !split ? <p className="card-meta">—: {sample.error || 'sin datos'}</p>
          : <><div className="stat-strip" style={{ margin: '8px 0 0' }}><span><strong style={{ fontSize: 28 }}>{split.paid_share === null ? '—' : `${split.paid_share} %`}</strong>de las aprobadas vienen de fuentes de pago</span></div>
            <p className="card-meta">{nf.format(split.free_approved)} aprobadas de fuentes gratuitas · {nf.format(split.paid_approved)} de pago{split.unknown ? ` · ${nf.format(split.unknown)} sin poder repartir` : ''}.{!costReadable ? ' No se pudo leer el coste registrado: no se reparte.' : ''}</p></>}</article>
    </div>
    <article className="source-card" data-testid="cc-spend"><span className="eyebrow">GASTO Y COSTE POR OFERTA APROBADA</span>
      {spend.error ? <Failed text={`Gasto del mes: ${spend.error}`} retry={spend.load} busy={spend.busy} />
        : <p className="card-meta" style={{ marginTop: 8 }}>{spend.busy && !spend.data ? 'Leyendo el gasto del mes…' : `Gasto del mes: ${usd((() => { const d = spend.data; if (!d) return null; const all = [...d.providers.map(p => p.spent_usd), d.apify.spent_usd]; return all.some(v => v === null) ? null : all.reduce<number>((s, v) => s + (v ?? 0), 0); })())} entre todos los proveedores (los topes se cambian en APIs).`}</p>}
      {sample.error ? <Failed text={sample.error} retry={sample.load} busy={sample.busy} />
        : sample.busy && !sample.data ? <p className="muted" role="status">Leyendo lo recogido por fuente…</p>
        : !paidRows.length ? <p className="card-meta">Ninguna fuente de pago tiene coste registrado todavía.</p>
        : <div className="table-wrap"><table className="data-table"><caption className="card-meta" style={{ textAlign: 'left' }}>Fuentes con coste registrado (acumulado). El coste por oferta aprobada es «—» si no hay aprobadas todavía: no se divide por cero.</caption>
          <thead><tr><th scope="col">Fuente</th><th scope="col" className="num">Coste</th><th scope="col" className="num">Recogidas</th><th scope="col" className="num">Aprobadas</th><th scope="col" className="num">Coste por aprobada</th></tr></thead>
          <tbody>{paidRows.map(r => <tr key={r.source}><th scope="row" style={{ fontWeight: 400 }}>{r.source}</th><td className="num">{usd(r.cost_usd)}</td><td className="num">{r.seen === null ? '—' : nf.format(r.seen)}</td><td className="num">{r.approved === null ? '—' : nf.format(r.approved)}</td><td className="num">{usd(costPerApproved(r))}</td></tr>)}</tbody></table></div>}
    </article>
  </section>;
}
