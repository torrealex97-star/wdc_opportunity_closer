// Detalles de pago de una oferta de ventas, leídos SOLO del texto del anuncio con reglas fijas (sin IA): porcentaje de
// comisión, OTE y ticket medio del producto. Se devuelve la frase literal tal como aparece, nunca un número calculado ni
// una moneda supuesta; sin una frase clara, `null` (un hueco no es un cero). No filtra ni oculta nada y no toca el sueldo
// fijo (`salary.ts`). El texto de entrada es el título y la descripción, nada de datos de alumnas.

export type PayDetails = { commission: string | null; ote: string | null; ticket: string | null };

// Importes como se escriben en los anuncios: 45.000, 45 000, 2,000 (formato inglés), 40k, 4k€ y 12000.
const NUM = String.raw`(?:\d{1,3}(?:[.,\s]\d{3})+|\d{1,3}\s?[kK]\b|\d{4,6})`;
const CUR = String.raw`(?:€|eur(?:os)?\b|\$|usd\b|d[oó]lares)`;
const PCT = String.raw`(\d{1,2}(?:[.,]\d)?)\s?%`;
const HAS_CUR = /€|eur(?:os)?\b|\$|usd\b|d[oó]lares/i;

const toNumber = (raw: string) => {
  const k = /k$/i.test(raw.trim());
  const n = Number(raw.replace(/[kK\s.,]/g, ''));
  return k ? n * 1000 : n;
};
const clip = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, 90);

// «10% de comisión», «comisión del 10%», «comisiones entre el 8% y el 12%».
const COMM_AFTER = new RegExp(String.raw`${PCT}(?:\s?(?:-|–|y|a)\s?(?:el\s+)?${PCT})?\s*(?:de\s+|en\s+)?comisi[oó]n(?:es)?`, 'i');
const COMM_BEFORE = new RegExp(String.raw`comisi[oó]n(?:es)?\s*(?:de(?:l)?\s+|entre\s+|hasta\s+)?(?:el\s+)?${PCT}(?:\s?(?:-|–|y|a)\s?(?:el\s+)?${PCT})?`, 'i');

export function commissionFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const flat = text.replace(/\s+/g, ' ');
  for (const re of [COMM_AFTER, COMM_BEFORE]) {
    const m = re.exec(flat);
    if (!m) continue;
    const values = [m[1], m[2]].filter(Boolean).map(v => Number(v.replace(',', '.')));
    // «100 % comisión» es el modelo de pago (solo comisión), no un porcentaje; fuera de 1–50 % no es plausible para un closer.
    if (values.length && values.every(v => v >= 1 && v <= 50)) return clip(m[0]);
  }
  return null;
}

// «OTE 45.000 €», «OTE: 40k», «OTE de 60.000 € - 80.000 €». Solo en mayúsculas: «ote» suelto no es una sigla.
const OTE = new RegExp(String.raw`\bOTE\b\s*[:=]?\s*(?:de\s+|hasta\s+)?${CUR}?\s?(${NUM})\s?${CUR}?(?:\s?(?:-|–|a)\s?${CUR}?\s?(${NUM})\s?${CUR}?)?`, 'i');

export function oteFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = OTE.exec(text.replace(/\s+/g, ' '));
  if (!m || m[0].slice(0, 3) !== 'OTE') return null; // la sigla va en mayúsculas; el resto de la frase no distingue
  const amounts = [m[1], m[2]].filter(Boolean).map(toNumber);
  return amounts.every(n => n >= 10_000 && n <= 500_000) ? clip(m[0]) : null; // fuera de ahí no es un OTE anual plausible
}

// «ticket medio de 3.000 €», «tickets entre USD 2,000 y USD 6,000», «tickets entre 4k€ y 8k€». Exige moneda en la frase: «ticket medio de 3» no es un dato.
// «high ticket» y «alto ticket» son el TIPO de producto, no un importe: se excluyen antes de buscar la cifra.
const TICKET = new RegExp(String.raw`(?<!\bhigh[\s-])(?<!\balto\s)\btickets?\s*(?:medio|promedio)?\s*(?:de|entre|:)?\s*(?:(?:desde|hasta)\s+)?${CUR}?\s?(${NUM}|\d{3})\s?${CUR}?(?:\s?(?:-|–|y|a)\s?${CUR}?\s?(${NUM}|\d{3})\s?${CUR}?)?`, 'i');

export function ticketFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = TICKET.exec(text.replace(/\s+/g, ' '));
  if (!m || !HAS_CUR.test(m[0])) return null;
  const amounts = [m[1], m[2]].filter(Boolean).map(toNumber);
  return amounts.every(n => n >= 100 && n <= 200_000) ? clip(m[0]) : null;
}

export function payDetails(offer: { title?: string | null; description?: string | null }): PayDetails {
  const text = `${offer.title ?? ''}\n${offer.description ?? ''}`;
  return { commission: commissionFromText(text), ote: oteFromText(text), ticket: ticketFromText(text) };
}
