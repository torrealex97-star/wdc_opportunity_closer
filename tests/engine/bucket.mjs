// El «hueco ampliado» de la vista de alumna: la regla de relleno y que la medición use el motor
// de verdad (studentSurface) sobre un shim de D1. Sin red y sin Cloudflare.
// Uso: node --experimental-strip-types tests/engine/bucket.mjs
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { planWidening, shouldWiden } from '../../scripts/bucket-audit.mjs';

const workerPath = fileURLToPath(new URL('../../sites/engine/worker.js', import.meta.url));
const stage = join(mkdtempSync(join(tmpdir(), 'wdc-engine-bucket-')), 'worker.mjs');
copyFileSync(workerPath, stage);
const { __test: t } = await import(pathToFileURL(stage).href);

// Regla de la web (StudentOpportunities.tsx): menos de 10 y con algún filtro puesto.
assert.equal(shouldWiden(Array(9).fill({}), { role: 'closer', market: 'ES' }), true);
assert.equal(shouldWiden(Array(10).fill({}), { role: 'closer', market: 'ES' }), false, 'con 10 no se abre');
assert.equal(shouldWiden(Array(3).fill({}), { role: null, market: 'any' }), false, 'sin filtro no hay nada que ampliar');
assert.equal(shouldWiden(Array(3).fill({}), { role: null, market: 'ES' }), true, 'el mercado sí es filtro');

// Relleno: sin repetir lo ya mostrado y sin pasar de 20 tarjetas en total.
const narrow = [{ id: 'a' }, { id: 'b' }];
const wide = [{ id: 'a' }, { id: 'c' }, { id: 'd' }, ...Array.from({ length: 25 }, (_, i) => ({ id: `x${i}` }))];
assert.deepEqual(planWidening(narrow, wide).slice(0, 2).map(o => o.id), ['c', 'd']);
assert.equal(planWidening(narrow, wide).length, 18, '20 menos las 2 que ya salían');
assert.equal(planWidening(Array(20).fill({ id: 'z' }), wide).length, 0, 'nunca negativo');

// La medición pasa por studentSurface: mismo SQL que sirve la vista, alimentado por un shim.
const row = (id, title, description) => ({
  job_id: id, starred: 0, source: 'test',
  expires_at: Date.now() + 86400000,
  payload: JSON.stringify({ title, company: `Empresa ${id}`, location: 'Madrid, España', url: `https://x.test/${id}`, posted_at: new Date().toISOString(), raw: { description } }),
});
const rows = [
  row('1', 'Closer de ventas high ticket', 'Buscamos closer para cerrar ventas high ticket. Ofrecemos comisiones, jornada completa y formación. Experiencia mínima de un año vendiendo por videollamada con clientes.'),
  row('2', 'Setter comercial', 'Buscamos setter para agendar reuniones con leads cualificados. Jornada completa, comisiones y formación incluida. Experiencia previa en prospección y contacto con clientes.'),
  row('3', 'Ingeniero de software', 'Buscamos ingeniero backend para el equipo de plataforma. Jornada completa y formación. Experiencia con servicios distribuidos y clientes internos.'),
];
const env = { DB: { prepare: () => ({ bind: () => ({ all: async () => ({ results: rows }) }) }) } };
const surface = opts => t.studentSurface(env, { starredOnly: false, includeExtraRoles: false, ...opts });

const narrowResult = await surface({ role: 'closer', market: 'ES', days: 10, includeBilingual: false });
assert.deepEqual(narrowResult.ranked.map(o => o.role), ['closer'], 'la búsqueda estrecha no mezcla familias');
const wideResult = await surface({ role: null, market: 'ES', days: 10, includeBilingual: true });
assert.deepEqual(wideResult.ranked.map(o => o.role).sort(), ['closer', 'setter'], 'la amplia sí trae la otra familia');
const extras = planWidening(narrowResult.ranked, wideResult.ranked);
assert.deepEqual(extras.map(o => o.role), ['setter'], 'el relleno es exactamente la oferta de otra familia');

console.log('PASS  hueco ampliado: regla de la web, tope de 20 y motor real sobre el shim');
