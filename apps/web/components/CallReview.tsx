'use client';

import { useState } from 'react';
import { ArrowLeft, Check, CircleAlert, Gauge, LoaderCircle, ScanLine, Target } from 'lucide-react';
import { BANT_LABELS, DECISION_LABELS, type PracticeBant } from '../lib/practiceRubrics';

// Revisión de una llamada real: entrada separada del roleplay. La rúbrica (`llamada`) se edita en
// el panel y sale de `analisis-llamadas-ventas`; aquí solo se pega la transcripción y se muestra el
// feedback validado en servidor. La transcripción no se guarda ni se registra como actividad.
type Axis = { id: string; label: string; score: number; note: string; quote: string };
type Debrief = {
  summary: string;
  focus?: string;
  strengths: string[];
  improvements: string[];
  axes?: Axis[];
  score?: number;
  bant?: PracticeBant;
  model?: string;
  next: string;
};
const band = (score: number) => score >= 70 ? 'alto' : score >= 40 ? 'medio' : 'bajo';

export default function CallReview({ onBack }: { onBack: () => void }) {
  const [transcript, setTranscript] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [debrief, setDebrief] = useState<Debrief | null>(null);

  async function review() {
    setBusy(true); setError(''); setDebrief(null);
    try {
      const response = await fetch('/api/practice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'review', transcript }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'No se pudo evaluar la llamada.');
      setDebrief(data.debrief as Debrief);
    } catch (exception) {
      setError((exception as Error).message);
    } finally { setBusy(false); }
  }

  if (debrief) {
    return <section className="practice practice-debrief">
      <button className="practice-back" type="button" onClick={() => setDebrief(null)}><ArrowLeft size={16} />Evaluar otra llamada</button>
      <span className="eyebrow">EVALUACIÓN DE LLAMADA · RUBRICA DE ANALISIS-LLAMADAS-VENTAS</span>
      <h1>Qué pasó en la llamada.</h1>
      <p className="practice-summary">{debrief.summary}</p>
      {typeof debrief.score === 'number' && debrief.axes?.length ? <div className="practice-score">
        <div className="practice-score-total" data-band={band(debrief.score)}>
          <Gauge size={16} /><b>{debrief.score}</b><span>/100</span><small>ejecución</small>
        </div>
        <div className="practice-score-detail">
          <div className="practice-score-head"><h2>{`Los ${debrief.axes.length} criterios`}</h2><small>Media ponderada según la rúbrica del panel. No es una nota oficial.</small></div>
          <dl className="practice-axes">{debrief.axes.map(axis => <div className="practice-axis" key={axis.id}>
            <dt><span>{axis.label}</span><b data-band={band(axis.score)}>{axis.score}</b></dt>
            <div className="practice-bar" role="meter" aria-valuenow={axis.score} aria-valuemin={0} aria-valuemax={100} aria-label={`${axis.label}: ${axis.score} de 100`}><i data-band={band(axis.score)} style={{ width: `${axis.score}%` }} /></div>
            {axis.note && <dd>{axis.note}</dd>}
            {axis.quote && <blockquote>«{axis.quote}»</blockquote>}
          </div>)}</dl>
        </div>
      </div> : null}
      {debrief.bant && <div className="practice-bant">
        <span className="eyebrow">AUDITORÍA BANT Y DECISIÓN</span>
        <dl className="practice-bant-grid">{(['budget', 'authority', 'need', 'timing'] as const).map(letter => {
          const item = debrief.bant![letter];
          return <div key={letter}><dt><b>{item.status}</b> {BANT_LABELS[letter]}</dt>{item.quote && <dd>«{item.quote}»</dd>}</div>;
        })}</dl>
        <p className="practice-bant-decision"><strong>Decisión:</strong> {DECISION_LABELS[debrief.bant.decision]}</p>
      </div>}
      {debrief.focus && <div className="practice-focus"><span className="eyebrow">LA CORRECCIÓN PRIORITARIA · UNA SOLA</span><p>{debrief.focus}</p></div>}
      <div className="practice-columns">
        <div><h2><Check size={17} />Qué funcionó</h2><ul>{debrief.strengths.map(item => <li key={item}>{item}</li>)}</ul></div>
        <div><h2><Target size={17} />Qué corregir</h2><ul>{debrief.improvements.map(item => <li key={item}>{item}</li>)}</ul></div>
      </div>
      {debrief.model && <div className="practice-model"><span className="eyebrow">CÓMO PODRÍA SONAR</span><p>{debrief.model}</p></div>}
      <div className="practice-next"><span className="eyebrow">SIGUIENTE PASO</span><p>{debrief.next}</p></div>
      <p className="practice-note">La transcripción se usa solo para este feedback y no se guarda en tu historial. El análisis lo estima un proveedor de IA: no pegues datos personales de terceros.</p>
    </section>;
  }

  return <section className="practice practice-room">
    <button className="practice-back" type="button" onClick={onBack}><ArrowLeft size={16} />Volver a las situaciones</button>
    <div className="practice-head">
      <div>
        <span className="eyebrow">EVALUACIÓN DE LLAMADAS · ANÁLISIS DE GAME TAPE</span>
        <h1>Pega una llamada y mira qué la decidió.</h1>
        <p>Se puntúa la ejecución con la rúbrica de <code>analisis-llamadas-ventas</code>: fases, BANT y una sola corrección prioritaria. No se guarda la transcripción.</p>
      </div>
      <span className="practice-icon"><ScanLine size={26} strokeWidth={1.4} /></span>
    </div>
    <div className="practice-prepared">
      <div className="practice-prepared-head"><ScanLine size={18} /><div><span className="eyebrow">FORMATO</span><h2>Una intervención por línea</h2><p>Etiqueta cada línea con <strong>VENDEDOR:</strong> o <strong>CLIENTE:</strong>. Sin etiquetas no se puede saber a quién puntuar y la evaluación se rechaza.</p></div></div>
      <div className="practice-prepared-form">
        <label htmlFor="call-transcript">Transcripción<textarea id="call-transcript" rows={12} maxLength={16000} value={transcript} onChange={event => setTranscript(event.target.value)} placeholder={'VENDEDOR: Hola, te llamo por el formulario que dejaste.\nCLIENTE: Ah, sí, no me acuerdo bien.\nVENDEDOR: ¿Qué te hizo buscar una solución ahora?'} /></label>
        <div className="practice-prepared-actions">
          <button type="button" className="primary" onClick={() => void review()} disabled={busy || !transcript.trim()}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <ScanLine size={16} />}Evaluar llamada
          </button>
        </div>
        {error && <p className="practice-error" role="alert"><CircleAlert size={15} />{error}</p>}
      </div>
      <p className="practice-note">Sin discovery (solo confirmar una cita o un buzón de voz) no hay nada que puntuar. La nota mide ejecución, no si la venta se cerró.</p>
    </div>
  </section>;
}
