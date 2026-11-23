// Proyectos freelance de closer, setter y cold calling: cuentan igual que un empleo (decisión del dueño, 2026-11-23) y no se penalizan por el país del cliente.
// node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/freelance.mjs
import assert from 'node:assert/strict';
const { enrich } = await import('../../apps/web/lib/offerScore.ts');
const { freelanceRole } = await import('../../apps/web/lib/freelanceRole.ts');
const { judgeOffer, MIN_SCORE } = await import('../../apps/web/lib/autoReview.ts');

let passed = 0, failed = 0;
const step = async (name, fn) => { try { await fn(); passed++; console.log(`PASS  ${name}`); } catch (err) { failed++; console.log(`FAIL  ${name}\n      ${err.message}`); } };
const now = Date.parse('2026-11-24T10:00:00Z');
const posted = new Date(now - 864e5).toISOString();
const desc = 'We need an experienced remote sales professional to qualify leads and book calls for our coaching programme. You will work with our team on a commission basis. '.repeat(3);
const project = (over = {}) => ({ title: 'Appointment Setter for coaching business', company: 'Cliente', location: 'United States', salary: null, description: desc, posted_at: posted, raw: { kind: 'freelance_project', provider: 'apify' }, ...over });
const job = (over = {}) => project({ raw: { provider: 'apify' }, ...over });

await step('reconoce el perfil en títulos de proyecto que el vocabulario de empleo no ve', () => {
  assert.equal(freelanceRole('Cold Call Expert'), 'cold_caller'); assert.equal(freelanceRole('Telemarketer for Spanish speaking leads'), 'cold_caller');
  assert.equal(freelanceRole('Outbound caller (Spanish)'), 'cold_caller'); assert.equal(freelanceRole('Appointment Setting & Cold Outreach'), 'setter');
  assert.equal(freelanceRole('Book sales calls for our agency'), 'setter');
  for (const no of ['Java developer', 'Sales funnel copywriter', 'Customer support agent', 'Cold email copywriter', 'Closer to the customer: UX designer']) assert.equal(freelanceRole(no), null, no);
});

await step('un proyecto de setter con cliente en EE. UU. NO se penaliza por el país y llega al umbral', () => {
  const e = enrich(project(), now);
  assert.equal(e.role, 'setter'); assert.ok(e.score >= MIN_SCORE, `puntuación ${e.score}`); assert.equal(e.market, 'US_LATINO');
});

await step('el MISMO título como empleo (no proyecto) conserva la penalización de siempre: nada cambia para los empleos', () => {
  const asJob = enrich(job(), now), asProject = enrich(project(), now);
  assert.ok(asJob.score < asProject.score, `empleo ${asJob.score} < proyecto ${asProject.score}`); assert.ok(asJob.score < MIN_SCORE, 'un empleo en EE. UU. sigue sin llegar al umbral por España');
});

await step('cold calling y closer en proyecto también cuentan; un proyecto que no es comercial no', () => {
  const cold = enrich(project({ title: 'Cold Call Expert needed', location: 'India' }), now); assert.equal(cold.role, 'cold_caller');
  const closer = enrich(project({ title: 'Sales closer for high ticket offer', location: 'Canada' }), now); assert.equal(closer.role, 'closer'); assert.ok(closer.score >= MIN_SCORE);
  const dev = enrich(project({ title: 'React developer for dashboard', location: 'United States' }), now); assert.equal(dev.role, null);
});

await step('un proyecto sin ubicación reconocible va a «dólares» con base sin_señal (no se inventa un dato), y un empleo sigue sin mercado', () => {
  const p = enrich(project({ location: null }), now); assert.equal(p.market, 'US_LATINO'); assert.equal(p.market_basis, 'sin_senal');
});

await step('de punta a punta: el proyecto de closer se aprueba por reglas; uno sin perfil se retira; el empleo en inglés de EE. UU. no cambia', () => {
  const asRow = (c, e) => ({ ...c, ...e, spain: e.spain, verified_result: null, red_flags: [], market: e.market, market_basis: e.market_basis });
  const ok = project({ title: 'Sales closer for high ticket offer', location: 'Canada' });
  assert.equal(judgeOffer(asRow(ok, enrich(ok, now))).decision, 'approve');
  const dev = project({ title: 'React developer for dashboard' });
  assert.equal(judgeOffer(asRow(dev, enrich(dev, now))).why, 'sin_perfil');
  const us = job({ title: 'Sales closer for high ticket offer', location: 'Austin, TX' });
  assert.notEqual(judgeOffer(asRow(us, enrich(us, now))).decision, 'approve', 'el empleo en EE. UU. no se aprueba por esta vía');
});

console.log(`\n${passed}/${passed + failed} pasos OK`);
if (failed) process.exit(1);
