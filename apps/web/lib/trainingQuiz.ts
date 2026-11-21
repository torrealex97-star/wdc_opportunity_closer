// Preguntas de repaso por curso del Classroom. Las clases y los vídeos viven en Skool; aquí solo se
// comprueba lo que la alumna ha entendido, con preguntas sobre el método de la academia.
//
// Reglas editoriales de este banco:
// 1. Cada pregunta sale de una sección de `metodo-wdc` y su explicación la cita (§) con la lección
//    donde se enseña (6.3, 7.3, 8.3…). No hay cifras, casos ni resultados inventados.
// 2. Los cursos con material solo en vídeo se preguntan por lo que la hoja declara que enseñan y por el
//    método que la academia sí tiene escrito: no se pregunta por el contenido de un vídeo que no se ha leído.
// 3. Una pregunta, una idea. Si una opción es correcta «a veces», no vale: se reescribe.
import { TRAINING_COURSES } from './trainingCourses';

export type QuizQuestion = {
  id: string;
  prompt: string;
  options: string[];
  /** Índice de la opción correcta (0-based). */
  correct: number;
  /** Por qué, citando la sección de `metodo-wdc` y la lección del Classroom. */
  why: string;
  /** Lección del Classroom donde se enseña: la explicación enlaza ahí para volver a verla. */
  lesson: string;
};

/**
 * Aprobar el repaso: 80 % de aciertos. Con dos preguntas por curso eso es acertar las dos; si un curso
 * crece a cinco, con cuatro se aprueba. Repasar sin aprobar no cuenta como módulo hecho: 0/2 no es 2/2.
 */
const QUIZ_PASS_RATIO = 0.8;
export const quizPassMark = (total: number) => Math.max(1, Math.ceil(total * QUIZ_PASS_RATIO));
export const quizPassed = (correct: number, total: number) => total > 0 && correct >= quizPassMark(total);

export const QUIZ_BY_COURSE: Record<string, QuizQuestion[]> = {
  onboarding: [
    {
      id: 'onboarding-1',
      lesson: '3.2',
      prompt: '¿Cuál es el trabajo de una closer durante la llamada?',
      options: ['Cerrar como sea', 'Diagnosticar antes de proponer', 'Explicar todas las características', 'Bajar el precio para facilitar la decisión'],
      correct: 1,
      why: 'La academia lo deja claro en 3.2: el propósito no es cerrar, es diagnosticar (§1.1). Si el diagnóstico es bueno, la decisión aparece sola.',
    },
    {
      id: 'onboarding-2',
      lesson: '1.2',
      prompt: '«Me ha dicho que no.» ¿Qué significa para una closer?',
      options: ['Que ha fallado y tiene que cambiar el discurso', 'Un dato estadístico, no un juicio personal', 'Que la oferta no sirve', 'Que hay que bajar el precio'],
      correct: 1,
      why: '§1.2: el rechazo es estadístico y el problema del prospecto es más grande que tu miedo. Un no no dice nada de ti; dice algo de su momento.',
    },
  ],

  'fundamentos-del-high-ticket': [
    {
      id: 'fundamentos-del-high-ticket-1',
      lesson: '2.3',
      prompt: '¿Qué justifica un precio alto?',
      options: ['Las horas que dedicas', 'La transformación que la clienta percibe', 'Que el mercado cobre eso', 'La urgencia de la clienta'],
      correct: 1,
      why: '2.3 y 2.5 (§2 y §3): se vende el resultado antes que el cómo. El precio se sostiene en el valor percibido, no en el esfuerzo ni en la comparación.',
    },
    {
      id: 'fundamentos-del-high-ticket-2',
      lesson: '2.8',
      prompt: 'Dice «es muy caro». ¿Qué NO se hace?',
      options: ['Preguntar con qué lo está comparando', 'Bajar el precio', 'Recordar el coste de seguir igual', 'Nombrar la objeción antes de responder'],
      correct: 1,
      why: '2.8 y 7.2 (§6 y §12.3): no se baja el precio; se cambian términos o componentes, y solo con autorización. Bajar el precio confirma que el valor era menor.',
    },
  ],

  'identidad-profesional-de-la-closer': [
    {
      id: 'identidad-profesional-de-la-closer-1',
      lesson: '3.5',
      prompt: 'Simpatía frente a autoridad: ¿qué sostiene la llamada?',
      options: ['Caer bien a toda costa', 'Un marco claro y preguntas que hacen pensar', 'Hablar más que la clienta', 'Aceptar todo lo que ella dice'],
      correct: 1,
      why: '3.5 (§1.9 y §4): la simpatía busca aprobación y resta autoridad. La llamada la sostiene el marco y las preguntas, no el agrado.',
    },
    {
      id: 'identidad-profesional-de-la-closer-2',
      lesson: '3.2',
      prompt: '¿Qué haces justo antes de una llamada?',
      options: ['Repasar el guion palabra por palabra', 'El ritual: ficha, objetivo y tu estado', 'Improvisar del todo para sonar natural', 'Llamar sin mirar nada'],
      correct: 1,
      why: '3.2 (§1.7): el ritual de pre-llamada es revisar la información, decidir el objetivo y llegar centrada. Recitar el guion te saca de la conversación.',
    },
  ],

  'fundamentos-de-marketing': [
    {
      id: 'fundamentos-de-marketing-1',
      lesson: '4.5',
      prompt: '¿Para qué sirven los niveles de conciencia del lead?',
      options: ['Para elegir cuánto explicar y desde dónde entra el mensaje', 'Para decidir el precio', 'Para saber si la clienta miente', 'Para elegir el canal de captación'],
      correct: 0,
      why: '4.5 y 5.2 (§7): según lo que ya sabe, hay que explicar más o menos. Al que no conoce el problema no se le presenta la oferta: primero se le abre la brecha.',
    },
    {
      id: 'fundamentos-de-marketing-2',
      lesson: '4.3',
      prompt: 'Un lead de anuncio y uno de outbound: ¿qué cambia en la llamada?',
      options: ['Nada, se tratan igual', 'Cuánto contexto hay que construir antes de cualificar', 'El precio de la oferta', 'La duración máxima'],
      correct: 1,
      why: '4.2–4.4 (§0.3 y §7): el de outbound llega más frío y necesita más contexto; el de anuncio ya se ha interesado. Se adapta la entrada, no el método.',
    },
  ],

  'psicologia-de-decision-del-cliente': [
    {
      id: 'psicologia-de-decision-del-cliente-1',
      lesson: '5.3',
      prompt: 'Los tres pilares de la psicología de compra son…',
      options: ['Dolor, deseo y urgencia', 'Precio, producto y plaza', 'Miedo, culpa y prisa', 'Razón, emoción y prueba'],
      correct: 0,
      why: '5.2 y 5.3 (§7): dolor, deseo y urgencia. Sin los tres, la decisión se queda en «me gusta» y no llega a «lo hago».',
    },
    {
      id: 'psicologia-de-decision-del-cliente-2',
      lesson: '5.2',
      prompt: 'Dolor superficial frente a dolor real:',
      options: ['Se pregunta igual, da lo mismo', 'El superficial no vende: hay que cavar hasta el ejemplo concreto', 'El real se puede inventar', 'Solo importa en ventas B2B'],
      correct: 1,
      why: '5.2 y el roleplay 12.12 (§1.4 y §7): el dolor superficial no mueve a nadie. Se cava con «¿por qué?» y un ejemplo hasta llegar al coste real.',
    },
  ],

  'estructura-de-la-llamada': [
    {
      id: 'estructura-de-la-llamada-1',
      lesson: '6.1',
      prompt: '¿Cuál es el orden de la llamada?',
      options: ['Presentar → preguntar → cerrar', 'Marco → cualificación → presentación → cierre', 'Precio → objeciones → preguntas', 'Preguntar → precio → cerrar'],
      correct: 1,
      why: '6.1 y 6.2 (§8): primero el marco, después la cualificación, después la oferta y después el cierre. Cada fase prepara la siguiente.',
    },
    {
      id: 'estructura-de-la-llamada-2',
      lesson: '6.4',
      prompt: '¿Cuándo se presenta la oferta?',
      options: ['Al principio, para no perder tiempo', 'Después de cualificar y cuantificar la brecha', 'Después del cierre', 'Solo si ella lo pide'],
      correct: 1,
      why: '6.3 y 6.4 (§9 y §10): la oferta se presenta cuando ya hay brecha con números. Presentar antes convierte la llamada en un catálogo.',
    },
  ],

  'gestion-de-las-objeciones': [
    {
      id: 'gestion-de-las-objeciones-1',
      lesson: '7.3',
      prompt: '«Lo tengo que pensar»: ¿qué guion abre la conversación?',
      options: ['Insistir en el precio', 'Los tres pilares: tiempo, dinero y confianza', 'Mandar información y esperar', 'Dar la venta por perdida'],
      correct: 1,
      why: '7.3 y 7.5 (§12.2): el guion de tres pilares pregunta qué falta en tiempo, dinero y confianza, y cierra con «si tuvieras las tres, ¿qué te impide dar el paso?».',
    },
    {
      id: 'gestion-de-las-objeciones-2',
      lesson: '6.10',
      prompt: 'Una objeción fantasma es…',
      options: ['Una que se inventa la closer', 'La que se previene antes de que exista, en la presentación', 'Solo la del precio', 'La que aparece al final de la llamada'],
      correct: 1,
      why: '6.9 y 6.10 (§12.1): las objeciones se previenen, no se manejan. La fantasmal se desactiva en la presentación, antes de que la clienta la formule.',
    },
  ],

  'domina-el-seguimiento': [
    {
      id: 'domina-el-seguimiento-1',
      lesson: '8.3',
      prompt: '¿Cuándo se cierra el siguiente paso?',
      options: ['Cuando ella escriba', 'Dentro de la llamada, con día y hora', 'En un correo de resumen', 'Cuando el CRM lo recuerde'],
      correct: 1,
      why: '8.1–8.3 (§13): el siguiente paso se cierra en la llamada, con día y hora. «Te escribo» o «ya te digo» no es un siguiente paso.',
    },
    {
      id: 'domina-el-seguimiento-2',
      lesson: '8.4',
      prompt: 'Confirmar la cita sirve para…',
      options: ['Rellenar el CRM', 'Reducir el no-show con un mensaje claro y una decisión', 'Vender antes de la llamada', 'Cambiar la hora si conviene'],
      correct: 1,
      why: '8.4 (§13): la confirmación existe para que la cita ocurra. Pide una decisión («¿cuento contigo el martes a las 10:00?»), no un «vale».',
    },
  ],

  comunicacion: [
    {
      id: 'comunicacion-1',
      lesson: '9.7',
      prompt: 'Después de pedir la decisión, el silencio…',
      options: ['Se rompe rápido para no incomodar', 'Se sostiene: quien habla primero suele rebajar lo pedido', 'Se llena con más argumentos', 'Solo vale en llamada en frío'],
      correct: 1,
      why: '9.7–9.9 (§4 y §11): el silencio es parte del cierre. Rellenarlo suele ser la forma más rápida de negociar contra ti misma.',
    },
    {
      id: 'comunicacion-2',
      lesson: '9.9',
      prompt: 'Escuchar y nombrar significa…',
      options: ['Repetir sus palabras como un loro', 'Devolver lo que ha dicho con sus palabras y preguntar', 'Contar tu propia experiencia', 'Darle la razón en todo'],
      correct: 1,
      why: '9.9 y 12.14 (§4): se devuelve la última frase con sus palabras y se pregunta sobre ella. Repetir sin preguntar no demuestra que hayas entendido.',
    },
  ],

  herramientas: [
    {
      id: 'herramientas-1',
      lesson: '8.5',
      prompt: '¿Para qué sirve el CRM en el seguimiento?',
      options: ['Para que ningún siguiente paso se pierda, con su fecha', 'Para guardar la transcripción de la llamada', 'Para calcular la comisión', 'Para enviar publicidad'],
      correct: 0,
      why: '8.5 y 10.2 (§13): el CRM sostiene las fases del seguimiento. Si el siguiente paso no está ahí con su fecha, no existe.',
    },
    {
      id: 'herramientas-2',
      lesson: '8.6',
      prompt: 'Las métricas de la closer sirven para…',
      options: ['Justificar el sueldo', 'Saber qué ajustar la semana siguiente', 'Compararte con otras closers', 'Rellenar el informe mensual'],
      correct: 1,
      why: '8.6 (§14): se miden para decidir qué cambiar. Una métrica que no cambia nada de lo que haces es un adorno.',
    },
  ],

  'captacion-de-proyectos': [
    {
      id: 'captacion-de-proyectos-1',
      lesson: '11.2',
      prompt: 'En una candidatura, ¿qué no se inventa?',
      options: ['Nada: ni experiencia, ni cifras, ni referencias', 'Solo el nombre de la empresa', 'Solo los resultados', 'Nada, se puede adornar un poco'],
      correct: 0,
      why: '11.2 y 11.8 (§15): la candidatura se apoya en lo que has hecho de verdad. Un dato inventado se cae en la primera entrevista y quema el contacto.',
    },
    {
      id: 'captacion-de-proyectos-2',
      lesson: '11.6',
      prompt: '¿Cómo se mide la captación?',
      options: ['Por sensaciones', 'Por lo que enviaste, lo que respondió y lo que agendó', 'Por los seguidores', 'Por el número de grupos a los que te unes'],
      correct: 1,
      why: '11.6 (§15): se mide el embudo —enviados, respuestas, entrevistas, propuestas—. Sin esos números, «voy a por todas» no se puede corregir.',
    },
  ],

  'clases-grupales': [
    {
      id: 'clases-grupales-1',
      lesson: '12.10',
      prompt: 'En un roleplay se evalúa…',
      options: ['Que ganes la conversación', 'La adherencia al método y la escucha', 'La velocidad al hablar', 'Que la clienta compre'],
      correct: 1,
      why: '12.10–12.35 (§16): el roleplay mide ejecución, no resultado. Ganar discutiendo no es cerrar; seguir el método con la clienta delante sí.',
    },
    {
      id: 'clases-grupales-2',
      lesson: '12.12',
      prompt: 'Después de un roleplay, el feedback útil es…',
      options: ['Una lista de diez fallos', 'Una corrección prioritaria y un drill para practicarla', 'Un «muy bien» sin más', 'Una nota sin explicación'],
      correct: 1,
      why: '§16 y 12.12: una sola corrección, la que más pesa, y una práctica concreta para las próximas 24 horas. Diez fallos a la vez no se corrigen.',
    },
  ],
};

/** Preguntas de un curso del Classroom, en su orden. Vacío si el curso no tiene repaso. */
export function quizFor(courseId: string): QuizQuestion[] {
  return QUIZ_BY_COURSE[courseId] ?? [];
}

/** Preguntas de repaso de todos los cursos: el resumen de la vista enseña el total. */
export const QUIZ_TOTAL = TRAINING_COURSES.reduce((sum, course) => sum + quizFor(course.id).length, 0);
