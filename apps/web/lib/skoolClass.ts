// Enlaces a las clases del Classroom de Skool. Los pone el propietario en la hoja de formación y viajan en
// `trainingCourses` (el del módulo abre su carpeta; el de la lección abre esa clase concreta). Aquí solo se
// resuelve qué enlace toca: nunca se construye una URL de Skool a mano, porque sin el identificador real
// llevaría a una página que no existe.
import { TRAINING_COURSES } from './trainingCourses';
import type { TrainingCourse, TrainingLesson } from './trainingCourses';

export type ClassLink = {
  url: string;
  /** Qué se abre: la clase concreta o, si la hoja no trae enlace de lección, su módulo. */
  exact: boolean;
  label: string;
};

export function courseLink(course: TrainingCourse): ClassLink | null {
  return course.url ? { url: course.url, exact: true, label: course.title } : null;
}

/** Enlace de una lección: el suyo si existe; si no, el de su módulo (y se avisa de que hay que buscarla). */
export function classLink(course: TrainingCourse, lesson: TrainingLesson): ClassLink | null {
  if (lesson.url) return { url: lesson.url, exact: true, label: `${lesson.id} · ${lesson.title}` };
  if (course.url) return { url: course.url, exact: false, label: `${lesson.title} (está en «${course.title}»)` };
  return null;
}

/** Enlace por id de lección (`3.2`), que es como las preguntas del repaso citan la clase. */
export function classLinkForLesson(lessonId: string): (ClassLink & { course: TrainingCourse; lesson: TrainingLesson }) | null {
  for (const course of TRAINING_COURSES) {
    for (const lesson of course.lessons) {
      if (lesson.id !== lessonId) continue;
      const link = classLink(course, lesson);
      return link ? { ...link, course, lesson } : null;
    }
  }
  return null;
}
