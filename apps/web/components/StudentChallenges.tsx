'use client';
import { useCallback, useEffect, useState } from 'react';
import { LoaderCircle, Target } from 'lucide-react';
import { PRACTICE_SCENARIOS, scenarioById } from './practiceScenarios';

// Retos de una alumna desde su ficha. La coordinadora elige escenario, nota mínima opcional, fecha límite
// y deja una nota. El estado NO se edita: lo calcula el servidor con la actividad de ella.
type Challenge = {
  id: string; scenario_id: string; min_score: number | null; due_on: string; coach_note: string;
  status: 'pending' | 'completed' | 'missed' | 'unknown'; attempts: number | null; best_score: number | null;
  qualifying_score: number | null; completed_at: string | null; late: boolean;
};
type Payload = { available?: boolean; activity_available?: boolean | null; challenges?: Challenge[] | null; detail?: string };

const day = (iso: string) => new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', timeZone: 'Europe/Madrid' }).format(new Date(`${iso}T12:00:00Z`));
const moment = (iso: string) => new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }).format(new Date(iso));
const nextWeek = () => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [y, m, d] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 7)).toISOString().slice(0, 10);
};
function statusText(c: Challenge): string {
  if (c.status === 'unknown') return '— Sin datos de actividad: no se puede saber si lo cumplió.';
  if (c.status === 'completed') return `Completado${c.qualifying_score !== null ? ` con ${c.qualifying_score}/100` : ''}${c.completed_at ? ` el ${moment(c.completed_at)}` : ''} · plazo ${day(c.due_on)}.`;
  if (c.status === 'missed') return c.late ? 'Fuera de plazo: alcanzó la nota después de la fecha límite.' : 'Fuera de plazo: no hay una práctica que cumpla.';
  return c.attempts ? `Pendiente · ${c.attempts} ${c.attempts === 1 ? 'intento' : 'intentos'}${c.best_score !== null ? ` · mejor ${c.best_score}` : ''}.` : 'Pendiente · sin intentos todavía.';
}

export default function StudentChallenges({ studentId }: { studentId: string }) {
  const [list, setList] = useState<Challenge[] | null>(null);
  const [available, setAvailable] = useState(true);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [detail, setDetail] = useState('');
  const [busy, setBusy] = useState(false);
  const [scenario, setScenario] = useState('');
  const [minScore, setMinScore] = useState('');
  const [due, setDue] = useState(nextWeek);

  const load = useCallback(async () => {
    const response = await fetch(`/api/admin/students/${studentId}/challenges`, { cache: 'no-store' });
    const data = await response.json().catch(() => ({})) as Payload;
    if (!response.ok) { setError(data.detail ?? 'No se pudieron cargar los retos.'); setList([]); return; }
    setError('');
    setAvailable(data.available !== false);
    setDetail(data.detail ?? '');
    setList(Array.isArray(data.challenges) ? data.challenges : []);
  }, [studentId]);
  useEffect(() => { void load(); }, [load]);

  async function assign(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/admin/students/${studentId}/challenges`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario_id: scenario, min_score: minScore === '' ? null : Number(minScore), due_on: due, coach_note: note }),
      });
      const data = await response.json().catch(() => ({})) as { detail?: string };
      if (!response.ok) throw new Error(data.detail ?? 'No se pudo asignar el reto.');
      setScenario(''); setMinScore(''); setNote(''); setDue(nextWeek());
      await load();
    } catch (exception) { setError((exception as Error).message); } finally { setBusy(false); }
  }

  return <section className="student-challenges" aria-label="Retos asignados" style={{ marginTop: 36 }}>
    <div className="detail-top"><span className="eyebrow">RETOS ASIGNADOS</span></div>
    <p className="card-meta">Un reto se cumple con una práctica de ese escenario, después de asignarlo, dentro del plazo y con la nota mínima si la hay. El estado se calcula con su actividad; aquí no se marca a mano.</p>
    {!available && <div className="alert" role="status"><span>{detail || 'La tabla de retos no está disponible: la migración sigue sin aplicar. No se muestra ningún reto como si no existiera.'}</span></div>}
    {error && <div className="alert error" role="alert"><span>{error}</span></div>}
    {list === null ? <p className="muted"><LoaderCircle size={14} className="spin" /> Cargando retos…</p> : available && !list.length ? <p className="card-meta">— Todavía no tiene retos asignados.</p> : available && <ul className="challenge-list">
      {list.map(c => { const item = scenarioById(c.scenario_id); return <li key={c.id} className="challenge-item">
        <div>
          <h3><Target size={14} /> {item?.title ?? `Escenario desconocido (${c.scenario_id})`}</h3>
          <p>Hasta el {day(c.due_on)}{c.min_score !== null ? ` · nota mínima ${c.min_score}/100` : ' · cualquier nota'}</p>
          <p className="card-meta">«{c.coach_note}»</p>
          <p className="card-meta"><strong>{statusText(c)}</strong></p>
        </div>
      </li>; })}
    </ul>}
    {available && <form className="practice-prepared-form" onSubmit={assign} aria-label="Asignar un reto">
      <label>Escenario<select value={scenario} required onChange={event => setScenario(event.target.value)}>
        <option value="">Elige una situación</option>
        {PRACTICE_SCENARIOS.map(item => <option key={item.id} value={item.id}>{item.track === 'llamada' ? 'Llamada' : 'Entrevista'} · {item.title}</option>)}
      </select></label>
      <label>Nota mínima (opcional)<input type="number" min={1} max={100} step={1} value={minScore} onChange={event => setMinScore(event.target.value)} placeholder="Sin mínimo" /></label>
      <label>Fecha límite<input type="date" value={due} required onChange={event => setDue(event.target.value)} /></label>
      <label className="grow">Nota para ella<textarea value={note} required maxLength={500} rows={2} onChange={event => setNote(event.target.value)} placeholder="Qué quieres que trabaje en esta práctica…" /></label>
      <div className="practice-prepared-actions"><button className="primary" disabled={busy || !scenario || !note.trim()}>{busy ? <LoaderCircle size={15} className="spin" /> : <Target size={15} />}Asignar reto</button></div>
    </form>}
  </section>;
}
