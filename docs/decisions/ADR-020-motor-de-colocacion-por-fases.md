# ADR-020 — Motor de colocación por fases sobre la candidatura asistida

Estado: **propuesta** (nada implementado; no cambia código ni datos) · Fecha: 2026-11-20
Relacionados: [ADR-012](ADR-012-assisted-applications.md) (candidaturas asistidas y condiciones para automatizar), [ADR-016](ADR-016-avisos-del-motor-por-correo.md) (correo saliente del motor), [ADR-018](ADR-018-motor-en-cuenta-propia-de-cloudflare.md) (dónde corre el motor), [ADR-009](ADR-009-cost-aware-search.md) (coste antes de gastar), [ADR-011](ADR-011-external-sources-tos.md) (términos por fuente), [spec/15](../spec/15_PRODUCT_VISION_AND_BOUNDARIES.md) (límites del producto) y [spec/19](../spec/19_JOB_ENGINE_AND_PLACEMENT.md) (diseño completo).

## Contexto

El propietario quiere convertir la academia en una **agencia de colocación**: que una alumna formada tenga trabajo sin buscarlo, con la app como representante. El plano que trajo (bandeja de aprobación, Kanban reactivo, auto-apply híbrido, alias de correo por alumna, extensión de navegador y candidaturas generadas por IA) es correcto como dirección, pero mezcla cosas que el repo **ya tiene**, cosas que **ADR-012 prohíbe** y cosas que son **infraestructura nueva** con coste y responsabilidad legal.

Lo que ya existe y este ADR da por bueno, sin rehacerlo: ingesta sin crawlers propios (catálogo Apify de 27 portales y 70 buscadores, deduplicación por huella, puntuación 0-100, `autoReview` con `oferta_peligrosa`), perfil de candidatura tipado con consentimiento de autorrelleno fechado y retirable, candidaturas asistidas con estados `draft → opened → applied → responded → interview → offer → rejected`, asistente de respuestas con permiso por envío y proyección de alumna allowlisted.

## Decisión

1. **El motor se construye en fases y cada fase se mide antes de abrir la siguiente.** Orden: (0) este diseño, (1) bandeja de aprobación y Kanban de solo lectura, (2) correo entrante para mover el Kanban, (3) envío automático a formularios abiertos y correo. Ninguna fase envía nada mientras la anterior no tenga evidencia en STATUS.
2. **La candidatura sigue siendo de la alumna.** El motor prepara, ordena y explica; ella aprueba cada envío. El automatismo sin aprobación por candidatura solo se estudia tras un periodo medido y con permiso escrito, tal como fijó ADR-012.
3. **Canales permitidos, y solo estos:** correo desde un dominio de la academia identificado como WDC y formularios públicos de la propia empresa. **Prohibido**: automatizar cuentas personales de portales (LinkedIn, InfoJobs, Easy Apply), reutilizar cookies, tokens o sesiones de terceros, y publicar una extensión que rellene campos en portales con login. La "Vía B" del plano queda sustituida por el asistente de copiado que ya existe: borrador listo, ella pega, dos clics.
4. **Tope por oferta para no quemarla**: como máximo **2 candidatas WDC por oferta y ventana de 7 días**, priorizando por encaje; el cupo se registra en la oferta y se muestra en el panel. Variar el texto no arregla cinco candidaturas del mismo nicho al mismo anuncio: el problema es de reparto, no de redacción.
5. **El Kanban solo se mueve con hechos registrados**: aprobación de la alumna, envío confirmado, respuesta clasificada con su correo original guardado. Nunca por deducción del modelo ni por una corazonada. Cada tarjeta conserva su procedencia y su enlace al anuncio.
6. **Candado de calidad con modo lectura**: el acceso a *aplicar* se desbloquea por fases (roleplays aprobados, vídeo, CV), con umbrales configurables por la coordinadora; **ver ofertas nunca se bloquea**, para no dejar a una alumna fuera del mercado por un vídeo pendiente.
7. **Datos**: `student_application_profiles` sigue siendo la fuente única; el LLM recibe lo mínimo imprescindible y **nunca** el perfil completo ni datos de alumnas sin acuerdo de tratamiento y retención cero; el texto de la oferta es dato no confiable (inyección). Toda lectura y escritura se acota por organización y por `user_id` de la sesión.
8. **El alias de correo por alumna es otro ADR.** Requiere dominio propio con MX, política de retención y borrado del contenido de terceros, y mandato escrito de la alumna para escribir en su nombre. Hasta entonces, el correo entrante no se implementa.
9. **Dónde corre**: lo que es HTTP y colas cortas, en Cloudflare Workers ([ADR-018](ADR-018-motor-en-cuenta-propia-de-cloudflare.md)); un navegador automatizado, si algún día se aprueba, vive en un host aparte con su propio presupuesto y su propia autorización — Vercel no ejecuta procesos persistentes y este repo no tiene Redis.
10. **Todo apagado por defecto**: cualquier envío automático nace detrás de una variable de entorno (`APPLY_AUTOMATION=off`), con topes por día/semana/empresa, registro de auditoría de cada acción, claim atómico antes de enviar (`UPDATE … WHERE status='draft'` y seguir solo si la fila es nuestra), allowlist de ATS y campos versionados, conjunto dorado de evaluación y kill-switch inmediato.

## Consecuencias

- La fase 1 se puede construir **sin ninguna autorización nueva**: no envía, no gasta y no toca contratos guardados; reutiliza ofertas, matches, candidaturas y asistente.
- Las fases 2 y 3 quedan **bloqueadas por decisión del dueño**, no por falta de diseño: dominio y MX, mandato de representación, host del navegador y presupuesto.
- El producto no promete colocación: la app mejora la probabilidad y la mide; cualquier comunicación pública con "garantía" debe declarar base de cálculo, condiciones y exclusiones, y no puede vivir en la UI sin revisión.
- Si una fase no demuestra mejora medida (candidaturas aprobadas por hora, respuestas por candidatura, entrevistas por respuesta), no se abre la siguiente: se retira.

## Lo que este ADR no decide

Dominio y proveedor de correo entrante, host y presupuesto del navegador automatizado, umbrales numéricos del candado (los fija la coordinadora en el panel el día que existan) y si algún día se permite envío sin aprobación por candidatura. Cada uno de esos cuatro puntos necesita su decisión escrita antes de escribir código que dependa de ella.
