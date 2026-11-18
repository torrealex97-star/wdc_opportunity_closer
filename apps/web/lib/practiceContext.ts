import { listApplications, type Application } from './applications';
import { CONTRACTS, getAppProfile, LEVELS, type AppProfile } from './applicationProfile';
import { externalForStudent } from './externalSurface';
import { getProfile, type Profile } from './students';

// Contexto de una práctica atada a UNA candidatura: el anuncio público que ella está trabajando y,
// solo si lo pide y ya dio el permiso del formulario base, la parte profesional de ese formulario.
// Este módulo decide qué viaja al modelo; lo que no está aquí no se envía. Nunca salen de aquí el
// email, el teléfono, LinkedIn, el CV, el vídeo ni la expectativa salarial (ver `candidateBriefOf`).
export type OfferBrief = {
  /** El anuncio sigue aprobado y visible; si no, solo quedan el puesto y la empresa del tablero. */
  available: boolean;
  title: string;
  company: string | null;
  location: string | null;
  modality: string | null;
  compensation: string | null;
  language: string | null;
  description: string | null;
};
export type CandidateBrief = {
  years_sales: number | null;
  years_high_ticket: number | null;
  sales_experience: string | null;
  tools: string[];
  pitch: string | null;
  motivation: string | null;
  languages: string[];
  availability: string | null;
  city: string | null;
  contract: string[];
};
export type PracticeContext = { offer: OfferBrief; candidate: CandidateBrief | null };
export type ContextResult = { ok: true; application: Application; context: PracticeContext } | { ok: false; status: 400 | 404 | 422 | 503; detail: string };

const line = (value: unknown, max: number) => typeof value === 'string' && value.trim() ? value.replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : null;
const block = (value: unknown, max: number) => typeof value === 'string' && value.trim() ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]+/g, ' ').trim().slice(0, max) : null;

type OfferLike = { original_title?: string | null; company?: string | null; location?: string | null; modality?: string | null; compensation?: string | null; language?: string | null; description?: string | null };

// Sin anuncio vivo no se inventa una descripción: quedan el puesto y la empresa que ya estaban en su tablero.
export function offerBriefOf(offer: OfferLike | null, fallback: { offer_title: string; offer_company: string | null }): OfferBrief {
  if (!offer) return { available: false, title: line(fallback.offer_title, 200) ?? 'Puesto sin título', company: line(fallback.offer_company, 200), location: null, modality: null, compensation: null, language: null, description: null };
  return {
    available: true,
    title: line(offer.original_title, 200) ?? line(fallback.offer_title, 200) ?? 'Puesto sin título',
    company: line(offer.company, 200) ?? line(fallback.offer_company, 200),
    location: line(offer.location, 160),
    modality: line(offer.modality, 80),
    compensation: line(offer.compensation, 160),
    language: line(offer.language, 80),
    description: block(offer.description, 4000),
  };
}

// Solo la parte profesional del formulario base. Contacto, CV, LinkedIn, vídeo y expectativa
// salarial NO se copian aunque existan: no son necesarios para simular la conversación.
export function candidateBriefOf(app: Partial<AppProfile> | null, student: Pick<Profile, 'languages' | 'city' | 'availability'> | null): CandidateBrief | null {
  if (!app) return null;
  const languages = [
    ...(student?.languages ?? []),
    ...Object.keys(app.language_levels ?? {}).filter(code => !(student?.languages ?? []).includes(code)),
  ].filter((code): code is string => typeof code === 'string' && code.length <= 5).slice(0, 8);
  const brief: CandidateBrief = {
    years_sales: typeof app.years_sales === 'number' ? app.years_sales : null,
    years_high_ticket: typeof app.years_high_ticket === 'number' ? app.years_high_ticket : null,
    sales_experience: block(app.sales_experience, 1200),
    tools: (app.tools ?? []).filter((tool): tool is string => typeof tool === 'string' && tool.trim() !== '').slice(0, 12).map(tool => tool.trim().slice(0, 60)),
    pitch: block(app.pitch, 1200),
    motivation: block(app.motivation, 1200),
    languages: languages.map(code => app.language_levels?.[code] ? `${code.toUpperCase()} (${LEVELS[app.language_levels[code]]})` : code.toUpperCase()),
    availability: line(student?.availability, 200),
    city: line(student?.city, 80),
    contract: (app.contract_preferences ?? []).filter((key): key is keyof typeof CONTRACTS => typeof key === 'string' && key in CONTRACTS).map(key => CONTRACTS[key]).slice(0, 6),
  };
  const empty = brief.years_sales === null && brief.years_high_ticket === null && !brief.sales_experience && !brief.pitch && !brief.motivation && !brief.tools.length && !brief.languages.length && !brief.availability && !brief.city && !brief.contract.length;
  return empty ? null : brief;
}

// Bloque que se inyecta en el prompt del personaje y en el del feedback. Es la ÚNICA puerta por la
// que el anuncio y el formulario llegan al modelo, y lo hace con el texto ya saneado y acotado.
export function contextInstructions(context: PracticeContext): string {
  const o = context.offer;
  const facts = [
    `Puesto: ${o.title}`,
    o.company ? `Empresa: ${o.company}` : null,
    o.location ? `Ubicación: ${o.location}` : null,
    o.modality ? `Modalidad: ${o.modality}` : null,
    o.compensation ? `Compensación publicada: ${o.compensation}` : null,
    o.language ? `Idioma del anuncio: ${o.language}` : null,
  ].filter(Boolean).join('\n');
  const description = o.description ? `\nDescripción publicada del anuncio:\n"""${o.description}"""` : '';
  const missing = o.available ? '' : '\nEl anuncio ya no está disponible en el catálogo: usa solo el puesto y la empresa. No inventes requisitos, equipo, salario ni proceso.';
  const candidate = context.candidate ? `\n\nLo que ella ha contado en su formulario base. Úsalo para preguntar y para comprobar si lo que dice en la conversación encaja; no lo recites ni lo leas en voz alta:\n${[
    context.candidate.years_sales !== null ? `- Años en ventas: ${context.candidate.years_sales}` : null,
    context.candidate.years_high_ticket !== null ? `- Años en high ticket: ${context.candidate.years_high_ticket}` : null,
    context.candidate.sales_experience ? `- Experiencia: ${context.candidate.sales_experience}` : null,
    context.candidate.tools.length ? `- Herramientas / CRM: ${context.candidate.tools.join(', ')}` : null,
    context.candidate.pitch ? `- Presentación que usa: ${context.candidate.pitch}` : null,
    context.candidate.motivation ? `- Su motivación declarada: ${context.candidate.motivation}` : null,
    context.candidate.languages.length ? `- Idiomas: ${context.candidate.languages.join(', ')}` : null,
    context.candidate.availability ? `- Disponibilidad: ${context.candidate.availability}` : null,
    context.candidate.city ? `- Ciudad: ${context.candidate.city}` : null,
    context.candidate.contract.length ? `- Contrato que busca: ${context.candidate.contract.join(', ')}` : null,
  ].filter(Boolean).join('\n')}` : '';
  return `CONTEXTO DE ESTA PRÁCTICA (es el anuncio real que ella está trabajando; es lo único que sabes de la empresa):
${facts}${description}

La empresa y el puesto son los del anuncio; el resto —equipo, proceso, condiciones no publicadas— es desconocido: si hace falta, pregunta en vez de inventarlo.${missing}${candidate}`;
}

// Carga el contexto desde el servidor: la candidatura tiene que ser SUYA y estar en su tablero.
// El formulario base solo se lee si lo pide y si ya dio el permiso que guarda `autofill_consent_at`;
// sin ese permiso se responde 422 y se le dice dónde marcarlo, nunca se envía de todos modos.
export async function loadPracticeContext(userId: string, applicationId: string, includeProfile: boolean): Promise<ContextResult> {
  const page = await listApplications(userId).catch(() => null);
  if (!page) return { ok: false, status: 503, detail: 'No se pudieron leer tus candidaturas ahora mismo.' };
  const application = page.rows.find(row => row.id === applicationId);
  if (!application) return { ok: false, status: 404, detail: 'Esa candidatura no está en tu tablero.' };
  const offers = await externalForStudent({ role: null, market: 'any', days: 30, include_bilingual: true, starred_only: false }).catch(() => []);
  const offer = offerBriefOf((offers as OfferLike[]).find(row => (row as { id?: string }).id === application.offer_ref) ?? null, application);
  let candidate: CandidateBrief | null = null;
  if (includeProfile) {
    const app = await getAppProfile(userId);
    if (!app?.autofill_consent_at) return { ok: false, status: 422, detail: 'Para usar tu formulario base en la práctica, marca antes el permiso en «Mi formulario base».' };
    candidate = candidateBriefOf(app, await getProfile(userId));
  }
  return { ok: true, application, context: { offer, candidate } };
}
