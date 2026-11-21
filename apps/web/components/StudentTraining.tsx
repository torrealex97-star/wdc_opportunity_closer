'use client';

import { useEffect, useState } from 'react';
import { BookOpen, Check, ChevronDown, CircleAlert, Clock3, ExternalLink, FileText, GraduationCap, HelpCircle, RotateCcw } from 'lucide-react';
import { TRAINING_COURSES, TOTAL_LESSONS, TOTAL_RESOURCES } from '../lib/trainingCourses';
import type { TrainingCourse } from '../lib/trainingCourses';
import { QUIZ_TOTAL, quizFor, quizPassMark, quizPassed } from '../lib/trainingQuiz';
import { classLink, classLinkForLesson, courseLink } from '../lib/skoolClass';
import { logActivity } from './studentActivityClient';
import AcademyAssistant from './AcademyAssistant';
import TrainingQuiz from './TrainingQuiz';
import WhereTaught from './WhereTaught';

// Formación: el índice es la hoja del propietario («Women Digital Closers — Inventario»). Las clases y
// los vídeos viven en Skool; esta sección es el complemento interactivo: repasa lo que has visto
// respondiendo preguntas y te deja a mano los recursos de cada lección, para quien los necesite.
// No hay casillas que marcar: un curso cuenta cuando terminas sus preguntas, y lo que se registra es el
// resultado real de ese repaso (acertadas sobre el total), no una marca de «visto».
// La hoja agrupa las lecciones de «Clases Grupales» en carpetas (Clases grupales, Roleplay Cualificación,
// Objeciones, Llamada completa); el resto de cursos es una sola lista. Se respeta el orden de la hoja.
function lessonGroups(lessons: TrainingCourse['lessons']) {
  const groups: Array<{ folder: string | null; items: Array<{ lesson: TrainingCourse['lessons'][number]; index: number }> }> = [];
  lessons.forEach((lesson, index) => {
    const folder = lesson.folder ?? null;
    const last = groups[groups.length - 1];
    if (last && last.folder === folder) last.items.push({ lesson, index });
    else groups.push({ folder, items: [{ lesson, index }] });
  });
  return groups;
}

const BEST_KEY = 'wdc_training_quiz_best';
/** Cuántos de los cursos tienen repaso: hoy, los doce. */
const COURSES_WITH_QUIZ = TRAINING_COURSES.filter(course => quizFor(course.id).length > 0).length;

// El mejor intento de cada curso y las preguntas que falló en él: con eso se sabe si está aprobado y qué
// ideas conviene repasar. Se guarda también en la actividad de la alumna (no solo aquí).
type Attempt = { correct: number; total: number; missed: string[] };
type Best = Record<string, Attempt>;

function readBest(): Best {
  try {
    const value = JSON.parse(window.localStorage.getItem(BEST_KEY) ?? '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const out: Best = {};
    for (const [id, entry] of Object.entries(value as Record<string, unknown>)) {
      const item = entry as { correct?: unknown; total?: unknown; missed?: unknown };
      const missed = Array.isArray(item?.missed) ? item.missed.filter((value): value is string => typeof value === 'string') : [];
      if (typeof item?.correct === 'number' && typeof item?.total === 'number') out[id] = { correct: item.correct, total: item.total, missed };
    }
    return out;
  } catch { return {}; }
}

// Las ideas flojas de un curso: las preguntas falladas, con el enlace a la clase donde se explican.
function MissedIdeas({ course, missed }: { course: TrainingCourse; missed: string[] }) {
  const all = quizFor(course.id);
  const questions = all.filter(question => missed.includes(question.id)).slice(0, 3);
  if (!questions.length) return null;
  return <div className="training-missed">
    <h3 className="training-quiz-title"><CircleAlert size={14} aria-hidden="true" /> Tus ideas flojas</h3>
    <p className="card-meta">Estas son las preguntas que has fallado. Vuelve a su clase y repite el repaso: el curso cuenta con {quizPassMark(all.length)} de {all.length}.</p>
    <ul className="plain-list">{questions.map(question => {
      const link = classLinkForLesson(question.lesson);
      return <li key={question.id}>
        <strong>{question.prompt}</strong>
        {link && <a className="skool-link" href={link.url} target="_blank" rel="noreferrer"><ExternalLink size={12} aria-hidden="true" /> {link.exact ? `Ver la clase ${link.lesson.id} en Skool` : `Abrir el módulo y buscar «${link.lesson.title}»`}</a>}
      </li>;
    })}</ul>
    {missed.length > 3 && <p className="card-meta">Y {missed.length - 3} pregunta{missed.length - 3 === 1 ? '' : 's'} más de este repaso.</p>}
  </div>;
}

export default function StudentTraining() {
  const [best, setBest] = useState<Best>({});
  const [open, setOpen] = useState<string | null>(TRAINING_COURSES[0]?.id ?? null);
  useEffect(() => { setBest(readBest()); }, []);

  // Un curso cuenta cuando su repaso está aprobado; repasado sin aprobar no suma.
  const attempted = TRAINING_COURSES.filter(course => best[course.id]);
  const approved = attempted.filter(course => quizPassed(best[course.id].correct, best[course.id].total)).length;
  const unapproved = attempted.length - approved;

  // El repaso se registra como actividad de formación: acertadas sobre el total de esa sesión, si está
  // aprobado (lo decide el servidor con la misma regla) y qué preguntas ha fallado. Sin sesión iniciada,
  // el cliente descarta el envío y la vista no se rompe.
  const finish = (course: TrainingCourse, correct: number, total: number, missed: string[]) => {
    const previous = best[course.id];
    // Se queda el mejor intento; con los mismos aciertos, el más reciente (y sus falladas).
    if (!previous || correct >= previous.correct) {
      const next = { ...best, [course.id]: { correct, total, missed } };
      setBest(next);
      try { window.localStorage.setItem(BEST_KEY, JSON.stringify(next)); } catch { /* sin almacenamiento: el repaso vale igual */ }
    }
    void logActivity({ kind: 'training_review', ref: course.id, detail: { met: correct, total, missed } });
  };

  return <section className="training">
    <div className="training-head">
      <div>
        <span className="eyebrow">FORMACIÓN · WOMEN DIGITAL CLOSERS</span>
        <h1>Aprende el método antes de improvisar.</h1>
        <p>Las clases están en Skool, en el orden de la hoja. Aquí repasas lo que has visto respondiendo preguntas, y tienes a mano los recursos de cada lección para cuando te hagan falta. No hay casillas: el avance es lo que contestas, no lo que marcas.</p>
      </div>
      <span className="training-icon"><GraduationCap size={26} strokeWidth={1.4} /></span>
    </div>

    <div className="training-summary">
      <p className="card-meta"><strong>{TRAINING_COURSES.length}</strong> cursos · {TOTAL_LESSONS} lecciones en Skool · {TOTAL_RESOURCES} recursos enlazados · {QUIZ_TOTAL} preguntas de repaso en {COURSES_WITH_QUIZ} cursos · <strong>{approved}</strong> de {TRAINING_COURSES.length} aprobados{unapproved > 0 ? ` · ${unapproved} repasados sin aprobar` : ''}</p>
      <p className="card-meta">Un curso cuenta cuando apruebas su repaso: {quizPassMark(2)} de 2 respuestas bien. Responder mal no resta, pero no suma: te dice qué volver a ver antes de repetirlo.</p>
    </div>

    <WhereTaught />

    <div className="training-grid">
      {TRAINING_COURSES.map(course => {
        const questions = quizFor(course.id);
        const moduleLink = courseLink(course);
        const result = best[course.id];
        const complete = Boolean(result) && quizPassed(result.correct, result.total);
        const expanded = open === course.id;
        return <article className="training-card" key={course.id} data-complete={complete}>
          <div className="training-card-top">
            <span className="eyebrow">CURSO {String(course.order).padStart(2, '0')}</span>
            {result && <span className={complete ? 'status ok' : 'status'}>{complete ? <><Check size={12} /> Aprobado {result.correct}/{result.total}</> : `Repasado ${result.correct}/${result.total} · sin aprobar`}</span>}
          </div>
          <h2>{course.title}</h2>
          {course.summary && <p>{course.summary}</p>}
          <p className="card-meta"><BookOpen size={14} /> {course.lessons.length} lecciones · <Clock3 size={14} /> {course.duration} · <FileText size={14} /> {course.lessons.reduce((n, lesson) => n + lesson.resources.length, 0)} recursos{questions.length > 0 ? <> · <HelpCircle size={14} /> {questions.length} preguntas</> : null}</p>
          {moduleLink && <a className="skool-link" href={moduleLink.url} target="_blank" rel="noreferrer"><ExternalLink size={13} aria-hidden="true" /> Abrir el módulo en Skool</a>}
          <button type="button" className="training-open" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : course.id)}>
            <ChevronDown size={16} aria-hidden="true" style={{ transform: expanded ? 'rotate(180deg)' : undefined }} />
            {expanded ? 'Cerrar curso' : 'Abrir curso'}
          </button>
          {expanded && <>
            <div className="training-lesson-groups">
              {lessonGroups(course.lessons).map((group, groupIndex) => <div className="training-folder" key={`${group.folder ?? 'sin-carpeta'}-${groupIndex}`}>
                {group.folder && <h3 className="training-folder-title">{group.folder}<span> · {group.items.length} lecciones</span></h3>}
                <ol className="training-lessons">
                  {group.items.map(({ lesson, index }) => {
                    // La clase se abre donde está de verdad: su enlace si la hoja lo trae y, si no, el módulo.
                    const link = classLink(course, lesson);
                    return <li key={lesson.id}>
                    <div className="training-lesson">
                      <span className="training-lesson-order">{String(index + 1).padStart(2, '0')}</span>
                      <span className="training-lesson-title">{link
                        ? <a className="skool-link" href={link.url} target="_blank" rel="noreferrer" title={link.exact ? `Abrir la clase ${lesson.id} en Skool` : `Abrir el módulo en Skool y buscar «${lesson.title}»`}>{lesson.title}<ExternalLink size={11} aria-hidden="true" /></a>
                        : lesson.title}</span>
                      {lesson.duration && <span className="training-lesson-time">{lesson.duration}</span>}
                    </div>
                    {lesson.resources.length > 0 && <ul className="training-resources">
                      {lesson.resources.map(resource => <li key={`${lesson.id}-${resource.url}`}>
                        <a href={resource.url} target="_blank" rel="noreferrer"><FileText size={13} aria-hidden="true" /> {resource.name} <ExternalLink size={12} aria-hidden="true" /></a>
                      </li>)}
                    </ul>}
                  </li>;
                  })}
                </ol>
              </div>)}
            </div>
            {questions.length > 0
              ? <div className="training-quiz-block">
                <h3 className="training-quiz-title"><HelpCircle size={14} aria-hidden="true" /> Repasa este curso</h3>
                <p className="card-meta">Sin mirar los apuntes. Si fallas, la explicación te devuelve a la clase.</p>
                <TrainingQuiz questions={questions} onFinish={(correct, total, missed) => finish(course, correct, total, missed)} />
                {result && !complete && <MissedIdeas course={course} missed={result.missed} />}
              </div>
              : <p className="card-meta">Este curso es de clase grabada: no tiene repaso escrito. Practícalo en la sala de práctica.</p>}
          </>}
        </article>;
      })}
    </div>

    <div className="training-close">
      <div>
        <span className="eyebrow">CÓMO SE USA</span>
        <h2>Primero la clase, después las preguntas.</h2>
        <p>El Classroom es la fuente: los {TRAINING_COURSES.length} cursos y sus {TOTAL_LESSONS} lecciones están en Skool, en el orden de la hoja, y aquí no se duplican. Cada lección se abre desde aquí en su clase, y cada curso en su módulo. Los recursos son los archivos que el Classroom enlaza en cada lección (PDF, documentos, plantillas): están a mano para quien los necesite, no son un requisito. Algunos enlaces llevan a Drive o a Canva y piden permiso con la cuenta con la que se compartieron.</p>
        <p className="card-meta">Lo que aquí se contesta es repaso, no nota de la academia: lo que se puntúa de verdad es la práctica en la sala. Si una pregunta no te cuadra con la clase, pregúntale al asistente de abajo.</p>
      </div>
      <RotateCcw size={26} className="training-close-icon" aria-hidden="true" />
    </div>

    <AcademyAssistant room="formacion" />
  </section>;
}
