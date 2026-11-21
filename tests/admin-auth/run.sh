#!/usr/bin/env bash
# Prueba del acceso al panel: arranca la app (next start) con Supabase y motor simulados y lanza flow.mjs.
# Requiere `npm run build` previo. Uso: bash tests/admin-auth/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
export NODE_NO_WARNINGS=1
# Antes de arrancar nada: ninguna prueba puede llamar a una ruta o fichero que no esté en el repositorio (y el chequeo se prueba a sí mismo).
node tests/orphan-refs.selftest.mjs
node tests/orphan-refs.mjs
# Comprobación en seco de la retirada masiva: cuenta motivos y se aborta si el motor no simula.
node tests/withdraw-preview.mjs
export PORT=3199
SUPABASE_URL=http://127.0.0.1:8791 SUPABASE_PUBLISHABLE_KEY=anon-key SUPABASE_SERVICE_ROLE_KEY=service-key \
CAREER_ENGINE_URL=http://127.0.0.1:8792 CAREER_ADMIN_TOKEN=engine-token ADMIN_PUBLIC_URL=https://app.test.dev \
URL_GUARD_TEST_ALLOW=127.0.0.1:8792 STUDENT_AUTH_CACHE_MS=0 APIFY_MONTHLY_BUDGET_USD=5 INGEST_TOKEN=ingest-token-0123456789abcdef0123 CRON_SECRET=cron-secret-0123456789 INFOJOBS_API_BASE=http://127.0.0.1:8791 ADZUNA_API_BASE=http://127.0.0.1:8791 JOOBLE_API_BASE=http://127.0.0.1:8791 APIFY_API_BASE=http://127.0.0.1:8791 SERPAPI_API_BASE=http://127.0.0.1:8791 BRIGHTDATA_API_BASE=http://127.0.0.1:8791 SERPAPI_JOBS_MAX_DORKS=0 COMPANY_REVIEW_FIXTURE="$PWD/tests/fixtures/bastida-careers.html" GROQ_API_BASE=http://127.0.0.1:8791 OPENAI_API_BASE=http://127.0.0.1:8791 RESEND_API_BASE=http://127.0.0.1:8791 \
  npx --no-install next start apps/web --hostname 127.0.0.1 --port "$PORT" > /tmp/admin-auth-next.log 2>&1 &
NEXT_PID=$!
trap 'kill $NEXT_PID 2>/dev/null || true' EXIT
for _ in $(seq 1 40); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 0.5; done
BASE="http://127.0.0.1:$PORT" node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/flow.mjs
# Motor en pausa por cuota (429 + texto plano, como responde la plataforma de verdad) o caído (500): la
# causa tiene que llegar en JSON al panel y a la alumna, sin ceros falsos ni mensajes que culpen a quien usa la app.
BASE="http://127.0.0.1:$PORT" node tests/admin-auth/enginepause.mjs
# Aviso del motor: un aviso por estado, al propietario y por correo solo si hay clave de Resend; sin
# historial (migración sin aplicar) se declara y no se envía nada en vez de repetirlo en cada comprobación.
BASE="http://127.0.0.1:$PORT" node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/enginealert.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/parity.mjs
node --experimental-strip-types tests/admin-auth/csv.mjs
node --experimental-strip-types tests/admin-auth/salary.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/score.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/aireview.mjs
# Guardián SSRF sin APIs de Node: allowlist medida, IP literales y redirecciones revalidadas salto a salto.
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/urlguard.mjs
# Cualificación automática: lo claro se aprueba y lo dudoso ACABA en la cola humana (no en borrador).
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/autoreview.mjs
# Auditoría del catálogo (SOLO LECTURA): lo ya aprobado que la regla retiraría, con su motivo y sin escribir nada.
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/ruleaudit.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/metrics.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/funnel.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/loginlimit.mjs
# Cifras por fuente: las cuenta la base (count=exact), sin traer la tabla ni cortarse en 5.000.
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/sources.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/agreement.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/hardening.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/ingest.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/tiers_b2b.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/application.mjs
# Candidaturas por páginas: PostgREST corta en 1.000 filas y el recuento salía corto sin decirlo.
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/applications-paging.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/matching.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/cronbudget.mjs
# InfoJobs oficial: paginar y filtrar (provincia, categoría, antigüedad, teletrabajo) y pedir ficha solo a lo que puntúa alto.
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/infojobs.mjs
# Adzuna y Jooble: campos de la documentación vigente y una respuesta cambiada se declara, no se lee como 0.
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/api-shapes.mjs
# Formación importable: plantilla CSV, validación estricta, dry-run y frase diaria determinista.
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/training-curriculum.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/training-quiz.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/training.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/activity.mjs
node --experimental-strip-types tests/admin-auth/voiceecho.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/dashboard.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/studentmetrics.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/retention.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/googlejobs.mjs
# Rutas por fuente: orden por coste, contrato de Bright Data, extractor y cascada sin gastar sin clave/tope.
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/source-routes.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/brightdata.mjs
# Tope mensual: todas las ejecuciones desde el día 1, paginadas; nunca las últimas 200.
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/spend-window.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/fallback.mjs
# Workana como portal de Apify: plantilla propia, sin país ISO roto y presupuesto que no es salario.
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/workana.mjs
# Panel: los conectores del motor se cruzan con el catálogo por portal (Himalayas no es «fuera del cloud»).
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/families.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/roleui.mjs
# Aviso en la tarjeta de la alumna: `caution` viaja de Supabase a la búsqueda, al modo degradado y a las
# recomendaciones sin que ninguna fusión lo recorte.
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/caution.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/surface.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/market.mjs
# El motor retira en bloque lo que descarta (no lo deja en la cola humana): prueba de conducta con D1 simulado.
# Arnés de auditoría del vocabulario (scripts/vocabulary-audit.mjs): solo lee y cuenta bien.
node --experimental-strip-types tests/engine/bucket.mjs
# Informe de rol: la elegibilidad se mide con la vista real (studentSurface); el AE no es «familia_extra».
node --experimental-strip-types tests/engine/role-audit.mjs
node --experimental-strip-types tests/engine/discards.mjs
node --experimental-strip-types tests/vocabulary-audit.mjs
# Asistente de la academia: índice íntegro, respuestas con fuentes reales y sin inventar fuera del método.
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/academy-assistant.mjs
# Recuperación medida con 60 preguntas reales de alumna: sección y lección esperadas, sin llamar al modelo.
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/academy-retrieval.mjs
# «¿Dónde se enseña esto?»: el mapa del Classroom (12 módulos, 130 lecciones, 64 temas) sin modelo ni red.
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/classroom-search.mjs
node --experimental-strip-types tests/engine/activate.mjs
# openradar: API pública sin clave con vacantes y encargos; campos del OpenAPI y sin inventar salario.
node --experimental-strip-types tests/engine/openradar.mjs
# Workable: bolsa pública del ATS con búsqueda global, país por país y sin clave (verificada 2026-11-20).
node --experimental-strip-types tests/engine/workable.mjs
# SmartRecruiters: búsqueda global sin clave + detalle público, con presupuesto de detalles declarado.
node --experimental-strip-types tests/engine/smartrecruiters.mjs
# Búsquedas de closer del motor: vocabulario en español, rotación por día y extractores con `q`.
node --experimental-strip-types tests/engine/terms.mjs
# Cuota de escritura de la plataforma (100.000 filas/mes): el motor se para antes de que la pausa deje el sitio sin servir.
node --experimental-strip-types tests/engine/writebudget.mjs
# Cuota configurable por entorno: el techo sube con el plan (variables), no con un despliegue de código.
node --experimental-strip-types tests/engine/quota-config.mjs
# Exportación para mover la base a otra cuenta: solo ADMIN_TOKEN, sin write_ledger y sin gastar cuota.
node --experimental-strip-types tests/engine/export.mjs
# Presupuesto de subrequests por plan: con el techo de pago caben las 16 fuentes en UNA pasada (antes, 9).
node --experimental-strip-types tests/engine/subrequests.mjs
# Catálogo del panel vs motor: ninguna entrada puede pedir configuración para un portal que el motor ya recoge.
node --experimental-strip-types tests/engine/catalog.mjs
# Forma de escritura del catálogo (índices incluidos): coste medido por candidato, índices de lectura intactos y migración reanudable.
node --experimental-strip-types tests/engine/writeshape.mjs
node --experimental-strip-types tests/engine/latam.mjs
# Filtros separados de la vista de alumna: modalidad (incluida presencial) y prospección declarada.
node --experimental-strip-types tests/engine/filters.mjs
node --experimental-strip-types tests/engine/location.mjs
node --experimental-strip-types tests/engine/roles.mjs
node --experimental-strip-types tests/engine/activationquota.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/offerrisk.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/offertags.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/voice.mjs
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/practice.mjs
# Criterios de las skills: pesos por fase, BANT con evidencia y una sola corrección prioritaria.
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/practice-rubrics.mjs
# Salón del éxito: las trece alumnas, cada vídeo con su id y ninguna tarjeta sin aprendizaje ni mensaje.
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/successstories.mjs
# Panel → persistencia local (SQLite temporal) → nota: el peso guardado manda en el feedback.
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/practice-persistence.mjs
# Formulario de cualificación: ocho preguntas, una respuesta de autoridad por pregunta y presentación revisada sin IA.
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/qualification.mjs
# Práctica de una candidatura: solo el anuncio y la parte profesional del formulario viajan al modelo.
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/practicecontext.mjs
# «Tu siguiente práctica»: elección determinista (eje flojo, categoría menos practicada, días sin practicar).
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/nextpractice.mjs
# Retos asignados: escenario, nota mínima, plazo y nota del coach; el estado sale de student_activity.
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/challenges.mjs
# Topes de la sala: la IP del limitador no puede salir de una cabecera que elija el cliente.
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/practicebudget.mjs
node tests/secrets.mjs
node tests/admin-auth/gate.mjs
node spikes/voice/tests/voice.mjs
BASE="http://127.0.0.1:$PORT" node tests/admin-auth/ui.mjs
# Interactivo: «Probar ruta» (Bright Data simulado) y «Revisar ahora» (fixture JSON-LD) de punta a punta.
BASE="http://127.0.0.1:$PORT" node tests/admin-auth/interactive.mjs
