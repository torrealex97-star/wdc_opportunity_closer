// Formulario público de empleadores: el validador es puro y decide qué entra. Reglas: campos obligatorios, el pago solo si lo escribe la
// empresa (nunca inferido), nada de acortadores ni mensajería como enlace de la oferta, honeypot, una oferta por enlace (misma huella).
// node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/employer.mjs
import assert from 'node:assert/strict';
import { validateEmployerOffer, offerExternalId, ROLE_LABELS_FORM } from '../../apps/web/lib/employerOffer.ts';

let passed = 0, failed = 0;
const step = (name, fn) => { try { fn(); passed++; console.log(`PASS  ${name}`); } catch (err) { failed++; console.log(`FAIL  ${name}\n      ${err.message}`); } };
const good = (over = {}) => ({
  company: 'Academia Delta', website: 'https://delta.example.com', contact_name: 'Marta Ruiz', contact_email: 'marta@delta.example.com',
  role: 'closer', contract: 'fijo_variable', market: 'ES', pay: '1.200 € fijos + 8 % por cierre',
  description: 'Buscamos closer de ventas para llamadas con leads cualificados de nuestro programa de formación. Trabajo remoto, horario flexible y formación incluida.',
  offer_url: 'https://delta.example.com/empleo/closer', accepted_terms: true, ...over });

step('una oferta completa se convierte en candidato con procedencia y el contacto va aparte', () => {
  const r = validateEmployerOffer(good(), new Date('2026-11-26T10:00:00Z'));
  assert.equal(r.ok, true);
  assert.equal(r.candidate.title, 'Closer de ventas · Academia Delta');
  assert.equal(r.candidate.company, 'Academia Delta'); assert.equal(r.candidate.url, 'https://delta.example.com/empleo/closer');
  assert.equal(r.candidate.salary, '1.200 € fijos + 8 % por cierre', 'el pago es el texto de la empresa, tal cual');
  assert.equal(r.candidate.raw.site, 'empleadores'); assert.equal(r.candidate.raw.provider, 'employer-form'); assert.equal(r.candidate.raw.kind, 'employer_submission'); assert.equal(r.candidate.raw.job_type, 'fijo_variable');
  assert.equal(r.candidate.external_id, offerExternalId('https://delta.example.com/empleo/closer'));
  assert.deepEqual(r.contact, { name: 'Marta Ruiz', email: 'marta@delta.example.com' });
  assert.equal(JSON.stringify(r.candidate).includes('marta@'), false, 'el email de contacto NO viaja en lo que verá la alumna');
});
step('sin pago escrito por la empresa no se inventa ninguno', () => {
  assert.equal(validateEmployerOffer(good({ pay: '' })).candidate.salary, null);
  assert.equal(validateEmployerOffer(good({ pay: undefined })).candidate.salary, null);
});
step('campos obligatorios y formato: cada error dice qué corregir', () => {
  const r = validateEmployerOffer({ ...good(), company: 'a', contact_email: 'no-es-email', description: 'corta', offer_url: 'http://x.com', accepted_terms: false, role: 'jefe', market: 'XX' });
  assert.equal(r.ok, false);
  for (const f of ['company', 'contact_email', 'description', 'offer_url', 'accepted_terms', 'role', 'market']) assert.ok(r.errors[f], `falta error de ${f}`);
});
step('el enlace de la oferta no puede ser un acortador ni mensajería; la web de la empresa tampoco lleva credenciales', () => {
  for (const url of ['https://bit.ly/abc', 'https://tinyurl.com/x', 'https://t.me/canal', 'https://wa.me/34600000000', 'https://api.whatsapp.com/send?phone=1']) assert.ok(validateEmployerOffer(good({ offer_url: url })).errors?.offer_url, url);
  assert.ok(validateEmployerOffer(good({ website: 'https://user:pass@delta.example.com' })).errors?.website);
  assert.ok(validateEmployerOffer(good({ offer_url: 'https://127.0.0.1/x' })).errors?.offer_url, 'IP literal');
});
step('honeypot: si el campo trampa viene relleno se descarta en silencio (sin error que enseñe al bot)', () => {
  const r = validateEmployerOffer({ ...good(), hp: 'https://spam.example.com' });
  assert.equal(r.ok, false); assert.equal(r.honeypot, true); assert.equal(r.errors, undefined);
});
step('límites de longitud: nada de textos gigantes', () => {
  assert.ok(validateEmployerOffer(good({ description: 'x'.repeat(5000) })).errors?.description);
  assert.ok(validateEmployerOffer(good({ pay: 'x'.repeat(300) })).errors?.pay);
  assert.ok(validateEmployerOffer(good({ company: 'x'.repeat(200) })).errors?.company);
});
step('una oferta por enlace: el mismo enlace (aunque cambie mayúsculas, barra final o parámetros de seguimiento) da la misma huella', () => {
  const a = offerExternalId('https://Delta.example.com/empleo/closer/?utm_source=x#top'), b = offerExternalId('https://delta.example.com/empleo/closer');
  assert.equal(a, b); assert.notEqual(a, offerExternalId('https://delta.example.com/empleo/setter'));
  assert.match(a, /^emp-[0-9a-f]{16}$/);
});
step('etiquetas de puesto: closer, setter, cold calling y SDR', () => {
  assert.deepEqual(Object.keys(ROLE_LABELS_FORM), ['closer', 'setter', 'cold_calling', 'sdr']);
  assert.equal(validateEmployerOffer(good({ role: 'cold_calling' })).candidate.title, 'Cold calling · Academia Delta');
});
step('el HTML no entra: se limpia el texto de etiquetas', () => {
  const r = validateEmployerOffer(good({ description: 'Buscamos closer <script>alert(1)</script> para ventas remotas con leads cualificados y formación incluida en el equipo.' }));
  assert.equal(r.ok, true); assert.equal(r.candidate.description.includes('<'), false);
});

console.log(`\n${passed}/${passed + failed} pasos OK`);
if (failed) process.exit(1);
