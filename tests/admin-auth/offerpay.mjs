// Detalles de pago por reglas fijas: comisión, OTE y ticket medio, con la frase literal del anuncio. Casos buenos,
// ambiguos y falsos positivos; un hueco es null, nunca 0, y nunca se supone una moneda.
// node --experimental-strip-types tests/admin-auth/offerpay.mjs
import assert from 'node:assert/strict';
const { commissionFromText, oteFromText, ticketFromText, payDetails } = await import('../../apps/web/lib/offerPay.ts');

let passed = 0, failed = 0;
const step = async (name, fn) => { try { await fn(); passed++; console.log(`PASS  ${name}`); } catch (err) { failed++; console.log(`FAIL  ${name}\n      ${err.message}`); } };

await step('comisión: «10% de comisión», «comisión del 10%» y rangos, con la frase literal', () => {
  assert.equal(commissionFromText('Ofrecemos un 10% de comisión sobre cada venta'), '10% de comisión');
  assert.equal(commissionFromText('Comisiones del 10% sobre cada cierre'), 'Comisiones del 10%');
  assert.equal(commissionFromText('Comisión entre el 8% y el 12% según producto'), 'Comisión entre el 8% y el 12%');
  assert.equal(commissionFromText('Pagamos 7,5 % de comisión'), '7,5 % de comisión');
  assert.equal(commissionFromText('COMISIÓN DEL 15 %'), 'COMISIÓN DEL 15 %');
});

await step('comisión: «100 % comisión» (modelo de pago), descuentos, porcentajes implausibles y comisiones sin cifra son null', () => {
  for (const text of ['100% comisión, sin fijo', 'Hasta 20% de descuento en nuestros cursos', 'Comisiones sin límite', '75% de comisión', '0% de comisión', 'Crecimiento del 30% anual', '', null, undefined]) {
    assert.equal(commissionFromText(text), null, `no debe leer comisión en: ${text}`);
  }
});

await step('OTE: con moneda o «k», con rango; nunca inventa la moneda', () => {
  assert.equal(oteFromText('OTE 45.000 €'), 'OTE 45.000 €');
  assert.equal(oteFromText('Salario + variable. OTE: 40k'), 'OTE: 40k');
  assert.equal(oteFromText('OTE de 60.000 € - 80.000 €'), 'OTE de 60.000 € - 80.000 €');
  assert.equal(oteFromText('OTE 70.000 USD'), 'OTE 70.000 USD');
});

await step('OTE: minúsculas, importes absurdos o sin cifra son null', () => {
  for (const text of ['ote 45.000 €', 'OTE 500 €', 'OTE 9.000.000 €', 'Hablamos de OTE en la entrevista', 'Quiero vivir en Barcelona, ote ganas']) assert.equal(oteFromText(text), null, text);
});

await step('ticket: medio, rango y moneda obligatoria', () => {
  assert.equal(ticketFromText('Venderás un producto con ticket medio de 3.000 €'), 'ticket medio de 3.000 €');
  assert.equal(ticketFromText('Tickets de 3.000 a 10.000 €'), 'Tickets de 3.000 a 10.000 €');
  assert.equal(ticketFromText('Ticket promedio: 2.500 USD'), 'Ticket promedio: 2.500 USD');
});

await step('con frases reales de los anuncios guardados: moneda delante, coma de millares y «4k€»', () => {
  assert.equal(ticketFromText('Se trabajan leads calificados y tickets entre USD 2,000 y USD 6,000, con comisiones del 10%'), 'tickets entre USD 2,000 y USD 6,000');
  assert.equal(ticketFromText('fórmulas de servicios de alta inversión con tickets entre 4k€ y 8k€. El perfil requiere'), 'tickets entre 4k€ y 8k€');
  assert.equal(ticketFromText('sobre el efectivo recaudado, con ticket promedio de USD 2.399. Primer mes'), 'ticket promedio de USD 2.399');
  assert.equal(commissionFromText('Hasta 14% de comisión por venta. Oportunidades de crecimiento'), '14% de comisión');
  assert.equal(commissionFromText('Se trabajan leads calificados, con comisiones del 10% y bonos desde USD 15,000'), 'comisiones del 10%');
  assert.equal(commissionFromText('un salario fijo de 500 dólares y una comisión del 10%. Ofrecen un sistema'), 'comisión del 10%');
  assert.equal(commissionFromText('Altas comisiones sin techo:35% de comisión por cada venta cerrada'), '35% de comisión');
  assert.equal(commissionFromText('Sistema de comisiones progresivo Hasta un 98% de comisión Sin límite'), null, '98 % no es plausible para un closer: no se lee');
});

await step('«high ticket» es el tipo de producto, no un importe', () => {
  for (const text of ['Closer High Ticket $3,000 – $5,000+ USD', 'ventas high ticket de más de 3,000 USD', 'Alto ticket 5.000 €', 'high-ticket 4k€']) assert.equal(ticketFromText(text), null, text);
});

await step('ticket: sin moneda, sin cifra o fuera de rango es null', () => {
  for (const text of ['ticket medio de 3', 'tickets de alto valor', 'ticket de 50 €', 'Compra tu ticket para el evento', 'ticket medio de 9.999.999 €']) assert.equal(ticketFromText(text), null, text);
});

await step('payDetails junta título y descripción y no toca el sueldo fijo', () => {
  const full = payDetails({ title: 'Closer high ticket', description: 'Sueldo fijo 1.200 € al mes + 10% de comisión. OTE 45.000 €. Ticket medio de 3.000 €.' });
  assert.deepEqual(full, { commission: '10% de comisión', ote: 'OTE 45.000 €', ticket: 'Ticket medio de 3.000 €' });
  assert.deepEqual(payDetails({ title: 'Closer', description: 'Sueldo fijo 1.200 € al mes' }), { commission: null, ote: null, ticket: null }, 'un sueldo fijo no es comisión, OTE ni ticket');
  assert.deepEqual(payDetails({}), { commission: null, ote: null, ticket: null });
  assert.equal(payDetails({ title: 'Closer 10% de comisión' }).commission, '10% de comisión', 'también lee el título');
});

console.log(`\n${passed}/${passed + failed} pasos OK`);
if (failed) process.exit(1);
