'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { LoaderCircle, RefreshCcw } from 'lucide-react';
import sourceCatalog from '../lib/sourceCatalog.json';
import { routesForCatalog, type CatalogLite } from '../lib/sourceRoutes';
import { KIND_LABEL, kindOf, type SourceKind } from '../lib/sourceKinds';
import { fmtInt } from '../lib/formatInt';

// Motor de fuentes: UNA tabla de todas las fuentes, separada en De pago / Gratuitas / Empresas. Cada fila: cómo está conectada (con su causa), qué
// ha recogido y aprobado, y cuánto ha costado. Un hueco es «—» con su causa, nunca 0. Las acciones (probar la vía, conectarla) están en «Fuentes».
type Health = { state: 'conectada' | 'sin_via' | 'sin_clave' | 'mal_conectada' | 'sin_programar' | 'sin_juzgar'; cause: string; next: string };
type Row = { source: string; seen: number | null; approved: number | null; cost_usd: number | null; health: Health | null; state: 'sin_dato' | 'sin_conclusion' | 'medida' };
type Payload = { target: number; rows: Row[]; cost_note: string | null; health_note: string | null };
const CATALOG = sourceCatalog as unknown as CatalogLite[];
const BY_SOURCE = routesForCatalog(CATALOG);
const NAME = new Map(CATALOG.map(entry => [entry.code, entry.name]));
const KINDS: SourceKind[] = ['pago', 'gratuitas', 'empresas'];
const HEALTH: Record<Health['state'], { text: string; cls: string }> = {
  conectada: { text: 'Conectada', cls: 'status ok' }, sin_via: { text: 'Sin vía verificada', cls: 'status' }, sin_clave: { text: 'Falta clave o saldo', cls: 'status bad' },
  mal_conectada: { text: 'Mal conectada', cls: 'status bad' }, sin_programar: { text: 'Sin programar', cls: 'status bad' }, sin_juzgar: { text: 'Ofertas sin juzgar', cls: 'status bad' },
};
const num = (v: number | null) => v === null ? '—' : fmtInt(v);
const usd = (v: number | null) => v === null ? '—' : `${new Intl.NumberFormat('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)} US$`;

export default function SourcesEngine({ onSessionLost, go }: { onSessionLost: () => void; go: (tab: 'sources' | 'apify' | 'companies') => void }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [kind, setKind] = useState<SourceKind>('pago');
  const [showEmpty, setShowEmpty] = useState(false);
  const load = useCallback(() => {
    setBusy(true); setError('');
    fetch('/api/admin/source-sample', { cache: 'no-store' }).then(async r => {
      const d = await r.json().catch(() => ({}));
      if (r.status === 401 || r.status === 403) onSessionLost();
      if (!r.ok) throw new Error(typeof d.detail === 'string' ? d.detail : 'No se pudo leer el estado de las fuentes.');
      setData(d as Payload);
    }).catch((e: Error) => { setData(null); setError(e.message); }).finally(() => setBusy(false));
  }, [onSessionLost]);
  useEffect(load, [load]);

  const rows = useMemo(() => (data?.rows ?? []).map(row => ({ ...row, kind: kindOf(CATALOG.find(entry => entry.code === row.source) ?? { code: row.source, category: null }, BY_SOURCE.get(row.source) ?? []), via: (BY_SOURCE.get(row.source) ?? [])[0]?.label ?? 'Sin vía verificada' })), [data]);
  const count = (k: SourceKind) => rows.filter(row => row.kind === k).length;
  const mine = rows.filter(row => row.kind === kind);
  // Las que nunca han recogido ni tienen coste se plegan: no ensucian la vista, pero siguen a un clic con su causa.
  const active = mine.filter(row => (row.seen ?? 0) > 0 || (row.cost_usd ?? 0) > 0).sort((a, b) => (b.cost_usd ?? 0) - (a.cost_usd ?? 0) || (b.seen ?? 0) - (a.seen ?? 0));
  const idle = mine.filter(row => !((row.seen ?? 0) > 0 || (row.cost_usd ?? 0) > 0)).sort((a, b) => a.source.localeCompare(b.source));
  const shown = showEmpty ? [...active, ...idle] : active;
  const ACTION: Record<SourceKind, { label: string; tab: 'sources' | 'apify' | 'companies' }> = { pago: { label: 'Probar y programar en «Búsqueda automática»', tab: 'apify' }, gratuitas: { label: 'Ver sus vías en «Fuentes»', tab: 'sources' }, empresas: { label: 'Gestionar en «Empresas»', tab: 'companies' } };

  return <section aria-label="Motor de fuentes" data-testid="sources-engine">
    <div role="tablist" aria-label="Tipo de fuente" className="practice-rooms" style={{ marginBottom: 16 }}>
      {KINDS.map(k => <button key={k} type="button" role="tab" aria-selected={kind === k} className={`practice-room-tab ${kind === k ? 'is-active' : ''}`} onClick={() => setKind(k)}>{KIND_LABEL[k]}{data && <span className="card-meta" style={{ margin: '0 0 0 6px' }}>{count(k)}</span>}</button>)}
    </div>
    {error && <div className="alert error" role="alert"><span>{error}</span> <button onClick={load} disabled={busy}><RefreshCcw size={14} /> Reintentar</button></div>}
    {data?.cost_note && <p className="inline-hint" role="status">{data.cost_note}</p>}
    {data?.health_note && <p className="inline-hint" role="status">{data.health_note}</p>}
    {busy && !data ? <p className="muted" role="status"><LoaderCircle size={14} className="spin" /> Leyendo el estado de las fuentes…</p> : data && <>
      <div className="admin-toolbar" style={{ justifyContent: 'space-between' }}>
        <p className="card-meta" style={{ margin: 0 }}>{kind === 'pago' ? 'Fuentes que solo se consiguen pagando. El coste es el registrado hasta hoy; con menos de 1.000 recogidas no se concluye si rinden.' : kind === 'gratuitas' ? 'Feeds y APIs sin coste por petición. Sin coste no es «sin importancia»: son las que más aportan al objetivo del día.' : 'Bolsas de empleo de empresas (ATS) y páginas propias.'}</p>
        <button type="button" onClick={() => go(ACTION[kind].tab)}>{ACTION[kind].label}</button>
      </div>
      {!shown.length ? <p className="empty">{mine.length ? `Ninguna fuente de este tipo ha recogido todavía (${mine.length}). Ábrelas abajo para ver por qué.` : 'No hay fuentes de este tipo.'}</p>
        : <div className="table-wrap"><table className="data-table" data-testid="engine-table"><caption className="card-meta" style={{ textAlign: 'left' }}>{KIND_LABEL[kind]}: conexión, recogidas, aprobadas y coste por fuente</caption>
          <thead><tr><th scope="col">Fuente</th><th scope="col">Conexión</th><th scope="col" className="num">Recogidas</th><th scope="col" className="num">Aprobadas</th><th scope="col" className="num">Coste</th></tr></thead>
          <tbody>{shown.map(row => <tr key={row.source} data-source={row.source}>
            <th scope="row" style={{ fontWeight: 400 }}><strong>{NAME.get(row.source) ?? row.source}</strong><span className="card-meta" style={{ display: 'block' }}>{row.via}</span></th>
            <td>{row.health ? <><span className={HEALTH[row.health.state].cls}>{HEALTH[row.health.state].text}</span><span className="card-meta" style={{ display: 'block' }}>{row.health.cause}{row.health.state === 'conectada' ? '' : ` Siguiente paso: ${row.health.next}`}</span></> : '—'}</td>
            <td className="num">{num(row.seen)}</td><td className="num">{num(row.approved)}</td><td className="num">{usd(row.cost_usd)}</td></tr>)}</tbody></table></div>}
      {idle.length > 0 && <label className="check-label" style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}><input type="checkbox" checked={showEmpty} onChange={e => setShowEmpty(e.target.checked)} /> Mostrar las {idle.length} que aún no han recogido nada (con su causa)</label>}
    </>}
  </section>;
}
