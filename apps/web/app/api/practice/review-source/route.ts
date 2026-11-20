import { NextRequest } from 'next/server';
import { originBlocked } from '../../../../lib/adminAuth';
import { callModel, hasModelKey, providerFailure, resolveModel } from '../../../../lib/aiProvider';
import { clientIp, createTurnBudget } from '../../../../lib/practiceBudget';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Prepara una llamada real para revisarla. Tres entradas —audio, enlace o texto— y una sola salida:
// la transcripción etiquetada VENDEDOR/CLIENTE que después se puntúa. Nada se guarda: el audio y el
// texto se usan en esta petición y se descartan. Si no se puede transcribir o extraer, se dice con
// esas palabras en vez de inventar una llamada.
const MODEL = resolveModel(process.env.PRACTICE_MODEL);
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
const MAX_TEXT_CHARS = 16000;
const IP_DAILY = 30;
const budget = createTurnBudget();

const LABEL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['transcript'],
  properties: { transcript: { type: 'string' } },
};

const LABEL_PROMPT = `Recibes la transcripción de una llamada de venta, a veces sin etiquetas de hablante y a veces parcialmente etiquetada.
Devuelve la MISMA llamada, en español, con una línea por intervención y el prefijo "VENDEDOR: " o "CLIENTE: ".
Reglas:
- No resumas, no traduzcas, no completes ni inventes lo que no está.
- Si el texto ya trae etiquetas (vendedor/cliente, closer/lead, agente/cliente), respétalas y normalízalas a VENDEDOR/CLIENTE.
- El que vende o prospecta es VENDEDOR; el otro es CLIENTE.
- Si hay una sola voz y no hay forma de saber quién es el cliente, marca todas las líneas como VENDEDOR.
- Máximo 16000 caracteres de salida. No añadas comentarios.`;

const decode = (value: string) => value
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');

const stripHtml = (html: string) => decode(html
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<\/(p|div|li|br|h[1-6])>/gi, '\n')
  .replace(/<[^>]+>/g, ' '))
  .replace(/[ \t]+/g, ' ')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const youtubeId = (url: URL) =>
  url.hostname.endsWith('youtu.be') ? url.pathname.slice(1).split('/')[0]
  : url.searchParams.get('v') ?? url.pathname.match(/\/(shorts|embed)\/([^/?]+)/)?.[2] ?? '';

// YouTube publica las pistas de subtítulos en el HTML del vídeo. Sin pista no hay transcripción:
// no se inventa a partir del título.
async function fromYouTube(id: string): Promise<{ ok: true; text: string } | { ok: false; detail: string }> {
  const page = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(id)}`, { headers: { 'user-agent': 'Mozilla/5.0', 'accept-language': 'es' } }).catch(() => null);
  if (!page?.ok) return { ok: false, detail: 'No se pudo abrir el vídeo de YouTube.' };
  const html = await page.text();
  const match = html.match(/"captionTracks":(\[.*?\])/);
  if (!match) return { ok: false, detail: 'Ese vídeo no tiene subtítulos públicos, así que no hay transcripción que evaluar. Pega el texto o sube el audio.' };
  const tracks = (() => { try { return JSON.parse(match[1].replace(/\\u0026/g, '&')) as Array<{ baseUrl?: string; languageCode?: string }>; } catch { return []; } })();
  const track = tracks.find(item => item.languageCode?.startsWith('es')) ?? tracks[0];
  if (!track?.baseUrl) return { ok: false, detail: 'No se encontró una pista de subtítulos utilizable en ese vídeo.' };
  const captions = await fetch(track.baseUrl).catch(() => null);
  if (!captions?.ok) return { ok: false, detail: 'YouTube no entregó los subtítulos del vídeo.' };
  const text = decode((await captions.text()).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  if (text.length < 80) return { ok: false, detail: 'Los subtítulos del vídeo están vacíos.' };
  return { ok: true, text };
}

// Fathom publica la transcripción en su página de compartir. Se busca el bloque con hablantes y, si
// no aparece, el texto visible como último recurso (el modelo después separa quién habla).
async function fromPage(url: URL): Promise<{ ok: true; text: string } | { ok: false; detail: string }> {
  const response = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0', 'accept-language': 'es' }, redirect: 'follow' }).catch(() => null);
  if (!response?.ok) return { ok: false, detail: `No se pudo abrir el enlace (HTTP ${response?.status ?? 'sin respuesta'}).` };
  const html = await response.text();
  if (/accounts\.google\.com|sign in to continue/i.test(html) && url.hostname.includes('drive.google.com')) {
    return { ok: false, detail: 'Ese enlace de Drive no es público. Compártelo como «cualquiera con el enlace» o pega la transcripción.' };
  }
  const transcript = html.match(/"transcript"\s*:\s*(\[[\s\S]*?\])\s*[,}]/);
  if (transcript) {
    const lines = (() => {
      try {
        const items = JSON.parse(transcript[1]) as Array<{ speaker?: string; text?: string; speaker_name?: string }>;
        return items.map(item => `${(item.speaker_name ?? item.speaker ?? '').toString()}: ${item.text ?? ''}`.trim()).filter(line => line.length > 5);
      } catch { return []; }
    })();
    if (lines.length) return { ok: true, text: lines.join('\n').slice(0, MAX_TEXT_CHARS) };
  }
  const text = stripHtml(html);
  if (text.length < 200) return { ok: false, detail: 'La página no expone la transcripción de forma legible. Pega el texto o sube el audio.' };
  return { ok: true, text: text.slice(0, MAX_TEXT_CHARS) };
}

async function extractLink(raw: string): Promise<{ ok: true; text: string } | { ok: false; detail: string }> {
  let url: URL;
  try { url = new URL(raw); } catch { return { ok: false, detail: 'El enlace no es una URL válida.' }; }
  if (!/^https?:$/.test(url.protocol)) return { ok: false, detail: 'Solo se aceptan enlaces http o https.' };
  const host = url.hostname.replace(/^www\./, '');
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be') {
    const id = youtubeId(url);
    if (!id) return { ok: false, detail: 'Ese enlace de YouTube no apunta a un vídeo.' };
    return fromYouTube(id);
  }
  if (host === 'fathom.video' || host === 'drive.google.com' || host === 'docs.google.com') return fromPage(url);
  return { ok: false, detail: 'Por ahora se aceptan enlaces de Fathom, Google Drive y YouTube. De otro sitio, pega la transcripción.' };
}

async function labelSpeakers(text: string): Promise<{ ok: true; transcript: string } | { ok: false; detail: string }> {
  const clean = text.slice(0, MAX_TEXT_CHARS);
  if (/^\s*(vendedor|cliente|vendedora|closer|lead|agente)\s*[:：-]/im.test(clean) && clean.split('\n').filter(line => /^(vendedor|cliente|vendedora|closer|lead|agente)\s*[:：-]/i.test(line.trim())).length >= 2) {
    return { ok: true, transcript: clean };
  }
  const result = await callModel({
    model: MODEL,
    messages: [
      { role: 'system', content: LABEL_PROMPT },
      { role: 'user', content: clean },
    ],
    temperature: 0,
    maxTokens: 1400,
    schema: { name: 'labeled_transcript', schema: LABEL_SCHEMA },
  });
  if (!result.ok) return { ok: false, detail: 'No se pudo separar quién habla. Pega la transcripción con líneas «VENDEDOR:» y «CLIENTE:».' };
  try {
    const parsed = JSON.parse(result.content) as { transcript?: unknown };
    const transcript = typeof parsed.transcript === 'string' ? parsed.transcript.trim().slice(0, MAX_TEXT_CHARS) : '';
    if (!transcript) return { ok: false, detail: 'La transcripción llegó vacía. Vuelve a intentarlo o pégala a mano.' };
    return { ok: true, transcript };
  } catch {
    return { ok: false, detail: 'No se pudo leer la transcripción preparada. Pégala con líneas «VENDEDOR:» y «CLIENTE:».' };
  }
}

async function transcribe(file: File): Promise<{ ok: true; text: string } | { ok: false; detail: string }> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return { ok: false, detail: 'La transcripción de audio no está configurada en este despliegue. Pega la transcripción o usa un enlace con subtítulos.' };
  if (file.size > MAX_AUDIO_BYTES) return { ok: false, detail: `El audio supera ${Math.round(MAX_AUDIO_BYTES / 1024 / 1024)} MB. Súbelo más corto o pega la transcripción.` };
  const base = (process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/$/, '');
  const body = new FormData();
  body.set('file', file, file.name || 'llamada.mp3');
  body.set('model', process.env.PRACTICE_TRANSCRIBE_MODEL || 'whisper-large-v3-turbo');
  body.set('language', 'es');
  body.set('response_format', 'text');
  const response = await fetch(`${base}/audio/transcriptions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}` },
    body,
  }).catch(() => null);
  if (!response) return { ok: false, detail: 'No se pudo contactar con el servicio de transcripción.' };
  if (!response.ok) {
    return { ok: false, detail: response.status === 413 ? 'El audio es demasiado largo para el servicio de transcripción.' : `El servicio de transcripción falló (HTTP ${response.status}).` };
  }
  const text = (await response.text()).trim();
  if (text.length < 40) return { ok: false, detail: 'La transcripción salió vacía o casi vacía: el audio puede estar mudo o ser demasiado corto.' };
  return { ok: true, text };
}

export async function POST(request: NextRequest) {
  if (originBlocked(request)) return Response.json({ detail: 'Origen no permitido' }, { status: 403 });
  const noStore = { 'Cache-Control': 'no-store' };
  if (budget.spend(`ip:${clientIp(request.headers)}`, IP_DAILY) === null) {
    return Response.json({ detail: 'Has preparado demasiadas llamadas hoy. Vuelve mañana.' }, { status: 429, headers: noStore });
  }
  const type = request.headers.get('content-type') ?? '';
  try {
    if (type.includes('multipart/form-data')) {
      const form = await request.formData();
      const file = form.get('audio');
      if (!(file instanceof File)) return Response.json({ detail: 'Falta el archivo de audio.' }, { status: 422, headers: noStore });
      const transcribed = await transcribe(file);
      if (!transcribed.ok) return Response.json({ detail: transcribed.detail }, { status: 422, headers: noStore });
      if (!hasModelKey()) return providerFailure('missing_key', 'La separación de hablantes');
      const labeled = await labelSpeakers(transcribed.text);
      if (!labeled.ok) return Response.json({ detail: labeled.detail }, { status: 422, headers: noStore });
      return Response.json({ transcript: labeled.transcript, source: 'audio' }, { headers: noStore });
    }
    const body = await request.json().catch(() => ({})) as { url?: unknown; text?: unknown };
    if (!hasModelKey()) return providerFailure('missing_key', 'La revisión de llamadas');
    let raw: string;
    let source: 'texto' | 'enlace';
    if (typeof body.url === 'string' && body.url.trim()) {
      const extracted = await extractLink(body.url.trim());
      if (!extracted.ok) return Response.json({ detail: extracted.detail }, { status: 422, headers: noStore });
      raw = extracted.text;
      source = 'enlace';
    } else if (typeof body.text === 'string' && body.text.trim()) {
      raw = body.text.trim().slice(0, MAX_TEXT_CHARS);
      source = 'texto';
    } else {
      return Response.json({ detail: 'Envía un enlace, un texto o un audio.' }, { status: 422, headers: noStore });
    }
    const labeled = await labelSpeakers(raw);
    if (!labeled.ok) return Response.json({ detail: labeled.detail }, { status: 422, headers: noStore });
    return Response.json({ transcript: labeled.transcript, source }, { headers: noStore });
  } catch {
    return Response.json({ detail: 'No se pudo preparar la llamada.' }, { status: 500, headers: noStore });
  }
}
