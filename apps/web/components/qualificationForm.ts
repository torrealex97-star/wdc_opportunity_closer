// Test del formulario de cualificación de closer. Determinista y sin IA: cada pregunta
// tiene tres respuestas posibles y se explica qué lee en ellas quien contrata. El
// objetivo no es «aprobar»: es aprender a responder con autoridad desde el primer día,
// sin inventar experiencia y sin pedir perdón por ser nueva.

export type FormOption = {
  id: string;
  text: string;
  /** 2 = se lee con autoridad, 1 = correcta pero floja, 0 = resta. */
  grade: 0 | 1 | 2;
  /** Lo que interpreta quien lee el formulario. */
  reads: string;
};

export type FormQuestion = {
  id: string;
  question: string;
  /** Qué está comprobando quien contrata con esta pregunta. */
  wants: string;
  options: FormOption[];
};

export const FORM_QUESTIONS: FormQuestion[] = [
  {
    id: 'experiencia',
    question: '¿Cuántos años de experiencia tienes en ventas?',
    wants: 'Saber de dónde partes sin que infles la cifra. Una persona que empieza puede responder con autoridad si dice qué sí ha hecho.',
    options: [
      { id: 'a', grade: 0, text: 'Acabo de empezar, no tengo experiencia. Sé que no es mucho, pero tengo muchas ganas y aprendo rápido.', reads: 'Pide una oportunidad y se pone por debajo: quien contrata no sabe qué sabe hacer, solo qué le falta.' },
      { id: 'b', grade: 1, text: 'Llevo dos años en atención al cliente y todavía no he cerrado ventas por mi cuenta.', reads: 'Es honesto y se entiende, pero deja la duda de si sabes cerrar. Se refuerza contando qué has practicado y cómo lo harías.' },
      { id: 'c', grade: 2, text: 'Un año cerrando por videollamada en [producto] y antes dos años atendiendo clientes en [contexto]. Sigo empezando y vengo con método: sé cómo abrir, cualificar y pedir el cierre.', reads: 'Trayectoria real, aunque sea corta, y una frase que dice exactamente qué sabes hacer. La falta de años deja de ser la primera pregunta.' },
    ],
  },
  {
    id: 'producto',
    question: '¿Qué has vendido y con qué ticket medio?',
    wants: 'Comprobar que sabes describir una venta concreta: producto, cliente y precio. Es la prueba más rápida de si has vendido de verdad.',
    options: [
      { id: 'a', grade: 0, text: 'He vendido de todo un poco: cursos, servicios, alguna cosa de tiendas.', reads: '«De todo un poco» suena a nada en concreto. Quien contrata no puede imaginar tu día a día.' },
      { id: 'b', grade: 1, text: 'Vendía servicios a empresas, con tickets variados según el cliente.', reads: 'Es cierto, pero no da escala: sin un rango de precio no se sabe si estás cómoda con tickets altos.' },
      { id: 'c', grade: 2, text: 'Cerraba [servicio] a [tipo de cliente] con tickets de [rango] y un ciclo de [días]. El más alto fue [importe] y el más habitual, [importe].', reads: 'Producto, cliente, precio y ciclo. Con eso ya se puede hablar de encaje y de si el ticket de esta oferta te queda grande o pequeño.' },
    ],
  },
  {
    id: 'metricas',
    question: '¿Cuál era tu tasa de cierre?',
    wants: 'Ver si trabajas con números y si eres honesta con lo que no medías. Inventar un porcentaje redondo es la bandera roja más fácil de detectar.',
    options: [
      { id: 'a', grade: 1, text: 'La verdad es que no la medía. Cerraba lo que podía.', reads: 'Honesta, pero se queda ahí: sin explicar cómo lo medirías ahora, parece que los números no forman parte de tu trabajo.' },
      { id: 'b', grade: 0, text: 'Cerraba el 60 % de las llamadas, más o menos.', reads: 'Un porcentaje alto sin contexto invita a la repregunta: ¿sobre cuántas llamadas, en qué periodo, con qué leads? Si no hay respuesta, pierde credibilidad todo lo demás.' },
      { id: 'c', grade: 2, text: 'No la tenía medida por semana: trabajaba con [n] llamadas al mes y anotaba cierres, pero sin calcular el ratio. Desde el primer día la mediría así: [llamadas, cierres, ratio y seguimiento].', reads: 'Reconoce el hueco y trae el sistema con el que lo resolvería. Eso se lee como criterio, no como carencia.' },
    ],
  },
  {
    id: 'presentacion',
    question: 'Preséntate en dos líneas, como lo dirías al empezar una llamada.',
    wants: 'Escuchar tu pitch. Quien contrata busca una frase concreta, no una lista de adjetivos: si no puedes presentarte en dos líneas, tampoco podrás abrir una llamada.',
    options: [
      { id: 'a', grade: 0, text: 'Soy una persona muy trabajadora, me apasiona el trato con la gente y tengo muchas ganas de crecer.', reads: 'Adjetivos sin prueba. Cualquiera puede escribir eso: no diferencia nada.' },
      { id: 'b', grade: 1, text: 'Trabajo en ventas y me gusta el trato con el cliente; ahora quiero especializarme en cerrar.', reads: 'Se entiende y no molesta, pero sigue sin decir a quién sirves ni con qué resultado. Es una base, no una presentación.' },
      { id: 'c', grade: 2, text: 'Ayudo a [tipo de cliente] a [resultado concreto]. Lo hago con [método en tres pasos] y lo mido con [métrica]. Ahora quiero hacerlo con [tipo de oferta].', reads: 'A quién sirves, qué resultado das, cómo lo haces y cómo lo mides. Es la misma estructura que usarías con un cliente.' },
    ],
  },
  {
    id: 'motivo',
    question: '¿Por qué quieres ser closer y por qué ahora?',
    wants: 'Detectar motivación real y si entiendes el modelo del puesto: comisión, presión y resultado. «Me gusta la gente» no explica por qué ventas.',
    options: [
      { id: 'a', grade: 0, text: 'Porque necesito trabajo y me han dicho que en ventas se gana bien.', reads: 'El sueldo como único motivo hace dudar de la constancia: el primer mes malo se lleva esa motivación.' },
      { id: 'b', grade: 1, text: 'Porque me gusta hablar con la gente y ayudar a que tomen decisiones.', reads: 'Suena bien, pero no habla del oficio: cerrar tiene método, rechazo y números.' },
      { id: 'c', grade: 2, text: 'Quiero un oficio que se pague por resultado: me interesa aprender a descubrir un problema, sostener una objeción y cerrar. Entiendo el modelo de fijo y variable y quiero llegar a [meta concreta] en [plazo].', reads: 'Entiende cómo se paga el puesto y qué se entrena. Se lee como alguien que va a quedarse y a medir su progreso.' },
    ],
  },
  {
    id: 'objecion',
    question: 'Un cliente te dice «es caro». ¿Qué haces?',
    wants: 'Comprobar que no rebajas a la primera y que preguntas antes de responder. Es la prueba de criterio comercial más habitual en un formulario.',
    options: [
      { id: 'a', grade: 0, text: 'Le explico que es una inversión y, si insiste, le ofrezco un descuento para cerrar hoy.', reads: 'El descuento inmediato dice que el precio era inventado y que la próxima objeción se resuelve bajando más.' },
      { id: 'b', grade: 1, text: 'Le recuerdo todo lo que incluye y lo que va a conseguir.', reads: 'Responder con una lista antes de saber qué compara suele alargar la objeción, no resolverla.' },
      { id: 'c', grade: 2, text: 'Primero pregunto qué está comparando y si el freno es el dinero o el valor. Después reencuadro con lo que me ha contado —lo que le cuesta seguir igual— y le pido un paso concreto.', reads: 'Pregunta, aísla y reencuadra. Se lee como alguien que ha trabajado objeciones con método y no se pone a la defensiva.' },
    ],
  },
  {
    id: 'retribucion',
    question: '¿Qué expectativa de retribución tienes?',
    wants: 'Ver si conoces el mercado y si preguntas cómo se compone el pago. «Lo que sea» no es flexibilidad: es no haber pensado el puesto.',
    options: [
      { id: 'a', grade: 0, text: 'Lo que sea, me adapto a lo que paguéis.', reads: 'Parece humildad y se lee como falta de criterio: sin número, no se sabe si el puesto te sirve ni cuánto tiempo te quedas.' },
      { id: 'b', grade: 1, text: 'Necesito 3.000 € fijos al mes como mínimo.', reads: 'Un número sin contexto. Si el puesto es sobre todo variable, esa cifra puede descartarte antes de hablar.' },
      { id: 'c', grade: 2, text: 'Antes de dar un número: ¿cómo se compone el pago (fijo y variable), de dónde salen los leads y cuántas llamadas al día hay? Con eso, mi rango es [rango razonado] y valoro también [condición].', reads: 'Pregunta lo que define el puesto y después da un rango con lógica. Se lee como alguien que negocia con información, no con miedo.' },
    ],
  },
  {
    id: 'disponibilidad',
    question: '¿Cuándo podrías empezar?',
    wants: 'Saber si hay un compromiso real. Un «cuando queráis» obliga a quien contrata a adivinar y suele significar que hay otro proceso abierto.',
    options: [
      { id: 'a', grade: 0, text: 'Cuando queráis, estoy disponible siempre.', reads: 'No es una fecha. Quien contrata no puede planificar y desconfía de que haya compromiso.' },
      { id: 'b', grade: 1, text: 'En un par de meses, tengo que organizarme.', reads: 'Es honesto, pero sin fecha ni plan se lee como «ya veremos». Se puede mejorar diciendo qué pasa en esos dos meses.' },
      { id: 'c', grade: 2, text: 'Puedo empezar el [fecha]. Si necesitáis antes, puedo [ajuste concreto: formación por las tardes, incorporación parcial].', reads: 'Una fecha y una alternativa. Se lee como alguien que ha pensado el cambio y puede comprometerse.' },
    ],
  },
];

export const AUTHORITY_RULES: Array<{ id: string; title: string; text: string }> = [
  { id: 'cifras', title: 'Cifras propias, no adjetivos', text: '«Trabajadora» no se puede comprobar; «cerré 12 cuentas en 90 llamadas» sí. Si no tienes la cifra exacta, da el orden de magnitud y di cómo lo sabes.' },
  { id: 'hueco', title: 'El hueco se nombra una vez y se compensa', text: 'No hace falta esconder que empiezas. Nombra lo que no tienes en una frase y sigue con lo que sí: método, práctica y disponibilidad.' },
  { id: 'metodo', title: 'Método antes que entusiasmo', text: 'Quien contrata quiere saber cómo abres, cómo cualificas y cómo pides el cierre. Una estructura de tres pasos vale más que cualquier «me apasiona».' },
  { id: 'nada-de-perdon', title: 'Ni disculpas ni mínimos', text: '«Solo soy», «perdón por molestar» y «lo que sea» restan autoridad. Un rango razonado y una fecha concreta la suman.' },
  { id: 'siguiente-paso', title: 'Cierra con un siguiente paso', text: 'Termina el formulario o la llamada con una pregunta por el proceso y una fecha: cuándo sabrás algo y cuándo puedes hablar. La iniciativa también se lee.' },
];

export type FormResult = {
  points: number;
  max: number;
  /** Respuestas que se leen con autoridad (grade 2). */
  strong: number;
  total: number;
  score: number;
  /** Preguntas cuya respuesta elegida resta (grade 0). */
  weak: string[];
};

export const formBand = (score: number): { level: 'autoridad' | 'prudente' | 'oportunidad'; label: string; detail: string } =>
  score >= 80
    ? { level: 'autoridad', label: 'Se lee con autoridad', detail: 'Un formulario así consigue que la primera llamada sea sobre el encaje, no sobre tu falta de experiencia.' }
    : score >= 50
      ? { level: 'prudente', label: 'Se lee correcto, pero prudente', detail: 'No hay banderas rojas, y también pocas razones para llamarte antes que a otra persona. Faltan cifras y criterio propio.' }
      : { level: 'oportunidad', label: 'Se lee como una petición de oportunidad', detail: 'El formulario habla de ganas, no de lo que sabes hacer. Se puede reescribir sin inventar nada: empieza por las cifras que sí tienes.' };

export function gradeForm(answers: Record<string, string>): FormResult {
  let points = 0;
  let strong = 0;
  const weak: string[] = [];
  for (const question of FORM_QUESTIONS) {
    const chosen = question.options.find(option => option.id === answers[question.id]);
    if (!chosen) continue;
    points += chosen.grade;
    if (chosen.grade === 2) strong += 1;
    if (chosen.grade === 0) weak.push(question.id);
  }
  const max = FORM_QUESTIONS.length * 2;
  return { points, max, strong, total: FORM_QUESTIONS.length, score: Math.round((points / max) * 100), weak };
}

export type FormCriterion = { id: string; label: string; ok: boolean; detail: string };
const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

// Revisión de la presentación libre. Son reglas explicables sobre el texto, no una nota:
// cada criterio dice qué falta para que la respuesta suene a alguien que sabe lo que hace.
export function reviewPitch(text: string): FormCriterion[] {
  const body = text.trim();
  const has = body.length > 0;
  const rule = (id: string, label: string, ok: boolean, detail: string): FormCriterion => ({ id, label, ok: has && ok, detail: has ? detail : 'Falta: escribe tu presentación.' });
  return [
    rule('cifra', 'Incluye una cifra propia', /\d/.test(body), /\d/.test(body) ? 'Cumple: hay un número que se puede comprobar.' : 'Falta un número: llamadas, cierres, ticket o meses de experiencia.'),
    rule('rol', 'Dice qué vende y a quién', /(vendo|vend[ií]a|cierro|cerraba|vender|cerrar)/i.test(body) && /(a |para )/i.test(body), /(vendo|vend[ií]a|cierro|cerraba|vender|cerrar)/i.test(body) ? 'Cumple: se entiende qué haces.' : 'Falta concreción: «vendo/cierro X a Y», no solo «me dedico a ventas».'),
    rule('metodo', 'Menciona un método o un proceso', /(pregunt|m[eé]todo|metodo|paso|proceso|sistema|primero)/i.test(body), /(pregunt|m[eé]todo|metodo|paso|proceso|sistema|primero)/i.test(body) ? 'Cumple: hay una forma de trabajar, no solo intención.' : 'Falta el cómo: abre con «primero…», «mi proceso es…» o «pregunto antes de…».'),
    rule('sin-disculpas', 'Sin disculpas por ser nueva', !/(no tengo experiencia|solo soy|acabo de empezar|perd[oó]n|disculpa|lo siento)/i.test(body), /(no tengo experiencia|solo soy|acabo de empezar|perd[oó]n|disculpa|lo siento)/i.test(body) ? 'Resta autoridad: nombra el hueco una vez y pasa a lo que sí sabes hacer.' : 'Cumple: no pides perdón por tu punto de partida.'),
    rule('sin-inflar', 'Sin cifras imposibles', !/(100 ?%|siempre cierro|nunca fallo|el mejor closer|todo lo que toco)/i.test(body), /(100 ?%|siempre cierro|nunca fallo|el mejor closer|todo lo que toco)/i.test(body) ? 'Resta credibilidad: una cifra redonda y absoluta se cae en la primera repregunta.' : 'Cumple: nada de promesas absolutas.'),
    rule('longitud', 'Entre 12 y 70 palabras', words(body) >= 12 && words(body) <= 70, words(body) < 12 ? `Falta: ${words(body)} palabras no dan ni para presentarse.` : words(body) > 70 ? `Falta: ${words(body)} palabras es un discurso; en voz alta se pierde.` : `Cumple: ${words(body)} palabras, dos o tres frases.`),
  ];
}
