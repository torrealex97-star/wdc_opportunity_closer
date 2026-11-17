// Proveedor de IA compartido por la sala de práctica y el asistente de respuestas: una sola llamada,
// una sola lista blanca de modelos y un solo mapa de fallos. Antes cada ruta tenía su copia y podían
// divergir (modelo permitido en una y no en la otra, mensajes distintos para el mismo 429).
// La clave vive solo en el servidor: aquí nunca se lee del cliente.
const BASE = (process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/$/, '');
export const ALLOWED_MODELS = ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'] as const;
const DEFAULT_MODEL = ALLOWED_MODELS[0];

// El modelo se elige por entorno, pero solo dentro de la lista blanca: un valor inventado cae al
// defecto en vez de llegar al proveedor.
export function resolveModel(...preferred: Array<string | undefined>): string {
  return preferred.find(value => value && (ALLOWED_MODELS as readonly string[]).includes(value)) ?? DEFAULT_MODEL;
}

export type ProviderFailure = 'missing_key' | 'rate_limited' | 'provider' | 'unavailable' | 'invalid_output';
export type ModelCall = {
  model: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature: number;
  maxTokens: number;
  // Esquema estricto: quien llama valida después la salida, pero el proveedor ya la devuelve con forma.
  schema?: { name: string; schema: unknown };
};

export const hasModelKey = () => Boolean(process.env.GROQ_API_KEY);

export async function callModel({ model, messages, temperature, maxTokens, schema }: ModelCall): Promise<{ ok: true; content: string } | { ok: false; error: ProviderFailure }> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return { ok: false, error: 'missing_key' };
  try {
    const response = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model, messages, temperature, max_tokens: maxTokens,
        ...(schema ? { response_format: { type: 'json_schema', json_schema: { ...schema, strict: true } } } : {}),
      }),
      signal: AbortSignal.timeout(20000),
      cache: 'no-store',
    });
    if (!response.ok) return { ok: false, error: response.status === 429 ? 'rate_limited' : 'provider' };
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    return typeof content === 'string' && content.trim() ? { ok: true, content } : { ok: false, error: 'invalid_output' };
  } catch {
    return { ok: false, error: 'unavailable' };
  }
}

// Respuesta de error común. `feature` es lo que la alumna estaba usando («La sala de práctica»,
// «El asistente de respuestas») para que el mensaje diga qué no está disponible.
export function providerFailure(code: ProviderFailure, feature: string): Response {
  const message = code === 'missing_key'
    ? `${feature} no está configurado en este despliegue.`
    : code === 'rate_limited'
      ? 'El proveedor de IA ha limitado las peticiones. Espera un momento y vuelve a intentarlo.'
      : code === 'invalid_output'
        ? 'La respuesta no se pudo verificar y no se muestra nada inventado. Inténtalo otra vez.'
        : 'No se ha podido completar la respuesta. Lo escrito no se ha perdido: vuelve a intentarlo.';
  return Response.json({ detail: message }, { status: code === 'missing_key' ? 503 : code === 'rate_limited' ? 429 : 502 });
}
