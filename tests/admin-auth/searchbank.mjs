// Banco de términos y búsquedas: coherencia con el clasificador, negativos, mercados, fechas, consultas por motor y
// plan diario determinista. Puro: sin red ni Supabase.
// node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/searchbank.mjs
import assert from 'node:assert/strict';
import { JOB_TERMS, FREELANCE_TERMS, MARKETS, DATE_WINDOWS, SEARCH_ROLES, termsFor, rotationList, planSearches, buildQuery, hitsNegative, langOfSource, channelOfSource, rotationTermsForSource } from '../../apps/web/lib/searchBank.ts';
import { freelanceRole } from '../../apps/web/lib/freelanceRole.ts';
import { roleFromTitle } from '../../apps/web/lib/vocabulary.ts';

const results = [];
const step = (name, fn) => { try { fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]); } };
const DAY = 86_400_000;

step('cada término de empleo (es/en) lo clasifica el vocabulario como su perfil; los de proyecto, el clasificador de empleo o el de freelance', () => {
  for (const role of SEARCH_ROLES) {
    for (const lang of ['es', 'en']) {
      for (const term of termsFor(role, lang, 'board', 'longtail')) assert.equal(roleFromTitle(term), role, `«${term}» (${role}/${lang}) → ${roleFromTitle(term)}`);
      for (const term of FREELANCE_TERMS[role][lang]) {
        const got = roleFromTitle(term) ?? freelanceRole(term);
        assert.equal(got, role, `proyecto «${term}» (${role}/${lang}) → ${got}`);
      }
    }
  }
});

step('sin términos repetidos por perfil e idioma y el núcleo no está vacío', () => {
  for (const role of SEARCH_ROLES) for (const lang of ['es', 'en', 'pt']) {
    const all = termsFor(role, lang, 'board', 'longtail');
    assert.equal(new Set(all).size, all.length, `${role}/${lang}: repetido`);
    assert.ok(JOB_TERMS[role][lang].core.length >= 1, `${role}/${lang}: sin núcleo`);
  }
});

step('negativos: «cerrajero» y «closer to» se descartan; un closer de verdad no', () => {
  assert.equal(hitsNegative('Cerrajero 24 horas'), 'cerrajero');
  assert.equal(hitsNegative('We bring you closer to your goals'), 'closer to');
  assert.equal(hitsNegative('Closer de ventas high ticket'), null);
  assert.equal(hitsNegative('Appointment Setter remoto'), null);
  assert.equal(hitsNegative(null), null);
});

step('rotación: intercala perfiles (el día siguiente cambia de perfil) y no repite términos', () => {
  const list = rotationList('es');
  assert.deepEqual(list.slice(0, 3).map(i => i.role), ['closer', 'setter', 'cold_caller']);
  assert.equal(new Set(list.map(i => i.term)).size, list.length);
});

step('plan diario: determinista, distinto cada día, N búsquedas distintas y con el idioma del mercado', () => {
  const day = Date.parse('2026-11-23T10:00:00Z');
  const a = planSearches({ now: day, count: 3 });
  const b = planSearches({ now: day + 3_600_000, count: 3 });
  assert.deepEqual(a, b, 'la hora no cambia el plan');
  assert.equal(new Set(a.map(p => p.term)).size, 3);
  assert.notDeepEqual(a.map(p => p.term), planSearches({ now: day + DAY, count: 3 }).map(p => p.term), 'otro día, otro plan');
  const en = planSearches({ now: day, count: 2, market: MARKETS.remote });
  assert.ok(en.every(p => p.lang === 'en' && p.market.id === 'remote'));
  const free = planSearches({ now: day, count: 3, channel: 'freelance', market: MARKETS.remote });
  assert.ok(free.every(p => FREELANCE_TERMS[p.role].en.includes(p.term)), 'el canal freelance usa términos de proyecto');
});

step('consultas por motor: keyword, OR, Google con site y negativos, y semántica con ubicación', () => {
  assert.equal(buildQuery('keyword', ['closer de ventas']), 'closer de ventas');
  assert.equal(buildQuery('or', ['closer de ventas', 'setter', 'cold calling']), '"closer de ventas" OR setter OR "cold calling"');
  assert.equal(buildQuery('google', 'closer de ventas', { site: 'infojobs.net' }), 'site:infojobs.net "closer de ventas" -cerrajero -cerrajeria');
  assert.equal(buildQuery('semantic', 'closer de ventas', { market: MARKETS.mx }), 'oferta de empleo closer de ventas en México');
  assert.equal(buildQuery('semantic', 'appointment setter', { market: MARKETS.remote, channel: 'freelance' }), 'freelance project appointment setter in Remote');
  assert.equal(buildQuery('or', []), '');
});

step('filtros de fecha: cada motor recibe su formato', () => {
  assert.equal(DATE_WINDOWS.week.linkedin, 'r604800');
  assert.equal(DATE_WINDOWS.week.tavily, 'week');
  assert.equal(DATE_WINDOWS.day.googleTbs, 'qdr:d');
  for (const w of Object.values(DATE_WINDOWS)) assert.ok(w.days > 0);
});

step('mercados: país ISO en mayúsculas, idioma y gl coherentes', () => {
  for (const m of Object.values(MARKETS)) {
    assert.match(m.country, /^[A-Z]{2}$/); assert.match(m.gl, /^[a-z]{2}$/); assert.ok(m.location && m.tavily);
    assert.equal(m.tavily, m.tavily.toLowerCase());
  }
});

step('idioma y canal por fuente: anglosajonas en inglés, freelance en canal freelance, por defecto español', () => {
  assert.equal(langOfSource('apify-upwork'), 'en'); assert.equal(langOfSource('apify-simplyhired'), 'en');
  assert.equal(langOfSource('apify-computrabajo'), 'es'); assert.equal(langOfSource('apify-catho'), 'pt');
  assert.equal(channelOfSource('apify-workana'), 'freelance'); assert.equal(channelOfSource('apify-trabajos'), 'board');
});

step('rotationTermsForSource: la búsqueda de siempre va primera, sin repetidos y en el idioma de la fuente', () => {
  const t = rotationTermsForSource('apify-trabajos', 'closer ventas');
  assert.equal(t[0], 'closer ventas'); assert.equal(new Set(t).size, t.length); assert.ok(t.length >= 4);
  assert.ok(rotationTermsForSource('apify-upwork').every(x => /[a-z]/.test(x)) && rotationTermsForSource('apify-upwork').includes('appointment setter'));
});

for (const [status, name, message] of results) console.log(`${status}  ${name}${message ? '\n      ' + message : ''}`);
const failed = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} pasos OK`);
process.exit(failed ? 1 : 0);
