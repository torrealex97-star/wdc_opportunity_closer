// Banco de preguntas reales de alumna con la sección de `metodo-wdc` y la lección del Classroom
// donde se responde. Es el patrón con el que se mide la recuperación del asistente sin llamar al
// modelo: si el trozo correcto no entra en el top-3, la respuesta citará otra sección.
//
// Reglas del banco:
// 1. La pregunta se escribe como la haría una alumna (tuteo, coloquial, sin el vocabulario de la
//    academia): así se mide el salto entre su vocabulario y el del material.
// 2. `section` es el id del trozo de `wdcKnowledge.ts` que debe recuperarse (se compara por prefijo,
//    porque un trozo largo puede estar partido en varias piezas).
// 3. `lesson` es la lección del Classroom que la respuesta debe citar.
// 4. `outOfScope: true` = la academia no lo responde: lo correcto es NO recuperar nada y decir que no
//    está en la formación (precio del programa, garantías, datos de alumnas).
/**
 * @typedef {{ id: string, question: string, section: string | null, lesson: string | null, outOfScope?: true }} GoldenQuestion
 * `section`: trozo esperado (null si no está en la formación). `lesson`: lección del Classroom que debe citarse.
 */

/** @type {GoldenQuestion[]} */
export const GOLDEN_QUESTIONS = [
  // ── Identidad y mentalidad ────────────────────────────────────────────────────────────────
  { id: 'miedo-al-no', question: '¿Qué hago si me da miedo que me diga que no?', section: '1-identidad-y-mentalidad--1-2-el-rechazo-es-estadistico-no-personal', lesson: '3.2' },
  { id: 'miedo-a-molestar', question: 'Me da cosa llamar y molestar, ¿cómo lo gestiono?', section: '1-identidad-y-mentalidad--1-3-el-problema-del-prospecto-es-mas-grande-que-tu-miedo', lesson: '3.2' },
  { id: 'dolor-superficial', question: '¿Por qué el dolor superficial no vende?', section: '1-identidad-y-mentalidad--1-4-dolor-superficial-frente-a-dolor-real', lesson: '5.2' },
  { id: 'preparar-llamada', question: '¿Qué hago justo antes de una llamada para ir centrada?', section: '1-identidad-y-mentalidad--1-7-ritual-antes-de-la-llamada', lesson: '3.2' },
  { id: 'cobrar-miedo', question: 'Me cuesta pedir dinero, siento que no lo merezco', section: '1-identidad-y-mentalidad--1-8-dinero-y-merecimiento', lesson: '3.6' },
  { id: 'caer-bien', question: 'Siempre intento caer bien, ¿eso me quita autoridad?', section: '1-identidad-y-mentalidad--1-9-el-sesgo-de-aprobacion-por-que-cuesta-la-autoridad-a-las-mujeres', lesson: '3.5' },
  { id: 'apertura-cinco-lineas', question: '¿Cómo empiezo la llamada en las primeras frases?', section: '1-identidad-y-mentalidad--1-10-guion-de-cinco-lineas-y-banderas-rojas', lesson: '3.2' },

  // ── Fundamentos del high ticket y valor ───────────────────────────────────────────────────
  { id: 'que-es-high-ticket', question: '¿Qué es vender high ticket exactamente?', section: '2-fundamentos-del-high-ticket', lesson: '2.3' },
  { id: 'mostrar-valor', question: '¿Cómo muestro el valor sin enumerar características?', section: '3-mostrar-el-valor', lesson: '2.5' },

  // ── Comunicación con autoridad ────────────────────────────────────────────────────────────
  { id: 'hablar-con-autoridad', question: '¿Cómo hablo con más autoridad sin sonar agresiva?', section: '4-comunicacion-con-autoridad', lesson: '2.6' },
  { id: 'palabras-que-restan', question: '¿Qué palabras me hacen perder autoridad?', section: '4-comunicacion-con-autoridad', lesson: '2.9' },
  { id: 'silencio-tras-pedir', question: 'Después de pedir la decisión, ¿qué hago con el silencio?', section: '4-comunicacion-con-autoridad', lesson: '9.7' },
  { id: 'sostener-silencio', question: 'No aguanto los silencios, los relleno. ¿Cómo lo cambio?', section: '4-comunicacion-con-autoridad', lesson: '9.8' },
  { id: 'escucha-activa', question: '¿Cómo se hace la escucha activa en una llamada?', section: '4-comunicacion-con-autoridad', lesson: '9.9' },

  // ── Emoción, lógica y precio ──────────────────────────────────────────────────────────────
  { id: 'logica-vs-emocion', question: '¿Vendo con lógica o con emoción?', section: '5-emocion-y-logica', lesson: '2.7' },
  { id: 'no-bajar-precio', question: '¿Por qué no debería bajar el precio si me lo piden?', section: '6-precio-descuento-y-autoridad', lesson: '2.8' },
  { id: 'descuento', question: '¿Puedo hacer un descuento para cerrar hoy?', section: '6-precio-descuento-y-autoridad', lesson: '2.8' },
  { id: 'psicologia-precio', question: '¿Cómo funciona la psicología del precio?', section: '6-precio-descuento-y-autoridad', lesson: '2.4' },

  // ── Psicología de compra ──────────────────────────────────────────────────────────────────
  { id: 'tres-pilares', question: '¿Cuáles son los tres pilares para que alguien compre?', section: '7-psicologia-de-compra', lesson: '5.3' },
  { id: 'niveles-conciencia', question: '¿Qué son los niveles de conciencia del cliente?', section: '7-psicologia-de-compra', lesson: '4.5' },
  { id: 'tipos-clientes', question: '¿Cómo trato a una clienta dominante o escéptica?', section: '7-psicologia-de-compra', lesson: '5.9' },
  { id: 'tono-ritmo', question: '¿Qué tono y qué ritmo llevo en la llamada?', section: '7-psicologia-de-compra', lesson: '5.8' },

  // ── Estructura de la llamada ─────────────────────────────────────────────────────────────
  { id: 'orden-llamada', question: '¿Cuál es el orden de una llamada de ventas?', section: '8-estructura-de-la-llamada', lesson: '6.1' },
  { id: 'marco', question: '¿Qué es sentar el marco y cómo lo hago?', section: '8-estructura-de-la-llamada', lesson: '6.2' },
  { id: 'confianza', question: '¿Cómo genero confianza en los primeros minutos?', section: '8-estructura-de-la-llamada', lesson: '6.2' },

  // ── Cualificación ────────────────────────────────────────────────────────────────────────
  { id: 'brecha-numeros', question: '¿Cómo saco la brecha con números sin que parezca un interrogatorio?', section: '9-cualificacion', lesson: '6.3' },
  { id: 'discovery', question: '¿Qué preguntas hago en el discovery?', section: '9-cualificacion', lesson: '6.3' },
  { id: 'cuando-hablo-precio', question: '¿En qué momento de la llamada hablo del precio?', section: '9-cualificacion', lesson: '6.3' },

  // ── Presentación ─────────────────────────────────────────────────────────────────────────
  { id: 'presentar-oferta', question: '¿Cómo presento la oferta en tres minutos?', section: '10-presentacion-de-la-oferta', lesson: '6.4' },

  // ── Cierre ───────────────────────────────────────────────────────────────────────────────
  { id: 'pedir-decision', question: '¿Qué frase uso para pedir la decisión al final?', section: '11-cierre', lesson: '6.5' },
  { id: 'tipos-cierre', question: '¿Cuántos tipos de cierre hay y cuál uso?', section: '11-cierre', lesson: '6.5' },
  { id: 'tras-primer-no', question: 'Me dice que no y no sé si insistir, ¿qué hago?', section: '11-cierre', lesson: '6.8' },

  // ── Objeciones ───────────────────────────────────────────────────────────────────────────
  { id: 'objecion-precio', question: 'Me dice que es muy caro, ¿qué le contesto?', section: '12-objeciones--12-3-las-diez-objeciones-y-su-respuesta', lesson: '7.2' },
  { id: 'objecion-pensarlo', question: 'Me dice que lo tiene que pensar, ¿qué le digo?', section: '12-objeciones--12-2-guion-de-tres-pilares-para-lo-tengo-que-pensar', lesson: '7.3' },
  { id: 'objecion-pareja', question: 'Me dice que lo tiene que consultar con su pareja, ¿qué le contesto?', section: '12-objeciones--12-3-las-diez-objeciones-y-su-respuesta', lesson: '7.5' },
  { id: 'objecion-tiempo', question: 'Me dice que ahora no tiene tiempo, ¿cómo sigo?', section: '12-objeciones--12-3-las-diez-objeciones-y-su-respuesta', lesson: '7.4' },
  { id: 'objecion-capaz', question: 'Dice que no sabe si será capaz de hacerlo', section: '12-objeciones--12-3-las-diez-objeciones-y-su-respuesta', lesson: '7.6' },
  { id: 'objecion-opciones', question: 'Quiere valorar otras opciones antes de decidir', section: '12-objeciones--12-3-las-diez-objeciones-y-su-respuesta', lesson: '7.7' },
  { id: 'objecion-probe', question: 'Ya probó algo parecido y no le funcionó', section: '12-objeciones--12-3-las-diez-objeciones-y-su-respuesta', lesson: '7.8' },
  { id: 'objecion-info', question: 'Me pide que le mande información y desaparecer', section: '12-objeciones--12-3-las-diez-objeciones-y-su-respuesta', lesson: '7.9' },
  { id: 'prevenir-objeciones', question: '¿Cómo evito que aparezcan las objeciones?', section: '12-objeciones--12-1-tesis-se-previenen-no-se-manejan', lesson: '6.9' },
  { id: 'objecion-fantasma', question: '¿Qué es una objeción fantasma y cómo la detecto?', section: '12-objeciones--12-1-tesis-se-previenen-no-se-manejan', lesson: '6.10' },
  { id: 'como-no-responder', question: '¿Qué no debo hacer cuando me ponen una objeción?', section: '12-objeciones--12-4-como-no-responder', lesson: '7.8' },
  { id: 'frases-objeciones', question: 'Necesito frases hechas para las objeciones', section: '12-objeciones--12-6-banco-de-frases-del-playbook', lesson: '7.9' },

  // ── Seguimiento y métricas ───────────────────────────────────────────────────────────────
  { id: 'seguimiento', question: '¿Cómo hago un seguimiento que cierre?', section: '13-seguimiento', lesson: '8.1' },
  { id: 'fases-seguimiento', question: '¿Cuáles son las fases del seguimiento?', section: '13-seguimiento', lesson: '8.3' },
  { id: 'no-show', question: '¿Cómo confirmo la cita para que no me haga no-show?', section: '13-seguimiento', lesson: '8.4' },
  { id: 'metricas', question: '¿Qué métricas debe dominar una closer?', section: '14-metricas', lesson: '8.6' },
  { id: 'ratio-habla', question: '¿Cuánto debería hablar yo frente a la clienta?', section: '14-metricas', lesson: '8.6' },
  { id: 'crm', question: '¿Para qué uso el CRM en el seguimiento?', section: '13-seguimiento', lesson: '8.5' },

  // ── Captación de proyecto ────────────────────────────────────────────────────────────────
  { id: 'buscar-empresas', question: '¿Dónde encuentro empresas que contraten closers?', section: '15-captacion-de-proyecto-la-alumna-buscando-trabajo', lesson: '11.3' },
  { id: 'mensaje-candidatura', question: '¿Qué le escribo a una empresa para ofrecerme?', section: '15-captacion-de-proyecto-la-alumna-buscando-trabajo', lesson: '11.3' },
  { id: 'curriculum', question: '¿Cómo preparo mi currículum de closer?', section: '15-captacion-de-proyecto-la-alumna-buscando-trabajo', lesson: '11.2' },
  { id: 'medir-captacion', question: '¿Cómo mido si mi captación funciona?', section: '15-captacion-de-proyecto-la-alumna-buscando-trabajo', lesson: '11.6' },

  // ── Roleplay y mapa ──────────────────────────────────────────────────────────────────────
  { id: 'roleplay', question: '¿Cómo practico un roleplay de cualificación?', section: '16-entrenamiento-y-roleplay-como-ensena-la-academia', lesson: '12.10' },
  { id: 'donde-se-ensena', question: '¿Dónde se enseña la objeción de pareja?', section: '0-mapa-de-la-formacion-los-modulos-las-clases-y-donde-esta-cada-cosa--0-3-buscador-de-temas-si-preguntan-por', lesson: '7.5' },

  // ── Fuera de la formación: lo correcto es decir que no está ──────────────────────────────
  { id: 'fuera-precio-programa', question: '¿Cuánto cuesta el programa de Women Digital Closers?', section: null, lesson: null, outOfScope: true },
  { id: 'fuera-garantia', question: '¿Me garantizáis que voy a conseguir clientes?', section: null, lesson: null, outOfScope: true },
  { id: 'fuera-notas', question: '¿Qué nota sacó la alumna del grupo de marzo en la última llamada?', section: null, lesson: null, outOfScope: true },
  { id: 'fuera-paella', question: '¿Me das una receta de paella para el domingo?', section: null, lesson: null, outOfScope: true },
];

// Preguntas de control que NO se usaron para ajustar la recuperación: sirven para saber si las
// mejoras generalizan o solo memorizan el banco de arriba. Se miden con `--holdout`.
/** @type {GoldenQuestion[]} */
export const HOLDOUT_QUESTIONS = [
  { id: 'h-pensarlo-cierre', question: '¿Cómo cierro cuando dice que lo va a pensar?', section: '12-objeciones--12-2-guion-de-tres-pilares-para-lo-tengo-que-pensar', lesson: '7.3' },
  { id: 'h-descuento', question: '¿Qué hago si me pide un descuento?', section: '6-precio-descuento-y-autoridad', lesson: '2.8' },
  { id: 'h-ratio', question: '¿Cómo mido mi ratio de cierre?', section: '14-metricas', lesson: '8.6' },
  { id: 'h-video', question: '¿Cómo preparo el vídeo de presentación?', section: '15-captacion-de-proyecto-la-alumna-buscando-trabajo', lesson: '11.7' },
  { id: 'h-dinero', question: '¿Qué le digo si dice que no tiene dinero?', section: '12-objeciones--12-3-las-diez-objeciones-y-su-respuesta', lesson: '7.2' },
  { id: 'h-tono-defensiva', question: '¿Cómo evito ponerme a la defensiva con el tono?', section: '7-psicologia-de-compra', lesson: '5.8' },
  // La clase es 12.30, pero el método escrito (§16) explica el patrón sin citarla: se mide sección.
  { id: 'h-llamada-completa', question: '¿Cómo practico una llamada completa?', section: '16-entrenamiento-y-roleplay-como-ensena-la-academia', lesson: null },
  { id: 'h-dolor-real', question: '¿Qué es el dolor real?', section: '1-identidad-y-mentalidad--1-4-dolor-superficial-frente-a-dolor-real', lesson: '5.2' },
  { id: 'h-cada-cuanto', question: '¿Cada cuánto hago seguimiento?', section: '13-seguimiento', lesson: '8.3' },
  { id: 'h-cierre-oferta', question: '¿Cómo pido el cierre justo después de la oferta?', section: '11-cierre', lesson: '6.5' },
];
