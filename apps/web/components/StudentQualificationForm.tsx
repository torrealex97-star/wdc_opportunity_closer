'use client';

import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CircleAlert, Gauge, RotateCcw, ShieldCheck, Target } from 'lucide-react';
import { AUTHORITY_RULES, FORM_QUESTIONS, formBand, gradeForm, reviewPitch } from './qualificationForm';

// Test del formulario de cualificación: ocho preguntas reales de un formulario de closer,
// con lo que lee quien contrata en cada respuesta. Sin red, sin IA y sin guardar nada:
// se puede repetir tantas veces como haga falta. La presentación libre se revisa con
// reglas explicables, no con una nota.

const letter = (index: number) => String.fromCharCode(65 + index);
const gradeLabel = (grade: number) => grade === 2 ? 'Se lee con autoridad' : grade === 1 ? 'Correcta, pero floja' : 'Resta';

export default function StudentQualificationForm({ onBack }: { onBack: () => void }) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const [pitch, setPitch] = useState('');
  const [pitchChecked, setPitchChecked] = useState(false);

  const question = FORM_QUESTIONS[index];
  const chosen = question ? question.options.find(option => option.id === answers[question.id]) : undefined;
  const result = useMemo(() => gradeForm(answers), [answers]);
  const band = formBand(result.score);
  const pitchCriteria = useMemo(() => reviewPitch(pitch), [pitch]);

  function choose(id: string) {
    setAnswers(current => ({ ...current, [question.id]: id }));
  }
  function restart() {
    setAnswers({}); setIndex(0); setDone(false); setPitch(''); setPitchChecked(false);
  }

  if (done) {
    return <section className="qualify" aria-label="Resultado del formulario de cualificación">
      <button className="practice-back" type="button" onClick={onBack}><ArrowLeft size={16} />Volver a la sala</button>
      <span className="eyebrow">TEST · FORMULARIO DE CUALIFICACIÓN</span>
      <h1>Así se lee tu formulario.</h1>
      <div className="qualify-score" data-band={result.score >= 80 ? 'alto' : result.score >= 50 ? 'medio' : 'bajo'}>
        <Gauge size={18} />
        <b>{result.score}</b><span>/100</span>
        <small>{band.label}</small>
      </div>
      <p className="qualify-lead">{band.detail}</p>
      <p className="card-meta"><strong>{result.strong} de {result.total}</strong> respuestas se leen con autoridad. No es una nota oficial ni evalúa tu candidatura: es un test para aprender a responder.</p>

      <h2>Pregunta por pregunta</h2>
      <ol className="qualify-review">
        {FORM_QUESTIONS.map(item => {
          const picked = item.options.find(option => option.id === answers[item.id]);
          const best = item.options.find(option => option.grade === 2);
          return <li key={item.id} data-ok={picked?.grade === 2}>
            <div className="qualify-review-head">
              {picked?.grade === 2 ? <Check size={15} /> : <CircleAlert size={15} />}
              <strong>{item.question}</strong>
              <span className="qualify-grade" data-grade={picked?.grade ?? -1}>{picked ? gradeLabel(picked.grade) : '— sin responder'}</span>
            </div>
            {picked && <p className="qualify-reads">«{picked.text}» → {picked.reads}</p>}
            {best && picked?.id !== best.id && <p className="qualify-best"><strong>La que se lee con autoridad:</strong> «{best.text}»</p>}
          </li>;
        })}
      </ol>

      <h2><ShieldCheck size={17} />Las cinco reglas de autoridad</h2>
      <ul className="qualify-rules">{AUTHORITY_RULES.map(rule => <li key={rule.id}><strong>{rule.title}</strong><p>{rule.text}</p></li>)}</ul>

      <div className="qualify-pitch">
        <h2><Target size={17} />Ahora escríbela tú</h2>
        <p className="card-meta">«Preséntate en dos líneas» es la pregunta que más formularios repiten. Escribe tu respuesta y revísala: no hay una respuesta perfecta, hay una que se puede comprobar.</p>
        <label htmlFor="qualify-pitch">Tu presentación
          <textarea id="qualify-pitch" value={pitch} onChange={event => { setPitch(event.target.value); setPitchChecked(false); }} rows={3} maxLength={600} placeholder="Ayudo a… Lo hago con… Lo mido con…" />
        </label>
        <div className="qualify-actions">
          <button type="button" className="primary" disabled={!pitch.trim()} onClick={() => setPitchChecked(true)}>Revisar mi presentación</button>
          <button type="button" onClick={restart}><RotateCcw size={15} />Repetir el test</button>
        </div>
        {pitchChecked && <ul className="qualify-criteria" aria-live="polite">
          {pitchCriteria.map(criterion => <li key={criterion.id} data-ok={criterion.ok}>{criterion.ok ? <Check size={14} /> : <CircleAlert size={14} />}{criterion.detail}</li>)}
        </ul>}
      </div>
      <p className="practice-note">Este test no envía nada a ninguna empresa: es material de práctica. Las respuestas de ejemplo llevan huecos [así] a propósito, para que pongas tus datos y no copies cifras ajenas.</p>
    </section>;
  }

  return <section className="qualify" aria-label="Test del formulario de cualificación">
    <button className="practice-back" type="button" onClick={onBack}><ArrowLeft size={16} />Volver a la sala</button>
    <span className="eyebrow">TEST · FORMULARIO DE CUALIFICACIÓN</span>
    <h1>El formulario que sí te llama.</h1>
    <p className="qualify-lead">Los formularios de closer se leen en menos de un minuto. Aquí practicas, pregunta a pregunta, qué respuesta hace que quien contrata quiera hablar contigo, sin inventar experiencia y sin pedir perdón por empezar.</p>
    <div className="qualify-intro">
      <div><span className="eyebrow">QUÉ MIRA QUIEN CONTRATA</span><p>Tres cosas, en este orden: <strong>evidencia</strong> de que has vendido o de que sabes cómo se hace, <strong>criterio</strong> para hablar de números y objeciones, y <strong>encaje</strong> con el puesto y el modelo de pago.</p></div>
      <p className="qualify-note">Si acabas de empezar, no compitas en años: compite en método, cifras propias y siguiente paso. Eso también es autoridad.</p>
    </div>
    <div className="qualify-progress" role="status">Pregunta {index + 1} de {FORM_QUESTIONS.length}</div>
    <fieldset className="qualify-question">
      <legend>{question.question}</legend>
      <p className="card-meta">{question.wants}</p>
      <div className="qualify-options">
        {question.options.map((option, position) => <button key={option.id} type="button" className="qualify-option" aria-pressed={chosen?.id === option.id} data-grade={option.grade} onClick={() => choose(option.id)}>
          <span className="qualify-letter">{letter(position)}</span>
          <span>{option.text}</span>
        </button>)}
      </div>
    </fieldset>
    {chosen && <div className="qualify-feedback" aria-live="polite" data-grade={chosen.grade}>
      <strong>{gradeLabel(chosen.grade)}</strong>
      <p>{chosen.reads}</p>
    </div>}
    <div className="qualify-actions">
      {index > 0 && <button type="button" onClick={() => setIndex(current => current - 1)}><ArrowLeft size={15} />Anterior</button>}
      <button type="button" className="primary" disabled={!chosen} onClick={() => { if (index === FORM_QUESTIONS.length - 1) setDone(true); else setIndex(current => current + 1); }}>
        {index === FORM_QUESTIONS.length - 1 ? 'Ver resultado' : 'Siguiente'}<ArrowRight size={15} />
      </button>
    </div>
    <p className="practice-note">Puedes cambiar de respuesta antes de pasar: el objetivo es comparar cómo suena cada una. Nada de lo que escribas aquí se envía ni se guarda.</p>
  </section>;
}
