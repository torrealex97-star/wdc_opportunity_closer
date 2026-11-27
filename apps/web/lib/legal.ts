// Datos del responsable del tratamiento: los pone el propietario por variables de entorno (Vercel). Mientras falten, la política
// los muestra como «pendiente de completar»: no se inventa ninguna razón social, CIF ni dirección.
const pending = '[pendiente de completar]';
export const legalEntity = () => ({
  name: process.env.LEGAL_ENTITY_NAME?.trim() || pending,
  taxId: process.env.LEGAL_ENTITY_TAX_ID?.trim() || pending,
  address: process.env.LEGAL_ENTITY_ADDRESS?.trim() || pending,
  email: process.env.LEGAL_PRIVACY_EMAIL?.trim() || pending,
});
export const POLICY_VERSION = 'v3-borrador', POLICY_DATE = '2026-10-25';
export const TERMS_VERSION = 'v1-borrador', TERMS_DATE = '2026-10-25';

// Texto del consentimiento de voz (se muestra y se acepta ANTES de la primera sesión de voz continua). BORRADOR: lo revisa un profesional
// antes de activar VOICE_ROLEPLAY; la versión guardada en student_voice_consent es VOICE_CONSENT_VERSION (lib/voice.ts).
export const VOICE_CONSENT_TEXT = [
  'Voy a practicar hablando con una voz de inteligencia artificial. Para ello, mi voz se envía en directo a un proveedor de voz que la convierte en texto y genera la respuesta hablada.',
  'Women Digital Closers no guarda mi audio. Lo procesa en directo un proveedor de voz con el que habrá un acuerdo de retención cero antes de activar esta función. Solo se conserva el texto de la conversación y la nota, para darme feedback y que yo pueda repasarlos; puedo borrarlos desde mi perfil.',
  'Puedo practicar hasta 10 minutos al día. Al llegar al límite la sesión se corta y se me avisa.',
  'Puedo retirar este consentimiento cuando quiera desde mi perfil y seguir practicando por escrito, sin ninguna penalización.',
  'No hablaré de datos personales de terceros ni de información confidencial de mi empleo actual.',
] as const;
// Consentimiento de los avisos rápidos por email (casilla propia en el perfil de la alumna, revocable). BORRADOR: lo revisa un profesional
// antes de activar STUDENT_ALERTS_ENABLED; la versión guardada en student_alert_prefs es ALERTS_CONSENT_VERSION (lib/studentAlerts.ts).
export const ALERTS_CONSENT_TEXT = [
  'Quiero recibir por email, en mi dirección de acceso, avisos con ofertas nuevas que coincidan con los perfiles que he elegido.',
  'Recibiré como máximo 3 ofertas al día, en un solo correo. Cada oferta la ha revisado el equipo; aun así debo comprobarla en el enlace de la empresa antes de aplicar.',
  'El emparejamiento es automático y usa solo mi perfil dentro de la plataforma; mis datos no se envían a ningún modelo de inteligencia artificial. Solo se usa mi email para enviarme el aviso.',
  'Puedo darme de baja cuando quiera desde mi perfil o desde el enlace de cada correo, sin ninguna penalización.',
] as const;
export const COOKIES_VERSION = 'v1-borrador', COOKIES_DATE = '2026-11-24';

// Términos del formulario público de empleadores (/empleadores). BORRADOR: lo revisa un profesional antes de difundir el enlace.
export const EMPLOYER_TERMS_VERSION = 'v1-borrador', EMPLOYER_TERMS_DATE = '2026-11-26';
export const EMPLOYER_TERMS_TEXT = [
  'Confirmo que la oferta es real, que tengo autoridad para publicarla en nombre de la empresa y que cumple la ley: sin discriminación, sin cobrar a la candidata por acceder al puesto y sin prometer ingresos que no pueda cumplir.',
  'Women Digital Closers revisa la oferta antes de mostrarla a sus alumnas y puede rechazarla, editarla o retirarla sin que esté obligada a publicarla. Publicarla no crea ninguna relación laboral ni de intermediación con la academia.',
  'El pago y las condiciones que escribo son los míos: la academia no los completa ni los infiere. Las candidatas se ponen en contacto con la empresa por el enlace que indico.',
  'Mi nombre y mi email se guardan solo para poder contactarme sobre esta oferta y no se muestran a las alumnas. No se guarda mi dirección IP, solo una huella diaria para frenar abusos.',
] as const;
