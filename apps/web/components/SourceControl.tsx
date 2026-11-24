'use client';
import { useCallback, useEffect, useState } from 'react';
import { LoaderCircle, RefreshCcw } from 'lucide-react';
import { fmtInt } from '../lib/formatInt';

// Control total de fuentes en el Resumen (criterio del propietario, 2026-11-24): cuántas fuentes dan ofertas CUALIFICADAS y cuáles hay que trabajar,
// con la causa, el siguiente paso y de quién es. Una fuente solo está «hecha» si cualifica en la ventana; un dato sin leer es «—», nunca 0.
type State = 'cualificadas' | 'recoge_sin_cualificar' | 'sin_recoger' | 'rota' | 'necesita_dato' | 'sin_via';
type Item = { source: string; name: string; kind: string; state: State; owner: 'claude' | 'propietario' | null; collected: number | null; qualified: number | null; cause: string; next: string; done: boolean };
type Payload = { total: number; qualified: number; counts: Record<State, number>; todo: Item[]; headline: string; window_days: number; recent_note: string | null };
const LABEL: Record<State, string> = {
  cualificadas: 'Dan ofertas cualificadas', recoge_sin_cualificar: 'Recogen y no cualifican', sin_recoger: 'Conectadas sin recoger', rota: 'Rotas', necesita_dato: 'Necesitan un dato tuyo', sin_via: 'Sin vía verificada',
};
const ORDER: State[] = ['cualificadas', 'recoge_sin_cualificar', 'sin_recoger', 'rota', 'necesita_dato', 'sin_via'];
const OWNER = { claude: 'Lo trabajo yo', propietario: 'Te toca a ti' } as const;
const num = (v: number | null) => v === null ? '—' : fmtInt(v);
const SHOWN = 12;

export default function SourceControl({ onSessionLost, goEngine }: { onSessionLost: () => void; goEngine: () => void }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState('');
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(true);
  const load = useCallback(() => {
    setBusy(true); setError('');
    fetch('/api/admin/source-control', { cache: 'no-store' }).then(async r => {
      const d = await r.json().catch(() => ({}));
      if (r.status === 401 || r.status === 403) onSessionLost();
      if (!r.ok) throw new Error(typeof d.detail === 'string' ? d.detail : 'No se pudo leer el control de fuentes.');
      setData(d as Payload);
    }).catch((e: Error) => { setData(null); setError(e.message); }).finally(() => setBusy(false));
  }, [onSessionLost]);
  useEffect(load, [load]);

  const todo = data?.todo ?? [];
  const shown = all ? todo : todo.slice(0, SHOWN);
  return <article className="source-card" style={{ marginBottom: 20 }} data-testid="source-control">
    <div className="card-head"><div><span className="eyebrow">CONTROL DE FUENTES</span><h3 style={{ fontSize: 18, marginTop: 4 }} data-testid="source-control-headline">{data ? data.headline : busy ? 'Midiendo todas las fuentes…' : 'Sin datos'}</h3></div>
      <button type="button" onClick={load} disabled={busy} aria-label="Actualizar el control de fuentes">{busy ? <LoaderCircle size={15} className="spin" /> : <RefreshCcw size={15} />} Actualizar</button></div>
    {error && <div className="alert error" role="alert"><span>{error}</span></div>}
    {data && <>
      <p className="card-meta" style={{ marginTop: 4 }}>Una fuente solo está hecha si en los últimos {data.window_days} días dio al menos una oferta cualificada (o está bloqueada con una causa y un dueño). Lo demás sigue abierto hasta que funcione.</p>
      {data.recent_note && <p className="inline-hint" role="status">{data.recent_note}</p>}
      <div className="stat-strip" style={{ margin: '12px 0' }}>{ORDER.map(state => <span key={state} data-state={state}><strong style={{ fontSize: 24 }}>{data.counts[state]}</strong>{LABEL[state]}</span>)}</div>
      {todo.length === 0 ? <p className="empty">Todas las fuentes dan ofertas cualificadas.</p> : <>
        <h4 style={{ margin: '8px 0' }}>A trabajar ({todo.length})</h4>
        <div className="table-wrap"><table className="data-table" data-testid="source-control-todo">
          <caption className="card-meta" style={{ textAlign: 'left' }}>Fuentes sin ofertas cualificadas, de la más urgente a la menos, con su causa y su siguiente paso</caption>
          <thead><tr><th scope="col">Fuente</th><th scope="col">Estado</th><th scope="col" className="num">Recogidas</th><th scope="col" className="num">Cualificadas</th><th scope="col">Causa y siguiente paso</th><th scope="col">Quién</th></tr></thead>
          <tbody>{shown.map(item => <tr key={item.source} data-source={item.source}>
            <th scope="row" style={{ fontWeight: 400 }}><strong>{item.name}</strong></th>
            <td><span className={item.state === 'rota' ? 'status bad' : 'status'}>{LABEL[item.state]}</span></td>
            <td className="num">{num(item.collected)}</td><td className="num">{num(item.qualified)}</td>
            <td>{item.cause}<span className="card-meta" style={{ display: 'block' }}>Siguiente paso: {item.next}</span></td>
            <td>{item.owner ? OWNER[item.owner] : '—'}</td></tr>)}</tbody></table></div>
        {todo.length > SHOWN && <button type="button" style={{ marginTop: 8 }} onClick={() => setAll(v => !v)}>{all ? `Ver solo las ${SHOWN} primeras` : `Ver las ${todo.length}`}</button>}
      </>}
      <button type="button" style={{ marginTop: 12 }} onClick={goEngine}>Ver todas en el panel de fuentes</button>
    </>}
  </article>;
}
