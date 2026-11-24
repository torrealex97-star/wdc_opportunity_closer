'use client';
import { useCallback, useEffect, useState } from 'react';
import { LoaderCircle, RefreshCcw } from 'lucide-react';
import { usd } from '../lib/money';

// Sección «Voz»: topes, cascada de proveedores (el más barato con clave y sano; si falla por pago, clave o errores, sigue el siguiente),
// gasto por proveedor e incidencias. Solo lectura: las claves se guardan en APIs. Un dato sin leer es «—», nunca 0.
type Provider = { id: string; label: string; usdPerMinute: { low: number; high: number }; zeroRetention: string; note: string; source: string; state: string; reason: string; until: string | null; key: string; spent_usd: number | null; minutes: number | null };
type Payload = { switch_on: boolean; worker_configured: boolean; daily_minutes_per_student: number; monthly_cap_usd: number; spent_usd_month: number | null; minutes_today: number | null; usage_note: string; cascade_readable: boolean; chosen: string | null; providers: Provider[]; events: Array<{ provider: string; kind: string; created_at: string }> };
const STATE: Record<string, string> = { activo: 'Activo', sin_clave: 'Sin clave', pausado_pago: 'Pausado · pago', pausado_clave: 'Pausado · clave', pausado_error: 'Pausado · errores', sin_leer: 'Sin leer' };
const KIND: Record<string, string> = { ok: 'Correcto', error: 'Error', payment: 'Pago rechazado', auth: 'Clave rechazada' };
const when = (iso: string | null) => iso ? new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '—';

export default function VoicePanel({ onSessionLost, goApis }: { onSessionLost: () => void; goApis: () => void }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setError('');
    fetch('/api/admin/voice-limits', { cache: 'no-store' }).then(async r => { const d = await r.json().catch(() => ({})); if (r.status === 401) onSessionLost(); if (!r.ok) throw new Error(d.detail ?? 'No se pudo leer la sección de voz.'); setData(d as Payload); })
      .catch((e: Error) => { setData(null); setError(e.message); });
  }, [onSessionLost]);
  useEffect(load, [load]);

  if (error) return <div className="alert error" role="alert" data-testid="voice-limits-error"><span>{error}</span> <button onClick={load}><RefreshCcw size={14} /> Reintentar</button></div>;
  if (!data) return <p className="muted" role="status"><LoaderCircle size={14} className="spin" /> Leyendo la sección de voz…</p>;
  const chosen = data.providers.find(p => p.id === data.chosen);
  return <section aria-label="Voz: topes, proveedores y gasto" data-testid="voice-limits">
    <p className="card-meta" style={{ marginTop: 0, maxWidth: 760 }}>
      {data.switch_on ? 'El interruptor VOICE_ROLEPLAY está encendido.' : 'Apagada: VOICE_ROLEPLAY no está en «on», así que no se ofrece ni se gasta nada.'}{' '}
      {data.worker_configured ? 'El servicio de voz tiene su token.' : 'Falta VOICE_WORKER_TOKEN (24 caracteres o más): sin él el servicio de voz no puede pedir proveedor ni anotar consumo.'} {data.usage_note}
    </p>
    <div className="stat-strip">
      <div><strong>{data.daily_minutes_per_student} min</strong><span>máximo por alumna y día</span></div>
      <div><strong>{usd(data.monthly_cap_usd)}</strong><span>tope global al mes (voz)</span></div>
      <div><strong>{data.spent_usd_month === null ? '—' : usd(data.spent_usd_month)}</strong><span>gastado este mes (estimado)</span></div>
      <div><strong>{data.minutes_today === null ? '—' : data.minutes_today}</strong><span>minutos de voz hoy</span></div>
    </div>
    <h2 className="section-title">Cascada de proveedores</h2>
    <p className="card-meta" style={{ marginTop: 0, maxWidth: 760 }} data-testid="voice-chosen">
      {!data.cascade_readable ? 'No se pudieron leer las claves o las incidencias: no se elige proveedor a ciegas.' : chosen ? `Ahora se usaría: ${chosen.label}, el más barato con clave y sano.` : 'Ningún proveedor disponible: guarda una clave en APIs.'}{' '}
      Para conectar uno, guarda su clave en <button className="link-button" onClick={goApis}>APIs</button> (OpenAI, Deepgram o ElevenLabs): entra solo en la cascada. Si un proveedor falla por pago, clave o errores seguidos, se pausa y se sigue con el siguiente más barato.
    </p>
    <div className="table-wrap"><table className="data-table">
      <caption className="card-meta">Del más barato al más caro. US$ por minuto: estimación de las páginas públicas de cada proveedor (24 nov 2026), no una factura.</caption>
      <thead><tr><th scope="col">#</th><th scope="col">Proveedor</th><th scope="col">Estado</th><th scope="col" className="num">US$/min (estimado)</th><th scope="col" className="num">Gastado este mes</th><th scope="col" className="num">Minutos</th><th scope="col">Retención cero</th></tr></thead>
      <tbody>{data.providers.map((p, i) => <tr key={p.id}>
        <td className="num">{i + 1}</td>
        <th scope="row"><a href={p.source} target="_blank" rel="noreferrer">{p.label}</a><br /><span className="card-meta">{p.note}</span></th>
        <td><span className={p.state === 'activo' ? 'status ok' : p.state === 'sin_clave' ? 'status' : 'status bad'}>{STATE[p.state] ?? p.state}</span><br /><span className="card-meta">{p.reason}{p.until ? ` Hasta ${when(p.until)}.` : ''}</span></td>
        <td className="num">{p.usdPerMinute.low.toLocaleString('es')}–{p.usdPerMinute.high.toLocaleString('es')}</td>
        <td className="num">{p.spent_usd === null ? '—' : usd(p.spent_usd)}</td><td className="num">{p.minutes === null ? '—' : p.minutes}</td>
        <td>{p.zeroRetention}</td></tr>)}</tbody>
    </table></div>
    <h2 className="section-title">Últimas incidencias</h2>
    {data.events.length === 0
      ? <p className="card-meta">Ninguna todavía: el servicio de voz avisa aquí de cada pago rechazado, clave rechazada o error.</p>
      : <div className="table-wrap"><table className="data-table"><thead><tr><th scope="col">Cuándo</th><th scope="col">Proveedor</th><th scope="col">Qué pasó</th></tr></thead>
        <tbody>{data.events.map((e, i) => <tr key={i}><td>{when(e.created_at)}</td><td>{data.providers.find(p => p.id === e.provider)?.label ?? e.provider}</td><td>{KIND[e.kind] ?? e.kind}</td></tr>)}</tbody></table></div>}
  </section>;
}
