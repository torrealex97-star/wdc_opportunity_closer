// Qué viaja al modelo cuando una práctica se ata a una candidatura. Esto no prueba el prompt del
// proveedor: prueba la ÚNICA puerta por la que salen los datos (lib/practiceContext), y que lo
// sensible no está aunque exista en el formulario.
// Uso: node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/practicecontext.mjs
import assert from 'node:assert/strict';
import { candidateBriefOf, contextInstructions, offerBriefOf } from '../../apps/web/lib/practiceContext.ts';

const application = { offer_title: 'Closer de ventas', offer_company: 'Acme' };
const offer = offerBriefOf({
  original_title: 'Closer de ventas',
  company: 'Acme',
  location: 'Sevilla',
  modality: 'Híbrido',
  compensation: '30.000 €',
  language: 'Anuncio en español',
  description: 'Buscamos una closer para cerrar llamadas de alto valor.',
}, application);
assert.equal(offer.available, true);
assert.equal(offer.description, 'Buscamos una closer para cerrar llamadas de alto valor.');

// El formulario base tiene de todo; solo su parte profesional puede viajar.
const profile = {
  contact_email: 'bea@ejemplo.com', phone: '600 11 22 33', linkedin_url: 'https://www.linkedin.com/in/bea',
  cv_url: 'https://drive.google.com/file/d/cv/view', salary_expectation: '45.000 €', notice_period: '2 semanas',
  country_residence: 'España', work_authorization: 'eu', language_levels: { en: 'b2' },
  years_sales: 4, years_high_ticket: 2, sales_experience: 'Cerraba 30.000 € al mes con HubSpot.', tools: ['HubSpot'],
  available_from: '2026-12-01', hours_per_week: 40, contract_preferences: ['full_time'],
  pitch: 'Vendo con datos y sin promesas.', motivation: 'Quiero crecer en un equipo que mida.', answers: { why: 'Texto privado del formulario' },
  autofill_consent_at: '2026-11-01T00:00:00Z',
};
const candidate = candidateBriefOf(profile, { languages: ['es'], city: 'Sevilla', availability: 'Tardes' });
assert.ok(candidate, 'con datos profesionales sí hay contexto de candidata');
const text = contextInstructions({ offer, candidate });

// Lo que sí debe llegar: el anuncio y su parte profesional.
for (const expected of ['Acme', 'Closer de ventas', 'Sevilla', 'Híbrido', '30.000 €', 'Buscamos una closer', 'HubSpot', 'Vendo con datos', 'Quiero crecer']) {
  assert.ok(text.includes(expected), `viaja: ${expected}`);
}
// Lo que NO debe llegar, aunque esté relleno en el formulario.
for (const secret of ['bea@ejemplo.com', '600 11 22 33', 'linkedin.com', 'drive.google.com', '45.000 €', '2 semanas', 'España', 'Texto privado del formulario']) {
  assert.ok(!text.includes(secret), `no viaja: ${secret}`);
}

// Un formulario sin datos profesionales no añade nada (ni un bloque vacío).
assert.equal(candidateBriefOf({ contact_email: 'x@y.dev', phone: '600 000 000' }, null), null);
// Sin el anuncio vivo no se inventa la descripción: quedan puesto y empresa, y el prompt lo dice.
const stale = offerBriefOf(null, application);
assert.equal(stale.available, false);
assert.equal(stale.description, null);
assert.match(contextInstructions({ offer: stale, candidate: null }), /ya no está disponible/);
assert.match(contextInstructions({ offer: stale, candidate: null }), /Acme/);

console.log('PASS  la práctica de una candidatura envía el anuncio y la parte profesional, nunca el contacto ni el salario');
