// Formatos de dinero compartidos: el marcador por fuente y el gasto por proveedor pintan las mismas
// cifras, así que la definición vive en un solo sitio. Un hueco se pinta «—», nunca 0.
const eur = new Intl.NumberFormat('es', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });
const eurUnit = new Intl.NumberFormat('es', { style: 'currency', currency: 'EUR', maximumFractionDigits: 4 });
const usdFmt = new Intl.NumberFormat('es', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 });

/** Euros con céntimos. */
export const money = (value: number | null) => value === null ? '—' : eur.format(value);
/** Euros con cuatro decimales, para costes unitarios pequeños (por envío, por entrevista). */
export const unit = (value: number | null) => value === null ? '—' : eurUnit.format(value);
/** Dólares con cuatro decimales: es la moneda en la que se registra el gasto. */
export const usd = (value: number | null) => value === null ? '—' : usdFmt.format(value);
