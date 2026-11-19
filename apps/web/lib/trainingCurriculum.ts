// Currículo de Formación: módulos → lecciones → recursos y tests didácticos.
// Fuente por defecto versionada en el repo; el importador de Excel/CSV puede sustituirla en la base de
// datos (migración `20261120_training_curriculum.sql`) sin tocar el código. La validación es pura y la
// comparten la app, el importador y las pruebas: una fila mal formada nunca se sirve a medias.
//
// Reglas editoriales: nada de cifras, casos o resultados inventados; los guiones usan huecos [así] y
// remiten al método ya existente (`trainingContent.ts`) para las explicaciones largas.

export type ResourceType = 'template' | 'script' | 'checklist' | 'link' | 'doc' | 'video';
export const RESOURCE_TYPES: ResourceType[] = ['template', 'script', 'checklist', 'link', 'doc', 'video'];
export const RESOURCE_LABELS: Record<ResourceType, string> = {
  template: 'Plantilla', script: 'Guion', checklist: 'Checklist', link: 'Enlace', doc: 'Documento', video: 'Vídeo',
};

export type CurriculumResource = {
  id: string;
  type: ResourceType;
  title: string;
  description: string;
  /** Enlace externo o interno; obligatorio en `link` y `video`. */
  url?: string;
  /** Contenido listo para copiar (plantillas, guiones, checklists). */
  content?: string;
};

export type CurriculumQuestion = {
  id: string;
  type: 'multiple' | 'true_false' | 'case';
  prompt: string;
  options: string[];
  /** Índice de la opción correcta (0-based en el código; el Excel acepta el texto exacto). */
  correct: number;
  explanation: string;
};

export type CurriculumLesson = {
  id: string;
  position: number;
  title: string;
  summary: string;
  minutes: number;
  content: string;
  key_points: string[];
  resources: CurriculumResource[];
  questions: CurriculumQuestion[];
};

export type CurriculumModule = {
  id: string;
  position: number;
  title: string;
  description: string;
  objectives: string[];
  /** Módulo de método ya existente que amplía esta lección (precall, logica, cierres, entrevista). */
  deep_dive?: string;
  lessons: CurriculumLesson[];
};

export type Curriculum = { version: string; modules: CurriculumModule[] };

export const SLUG = /^[a-z0-9][a-z0-9-]{1,60}$/;
const DEEP_DIVES = new Set(['precall', 'logica', 'freezing', 'yellows', 'star', 'cierres', 'descubrimiento', 'entrevista', 'certificacion']);
const isText = (value: unknown, min: number, max: number): value is string => typeof value === 'string' && value.trim().length >= min && value.trim().length <= max;
const isInt = (value: unknown, min: number, max: number): value is number => Number.isInteger(value) && (value as number) >= min && (value as number) <= max;
const isUrl = (value: string) => { try { const url = new URL(value); return url.protocol === 'http:' || url.protocol === 'https:'; } catch { return false; } };

export type Validation = { ok: true; value: Curriculum } | { ok: false; errors: string[] };

/** Valida el currículo entero. Devuelve TODOS los errores con su ruta para corregir el Excel de una vez. */
export function validateCurriculum(raw: unknown): Validation {
  const errors: string[] = [];
  const fail = (path: string, message: string) => errors.push(`${path}: ${message}`);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['currículo: se esperaba un objeto'] };
  const source = raw as Record<string, unknown>;
  if (!isText(source.version, 4, 40)) fail('version', 'falta la versión (por ejemplo 2026-11-20)');
  if (!Array.isArray(source.modules) || !source.modules.length) { fail('modules', 'no hay módulos'); return { ok: false, errors }; }
  if (source.modules.length > 20) fail('modules', 'demasiados módulos (máximo 20)');
  const moduleIds = new Set<string>(); const lessonIds = new Set<string>(); const resourceIds = new Set<string>(); const questionIds = new Set<string>();
  const positions = new Set<number>();
  source.modules.forEach((rawModule, moduleIndex) => {
    const path = `modules[${moduleIndex}]`;
    if (!rawModule || typeof rawModule !== 'object' || Array.isArray(rawModule)) { fail(path, 'se esperaba un objeto'); return; }
    const module = rawModule as Record<string, unknown>;
    if (!isText(module.id, 2, 61) || !SLUG.test(module.id)) fail(`${path}.id`, 'id inválido (minúsculas, números y guiones)');
    else if (moduleIds.has(module.id)) fail(`${path}.id`, 'id repetido');
    else moduleIds.add(module.id);
    if (!isInt(module.position, 1, 99)) fail(`${path}.position`, 'posición entera entre 1 y 99');
    else if (positions.has(module.position)) fail(`${path}.position`, 'posición repetida');
    else positions.add(module.position);
    if (!isText(module.title, 3, 120)) fail(`${path}.title`, 'título de 3 a 120 caracteres');
    if (!isText(module.description, 10, 600)) fail(`${path}.description`, 'descripción de 10 a 600 caracteres');
    if (!Array.isArray(module.objectives) || !module.objectives.length || module.objectives.length > 8) fail(`${path}.objectives`, 'entre 1 y 8 objetivos');
    else module.objectives.forEach((item, i) => { if (!isText(item, 3, 160)) fail(`${path}.objectives[${i}]`, 'objetivo de 3 a 160 caracteres'); });
    if (module.deep_dive !== undefined && (typeof module.deep_dive !== 'string' || !DEEP_DIVES.has(module.deep_dive))) fail(`${path}.deep_dive`, 'módulo de método desconocido');
    if (!Array.isArray(module.lessons) || !module.lessons.length || module.lessons.length > 12) { fail(`${path}.lessons`, 'entre 1 y 12 lecciones'); return; }
    module.lessons.forEach((rawLesson, lessonIndex) => {
      const lessonPath = `${path}.lessons[${lessonIndex}]`;
      if (!rawLesson || typeof rawLesson !== 'object' || Array.isArray(rawLesson)) { fail(lessonPath, 'se esperaba un objeto'); return; }
      const lesson = rawLesson as Record<string, unknown>;
      if (!isText(lesson.id, 2, 61) || !SLUG.test(lesson.id)) fail(`${lessonPath}.id`, 'id inválido');
      else if (lessonIds.has(lesson.id)) fail(`${lessonPath}.id`, 'id repetido');
      else lessonIds.add(lesson.id);
      if (!isInt(lesson.position, 1, 99)) fail(`${lessonPath}.position`, 'posición entera entre 1 y 99');
      if (!isText(lesson.title, 3, 140)) fail(`${lessonPath}.title`, 'título de 3 a 140 caracteres');
      if (!isText(lesson.summary, 10, 400)) fail(`${lessonPath}.summary`, 'resumen de 10 a 400 caracteres');
      if (!isInt(lesson.minutes, 1, 120)) fail(`${lessonPath}.minutes`, 'duración entera entre 1 y 120 minutos');
      if (!isText(lesson.content, 40, 4000)) fail(`${lessonPath}.content`, 'contenido de 40 a 4.000 caracteres');
      if (!Array.isArray(lesson.key_points) || !lesson.key_points.length || lesson.key_points.length > 6) fail(`${lessonPath}.key_points`, 'entre 1 y 6 ideas clave');
      else lesson.key_points.forEach((item, i) => { if (!isText(item, 3, 220)) fail(`${lessonPath}.key_points[${i}]`, 'idea de 3 a 220 caracteres'); });
      if (!Array.isArray(lesson.resources) || !lesson.resources.length) fail(`${lessonPath}.resources`, 'cada lección necesita al menos un recurso');
      else lesson.resources.forEach((rawResource, resourceIndex) => {
        const resourcePath = `${lessonPath}.resources[${resourceIndex}]`;
        if (!rawResource || typeof rawResource !== 'object' || Array.isArray(rawResource)) { fail(resourcePath, 'se esperaba un objeto'); return; }
        const resource = rawResource as Record<string, unknown>;
        if (!isText(resource.id, 2, 61) || !SLUG.test(resource.id)) fail(`${resourcePath}.id`, 'id inválido');
        else if (resourceIds.has(resource.id)) fail(`${resourcePath}.id`, 'id repetido');
        else resourceIds.add(resource.id);
        if (typeof resource.type !== 'string' || !RESOURCE_TYPES.includes(resource.type as ResourceType)) fail(`${resourcePath}.type`, 'tipo desconocido');
        if (!isText(resource.title, 3, 140)) fail(`${resourcePath}.title`, 'título de 3 a 140 caracteres');
        if (!isText(resource.description, 5, 300)) fail(`${resourcePath}.description`, 'descripción de 5 a 300 caracteres');
        const hasUrl = typeof resource.url === 'string' && resource.url.trim() !== '';
        const hasContent = typeof resource.content === 'string' && resource.content.trim().length >= 10;
        if (!hasUrl && !hasContent) fail(resourcePath, 'necesita URL o contenido');
        if (hasUrl && !isUrl(resource.url as string)) fail(`${resourcePath}.url`, 'URL http(s) no válida');
        if ((resource.type === 'link' || resource.type === 'video') && !hasUrl) fail(`${resourcePath}.url`, 'un enlace o vídeo necesita URL');
        if (hasContent && (resource.content as string).length > 4000) fail(`${resourcePath}.content`, 'contenido máximo de 4.000 caracteres');
      });
      if (!Array.isArray(lesson.questions) || lesson.questions.length < 1 || lesson.questions.length > 8) fail(`${lessonPath}.questions`, 'entre 1 y 8 preguntas');
      else lesson.questions.forEach((rawQuestion, questionIndex) => {
        const questionPath = `${lessonPath}.questions[${questionIndex}]`;
        if (!rawQuestion || typeof rawQuestion !== 'object' || Array.isArray(rawQuestion)) { fail(questionPath, 'se esperaba un objeto'); return; }
        const question = rawQuestion as Record<string, unknown>;
        if (!isText(question.id, 2, 61) || !SLUG.test(question.id)) fail(`${questionPath}.id`, 'id inválido');
        else if (questionIds.has(question.id)) fail(`${questionPath}.id`, 'id repetido');
        else questionIds.add(question.id);
        if (!['multiple', 'true_false', 'case'].includes(String(question.type))) fail(`${questionPath}.type`, 'tipo desconocido');
        if (!isText(question.prompt, 10, 500)) fail(`${questionPath}.prompt`, 'enunciado de 10 a 500 caracteres');
        if (!Array.isArray(question.options) || question.options.length < 2 || question.options.length > 6) fail(`${questionPath}.options`, 'entre 2 y 6 opciones');
        else {
          if (new Set(question.options.map(String)).size !== question.options.length) fail(`${questionPath}.options`, 'opciones repetidas');
          question.options.forEach((option, i) => { if (!isText(option, 1, 220)) fail(`${questionPath}.options[${i}]`, 'opción de 1 a 220 caracteres'); });
        }
        if (!isInt(question.correct, 0, Array.isArray(question.options) ? question.options.length - 1 : 0)) fail(`${questionPath}.correct`, 'la respuesta correcta no está entre las opciones');
        if (!isText(question.explanation, 20, 800)) fail(`${questionPath}.explanation`, 'explicación de 20 a 800 caracteres');
      });
    });
  });
  return errors.length ? { ok: false, errors } : { ok: true, value: raw as Curriculum };
}

export const lessonsOf = (curriculum: Curriculum) => curriculum.modules.flatMap(module => module.lessons.map(lesson => ({ module, lesson })));
export const TOTAL_LESSONS = (curriculum: Curriculum) => lessonsOf(curriculum).length;
export const resourcesOf = (curriculum: Curriculum) => curriculum.modules.flatMap(module => module.lessons.flatMap(lesson => lesson.resources.map(resource => ({ module, lesson, resource }))));

// ---- Currículo por defecto (mismo contenido que la plantilla de Excel) ------
// Cada módulo conecta con una pieza del método ya existente para ampliar la explicación sin
// duplicarla; las lecciones nuevas convierten ese método en una ruta corta con recursos y test.

export const DEFAULT_CURRICULUM: Curriculum = {
  version: '2026-11-20',
  modules: [
    {
      id: 'fundamentos',
      position: 1,
      title: 'Fundamentos y apertura',
      description: 'La base de una llamada que no parece una venta: identidad, pre-llamada y una apertura con prueba, promesa y plan.',
      objectives: ['Entrar en la llamada con tono de igual a igual', 'Escribir la secuencia de pre-llamada', 'Abrir con una agenda clara en 15-20 segundos'],
      deep_dive: 'precall',
      lessons: [
        {
          id: 'fundamentos-identidad',
          position: 1,
          title: 'Tu identidad de closer',
          summary: 'Qué defiende una closer y qué no: curiosidad, criterio y cero sumisión.',
          minutes: 8,
          content: 'Una closer no entra a agradar: entra a entender si puede ayudar y a decirlo con claridad. El tono es de igual a igual. No pides perdón por llamar, no justificas tu existencia y no conviertes la llamada en un examen que tienes que aprobar.\n\nLa diferencia se nota en las primeras frases. «Perdona que te moleste» coloca a la otra persona por encima y te obliga a recuperar un terreno que ya cediste. «Te llamo porque vi algo en tu caso y quiero comprobar si encaja» sitúa la conversación en un intercambio entre adultas.\n\nTu trabajo no es empujar a nadie: es hacer preguntas que ordenen su situación y decir la verdad sobre lo que ves. Si no encaja, lo dices y sales con la misma dignidad con la que entraste.',
          key_points: ['El tono de igual a igual se elige antes de hablar.', 'Pedir permiso para preguntar no es pedir perdón por existir.', 'Decir que no encaja también es parte del trabajo.'],
          resources: [
            {
              id: 'res-identidad-checklist', type: 'checklist', title: 'Checklist de tono y marco',
              description: 'Cinco comprobaciones antes de marcar el número.',
              content: '1. ¿Sé por qué esta persona está en la llamada?\n2. ¿He evitado disculparme por llamar?\n3. ¿Tengo una pregunta preparada para abrir, no un discurso?\n4. ¿Sé qué haré si no encaja?\n5. ¿He reservado un minuto para apuntar lo que escuche?',
            },
          ],
          questions: [
            {
              id: 'fundamentos-identidad-q1', type: 'multiple',
              prompt: '¿Cuál de estas aperturas mantiene un tono de igual a igual?',
              options: ['«Perdona que te moleste, solo seré un momento.»', '«Te llamo porque vi algo en tu caso y quiero comprobar si encaja.»', '«No sé si esto te interesará, pero por probar…»', '«Me han dicho que necesitas ayuda, ¿verdad?»'],
              correct: 1,
              explanation: 'La segunda frase explica el motivo y propone comprobar el encaje sin colocarse por debajo ni suponer lo que la otra persona necesita.',
            },
            {
              id: 'fundamentos-identidad-q2', type: 'true_false',
              prompt: 'Si la persona no encaja con el servicio, la closer debe sostener la llamada hasta el final de todos modos.',
              options: ['Verdadero', 'Falso'],
              correct: 1,
              explanation: 'Descalificar con claridad cuando no hay encaje es parte del método: seguir empujando solo produce una venta forzada o un rechazo más largo.',
            },
          ],
        },
        {
          id: 'fundamentos-pre-llamada',
          position: 2,
          title: 'Pre-llamada que llena la agenda',
          summary: 'Los seis momentos entre agendar y entrar en la llamada, con una salida digna.',
          minutes: 10,
          content: 'La conversación empieza días antes. Una cita a 24 horas se cae mucho menos que una a siete días: agenda entre uno y dos días y vende la llamada en el primer mensaje con tres razones concretas para asistir.\n\nLa secuencia tiene seis momentos: confirmación inmediata con material, presentación personal, vídeo corto la noche anterior, prueba social la mañana de la cita, confirmación logística una hora antes y última confirmación con enlace quince minutos antes. En cada uno hay una acción concreta, no un recordatorio vacío.\n\nEl material preparatorio sirve para matar objeciones antes de que nazcan. Si siembras la objeción de pareja o de dinero antes del precio, cuando aparezca ya tendrás una conversación empezada. Y si la persona no puede asistir, dale una salida digna: reprogramar no es perder, es evitar una llamada vacía.',
          key_points: ['Agenda a 24-48 horas, no a una semana.', 'Cada mensaje pide o confirma algo concreto.', 'La salida digna protege la cita siguiente.'],
          resources: [
            {
              id: 'res-pre-llamada-guion', type: 'script', title: 'Secuencia de seis mensajes',
              description: 'Guion base con huecos para adaptar al caso, sin cifras inventadas.',
              content: '1. Confirmación: «Cita confirmada, [día] a las [hora]. Tres cosas para que aproveches la llamada: 1) [razón concreta], 2) [razón concreta], 3) saldrás con tu siguiente paso. Te dejo la tarea preparatoria: [enlace].»\n2. Presentación: «Soy [nombre], la persona con la que hablarás. Me alegra que hayas dado el paso. Si tienes dudas antes, escríbeme por aquí.»\n3. Noche anterior: vídeo corto y personal: «Mañana a las [hora] nos vemos. He visto tu caso y tengo ideas concretas para [tema].»\n4. Mañana: «Te dejo un caso parecido al tuyo: [caso real o ejemplo sin cifras inventadas]. Mañana te cuento cómo lo abordamos.»\n5. Una hora antes: «Nos vemos en una hora. ¿Prefieres [enlace A] o [enlace B]? Confírmame y te lo paso.»\n6. Quince minutos antes: «Entrando a la sala: [enlace]. Si algo surgió, avísame y reprogramamos; si estás lista, nos vemos en cinco minutos.»',
            },
            {
              id: 'res-pre-llamada-checklist', type: 'checklist', title: 'Checklist de show-rate',
              description: 'Lo que revisa una closer antes de dar la cita por buena.',
              content: '· Cita a 24-48 horas.\n· Tres razones para asistir en el primer mensaje.\n· Presentación personal con nombre.\n· Material que responda a una objeción probable.\n· Confirmación logística con enlace.\n· Salida digna si no puede.',
            },
          ],
          questions: [
            {
              id: 'fundamentos-pre-llamada-q1', type: 'multiple',
              prompt: '¿Qué diferencia principal hay entre un recordatorio y un mensaje de pre-llamada?',
              options: ['El recordatorio es más largo.', 'El mensaje de pre-llamada vende la llamada y pide una acción concreta.', 'El recordatorio se manda solo por correo.', 'No hay diferencia: los dos sirven igual.'],
              correct: 1,
              explanation: 'El mensaje de pre-llamada tiene un objetivo: dar razones para asistir, humanizar o confirmar logística. El recordatorio solo informa de una hora.',
            },
            {
              id: 'fundamentos-pre-llamada-q2', type: 'case',
              prompt: 'La cita es mañana y la persona no ha confirmado el enlace. ¿Qué haces una hora antes?',
              options: ['Esperar en silencio a que aparezca.', 'Mandarle el enlace y preguntarle qué plataforma prefiere, con opción de reprogramar.', 'Cancelar la cita por falta de respuesta.', 'Llamarla insistiendo en que asistir es obligatorio.'],
              correct: 1,
              explanation: 'La confirmación logística reduce ausencias y ofrece una salida digna. Insistir o cancelar convierte una duda en una barrera.',
            },
          ],
        },
        {
          id: 'fundamentos-apertura',
          position: 3,
          title: 'Apertura con prueba, promesa y plan',
          summary: 'Los primeros 15-20 segundos: por qué está en la llamada, una prueba breve y el plan.',
          minutes: 8,
          content: 'La apertura no es un discurso de presentación: es una agenda. En 15-20 segundos dices por qué estáis hablando, das una prueba breve de que has entendido su caso y explicas qué vais a hacer juntas.\n\nUsa las notas previas. Si ya contó su situación en el formulario, no le hagas repetirla: «Vi que [situación concreta]; por eso te propongo [plan]». Eso demuestra que la llamada es para ella y no una plantilla.\n\nLa promesa no es un resultado garantizado: es lo que saldrá de la conversación. «Saldrás sabiendo [decisión o siguiente paso]» es una promesa honesta. Después pide permiso para preguntar y empieza el descubrimiento.',
          key_points: ['La apertura es una agenda, no una presentación.', 'La prueba demuestra que has leído su caso.', 'La promesa describe la conversación, no un resultado garantizado.'],
          resources: [
            {
              id: 'res-apertura-plantilla', type: 'template', title: 'Plantilla de apertura en tres frases',
              description: 'Rellena los huecos con lo que ya sabes de su caso.',
              content: '«[Nombre], te llamo porque [motivo concreto que ella dio o que consta en las notas]. Vi que [situación/prueba breve], así que hoy quiero entender [tema] y que salgas con [decisión o siguiente paso]. ¿Te parece si empiezo preguntándote [primera pregunta]?»',
            },
          ],
          questions: [
            {
              id: 'fundamentos-apertura-q1', type: 'multiple',
              prompt: '¿Qué contiene una apertura completa según el método?',
              options: ['Saludo, precio y descuento.', 'Motivo, prueba breve del caso y plan de la llamada.', 'Una presentación de la empresa de cinco minutos.', 'Tres preguntas de calificación seguidas.'],
              correct: 1,
              explanation: 'La apertura ordena la llamada: por qué estáis hablando, una prueba de que conoces su caso y lo que vais a hacer. El precio no va aquí.',
            },
            {
              id: 'fundamentos-apertura-q2', type: 'true_false',
              prompt: 'Si ya contó su situación en el formulario, la closer debe pedirle que la repita al empezar.',
              options: ['Verdadero', 'Falso'],
              correct: 1,
              explanation: 'Repetir lo que ya contó hace que la llamada parezca una plantilla. Se usan las notas previas y se confirma con una pregunta nueva.',
            },
          ],
        },
      ],
    },
    {
      id: 'descubrimiento',
      position: 2,
      title: 'Descubrimiento y brecha',
      description: 'Preguntar antes de presentar, cuantificar el coste de seguir igual y cualificar sin interrogar.',
      objectives: ['Abrir con preguntas de situación y dolor', 'Resumir y etiquetar el hueco', 'Calcular el coste de inacción con sus cifras', 'Recoger BANT antes de hablar de dinero'],
      deep_dive: 'logica',
      lessons: [
        {
          id: 'descubrimiento-preguntar',
          position: 1,
          title: 'Preguntar antes de presentar',
          summary: 'Clarify, label y pain cycle: el orden que evita vender a ciegas.',
          minutes: 10,
          content: 'Presentar antes de descubrir es adivinar. La secuencia empieza por aclarar qué le hizo pedir la llamada, sigue con el hueco entre dónde está y dónde quiere estar, y termina con el coste de no actuar.\n\nClarify: «¿Qué te hizo buscar esto ahora?». Label: «Suena como que [emoción o situación]». Pain cycle: «¿Qué pasa si dentro de seis meses sigue igual?». No son preguntas para rellenar un formulario: son preguntas que le obligan a decir en voz alta lo que ya sabe.\n\nDespués resumes con sus palabras y pides confirmación. Si el resumen no es correcto, ella lo corrige: eso también es descubrimiento. Nunca discutas una corrección; agrégala.',
          key_points: ['Primero aclarar, después etiquetar y por último llevar al coste.', 'El resumen se hace con sus palabras, no con las tuyas.', 'Una corrección de la clienta es información, no un ataque.'],
          resources: [
            {
              id: 'res-descubrimiento-guion', type: 'script', title: 'Guion de descubrimiento en cuatro preguntas',
              description: 'Una secuencia corta para no disparar a ciegas.',
              content: '1. «¿Qué te hizo buscar [servicio] ahora y no hace seis meses?»\n2. «¿Dónde estás hoy con [tema] y dónde quieres estar?»\n3. «¿Qué te impide llegar ahí por tu cuenta?»\n4. «Si dentro de seis meses todo sigue igual, ¿qué habrá pasado?»\nDespués: «Déjame ver si lo entiendo: [resumen con sus palabras]. ¿Es eso?»',
            },
          ],
          questions: [
            {
              id: 'descubrimiento-preguntar-q1', type: 'multiple',
              prompt: '¿Cuál es el orden correcto del descubrimiento?',
              options: ['Presentar → preguntar → cerrar', 'Aclarar → etiquetar → llevar al coste → resumir', 'Precio → objeciones → preguntas', 'Calificar → presentar → descalificar'],
              correct: 1,
              explanation: 'El descubrimiento va de lo que ya sabe (clarify) a lo que siente (label) y a lo que cuesta seguir igual (pain cycle), cerrando con un resumen confirmado.',
            },
            {
              id: 'descubrimiento-preguntar-q2', type: 'case',
              prompt: 'La clienta corrige tu resumen: «No, no es miedo, es que ya no confío en mi equipo». ¿Qué haces?',
              options: ['Defender tu resumen anterior.', 'Aceptar la corrección y preguntar qué ha pasado con el equipo.', 'Volver al precio.', 'Cambiar de tema para no incomodar.'],
              correct: 1,
              explanation: 'La corrección es información nueva. Aceptarla y profundizar mantiene el descubrimiento en sus palabras y evita una objeción futura.',
            },
          ],
        },
        {
          id: 'descubrimiento-coste',
          position: 2,
          title: 'Cuantificar el coste de seguir igual',
          summary: 'La brecha, el coste y el silencio después del número.',
          minutes: 10,
          content: 'La venta lógica no consiste en decir un precio más alto: consiste en poner dos caminos delante. Uno, seguir como ahora. Dos, cambiar. La diferencia entre los dos, en el horizonte que ella misma ha dicho, es el coste de inacción.\n\nHaz la cuenta con sus cifras, no con las tuyas. Si no tiene una cifra, no la inventes: pregunta qué dato le falta y trabaja con un rango declarado. Después de soltar el número, guarda silencio. Ni «¿qué te parece?» ni «¿cómo lo ves?». Quien habla primero después del precio suele ser quien lo rebaja.\n\nEl cierre de este paso es una disyuntiva honesta: «Tú decides: seguir igual o empezar». No es una amenaza; es devolverle la decisión que ya estaba tomando.',
          key_points: ['Usa sus cifras y declara cuando falta un dato.', 'Después del número, silencio.', 'La disyuntiva devuelve la decisión, no la impone.'],
          resources: [
            {
              id: 'res-coste-plantilla', type: 'template', title: 'Plantilla de coste de inacción',
              description: 'Tres datos y una frase; sin cifras inventadas.',
              content: 'Dato 1: ingreso actual [importe/mes].\nDato 2: objetivo [importe/mes] en [plazo].\nBrecha mensual: [objetivo − actual].\nCoste en el plazo: [brecha × meses].\nFrase: «Tienes dos caminos. Uno: seguir como ahora. Dos: cerrar la brecha de [brecha] al mes. En [plazo], la diferencia entre los dos caminos es [coste]. Tú decides.»\nDespués: silencio.',
            },
          ],
          questions: [
            {
              id: 'descubrimiento-coste-q1', type: 'multiple',
              prompt: 'Acabas de decir el coste de inacción. ¿Qué haces inmediatamente después?',
              options: ['Explicar por qué el número es alto.', 'Guardar silencio.', 'Preguntar «¿qué te parece?».', 'Ofrecer una rebaja.'],
              correct: 1,
              explanation: 'El silencio deja que la propia clienta procese el número. Rellenarlo con justificaciones o una pregunta de aprobación debilita el marco.',
            },
            {
              id: 'descubrimiento-coste-q2', type: 'true_false',
              prompt: 'Si la clienta no tiene una cifra de ingresos, la closer puede estimarla para que la cuenta salga.',
              options: ['Verdadero', 'Falso'],
              correct: 1,
              explanation: 'No se inventan cifras. Se declara el dato que falta y se trabaja con lo que ella pueda confirmar, aunque sea un rango.',
            },
          ],
        },
        {
          id: 'descubrimiento-bant',
          position: 3,
          title: 'BANT antes del precio',
          summary: 'Presupuesto, autoridad, necesidad y momento: qué preguntar y cuándo parar.',
          minutes: 8,
          content: 'BANT no es un interrogatorio: es una forma de no cerrar a ciegas. Presupuesto, autoridad, necesidad y momento se recogen durante el descubrimiento, antes de pedir dinero.\n\nPresupuesto: «¿Qué margen tienes pensado para resolver esto?». Autoridad: «¿Hay alguien más que tenga que estar de acuerdo?». Necesidad: «¿Qué pasa si no lo resuelves?». Momento: «¿Para cuándo necesitas que esté funcionando?». Cada respuesta se apunta con una cita, no con una interpretación.\n\nSi falta una letra, no significa que la venta esté muerta: significa que todavía no sabes si está viva. Pregunta antes de presentar y decide después si merece la pena seguir. La decisión de avanzar o parar también se declara.',
          key_points: ['BANT se recoge antes del precio.', 'Cada letra lleva una cita, no una suposición.', 'Si falta información, se pregunta; no se rellena.'],
          resources: [
            {
              id: 'res-bant-checklist', type: 'checklist', title: 'Checklist BANT con evidencia',
              description: 'Cuatro letras, una cita y una decisión.',
              content: '· Presupuesto: ¿qué margen tiene? Cita: «…»\n· Autoridad: ¿decide sola? Cita: «…»\n· Necesidad: ¿qué pasa si no lo resuelve? Cita: «…»\n· Momento: ¿para cuándo? Cita: «…»\nDecisión: avanzar / parar / faltan datos. Si faltan, la siguiente pregunta es…',
            },
          ],
          questions: [
            {
              id: 'descubrimiento-bant-q1', type: 'multiple',
              prompt: '¿Cuándo se recoge BANT?',
              options: ['Después de dar el precio.', 'Durante el descubrimiento, antes de hablar de dinero.', 'Solo si la clienta pregunta por el precio.', 'Al final, cuando ya ha dicho que sí.'],
              correct: 1,
              explanation: 'BANT sirve para decidir si la conversación puede avanzar. Recogerlo después del precio convierte la cualificación en una excusa para el no.',
            },
            {
              id: 'descubrimiento-bant-q2', type: 'case',
              prompt: 'La clienta dice: «Tendría que hablarlo con mi socio». ¿Qué letra de BANT está en duda?',
              options: ['Presupuesto', 'Autoridad', 'Necesidad', 'Momento'],
              correct: 1,
              explanation: 'La autoridad es la capacidad de decir que sí sin consultar a un tercero. Si hay socio, toca aclarar quién decide y cómo se incorpora a la conversación.',
            },
          ],
        },
      ],
    },
    {
      id: 'cierre',
      position: 3,
      title: 'Objeciones y cierre',
      description: 'Aislar la objeción real, validar sin «pero», elegir el cierre y sostener el siguiente paso.',
      objectives: ['Aislar y validar una objeción', 'Elegir el cierre que pide la llamada', 'Pedir la venta y sostener el silencio', 'Cerrar con día y hora'],
      deep_dive: 'cierres',
      lessons: [
        {
          id: 'cierre-objeciones',
          position: 1,
          title: 'Aislar y validar sin «pero»',
          summary: 'La objeción que oyes casi nunca es la objeción que frena la decisión.',
          minutes: 10,
          content: 'Antes de responder una objeción, aísla: «Además de eso, ¿hay algo más que te impida decidir?». Si hay otra cosa, esa es la objeción real. Responder a la primera sin aislar es disparar a un blanco que se mueve.\n\nDespués valida con «y», nunca con «pero». «Entiendo que el precio te preocupa, y al mismo tiempo lo que me contaste antes era [coste]». El «pero» borra lo anterior; el «y» sostiene las dos cosas y permite avanzar.\n\nNo defiendas el producto, no justifiques el precio y no expliques lo buena que eres. Devuelve una pregunta que haga pensar: «¿Qué tendría que pasar para que esto tuviera sentido para ti?».',
          key_points: ['Aísla antes de responder.', 'Valida con «y», no con «pero».', 'Una pregunta devuelve la conversación a la clienta.'],
          resources: [
            {
              id: 'res-objeciones-tabla', type: 'doc', title: 'Tabla de objeciones y respuesta',
              description: 'Las cinco objeciones más comunes, con qué preguntar antes de rebatir.',
              content: '· «Es caro» → «¿Con qué lo estás comparando?» → reencuadre de valor.\n· «Tengo que hablarlo con mi pareja» → «¿Qué necesitas de esa conversación?» → apoyo, no permiso.\n· «Ya lo intenté y no funcionó» → «¿Qué faltó la última vez?» → no quemarse dos veces.\n· «No es el momento» → «¿Qué tendría que cambiar para que lo fuera?» → momento real.\n· «No confío en los cursos» → «¿Qué tendría que ser distinto para que confiaras?» → prueba concreta.',
            },
          ],
          questions: [
            {
              id: 'cierre-objeciones-q1', type: 'multiple',
              prompt: '¿Cuál es la forma correcta de validar una objeción?',
              options: ['«Entiendo, pero…»', '«Entiendo que lo veas así, y al mismo tiempo…»', '«Eso no es cierto.»', '«Todos mis clientes pensaban lo mismo.»'],
              correct: 1,
              explanation: 'El «y al mismo tiempo» sostiene la objeción y abre el reencuadre. El «pero» la borra y suele activar defensa.',
            },
            {
              id: 'cierre-objeciones-q2', type: 'case',
              prompt: 'La clienta dice que es caro. ¿Qué haces primero?',
              options: ['Bajar el precio.', 'Preguntar con qué lo está comparando.', 'Explicar todas las características.', 'Cerrar con una disyuntiva.'],
              correct: 1,
              explanation: 'Aislar la objeción empieza por entender contra qué compara. Sin ese dato, cualquier respuesta es una suposición.',
            },
          ],
        },
        {
          id: 'cierre-elegir',
          position: 2,
          title: 'Elegir el cierre que pide la llamada',
          summary: 'No todos los cierres sirven para todas las objeciones.',
          minutes: 12,
          content: 'Un cierre es una frase que ayuda a decidir, no un truco para empujar. La biblioteca del método tiene diez: desde presentar el precio como decidido hasta normalizar los nervios o explicar el mecanismo.\n\nLa clave es elegir según lo que acaba de decir la clienta. Si invoca a su pareja, el cierre es apoyo, no permiso. Si dice que es mucho dinero, el cierre reencuadra el valor. Si necesita entender el sistema, el cierre muestra el mecanismo. Si duda en el último segundo, el cierre recuerda lo cerca que está.\n\nNo encadenes cinco cierres. Elige uno, dilo con calma y deja espacio. Si no funciona, vuelve a preguntar antes de probar otro: la objeción cambió o no era la real.',
          key_points: ['El cierre se elige por la objeción, no por costumbre.', 'Un cierre se dice y se sostiene; no se encadenan.', 'Si no funciona, vuelve a preguntar.'],
          resources: [
            {
              id: 'res-cierres-biblioteca', type: 'doc', title: 'Biblioteca de diez cierres',
              description: 'Fórmula, cuándo usarlo y un ejemplo sin importes inventados.',
              content: '1. Decadere: «El programa son [importe]. El proceso te lo envío ahora.»\n2. Closer or Further: «¿Esta conversación nos acerca a empezar o nos aleja?»\n3. Six Inches: «Estás a un paso; lo único que falta es decidir.»\n4. Support Not Permission: «No necesitas permiso, necesitas apoyo.»\n5. It\'s Good That It\'s A Lot: «Que sea mucho es buena señal: refleja el valor.»\n6. Some Now, More Later: «Puedes empezar con [parte] y sumar el resto en [plazo].»\n7. Don\'t Burn Twice: «No dejes que te queme dos veces; esta vez hay acompañamiento.»\n8. 1-10: «Del 1 al 10, ¿dónde estás? Si es menos de 7, no es para ti.»\n9. Nervousness: «Los nervios significan que esto te importa.»\n10. Mechanic: «Semana 1 [hito], semana 2 [hito], semana 3 [medición].»',
            },
          ],
          questions: [
            {
              id: 'cierre-elegir-q1', type: 'case',
              prompt: '«Me encanta, pero tengo que hablarlo con mi pareja antes de decidir.» ¿Qué cierre pide?',
              options: ['1-10', 'Apoyo, no permiso', 'Mecanismo', 'Nervios'],
              correct: 1,
              explanation: 'La objeción invoca a un tercero. El cierre devuelve la agencia: necesita apoyo para decidir, no un permiso que la convierta en mensajera.',
            },
            {
              id: 'cierre-elegir-q2', type: 'multiple',
              prompt: 'Después de usar un cierre, la clienta sigue dudando. ¿Qué haces?',
              options: ['Encadenar tres cierres más.', 'Volver a preguntar qué frena la decisión.', 'Bajar el precio.', 'Dar por perdida la venta.'],
              correct: 1,
              explanation: 'Si el cierre no mueve la decisión, la objeción real sigue sin aparecer. Preguntar otra vez evita acumular presión sin información.',
            },
          ],
        },
        {
          id: 'cierre-siguiente',
          position: 3,
          title: 'Pedir, callar y siguiente paso',
          summary: 'El precio, el silencio y un día y una hora; «ya te escribo» no es un cierre.',
          minutes: 8,
          content: 'Pedir la venta es una frase corta y directa: «¿Empezamos?». No es una sugerencia ni una pregunta retórica. Después del precio, el silencio es parte del cierre: sostenerlo no es perder el control, es dar tiempo a decidir.\n\nSi la respuesta es no, vuelve a pedir una vez con una decisión pequeña: una llamada, una fecha, un siguiente paso. Si sigue siendo no, agenda la siguiente conversación dentro de la llamada, con día y hora. «Te mando información» o «ya te escribo» no es un siguiente paso: es una forma educada de desaparecer.\n\nEl handshake cierra el bucle: repite lo acordado, confirma quién hace qué y cuándo, y despídete sin seguir vendiendo después del sí.',
          key_points: ['Pide la venta con una frase directa.', 'El silencio después del precio forma parte del cierre.', 'Un siguiente paso tiene día y hora, no «ya te escribo».'],
          resources: [
            {
              id: 'res-cierre-checklist', type: 'checklist', title: 'Checklist del cierre',
              description: 'Lo que debe existir antes de colgar.',
              content: '· ¿He pedido la venta con una frase clara?\n· ¿He sostenido el silencio después del precio?\n· ¿He vuelto a pedir tras el primer no?\n· ¿Hay día y hora para el siguiente paso?\n· ¿He repetido lo acordado y quién hace qué?\n· ¿He dejado de vender después del sí?',
            },
          ],
          questions: [
            {
              id: 'cierre-siguiente-q1', type: 'multiple',
              prompt: '¿Cuál de estos es un siguiente paso real?',
              options: ['«Te mando información y ya hablamos.»', '«Te escribo la semana que viene.»', '«¿Te va bien el jueves a las 10:00?»', '«Piénsalo y me dices.»'],
              correct: 2,
              explanation: 'Un siguiente paso tiene día y hora y queda cerrado dentro de la llamada. Las otras frases dejan la decisión en el aire.',
            },
            {
              id: 'cierre-siguiente-q2', type: 'true_false',
              prompt: 'Después de que la clienta dice que sí, conviene seguir explicando el producto para reforzar la decisión.',
              options: ['Verdadero', 'Falso'],
              correct: 1,
              explanation: 'Seguir vendiendo después del sí reabre una decisión ya tomada y puede generar dudas nuevas. Toca confirmar el siguiente paso y cerrar.',
            },
          ],
        },
      ],
    },
    {
      id: 'aplicacion',
      position: 4,
      title: 'Práctica, entrevista y aplicación',
      description: 'Convertir el método en candidaturas reales: formulario, entrevista y un hábito semanal sostenible.',
      objectives: ['Preparar el formulario y el mensaje de candidatura', 'Responder una entrevista comercial con evidencia', 'Sostener un hábito semanal de práctica y aplicación'],
      deep_dive: 'entrevista',
      lessons: [
        {
          id: 'aplicacion-candidatura',
          position: 1,
          title: 'Preparar la candidatura en 20 minutos',
          summary: 'Formulario base, mensaje y revisión antes de enviar.',
          minutes: 12,
          content: 'La mayoría de formularios piden lo mismo. Rellena una vez tu formulario base con datos reales, guarda los enlaces a tu CV y a tu vídeo, y tendrás el 80 % del trabajo hecho para cada oferta.\n\nEl mensaje de candidatura no es una carta genérica: conecta lo que pide el anuncio con una prueba tuya. Una frase de contexto, una prueba concreta y un siguiente paso. Si no tienes un dato, no lo inventes: usa el hueco [así] y explícalo en la entrevista.\n\nAntes de enviar, revisa tres cosas: que el enlace del CV abre sin permiso, que el mensaje nombra el puesto y que has apuntado la oferta en tu tablero. Enviar sin registrar es perder el seguimiento.',
          key_points: ['Un formulario base evita repetir trabajo en cada oferta.', 'El mensaje conecta el anuncio con una prueba real.', 'Toda candidatura enviada se registra en el tablero.'],
          resources: [
            {
              id: 'res-candidatura-checklist', type: 'checklist', title: 'Checklist antes de enviar',
              description: 'Tres minutos que evitan una candidatura perdida.',
              content: '· El enlace del CV abre con «cualquiera con el enlace».\n· El mensaje nombra el puesto y la empresa.\n· Hay una prueba concreta, sin cifras inventadas.\n· He revisado faltas y datos de contacto.\n· He registrado la oferta en mi tablero.\n· Sé cuándo haré seguimiento.',
            },
            {
              id: 'res-candidatura-plantilla', type: 'template', title: 'Plantilla de mensaje de candidatura',
              description: 'Contexto, prueba y siguiente paso; sin promesas vacías.',
              content: 'Hola, equipo de [empresa]:\n\nMe interesa el puesto de [título] porque [motivo concreto del anuncio].\n\nEn [situación] hice [acción] y conseguí [resultado real o aprendizaje verificable].\n\nQuedo a vuestra disposición para [siguiente paso: llamada, prueba, entrevista].\n\nUn saludo,\n[nombre]',
            },
          ],
          questions: [
            {
              id: 'aplicacion-candidatura-q1', type: 'multiple',
              prompt: '¿Qué debe llevar el mensaje de candidatura?',
              options: ['Todas tus aptitudes en una lista.', 'Contexto del puesto, una prueba concreta y un siguiente paso.', 'Solo el CV adjunto.', 'Una disculpa por no tener experiencia.'],
              correct: 1,
              explanation: 'El mensaje breve conecta el anuncio con una prueba real y propone un siguiente paso. Las listas de aptitudes no demuestran nada por sí solas.',
            },
            {
              id: 'aplicacion-candidatura-q2', type: 'true_false',
              prompt: 'Si no tienes una cifra de resultado, puedes inventar una aproximación para que el mensaje suene mejor.',
              options: ['Verdadero', 'Falso'],
              correct: 1,
              explanation: 'No se inventan cifras. Se usa un resultado verificable o se explica el aprendizaje con un hueco honesto; la entrevista siempre puede comprobarlo.',
            },
          ],
        },
        {
          id: 'aplicacion-entrevista',
          position: 2,
          title: 'La entrevista comercial',
          summary: 'STAR, evidencia y las preguntas que casi siempre caen.',
          minutes: 12,
          content: 'En una entrevista comercial no evalúan si recitas el método: evalúan si puedes contar lo que has hecho con evidencia y si sabes escuchar. La estructura STAR te ayuda a no perderte: situación, timing, autoridad y recursos.\n\nCuando te pregunten por experiencia, usa rol → qué vendías y a quién → un resultado propio → por qué estás aquí. Cuando te pregunten por una objeción difícil, cuenta qué preguntaste antes de rebatir y qué harías distinto. Cuando te pregunten por presión, muestra el hábito que usas después de un no.\n\nTen preparadas dos preguntas propias sobre cómo se mide el éxito y de dónde vienen los leads. Las preguntas dicen más de tu criterio que muchas respuestas. Y no hables mal de nadie: es la bandera roja más citada.',
          key_points: ['Usa STAR para ordenar la evidencia.', 'Cuenta qué preguntaste, no solo qué respondiste.', 'Lleva dos preguntas propias preparadas.'],
          resources: [
            {
              id: 'res-entrevista-guion', type: 'script', title: 'Guion de respuesta con STAR',
              description: 'Una estructura para cualquier pregunta de experiencia.',
              content: 'Situación: «En [contexto], mi trabajo era [responsabilidad].»\nTiming: «El reto era [por qué ahora / qué urgencia].»\nAutoridad: «Yo decidía [parte] y coordinaba con [quién].»\nRecursos: «Contaba con [herramientas/equipo] y [restricción].»\nResultado: «Conseguí [resultado verificable]. Lo que haría distinto: [aprendizaje].»',
            },
          ],
          questions: [
            {
              id: 'aplicacion-entrevista-q1', type: 'multiple',
              prompt: '¿Qué significa la A de STAR?',
              options: ['Actitud', 'Autoridad para decidir', 'Aprendizaje', 'Agenda'],
              correct: 1,
              explanation: 'En STAR, la autoridad comprueba si la persona podía decidir o si dependía de un tercero. Es una señal de cualificación, no de personalidad.',
            },
            {
              id: 'aplicacion-entrevista-q2', type: 'case',
              prompt: 'Te preguntan por tu peor experiencia con un jefe. ¿Qué haces?',
              options: ['Criticar a tu jefe anterior con detalle.', 'Contar el conflicto sin nombres, qué hiciste y qué aprendiste.', 'Decir que nunca has tenido problemas.', 'Cambiar de tema.'],
              correct: 1,
              explanation: 'Hablar mal de otros es una bandera roja. Se puede contar un conflicto real centrado en tu acción y tu aprendizaje, sin descalificar.',
            },
          ],
        },
        {
          id: 'aplicacion-habito',
          position: 3,
          title: 'El hábito de aplicar',
          summary: 'Práctica, preparación y candidaturas en un bucle semanal sostenible.',
          minutes: 8,
          content: 'Una candidatura aislada no cambia nada. El progreso sale de un bucle: practicar una parte de la llamada, preparar el recurso que te falta y aplicar a una oferta concreta. Cada vuelta del bucle deja una señal en tu progreso.\n\nElige un ritmo que puedas sostener: por ejemplo, dos prácticas cortas y tres candidaturas a la semana. No es una cuota para castigarte: es un mínimo para que el método no se enfríe. Si un día no puedes, vuelves al siguiente; la racha se construye con retorno, no con perfección.\n\nEl rechazo es información, no un veredicto. Anota qué pasó, ajusta una frase y vuelve a aplicar. La closer que consigue trabajo no es la que nunca recibe un no: es la que tiene un sistema para el día después del no.',
          key_points: ['Practicar, preparar y aplicar forman un solo bucle.', 'Elige un ritmo semanal que puedas sostener.', 'El rechazo se registra y se usa para ajustar.'],
          resources: [
            {
              id: 'res-habito-plan', type: 'template', title: 'Plan semanal de práctica y aplicación',
              description: 'Un mínimo realista, con espacio para el día después del no.',
              content: 'Semana del [fecha]\n· Prácticas: [2] sesiones de [15] minutos. Tema: [eje flojo].\n· Recurso a preparar: [plantilla/guion].\n· Candidaturas: [3] ofertas revisadas y registradas.\n· Seguimiento: [fecha] para las enviadas.\n· Si recibo un no: anoto [motivo], ajusto [frase] y aplico a [siguiente oferta].',
            },
          ],
          questions: [
            {
              id: 'aplicacion-habito-q1', type: 'multiple',
              prompt: '¿Cuál es el bucle correcto de la formación?',
              options: ['Aplicar → esperar → aplicar.', 'Practicar → preparar → aplicar → registrar y ajustar.', 'Leer → memorizar → aprobar.', 'Aplicar a todo sin practicar.'],
              correct: 1,
              explanation: 'El hábito conecta las tres acciones y deja una señal para ajustar. Aplicar sin practicar o practicar sin aplicar rompe el bucle.',
            },
            {
              id: 'aplicacion-habito-q2', type: 'true_false',
              prompt: 'Un rechazo significa que debes dejar de aplicar durante un tiempo para no desmotivarte.',
              options: ['Verdadero', 'Falso'],
              correct: 1,
              explanation: 'El rechazo es información. Se registra, se ajusta una frase y se vuelve a aplicar; parar mucho tiempo rompe el hábito y no mejora la candidatura.',
            },
          ],
        },
      ],
    },
  ],
};

/** Las preguntas de una lección, con su índice correcto ya resuelto. */
export const lessonById = (curriculum: Curriculum, id: string) => lessonsOf(curriculum).find(item => item.lesson.id === id) ?? null;
export const moduleOfLesson = (curriculum: Curriculum, id: string) => lessonById(curriculum, id)?.module ?? null;
