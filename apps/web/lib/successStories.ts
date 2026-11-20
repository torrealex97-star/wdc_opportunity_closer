// Salón del éxito: casos reales de alumnas de Women Digital Closer. Cada ficha enlaza al vídeo que
// ellas grabaron y resume qué se puede aprender y qué mensaje se llevan. Son sus historias, no una
// promesa de resultados: la app no afirma que todas vayan a conseguir lo mismo.
export type SuccessStory = {
  id: string;
  name: string;
  /** Id de YouTube (el vídeo completo, no un fragmento). */
  videoId: string;
  /** Lo que se puede aprender de su caso, en una frase. */
  learn: string;
  /** Su mensaje, en sus palabras. */
  message: string;
  /** Etiqueta corta del tema que ilustra, para leer la rejilla de un vistazo. */
  theme: string;
};

export const SUCCESS_STORIES: SuccessStory[] = [
  {
    id: 'briana',
    name: 'Briana',
    videoId: 'dpdaZecblNk',
    theme: 'Método',
    learn: 'Cómo confiar plenamente en el método y estructurar conversaciones de valor desde el inicio.',
    message: 'Romper la barrera del miedo inicial es el primer paso para dominar llamadas de alto valor.',
  },
  {
    id: 'bea',
    name: 'Bea',
    videoId: 'RL0VhEPb8sE',
    theme: 'Constancia',
    learn: 'La importancia de la constancia, la disciplina diaria y la aplicación rigurosa de las técnicas aprendidas.',
    message: 'Los resultados llegan cuando decides apostar por tu crecimiento profesional y mantienes el foco.',
  },
  {
    id: 'angy',
    name: 'Angy',
    videoId: 'mY2fLdEgnuk',
    theme: 'Seguridad',
    learn: 'Gestión emocional durante la llamada y cómo transmitir seguridad al prospecto.',
    message: 'La seguridad no nace de la experiencia previa, sino de la preparación y la práctica continua.',
  },
  {
    id: 'monica',
    name: 'Monica',
    videoId: 'OtFwlzJz-0s',
    theme: 'Escucha',
    learn: 'Enfoque en la escucha activa y comprensión profunda de las necesidades del cliente.',
    message: 'Cerrar no es convencer; es guiar a la persona adecuada hacia la decisión correcta.',
  },
  {
    id: 'aranxa',
    name: 'Aranxa',
    videoId: 'AuOlvXqqZuo',
    theme: 'Mentalidad',
    learn: 'Superación del síndrome de la impostora y consolidación de la mentalidad de ventas.',
    message: 'Tu mentalidad define tu techo de ingresos; cuando crees en el servicio, las objeciones desaparecen.',
  },
  {
    id: 'carla-segura',
    name: 'Carla Segura',
    videoId: 'ZsZVlkDok-c',
    theme: 'Objeciones',
    learn: 'Adaptabilidad a diferentes perfiles de clientes y fluidez en el manejo de objeciones comunes.',
    message: 'Cada «no» en una llamada es solo un dato más para perfeccionar tu técnica de cierre.',
  },
  {
    id: 'yamila',
    name: 'Yamila',
    videoId: 'UfFV5mweum4',
    theme: 'Reinvención',
    learn: 'Cómo dar el salto hacia las ventas digitales aprovechando las habilidades personales previas.',
    message: 'Reinventarse en el mundo digital es completamente viable cuando cuentas con el método adecuado.',
  },
  {
    id: 'maitane',
    name: 'Maitane',
    videoId: 'yJ6_z24JEeE',
    theme: 'Cierre',
    learn: 'Precisión en el cierre y cómo mantener una conversación natural sin sonar insistente.',
    message: 'La empatía y la profesionalidad son las mejores herramientas de una closer moderna.',
  },
  {
    id: 'jenifer',
    name: 'Jenifer',
    videoId: 'Ladi3gx7Fzo',
    theme: 'Rutina',
    learn: 'El día a día real de una closer activa, organización del tiempo y rutina de trabajo.',
    message: 'Vivir de las ventas digitales no es una teoría; es una rutina diaria accesible y transformadora.',
  },
  {
    id: 'lisette',
    name: 'Lisette',
    videoId: 'XIMNWEw299g',
    theme: 'Desde cero',
    learn: 'La progresión paso a paso de alguien que empieza completamente desde cero.',
    message: 'No necesitas experiencia comercial previa para convertirte en una profesional cotizada; solo método y acción.',
  },
  {
    id: 'anahita',
    name: 'Anahita',
    videoId: 'RjGnH7uZd6g',
    theme: 'Decisión',
    learn: 'La determinación para cambiar de trayectoria y asimilar habilidades de alto valor rápidamente.',
    message: 'Cuando tomas la decisión firme de cambiar tu vida laboral, todo el esfuerzo encaja.',
  },
  {
    id: 'noelia',
    name: 'Noelia',
    videoId: 'P9NXvsMwxYE',
    theme: 'Miedo al rechazo',
    learn: 'Cómo superar el miedo al rechazo y construir llamadas efectivas desde los primeros intentos.',
    message: 'El punto de partida no determina tu éxito, sino tu constancia para seguir practicando cada día.',
  },
  {
    id: 'marta',
    name: 'Marta',
    videoId: 'WnVgKFSjm1M',
    theme: 'Compromiso',
    learn: 'El impacto de tomar una decisión valiente y comprometerse al 100% con la profesión.',
    message: 'Un solo paso firme hacia adelante puede transformar por completo tu libertad financiera y personal.',
  },
];

/** Miniatura pública de YouTube; solo se pinta al pulsar play, junto al reproductor. */
export const youtubeEmbed = (videoId: string) => `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&autoplay=1`;
export const youtubeWatch = (videoId: string) => `https://youtu.be/${videoId}`;
