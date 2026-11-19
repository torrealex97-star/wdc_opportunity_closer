// Catálogo visible de prácticas. Sin empresas reales: toda situación es ficticia y
// la UI lo dice. Los prompts de cada personaje viven solo en el servidor, igual que
// las capas de resistencia: aquí solo se declara lo que la alumna ve.
// Cuatro salas por rol —closer, setter, llamada en frío y entrevista— y un test de
// formulario de cualificación aparte. Closer, frío y entrevista se practican con voz;
// el setter, por chat, que es donde ocurre su trabajo (WhatsApp, DM, seguimiento).
// Cada situación declara en qué sala vive, su categoría y la persona que la interpreta;
// esto es lo único que el navegador sabe del personaje (el prompt vive en el servidor).
export type PracticeTrack = 'closer' | 'setter' | 'frio' | 'entrevista';
/** Cómo se practica la sala: dos roles se entrenan hablando y uno escribiendo. */
export type PracticeChannel = 'voz' | 'chat';
export type CloserCategory = 'apertura' | 'descubrimiento' | 'objeciones' | 'cierre';
export type SetterCategory = 'primer-contacto' | 'cualificacion' | 'agenda' | 'rescate' | 'seguimiento';
export type ColdCategory = 'apertura' | 'decisor' | 'cualificacion' | 'seguimiento';
export type InterviewerType = 'dueno' | 'direccion' | 'rrhh' | 'responsable' | 'esceptico' | 'cercano' | 'experiencia';
export type PracticePersona = { name: string; role: string; initials: string; tone: 'clay' | 'sage' | 'amber' };

export type PracticeScenario = {
  id: string;
  kind: 'venta' | 'setter' | 'frio' | 'entrevista';
  track: PracticeTrack;
  category: CloserCategory | SetterCategory | ColdCategory | InterviewerType;
  persona: PracticePersona;
  // Solo la evaluación de una llamada real usa una rúbrica propia; el resto de la sala, la de su kind.
  rubric?: 'llamada';
  title: string;
  context: string;
  summary: string;
  objectives: string[];
  opening: string;
  level: string;
  intensity: 'suave' | 'real' | 'dura';
  minutes: number;
};

export const TRACK_CHANNEL: Record<PracticeTrack, PracticeChannel> = {
  closer: 'voz',
  setter: 'chat',
  frio: 'voz',
  entrevista: 'voz',
};

export const CLOSER_CATEGORIES: Array<{ id: CloserCategory; label: string; hint: string }> = [
  { id: 'apertura', label: 'Apertura y marco', hint: 'Los primeros treinta segundos: contexto, permiso y una pregunta que abra la conversación.' },
  { id: 'descubrimiento', label: 'Descubrimiento', hint: 'Profundizar sin interrogar y poner cifras al coste de seguir igual, antes de hablar del servicio.' },
  { id: 'objeciones', label: 'Objeciones', hint: 'El «es caro», el «lo tengo que pensar», el tercero y el ataque directo.' },
  { id: 'cierre', label: 'Cierre', hint: 'Pedir la venta, sostener el silencio después del precio y de la llamada completa.' },
];

export const SETTER_CATEGORIES: Array<{ id: SetterCategory; label: string; hint: string }> = [
  { id: 'primer-contacto', label: 'Primer contacto', hint: 'El lead acaba de dejar sus datos: responder en minutos, con contexto y una pregunta.' },
  { id: 'cualificacion', label: 'Cualificación', hint: 'Urgencia, autoridad y recursos con tres preguntas, sin que parezca un interrogatorio.' },
  { id: 'agenda', label: 'Agenda de la llamada', hint: 'Dos huecos concretos de las próximas 48 horas y confirmación, no «te mando el enlace cuando pueda».' },
  { id: 'rescate', label: 'No-show', hint: 'Un plantón no es un no: recuperar la cita sin hacer sentir culpable a nadie.' },
  { id: 'seguimiento', label: 'Seguimiento', hint: 'Valor antes de insistir, cuatro toques útiles y un cierre honesto de la conversación.' },
];

export const COLD_CATEGORIES: Array<{ id: ColdCategory; label: string; hint: string }> = [
  { id: 'apertura', label: 'Apertura en frío', hint: 'Los primeros quince segundos de una llamada que nadie espera: motivo, permiso y una pregunta.' },
  { id: 'decisor', label: 'Llegar al decisor', hint: 'Recepción, «está en una reunión» y cómo llegar a quien decide sin mentir ni dejar un correo genérico.' },
  { id: 'cualificacion', label: 'Cualificar y agendar', hint: 'Tres preguntas para saber si hay urgencia, autoridad y recursos, y una cita con día y hora.' },
  { id: 'seguimiento', label: 'Densidad de contactos', hint: 'El sexto intento con un ángulo nuevo, sin culpar al lead ni darlo por perdido antes de tiempo.' },
];

export const INTERVIEWER_TYPES: Array<{ id: InterviewerType; label: string; hint: string }> = [
  { id: 'dueno', label: 'Dueño directo', hint: 'Quien firma y paga: pide números, casos y retorno.' },
  { id: 'direccion', label: 'Dirección', hint: 'Dirección de ventas o CEO: criterio, métricas y escalabilidad.' },
  { id: 'rrhh', label: 'Recursos Humanos', hint: 'Primera criba: encaje, expectativas y condiciones del puesto.' },
  { id: 'responsable', label: 'Responsable de ventas', hint: 'Quien dirige el equipo: método, seguimiento y día a día.' },
  { id: 'esceptico', label: 'Escéptica', hint: 'Ya se ha quemado con otros closers y no cree promesas.' },
  { id: 'cercano', label: 'Cercano', hint: 'Conversación cálida que detecta si recitas un guion.' },
  { id: 'experiencia', label: 'Objeción de experiencia', hint: 'Te cuestionan no conocer el sector: piden un plan creíble.' },
];

export const categoriesFor = (track: PracticeTrack) =>
  track === 'closer' ? CLOSER_CATEGORIES
  : track === 'setter' ? SETTER_CATEGORIES
  : track === 'frio' ? COLD_CATEGORIES
  : INTERVIEWER_TYPES;

const PERSONAS: Record<string, PracticePersona> = {
  'venta-fria': { name: 'Marta', role: 'Directora de marketing · empresa ficticia', initials: 'MA', tone: 'clay' },
  'closer-descubrimiento': { name: 'Álvaro', role: 'Dueño de agencia · ficticia', initials: 'AL', tone: 'clay' },
  'objeciones-precio': { name: 'Javier', role: 'Gerente de academia · ficticia', initials: 'JA', tone: 'clay' },
  'venta-pensarlo': { name: 'Cristina', role: 'Fundadora de consultoría · ficticia', initials: 'CR', tone: 'clay' },
  'venta-pareja': { name: 'Andrés', role: 'Socio de agencia · ficticia', initials: 'AN', tone: 'clay' },
  'venta-cerrada': { name: 'Nuria', role: 'Dueña de clínica dental · ficticia', initials: 'NU', tone: 'clay' },
  'venta-infoproducto': { name: 'Carolina', role: 'Dueña de agencia de diseño · ficticia', initials: 'CA', tone: 'clay' },
  'venta-saas-b2b': { name: 'Elena', role: 'Gerente de gestoría · ficticia', initials: 'EL', tone: 'clay' },
  'venta-clinica': { name: 'Lucía', role: 'Paciente · clínica ficticia', initials: 'LU', tone: 'amber' },
  'venta-reformas': { name: 'Sofía', role: 'Propietaria · empresa ficticia', initials: 'SO', tone: 'clay' },
  'venta-fitness': { name: 'Daniel', role: 'Autónomo · programa ficticio', initials: 'DA', tone: 'amber' },
  'llamada-completa': { name: 'Paula', role: 'Responsable de operaciones · ficticia', initials: 'PA', tone: 'clay' },
  'llamada-completa-b2b': { name: 'Marcos', role: 'Director financiero · ficticio', initials: 'MR', tone: 'clay' },
  'setter-inbound': { name: 'Nerea', role: 'Dueña de clínica · ficticia', initials: 'NE', tone: 'amber' },
  'setter-cualificar': { name: 'Pablo', role: 'Dueño de tienda online · ficticia', initials: 'PB', tone: 'amber' },
  'setter-agendar': { name: 'Marina', role: 'Consultora · empresa ficticia', initials: 'MN', tone: 'amber' },
  'setter-noshow': { name: 'Teresa', role: 'Arquitecta · estudio ficticio', initials: 'TE', tone: 'amber' },
  'setter-seguimiento': { name: 'Gonzalo', role: 'Dueño de reformas · ficticia', initials: 'GO', tone: 'amber' },
  'frio-apertura': { name: 'Rocío', role: 'Directora de operaciones · ficticia', initials: 'RO', tone: 'clay' },
  'frio-decisor': { name: 'Carmen', role: 'Recepción · empresa ficticia', initials: 'CM', tone: 'clay' },
  'frio-cualificar': { name: 'Iván', role: 'Autónomo · negocio ficticio', initials: 'IV', tone: 'clay' },
  'frio-seguimiento': { name: 'Sara', role: 'Gerente de tienda · ficticia', initials: 'SA', tone: 'clay' },
  'entrevista-closer': { name: 'Lucía', role: 'Responsable de ventas', initials: 'LU', tone: 'sage' },
  'entrevista-setter': { name: 'Diego', role: 'Sales manager', initials: 'DI', tone: 'sage' },
  'entrevista-experiencia': { name: 'Elena', role: 'Dueña de servicios · ficticia', initials: 'EL', tone: 'sage' },
  'perfil-directo': { name: 'Carlos', role: 'Dueño directo · ficticio', initials: 'CA', tone: 'sage' },
  'perfil-esceptico': { name: 'Patricia', role: 'Dueña escéptica · ficticia', initials: 'PA', tone: 'sage' },
  'perfil-amable': { name: 'Miguel', role: 'Dueño cercano · ficticio', initials: 'MI', tone: 'sage' },
  'perfil-exigente': { name: 'Lucía', role: 'CEO · startup ficticia', initials: 'LU', tone: 'sage' },
  'entrevista-rrhh': { name: 'Inés', role: 'Recursos Humanos · ficticia', initials: 'IN', tone: 'sage' },
  'entrevista-head-sales': { name: 'Rodrigo', role: 'Dirección de ventas · ficticia', initials: 'RO', tone: 'sage' },
};
const personaOf = (id: string): PracticePersona => PERSONAS[id] ?? { name: 'Interlocutor', role: 'Simulación · empresa ficticia', initials: 'IN', tone: 'sage' };

export const INTENSITY_LABELS: Record<PracticeScenario['intensity'], string> = {
  suave: 'Suave',
  real: 'Real',
  dura: 'Dura',
};

// Sala y categoría de cada situación. El closer se agrupa por momento de la llamada; el setter,
// por momento de su conversación escrita; el frío, por lo que cuesta la llamada; y la entrevista,
// por tipo de entrevistador.
const SCENARIO_META: Record<string, { track: PracticeTrack; category: PracticeScenario['category'] }> = {
  'venta-fria': { track: 'closer', category: 'apertura' },
  'closer-descubrimiento': { track: 'closer', category: 'descubrimiento' },
  'objeciones-precio': { track: 'closer', category: 'objeciones' },
  'venta-pensarlo': { track: 'closer', category: 'cierre' },
  'venta-pareja': { track: 'closer', category: 'objeciones' },
  'venta-cerrada': { track: 'closer', category: 'objeciones' },
  'venta-infoproducto': { track: 'closer', category: 'objeciones' },
  'venta-saas-b2b': { track: 'closer', category: 'objeciones' },
  'venta-clinica': { track: 'closer', category: 'objeciones' },
  'venta-reformas': { track: 'closer', category: 'objeciones' },
  'venta-fitness': { track: 'closer', category: 'objeciones' },
  'llamada-completa': { track: 'closer', category: 'cierre' },
  'llamada-completa-b2b': { track: 'closer', category: 'cierre' },
  'setter-inbound': { track: 'setter', category: 'primer-contacto' },
  'setter-cualificar': { track: 'setter', category: 'cualificacion' },
  'setter-agendar': { track: 'setter', category: 'agenda' },
  'setter-noshow': { track: 'setter', category: 'rescate' },
  'setter-seguimiento': { track: 'setter', category: 'seguimiento' },
  'frio-apertura': { track: 'frio', category: 'apertura' },
  'frio-decisor': { track: 'frio', category: 'decisor' },
  'frio-cualificar': { track: 'frio', category: 'cualificacion' },
  'frio-seguimiento': { track: 'frio', category: 'seguimiento' },
  'entrevista-closer': { track: 'entrevista', category: 'responsable' },
  'entrevista-setter': { track: 'entrevista', category: 'responsable' },
  'entrevista-experiencia': { track: 'entrevista', category: 'experiencia' },
  'entrevista-rrhh': { track: 'entrevista', category: 'rrhh' },
  'entrevista-head-sales': { track: 'entrevista', category: 'direccion' },
  'perfil-directo': { track: 'entrevista', category: 'dueno' },
  'perfil-esceptico': { track: 'entrevista', category: 'esceptico' },
  'perfil-amable': { track: 'entrevista', category: 'cercano' },
  'perfil-exigente': { track: 'entrevista', category: 'direccion' },
};

type ScenarioSeed = Omit<PracticeScenario, 'track' | 'category' | 'persona'>;

const SEEDS: ScenarioSeed[] = [
  {
    id: 'venta-fria',
    kind: 'venta',
    title: 'Llamada en frío a una directora de marketing',
    context: 'Empresa ficticia de software para clínicas · 25 personas',
    summary: 'Te dan treinta segundos para ganarte la conversación. Practicas la apertura, la pregunta que descubre dolor y la petición de siguiente paso.',
    objectives: ['Abrir con contexto y pedir permiso', 'Descubrir un problema concreto', 'Cuantificar el coste de seguir igual', 'Cerrar un siguiente paso con día y hora'],
    opening: '¿Sí? Dime, que estoy entre reuniones.',
    level: 'Closer · primera llamada',
    intensity: 'real',
    minutes: 6,
  },
  {
    id: 'closer-descubrimiento',
    kind: 'venta',
    title: 'Descubrimiento: poner cifras al coste de seguir igual',
    context: 'Agencia ficticia de captación · 8 personas · primera llamada',
    summary: 'El cliente responde en generalidades y dice que «va bien». Practicas profundizar sin interrogar, sacar un ejemplo concreto y cuantificar con sus propias cifras antes de presentar nada.',
    objectives: ['Preguntar situación y deseo antes de hablar del servicio', 'Pedir un ejemplo concreto, no una impresión', 'Poner cifras al coste de seguir igual con sus datos', 'Resumir, confirmar y solo entonces proponer'],
    opening: 'Buenas. Te escucho, aunque te aviso: el equipo comercial va bien. Siempre se puede ir mejor, pero no me quejo.',
    level: 'Closer · descubrimiento',
    intensity: 'real',
    minutes: 8,
  },
  {
    id: 'objeciones-precio',
    kind: 'venta',
    title: '«Me parece caro» a mitad de la propuesta',
    context: 'Academia ficticia · decide el gerente',
    summary: 'La oportunidad está viva, pero el precio frena. Practicas preguntar antes de rebajar, separar valor de coste y no regalar descuentos.',
    objectives: ['Agradecer la sinceridad sin justificarte', 'Aislar si es liquidez o valor', 'Reencuadrar con lo que ya te ha contado', 'Proponer un paso sin rebajar a ciegas'],
    opening: 'Mira, el equipo me gusta. Pero el precio que me pasáis me parece alto para lo que es.',
    level: 'Closer · objeciones',
    intensity: 'real',
    minutes: 6,
  },
  {
    id: 'venta-pensarlo',
    kind: 'venta',
    title: '«Lo tengo que pensar» al final de la llamada',
    context: 'Consultoría ficticia · la decisión se enfría',
    summary: 'El «lo pensaré» casi nunca es la objeción real. Practicas frenar la salida con una pregunta concreta en vez de despedirte con un correo.',
    objectives: ['Validar la prudencia sin empujar', 'Preguntar qué dato falta para decidir', 'Separar duda real de cortesía', 'Pedir una decisión pequeña hoy'],
    opening: 'Mira, me ha gustado lo que me has contado, pero es una decisión importante. Lo tengo que pensar y te escribo.',
    level: 'Closer · cierre',
    intensity: 'real',
    minutes: 7,
  },
  {
    id: 'venta-pareja',
    kind: 'venta',
    title: '«Tengo que hablarlo con mi socio»',
    context: 'Agencia ficticia · dos socias, decisiones conjuntas',
    summary: 'El tercero como escudo. Practicas averiguar su opinión antes de dar argumentos y convertir el permiso en apoyo, sin atacar a nadie.',
    objectives: ['Validar la decisión conjunta', 'Averiguar su opinión propia', 'Preparar la conversación de casa', 'Pedir apoyo, no permiso'],
    opening: 'Antes de decidir nada tengo que hablarlo con mi socio. Nosotros no tomamos estas decisiones por separado.',
    level: 'Closer · objeciones',
    intensity: 'dura',
    minutes: 7,
  },
  {
    id: 'venta-cerrada',
    kind: 'venta',
    title: '«No me estás diciendo nada nuevo»',
    context: 'Clínica ficticia · la conversación se ha enfriado',
    summary: 'Un ataque directo en mitad de la llamada. Practicas no defenderte, validar lo que hay de cierto y recuperar el marco con una pregunta.',
    objectives: ['No justificarte ni acelerar', 'Aceptar y validar sin «pero»', 'Devolver una pregunta que abra dolor', 'Sostener el silencio sin rellenarlo'],
    opening: 'Te voy a ser sincera: llevamos veinte minutos y no me has dicho nada que no pudiera leer en vuestra web.',
    level: 'Closer · alta presión',
    intensity: 'dura',
    minutes: 7,
  },
  {
    id: 'entrevista-closer',
    kind: 'entrevista',
    title: 'Entrevista para closer junior',
    context: 'Entrevista ficticia · responsable de ventas',
    summary: 'Te preguntan por tu experiencia, cómo trabajas una objeción y cómo mides tu trabajo. Practicas respuestas concretas con ejemplos.',
    objectives: ['Contar un ejemplo real con resultado', 'Explicar cómo trabajas una objeción', 'Decir cómo mides tu trabajo', 'Hacer al menos una pregunta al final'],
    opening: 'Gracias por venir. Cuéntame un poco cómo has llegado hasta aquí y por qué ventas.',
    level: 'Entrevista · closer',
    intensity: 'real',
    minutes: 8,
  },
  {
    id: 'entrevista-setter',
    kind: 'entrevista',
    title: 'Entrevista para setter de citas',
    context: 'Entrevista ficticia · sales manager',
    summary: 'El puesto es abrir conversaciones y agendar, no cerrar. Practicas volumen, seguimiento y cómo explicar tu método sin venderte de más.',
    objectives: ['Explicar tu forma de abrir una conversación', 'Hablar de constancia y seguimiento', 'Contar cómo reaccionas al rechazo', 'Preguntar por el día a día del puesto'],
    opening: 'Antes de entrar en materia: ¿qué te atrae de un puesto de setter y no de closer?',
    level: 'Entrevista · setter',
    intensity: 'real',
    minutes: 8,
  },
  {
    id: 'entrevista-experiencia',
    kind: 'entrevista',
    title: '«No conoces el sector» en la entrevista',
    context: 'Entrevista ficticia · dueña de una empresa de servicios',
    summary: 'Te cuestionan la falta de experiencia en su sector. Practicas reconocer el hueco sin disculparte y demostrar un plan de rampa concreto.',
    objectives: ['Reconocer el hueco sin disculparte', 'Explicar un plan de rampa concreto', 'Transferir una habilidad con ejemplo', 'Cerrar con un próximo paso'],
    opening: 'Veo que vienes de otro sector. ¿Qué te hace pensar que puedes vender esto sin conocerlo?',
    level: 'Entrevista · objeción',
    intensity: 'dura',
    minutes: 9,
  },
  // Entrevistas por perfil: misma rúbrica de contratación de scalix-ventas §7, otro entrevistador.
  {
    id: 'perfil-directo',
    kind: 'entrevista',
    title: 'Entrevista con Carlos, el dueño directo',
    context: 'Empresa ficticia de servicios B2B · 14 personas',
    summary: 'Un dueño que va al grano: quiere números, casos y retorno. Practicas responder corto, con cifras propias, sin rodeos.',
    objectives: ['Dar cifras concretas sin inflarlas', 'Contar un caso con resultado', 'Aceptar una repregunta sin ponerte a la defensiva', 'Cerrar con una pregunta de negocio'],
    opening: 'Vamos al grano, que tengo poco tiempo. ¿Cuántas llamadas haces al día y cuál es tu tasa de cierre?',
    level: 'Entrevista · dueño directo',
    intensity: 'real',
    minutes: 8,
  },
  {
    id: 'perfil-esceptico',
    kind: 'entrevista',
    title: 'Entrevista con Patricia, la escéptica',
    context: 'Agencia ficticia · ya contrató closers que no funcionaron',
    summary: 'Ha quemado dinero con closers y no cree nada sin pruebas. Practicas sostener la confianza cuando cada afirmación se cuestiona.',
    objectives: ['No defenderte de la desconfianza', 'Dar un ejemplo verificable, no una promesa', 'Reconocer lo que no tienes medido', 'Proponer cómo demostrarlo'],
    opening: 'Te seré sincera: he contratado a tres closers y ninguno ha durado. ¿Por qué debería creerte a ti?',
    level: 'Entrevista · escéptica',
    intensity: 'dura',
    minutes: 9,
  },
  {
    id: 'perfil-amable',
    kind: 'entrevista',
    title: 'Entrevista con Miguel, el amable',
    context: 'Tienda online ficticia · equipo pequeño',
    summary: 'Conversación relajada que observa si eres auténtica o recitas un guion. Practicas conectar sin perder concreción.',
    objectives: ['Contar quién eres sin guion', 'Conectar con su forma de trabajar', 'No perder las cifras por quedar bien', 'Hacer una pregunta personal y otra de negocio'],
    opening: 'Qué gusto conocerte. Antes de nada, cuéntame cómo llegaste a ventas, sin el discurso de siempre.',
    level: 'Entrevista · cercana',
    intensity: 'suave',
    minutes: 7,
  },
  {
    id: 'perfil-exigente',
    kind: 'entrevista',
    title: 'Entrevista con Lucía, la exigente',
    context: 'Startup ficticia · busca closer senior',
    summary: 'Nivel alto: pide métricas complejas, escalabilidad y criterio propio. Practicas no desmoronarte cuando la pregunta sube de nivel.',
    objectives: ['Razonar sobre métricas, no solo recitarlas', 'Explicar cómo escalar proceso', 'Sostener una pregunta que no sabes', 'Cerrar con una hipótesis propia'],
    opening: 'Necesito una closer senior. ¿Cómo decide tu equipo en qué invertir el esfuerzo comercial cuando el ciclo se alarga?',
    level: 'Entrevista · senior',
    intensity: 'dura',
    minutes: 10,
  },
  // Ofertas ficticias por nicho (cada una con su ticket y su modelo de comisión): la alumna practica con el tipo de oferta real al que optará.
  {
    id: 'venta-infoproducto',
    kind: 'venta',
    title: 'Programa de formación high ticket (2.400 €)',
    context: 'Academia ficticia de ventas · comisión del 10 % · lead de un webinar',
    summary: 'Hablas con la dueña de una agencia que vio el webinar y ya ha comprado otros cursos. Practicas separar «formación» de «resultado» y cerrar sin presionar.',
    objectives: ['Descubrir qué intentó antes y por qué no funcionó', 'Conectar el programa con su objetivo en euros', 'Tratar el «ya compré cursos» sin defender el producto', 'Cerrar con una decisión clara'],
    opening: 'Hola, vi el webinar. Te aviso: ya he comprado tres cursos y ninguno me sirvió.',
    level: 'Closer · high ticket',
    intensity: 'real',
    minutes: 8,
  },
  {
    id: 'venta-saas-b2b',
    kind: 'venta',
    title: 'Software de facturación para pymes (90 €/mes)',
    context: 'SaaS ficticio · comisión del 20 % del primer año · demo ya hecha',
    summary: 'La gerente de una gestoría vio la demo y dice que lo va a «hablar con el equipo». Practicas descubrir quién decide y qué pasa si no cambia nada.',
    objectives: ['Averiguar quién decide y cómo', 'Cuantificar el coste de seguir como ahora', 'Resolver «lo hablo con el equipo» con un siguiente paso', 'Acordar fecha para decidir'],
    opening: 'La demo estuvo bien, pero tengo que hablarlo con el equipo y te digo algo.',
    level: 'Closer · B2B',
    intensity: 'real',
    minutes: 7,
  },
  {
    id: 'venta-clinica',
    kind: 'venta',
    title: 'Tratamiento de estética dental (3.200 €, con financiación)',
    context: 'Clínica ficticia · comisión fija por tratamiento · paciente tras la primera visita',
    summary: 'Una paciente quiere el tratamiento pero le preocupa el coste y el tiempo. Practicas la empatía, la financiación sin presionar y no hacer promesas médicas.',
    objectives: ['Escuchar la preocupación real antes de proponer', 'Presentar la financiación sin forzar', 'No prometer resultados clínicos', 'Cerrar una cita de inicio'],
    opening: 'Me gustó la clínica, pero 3.200 euros es mucho dinero y no sé si es el momento.',
    level: 'Closer · salud',
    intensity: 'suave',
    minutes: 7,
  },
  {
    id: 'venta-reformas',
    kind: 'venta',
    title: 'Reforma integral llave en mano (18.000 €)',
    context: 'Empresa de reformas ficticia · comisión del 3 % · propietaria con tres presupuestos',
    summary: 'Una propietaria compara tres presupuestos y el tuyo es el más caro. Practicas defender el valor con preguntas, no con descuentos.',
    objectives: ['Entender sus criterios reales de elección', 'Diferenciar sin atacar a la competencia', 'Evitar el descuento inmediato', 'Acordar un siguiente paso con fecha'],
    opening: 'Tengo otros dos presupuestos más baratos. ¿Por qué debería pagarte más a ti?',
    level: 'Closer · ticket alto',
    intensity: 'dura',
    minutes: 8,
  },
  {
    id: 'venta-fitness',
    kind: 'venta',
    title: 'Programa online de entrenamiento (1.200 € a 6 meses)',
    context: 'Programa ficticio de fitness · comisión del 15 % · autónomo sin tiempo',
    summary: 'Un autónomo dice que no tiene tiempo y que ya abandonó otros programas. Practicas hablar de hábitos reales y de compromiso sin juzgar.',
    objectives: ['Descubrir por qué abandonó antes', 'Adaptar la propuesta a su agenda sin prometer milagros', 'Tratar «no tengo tiempo» como información, no como excusa', 'Cerrar con un compromiso concreto'],
    opening: 'Me interesa, pero sinceramente no tengo tiempo y ya dejé el gimnasio tres veces.',
    level: 'Closer · B2C',
    intensity: 'real',
    minutes: 7,
  },
  // Setter: conversación escrita (WhatsApp, DM). Cualificar con las tres preguntas del formulario
  // previo —urgencia, autoridad y recursos— y agendar, que es el trabajo del puesto.
  {
    id: 'setter-inbound',
    kind: 'setter',
    title: 'Lead nuevo que acaba de dejar sus datos',
    context: 'Chat ficticio · anuncio de Instagram · clínica de fisioterapia',
    summary: 'Ha rellenado el formulario hace dos minutos y pregunta qué pasa ahora. Practicas responder en el primer mensaje, dar contexto y abrir con una pregunta en vez de con un discurso.',
    objectives: ['Responder en el primer mensaje con nombre y contexto', 'Preguntar por su situación antes de explicar el servicio', 'Detectar la urgencia real (cuándo quiere resolverlo)', 'Proponer la llamada con dos huecos concretos'],
    opening: 'Hola, acabo de rellenar el formulario de la web. ¿Qué pasa ahora?',
    level: 'Setter · primer contacto',
    intensity: 'real',
    minutes: 6,
  },
  {
    id: 'setter-cualificar',
    kind: 'setter',
    title: 'Cualificar sin que parezca un interrogatorio',
    context: 'Chat ficticio · tienda online · respuestas de una palabra',
    summary: 'El lead contesta «sí», «depende», «no sé». Practicas sacar urgencia, autoridad y recursos con preguntas cortas y naturales, y decidir si la llamada con el closer tiene sentido.',
    objectives: ['Convertir una respuesta vacía en información', 'Preguntar cuándo quiere resolverlo', 'Averiguar quién decide además de él', 'Confirmar si hay presupuesto antes de agendar'],
    opening: 'Sí, me interesa. Depende del precio.',
    level: 'Setter · cualificación',
    intensity: 'real',
    minutes: 7,
  },
  {
    id: 'setter-agendar',
    kind: 'setter',
    title: '«En enero lo vemos»: agendar sin presionar',
    context: 'Chat ficticio · consultora de marketing · lead tibio',
    summary: 'Interesada, pero lo deja para más adelante. Practicas ofrecer dos huecos de las próximas 48 horas, explicar por qué merece la pena hablar ahora y no aceptar un «ya te escribo».',
    objectives: ['Validar la cautela sin discutirla', 'Dar una razón concreta para hablar esta semana', 'Ofrecer dos huecos con día y hora', 'Dejar la cita confirmada, no «pendiente»'],
    opening: 'Gracias por la info. Ahora estoy con mil cosas, en enero lo vemos mejor.',
    level: 'Setter · agenda',
    intensity: 'real',
    minutes: 6,
  },
  {
    id: 'setter-noshow',
    kind: 'setter',
    title: 'No-show: recuperar la llamada de hoy',
    context: 'Chat ficticio · estudio de arquitectura · cita perdida',
    summary: 'No entró a la llamada. Practicas escribir sin culpabilizar, recordar en una frase por qué quería hablar y abrir dos huecos nuevos.',
    objectives: ['Escribir sin reproche ni sarcasmo', 'Recordar su motivo en una frase', 'Ofrecer dos huecos nuevos', 'Cerrar la cita o dejarla en un no claro'],
    opening: 'Perdona, se me ha complicado la mañana y no he podido entrar.',
    level: 'Setter · no-show',
    intensity: 'suave',
    minutes: 5,
  },
  {
    id: 'setter-seguimiento',
    kind: 'setter',
    title: 'Cuatro toques de valor y un cierre honesto',
    context: 'Chat ficticio · empresa de reformas · lleva dos semanas en visto',
    summary: 'Dejó de responder después de dos mensajes. Practicas aportar algo útil antes de insistir, no repetir «¿alguna novedad?» y cerrar la conversación con dignidad si no hay respuesta.',
    objectives: ['Aportar valor en cada toque, no solo recordar', 'Preguntar por el obstáculo real una vez', 'No culpar ni usar urgencia falsa', 'Cerrar el seguimiento sin dejar la conversación abierta para siempre'],
    opening: 'Ahora no es buen momento. Te escribo yo cuando pueda.',
    level: 'Setter · seguimiento',
    intensity: 'real',
    minutes: 7,
  },
  // Llamada en frío: prospección pura. El objetivo no es cerrar, es conseguir la cita.
  {
    id: 'frio-apertura',
    kind: 'frio',
    title: 'Los quince segundos de una llamada que nadie espera',
    context: 'Llamada ficticia · empresa de logística · 40 personas',
    summary: 'No te espera, está entre reuniones y no te conoce. Practicas el motivo en una frase, el permiso para preguntar y una pregunta que no se pueda contestar con «mándame un correo».',
    objectives: ['Presentarte con nombre y empresa en una frase', 'Dar un motivo concreto, no un discurso', 'Pedir permiso para una sola pregunta', 'Terminar con un siguiente paso, no con un correo genérico'],
    opening: '¿Dígame? ¿Quién es?',
    level: 'Frío · apertura',
    intensity: 'dura',
    minutes: 5,
  },
  {
    id: 'frio-decisor',
    kind: 'frio',
    title: '«Está en una reunión»: llegar a quien decide',
    context: 'Llamada ficticia · recepción de una empresa de servicios',
    summary: 'Te atiende recepción y protege la agenda. Practicas dar un motivo breve y cierto, pedir el nombre de quien decide y conseguir una vía directa sin inventar una urgencia.',
    objectives: ['Tratar bien a quien filtra, sin intentar saltártela', 'Explicar en una frase por qué llamas', 'Pedir nombre y mejor vía para la persona que decide', 'Conseguir un hueco concreto o una hora para volver a llamar'],
    opening: 'Buenos días, le atiendo yo. ¿Con quién quiere hablar?',
    level: 'Frío · llegar al decisor',
    intensity: 'real',
    minutes: 5,
  },
  {
    id: 'frio-cualificar',
    kind: 'frio',
    title: 'Cualificar en frío y agendar la llamada',
    context: 'Llamada ficticia · autónomo que dejó sus datos hace un mes',
    summary: 'Te contesta, medio interesado y medio desconfiado. Practicas las tres preguntas del formulario previo —urgencia, autoridad y recursos— y una cita con día y hora.',
    objectives: ['Recordar de dónde viene tu llamada sin excusarte', 'Preguntar cuándo quiere resolverlo', 'Averiguar quién más decide', 'Agendar con día y hora o descalificar con respeto'],
    opening: '¿Sí? ¿Esto por qué es? Creo que dejé mis datos hace tiempo, no me acuerdo.',
    level: 'Frío · cualificar',
    intensity: 'real',
    minutes: 7,
  },
  {
    id: 'frio-seguimiento',
    kind: 'frio',
    title: 'El sexto intento con un ángulo nuevo',
    context: 'Llamada ficticia · gerente de tienda · cinco llamadas sin respuesta',
    summary: 'Ya te conoce y no ha contestado cinco veces. Practicas un motivo nuevo y breve, sin reprochar el silencio ni dar la conversación por perdida antes de tiempo.',
    objectives: ['Abrir con un motivo nuevo, no con «te llamo otra vez»', 'No reprochar que no haya contestado', 'Preguntar una sola cosa y dejar hablar', 'Acordar un paso concreto o cerrar el contacto con claridad'],
    opening: '¿Sí? Uy, otra vez tú. Mira, ahora no puedo.',
    level: 'Frío · insistencia',
    intensity: 'dura',
    minutes: 6,
  },
  // Entrevistadores con otro punto de vista: personas (HR) y negocio (dirección de ventas).
  {
    id: 'entrevista-rrhh',
    kind: 'entrevista',
    title: 'Primera criba con Recursos Humanos',
    context: 'Entrevista ficticia · responsable de selección',
    summary: 'RR. HH. comprueba encaje, expectativas y condiciones. Practicas preguntar por el modelo de pago (fijo, variable, solo comisión) sin parecer ingenua ni agresiva.',
    objectives: ['Explicar tu motivación con un ejemplo', 'Preguntar cómo se paga el puesto y cómo se consiguen los leads', 'Dar tus expectativas sin regatear a ciegas', 'Detectar condiciones que no encajan'],
    opening: 'Gracias por venir. Antes de nada: ¿qué esperas de este puesto y qué condiciones buscas?',
    level: 'Entrevista · RR. HH.',
    intensity: 'real',
    minutes: 8,
  },
  {
    id: 'entrevista-head-sales',
    kind: 'entrevista',
    title: 'Entrevista con la dirección de ventas y crecimiento',
    context: 'Entrevista ficticia · head of sales',
    summary: 'Quien dirige ventas te pregunta por números, pipeline y cómo cualificas. Practicas hablar de métricas propias y de cómo calificarías un lead.',
    objectives: ['Dar tus cifras con honestidad (y decir lo que no mides)', 'Explicar cómo cualificas un lead', 'Defender cómo harías tus primeras semanas', 'Hacer una pregunta sobre cómo medís el éxito'],
    opening: 'Vamos a números: ¿qué ratio de cierre tenías y cómo decidías si un lead valía tu tiempo?',
    level: 'Entrevista · dirección',
    intensity: 'dura',
    minutes: 10,
  },
  // Llamada completa: el arco entero en una sesión, para entrenar los cambios de fase.
  {
    id: 'llamada-completa',
    kind: 'venta',
    title: 'Llamada completa: de la apertura al cierre',
    context: 'Consultora ficticia de captación de clientes · 18 personas',
    summary: 'La llamada entera en una sola práctica: abrir sin disculparte, descubrir el problema, sostener el precio y pedir el siguiente paso sin rellenar el silencio.',
    objectives: ['Abrir con contexto y pedir permiso', 'Descubrir y cuantificar el problema antes de hablar del servicio', 'Sostener el precio sin justificarte ni rellenar el silencio', 'Cerrar con una fecha concreta'],
    opening: 'Hola, ¿sí? Perdona, ¿me llamabas por algo?',
    level: 'Closer · llamada completa',
    intensity: 'real',
    minutes: 10,
  },
  {
    id: 'llamada-completa-b2b',
    kind: 'venta',
    title: 'Llamada completa B2B: del descubrimiento a la firma',
    context: 'Software ficticio de gestión comercial · ciclo de 30 días · compras y dirección',
    summary: 'Una sola llamada con dos decisiones en la cabeza: quien usa el producto y quien firma. Practicas descubrir criterios, tratar al que decide y acordar un paso con fecha.',
    objectives: ['Descubrir quién decide y con qué criterio', 'Cuantificar el coste de seguir como ahora', 'Tratar la objeción de presupuesto sin rebajar', 'Acordar una reunión con quien firma'],
    opening: 'Te escucho, aunque te aviso: la decisión de compra no es solo mía.',
    level: 'Closer · B2B completo',
    intensity: 'real',
    minutes: 11,
  },
];

export const PRACTICE_SCENARIOS: PracticeScenario[] = SEEDS.map(seed => ({
  ...seed,
  ...(SCENARIO_META[seed.id] ?? { track: seed.kind === 'entrevista' ? 'entrevista' : 'closer', category: seed.kind === 'entrevista' ? 'responsable' : 'apertura' }),
  persona: personaOf(seed.id),
}));

export const scenarioById = (id: string) => PRACTICE_SCENARIOS.find(item => item.id === id) ?? null;
