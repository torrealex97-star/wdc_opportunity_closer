'use client';

import { useState } from 'react';
import { BookOpen, Loader2, Send, Sparkles } from 'lucide-react';

// Agente de la academia: la alumna pregunta y la respuesta sale de la skill `metodo-wdc`
// (índice generado en lib/wdcKnowledge). Si la pregunta no está en la formación, lo dice en vez de
// improvisar, y siempre muestra de qué sección y de qué lección del Classroom sale la respuesta.
// Los tipos de abajo repiten a propósito la forma del JSON de la ruta: importarlos de `lib/academyAssistant`
// arrastraría los 110 KB del índice al bundle del navegador.
export type AssistantSource = { id: string; title: string; section: string; lessons: string[] };

type Answer = { answer: string; sources: AssistantSource[]; in_programme: boolean; next_step: string | null; lessons: string[] };

export default function AcademyAssistant({ room = 'general', lessonTitle = null }: { room?: 'formacion' | 'practica' | 'revision' | 'general'; lessonTitle?: string | null }) {
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ask = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(null); setResult(null);
    try {
      const response = await fetch('/api/student/academy-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, room, ...(lessonTitle ? { lesson_title: lessonTitle } : {}) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof data?.detail === 'string' ? data.detail : 'No se ha podido responder. Inténtalo otra vez.');
        return;
      }
      setResult({
        answer: String(data.answer ?? ''),
        sources: Array.isArray(data.sources) ? data.sources : [],
        in_programme: data.in_programme === true,
        next_step: typeof data.next_step === 'string' ? data.next_step : null,
        lessons: Array.isArray(data.lessons) ? data.lessons.filter((item: unknown): item is string => typeof item === 'string') : [],
      });
    } catch {
      setError('No se ha podido consultar la academia ahora mismo. Lo que has escrito sigue aquí.');
    } finally {
      setBusy(false);
    }
  };

  return <section className="academy" aria-labelledby="academy-title">
    <div className="academy-head">
      <span className="eyebrow"><Sparkles size={13} aria-hidden="true" /> ASISTENTE DE LA ACADEMIA</span>
      <h2 id="academy-title">Pregunta lo que no tengas claro.</h2>
      <p>Responde con el método de Women Digital Closers: la estructura de la llamada, las objeciones, los cierres, el seguimiento. Si algo no está en la formación, te lo dice.</p>
    </div>
    <form className="academy-form" onSubmit={ask}>
      <label className="sr-only" htmlFor="academy-question">Tu pregunta</label>
      <textarea
        id="academy-question"
        value={question}
        onChange={event => setQuestion(event.target.value)}
        placeholder="Por ejemplo: ¿qué le digo si me dice que es muy caro?"
        maxLength={500}
        rows={3}
        disabled={busy}
      />
      <div className="academy-actions">
        <span className="card-meta">{question.trim().length}/500</span>
        <button type="submit" className="primary" disabled={busy || question.trim().length < 6}>
          {busy ? <><Loader2 size={15} className="spin" aria-hidden="true" /> Buscando…</> : <><Send size={15} aria-hidden="true" /> Preguntar</>}
        </button>
      </div>
    </form>
    {error && <p className="academy-error" role="status">{error}</p>}
    {result && <div className="academy-answer" aria-live="polite">
      <p className="academy-text">{result.answer}</p>
      {!result.in_programme && result.next_step && <p className="card-meta">{result.next_step}</p>}
      {result.sources.length > 0 && <div className="academy-sources">
        <span className="eyebrow"><BookOpen size={12} aria-hidden="true" /> DE DÓNDE SALE</span>
        <ul>
          {result.sources.map(source => <li key={source.id}>
            <strong>{source.section}</strong>{source.title !== source.section ? ` · ${source.title}` : ''}
            {source.lessons.length > 0 && <span className="card-meta"> · lección {source.lessons.join(', ')}</span>}
          </li>)}
        </ul>
      </div>}
    </div>}
  </section>;
}
