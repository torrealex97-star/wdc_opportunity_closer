'use client';
import { useState } from 'react';
import { Copy, LoaderCircle, Sparkles } from 'lucide-react';

// Asistente de respuestas: ella pega las preguntas del formulario de la empresa y recibe borradores
// basados en lo que ya escribió. Nada se envía a la empresa y el formulario solo viaja si lo marca
// aquí (cada vez): el permiso no se hereda del consentimiento del perfil.
type Answer = { question: string; answer: string; why: string; missing: string[] };

export default function ApplyAssistant({ applicationId, offerTitle, onLost }: { applicationId?: string; offerTitle?: string; onLost: () => void }) {
  const [questions, setQuestions] = useState('');
  const [attach, setAttach] = useState(false);
  const [answers, setAnswers] = useState<Answer[] | null>(null);
  const [pending, setPending] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function ask(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError(''); setNotice(''); setAnswers(null); setPending([]);
    try {
      const response = await fetch('/api/student/answer-assistant', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions, include_profile: attach, application_id: applicationId }),
      });
      const data = await response.json().catch(() => ({})) as { detail?: string; answers?: Answer[]; pending?: string[] };
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) onLost();
        throw new Error(typeof data.detail === 'string' ? data.detail : 'No se pudieron preparar las respuestas.');
      }
      setAnswers(data.answers ?? []);
      setPending(data.pending ?? []);
      setNotice('Borradores listos. Revísalos, adáptalos a cómo hablas y pégalos tú en el formulario.');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setNotice('Respuesta copiada.'); }
    catch { setNotice('No se pudo copiar: selecciona el texto y cópialo a mano.'); }
  }

  return <div className="assistant-answers" data-testid="answer-assistant">
    <form onSubmit={ask}>
      <label htmlFor={`ask-${applicationId ?? 'libre'}`}>Pega aquí las preguntas de la empresa{offerTitle ? ` para ${offerTitle}` : ''}
        <textarea id={`ask-${applicationId ?? 'libre'}`} rows={5} maxLength={4000} value={questions}
          onChange={event => setQuestions(event.target.value)} placeholder={'Una por línea. Ej.:\n¿Por qué quieres trabajar con nosotros?\nCuéntanos tu mayor logro en ventas.'} />
      </label>
      <label className="check-label" style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <input type="checkbox" checked={attach} onChange={event => setAttach(event.target.checked)} />
        <span>Adjuntar lo que ya escribí en mi formulario a ESTA consulta (experiencia, herramientas, idiomas, motivación). Autorizo el envío al proveedor de IA solo con marcarlo; nunca se envía mi email, teléfono, CV ni LinkedIn. <a href="/privacidad" target="_blank" rel="noopener noreferrer">Privacidad</a>.</span>
      </label>
      {error && <div className="alert error" role="alert"><span>{error}</span></div>}
      {notice && <div className="auth-note" role="status">{notice}</div>}
      <button className="primary" disabled={busy || !questions.trim()}>
        {busy ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />} Preparar respuestas
      </button>
    </form>
    {!!answers?.length && <ol className="assistant-list" data-testid="answer-list">
      {answers.map(item => <li key={item.question}>
        <p className="assistant-question">{item.question}</p>
        <p className="assistant-answer">{item.answer}</p>
        {item.why && <p className="card-meta">Por qué funciona: {item.why}</p>}
        {!!item.missing.length && <p className="card-meta muted">Te falta contar: {item.missing.join(' · ')}</p>}
        <button type="button" onClick={() => void copy(item.answer)}><Copy size={14} /> Copiar respuesta</button>
      </li>)}
    </ol>}
    {!!pending.length && <p className="card-meta muted">Sin borrador todavía: {pending.join(' · ')}. Vuelve a pedirlo o escríbelo tú.</p>}
  </div>;
}
