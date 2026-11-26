// Publicaciones de redes (grupos de Facebook, canales de Telegram, comunidades de Skool, Reddit) → candidatos a oferta.
// Una publicación no trae «título de puesto»: trae texto. Solo se acepta la que OFRECE trabajo de ventas; la de quien lo busca, la de
// quien vende un curso y la charla se descartan. Módulo PURO (sin red). No infiere empresa, sueldo ni fechas: el texto va tal cual.
// Los campos reales de los actores de Facebook y Telegram aún no se han visto (sus pruebas no han devuelto datos): la lectura es
// tolerante y `raw.item_keys` (ya guardado) dirá qué campos llegan para ajustarla.

/** Rol de ventas que interesa a la academia: closer, setter, SDR/BDR, cold calling, televenta, comercial. */
const ROLE = /\b(closers?|setters?|sdrs?|bdrs?|appointment\s+sett\w*|cold\s*call\w*|llamadas?\s+en\s+fr[ií]o|televent\w*|teleoperador\w*|vendedor(?:a|es|as)?|comerciales?|ventas|sales|business\s+development|high[\s-]?ticket)\b/i;
/** Quien ofrece el puesto (español e inglés). */
const HIRING = /\b(busc(?:o|amos|a|an)|necesit(?:o|amos|a|an)|se\s+busca|se\s+necesita|contratamos|contrata|incorporamos|vacantes?|oferta\s+de\s+(?:empleo|trabajo)|hiring|we(?:'|\s)?re\s+looking|we\s+are\s+looking|looking\s+for|seeking|join\s+our\s+team|apply\s+(?:now|here|to)|env[ií]a\s+tu\s+(?:cv|perfil)|oportunidad\s+(?:laboral|de\s+trabajo))\b/i;
/** Quien busca trabajo: no es una oferta. */
const SEEKER = /(\bsoy\s+(?:un\s+|una\s+)?(?:closer|setter|vendedor|vendedora|sdr)\b|\bbusco\s+(?:trabajo|empleo|oportunidades?|equipo|proyecto)\b|\bme\s+ofrezco\b|\bdisponible\s+para\b|\bopen\s+to\s+work\b|\blooking\s+for\s+(?:a\s+)?(?:job|work|opportunit)|\bhire\s+me\b|\bofrezco\s+mis\s+servicios\b|\bi(?:'|\s)?m\s+an?\s+(?:closer|setter)\b|\bmi\s+cv\b)/i;
/** Venta de formación o grupo: no es una oferta, salvo que además diga con claridad que contrata. */
const COURSE = /(\bcurso\b|\bmasterclass\b|\bformaci[oó]n\b|\bmentor[ií]a\b|\baprende\s+a\b|\bwebinar\b|\bgarant[ií]a\b|\bplazas\s+limitadas\b|\binscr[ií]b\w*|\bcourse\b|\bbootcamp\b|\blearn\s+how\s+to\b)/i;
const STRONG_HIRING = /(\bbuscamos\b|\bcontratamos\b|\bse\s+busca\b|\bse\s+necesita\b|\bvacantes?\b|\bwe(?:'|\s)?re\s+hiring\b|\bwe\s+are\s+hiring\b|\bnow\s+hiring\b)/i;

export const POST_TEXT_KEYS = ['text', 'message', 'body', 'posttext', 'postcontent', 'caption', 'selftext'];
/** Campos que delatan una oferta de empleo «de verdad»: con alguno de ellos el elemento NO es una publicación. */
export const JOB_KEYS = ['company', 'companyname', 'employer', 'organization', 'hiringorganization', 'jobtitle', 'positiontitle', 'positionname', 'jobname', 'joburl', 'joburldirect', 'jobdirecturl', 'applyurl', 'jobpostingurl', 'salary', 'salaryrange', 'jobtype', 'employmenttype'];

/** ¿La publicación ofrece un puesto de ventas? Texto = título + cuerpo. */
export function offersSalesJob(textValue: string): boolean {
  const t = textValue.replace(/\s+/g, ' ').trim();
  if (t.length < 20) return false;
  if (SEEKER.test(t)) return false;
  if (!ROLE.test(t) || !HIRING.test(t)) return false;
  if (COURSE.test(t) && !STRONG_HIRING.test(t)) return false;
  return true;
}

/** Primera línea del texto como título (≤ 110 caracteres, cortado en palabra). */
export function headline(body: string): string {
  const line = body.split(/\r?\n/).map(l => l.trim()).find(Boolean) ?? '';
  const clean = line.replace(/\s+/g, ' ');
  if (clean.length <= 110) return clean;
  const cut = clean.slice(0, 110), space = cut.lastIndexOf(' ');
  return `${(space > 60 ? cut.slice(0, space) : cut).trim()}…`;
}
