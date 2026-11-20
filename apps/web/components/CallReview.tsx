'use client';

import { useRef, useState } from 'react';
import { ArrowLeft, Check, CircleAlert, CloudUpload, Gauge, Link2, LoaderCircle, ScanLine, Target, Type } from 'lucide-react';
import { BANT_LABELS, DECISION_LABELS, type PracticeBant } from '../lib/practiceRubrics';
import { CALL_TYPE_HINTS, CALL_TYPE_LABELS, type CallType } from '../lib/callType';

// Revisión de una llamada real: entrada separada del roleplay. La rúbrica sale de
// `analisis-llamadas-ventas`, en la sala del tipo de llamada (cierre o frío). Se puede pegar la
// transcripción, subir un audio (se transcribe en el servidor) o dar un enlace (Fathom, Drive,
// YouTube); después se puntúa paso a paso. La transcripción no se guarda.
type Axis = { id: string; label: string; score: number; note: string; quote: string; right?: string; improve?: string };
type Debrief = {
  summary: string;
  focus?: string;
  strengths: string[];
  improvements: string[];
  axes?: Axis[];
  score?: number;
  scores?: unknown;
  bant?: PracticeBant;
  signals?: { id: string; label: string; detail: string; quote: string }[];
  model?: string;
  next: string;
  scenario?: string;
};
type CallTypeInfo = { type: CallType; source: 'explicita' | 'detectada'; confidence: 'alta' | 'media' | 'baja'; reason: string };
type Source = 'texto' | 'audio' | 'enlace';
const band = (score: number) => score >= 70 ? 'alto' : score >= 40 ? 'medio' : 'bajo';
const SOURCES: Array<{ id: Source; label: string; icon: typeof Type }> = [
  { id: 'texto', label: 'Pegar transcripción', icon: Type },
  { id: 'audio', label: 'Subir audio', icon: CloudUpload },
  { id: 'enlace', label: 'Enlace', icon: Link2 },
];

export default function CallReview({ onBack }: { onBack: () => void }) {
  const [source, setSource] = useState<Source>('texto');
  const [transcript, setTranscript] = useState('');
  const [url, setUrl] = useState('');
  const [callType, setCallType] = useState<'auto' | CallType>('auto');
  const [preparing, setPreparing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [debrief, setDebrief] = useState<Debrief | null>(null);
  const [detected, setDetected] = useState<CallTypeInfo | null>(null);
  const file = useRef<HTMLInputElement>(null);

  async function prepare(kind: Source) {
    setPreparing(true); setError(''); setNotice('');
    try {
      let response: Response;
      if (kind === 'audio') {
        const chosen = file.current?.files?.[0];
        if (!chosen) throw new Error('Elige un archivo de audio.');
        const form = new FormData();
        form.set('audio', chosen);
        response = await fetch('/api/practice/review-source', { method: 'POST', body: form });
      } else {
        if (!url.trim()) throw new Error('Pega el enlace de la llamada.');
        response = await fetch('/api/practice/review-source', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url.trim() }),
        });
      }
      const data = await response.json().catch(() => ({})) as { transcript?: string; detail?: string };
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'No se pudo preparar la llamada.');
      if (!data.transcript) throw new Error('La llamada llegó sin transcripción.');
      setTranscript(data.transcript);
      setNotice(kind === 'audio' ? 'Audio transcrito y separado por hablantes. Revísalo antes de evaluar.' : 'Transcripción extraída del enlace y separada por hablantes. Revísala antes de evaluar.');
    } catch (exception) {
      setError((exception as Error).message);
    } finally { setPreparing(false); }
  }

  async function review() {
    setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/practice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'review', transcript, call_type: callType }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'No se pudo evaluar la llamada.');
      setDebrief(data.debrief as Debrief);
      setDetected((data as { call_type?: CallTypeInfo }).call_type ?? null);
    } catch (exception) {
      setError((exception as Error).message);
    } finally { setBusy(false); }
  }

  if (debrief) {
    return <section className="practice practice-debrief">
      <button className="practice-back" type="button" onClick={() => { setDebrief(null); setDetected(null); }}><ArrowLeft size={16} />Evaluar otra llamada</button>
      <span className="eyebrow">EVALUACIÓN DE LLAMADA · RÚBRICA DE ANALISIS-LLAMADAS-VENTAS</span>
      <h1>Qué pasó en la llamada.</h1>
      {detected && <p className="practice-call-type" data-confidence={detected.confidence}>
        <strong>{CALL_TYPE_LABELS[detected.type]}</strong>
        <span>{detected.source === 'explicita' ? 'Elegida por ti' : 'Detectada en la transcripción'} · {detected.reason}</span>
      </p>}
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
            {(axis.right || axis.improve) && <dd className="practice-axis-steps">
              {axis.right && <span className="is-right"><Check size={12} />{axis.right}</span>}
              {axis.improve && <span className="is-improve"><Target size={12} />{axis.improve}</span>}
            </dd>}
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
      {debrief.signals?.length ? <div className="practice-signals">
        <h2><Gauge size={17} />Señales calculadas</h2>
        <p className="practice-signals-note">Medidas sobre el texto, sin IA: son observaciones, no parte de la nota.</p>
        <ul>{debrief.signals.map(signal => <li key={signal.id}>
          <strong>{signal.label}</strong>
          <p>{signal.detail}</p>
          {signal.quote && <blockquote>«{signal.quote}»</blockquote>}
        </li>)}</ul>
      </div> : null}
      {debrief.model && <div className="practice-model"><span className="eyebrow">CÓMO PODRÍA SONAR</span><p>{debrief.model}</p></div>}
      <div className="practice-next"><span className="eyebrow">SIGUIENTE PASO</span><p>{debrief.next}</p></div>
      <p className="practice-note">La transcripción se usa solo para este feedback y no se guarda en tu historial. El análisis lo estima un proveedor de IA: no pegues datos personales de terceros.</p>
    </section>;
  }

  return <section className="practice practice-room">
    <button className="practice-back" type="button" onClick={onBack}><ArrowLeft size={16} />Volver a la práctica</button>
    <div className="practice-head">
      <div>
        <span className="eyebrow">EVALUACIÓN DE LLAMADAS · ANÁLISIS DE GAME TAPE</span>
        <h1>Pega una llamada y mira qué la decidió.</h1>
        <p>Se puntúa la ejecución paso a paso con la rúbrica de <code>analisis-llamadas-ventas</code>. Elige si es una llamada de cierre o en frío: no se miden igual.</p>
      </div>
      <span className="practice-icon"><ScanLine size={26} strokeWidth={1.4} /></span>
    </div>

    <div className="practice-prepared">
      <div className="practice-prepared-head"><ScanLine size={18} /><div><span className="eyebrow">DE DÓNDE SALE LA LLAMADA</span><h2>Transcripción, audio o enlace</h2><p>Se etiqueta cada intervención como <strong>VENDEDOR:</strong> o <strong>CLIENTE:</strong>. Sin etiquetas no se puede saber a quién puntuar y la evaluación se rechaza.</p></div></div>
      <div className="practice-rooms review-sources" role="tablist" aria-label="Fuente de la llamada">
        {SOURCES.map(item => { const Icon = item.icon; return <button key={item.id} type="button" role="tab" aria-selected={source === item.id}
          className={`practice-room-tab ${source === item.id ? 'is-active' : ''}`} onClick={() => { setSource(item.id); setError(''); setNotice(''); }}>
          <Icon size={16} />{item.label}
        </button>; })}
      </div>

      {source === 'audio' && <div className="review-source-panel">
        <label htmlFor="call-audio">Audio de la llamada<input id="call-audio" ref={file} type="file" accept="audio/*,video/mp4,video/mpeg" /></label>
        <button type="button" onClick={() => void prepare('audio')} disabled={preparing}>
          {preparing ? <LoaderCircle className="spin" size={16} /> : <CloudUpload size={16} />}Transcribir audio
        </button>
        <p className="card-meta">Hasta 20 MB. La transcripción la hace el proveedor de voz configurado; si no está configurado, la app lo dice y puedes pegar el texto.</p>
      </div>}

      {source === 'enlace' && <div className="review-source-panel">
        <label htmlFor="call-url">Enlace de Fathom, Google Drive o YouTube<input id="call-url" type="url" value={url} onChange={event => setUrl(event.target.value)} placeholder="https://fathom.video/share/… · https://drive.google.com/file/d/… · https://youtu.be/…" /></label>
        <button type="button" onClick={() => void prepare('enlace')} disabled={preparing}>
          {preparing ? <LoaderCircle className="spin" size={16} /> : <Link2 size={16} />}Traer transcripción
        </button>
        <p className="card-meta">El enlace debe ser público. Si la página no expone la transcripción (Drive privado, vídeo sin subtítulos), se dice y puedes pegar el texto.</p>
      </div>}

      <div className="practice-prepared-form">
        <label htmlFor="call-transcript">Transcripción<textarea id="call-transcript" rows={12} maxLength={16000} value={transcript} onChange={event => setTranscript(event.target.value)} placeholder={'VENDEDOR: Hola, te llamo por el formulario que dejaste.\nCLIENTE: Ah, sí, no me acuerdo bien.\nVENDEDOR: ¿Qué te hizo buscar una solución ahora?'} /></label>
        <fieldset className="review-type">
          <legend>Tipo de llamada</legend>
          {([['auto', 'Detectar automáticamente'], ['closer', CALL_TYPE_LABELS.closer], ['frio', CALL_TYPE_LABELS.frio]] as const).map(([value, label]) =>
            <label key={value} className="check-label">
              <input type="radio" name="call-type" value={value} checked={callType === value} onChange={() => setCallType(value)} />{label}
            </label>)}
          <p className="card-meta">{callType === 'auto' ? 'Se deduce de las primeras intervenciones; puedes cambiarlo si se equivoca.' : CALL_TYPE_HINTS[callType]}</p>
        </fieldset>
        <div className="practice-prepared-actions">
          <button type="button" className="primary" onClick={() => void review()} disabled={busy || preparing || !transcript.trim()}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <ScanLine size={16} />}Evaluar llamada
          </button>
        </div>
        {notice && <p className="auth-note" role="status">{notice}</p>}
        {error && <p className="practice-error" role="alert"><CircleAlert size={15} />{error}</p>}
      </div>
      <p className="practice-note">Sin discovery (solo confirmar una cita o un buzón de voz) no hay nada que puntuar. La nota mide ejecución, no si la venta se cerró.</p>
    </div>
  </section>;
}
