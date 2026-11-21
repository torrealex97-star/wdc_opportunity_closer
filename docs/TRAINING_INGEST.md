# Formación importable, tests y gamificación

Esta pieza añade a **Formación** una ruta curricular que el equipo puede mantener en Excel/CSV, un hub
de recursos y tests con feedback inmediato. Reutiliza lo que ya existía: los diez módulos de método
siguen debajo, `student_activity` sigue siendo la señal que da XP, rachas y logros, y las candidaturas
siguen viviendo en `student_applications`.

## Modelo de datos

La migración es [20261120_training_curriculum.sql](../supabase/migrations/20261120_training_curriculum.sql) y
**está aplicada** en el Supabase real (`closer-ia-ops`, 2026-11-20) como `training_curriculum`, con el
currículo cargado (4 módulos, 12 lecciones, 14 recursos, 24 preguntas). La app sirve la base y lo declara
(`source: "db"`); solo si la base está vacía, falta la migración o el contenido no valida cae al currículo
versionado en [trainingCurriculum.ts](../apps/web/lib/trainingCurriculum.ts) con el motivo.

| Tabla | Para qué |
| --- | --- |
| `training_modules` | Módulo: `position`, título, descripción, objetivos y `deep_dive` (id de un módulo de método). |
| `training_lessons` | Lección: módulo, `position`, resumen, minutos, contenido y puntos clave. |
| `training_resources` | Recurso de una lección: `template`, `script`, `checklist`, `link`, `doc` o `video`; URL y/o contenido copiable. |
| `training_questions` | Pregunta de test: `multiple`, `true_false` o `case`; opciones, índice correcto y explicación didáctica. |
| `user_lesson_progress` | Progreso por lección y nota del test, para el pipeline hospedado. |
| `user_quiz_attempts` | Intentos con respuestas y resultado; la nota la calcula el servidor. |
| `user_gamification_state` | Semilla de la frase, último día leído y frases guardadas. |

`job_applications` del brief se cubre con la tabla existente **`student_applications`**: no se duplica.
Las tablas nuevas son solo de servidor (RLS activado sin políticas y sin grants a `anon`/`authenticated`);
el importador usa la clave de servicio y nunca se ejecuta en el navegador.

## Formato de la plantilla

La plantilla viva está en [docs/templates/training](templates/training). Son **cuatro CSV** (o un `.xlsx`
con cuatro hojas con esos mismos nombres): `modules`, `lessons`, `resources`, `questions`. La primera fila
son cabeceras exactas; sobran columnas o faltan columnas → error, no importación parcial.

### modules

`id,position,title,description,objectives,deep_dive`

- `objectives`: lista separada por `|`. Entre 1 y 8.
- `deep_dive`: opcional; debe ser un id de módulo de método (`precall`, `logica`, `cierres`, …) o vacío.

### lessons

`id,module_id,position,title,summary,minutes,content,key_points`

- `module_id` debe existir en `modules`.
- `key_points`: lista separada por `|`. Entre 1 y 6.
- `minutes`: entero entre 1 y 120.

### resources

`id,lesson_id,type,title,description,url,content`

- `type`: `template | script | checklist | link | doc | video`.
- `link` y `video` exigen `url`; el resto puede llevar `content` copiable.
- Al menos uno de `url` o `content` debe estar presente.

### questions

`id,lesson_id,position,type,prompt,options,correct,explanation`

- `type`: `multiple | true_false | case`.
- `options`: lista separada por `|`, entre 2 y 6.
- `correct`: **el texto exacto** de una de las opciones. El importador lo convierte a índice.
- `explanation`: por qué la respuesta es correcta (o qué principio se pasa por alto). Obligatoria.

Las comas y las comillas dentro de una celda se escriben entre comillas dobles, como en cualquier CSV
(RFC 4180); la plantilla generada ya lo hace.

## Importar

```bash
# 1) Validar sin escribir nada (dry-run). Es el paso obligatorio antes de tocar la base.
npm run training:import -- --input docs/templates/training --version 2026-11-20

# 2) Exportar el JSON validado para revisarlo o versionarlo.
npm run training:import -- --input docs/templates/training --out .local/curriculum.json

# 3) Upsert en Supabase (requiere SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY; la migración debe estar aplicada).
npm run training:import -- --input curriculum.xlsx --supabase

# 4) Regenerar la plantilla desde el currículo del repo.
npm run training:template
```

Reglas de seguridad del importador ([training-import.mjs](../scripts/training-import.mjs)):

1. Lee las cuatro hojas y comprueba cabeceras antes de construir nada.
2. Valida referencias (`module_id`, `lesson_id`), tipos, rangos, opciones y respuesta correcta.
3. Pasa el conjunto por `validateCurriculum` (el mismo validador que usa la app).
4. Solo si **todo** es válido escribe: JSON con `rename` atómico o `POST …?on_conflict=id` por tabla.
5. Es idempotente por `id`: reimportar actualiza; no duplica. **No poda** filas ausentes del Excel;
   borrar es una operación destructiva y exige una orden aparte.
6. Una fila mala devuelve todos los errores con hoja e índice y no deja datos a medias.

## Cómo se sirve y qué ve la alumna

- `GET /api/training` ([route.ts](../apps/web/app/api/training/route.ts)) devuelve `{ curriculum, source }`.
  Si Supabase no está configurado, faltan tablas o el JSON guardado no valida, cae al currículo del repo
  con `source: 'defaults'` y un motivo; nunca sirve una ruta a medias.
- TrainingCurriculum.tsx: acordeón por módulo, porcentaje
  real, lección con contenido, puntos clave, recursos, test, reintento de falladas y marca de completada.
- El **hub de recursos** consolida todos los recursos y filtra por módulo y tipo; cada recurso se puede
  abrir o copiar sin salir de Formación.
- El **progreso local** (`wdc_training_lessons`, `wdc_training_quizzes`) guarda lecciones y resultado del
  test en este navegador. Al superar una lección se envía `training_review` con `detail.lesson`; el
  servidor valida el slug y lo usa para `training.lessons` en «Mi progreso». La nota del test **no** se
  envía desde el navegador: las tablas de intentos quedan preparadas para calcularla en servidor.
- Los estados de carga, error de red y «sin recursos con esos filtros» están en la vista; la ruta del repo
  se ve aunque la API falle.

## Gamificación

- **Frase diaria** ([dailyQuote.ts](../apps/web/lib/dailyQuote.ts)): 16 frases de mentalidad, prospección,
  rechazo y constancia. El índice es determinista por **cuenta** y día de Madrid, con paso 5 coprimo con 16:
  la misma alumna ve la misma frase durante el día en cualquier navegador y no repite la de ayer. La semilla
  la deriva el servidor de la cuenta (`quoteSeed` de `/api/student/session`, opaca: no expone el
  identificador) y sin sesión se usa una fija. Se puede guardar y marcar como leída; ambas cosas siguen
  viviendo en el navegador (`wdc_quote_saved`, `wdc_quote_read`).
- **Confeti al aplicar** ([Celebration.tsx](../apps/web/components/Celebration.tsx),
  [StudentPipeline.tsx](../apps/web/components/StudentPipeline.tsx)): se dispara al **registrar** una
  candidatura enviada, no al abrir el anuncio. Muestra total enviado, enviadas esta semana y el próximo
  hito (1, 5, 10, 25), con CTAs a otra oferta o a un test. El confeti es decorativo, no captura clics y
  `prefers-reduced-motion` lo oculta; la tarjeta se cierra sola a los 9 s o con su botón.
- **Bucle Practicar ↔ Preparar ↔ Aplicar**: la ruta enlaza cada módulo con su módulo de método, cada
  lección con recursos copiables y la sala de práctica; el tablero de candidaturas celebra el paso a
  «enviada». La racha sale de `student_activity` (no se inventa un cero si no hay sesión) y se muestra en
  la ruta y en «Mi progreso».

## Límites conocidos

- La migración **está aplicada** y el currículo cargado, pero el progreso por lección sigue en el navegador
  + señal `training_review` en `student_activity`: nada escribe todavía en `user_lesson_progress`,
  `user_quiz_attempts` ni `user_gamification_state` (las tablas están listas, sin políticas).
- La versión que se sirve desde la base es la fecha del `updated_at` más reciente de las cuatro tablas, no
  una etiqueta fija: reimportar cambia la versión que declara `GET /api/training`.
- El importador no renombra ids ni borra filas retiradas; un cambio de id se ve como entidad nueva.
- `read-excel-file` es dependencia de desarrollo: el importador se ejecuta en local/CI, no en el Worker.

## Verificación

```bash
node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/training-curriculum.mjs
npx playwright test tests/browser/training-curriculum.spec.ts tests/browser/pipeline.spec.ts
npm run typecheck && npm run build
```

La prueba de Node cubre el currículo por defecto, la rotación de la frase, el ida y vuelta CSV, la
cabecera ausente, las referencias rotas, la respuesta correcta inválida, el dry-run y la exportación. La
prueba de navegador recorre lección → test fallado → reintento → test superado → progreso → filtros y
comprueba el confeti y el cierre de la celebración en el pipeline.
