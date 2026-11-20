// Imprime la formación tal como la ve el portal, para que `tests/test_training_courses.py` compruebe el módulo real
// (no una copia). Sin red: los datos son estáticos y vienen de la hoja del propietario.
import { TRAINING_COURSES } from '../apps/web/lib/trainingCourses.ts';

console.log(JSON.stringify(TRAINING_COURSES));
