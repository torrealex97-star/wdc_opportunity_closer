// Avisos rápidos por email a las alumnas: reglas puras y orquestación con dependencias simuladas.
// Reglas: apagado por defecto; sin secreto de baja no se envía; solo alumnas con consentimiento; una oferta se avisa una vez; tope diario;
// reclamo atómico (quien no reclama no envía); un envío fallido no cuenta como enviado; sin inventar datos de la oferta.
// node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/alerts.mjs
import assert from 'node:assert/strict';
import { ALERT_CAP_PER_DAY, MIN_ALERT_SCORE, alertsEnabled, alertsSecret, signUnsub, verifyUnsub, pickForDigest, renderDigest, runAlerts } from '../../apps/web/lib/studentAlerts.ts';

let passed = 0, failed = 0;
const step = async (name, fn) => { try { await fn(); passed++; console.log(`PASS  ${name}`); } catch (err) { failed++; console.log(`FAIL  ${name}\n      ${err.message}`); } };
const SECRET = 'secreto-de-prueba-0123456789';
const U1 = '11111111-1111-1111-1111-111111111111', U2 = '22222222-2222-2222-2222-222222222222';
const opp = (id, over = {}) => ({ id, role: 'closer', role_label: 'Closer', original_title: `Closer ${id}`, company: 'Acme', compensation: 'No publicado', modality: 'Remoto', location: 'España', published_at: '2026-11-26T00:00:00Z', source_url: `https://acme.example.com/${id}`, description: 'x', ...over });
const match = (id, score = 80, over = {}) => ({ opportunity: opp(id, over), score, reasons: [], unknowns: [] });

await step('apagado por defecto: solo "1" o "true" lo enciende', () => {
  assert.equal(alertsEnabled({}), false); assert.equal(alertsEnabled({ STUDENT_ALERTS_ENABLED: '0' }), false); assert.equal(alertsEnabled({ STUDENT_ALERTS_ENABLED: 'yes' }), false);
  assert.equal(alertsEnabled({ STUDENT_ALERTS_ENABLED: '1' }), true); assert.equal(alertsEnabled({ STUDENT_ALERTS_ENABLED: 'true' }), true);
});
await step('el secreto de baja exige longitud mínima; sin él no hay envío', () => {
  assert.equal(alertsSecret({}), null); assert.equal(alertsSecret({ ALERTS_SECRET: 'corto' }), null); assert.equal(alertsSecret({ ALERTS_SECRET: SECRET }), SECRET);
});
await step('el token de baja es de esa alumna y de ese secreto', () => {
  const t = signUnsub(U1, SECRET);
  assert.equal(verifyUnsub(U1, t, SECRET), true);
  assert.equal(verifyUnsub(U2, t, SECRET), false, 'el token de otra alumna no vale');
  assert.equal(verifyUnsub(U1, t, SECRET + 'x'), false, 'otro secreto no vale');
  assert.equal(verifyUnsub(U1, t.slice(0, -1) + (t.endsWith('a') ? 'b' : 'a'), SECRET), false);
  assert.equal(verifyUnsub(U1, '', SECRET), false); assert.equal(verifyUnsub(U1, 'zz', SECRET), false);
});
await step('elige solo ofertas de su perfil, sin repetir y dentro del tope diario', () => {
  const ms = [match('a', 90), match('b', 70), match('c', 60), match('d', 55), match('e', 30), match('f', 95)];
  const picked = pickForDigest({ matches: ms, alreadyQueued: new Set(['f']), sentToday: 0 });
  assert.deepEqual(picked.map(m => m.opportunity.id), ['a', 'b', 'c'], `tope ${ALERT_CAP_PER_DAY}, sin la ya avisada y sin la de puntuación baja (<${MIN_ALERT_SCORE})`);
  assert.deepEqual(pickForDigest({ matches: ms, alreadyQueued: new Set(), sentToday: 2 }).map(m => m.opportunity.id), ['a'], 'con 2 ya hoy, solo cabe 1');
  assert.deepEqual(pickForDigest({ matches: ms, alreadyQueued: new Set(), sentToday: 3 }), [], 'tope alcanzado');
  assert.deepEqual(pickForDigest({ matches: [match('a', 90), match('a', 90)], alreadyQueued: new Set(), sentToday: 0 }).length, 1, 'la misma oferta dos veces entra una');
});
await step('el correo dice lo que la oferta dice, escapa HTML, enlaza la baja y no inventa nada', () => {
  const msg = renderDigest({ offers: [opp('a', { original_title: 'Closer <b>x</b>', company: 'Acme & Co', compensation: 'No publicado' })], unsubscribeUrl: 'https://app.example.com/api/alerts/unsubscribe?u=1&t=2' });
  assert.match(msg.subject, /1 oferta/);
  assert.equal(msg.html.includes('<b>x</b>'), false, 'HTML escapado'); assert.match(msg.html, /Closer &lt;b&gt;x&lt;\/b&gt;/);
  assert.match(msg.text, /No publicado/); assert.match(msg.text, /https:\/\/acme\.example\.com\/a/); assert.match(msg.text, /unsubscribe/);
  assert.doesNotMatch(msg.text, /\d+\s?€|salario|sueldo de/i, 'no inventa cifras: solo la retribución escrita en la oferta');
  assert.match(renderDigest({ offers: [opp('a'), opp('b')], unsubscribeUrl: 'https://x.example.com/u' }).subject, /2 ofertas/);
});

// ── orquestación con dependencias simuladas ──
const base = (over = {}) => {
  const calls = { sent: [], enqueued: [], claimed: [], marked: [] };
  const rows = new Map(); // offerKey → estado
  const deps = {
    env: { STUDENT_ALERTS_ENABLED: '1', ALERTS_SECRET: SECRET, PUBLIC_BASE_URL: 'https://app.example.com' },
    now: () => Date.parse('2026-11-27T07:00:00Z'),
    hasKey: async () => true,
    listOptedIn: async () => [{ user_id: U1, email: 'ana@example.com' }, { user_id: U2, email: 'bea@example.com' }],
    recommend: async uid => ({ ready: true, matches: uid === U1 ? [match('a'), match('b')] : [match('c')] }),
    existing: async () => ({ offerIds: new Set(), sentToday: 0 }),
    enqueue: async (uid, offerIds) => { calls.enqueued.push([uid, offerIds]); return offerIds.map(o => ({ id: `${uid}:${o}`, offer_id: o })); },
    claim: async ids => { calls.claimed.push(ids); return ids.filter(id => !rows.has(id) && rows.set(id, 'sending')); },
    mark: async (id, status, reason) => { calls.marked.push([id, status, reason]); return true; },
    send: async (to, msg) => { calls.sent.push([to, msg]); return { ok: true, detail: 'ok' }; },
    deadline: () => false,
    ...over,
  };
  return { deps, calls };
};

await step('apagado: no lee ni envía nada y lo dice', async () => {
  const { deps, calls } = base({ env: {} });
  const r = await runAlerts(deps);
  assert.equal(r.enabled, false); assert.equal(calls.sent.length, 0); assert.equal(calls.enqueued.length, 0); assert.match(r.reason, /apagad/i);
});
await step('sin secreto de baja o sin clave de Resend no se envía ni se encola', async () => {
  for (const [over, re] of [[{ env: { STUDENT_ALERTS_ENABLED: '1' } }, /ALERTS_SECRET/], [{ hasKey: async () => false }, /Resend/]]) {
    const { deps, calls } = base(over); const r = await runAlerts(deps);
    assert.equal(calls.sent.length, 0); assert.equal(calls.enqueued.length, 0); assert.match(r.reason, re);
  }
});
await step('un correo por alumna con sus ofertas; marca enviado solo lo que se envió', async () => {
  const { deps, calls } = base(); const r = await runAlerts(deps);
  assert.equal(calls.sent.length, 2); assert.deepEqual(calls.sent.map(s => s[0]).sort(), ['ana@example.com', 'bea@example.com']);
  assert.equal(r.sent, 2); assert.equal(r.offers, 3);
  assert.deepEqual(calls.marked.map(m => m[1]), ['sent', 'sent', 'sent'], 'una marca por oferta');
  assert.match(calls.sent[0][1].text, /api\/alerts\/unsubscribe\?u=/);
});
await step('quien no reclama la fila no envía (otro proceso la tiene)', async () => {
  const { deps, calls } = base({ claim: async () => [] }); const r = await runAlerts(deps);
  assert.equal(calls.sent.length, 0); assert.equal(r.sent, 0); assert.equal(r.skipped_claim, 2);
});
await step('un envío fallido se marca fallido con su motivo y no cuenta como enviado', async () => {
  const { deps, calls } = base({ send: async () => ({ ok: false, detail: 'Resend rechazó el aviso (HTTP 422).' }) }); const r = await runAlerts(deps);
  assert.equal(r.sent, 0); assert.equal(r.failed, 2);
  assert.ok(calls.marked.every(m => m[1] === 'failed' && /422/.test(m[2])));
});
await step('si no se puede leer lo ya avisado no se envía (un hueco no es un cero)', async () => {
  const { deps, calls } = base({ existing: async () => null }); const r = await runAlerts(deps);
  assert.equal(calls.sent.length, 0); assert.equal(r.unreadable, 2);
});
await step('si la cola no se puede escribir no se envía', async () => {
  const { deps, calls } = base({ enqueue: async () => null }); const r = await runAlerts(deps);
  assert.equal(calls.sent.length, 0); assert.equal(r.unreadable, 2);
});
await step('lo ya avisado y el tope diario se respetan', async () => {
  const { deps, calls } = base({ existing: async uid => uid === U1 ? { offerIds: new Set(['a', 'b']), sentToday: 1 } : { offerIds: new Set(), sentToday: 3 } });
  const r = await runAlerts(deps);
  assert.equal(calls.sent.length, 0); assert.equal(r.sent, 0);
});
await step('sin reloj se corta y se declara', async () => {
  let n = 0; const { deps } = base({ deadline: () => n++ >= 1 }); const r = await runAlerts(deps);
  assert.equal(r.truncated, true); assert.equal(r.sent, 1);
});
await step('sin alumnas con consentimiento no hay nada que hacer; sin poder listarlas se dice', async () => {
  const none = base({ listOptedIn: async () => [] }); const a = await runAlerts(none.deps); assert.equal(a.opted_in, 0); assert.equal(none.calls.sent.length, 0);
  const bad = base({ listOptedIn: async () => null }); const b = await runAlerts(bad.deps); assert.match(b.reason, /leer/i);
});
console.log(`\n${passed} PASS, ${failed} FAIL`); process.exit(failed ? 1 : 0);
