import { TRAINING_COURSES } from '../lib/trainingCourses';

// Refs que cuentan como formación repasada: ahora son los cursos de la hoja del propietario, en su
// orden. El progreso se registra con el id del curso cuando la alumna marca todas sus lecciones.
export const REVIEW_REFS: string[] = TRAINING_COURSES.map(course => course.id);
export type ReviewRef = string;
