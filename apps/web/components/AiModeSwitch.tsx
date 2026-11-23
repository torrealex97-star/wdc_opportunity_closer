'use client';
import { useCallback, useEffect, useState } from 'react';
import { LoaderCircle, RefreshCcw } from 'lucide-react';

// Interruptor del revisor IA: «shadow» (solo anota) ↔ «live» (aprueba y retira sola, dentro del cupo diario).
// Se ve siempre; cambiarlo es del propietario. El estado se escribe en texto (no solo color) y un fallo de lectura no es «apagado».
type State = { mode: 'shadow' | 'live'; source: 'tabla' | 'entorno' | 'defecto'; updated_by: string | null; updated_at: string | null; error: string | null; owner: boolean };
const fmt = (iso: string | null) => (iso ? new Intl.DateTimeFormat('es', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso)) : null);

export default function AiModeSwitch({ onSessionLost }: { onSessionLost: () => void }) {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(true);
  const load = useCallback(() => {
    setBusy(true); setError('');
    fetch('/api/admin/ai-mode', { cache: 'no-store' }).then(async r => { const d = await r.json().catch(() => ({})); if (r.status === 401) onSessionLost(); if (!r.ok) throw new Error(d.detail ?? 'No se pudo leer el modo de la IA.'); setState(d as State); })
      .catch((e: Error) => { setState(null); setError(e.message); }).finally(() => setBusy(false));
  }, [onSessionLost]);
  useEffect(load, [load]);

  async function change(mode: 'shadow' | 'live') {
    if (mode === 'live' && !window.confirm('La IA pasará a «live»: aprobará y retirará ofertas por sí sola, dentro del cupo diario. Puedes volver a «shadow» cuando quieras. ¿Activar?')) return;
    setBusy(true); setError(''); setNotice('');
    const r = await fetch('/api/admin/ai-mode', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : {};
    if (r?.status === 401) onSessionLost();
    if (!r?.ok) { setError(d.detail ?? 'No se pudo cambiar el modo de la IA.'); setBusy(false); return; }
    setState(d as State); setNotice(d.message ?? ''); setBusy(false);
  }

  if (!state) return error
    ? <div className="alert error" role="alert" data-testid="ai-mode-error"><span>{error}</span> <button onClick={load} disabled={busy}><RefreshCcw size={14} /> Reintentar</button></div>
    : <p className="muted" role="status"><LoaderCircle size={14} className="spin" /> Leyendo el modo de la IA…</p>;
  const live = state.mode === 'live';
  const origin = state.source === 'tabla' ? `Elegido en el panel${state.updated_by ? ` por ${state.updated_by}` : ''}${fmt(state.updated_at) ? ` · ${fmt(state.updated_at)}` : ''}` : state.source === 'entorno' ? 'Valor del entorno (AI_REVIEW_MODE); aún no se ha elegido en el panel' : 'Sin configurar: por defecto «shadow»';
  return <div className="search-panel" style={{ marginBottom: 16 }} data-testid="ai-mode">
    <p style={{ margin: 0 }}><strong>Revisor IA: {live ? 'LIVE — aprueba y retira sola' : 'SHADOW — solo anota'}</strong></p>
    <p className="card-meta" data-testid="ai-mode-origin">{origin}. {live ? 'Respeta el cupo diario y la puerta de calidad; una aprobación suya se puede deshacer.' : 'Las reglas deciden; la IA propone y deja nota.'}</p>
    {state.error && <p className="inline-hint" role="alert">{state.error}</p>}
    {error && <p className="inline-hint" role="alert" data-testid="ai-mode-error">{error}</p>}
    {notice && <p className="card-meta" role="status" data-testid="ai-mode-notice">{notice}</p>}
    {state.owner
      ? <button type="button" data-testid="ai-mode-toggle" disabled={busy} onClick={() => void change(live ? 'shadow' : 'live')}>{busy ? <LoaderCircle size={14} className="spin" /> : null} {live ? 'Volver a shadow (solo anota)' : 'Activar live (la IA aprueba y retira)'}</button>
      : <p className="card-meta">Solo el propietario puede cambiarlo.</p>}
  </div>;
}
