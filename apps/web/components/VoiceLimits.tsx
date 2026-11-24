'use client';
import { useCallback, useEffect, useState } from 'react';
import { LoaderCircle, RefreshCcw } from 'lucide-react';
import { usd } from '../lib/money';

// Voz continua: topes acordados y proveedores candidatos con su coste ESTIMADO por minuto. Solo lectura. Un consumo sin medir es «—», no 0.
type Provider = { id: string; label: string; usdPerMinute: { low: number; high: number }; zeroRetention: string; note: string; source: string };
type Payload = { switch_on: boolean; daily_minutes_per_student: number; monthly_cap_usd: number; spent_usd_month: number | null; minutes_today: number | null; usage_note: string; providers: Provider[] };

export default function VoiceLimits({ onSessionLost }: { onSessionLost: () => void }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setError('');
    fetch('/api/admin/voice-limits', { cache: 'no-store' }).then(async r => { const d = await r.json().catch(() => ({})); if (r.status === 401) onSessionLost(); if (!r.ok) throw new Error(d.detail ?? 'No se pudieron leer los topes de voz.'); setData(d as Payload); })
      .catch((e: Error) => { setData(null); setError(e.message); });
  }, [onSessionLost]);
  useEffect(load, [load]);

  if (error) return <div className="alert error" role="alert" data-testid="voice-limits-error"><span>{error}</span> <button onClick={load}><RefreshCcw size={14} /> Reintentar</button></div>;
  if (!data) return <p className="muted" role="status"><LoaderCircle size={14} className="spin" /> Leyendo topes de voz…</p>;
  return <section aria-label="Voz: topes y proveedores" data-testid="voice-limits">
    <h2 className="section-title">Voz continua: topes y coste estimado</h2>
    <p className="card-meta" style={{ marginTop: 0, maxWidth: 760 }}>{data.switch_on ? 'El interruptor VOICE_ROLEPLAY está encendido.' : 'Apagada: VOICE_ROLEPLAY no está en «on», así que no se ofrece ni se gasta nada.'} {data.usage_note}</p>
    <div className="stat-strip">
      <div><strong>{data.daily_minutes_per_student} min</strong><span>máximo por alumna y día</span></div>
      <div><strong>{usd(data.monthly_cap_usd)}</strong><span>tope global al mes (voz)</span></div>
      <div><strong>{data.spent_usd_month === null ? '—' : usd(data.spent_usd_month)}</strong><span>gastado este mes (sin medir)</span></div>
      <div><strong>{data.minutes_today === null ? '—' : data.minutes_today}</strong><span>minutos hoy (sin medir)</span></div>
    </div>
    <div className="table-wrap"><table className="data-table">
      <caption className="card-meta">Estimación en US$ por minuto de conversación, de las páginas públicas de cada proveedor (24 nov 2026). No es una factura.</caption>
      <thead><tr><th scope="col">Proveedor</th><th scope="col" className="num">US$/min (estimado)</th><th scope="col">Retención cero</th><th scope="col">Nota</th></tr></thead>
      <tbody>{data.providers.map(p => <tr key={p.id}>
        <th scope="row"><a href={p.source} target="_blank" rel="noreferrer">{p.label}</a></th>
        <td className="num">{p.usdPerMinute.low.toLocaleString('es')}–{p.usdPerMinute.high.toLocaleString('es')}</td>
        <td>{p.zeroRetention}</td><td>{p.note}</td></tr>)}</tbody>
    </table></div>
  </section>;
}
