import { test, expect } from './stubs';

const debrief = {
  summary: 'Has abierto con contexto y has preguntado por el seguimiento. La apertura aún pide demasiada explicación antes de interesar.',
  focus: 'Cerrar con un siguiente paso concreto en vez de dejar la conversación abierta.',
  strengths: ['Pides permiso antes de entrar en materia', 'Devuelves una pregunta en lugar de justificarte'],
  improvements: ['Abre con el problema, no con el producto', 'Propón un siguiente paso con día y hora'],
  axes: [
    { id: 'apertura', label: 'Apertura y marco', score: 78, note: 'Entras con contexto y sin disculparte.', quote: 'Me interesa entender cómo gestionáis los seguimientos' },
    { id: 'descubrimiento', label: 'Descubrimiento', score: 64, note: 'Preguntas, pero aún no cuantificas el coste.', quote: 'Te llamo porque he visto que perdéis seguimientos' },
    { id: 'objecion', label: 'Objeciones', score: 58, note: 'No hubo objeción que trabajar en esta conversación.', quote: '' },
    { id: 'cierre', label: 'Cierre', score: 42, note: 'La conversación termina sin día ni hora.', quote: '' },
  ],
  score: 61,
  bant: {
    budget: { status: '~', quote: '' },
    authority: { status: '?', quote: '' },
    need: { status: '✓', quote: 'he visto que perdéis seguimientos' },
    timing: { status: '?', quote: '' },
    decision: 'avanzar_sin_cualificar',
  },
  signals: [
    { id: 'sin-paso', label: 'Sin siguiente paso concreto', detail: 'Un día, una hora y una acción pequeña convierten el interés en algo que se puede cumplir.', quote: 'Me interesa entender cómo gestionáis los seguimientos' },
    { id: 'largo', label: 'Un mensaje demasiado largo', detail: 'Ese mensaje tiene 340 caracteres. En una llamada real, tres frases seguidas suelen perder al interlocutor.', quote: 'Me interesa entender cómo gestionáis los seguimientos' },
  ],
  model: 'Marta, por lo que me cuentas el seguimiento se pierde en el correo. ¿Qué pasa cuando un cliente ya dijo que sí y no recibe respuesta?',
  next: 'Repite la llamada cerrando con una reunión de 15 minutos el jueves a las 10:00.',
};

// La vista de alumna carga oportunidades al montar: se neutraliza para aislar la práctica.
const emptyCatalog = (route: import('@playwright/test').Route) => route.fulfill({ json: { items: [], total: 0 } });

// Cerrar una práctica registra actividad: se simula en toda la prueba para no escribir en el backend
// compartido (las pruebas que además la inspeccionan registran su propia ruta, que gana por ser posterior).
test.beforeEach(async ({ page }) => {
  await page.route('**/api/student/activity', route => route.fulfill({ status: 201, json: { ok: true } }));
});

// El menú separa Práctica (roleplay por rol), Entrevistas y Revisión de llamada; closer es la primera sala.
const openRoom = async (page: import('@playwright/test').Page, tab = 'Closer · voz') => {
  await page.getByRole('button', { name: 'Práctica' }).click();
  await page.getByRole('tab', { name: tab }).click();
};

test('la sala de AI roleplay abre sin código, conversa y devuelve feedback con ejes y señales', async ({ page }) => {
  const calls: Record<string, unknown>[] = [];
  const activity: Record<string, unknown>[] = [];
  await page.route('**/api/backend/opportunities/search', emptyCatalog);
  await page.route('**/api/student/activity', route => { activity.push(route.request().postDataJSON()); return route.fulfill({ status: 201, json: { ok: true } }); });
  await page.route('**/api/practice', route => {
    // La sala pide primero las etiquetas de los ejes (GET); el resto es la conversación.
    if (route.request().method() === 'GET') return route.fulfill({ json: { labels: {} } });
    const body = route.request().postDataJSON();
    calls.push(body);
    if (body.mode === 'debrief') return route.fulfill({ json: { debrief } });
    return route.fulfill({ json: { reply: 'Entiendo. ¿Y cómo lo estaríais midiendo?' } });
  });
  await page.goto('/');
  await openRoom(page);
  await expect(page.getByRole('heading', { name: 'Ensaya la llamada de cierre.' })).toBeVisible();
  await expect(page.locator('.practice-card')).toHaveCount(13);
  await expect(page.locator('.practice-level[data-intensity="dura"]')).toHaveCount(3);
  // Sin puerta previa: «Practicar» entra directo a la sala.
  await page.locator('.practice-card').first().getByRole('button', { name: 'Practicar' }).click();
  await expect(page.getByText('¿Sí? Dime, que estoy entre reuniones.')).toBeVisible();
  expect(await page.locator('.practice-gate').count()).toBe(0);
  const reply = page.getByLabel('Tu respuesta');
  await reply.fill('Hola Marta, te llamo porque he visto que perdéis seguimientos.');
  await page.getByRole('button', { name: 'Enviar respuesta' }).click();
  await expect(page.getByText('Entiendo. ¿Y cómo lo estaríais midiendo?')).toBeVisible();
  await reply.fill('Me interesa entender cómo gestionáis los seguimientos');
  await page.getByRole('button', { name: 'Enviar respuesta' }).click();
  await expect(page.locator('.practice-turn.is-mine')).toHaveCount(2);
  await page.getByRole('button', { name: 'Terminar y ver feedback' }).click();
  await expect(page.getByRole('heading', { name: 'Qué ha funcionado y qué pulir.' })).toBeVisible();
  // La nota global es la media de los ejes y se presenta como estimación.
  await expect(page.locator('.practice-score-total b')).toHaveText('61');
  await expect(page.locator('.practice-score-total small')).toHaveText('estimación');
  await expect(page.locator('.practice-axis')).toHaveCount(4);
  await expect(page.locator('.practice-axis dt b')).toHaveText(['78', '64', '58', '42']);
  await expect(page.getByRole('meter', { name: 'Cierre: 42 de 100' })).toHaveAttribute('aria-valuenow', '42');
  await expect(page.getByText('LA CORRECCIÓN PRIORITARIA · UNA SOLA')).toBeVisible();
  await expect(page.getByText('Cerrar con un siguiente paso concreto en vez de dejar la conversación abierta.')).toBeVisible();
  // La auditoría BANT de la skill viaja con el feedback, con sus cuatro letras y la decisión.
  await expect(page.getByText('CUALIFICACIÓN DE LA LLAMADA · BANT')).toBeVisible();
  await expect(page.locator('.practice-bant-grid dt')).toHaveText(['~ Presupuesto', '? Autoridad', '✓ Necesidad', '? Momento']);
  await expect(page.getByText('Avanzó sin cualificar bien')).toBeVisible();
  // Señales deterministas y respuesta modelo.
  await expect(page.getByRole('heading', { name: 'Señales de estilo' })).toBeVisible();
  await expect(page.locator('.practice-signals li')).toHaveCount(2);
  await expect(page.getByText('Sin siguiente paso concreto')).toBeVisible();
  await expect(page.getByText(/Una forma posible con tus propias palabras/)).toBeVisible();
  expect(calls.filter(call => call.mode === 'debrief')).toHaveLength(1);
  // La nota y la de cada eje alimentan «Mi progreso»; el texto de la conversación no se envía.
  await expect.poll(() => activity.length).toBe(1);
  expect(activity[0]).toMatchObject({ kind: 'practice', ref: 'venta-fria', score: 61, detail: { mode: 'texto', axes: { apertura: 78, descubrimiento: 64, objecion: 58, cierre: 42 } } });
  expect((activity[0] as { detail: { duration_s?: number } }).detail.duration_s).toBeGreaterThanOrEqual(1);
  // La petición ya no lleva código de cohorte.
  expect(calls.every(call => !('code' in call))).toBe(true);
  await expect(page.locator('.practice-debrief > .practice-note')).toHaveText(/no es una nota oficial/i);
  // El historial local conserva la puntuación de la sesión.
  await page.getByRole('button', { name: 'Elegir otra situación' }).click();
  await expect(page.locator('.practice-history-score')).toHaveText('61/100');
});

test('una práctica vieja sin ejes se sigue pudiendo leer desde el historial', async ({ page }) => {
  const legacy = {
    id: 'vieja-1', scenarioId: 'venta-fria', title: 'Llamada en frío a una directora de marketing', startedAt: Date.now(), turns: 2,
    debrief: { summary: 'Resumen antiguo.', strengths: ['Algo bien'], improvements: ['Algo a pulir'], moments: [{ quote: 'Hola', why: 'Apertura.' }], next: 'Repite.' },
  };
  await page.addInitScript(value => {
    window.localStorage.setItem('wdc_practice_history', JSON.stringify([value]));
  }, legacy);
  await page.route('**/api/backend/opportunities/search', emptyCatalog);
  await page.goto('/');
  await openRoom(page);
  await expect(page.locator('.practice-history li')).toHaveCount(1);
  await expect(page.locator('.practice-history-score')).toHaveCount(0);
  await page.getByRole('button', { name: 'Ver feedback' }).click();
  await expect(page.getByRole('heading', { name: 'Qué ha funcionado y qué pulir.' })).toBeVisible();
  await expect(page.locator('.practice-moments blockquote')).toHaveText('«Hola»');
  await expect(page.locator('.practice-score')).toHaveCount(0);
});

test('un error del proveedor no pierde la conversación ni la puerta vuelve', async ({ page }) => {
  await page.route('**/api/backend/opportunities/search', emptyCatalog);
  await page.route('**/api/practice', route => route.fulfill({ status: 502, json: { detail: 'No se ha podido completar la respuesta. La conversación no se ha perdido: vuelve a intentarlo.' } }));
  await page.goto('/');
  await openRoom(page);
  await page.locator('.practice-card').first().getByRole('button', { name: 'Practicar' }).click();
  await page.getByLabel('Tu respuesta').fill('Hola, ¿qué tal?');
  await page.getByRole('button', { name: 'Enviar respuesta' }).click();
  await expect(page.locator('.practice-error')).toHaveText(/no se ha perdido/);
  // Se queda en la sala con lo escrito: no hay puerta a la que volver.
  await expect(page.locator('.practice-turn.is-mine')).toHaveCount(1);
  await expect(page.getByLabel('Tu respuesta')).toBeVisible();
});

test('la sala cierra la conversación antes de que el feedback sea imposible', async ({ page }) => {
  await page.route('**/api/backend/opportunities/search', emptyCatalog);
  await page.route('**/api/practice', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { labels: {} } });
    const body = route.request().postDataJSON();
    if (body.mode === 'debrief') return route.fulfill({ json: { debrief } });
    return route.fulfill({ json: { reply: 'Entiendo. ¿Y cómo lo mediríais?' } });
  });
  await page.goto('/');
  await openRoom(page);
  await page.locator('.practice-card').first().getByRole('button', { name: 'Practicar' }).click();
  const reply = page.getByLabel('Tu respuesta');
  const send = page.getByRole('button', { name: 'Enviar respuesta' });
  // Diez respuestas llevan la conversación al tope de la sala (20 turnos).
  for (let i = 0; i < 10; i++) {
    await reply.fill(`Mensaje ${i + 1}: te cuento cómo lo gestionamos.`);
    await send.click();
    await expect(page.locator('.practice-turn.is-mine')).toHaveCount(i + 1);
    await expect(page.locator('.practice-turn.is-them .practice-bubble:not(.is-typing)')).toHaveCount(i + 2);
  }
  await expect(reply).toBeDisabled();
  await expect(page.locator('.practice-finish small')).toContainText('final de la simulación');
  // El feedback sigue disponible: la conversación nunca queda en un callejón sin salida.
  await page.getByRole('button', { name: 'Terminar y ver feedback' }).click();
  await expect(page.getByRole('heading', { name: 'Qué ha funcionado y qué pulir.' })).toBeVisible();
});

test('el dictado añade lo reconocido al borrador sin enviarlo y el orbe marca el estado', async ({ page }) => {
  await page.addInitScript(() => {
    class FakeRecognition {
      lang = ''; interimResults = false; continuous = false;
      onresult: ((event: unknown) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        const scope = window as unknown as { __fakeVoiceStarted?: boolean };
        scope.__fakeVoiceStarted = true;
        setTimeout(() => {
          const result = [{ transcript: 'he cerrado doce mil euros este trimestre' }] as Array<{ transcript: string }> & { isFinal?: boolean };
          result.isFinal = true;
          (window as unknown as { __fakeResultSent?: boolean }).__fakeResultSent = true;
          this.onresult?.({ resultIndex: 0, results: [result] });
        }, 250);
        setTimeout(() => this.onend?.(), 900);
      }
      stop() { this.onend?.(); }
      abort() { /* nada */ }
    }
    // defineProperty: asignar a window.SpeechRecognition puede ser ignorado si la propiedad no es escribible.
    Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: FakeRecognition });
    Object.defineProperty(window, 'webkitSpeechRecognition', { configurable: true, value: FakeRecognition });
  });
  await page.route('**/api/backend/opportunities/search', emptyCatalog);
  await page.route('**/api/practice', route => route.fulfill({ json: { reply: 'Sigue.' } }));
  await page.goto('/');
  await openRoom(page);
  await page.locator('.practice-card').first().getByRole('button', { name: 'Practicar' }).click();
  await expect(page.locator('.jarvis-orb')).toHaveAttribute('data-state', 'idle');
  await page.getByRole('button', { name: 'Dictar la respuesta' }).click();
  // El orbe refleja el micrófono abierto mientras escucha.
  await expect(page.locator('.jarvis-orb')).toHaveAttribute('data-state', 'listening');
  // Se ha usado el reconocimiento simulado, no el del navegador.
  expect(await page.evaluate(() => Boolean((window as unknown as { __fakeVoiceStarted?: boolean }).__fakeVoiceStarted))).toBe(true);
  await page.waitForFunction(() => Boolean((window as unknown as { __fakeResultSent?: boolean }).__fakeResultSent));
  await expect(page.getByLabel('Tu respuesta')).toHaveValue(/he cerrado doce mil euros/);
  // Nadie envía por hablar: el borrador espera a que la alumna pulse Enviar.
  await expect(page.locator('.practice-turn.is-mine')).toHaveCount(0);
});

test('hablar mientras el interlocutor lee lo interrumpe, pero su propio eco no', async ({ page }) => {
  await page.addInitScript(() => {
    const scope = window as unknown as { __cancels: number; __script: Array<{ text: string; final: boolean }> };
    scope.__cancels = 0;
    scope.__script = [];
    // Síntesis simulada: cuenta los cortes y arranca al instante.
    const synth = { cancel() { scope.__cancels += 1; }, speak(utterance: { onstart?: () => void }) { utterance.onstart?.(); } };
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synth });
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class { lang = ''; onstart?: () => void; onend?: () => void; onerror?: () => void; constructor(public text: string) {} } });
    class FakeRecognition {
      lang = ''; interimResults = false; continuous = false;
      onresult: ((event: unknown) => void) | null = null;
      onerror: ((event: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start() {
        const step = scope.__script.shift();
        if (!step) return;
        setTimeout(() => {
          const result = [{ transcript: step.text }] as Array<{ transcript: string }> & { isFinal?: boolean };
          result.isFinal = step.final;
          this.onresult?.({ resultIndex: 0, results: [result] });
        }, 150);
        // Como el navegador real con continuous=false: la sesión termina sola tras el resultado.
        setTimeout(() => this.onend?.(), 400);
      }
      stop() { this.onend?.(); }
      abort() { /* nada */ }
    }
    Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: FakeRecognition });
    Object.defineProperty(window, 'webkitSpeechRecognition', { configurable: true, value: FakeRecognition });
  });
  await page.route('**/api/backend/opportunities/search', emptyCatalog);
  await page.goto('/');
  await openRoom(page);
  await page.locator('.practice-card').first().getByRole('button', { name: 'Practicar' }).click();
  const opening = (await page.locator('.practice-turn.is-them .practice-bubble').first().innerText()).replace(/\s+/g, ' ');
  const cancels = () => page.evaluate(() => (window as unknown as { __cancels: number }).__cancels);
  const echoWords = opening.split(' ').slice(0, 6).join(' ');

  // 1) El micrófono capta la propia voz del interlocutor: ni se corta ni se añade al borrador.
  await page.evaluate(text => { (window as unknown as { __script: unknown[] }).__script.push({ text, final: true }); }, echoWords);
  await page.getByRole('button', { name: 'Escuchar' }).first().click();
  await expect(page.locator('.jarvis-orb')).toHaveAttribute('data-state', 'speaking');
  const before = await cancels();
  await page.getByRole('button', { name: 'Dictar la respuesta' }).click();
  await page.waitForTimeout(500);
  expect(await cancels()).toBe(before);
  await expect(page.getByLabel('Tu respuesta')).toHaveValue('');
  await expect(page.locator('.jarvis-orb')).toHaveAttribute('data-state', 'speaking');

  // 2) La alumna habla por encima con palabras propias: la locución se corta y el dictado se añade.
  await page.evaluate(() => { (window as unknown as { __script: unknown[] }).__script.push({ text: 'espera, déjame hacerte una pregunta antes', final: true }); });
  await expect(page.getByRole('button', { name: 'Dictar la respuesta' })).toBeVisible();
  await page.getByRole('button', { name: 'Dictar la respuesta' }).click();
  await expect(page.getByLabel('Tu respuesta')).toHaveValue(/déjame hacerte una pregunta/);
  expect(await cancels()).toBeGreaterThan(before);
  await expect(page.locator('.jarvis-orb')).not.toHaveAttribute('data-state', 'speaking');

  // 3) Escribir también calla la locución (y nada se envía solo).
  await page.getByRole('button', { name: 'Escuchar' }).first().click();
  await expect(page.locator('.jarvis-orb')).toHaveAttribute('data-state', 'speaking');
  await page.getByLabel('Tu respuesta').press('x');
  await expect(page.locator('.jarvis-orb')).not.toHaveAttribute('data-state', 'speaking');
  await expect(page.locator('.practice-turn.is-mine')).toHaveCount(0);
});

test('sin reconocimiento de voz no se ofrece el micrófono y se puede escribir', async ({ page }) => {
  await page.addInitScript(() => {
    const scope = window as unknown as Record<string, unknown>;
    scope.SpeechRecognition = undefined;
    scope.webkitSpeechRecognition = undefined;
  });
  await page.route('**/api/backend/opportunities/search', emptyCatalog);
  await page.goto('/');
  await openRoom(page);
  await page.locator('.practice-card').first().getByRole('button', { name: 'Practicar' }).click();
  await expect(page.getByRole('button', { name: 'Dictar la respuesta' })).toHaveCount(0);
  await page.getByLabel('Tu respuesta').fill('Escribo la respuesta a mano.');
  await expect(page.getByRole('button', { name: 'Enviar respuesta' })).toBeEnabled();
});

test('sin proveedor la sala lo dice y no inventa una respuesta', async ({ page }) => {
  await page.route('**/api/backend/opportunities/search', emptyCatalog);
  await page.route('**/api/practice', route => route.fulfill({ status: 503, json: { detail: 'La sala de práctica no está configurada en este despliegue.' } }));
  await page.goto('/');
  await openRoom(page);
  await page.locator('.practice-card').first().getByRole('button', { name: 'Practicar' }).click();
  await page.getByLabel('Tu respuesta').fill('Hola, ¿qué tal?');
  await page.getByRole('button', { name: 'Enviar respuesta' }).click();
  await expect(page.locator('.practice-error')).toHaveText(/no está configurada/);
  // Solo la apertura del interlocutor: no se fabrica una réplica si el proveedor falla.
  await expect(page.locator('.practice-turn.is-them')).toHaveCount(1);
  // El mensaje de la alumna sigue en la conversación.
  await expect(page.locator('.practice-turn.is-mine')).toHaveCount(1);
});

test('las salas separan closer, setter, frío y entrevista, y filtran por categoría', async ({ page }) => {
  await page.route('**/api/backend/opportunities/search', emptyCatalog);
  await page.goto('/');
  await openRoom(page);
  await expect(page.getByRole('tab', { name: 'Closer · voz' })).toHaveAttribute('aria-selected', 'true');
  // La sala de closer agrupa por momento: apertura, descubrimiento, objeciones y cierre.
  await expect(page.locator('.practice-card')).toHaveCount(13);
  for (const category of ['Apertura y marco', 'Descubrimiento', 'Objeciones', 'Cierre']) {
    await page.getByRole('button', { name: category, exact: true }).click();
    await expect(page.locator('.practice-card').first()).toBeVisible();
  }
  await page.getByRole('button', { name: 'Cierre', exact: true }).click();
  await expect(page.locator('.practice-card')).toHaveCount(3);
  // La carita del personaje (monograma) y su papel son visibles antes de practicar.
  await expect(page.locator('.practice-card').first().locator('.practice-persona .persona-face')).toHaveText(/^[A-Z]{2}$/);
  // Las entrevistas están en su propia entrada del menú, no como una pestaña más de práctica.
  await page.getByRole('button', { name: 'Entrevistas' }).click();
  await expect(page.getByRole('tab', { name: 'Closer · voz' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Entrevista · voz' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.practice-card')).toHaveCount(9);
  await page.getByRole('button', { name: 'Dueño directo', exact: true }).click();
  await expect(page.locator('.practice-card')).toHaveCount(1);
  await expect(page.locator('.practice-card')).toContainText('Carlos');
  // Entrar a la sala conserva la persona en la cabecera de la conversación.
  await page.locator('.practice-card').first().getByRole('button', { name: 'Practicar' }).click();
  await expect(page.locator('.practice-chat-head .persona-face')).toHaveText('CA');
  await expect(page.locator('.practice-chat-head')).toContainText('Carlos');
});

test('la sala de setter es de chat y deja el orbe de voz fuera', async ({ page }) => {
  await page.route('**/api/backend/opportunities/search', emptyCatalog);
  await page.route('**/api/practice', route => route.fulfill({ json: { reply: '¿Y en qué mes quieres abrir la segunda sede?' } }));
  await page.goto('/');
  await openRoom(page, 'Setter · chat');
  await expect(page.locator('.practice-card')).toHaveCount(5);
  await page.locator('.practice-card').first().getByRole('button', { name: 'Practicar' }).click();
  await expect(page.getByText('Chat simulado')).toBeVisible();
  await expect(page.locator('.jarvis-orb')).toHaveCount(0);
  await page.getByLabel('Tu respuesta').fill('Hola Nerea, soy Ana. ¿Cuándo te gustaría abrir la segunda sede?');
  await page.getByRole('button', { name: 'Enviar respuesta' }).click();
  await expect(page.getByText('¿Y en qué mes quieres abrir la segunda sede?')).toBeVisible();
});

test('el test del formulario de cualificación corrige cada respuesta y explica lo que lee quien contrata', async ({ page }) => {
  await page.route('**/api/backend/opportunities/search', emptyCatalog);
  await page.goto('/');
  await page.getByRole('button', { name: 'Práctica' }).click();
  await page.getByRole('tab', { name: 'Formulario · test' }).click();
  await expect(page.getByRole('heading', { name: 'El formulario que sí te llama.' })).toBeVisible();
  for (let i = 0; i < 8; i++) {
    await page.locator('.qualify-option').nth(2).click();
    await page.getByRole('button', { name: i === 7 ? 'Ver resultado' : 'Siguiente' }).click();
  }
  await expect(page.getByRole('heading', { name: 'Así se lee tu formulario.' })).toBeVisible();
  await expect(page.locator('.qualify-score b')).toHaveText('100');
  await expect(page.locator('.qualify-review > li')).toHaveCount(8);
  // La presentación libre se revisa con reglas explicables, no con una nota.
  await page.getByLabel('Tu presentación').fill('No tengo experiencia, soy muy trabajadora.');
  await page.getByRole('button', { name: 'Revisar mi presentación' }).click();
  await expect(page.locator('.qualify-criteria li[data-ok="false"]').first()).toBeVisible();
});

test('las señales en vivo aparecen tras responder, citan la frase y se declaran posibles', async ({ page }) => {
  await page.route('**/api/backend/opportunities/search', emptyCatalog);
  await page.route('**/api/student/activity', route => route.fulfill({ status: 201, json: { ok: true } }));
  await page.route('**/api/practice', route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { labels: {} } });
    return route.fulfill({ json: { reply: 'Sigue, te escucho.' } });
  });
  await page.goto('/');
  await openRoom(page);
  await page.locator('.practice-card').first().getByRole('button', { name: 'Practicar' }).click();
  // Sin respuestas de la alumna no hay nada que señalar: el panel no se pinta (no es un «0 señales»).
  await expect(page.getByTestId('live-signals')).toHaveCount(0);
  await page.getByLabel('Tu respuesta').fill('Entiendo lo que me dices, pero tienes que decidir hoy mismo.');
  await page.getByRole('button', { name: 'Enviar respuesta' }).click();
  const live = page.getByTestId('live-signals');
  await expect(live).toBeVisible();
  await expect(live).toContainText('Validaste con «pero»');
  await expect(live).toContainText('tienes que decidir hoy mismo');
  await expect(live).toContainText('Posibles');
  await expect(live).toContainText('El feedback final decide');
  // Las señales son de TODA la conversación: una segunda respuesta no borra la primera.
  await page.getByLabel('Tu respuesta').fill('¿Qué es lo que más te preocupa de decidir ahora?');
  await page.getByRole('button', { name: 'Enviar respuesta' }).click();
  await expect(page.locator('.practice-turn.is-mine')).toHaveCount(2);
  await expect(live).toContainText('Validaste con «pero»');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('si la respuesta no dispara ninguna señal, el panel lo dice en vez de quedarse mudo', async ({ page }) => {
  await page.route('**/api/backend/opportunities/search', emptyCatalog);
  await page.route('**/api/student/activity', route => route.fulfill({ status: 201, json: { ok: true } }));
  await page.route('**/api/practice', route => route.request().method() === 'GET' ? route.fulfill({ json: { labels: {} } }) : route.fulfill({ json: { reply: 'Dime.' } }));
  await page.goto('/');
  await openRoom(page);
  await page.locator('.practice-card').first().getByRole('button', { name: 'Practicar' }).click();
  await page.getByLabel('Tu respuesta').fill('Hola Marta, soy Ana. ¿Te viene bien que te robe tres minutos para entender cómo gestionáis los seguimientos?');
  await page.getByRole('button', { name: 'Enviar respuesta' }).click();
  const live = page.getByTestId('live-signals');
  await expect(live).toBeVisible();
  // O no hay señales y lo dice, o las que salen son de esa frase: nunca un panel vacío sin explicación.
  await expect(live.locator('p, li').first()).toBeVisible();
  await expect(live).toContainText('El feedback final decide');
});
