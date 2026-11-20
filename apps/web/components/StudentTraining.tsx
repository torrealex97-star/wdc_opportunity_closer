'use client';

import { useEffect, useMemo, useState } from 'react';
import { BookOpen, Check, ChevronDown, Clock3, ExternalLink, FileText, GraduationCap, RotateCcw } from 'lucide-react';
import { TRAINING_COURSES, TOTAL_LESSONS, TOTAL_RESOURCES } from '../lib/trainingCourses';
import type { TrainingCourse } from '../lib/trainingCourses';
import { logActivity } from './studentActivityClient';

// Formación: el índice es la hoja del propietario («Women Digital Closers — Inventario»), ni más ni
// menos. Cada curso abre sus lecciones y los recursos que cuelgan de ellas, tal como están enlazados
// allí. La alumna marca la lección que ha estudiado; al completar un curso se registra una sola vez en
// su actividad (servidor), que es lo que alimenta «Mi progreso» y el panel de la coordinadora.
const STORE_KEY = 'wdc_training_lessons';
const LOGGED_KEY = 'wdc_training_courses_logged';

function readIds(key: string): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? '[]');
    return Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
  } catch { return []; }
}

export default function StudentTraining() {
  const [studied, setStudied] = useState<string[]>([]);
  const [open, setOpen] = useState<string | null>(TRAINING_COURSES[0]?.id ?? null);
  const [ready, setReady] = useState(false);

  useEffect(() => { setStudied(readIds(STORE_KEY)); setReady(true); }, []);

  const done = useMemo(() => new Set(studied), [studied]);
  const perCourse = useMemo(() => Object.fromEntries(TRAINING_COURSES.map(course => [course.id, course.lessons.filter(lesson => done.has(lesson.id)).length])), [done]);
  const total = studied.filter(id => TRAINING_COURSES.some(course => course.lessons.some(lesson => lesson.id === id))).length;

  const persist = (next: string[]) => {
    setStudied(next);
    try { window.localStorage.setItem(STORE_KEY, JSON.stringify(next)); } catch { /* sin almacenamiento: la marca vive en memoria */ }
  };

  // Un curso cuenta cuando están todas sus lecciones: entonces se registra una vez en la actividad.
  const toggleLesson = (course: TrainingCourse, lessonId: string, checked: boolean) => {
    const next = checked ? [...new Set([...studied, lessonId])] : studied.filter(id => id !== lessonId);
    persist(next);
    const complete = course.lessons.every(lesson => next.includes(lesson.id));
    const logged = readIds(LOGGED_KEY);
    if (!complete || logged.includes(course.id)) return;
    try { window.localStorage.setItem(LOGGED_KEY, JSON.stringify([...logged, course.id])); } catch { /* se reintenta al volver a marcar */ }
    void logActivity({ kind: 'training_review', ref: course.id, detail: { met: course.lessons.length, total: course.lessons.length } });
  };

  return <section className="training">
    <div className="training-head">
      <div>
        <span className="eyebrow">FORMACIÓN · WOMEN DIGITAL CLOSERS</span>
        <h1>Aprende el método antes de improvisar.</h1>
        <p>Los {TRAINING_COURSES.length} cursos del Classroom, en su orden, con sus lecciones y los recursos que las acompañan. Marca la lección cuando la hayas estudiado: así sabes por dónde vas y la coordinadora ve tu avance real.</p>
      </div>
      <span className="training-icon"><GraduationCap size={26} strokeWidth={1.4} /></span>
    </div>

    <div className="training-summary">
      <div className="meter" role="progressbar" aria-label="Lecciones estudiadas" aria-valuemin={0} aria-valuemax={TOTAL_LESSONS} aria-valuenow={total}><span style={{ width: `${Math.round((total / TOTAL_LESSONS) * 100)}%` }} /></div>
      <p className="card-meta"><strong>{total}</strong> de {TOTAL_LESSONS} lecciones estudiadas · {TOTAL_RESOURCES} recursos enlazados · {TRAINING_COURSES.length} cursos</p>
    </div>

    <div className="training-grid">
      {TRAINING_COURSES.map(course => {
        const checked = perCourse[course.id] ?? 0;
        const complete = checked === course.lessons.length;
        const expanded = open === course.id;
        return <article className="training-card" key={course.id} data-complete={complete}>
          <div className="training-card-top">
            <span className="eyebrow">CURSO {String(course.order).padStart(2, '0')}</span>
            {complete && <span className="status ok"><Check size={12} /> Estudiado</span>}
          </div>
          <h2>{course.title}</h2>
          {course.summary && <p>{course.summary}</p>}
          <p className="card-meta"><BookOpen size={14} /> {course.lessons.length} lecciones · <Clock3 size={14} /> {course.duration} · <FileText size={14} /> {course.lessons.reduce((n, lesson) => n + lesson.resources.length, 0)} recursos</p>
          <div className="meter" role="progressbar" aria-label={`Lecciones estudiadas de ${course.title}`} aria-valuemin={0} aria-valuemax={course.lessons.length} aria-valuenow={checked}><span style={{ width: `${Math.round((checked / course.lessons.length) * 100)}%` }} /></div>
          <button type="button" className="training-open" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : course.id)}>
            <ChevronDown size={16} aria-hidden="true" style={{ transform: expanded ? 'rotate(180deg)' : undefined }} />
            {expanded ? 'Cerrar curso' : 'Abrir curso'}
          </button>
          {expanded && <ol className="training-lessons">
            {course.lessons.map((lesson, index) => <li key={lesson.id} data-done={done.has(lesson.id)}>
              <label className="training-lesson-check">
                <input type="checkbox" checked={done.has(lesson.id)} disabled={!ready} onChange={event => toggleLesson(course, lesson.id, event.target.checked)} />
                <span className="training-lesson-order">{String(index + 1).padStart(2, '0')}</span>
                <span className="training-lesson-title">{lesson.title}</span>
                {lesson.duration && <span className="training-lesson-time">{lesson.duration}</span>}
              </label>
              {lesson.resources.length > 0 && <ul className="training-resources">
                {lesson.resources.map(resource => <li key={`${lesson.id}-${resource.url}`}>
                  <a href={resource.url} target="_blank" rel="noreferrer"><FileText size={13} aria-hidden="true" /> {resource.name} <ExternalLink size={12} aria-hidden="true" /></a>
                </li>)}
              </ul>}
            </li>)}
          </ol>}
        </article>;
      })}
    </div>

    <div className="training-close">
      <div>
        <span className="eyebrow">CÓMO SE USA</span>
        <h2>Un curso, una lección, un recurso.</h2>
        <p>El orden es el de la hoja: {TRAINING_COURSES.map(course => course.title).join(' → ')}. Los recursos son los archivos que el Classroom enlaza en cada lección (PDF, documentos y plantillas). Algunos enlaces llevan a Drive o a Canva y piden permiso con la cuenta con la que se compartieron.</p>
        <p className="card-meta">Marcar una lección no la evalúa ni la puntúa: solo dice que la has estudiado. Lo que se practica se mide en la sala, no aquí.</p>
      </div>
      <RotateCcw size={26} className="training-close-icon" aria-hidden="true" />
    </div>
  </section>;
}
