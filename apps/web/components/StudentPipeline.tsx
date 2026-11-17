'use client';
import { useCallback, useEffect, useState } from 'react';
import { Copy, ExternalLink, LoaderCircle, MessageSquare, Save } from 'lucide-react';
import { LABELS, MOVE_LABELS, NEXT, STAGES, stageOf, type AppStatus } from '../lib/applicationStages';
import ApplyAssistant from './ApplyAssistant';

// Tablero (pipeline) de candidaturas: todas sus ofertas en columnas por etapa real del proceso.
// La alumna mueve la tarjeta cuando la empresa contesta (nada se detecta solo) y la app nunca envía
// ni rellena nada. Los estados son los del servidor: aquí solo se ofrecen movimientos permitidos.
type Application = { id: string; offer_title: string; offer_company: string | null; offer_url: string; status: AppStatus; notes: string | null; updated_at: string };
type CopyField = { key: string; label: string; value: string };
type Payload = { applications: Application[]; copy: CopyField[] };

const when = (value: string) => {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return 'Fecha no indicada';
  const days = Math.floor((Date.now() - time) / 86400000);
  if (days <= 0) return 'Hoy';
  if (days === 1) return 'Ayer';
  if (days < 30) return `Hace ${days} días`;
  return `El ${new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(new Date(time))}`;
};

export default function StudentPipeline({ refreshKey, onLost }: { refreshKey: number; onLost: () => void }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [busyId, setBusyId] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    fetch('/api/student/applications', { headers: { 'Content-Type': 'application/json' }, cache: 'no-store' })
      .then(response => response.json().then(body => ({ ok: response.ok, status: response.status, body })))
      .then(({ ok, status, body }) => {
        if (!ok) {
          if (status === 401 || status === 403) onLost();
          throw new Error(typeof (body as { detail?: string }).detail === 'string' ? (body as { detail: string }).detail : 'No se pudieron cargar tus candidaturas.');
        }
        const payload = body as Payload;
        setData(payload);
        setNotes(Object.fromEntries(payload.applications.map(app => [app.id, app.notes ?? ''])));
        setError('');
      })
      .catch((e: Error) => setError(e.message));
  }, [onLost]);
  useEffect(load, [load, refreshKey]);

  async function patch(id: string, body: Record<string, unknown>, ok: string) {
    setBusyId(id); setNote(''); setError('');
    try {
      const response = await fetch('/api/student/applications', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...body }) });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({})) as { detail?: string };
        if (response.status === 401 || response.status === 403) onLost();
        throw new Error(typeof detail.detail === 'string' ? detail.detail : 'No se pudo guardar.');
      }
      setNote(ok);
    } catch (e) { setError((e as Error).message); } finally { setBusyId(''); load(); }
  }

  async function copyIt(text: string, what: string) {
    try { await navigator.clipboard.writeText(text); setNote(`${what} copiado.`); }
    catch { setNote('No se pudo copiar: selecciona el texto y cópialo a mano.'); }
  }

  if (error && !data) return <div className="alert error" role="alert"><span>{error}</span> <button onClick={load}>Reintentar</button></div>;
  if (!data) return <p className="muted"><LoaderCircle size={14} className="spin" /> Cargando tu tablero…</p>;

  return <section aria-label="Mi tablero de candidaturas" data-testid="applications">
    <span className="eyebrow">TU TABLERO</span>
    <p className="card-meta">Cada oferta avanza de columna cuando TÚ lo sabes: la enviaste, contestaron, te citaron. La app no lee correos ni envía nada por ti.</p>
    {error && <div className="alert error" role="alert"><span>{error}</span></div>}
    {note && <div className="auth-note" role="status">{note}</div>}
    {!data.applications.length ? <p className="card-meta">Todavía no hay tarjetas. Prepara una candidatura desde «Ofertas para ti» y aparecerá aquí en «Me interesa».</p>
      : <div className="pipeline" data-testid="pipeline">
        {STAGES.map(stage => {
          const cards = data.applications.filter(app => stageOf(app.status).id === stage.id);
          return <div className="pipeline-column" key={stage.id} data-testid={`stage-${stage.id}`}>
            <header><h3>{stage.title} <span>{cards.length}</span></h3><p>{stage.hint}</p></header>
            {cards.length === 0 ? <p className="pipeline-empty">—</p> : cards.map(app => {
              const moves = NEXT[app.status].filter(to => to !== 'draft' && to !== 'opened');
              return <article className="pipeline-card" key={app.id} data-testid="application">
                <p className="pipeline-company">{app.offer_company ?? 'Empresa no indicada'}</p>
                <strong>{app.offer_title}</strong>
                <div className="pipeline-meta"><span className="status">{LABELS[app.status]}</span><span className="pipeline-when">{when(app.updated_at)}</span></div>
                <div className="pipeline-actions">
                  <a href={app.offer_url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> Anuncio</a>
                  <a href="/?tab=practica"><MessageSquare size={14} /> Practicar</a>
                </div>
                {!!moves.length && <div className="pipeline-moves">
                  {moves.map(to => <button key={to} data-testid={`outcome-${to}`} disabled={busyId === app.id} onClick={() => void patch(app.id, { status: to }, `${MOVE_LABELS[to]}.`)}>{MOVE_LABELS[to]}</button>)}
                </div>}
                <details>
                  <summary>Notas y preguntas de la empresa</summary>
                  <label htmlFor={`notes-${app.id}`}>Qué te han dicho / cuándo llamar
                    <textarea id={`notes-${app.id}`} rows={3} maxLength={1000} value={notes[app.id] ?? ''} onChange={event => setNotes({ ...notes, [app.id]: event.target.value })} />
                  </label>
                  <button type="button" disabled={busyId === app.id} onClick={() => void patch(app.id, { notes: notes[app.id] ?? '' }, 'Nota guardada.')}><Save size={14} /> Guardar nota</button>
                  <ApplyAssistant applicationId={app.id} offerTitle={app.offer_title} onLost={onLost} />
                </details>
              </article>;
            })}
          </div>;
        })}
      </div>}
    {!!data.copy.length && <details className="search-panel" style={{ marginTop: 20 }}><summary><strong>Datos para copiar en los formularios</strong></summary>
      <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 6 }}>{data.copy.map(field => <li key={field.key} style={{ display: 'flex', gap: 8, alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}><span className="card-meta" style={{ margin: 0 }}>{field.label}: </span>{field.value.length > 120 ? `${field.value.slice(0, 120)}…` : field.value}</span>
        <button onClick={() => void copyIt(field.value, field.label)} aria-label={`Copiar ${field.label}`}><Copy size={14} /></button></li>)}</ul></details>}
  </section>;
}
