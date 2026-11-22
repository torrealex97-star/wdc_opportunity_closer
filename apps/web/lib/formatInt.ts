/** Entero con punto de millares siempre (en «es», `toLocaleString` escribe 1000 sin punto y el objetivo se lee «1.000»). Sin dependencias: vale en servidor y en navegador. */
export const fmtInt = (value: number) => String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
