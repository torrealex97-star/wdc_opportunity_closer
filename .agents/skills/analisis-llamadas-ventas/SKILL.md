---
name: "analisis-llamadas-ventas"
description: "Analiza llamadas de ventas (setter, closer, cold call, onboarding) contra la rúbrica del Ultimate Sales Blueprint y devuelve scorecard, los 3 momentos que ganaron o costaron la venta, UNA corrección prioritaria, un drill de role-play y feedback listo para copiar/pegar. Usar SIEMPRE que el usuario pida analizar, auditar, puntuar, revisar o dar feedback de una llamada, transcripción de Fathom, grabación, \"game tape\", rendimiento de un closer o setter, patrones en varias llamadas, por qué no se cerró una venta, o \"analiza mi llamada cuando estoy hot\", aunque no diga la palabra \"skill\" ni \"rúbrica\". También para entrenar closers y setters con feedback de llamadas reales. Analyze/audit/score sales calls, call review, coaching feedback."
---

# Análisis de llamadas de ventas

Esta skill convierte una llamada de ventas en decisiones: qué falló, qué funcionó y qué corregir primero. El marco es el Ultimate Sales Blueprint (transcript del usuario). Su tesis central de entrenamiento: de 28 cosas mal en una llamada, solo una mueve el cierre más que las demás. Dar 28 correcciones no entrena a nadie. Por eso el output siempre termina en UNA prioridad.

## Cuándo no usarla

- Para escribir guiones o scripts nuevos: es otra tarea (esta skill puede alimentarla con diagnóstico, nada más).
- Para analizar reuniones que no son de venta (standups, entrevistas internas).
- Llamadas sin discovery (reagendar, confirmar cita, buzón de voz): responder solo "Sin discovery en esta llamada. Nada que puntuar."

## Paso 1: Identificar tipo de llamada y modo

Si el usuario no lo dice, deduce del contenido. Pregunta solo si es imposible deducirlo y cambia el análisis de forma material.

Tipos (cada uno pondera distinto, ver `references/rubrica.md`):
- **Closer** (llamada de cierre, 1 o 2 llamadas): rúbrica completa.
- **Setter / cualificación**: peso en BANT, edificación del closer, agendar con dos opciones, notas al CRM.
- **Cold call / outbound**: peso en apertura, gancho (script del competidor), paso de "por qué me llamas" a cita.
- **Onboarding / CS**: peso en handshake, expectativas, coherencia con lo prometido en la venta.

Modos:
- **Una llamada**: scorecard completo (Paso 3 a 5).
- **Varias llamadas / un equipo**: patrones. Ver sección "Modo multi-llamada".
- **Llamada hot**: si el usuario dice que fue una llamada excepcional, cambia el objetivo a extraer qué hizo distinto (tono, pausas, transición al cierre, objeciones tempranas) para sistematizarlo.

## Paso 2: Conseguir la transcripción

Orden de preferencia:
1. Transcripción pegada o archivo adjunto: úsala directamente.
2. Fathom (conector disponible): cargar herramientas con ToolSearch (`select:` de las de Fathom que necesites). Si el usuario da URL o call ID, resolver con `get_recording_by_url` o `get_recording_by_call_id` y luego `get_meeting_transcript`. Si pide "mi última llamada" o "llamadas de esta semana", `list_meetings` y luego transcript. No afirmes nada del contenido sin haber leído el transcript: el análisis sin evidencia es opinión.
3. Solo audio o vídeo sin transcripción: dilo y pide la transcripción; no inventes.

Si la transcripción no distingue hablantes, infiere por contexto (quien pregunta y guía suele ser el vendedor) y avisa en una línea.

## Paso 3: Evaluar con evidencia

Lee `references/rubrica.md` y puntúa cada criterio en 0, 1 o 2:
- 0 = ausente o hecho mal de forma que perjudica.
- 1 = parcial, o presente pero tarde / sin ejecución.
- 2 = bien ejecutado.

Reglas de evaluación (y por qué):
- **Cada puntuación lleva evidencia**: una cita corta (menos de 15 palabras) con marca de tiempo si existe. Sin evidencia no hay nota, porque el closer discutirá cualquier nota sin prueba.
- **"No evaluable" es una respuesta válida.** Si el transcript no cubre un criterio (ej. velocidad de respuesta al lead no aparece en una llamada), márcalo NE y excluye ese peso del total. Puntuar lo que no viste contamina la nota.
- **Mide la conversación, no el resultado.** Una venta cerrada con mala ejecución sigue siendo mala ejecución (la suerte existe), y una llamada perdida con ejecución excelente puede ser un lead inviable. Separa "ejecución" de "resultado" y dilo.
- **Ratio de habla**: si el transcript trae tiempos o conteo de palabras por hablante, calcúlalo (el objetivo es que el prospecto hable aproximadamente dos tercios). Si no, estima por turnos y márcalo como estimación.

Cálculo: puntuación de la fase = suma de puntos / máximo posible de criterios evaluables x peso de la fase. Total sobre 100 con los pesos de la rúbrica, renormalizado si hay NE.

## Paso 3b: Auditoría BANT y decisión (obligatoria en setter y closer)

Objetivo: decir en 30 segundos si el vendedor tomó la decisión correcta y qué corregir, usando solo lo que la transcripción demuestra. (Método BANT Coach de ACQ integrado.)

**1. La vara de cada letra.** Usa en este orden: la vara escrita en el script del usuario o en la skill `scalix-ventas` (sección 2.3); si no hay, la vara por defecto:
- Budget: puede pagar el precio.
- Authority: todos los decisores están en esta llamada o en la siguiente.
- Need: un objetivo concreto + un obstáculo real que se lo impide.
- Timing: quiere resolverlo ya, no "algún día".
No inventes umbrales numéricos de Scalix: si no están escritos, usa la vara por defecto y dilo en una línea.

**2. Estado de cada letra (símbolo primero, siempre en orden B-A-N-T):**
- ✓ fuerte: cumple la vara, o la duda surgió y se resolvió en la llamada.
- ~ débil: se preguntó, pero la respuesta fue vaga o quedó sin resolver.
- ✗ falla: claramente no cumple o dijo que no, aunque el vendedor no preguntara y lo soltara el prospecto.
- ? nunca salió. Si salió cualquier parte de la vara, usa ✓, ~ o ✗.
Línea: `✓ Budget · ~ Authority · ✗ Need · ? Timing`

**3. Decisión.** "Avanzó" = agendó (setter) o vendió / dejó siguiente llamada cerrada (closer). Un "lo pienso", "mándame info" o "te llamo yo" cuenta como Paró.
| Vendedor | BANT | Decisión |
| Avanzó | todo ✓ | Correcto avanzar |
| Avanzó | algún ~ o ?, ningún ✗ | Avanzó sin cualificar bien |
| Avanzó | algún ✗ | No debió avanzar |
| Paró | algún ✗ | Correcto parar |
| Paró | ningún ✗ | Paró demasiado pronto |

**4. Fixes BANT (máx. 4, orden Need → Authority → Budget → Timing; el primero lleva "empieza aquí"; máx. 30 palabras cada uno).** Formato: Letra (estado): qué pasó → qué hacer. Pointer al script o a la sección de `scalix-ventas`.
- Need: ? preguntar qué le frena del objetivo; ~ bajar un nivel (ejemplo, número, qué le cuesta); ✗ no avanzar sin necesidad real.
- Authority: ? preguntar quién más interviene en la decisión; ~ traerlo a la siguiente llamada; ✗ no avanzar sin el decisor.
- Budget: ? hacer la pregunta de cualificación de dinero; ~ preguntar si es el problema más importante y si compensa invertir; ✗ no avanzar por debajo de la vara.
- Timing: ? preguntar cuándo quiere resolverlo; ~ preguntar qué pasa si espera 6 meses; ✗ no avanzar fuera de ventana.
- Si la Decisión es "Paró demasiado pronto", el fix 1 es siempre el ask ("empieza aquí"): nunca pidió la venta → pedirla directo; se rindió ante la objeción → gestionarla y volver a pedir; aceptó un stall literal → buscar la preocupación real ("¿qué es lo principal que estás sopesando?") y pedir otra vez.
- Si es "Correcto avanzar" o "Correcto parar": sin fixes BANT.

**Reglas BANT (por qué: sin ellas el score se vuelve opinión):**
1. Nunca adivines: lo que no se preguntó es ?. Nunca inventes cifras.
2. Usa las palabras del prospecto como hecho. "Mi socio y yo" = dos decisores. Si da margen y facturación, haz la cuenta antes de juzgar Budget (20% sobre 1,2 M = 240 k).
3. Agendar la siguiente llamada no es Timing. La urgencia de negocio ("necesito arreglar esto") es Need, no Timing.
4. Cita solo palabras que puedas copiar exactas; si la línea parece corrupta (transcripción automática), descríbela sin comillas.
5. Identifica quién es el vendedor y quién el prospecto. Puntúa solo lo dicho, nunca tono, ritmo ni pausas en este bloque.
6. Una llamada por bloque; varias llamadas, un bloque por llamada.
7. Ejemplos de conducta correcta: setter que agenda con ✗ Budget = "No debió avanzar"; closer que vende sin preguntar por el marido que citó = "Avanzó sin cualificar bien"; closer que deja ir a alguien todo ✓ tras un "mándame info" = "Paró demasiado pronto".

**5. Drill del fix "empieza aquí" (menos de 25 palabras, sin comillas):** quién hace de prospecto y qué practica el vendedor. Si no hay fixes, "—". Este drill se integra con el del Paso 5 (no hay dos drills).

## Paso 4: Diagnosticar

1. **Los 3 momentos que decidieron la llamada**: el momento donde se ganó terreno, el momento donde se perdió (o se estuvo a punto) y el momento que se dejó pasar (pregunta no hecha, objeción mal leída). Cada uno con cita, qué pasó, qué debió pasar.
2. **Tipo de problema**, porque cambia la solución:
   - Problema de **adherencia** (no sigue el script): se entrena script word for word antes que nada.
   - Problema de **script** (lo sigue y no cierra): se cambia el script, no al vendedor.
   - Problema de **lead** (no cualificado en BANT): se corrige arriba, en setter o en el filtro.
   - Problema de **proceso fuera de la llamada** (no-show, velocidad de respuesta, agenda): no lo arregla ningún entrenamiento de cierre.
3. **La corrección prioritaria (solo una)**. Elígela con este orden de impacto, porque es el orden en que suelen perder dinero las llamadas:
   1. No hubo pain cycle ni cuantificación del coste de no actuar.
   2. "Zombies" (BANT, decisor, timing) aparecieron después de pedir el dinero.
   3. Cayó en detalles (respondió preguntas a ciegas, sin devolver pregunta).
   4. No pidió la venta, o no volvió a pedir tras el primer no.
   5. Habló más que el prospecto / pitch largo sobre el producto.
   6. Sin agenda de apertura (proof, promise, plan).
   7. Se vendió fuera de la venta (siguió hablando tras el sí) o negoció precio.
   8. Entrega: tono, ritmo, énfasis, conviction.
   Si hay un problema de adherencia o de lead, ese manda sobre la lista. Si el Paso 3b dio "No debió avanzar" o "Avanzó sin cualificar bien", el problema es de lead o de cualificación y la corrección es la letra BANT marcada "empieza aquí"; si dio "Paró demasiado pronto", la corrección es el ask (pedir otra vez), sea cual sea la nota por fase.

## Paso 5: Entregar

Formato por defecto: **texto plano listo para copiar/pegar**, sin HTML, sin tablas pesadas, en español. Usa HTML, PDF o doc solo si el usuario lo pide. Estructura exacta:

```
LLAMADA: [tipo] | [closer/setter] | [fecha o referencia] | Resultado: [cerrada / no / seguimiento]
NOTA: [xx]/100 (ejecución) | Ratio de habla vendedor/prospecto: [x/y, medido o estimado]
BANT: [✓/~/✗/? Budget · Authority · Need · Timing]
DECISIÓN: [Correcto avanzar / Avanzó sin cualificar bien / No debió avanzar / Correcto parar / Paró demasiado pronto]
FIXES BANT: [máx. 4 líneas numeradas, la primera "empieza aquí"; "—" si no hay]

SCORECARD POR FASE
- Apertura y agenda: x/10
- Clarify + Label + Pain cycle: x/25
- Pitch (3 pilares, metáfora): x/10
- Control con preguntas: x/15
- Objeciones y cierre: x/30
- Handshake / siguiente paso: x/5
- Rapport y ética: x/5
(NE: [criterios no evaluables y por qué])

3 MOMENTOS QUE DECIDIERON LA LLAMADA
1. [Ganó] "[cita corta]" [timestamp]: qué pasó y por qué importó.
2. [Perdió] "[cita corta]" [timestamp]: qué pasó; qué debió decir (línea concreta).
3. [Dejó pasar] ...

DIAGNÓSTICO: [adherencia / script / lead / proceso] porque [una frase].

LA CORRECCIÓN (UNA SOLA): [habilidad en una frase]
Por qué esta y no otra: [una frase con el impacto esperado en cierre]

DRILL (10 min, role-play)
Prospecto interpreta: [objeción o situación real de esta llamada]
Vendedor repite [la línea correcta] 5 a 6 veces seguidas; el manager corta al fallo y repite.
Criterio de "listo": [conducta observable].

FEEDBACK PARA EL CLOSER (copiar/pegar)
[6 a 10 líneas, tono directo, empieza por lo que hizo bien, una sola corrección, la línea exacta a usar, el drill.]
```

Después del bloque, cierra con **una** pregunta que haga avanzar al usuario (por ejemplo: "¿La pasamos a otras 5 llamadas de este closer para confirmar si es patrón o fue esta llamada?"). Una pregunta, no tres.

## Modo rápido BANT (30 segundos)

Si el usuario pide solo "BANT", "game tape rápido", "¿hizo bien en agendar?" o pega una llamada de setter sin pedir análisis completo, entrega solo este bloque y nada más (sin scorecard, sin feedback):
```
Llamada: [rol] · [tipo] · [resultado]  (2 a 8 palabras)
Decisión: [de la tabla del Paso 3b]
BANT: [línea con símbolos]
Fixes: [máx. 4, primero "empieza aquí"; "—" si no hay]
Drill: [menos de 25 palabras; "—" si no hay]
```
Sin comentarios ni elogios fuera de ese formato. Ofrece el análisis completo con una sola pregunta.

## Modo multi-llamada

Cuando haya 3 o más llamadas (de un closer o del equipo):
1. Puntúa cada una con el scorecard abreviado (solo notas y 1 línea de evidencia por fase).
2. Busca el **patrón repetido**: la fase con peor media y la conducta que se repite. Un fallo en una llamada es ruido; en tres es hábito.
3. Compara llamadas cerradas vs perdidas del mismo vendedor: la diferencia entre ambas es la palanca (la lógica de analizar "cuando estoy hot").
4. Añade el patrón BANT: qué letra falla más (casi siempre Need o Authority se quedan en ~ o ?) y cuántas llamadas fueron "No debió avanzar" o "Paró demasiado pronto" por persona. Si un setter agenda mucho con ✗, es problema de cualificación aguas arriba, no de cierre.
5. Entrega: ranking, patrón por persona, UNA corrección por persona, y una corrección de equipo para el huddle diario (el equipo drilla una sola cosa a la vez).
5. Si todos siguen el script y nadie cierra, diagnostica el script. Si no lo siguen, no toques el script todavía.

## Modo llamada hot

Para una llamada excepcional (propia o de un closer), no puntúes: **destila**. Extrae con citas: cómo abrió, dónde cambió el tono, qué pausas usó, cómo transicionó al cierre, qué objeciones mató antes de pedir dinero. Salida: un "checklist de hotness" de 8 a 12 puntos observables que se pueda drillar y comparar contra llamadas frías.

## Honestidad del análisis

- Si la llamada fue buena, dilo y no inventes defectos para parecer riguroso. Una nota alta con una única mejora es un resultado válido.
- Si hay una señal de práctica poco ética (mentir sobre resultados, inventar escasez, vender a quien no puede beneficiarse), señálala como hallazgo propio, aparte de la nota: es el riesgo que más destruye una operación a largo plazo.
- No inventes datos del lead, del CRM ni de lo ocurrido fuera de la llamada.
- Diferencia lo observado de lo inferido ("no preguntó presupuesto" es observado; "probablemente no tenía dinero" es inferido).

## Referencias

- `references/rubrica.md`: criterios por fase con pesos, qué es un 2, banderas rojas y la línea correcta para cada fallo. Léelo siempre antes de puntuar.
- `references/objeciones.md`: objeción → teoría de fondo → 2 o 3 cierres, y el método AAA. Léelo cuando el análisis toque objeciones, precio, decisor o stalls, para proponer la línea correcta.