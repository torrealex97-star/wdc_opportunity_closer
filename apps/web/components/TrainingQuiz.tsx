'use client';

import { useState } from 'react';
import { Check, CircleAlert, ExternalLink, RotateCcw } from 'lucide-react';
import { quizPassMark, quizPassed } from '../lib/trainingQuiz';
import type { QuizQuestion } from '../lib/trainingQuiz';
import { classLinkForLesson } from '../lib/skoolClass';

// Repaso de un curso: una pregunta cada vez, respuesta inmediata con su porqué y marcador al final.
// No hay casillas: el avance se gana respondiendo. La nota que se registra es la de esta sesión, no una
// media histórica, y el servidor guarda el recuento como actividad de formación.
export default function TrainingQuiz({ questions, onFinish }: { questions: QuizQuestion[]; onFinish: (correct: number, total: number, missed: string[]) => void }) {
  const [index, setIndex] = useState(0);
  const [chosen, setChosen] = useState<number | null>(null);
  const [correct, setCorrect] = useState(0);
  const [missed, setMissed] = useState<string[]>([]);
  const [done, setDone] = useState(false);

  if (!questions.length) return null;
  const question = questions[index];
  const answered = chosen !== null;
  // La explicación devuelve a la clase: abre la lección citada (o su módulo si la hoja no trae enlace).
  const link = classLinkForLesson(question.lesson);

  const choose = (option: number) => {
    if (answered) return;
    setChosen(option);
    if (option === question.correct) setCorrect(value => value + 1);
    else setMissed(value => [...value, question.id]);
  };

  const next = () => {
    if (index + 1 < questions.length) { setIndex(value => value + 1); setChosen(null); return; }
    setDone(true);
    onFinish(correct, questions.length, missed);
  };

  const restart = () => { setIndex(0); setChosen(null); setCorrect(0); setMissed([]); setDone(false); };

  if (done) {
    // Aprobar es lo que hace que el curso cuente: 0/2 no vale lo mismo que 2/2.
    const passed = quizPassed(correct, questions.length);
    const mark = quizPassMark(questions.length);
    return <div className="quiz-result" role="status" data-passed={passed}>
      <span className="eyebrow"><Check size={12} aria-hidden="true" /> {passed ? 'REPASO APROBADO' : 'REPASO SIN APROBAR'}</span>
      <p><strong>{correct} de {questions.length}</strong> {passed
        ? 'acertadas: el curso cuenta como repasado.'
        : `acertadas y necesitas ${mark} de ${questions.length}. El curso no cuenta todavía; repite las que has fallado y vuelve a intentarlo.`}</p>
      <button type="button" onClick={restart}><RotateCcw size={14} aria-hidden="true" /> Repetir las preguntas</button>
    </div>;
  }

  return <div className="quiz">
    <div className="quiz-head">
      <span className="eyebrow">PREGUNTA {index + 1} DE {questions.length}</span>
      <span className="card-meta">acertadas: {correct}</span>
    </div>
    <p className="quiz-prompt">{question.prompt}</p>
    <div className="quiz-options">
      {question.options.map((option, position) => {
        const state = !answered ? 'idle' : position === question.correct ? 'right' : position === chosen ? 'wrong' : 'idle';
        return <button
          key={option}
          type="button"
          data-state={state}
          aria-pressed={chosen === position}
          onClick={() => choose(position)}
          disabled={answered}
        >{state === 'right' ? <Check size={14} aria-hidden="true" /> : state === 'wrong' ? <CircleAlert size={14} aria-hidden="true" /> : null}{option}</button>;
      })}
    </div>
    {answered && <div className="quiz-why" role="status">
      <p>{question.why}</p>
      {link && <a className="skool-link" href={link.url} target="_blank" rel="noreferrer"><ExternalLink size={12} aria-hidden="true" /> {link.exact ? `Ver la clase ${link.lesson.id} en Skool` : `Abrir el módulo en Skool y buscar «${link.lesson.title}»`}</a>}
      <button type="button" className="primary" onClick={next}>{index + 1 < questions.length ? 'Siguiente pregunta' : 'Terminar el repaso'}</button>
    </div>}
  </div>;
}
