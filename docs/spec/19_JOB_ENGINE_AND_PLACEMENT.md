# 19 — Motor de colocación: de la candidatura asistida a la agencia que coloca

Estado: **diseño** (2026-11-20). Nada de este documento está implementado: no hay código nuevo, ni migraciones, ni variables de entorno, ni envíos. La decisión y sus candados están en [ADR-020](../decisions/ADR-020-motor-de-colocacion-por-fases.md); el estado ejecutable, en [STATUS](../STATUS.md).

Este documento existe para que cada fase se construya contra un contrato escrito y no contra una idea: qué pieza ya está, qué falta, qué se mide y qué requiere autorización del propietario.

## 1. Qué hay ya (y no se rehace)

| Pieza | Dónde | Qué aporta al motor | Qué le falta |
|---|---|---|---|
| Ingesta sin crawlers propios | `sites/engine/worker.js`, catálogo Apify de 27 portales y 70 buscadores, `apps/web/lib/apifyPortals.ts` | Ofertas limpias sin mantener scrapers | Nada para la fase 1 |
| Deduplicación y puntuación | `apps/web/lib/external.ts`, `apps/web/lib/autoReview.ts` | Misma oferta no se repite; 0-100 por encaje comercial; banderas rojas y `oferta_peligrosa` | Un orden específico "para esta alumna" (hoy el score es del anuncio, no del par) |
| Perfil de candidatura | `student_application_profiles`, `apps/web/lib/applicationProfile.ts` | Datos tipados para rellenar formularios, con consentimiento fechado y retirable | Que alguien lo consuma (hoy nada lo hace) |
| Candidaturas | `student_applications`, `apps/web/lib/applications.ts`, `/api/student/applications` | Borrador determinista, datos para copiar, estados hasta `offer` | Vista de bandeja, orden por encaje y cupo por oferta |
| Asistente de respuestas | `apps/web/lib/*answer*`, `ApplyAssistant.tsx`, `/api/student/answer-assistant` | Respuestas redactadas desde lo que ella ya escribió, con permiso por envío | Nada para la fase 1 |
| Proyección de alumna | `/alumna`, `StudentOpportunities.tsx`, `student/matches` | Solo lo allowlisted, con procedencia | Nada para la fase 1 |
| Correo del motor | `integration_connections` (`resend`), ADR-016 | Clave guardada; avisos del motor | Envío de candidaturas: **no** (fase 3) |

## 2. Arquitectura por fases

```
Fase 1 (hoy, sin autorización nueva)
  ofertas + perfil + candidaturas ──► bandeja «5 matches del día» ──► un botón: preparar y abrir
                                              │
                                              └──► Kanban de 5 columnas (solo hechos registrados)

Fase 2 (bloqueada: dominio, MX, mandato, retención)
  correo entrante ──► clasificador ──► mueve tarjeta + extrae enlace de reunión ──► «simular esta entrevista»

Fase 3 (bloqueada: host aparte, allowlist, presupuesto)
  formulario público de la empresa ──► worker con navegador ──► claim atómico ──► envío ──► auditoría
```

Cada flecha es un hecho guardado; ninguna es una inferencia del modelo. Si un dato no está, la tarjeta lo dice ("—" y el motivo), no lo inventa.

## 3. Fase 1 — Bandeja de aprobación y Kanban (este es el incremento siguiente)

**Objetivo:** que la alumna abra la app, vea cinco ofertas elegidas para ella con el borrador hecho y apruebe. Sin envíos: "aprobar" prepara la candidatura y abre el anuncio, igual que hoy, pero sin que ella busque.

**3.1 Orden por encaje del par (alumna, oferta).** Función pura y determinista `matchScore(profile, appProfile, offer)` → 0-100 con sus componentes declarados (nicho/perfil, mercado, idioma, modalidad, sueldo publicado, frescura, banderas). Se calcula en el servidor, se guarda en la respuesta y **no** se persiste todavía: si hace falta persistirlo para ordenar rápido, será una vista, no una tabla nueva. Se descartan del orden las ofertas con `oferta_peligrosa`, enlace cerrado o ya aplicadas por ella.

**3.2 Bandeja "5 matches del día"** (`/alumna`, pestaña de ofertas): cinco tarjetas, una por oferta, con por qué encaja (dos líneas, con la fuente del dato), el borrador ya redactado y tres acciones: **Aprobar y abrir**, **Guardar para luego**, **Descartar con motivo**. Nada de listas infinitas en la vista principal: la lista completa sigue existiendo detrás de "ver todas", con sus filtros de servidor.

**3.3 Cupo por oferta (anti-quema).** Antes de mostrar una oferta a una alumna se cuenta cuántas candidaturas WDC vivas tiene esa oferta en los últimos 7 días (`student_applications` por `offer_id`); con **2** o más, la oferta no entra en la bandeja de nadie y el panel del admin la marca "cupo lleno". No requiere migración: es una consulta agregada.

**3.4 Kanban de 5 columnas, derivado.** `Match detectado` (candidatura en `draft`), `Aplicada` (`opened`/`applied` con fecha), `Empresa interesada` (`responded`), `Entrevista agendada` (`interview`), `Oferta / contratada` (`offer`). `rejected` y `discarded` salen del tablero y van a "cerradas". **Ninguna columna se mueve a mano**: se mueve cuando cambia el estado registrado, y el estado lo cambia ella o (en fase 2) el correo entrante. Un estado sin fecha se muestra como "—" y con su causa.

**3.5 Candado de calidad con modo lectura.** `is_job_ready` se calcula (no se guarda): roleplays aprobados con la puntuación calibrada, vídeo y CV presentes en el perfil de candidatura. Sin candado, la alumna **ve** ofertas y prepara borradores, pero el botón de aprobar muestra "te falta X" con el enlace a donde se resuelve. Los umbrales son configuración de la coordinadora, no constantes escondidas.

**3.6 Contratos.** Se reutilizan `/api/student/applications` (POST prepara, PATCH mueve estado) y `/api/student/matches`; se añade como mucho un `GET /api/student/inbox` que devuelve las cinco tarjetas ya ordenadas y su motivo, con `Cache-Control: no-store` y `user_id` de la sesión. Ninguna ruta nueva escribe en la empresa.

**3.7 Criterios de aceptación (las pruebas que se escribirán antes de fusionar).**
1. `matchScore` es determinista y monótono: subir el sueldo publicado o el encaje de nicho nunca baja la puntuación; una bandera roja la baja.
2. La bandeja devuelve como máximo 5, sin repetir oferta, sin `oferta_peligrosa`, sin enlaces cerrados y sin ofertas con cupo lleno.
3. Dos alumnas con perfiles distintos reciben bandejas distintas para el mismo catálogo.
4. El Kanban no admite un estado que la base no tenga y no muestra fecha inventada.
5. Un `PATCH` de una alumna no puede mover la candidatura de otra (prueba de aislamiento por `user_id`).
6. Con el candado sin cumplir, aprobar devuelve el motivo y no crea candidatura.

## 4. Fase 2 — Correo entrante (diseño, no se implementa todavía)

Cuando el dueño decida dominio, MX y mandato: alias por alumna en un dominio de la academia, reenvío al correo personal y `email_threads` (organización, alumna, candidatura, remitente, asunto, cuerpo guardado, retención, clasificación). Clasificador con tres intenciones (`INTERVIEW_INVITE`, `REJECTION`, `INFO_REQUEST`) y umbral de confianza; con duda, la tarjeta se marca "revisar" y no se mueve. El enlace de reunión solo se extrae si está en el cuerpo y es https del dominio esperado; "Simular esta entrevista" precarga la oferta en la sala de práctica.

Bloqueos: contenido de terceros con retención y borrado definidos, mandato escrito de la alumna, SPF/DKIM/DMARC del dominio, y tope de volumen. Rotar dominios para esquivar filtros queda descartado: lo que se mide es rebotes y quejas.

## 5. Fase 3 — Envío automático a formularios abiertos (diseño, no se implementa todavía)

Solo formularios públicos de la empresa (Typeform, Tally, Airtable, web propia) y correo directo publicado en el anuncio. Nada de portales con login. Claim atómico antes de enviar, allowlist de ATS con mapeo de campos versionado, si un campo no se reconoce se pregunta a la alumna, topes por día/semana/empresa, auditoría de cada envío con su captura y su código de respuesta, kill-switch y `APPLY_AUTOMATION=off` por defecto. Host aparte con su presupuesto ([ADR-018](../decisions/ADR-018-motor-en-cuenta-propia-de-cloudflare.md) no cubre navegadores) y conjunto dorado de formularios antes de un solo envío real.

## 6. Legal y reputación (lo que no se puede dejar para después)

- **Representación:** escribir a una empresa en nombre de una alumna exige su mandato y que la empresa no se lleve a engaño sobre quién escribe. El correo se firma como WDC actuando para la alumna.
- **Términos de terceros:** automatizar cuentas personales de portales es la vía más rápida a un bloqueo y a una reclamación; queda fuera por ADR-012 y por este diseño.
- **Datos de alumnas:** nada de perfil completo a un LLM; mínimo imprescindible, retención cero y acuerdo de tratamiento.
- **Promesas:** "colocación garantizada" no se publica sin base de cálculo, condiciones y exclusiones. La app mide; no garantiza.
- **Correo:** volumen bajo, autenticado y medido vale más que rotación de dominios.

## 7. Qué necesita el dueño antes de que se escriba código de las fases 2 y 3

1. Dominio (o dominios) y quién mantiene DNS/MX, con política de retención del correo entrante.
2. Mandato/consentimiento de representación por alumna, con su texto y su forma de retirarlo.
3. Host y presupuesto del navegador automatizado, o decisión de no tenerlo.
4. Umbrales del candado de calidad y si algún día se permite envío sin aprobación por candidatura.

Sin esas cuatro respuestas, el motor se queda en la fase 1, que ya mejora la probabilidad de colocación sin exponer la marca ni la cuenta de nadie.
