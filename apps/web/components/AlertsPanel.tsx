'use client';
import { useCallback, useEffect, useState } from 'react';
import { LoaderCircle, RefreshCcw } from 'lucide-react';

// Bloque «Avisos de ofertas por email» (en Alumnas). Solo lectura: cada requisito se enseña con su causa y un recuento ilegible es «—», nunca 0.
type Overview = { enabled: boolean; secret_set: boolean; key_saved: boolean; opted_in: number | null; week: Record<string, number> | null; last_failure: string | null; cap_per_day: number };
const num = (n: number | null | undefined) => n === null || n === undefined ? '—' : new Intl.NumberFormat('es').format(n);

export default function AlertsPanel({ onSessionLost }: { onSessionLost: () => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    setError('');
    fetch('/api/admin/student-alerts', { cache: 'no-store' }).then(async r => { const d = await r.json().catch(() => ({})); if (r.status === 401) onSessionLost(); if (!r.ok) throw new Error(d.detail ?? 'No se pudo leer el estado de los avisos.'); setData(d as Overview); })
      .catch((e: Error) => { setData(null); setError(e.message); });
  }, [onSessionLost]);
  useEffect(load, [load]);
  if (error) return <div className="alert error" role="alert" data-testid="alerts-error"><span>{error}</span> <button onClick={load}><RefreshCcw size={14} /> Reintentar</button></div>;
  if (!data) return <p className="muted" role="status"><LoaderCircle size={14} className="spin" /> Leyendo los avisos…</p>;
  const blockers = [!data.enabled && 'Apagados: STUDENT_ALERTS_ENABLED no está en «1» (enviar correo automático a alumnas lo autoriza el propietario).', !data.secret_set && 'Falta ALERTS_SECRET (16 caracteres o más): sin él no se firma la baja y no se envía nada.', !data.key_saved && 'Falta la clave de Resend (APIs).'].filter(Boolean) as string[];
  const w = data.week;
  return <section aria-label="Avisos de ofertas por email" data-testid="alerts-panel">
    <h2 className="section-title">Avisos de ofertas por email</h2>
    <p className="card-meta" style={{ marginTop: 0, maxWidth: 760 }} data-testid="alerts-state">{blockers.length ? `No se envía nada. ${blockers.join(' ')}` : `Activos: como máximo ${data.cap_per_day} ofertas al día por alumna, solo a quien dio su consentimiento.`}</p>
    <div className="stat-strip">
      <div><strong>{num(data.opted_in)}</strong><span>alumnas con consentimiento</span></div>
      <div><strong>{num(w?.sent)}</strong><span>avisos enviados · últimos 7 días</span></div>
      <div><strong>{num(w?.failed)}</strong><span>fallidos · últimos 7 días</span></div>
      <div><strong>{num(w ? (w.pending ?? 0) + (w.sending ?? 0) : null)}</strong><span>en cola o dudosos</span></div>
    </div>
    {data.last_failure && <p className="card-meta" role="status">Último fallo: {data.last_failure}</p>}
  </section>;
}
