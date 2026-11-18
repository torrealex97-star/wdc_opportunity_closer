// Motivos del descarte: «sin perfil comercial reconocible» era un solo número y no decía dónde se
// cae el embudo. Esta prueba fija los motivos, que el contador los guarde por fuente y que el
// motivo de idioma/mercado use los MISMOS predicados que la vista de alumna.
// Uso: node --experimental-strip-types tests/engine/discards.mjs   (sin red ni Cloudflare)
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workerPath = fileURLToPath(new URL('../../sites/engine/worker.js', import.meta.url));
const stage = join(mkdtempSync(join(tmpdir(), 'wdc-engine-discards-')), 'worker.mjs');
copyFileSync(workerPath, stage);
const { __test: t } = await import(pathToFileURL(stage).href);

const payload = (title, extra = {}) => ({ title, url: 'https://x.test/1', location: 'Madrid, España', raw: {}, ...extra });

// ── Motivos de rol ──────────────────────────────────────────────────────────────────────────
assert.equal(t.discardReason(payload('Closer de ventas')), null, 'un closer entra');
assert.equal(t.discardReason(payload('Setter y Closer de ventas')), null);
// Decisión del propietario (2026-11-18): los puestos de mando son un perfil propio y se ingieren.
assert.equal(t.discardReason(payload('Sales Manager')), null, 'el mando comercial entra como management');
assert.equal(t.discardReason(payload('Head of Sales')), null);
assert.equal(t.discardReason(payload('Supervisor de Ventas')), null);
// «Mando» sigue siendo el motivo de un jefe que NO es de ventas: no se disfraza de perfil comercial.
assert.equal(t.discardReason(payload('Customer Success Manager')), 'mando');
assert.equal(t.discardReason(payload('Team Lead de Operaciones')), 'mando');
assert.equal(t.discardReason(payload('Java Engineer')), 'no_comercial');
assert.equal(t.discardReason(payload('Senior Data Analyst')), 'no_comercial');
assert.equal(t.discardReason(payload('Recepcionista')), 'sin_palabra_de_rol');
// Decisión del propietario (2026-11-18): el ejecutivo comercial también se ingiere.
assert.equal(t.discardReason(payload('Account Executive')), null, 'AE es venta y entra desde la sesión 209');
assert.equal(t.discardReason(payload('Closer de ventas', { url: null })), null, 'la URL se exige al ingerir, no en el motivo de rol');
assert.equal(t.exclusionReason(payload('Closer de ventas', { url: null }), { market: 'ES' }), 'sin_url');

// El motivo no cambia qué entra: la familia manda igual que antes.
assert.equal(t.isProfileCandidate(payload('Closer de ventas')), true);
assert.equal(t.isProfileCandidate(payload('Account Executive')), true, 'la familia comercial genérica entra');
assert.equal(t.isProfileCandidate(payload('Sales Manager')), true, 'el mando comercial es del perfil, con su familia');

// Mando ya DENTRO del perfil (el caso que se ve en producción): se puede medir sin tocar la regla.
assert.equal(t.leadershipTitle({ title: 'Supervisor de Ventas, La Plata' }), true);
assert.equal(t.leadershipTitle({ title: 'BDR Team Lead (Spain)' }), true);
assert.equal(t.leadershipTitle({ title: 'Closer de ventas' }), false);

// ── Motivos de superficie: idioma y mercado, con los predicados de la vista ─────────────────
const es = 'Buscamos closer para cerrar ventas high ticket con leads cualificados y comisiones. ';
assert.equal(t.exclusionReason({ title: 'Closer', location: 'Madrid, España', url: 'https://x.test/a', raw: { description: es } }, { market: 'ES' }), null);
assert.equal(t.exclusionReason({ title: 'Closer', location: 'Madrid, España', url: 'https://x.test/a', raw: { description: `${es} Requiere inglés avanzado.` } }, { market: 'ES' }), 'idioma');
assert.equal(t.exclusionReason({ title: 'Closer', location: 'Colombia', url: 'https://x.test/a', raw: { description: es } }, { market: 'ES' }), 'mercado');
assert.equal(t.exclusionReason({ title: 'Closer', location: 'Colombia', url: 'https://x.test/a', raw: { description: es } }, { market: 'LATAM' }), null, 'en su mercado sí entra');
assert.equal(t.exclusionReason({ title: 'Closer', location: 'Madrid, España', url: 'https://x.test/a', raw: { description: es } }, { market: 'any' }), null);
assert.equal(t.exclusionReason({ title: 'Closer', location: 'Madrid, España', url: 'https://x.test/a', raw: { description: '' } }, { market: 'ES' }), 'sin_texto', 'sin texto no es «idioma»');
assert.equal(t.exclusionReason({ title: 'Recepcionista', location: 'Madrid, España', url: 'https://x.test/a', raw: { description: es } }, { market: 'ES' }), 'sin_palabra_de_rol', 'el rol manda sobre idioma y mercado');

// ── El contador guarda el motivo, por fuente y sumando el total de siempre ─────────────────
const rows = term => ({
  meta: { total: 4 },
  data: [
    { public_slug: `fh-ok-${term}`, url: 'https://freehire.me/j/ok', title: 'Closer de ventas High-Ticket', company: 'Acme', countries: ['ES'], posted_at: '2026-11-13T08:00:00Z', reality: { class: 'fresh' } },
    { public_slug: `fh-boss-${term}`, url: 'https://freehire.me/j/boss', title: 'Sales Manager', company: 'Acme', countries: ['ES'], posted_at: '2026-11-13T08:00:00Z', reality: { class: 'fresh' } },
    { public_slug: `fh-dev-${term}`, url: 'https://freehire.me/j/dev', title: 'Senior Data Engineer', company: 'Acme', countries: ['ES'], posted_at: '2026-11-13T08:00:00Z', reality: { class: 'fresh' } },
    { public_slug: `fh-any-${term}`, url: 'https://freehire.me/j/any', title: 'Recepcionista', company: 'Acme', countries: ['ES'], posted_at: '2026-11-13T08:00:00Z', reality: { class: 'fresh' } },
  ],
});
globalThis.fetch = async input => {
  const term = new URL(String(input)).searchParams.get('q') || 'x';
  return new Response(JSON.stringify(rows(term)), { status: 200, headers: { 'content-type': 'application/json' } });
};

t.resetExtractFiltered();
const out = await t.sourceFreehire({ code: 'freehire-closer', region: 'es', terms: true, termsPerRun: 1 });
assert.equal(out.length, 2, 'entran el closer y el mando comercial');
assert.deepEqual(t.filteredByReasonOf('freehire-closer'), { no_comercial: 1, sin_palabra_de_rol: 1 });
assert.equal(t.filteredOf('freehire-closer'), 2, 'el total de siempre sigue cuadrando con la suma de motivos');
t.resetExtractFiltered();
assert.deepEqual(t.filteredByReasonOf('freehire-closer'), {}, 'se reinicia por ejecución');

console.log('PASS  motivos del descarte: rol, mando, no comercial, idioma y mercado');
