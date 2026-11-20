// Mapa del Classroom de Women Digital Closers, tal como lo declara la skill `metodo-wdc` (§0.2 y §0.3):
// los 12 módulos y el buscador de temas que dice en qué lección se enseña cada cosa.
// Generado desde `.agents/skills/metodo-wdc/SKILL.md` con `scripts/classroom-map.mjs`: no se edita a mano.
// Aquí no hay contenido de las clases, solo su índice: el vídeo y los materiales viven en Skool.

export type ClassroomModule = {
  order: number;
  name: string;
  lessons: number;
  duration: string;
  /** Cuántos recursos enlaza el Classroom en ese módulo («—» si solo son vídeos). */
  resources: string;
  /** Qué se enseña, en una línea, tal como lo resume la skill. */
  teaches: string;
  /** Sección de la skill donde está escrito el método. */
  section: string;
};

export type ClassroomTopic = {
  topic: string;
  /** Lecciones del Classroom (`7.5`) donde se enseña, en el orden del mapa. */
  lessons: string[];
  /** Columna «Se enseña en» del mapa, con el nombre de la clase cuando la skill lo da. */
  teaches: string;
  section: string;
};

export const CLASSROOM_MODULES: ClassroomModule[] = [
  { order: 1, name: 'Onboarding', lessons: 4, duration: '19 min', resources: '1', teaches: 'Guía de arranque: bienvenida, identidad inicial, normas de la comunidad y cómo aprovechar la formación.', section: '§1.8' },
  { order: 2, name: 'Fundamentos del High Ticket', lessons: 9, duration: '3 h 51 min', resources: '9', teaches: 'Qué es vender alto valor, psicología del precio, mostrar el valor, comunicación asertiva, emoción frente a lógica, vender sin bajar el precio y palabras que restan autoridad.', section: '§2, §3, §4, §5, §6' },
  { order: 3, name: 'Identidad profesional de la closer', lessons: 10, duration: '4 h 33 min', resources: '4', teaches: 'Mentalidad, compromiso, gestión emocional, autoridad frente a simpatía, relación con el dinero, merecimiento, presencia y paso de empleada a closer.', section: '§1' },
  { order: 4, name: 'Fundamentos de Marketing', lessons: 6, duration: '3 h 06 min', resources: '—', teaches: 'Recorrido del lead hasta la llamada, inbound y outbound, captación y niveles de conciencia; cómo proyectarse en la entrevista.', section: '— (sin recursos: solo vídeo; los niveles de conciencia se tocan en §7)' },
  { order: 5, name: 'Psicología de Decisión del Cliente', lessons: 11, duration: '5 h 26 min', resources: '3', teaches: 'Psicología aplicada, pilares (dolor, deseo, urgencia), gestión emocional del cliente, sensación de pérdida, psicología de las objeciones, tono y ritmo, tipos de cliente, energía y lenguaje no verbal.', section: '§7' },
  { order: 6, name: 'Estructura de la Llamada', lessons: 12, duration: '8 h 32 min', resources: '12', teaches: 'Las seis fases con sus transiciones: confianza y marco, discovery, presentación, cierres, presión, prevención de objeciones, objeciones fantasma y venta B2B.', section: '§8, §9, §10, §11, §12.1, §12.5' },
  { order: 7, name: 'Gestión de las objeciones.', lessons: 11, duration: '4 h 59 min', resources: '9', teaches: 'Una clase por objeción (precio, pensarlo, tiempo, pareja, capacidad, otras opciones, mala experiencia), introducción, fantasmas y tres masterclasses con el playbook.', section: '§12' },
  { order: 8, name: 'Domina el Seguimiento', lessons: 6, duration: '1 h 03 min', resources: '4', teaches: 'Seguimiento que cierra, tipos, fases, confirmación de llamada, CRM y las métricas de la closer.', section: '§13, §14' },
  { order: 9, name: 'Comunicación', lessons: 11, duration: '2 h 37 min', resources: '—', teaches: 'Comunicación con propósito, energía, persuasión, comunicación agresiva y no verbal, silencio, escucha activa, autenticidad y pilares de la comunicación.', section: '— (§4 cubre autoridad y asertividad desde 2.6 y 3.5; el resto es vídeo)' },
  { order: 10, name: 'Herramientas', lessons: 6, duration: '1 h 00 min', resources: '1', teaches: 'Calendario, qué es un CRM, setup de la closer, grabación de llamadas, el CRM más usado y Calendly.', section: '— (el seguimiento en CRM se toca en §13; 10.4 es una invitación a Fathom)' },
  { order: 11, name: 'Captación de proyectos', lessons: 9, duration: '3 h 39 min', resources: '8', teaches: 'Cómo conseguir proyecto: currículum, grupos de Facebook, grupos de Skool, portales de empleo, medición de resultados, vídeo de presentación, qué busca un dueño y entrevista.', section: '§15' },
  { order: 12, name: 'Clases Grupales', lessons: 35, duration: '55 h 05 min', resources: '4', teaches: 'Clases grabadas en cuatro carpetas (Clases grupales, Roleplay Cualificación, Objeciones, Llamada completa) con 35 lecciones y los roleplays del método.', section: '§1, §3, §4, §16 (las clases repetidas); §12 para los roleplays de objeciones' },
];

export const CLASSROOM_TOPICS: ClassroomTopic[] = [
  { topic: 'Qué es el high ticket y qué rangos de precio se manejan', lessons: ['2.3'], teaches: '2.3 «Qué es el High Ticket»', section: '§2' },
  { topic: 'Cómo funciona el mercado high ticket', lessons: ['2.2'], teaches: '2.2 «Cómo funciona el mercado High Ticket»', section: '§2' },
  { topic: 'Psicología del precio', lessons: ['2.4'], teaches: '2.4 «La Psicología del Precio»', section: '§6' },
  { topic: 'Mostrar el valor / vender el resultado antes del cómo', lessons: ['2.5', '12.3'], teaches: '2.5 «Cómo Mostrar el valor en ventas» (repetida en 12.3)', section: '§3' },
  { topic: 'Comunicación asertiva, pasiva y agresiva; hablar con autoridad', lessons: ['2.6', '12.2'], teaches: '2.6 «Comunicación asertiva en ventas» (clase en 12.2)', section: '§4' },
  { topic: 'Venta lógica frente a venta emocional', lessons: ['2.7'], teaches: '2.7 «Venta lógica vs emocional»', section: '§5' },
  { topic: 'Vender sin bajar el precio / descuentos', lessons: ['2.8'], teaches: '2.8 «Vende sin bajar el precio» (dos documentos)', section: '§6' },
  { topic: 'Palabras que te hacen perder autoridad', lessons: ['2.9'], teaches: '2.9 «Palabras que te hacen perder Autoridad» — recurso no leído (401)', section: '§4 (sin el contenido de 2.9)' },
  { topic: 'Mentalidad de la closer: diagnosticar, no cerrar', lessons: ['3.2'], teaches: '3.2 «Identidad de una Closer profesional»', section: '§1.1–1.7' },
  { topic: 'Miedo al rechazo y estadística de cierres', lessons: ['3.2'], teaches: '3.2', section: '§1.2' },
  { topic: 'Dolor superficial frente a dolor real', lessons: ['5.2', '12.12'], teaches: '5.2 «Psicología aplicada a las ventas - Parte 2»; roleplay en 12.12', section: '§1.4, §7' },
  { topic: 'Ritual y preparación antes de la llamada', lessons: ['3.2'], teaches: '3.2', section: '§1.7' },
  { topic: 'Cuaderno de identidad / ejercicios de identidad', lessons: ['1.2'], teaches: '1.2 «Tu nueva Identidad»', section: '§1.8' },
  { topic: 'Autoridad frente a simpatía; caer bien', lessons: ['3.5', '12.4'], teaches: '3.5 «Tu simpatía no vende tu autoridad si» (clase en 12.4)', section: '§1.8, §1.9, §4' },
  { topic: 'Relación con el dinero', lessons: ['3.6'], teaches: '3.6 «Relación con el dinero»', section: '§1.8' },
  { topic: 'Merecimiento financiero y techo de ingresos', lessons: ['3.7'], teaches: '3.7 «Merecimiento financiero»', section: '§1.8' },
  { topic: 'El mapa de un lead, inbound y outbound', lessons: ['4.2', '4.3', '4.4'], teaches: '4.2 «El mapa completo de un Lead», 4.3 «Inbound vs Outbound», 4.4', section: '— (solo vídeo; los niveles de conciencia están en §7 desde 5.2)' },
  { topic: 'Niveles de conciencia del cliente', lessons: ['4.5'], teaches: '4.5 «Niveles de Conciencia»', section: '§7' },
  { topic: 'Los tres pilares: dolor, deseo, urgencia', lessons: ['5.2', '5.3'], teaches: '5.2, 5.3 «Pilares de Psicología»', section: '§7' },
  { topic: 'Psicología de la pérdida', lessons: ['5.5'], teaches: '5.5 «Psicología del Cliente-Sensación de perdida»', section: '§7' },
  { topic: 'Por qué presionar al cliente es un error', lessons: ['5.7'], teaches: '5.7 «Por qué presionar al cliente es un error»', section: '§11' },
  { topic: 'Tono y ritmo de la llamada', lessons: ['5.8'], teaches: '5.8 «El tono y el ritmo de una llamada.»', section: '§7' },
  { topic: 'Tipos de clientes (lógico, emocional, dominante, inseguro)', lessons: ['5.9'], teaches: '5.9 «Tipos de clientes»', section: '§7' },
  { topic: 'Energía femenina y masculina; energía en la llamada', lessons: ['5.10'], teaches: '5.10 «Energía Femenina VS Masculina.»', section: '— (solo vídeo)' },
  { topic: 'Lenguaje no verbal', lessons: ['5.11', '9.6'], teaches: '5.11 «Lenguaje no Verbal» y 9.6 «Comunicación no Verbal»', section: '— (solo vídeo)' },
  { topic: 'Estructura completa de la llamada, fase por fase', lessons: ['6.1'], teaches: '6.1 «Estructura de una llamada de ventas» (dos documentos)', section: '§8' },
  { topic: 'Generar confianza y sentar el marco', lessons: ['6.2'], teaches: '6.2 «Generar confianza y Sentar el Marco»', section: '§8, §4' },
  { topic: 'Cualificación profunda / discovery', lessons: ['6.3', '12.10', '12.11', '12.16'], teaches: '6.3 «Cualificación profunda (discovery)»; roleplays en 12.10, 12.11, 12.16', section: '§9, §16' },
  { topic: 'Presentar la oferta / pitch de 3–5 minutos', lessons: ['6.4'], teaches: '6.4 «Presentación de la oferta»', section: '§10' },
  { topic: 'Tipos de cierre y arte del cierre', lessons: ['6.5', '6.6'], teaches: '6.5 «Tipos de cierre», 6.6 «El arte del Cierre»', section: '§11' },
  { topic: 'Dudas frecuentes de las fases de la estructura', lessons: ['6.7'], teaches: '6.7 «Fases de la estructura-dudas frecuentes»', section: '§8' },
  { topic: 'Sostener la presión sin romperse', lessons: ['6.8'], teaches: '6.8 «Cómo sostener presión sin romperte»', section: '§11' },
  { topic: 'Prevenir objeciones / micro cierres', lessons: ['6.9'], teaches: '6.9 «Cómo Evitar las Objeciones»', section: '§12.1' },
  { topic: 'Objeciones fantasmas', lessons: ['6.10'], teaches: '6.10 «Objeciones Fantasmas»', section: '§12.1' },
  { topic: 'Diferencia entre venta B2B y B2C; estructura B2B', lessons: ['6.11', '6.12'], teaches: '6.11 «Diferencia entre Venta B2B y B2C», 6.12 «Estructura de Venta B2B»', section: '§8, §12.5' },
  { topic: 'Marco general de las objeciones', lessons: ['7.1'], teaches: '7.1 «Introducción a las Objeciones»', section: '§12.1' },
  { topic: '«No tengo dinero» / «es muy caro»', lessons: ['7.2', '12.25'], teaches: '7.2 «Objeción - “No tengo dinero”»; roleplay en 12.25', section: '§12.3' },
  { topic: '«Lo tengo que pensar»', lessons: ['7.3', '7.5'], teaches: '7.3 y 7.5 «Objeción - “Lo tengo que pensar”»', section: '§12.2, §12.3' },
  { topic: '«No tengo tiempo»', lessons: ['7.4'], teaches: '7.4 «Objeción - “No tengo tiempo”»', section: '§12.3' },
  { topic: '«Lo tengo que consultar con mi pareja»', lessons: ['7.5'], teaches: '7.5 «Objeción - “Lo tengo que consultar con mi pareja”»', section: '§12.3' },
  { topic: '«No sé si voy a ser capaz» / desconfianza', lessons: ['7.6'], teaches: '7.6 «Objeción - “No sé si voy a ser capaz”»', section: '§12.3' },
  { topic: '«Quiero valorar otras opciones»', lessons: ['7.7'], teaches: '7.7 «Objeción: “Quiero valorar otras opciones”»', section: '§12.3' },
  { topic: '«Probé algo parecido y no me funcionó»', lessons: ['7.8'], teaches: '7.8 «Objeción - “Probé algo parecido y no me funcionó”»', section: '§12.3' },
  { topic: 'Playbook de objeciones y banco de frases', lessons: ['7.9', '7.10', '7.11'], teaches: '7.9 «Masterclass de Objeciones - Parte 1» (y partes 2 y 3 en 7.10, 7.11)', section: '§12.3, §12.6' },
  { topic: 'Seguimiento que cierra, tipos y fases', lessons: ['8.1', '8.2', '8.3'], teaches: '8.1, 8.2 «Tipos de seguimiento», 8.3 «Fases del Seguimiento»', section: '§13' },
  { topic: 'Confirmar una llamada', lessons: ['8.4'], teaches: '8.4 «Cómo confirmar una llamada.»', section: '§13' },
  { topic: 'CRM y seguimiento en el CRM', lessons: ['8.5', '10.2', '10.5'], teaches: '8.5, 10.2 «Que es un CRM y para que se utiliza», 10.5', section: '§13' },
  { topic: 'Las métricas de la closer', lessons: ['8.6'], teaches: '8.6 «Las métricas que toda Closer debe dominar»', section: '§14' },
  { topic: 'Comunicación con propósito, persuasiva, autenticidad', lessons: ['9.1', '9.4', '9.10'], teaches: '9.1, 9.4 «Comunicación persuasiva», 9.10 «La importancia de ser Auténtica»', section: '— (solo vídeo)' },
  { topic: 'El silencio en la llamada y cómo sostenerlo', lessons: ['9.7', '9.8'], teaches: '9.7 «La importancia del Silencio», 9.8 «Como sostener el silencio»', section: '§4' },
  { topic: 'Escucha activa', lessons: ['9.9', '12.14'], teaches: '9.9 «La escucha activa»; roleplay en 12.14', section: '§4, §16' },
  { topic: 'Cómo mejorar tu comunicación / pilares', lessons: ['9.3', '9.11'], teaches: '9.3, 9.11 «Masterclass -Pilares de la comunicación»', section: '— (solo vídeo)' },
  { topic: 'Organizar el calendario; Calendly', lessons: ['10.1', '10.6'], teaches: '10.1 «Cómo organizar el calendario», 10.6 «Cómo utilizar Calendly»', section: '— (solo vídeo)' },
  { topic: 'Setup de una closer profesional', lessons: ['10.3'], teaches: '10.3 «Setup de una Closer Profesional»', section: '— (solo vídeo)' },
  { topic: 'Grabar las llamadas de ventas (Fathom)', lessons: ['10.4'], teaches: '10.4 «Cómo grabar las llamadas de Ventas» — el enlace es una invitación, no un material', section: '— (sin contenido)' },
  { topic: 'Currículum para captar proyecto', lessons: ['11.2'], teaches: '11.2 «Prepara tu Currículum» — plantilla de Canva no leída (403)', section: '§15 (complemento, no la plantilla)' },
  { topic: 'Grupos de Facebook, grupos de Skool y portales de empleo', lessons: ['11.3', '11.4', '11.5'], teaches: '11.3, 11.4, 11.5', section: '§15' },
  { topic: 'Cómo medir los resultados de la captación', lessons: ['11.6'], teaches: '11.6 «Cómo medir los resultados»', section: '§15' },
  { topic: 'Vídeo de presentación para aplicar a proyectos', lessons: ['11.7'], teaches: '11.7 «Vídeo de Presentación.»', section: '§15' },
  { topic: 'Lo que busca un dueño cuando contrata una closer', lessons: ['11.8'], teaches: '11.8 «Lo que busca un dueño»', section: '§15 (complemento)' },
  { topic: 'Cómo proyectarte en la entrevista', lessons: ['4.6', '11.9'], teaches: '4.6 «Cómo proyectarte en la entrevista», 11.9 «Como proyectarte en la Entrevista»', section: '— (solo vídeo)' },
  { topic: 'Sesgos psicológicos, autosabotaje, síndrome de la impostora', lessons: ['12.6', '12.7', '12.8'], teaches: '12.6 «Sesgos psicológicos», 12.7 «Como dejar de Autosabotearte», 12.8 «Síndrome de la impostora»', section: '§1.9 (sesgo de aprobación)' },
  { topic: 'Potenciar la empatía', lessons: ['12.5'], teaches: '12.5 «Potencia a la empatía»', section: '— (solo vídeo)' },
  { topic: 'Roleplays de llamada completa y clientas difíciles', lessons: ['12.29', '12.30', '12.31', '12.32', '12.33', '12.34', '12.35'], teaches: '12.29–12.35 (carpeta «Llamada completa»)', section: '§16' },
];

export const CLASSROOM_TOTALS = {
  modules: 12,
  lessons: 130,
  topics: 64,
};
