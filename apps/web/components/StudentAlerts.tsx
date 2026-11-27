'use client';
import { useEffect, useState } from 'react';
import { BellRing, LoaderCircle, Save } from 'lucide-react';

// Avisos rápidos por email: casilla propia, separada del permiso del perfil y revocable. Lo que se acepta es el texto que se muestra aquí
// (lib/legal.ts → ALERTS_CONSENT_TEXT, borrador pendiente de revisión legal). El estado que se enseña es el guardado, no el que se espera.
type State = { consent_text: string[]; cap_per_day: number; opted_in: boolean | null; error?: string };
export default function StudentAlerts({ onLost }: { onLost: () => void }) {
  const [data, setData] = useState<State | null>(null);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  useEffect(() => {
    fetch('/api/student/alerts', { cache: 'no-store' }).then(async r => {
      if (r.status === 401 || r.status === 403) { onLost(); return; }
      const d = await r.json().catch(() => null) as State | null;
      if (!r.ok || !d) throw new Error('No pudimos leer tus avisos.');
      setData(d); setOn(d.opted_in === true);
    }).catch(() => setError('No pudimos leer tus avisos. Inténtalo de nuevo en unos minutos.'));
  }, [onLost]);
  async function save() {
    setBusy(true); setError(''); setNotice('');
    try {
      const r = await fetch('/api/student/alerts', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ opt_in: on }) });
      const d = await r.json().catch(() => ({})) as State & { detail?: string };
      if (r.status === 401 || r.status === 403) { onLost(); return; }
      if (!r.ok) throw new Error(d.detail ?? 'No pudimos guardar tu preferencia.');
      setData(d); setOn(d.opted_in === true); setNotice(d.opted_in ? 'Avisos activados.' : 'Avisos desactivados.');
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  return <section className="auth-card" data-testid="student-alerts" aria-labelledby="alerts-title" style={{ boxShadow: 'none', padding: 0 }}>
    <h2 id="alerts-title"><BellRing size={18} aria-hidden="true" /> Avisos de ofertas por email</h2>
    {!data && !error && <p className="muted"><LoaderCircle className="spin" size={16} /> Cargando…</p>}
    {data && data.opted_in === null && <div className="alert error" role="alert"><span>{data.error ?? 'No pudimos leer tu preferencia de avisos.'}</span></div>}
    {data && data.opted_in !== null && <>
      <ul>{data.consent_text.map(line => <li key={line}>{line}</li>)}</ul>
      <p className="card-meta">Estado guardado: <strong>{data.opted_in ? 'activados' : 'desactivados'}</strong>. <em>(Texto provisional, pendiente de revisión legal.)</em></p>
      <label className="check-label" style={{ flexDirection: 'row', alignItems: 'flex-start' }}><input type="checkbox" checked={on} onChange={e => setOn(e.target.checked)} /> <span>Quiero recibir estos avisos en mi email de acceso.</span></label>
      <button type="button" className="primary" onClick={() => void save()} disabled={busy || on === (data.opted_in === true)}>{busy ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />} Guardar avisos</button>
    </>}
    {error && <div className="alert error" role="alert"><span>{error}</span></div>}
    {notice && <div className="auth-note" role="status">{notice}</div>}
  </section>;
}
