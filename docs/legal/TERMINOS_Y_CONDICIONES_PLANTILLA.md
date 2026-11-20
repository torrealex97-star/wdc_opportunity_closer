# Términos y condiciones — plantilla completa para el portal de alumnas

**Estado: PLANTILLA para revisión legal. No es asesoramiento legal.** Redactada el 2026-11-20 a partir de lo que la aplicación hace hoy (código de `main`, commit `9508af9`). Cubre todas las superficies del portal de alumnas y de la coordinación. Debe revisarla un profesional (derecho de consumo, LSSI-CE, RGPD/LOPDGDD y, para las funciones de IA, el reglamento europeo de IA) antes de abrir el acceso a las alumnas.

El texto vivo que ya publica la app es [`/terminos`](../../apps/web/app/terminos/page.tsx) (`TERMS_VERSION = v1-borrador`, 12 cláusulas). Esta plantilla lo **sustituye y amplía**; no se ha cambiado la página ni la versión. Para publicarla: pasar el texto a esa página, subir `TERMS_VERSION` en `apps/web/lib/legal.ts` y volver a pedir aceptación (ver «Cómo se publica», al final).

## Cómo leer las marcas

| Marca | Significa |
| --- | --- |
| `[CAMPO]` | Dato que solo puede poner el responsable (razón social, CIF, dirección…). No se ha inventado ninguno. |
| ⚖ **DECISIÓN** | Punto que depende de una decisión del responsable o de una cuestión legal que debe resolver el asesor. La plantilla da una opción por defecto, no una respuesta. |
| ⚙ **APP** | Afirmación comprobada contra el código. Si la app cambia, hay que cambiar el texto (ver Anexo C). |

**Regla de oro de esta plantilla:** no afirma nada que la app no haga y no promete nada que no pueda cumplir (resultados, ingresos, empleo, certificaciones, precisión de la IA). Todo lo que la app **no** hace (envío automático, voz de servidor, guardar conversaciones) está dicho como «no».

---

# TÉRMINOS Y CONDICIONES DE USO DEL PORTAL DE ALUMNAS

**Versión** `[vX-fecha]` · **Fecha de entrada en vigor** `[AAAA-MM-DD]`

## 0. Datos del titular (art. 10 LSSI-CE)

| | |
| --- | --- |
| Titular | `[RAZÓN SOCIAL]` |
| NIF/CIF | `[NIF/CIF]` |
| Domicilio | `[DIRECCIÓN POSTAL COMPLETA]` |
| Correo de contacto | `[EMAIL DE CONTACTO]` |
| Correo para privacidad y derechos | `[EMAIL DE PRIVACIDAD]` |
| Datos registrales (si es sociedad) | `[REGISTRO MERCANTIL, TOMO, FOLIO, HOJA]` |
| Sitio | `https://app.womendigitalclosers.com` |

⚙ **APP:** hoy estos valores salen de las variables `LEGAL_ENTITY_NAME`, `LEGAL_ENTITY_TAX_ID`, `LEGAL_ENTITY_ADDRESS` y `LEGAL_PRIVACY_EMAIL` (`apps/web/lib/legal.ts`); mientras falten, la página muestra «[pendiente de completar]». Los datos registrales **no** tienen variable: añadirlos si el titular es una sociedad.

## 1. Objeto, definiciones y aceptación

1.1. Estos términos regulan el uso del portal de alumnas de Women Digital Closers (en adelante, «el portal»), un espacio de formación y apoyo a la búsqueda de trabajo en ventas.

1.2. **Definiciones.** «Tú»: la persona usuaria. «Nosotras» o «el titular»: la entidad indicada en el apartado 0. «Coordinación»: las personas que el titular autoriza a gestionar el programa y ver la actividad de las alumnas dentro del panel interno. «Oferta»: un anuncio de empleo publicado por un tercero. «Simulación»: una conversación de práctica con un interlocutor ficticio.

1.3. **Aceptación.** Al crear tu perfil marcas que has leído estos términos y la [política de privacidad](/privacidad); queda anotada la versión aceptada. Si usas partes del portal abiertas sin cuenta, estos términos te aplican igualmente desde que las usas.

1.4. Si no estás de acuerdo con ellos, no uses el portal.

⚙ **APP:** el consentimiento del perfil guarda fecha y versión (`CONSENT_VERSION`, `apps/web/lib/students.ts`). El acceso sin cuenta existe mientras `STUDENT_LOGIN_REQUIRED` no esté activado.

## 2. Tu cuenta

2.1. El acceso a tu espacio (perfil, candidaturas, progreso, retos) es **por invitación**, personal e intransferible.

2.2. Debes ser **mayor de edad**. ⚖ **DECISIÓN:** confirmar si se pide algún otro requisito de acceso (pertenecer al programa, estar matriculada, etc.).

2.3. Debes dar datos veraces y mantenerlos al día. Guarda tu contraseña en secreto y avísanos sin demora si crees que alguien más accede a tu cuenta.

2.4. Podemos **pausar** o retirar tu acceso si incumples estos términos o por razones de seguridad, y te lo comunicaremos indicando el motivo, salvo que la ley o la seguridad lo impidan. ⚖ **DECISIÓN:** plazo y canal de réplica ante una pausa.

2.5. Puedes pedir tu **baja** cuando quieras escribiendo a `[EMAIL DE PRIVACIDAD]`; se elimina tu cuenta y sus datos según la política de privacidad.

⚙ **APP:** la pausa existe (`students.status = paused`) y la baja la ejecuta el propietario y arrastra por cascada perfil, formulario, candidaturas, actividad, retos y consentimientos.

## 3. Qué es el portal y qué no es

3.1. **No garantizamos resultados.** Ni entrevistas, ni un trabajo, ni unos ingresos, ni un plazo. Lo que consigas depende de ti y de terceros.

3.2. **No somos parte de ningún proceso de selección** ni intermediamos por ti ante las empresas: tú te presentas y tú decides. ⚖ **DECISIÓN (cuestión legal):** reunir y recomendar ofertas de empleo puede interpretarse como actividad de intermediación laboral; el asesor debe confirmar si exige alguna autorización o registro (normativa de agencias de colocación) o si queda fuera por actuar solo como buscador de anuncios públicos.

3.3. **No ofrecemos asesoramiento** laboral, jurídico, fiscal ni financiero. Los contenidos son formativos y generales.

3.4. **La formación y el examen no son una certificación oficial ni un título.** Aprobar el examen indica que has superado un ejercicio de repaso, nada más.

3.5. No te prometemos que el portal esté libre de errores. Las ofertas, las notas y el feedback pueden contener inexactitudes.

## 4. Oportunidades de empleo

4.1. Las ofertas son **anuncios de terceros**. Las reunimos de fuentes públicas y de integraciones (por ejemplo portales de empleo, buscadores y servicios de recogida de datos públicos) y las filtramos con reglas automáticas. **No verificamos cada oferta una a una.**

4.2. Puede que la empresa haya cerrado el proceso, cambiado las condiciones o que el anuncio sea engañoso. **Confirma siempre en la web de la empresa antes de enviar datos personales o hacer cualquier pago.** No pidas ni hagas pagos para «acceder» a un puesto; si una oferta te lo pide, evítala y avísanos.

4.3. **Avisos de riesgo.** El portal puede marcar ofertas con señales de posible estafa o de condiciones poco claras (por ejemplo, solo comisión o promesas de libertad financiera). Es una ayuda automática: **que no haya aviso no significa que la oferta sea segura**, y que lo haya no significa que sea fraudulenta.

4.4. **No inventamos datos.** Si una oferta no indica salario, fecha o requisitos, el portal lo muestra como desconocido. Cualquier cifra que veas viene del anuncio original; no la garantizamos.

4.5. Las ofertas que nos propongan o que se aprueben para mostrarte lo son tras una revisión por reglas y, en su caso, de una persona. ⚖ **DECISIÓN:** si en el futuro se activa la clasificación o aprobación con IA, actualizar esta cláusula y la política de privacidad.

4.6. El portal enlaza a webs de terceros que se rigen por sus propias condiciones y políticas; no respondemos de ellas.

4.7. Si eres una empresa que ve su anuncio en el portal y quieres que lo retiremos, escríbenos a `[EMAIL DE CONTACTO]`.

⚙ **APP:** fuentes externas con revisión editorial (`editorial_status`), aprobación automática por reglas con tope diario, detector de ofertas peligrosas (`offerRisk`) y revisor de IA en modo `shadow` (no decide). Salario y fecha se muestran como desconocidos si faltan.

## 5. Formación y examen

5.1. La Formación consta de módulos de método (pre-llamada, venta lógica, anti-freezing, leads difíciles, calificación, cierres, descubrimiento, objeciones, preguntas de entrevista, las siete objeciones) y una ruta de cuatro semanas con un examen final. `[CONFIRMAR LISTA ACTUAL DE MÓDULOS ANTES DE PUBLICAR]`

5.2. Los ejercicios se corrigen con **reglas sobre tu texto o por clave**, sin inteligencia artificial, y el examen lo califica el servidor. Las notas del examen **no son una titulación**.

5.3. Los ejemplos de la formación llevan huecos entre corchetes: rellénalos con datos reales de tu oferta. **No uses cifras, resultados ni testimonios de ejemplo como si fueran reales.**

5.4. Los contenidos formativos son para tu aprendizaje personal (cláusula 13).

⚙ **APP:** correcciones en `trainingCheck.ts` y examen con nota calculada en servidor (`gradeExam`); el navegador no puede fijar la nota.

## 6. Sala de práctica e inteligencia artificial

6.1. La sala de práctica usa un **modelo de inteligencia artificial** para hacer de interlocutor ficticio y para darte feedback. **Estás interactuando con una máquina, no con una persona.** Las empresas y las personas de las simulaciones son ficticias.

6.2. **Limitaciones.** La IA puede equivocarse, ser demasiado dura o demasiado amable, o dar un feedback que no encaje con tu caso.

6.3. **Las notas son estimaciones docentes** (media de los ejes que evalúa el sistema), para ayudarte a mejorar. **No son una evaluación oficial, ni una opinión sobre tu valía profesional, ni una probabilidad de éxito.**

6.4. Además del feedback del modelo, el portal calcula **señales de estilo** con reglas automáticas, sin IA (por ejemplo, validar con «pero» o dar muletillas después del precio), siempre con la frase literal que las dispara. Se muestran mientras practicas y en el feedback final. Son observaciones posibles, no veredictos.

6.5. **Ninguna decisión sobre ti** (acceso, permanencia en el programa, oportunidades, certificados) se toma únicamente a partir de una nota o de una señal automática. ⚖ **DECISIÓN:** confirmar este compromiso con la Coordinación antes de publicarlo y, si no se puede cumplir, quitarlo.

6.6. **Qué no debes escribir.** No introduzcas datos personales de terceros ni información confidencial de tu empleo actual. **Lo que escribes o dices se envía a un proveedor de IA** para generar la respuesta y el feedback (ver política de privacidad).

6.7. **Qué guardamos.** Guardamos solo señales de uso (la práctica realizada, la nota y los criterios). **No guardamos en nuestra base el texto de tus conversaciones**; tu historial reciente queda en **tu propio navegador** y desaparece si borras los datos del sitio.

6.8. **Límites de uso.** Cada simulación tiene un número máximo de turnos y el servicio puede limitar el uso por persona y por día para controlar el coste. No intentes eludirlos (cláusula 14).

6.9. Transparencia de IA: el contenido generado por IA se identifica como tal en el portal. ⚖ **DECISIÓN (cuestión legal):** confirmar con el asesor las obligaciones de transparencia del reglamento europeo de IA que apliquen al servicio.

⚙ **APP:** proveedor de IA tras la interfaz `LLMProvider` (hoy Groq); `/api/practice` conserva solo señales y notas en `student_activity`; historial local en `wdc_practice_history` (máx. 8). ⚖ La política de privacidad exige acuerdo de tratamiento y retención cero con el proveedor **antes** de abrir la sala (punto 11 de `PRIVACIDAD_Y_CONSENTIMIENTOS.md`).

## 7. Voz

7.1. **Dictado del navegador (disponible hoy).** Si tu navegador lo permite, puedes dictar tus respuestas en la sala. La transcripción la hace **el servicio de voz de tu navegador** (en Chrome, el de Google), no nosotras: el audio no pasa por nuestros servidores. Lo reconocido se añade a un borrador que **tú decides enviar**. Si no quieres usarlo, escribe.

7.2. **Interrupción.** Mientras el interlocutor lee en voz alta, puedes interrumpirlo hablando o escribiendo. El sistema ignora lo que sea eco de su propia voz.

7.3. **Voz de servidor (no activa).** Una práctica por voz en la que el audio se procese en nuestros servidores o en un proveedor de voz **no está activada**. Antes de activarla pediremos un **consentimiento propio y revocable** y te informaremos del proveedor y de la retención.

7.4. No grabes ni compartas conversaciones de otras personas sin su permiso.

⚖ **DECISIÓN:** el dictado del navegador está **activo y envía audio al proveedor de voz de tu navegador**. El texto vivo `/terminos` dice «hoy esa función no está activa», lo cual solo es cierto de la voz de servidor. Decidir si basta esta cláusula o si se muestra un aviso en pantalla (punto 12 de la política de privacidad).

⚙ **APP:** `useVoiceInput` (API de reconocimiento del navegador, `es-ES`) activo; `apps/web/lib/voice.ts` y la tabla `student_voice_consent` para la voz de servidor, apagada por defecto (`VOICE_ROLEPLAY`).

## 8. Revisión de llamadas reales

8.1. Puedes pegar la **transcripción de una llamada real** tuya para recibir una estimación de cómo la ejecutaste frente a una rúbrica (fases de la llamada, cualificación y una corrección prioritaria).

8.2. **Responsabilidad sobre terceros.** Pega una transcripción **solo si todas las personas que intervienen en la llamada han consentido** que se grabe y se use con este fin, y **quita sus datos personales** (nombre, teléfono, correo, empresa). Respondes de tener ese permiso.

8.3. La transcripción **se envía a un proveedor de IA** para generar la estimación y **no se guarda** en tu historial ni se registra como actividad.

8.4. El análisis es una estimación automática, no una evaluación de tu persona ni de la llamada con valor oficial.

8.5. No pegues llamadas de tu empleador actual con información confidencial.

⚙ **APP:** `CallReview.tsx` (`mode: 'review'`, tope de 16.000 caracteres; «no se guarda la transcripción»).

## 9. Candidaturas asistidas

9.1. El portal te ayuda a **preparar** candidaturas: un tablero para seguirlas, un formulario base reutilizable y borradores de mensaje y de respuestas.

9.2. **Eres tú quien revisa, completa y envía** cada candidatura en la web de la empresa. **El portal no envía mensajes, formularios ni candidaturas por ti.** Respondes de que lo que envías es **veraz** y está bien redactado.

9.3. **Formulario base.** Es opcional. Puedes incluir datos de contacto y enlaces (por ejemplo, a tu CV en tu propio almacenamiento); **no guardamos tu CV ni tus vídeos, solo el enlace.** Puedes borrarlo en cualquier momento.

9.4. **Asistente de respuestas con IA.** Si lo usas, el portal puede enviar a un proveedor de IA las preguntas que pegues y un extracto limitado de tu experiencia, herramientas, idiomas y disponibilidad, **solo si marcas la casilla en esa consulta**. **Nunca se envían tu correo, teléfono, LinkedIn, CV, vídeo ni tu nombre.** El borrador es una propuesta: revísalo y no lo envíes sin comprobarlo.

9.5. **Seguimiento.** El estado de tus candidaturas lo marcas tú (enviada, respuesta, entrevista, oferta, descartada). El portal no consulta a las empresas.

9.6. No usaremos tus datos para enviar candidaturas automáticas sin tu autorización. ⚖ **DECISIÓN:** si en el futuro se ofrece el envío automático (ADR-012), exigir autorización escrita y específica y actualizar estos términos antes de activarlo.

⚙ **APP:** `StudentPipeline`, `ApplyAssistant`/`answer-assistant` (`buildEvidence` sin datos de contacto, casilla por consulta, 25 consultas/día), formulario base con consentimiento propio.

## 10. Progreso, retos y coordinación

10.1. **Qué registramos.** Cuando usas el portal registramos **señales de actividad**: entradas, módulos repasados, nota del examen, la práctica realizada con su nota y criterios, y el estado de los retos. **Nunca registramos el texto de tus conversaciones.** Conservamos estos registros `[180 días / PLAZO A CONFIRMAR]` y se borran si causas baja.

10.2. **Tu progreso** (nivel, experiencia, racha, logros, objetivos de la semana) se **calcula a partir de esa actividad**; no son contadores que puedas modificar. **No hay ranking público** entre alumnas y tu progreso no se compara con el de otras personas.

10.3. **Retos de la coordinación.** La Coordinación puede asignarte un reto: un escenario concreto de práctica, con una **nota mínima opcional**, una **fecha límite** y una **nota escrita** de ella. Que lo hayas cumplido o no **se deduce de tu actividad real** dentro del plazo; no puedes marcarlo tú ni la app lo marca por error. Un reto es una ayuda para practicar, no una sanción.

10.4. **Qué ve la Coordinación.** Las personas de la Coordinación ven, en su panel, tu correo, el estado de tu cuenta, la fecha de tu última entrada, el número y la nota media de tus prácticas, los módulos repasados, tu nota del examen, el estado de tus retos y, de forma agregada, cuántas candidaturas has enviado y cuántas han tenido respuesta. **No ven el texto de tus conversaciones de práctica ni el contenido de tus candidaturas.** Lo usan para acompañarte y organizar el programa.

10.5. Un nivel, una nota o un reto no cumplido **no significan** una valoración sobre ti, y no se usan para decidir sobre tu acceso sin revisión de una persona (cláusula 6.5).

⚖ **DECISIÓN:** base jurídica y transparencia de la visibilidad por la Coordinación (la política de privacidad debe recogerla). Confirmar el plazo de conservación de la actividad; la app declara 180 días con limpieza manual del operador.

⚙ **APP:** `student_activity` (solo servidor, RLS sin políticas), `student_challenges` (`scenario_id`, `min_score`, `due_on`, `coach_note`), progreso derivado en `studentMetrics.ts`, vista de coordinación en `/api/admin/students`.

## 11. Comunicaciones

11.1. Te enviaremos **correos de servicio** necesarios para el uso del portal: la invitación, la recuperación de contraseña y avisos de seguridad.

11.2. **No te enviaremos comunicaciones comerciales** ni promocionales sin tu consentimiento previo y expreso, que podrás retirar cuando quieras. ⚖ **DECISIÓN (LSSI-CE, art. 21):** si se prevén avisos por correo o mensajería (por ejemplo, recordatorios de retos o de inactividad), decidir si son «de servicio» o requieren consentimiento, y reflejarlo aquí y en la política.

11.3. Hoy el portal **no envía WhatsApp ni SMS** a las alumnas. ⚙ **APP:** correo de aviso de motor solo para el propietario (Resend); los recordatorios a alumnas existen solo como cálculo en pantalla.

## 12. Datos personales

12.1. Tratamos tus datos conforme a la **[política de privacidad](/privacidad)**, que forma parte de estos términos.

12.2. Para prestarte el servicio nos apoyamos en proveedores (encargados del tratamiento): alojamiento y ejecución de la aplicación, base de datos y autenticación, envío de correo y un proveedor de inteligencia artificial. `[LISTA FINAL DE PROVEEDORES Y PAÍSES: confirmar con la política de privacidad]`

12.3. Puedes ejercer tus derechos de acceso, rectificación, supresión, oposición, limitación y portabilidad escribiendo a `[EMAIL DE PRIVACIDAD]`, y reclamar ante la Agencia Española de Protección de Datos.

⚖ **DECISIÓN:** acuerdos de tratamiento (DPA) con cada proveedor, transferencias internacionales y registro de actividades. Ver los puntos 1–9 de `PRIVACIDAD_Y_CONSENTIMIENTOS.md`.

## 13. Propiedad intelectual

13.1. Los contenidos formativos, la metodología, los textos, el diseño y el código del portal son de `[RAZÓN SOCIAL]` o de quien nos los licencia.

13.2. Te concedemos una licencia **personal, no exclusiva, intransferible y revocable** para usarlos en tu aprendizaje mientras tengas acceso.

13.3. **Tus textos** (respuestas, borradores, mensajes) siguen siendo tuyos. Nos permites tratarlos **solo para prestarte el servicio** descrito en estos términos y en la política de privacidad.

13.4. Las marcas y logotipos que aparezcan son de sus titulares.

13.5. No puedes copiar, extraer, redistribuir ni vender el contenido formativo fuera del portal.

## 14. Normas de uso

Te comprometes a **no**:

- usar el portal con datos falsos, suplantar a otra persona o usar la cuenta de otra;
- intentar acceder a datos, cuentas o sistemas que no son tuyos;
- saturar el servicio, **automatizarlo** (scrapers, bots) o eludir sus límites de uso, cuotas o controles;
- pegar en la sala o en la revisión de llamadas datos personales de terceros, información confidencial ajena o contenido ilícito;
- usar el feedback o los contenidos para engañar a empresas o a candidatas (por ejemplo, inventar resultados o experiencia en tus candidaturas);
- manipular o intentar manipular las instrucciones de la IA («jailbreak») o los resultados de las notas.

El incumplimiento puede llevar a la pausa de tu acceso (cláusula 2.4).

## 15. Disponibilidad y servicios de terceros

15.1. Procuramos que el portal funcione de forma continua, pero puede haber **interrupciones, mantenimientos o cambios**, y **no garantizamos** una disponibilidad ininterrumpida.

15.2. El portal depende de servicios de terceros (alojamiento, base de datos, inteligencia artificial, buscadores y portales de empleo, tu navegador). Si uno falla, **no te mostraremos como cierto lo que no hemos podido comprobar**: lo diremos (por ejemplo, con «—» en vez de un cero).

15.3. Podemos añadir, cambiar o retirar funciones. Si el cambio es relevante, te lo comunicaremos (cláusula 19).

## 16. Responsabilidad

16.1. Respondemos en los términos que permite la ley. **Nada de lo aquí dicho limita** los derechos que la normativa reconoce a las personas consumidoras ni excluye la responsabilidad que no pueda excluirse (dolo, negligencia grave, daños personales).

16.2. En lo que la ley permita, no respondemos de: decisiones que tomes basándote en ofertas, notas, feedback o contenidos del portal; contenido y comportamiento de empresas y webs de terceros; ni de la falta de resultados laborales.

⚖ **DECISIÓN:** límites y exclusiones de responsabilidad exactos y su validez frente a consumidoras (cláusulas abusivas). Esta cláusula **debe** redactarla el asesor.

## 17. Precio y régimen económico

⚖ **DECISIÓN (obligatoria antes de publicar):** el portal puede ser **(A) gratuito como parte del programa de formación** o **(B) de pago / incluido en un precio**. Elegir una:

- **(A) Gratuito.** *«El acceso al portal está incluido en tu programa de Women Digital Closers y no tiene coste adicional. Podemos dejar de ofrecerlo con el aviso razonable que corresponda.»*
- **(B) De pago.** Indicar precio con impuestos, forma y periodicidad de pago, renovación y **derecho de desistimiento** (art. 102 y siguientes del texto refundido de la Ley de Consumidores: para contenido digital, el desistimiento se pierde si has consentido expresamente el inicio y has sido informada de ello). Añadir el procedimiento y el formulario de desistimiento.

⚙ **APP:** hoy el portal **no cobra** ni procesa pagos; no incluye pasarela ni facturación.

## 18. Duración, suspensión y terminación

18.1. Estos términos rigen mientras tengas acceso al portal.

18.2. Podemos suspender o terminar tu acceso por incumplimiento grave, por seguridad, por cese del servicio o por fin del programa, según la cláusula 2.4.

18.3. Tú puedes darte de baja cuando quieras (cláusula 2.5).

18.4. Al terminar, se aplican los plazos de la política de privacidad. Las cláusulas que por su naturaleza deban sobrevivir (propiedad intelectual, responsabilidad, ley aplicable) siguen vigentes.

## 19. Cambios en los términos

19.1. Podemos modificar estos términos. Si el cambio es **relevante**, te lo comunicaremos con antelación razonable `[PLAZO, p. ej. 15 días]` y, cuando haga falta, te pediremos que **lo aceptes de nuevo**; si no estás de acuerdo, podrás darte de baja.

19.2. La versión vigente y su fecha figuran en la página de términos.

⚙ **APP:** versionado con `TERMS_VERSION`/`TERMS_DATE`; el re-consentimiento por cambio de versión **no está implementado hoy** (punto 9 de `PRIVACIDAD_Y_CONSENTIMIENTOS.md`).

## 20. Atención, reclamaciones y resolución de conflictos

20.1. Para consultas, quejas o reclamaciones, escríbenos a `[EMAIL DE CONTACTO]`; responderemos en `[PLAZO, p. ej. 30 días]`.

20.2. `[HOJAS DE RECLAMACIONES: indicar si aplican en la comunidad autónoma del titular]` ⚖ **DECISIÓN.**

20.3. Podrás acudir a los mecanismos de resolución alternativa de litigios de consumo que correspondan. `[ENTIDAD/ENLACE, si el titular se adhiere a alguna]` ⚖ **DECISIÓN.**

## 21. Ley aplicable y jurisdicción

21.1. Estos términos se rigen por la **ley española**.

21.2. Si eres consumidora, la jurisdicción será la de **tu domicilio**, sin perjuicio de los derechos que te reconozca la ley. `[Para usuarias no consumidoras: tribunales de ______ ]` ⚖ **DECISIÓN.**

## 22. Disposiciones generales

22.1. Si alguna cláusula resulta nula o inaplicable, las demás siguen vigentes.

22.2. Estos términos, junto con la política de privacidad y, si la hay, la información específica de cada función, son el acuerdo completo entre tú y el titular sobre el uso del portal.

22.3. Estos términos se redactan en español; si se traducen, prevalece la versión en español.

---

# ANEXO A — Condiciones para la Coordinación (uso interno del panel)

*Este anexo no se publica a las alumnas: se entrega a quien use el panel interno (coordinadoras, operadores, propietario).*

1. **Finalidad.** El panel se usa solo para gestionar el programa y acompañar a las alumnas: invitar, pausar, ver su actividad y asignar retos. No para fines personales, comerciales o de terceros.
2. **Confidencialidad.** Los datos de alumnas (correo, actividad, notas, estado de candidaturas) son confidenciales. No se copian, exportan ni comparten fuera del programa sin base legal.
3. **Lo que ves y lo que no.** Ves actividad y notas, no el texto de las conversaciones de práctica. **No intentes obtenerlo** ni reconstruirlo por otros medios.
4. **Decisiones sobre alumnas.** Una nota, una señal o un reto no cumplido **no justifican por sí solos** pausar o retirar el acceso: debe intervenir una persona y quedar el motivo anotado (cláusula 6.5).
5. **Retos.** La nota escrita de un reto la lee la alumna: redáctala con respeto y con foco en la mejora.
6. **Seguridad.** Cuenta personal, contraseña propia, sin compartirla. Avisa de cualquier acceso indebido.
7. **Baja.** Dar de baja a una alumna es irreversible: solo la hace el propietario y siguiendo su petición.
8. **Revisión.** El titular puede auditar los accesos al panel.

⚖ **DECISIÓN:** convertir este anexo en un compromiso de confidencialidad firmado y, si hay encargadas externas, en un contrato de encargo de tratamiento.

---

# ANEXO B — Decisiones que debe cerrar el titular / su asesor

| # | Decisión | Dónde afecta | Estado |
| --- | --- | --- | --- |
| 1 | Datos del titular (razón social, CIF, domicilio, correos, registro) | 0 | pendiente |
| 2 | ¿Gratuito o de pago? (y desistimiento si es de pago) | 17 | pendiente |
| 3 | ¿Reunir y recomendar ofertas exige autorización o registro como agencia de colocación? | 3.2, 4 | pendiente (cuestión legal) |
| 4 | Límites de responsabilidad y validez frente a consumidoras | 16 | pendiente (cuestión legal) |
| 5 | Ley aplicable, jurisdicción, hojas de reclamaciones y resolución alternativa | 20, 21 | pendiente |
| 6 | Dictado del navegador: aviso suficiente o aviso en pantalla | 7 | pendiente |
| 7 | Acuerdo de tratamiento y retención cero con el proveedor de IA **antes** de abrir la sala | 6, 8, 9 | pendiente (bloquea abrir la sala) |
| 8 | Transparencia de IA según el reglamento europeo | 6.9 | pendiente (cuestión legal) |
| 9 | Visibilidad por la Coordinación: base jurídica y plazo de conservación (180 días) | 10 | pendiente |
| 10 | Compromiso «ninguna decisión solo por nota o señal automática» | 6.5, 10.5, Anexo A | pendiente (operativo) |
| 11 | Comunicaciones: ¿recordatorios por correo son «de servicio» o comerciales? | 11 | pendiente |
| 12 | Plazo de preaviso de cambios y re-consentimiento por versión (no implementado) | 19 | pendiente (también técnico) |
| 13 | Lista final de proveedores y transferencias internacionales | 12 | pendiente |
| 14 | Edad mínima/requisitos de acceso | 2.2 | pendiente |

# ANEXO C — Mapa: qué función de la app respalda cada cláusula (y qué obliga a cambiar el texto)

| Cláusula | Qué hace la app hoy (⚙) | Si cambia esto, cambia el texto |
| --- | --- | --- |
| 1–2 Cuenta | Invitación, login (Supabase Auth), pausa y baja; acceso sin cuenta mientras `STUDENT_LOGIN_REQUIRED` esté apagado | Activar `STUDENT_LOGIN_REQUIRED`; nueva forma de alta |
| 4 Oportunidades | Fuentes externas, reglas, detector de riesgo, revisor IA en `shadow` | Pasar el revisor IA a `live`; nuevas fuentes de pago |
| 5 Formación | 10 entradas (9 módulos de método y la ruta de cuatro semanas con el examen), con la nota del examen en servidor | Importar currículo (migración `training_curriculum`, ya aplicada); certificados |
| 6 Práctica/IA | Proveedor tras `LLMProvider` (Groq); señales sin IA; sin guardar texto | Cambiar de proveedor; guardar conversaciones; notas con consecuencias |
| 7 Voz | Dictado del navegador activo; voz de servidor apagada | Activar `VOICE_ROLEPLAY`; Pipecat/LiveKit u otro proveedor de voz |
| 8 Llamadas reales | Pegar transcripción, sin guardar | Ingestar llamadas (Fathom/Plaud) |
| 9 Candidaturas | Tablero, formulario base, asistente IA con casilla | Envío automático (ADR-012) |
| 10 Progreso/retos | `student_activity`, `student_challenges`, panel de coordinación | Ranking; recordatorios por correo; nuevos datos visibles a la Coordinación |
| 11 Comunicaciones | Correos de servicio por Resend | Recordatorios o marketing |
| 17 Precio | No hay cobros | Cualquier cobro |

# ANEXO D — Qué falta hoy en el texto vivo `/terminos` (v1-borrador)

Comparado con esta plantilla, la página publicada **no dice** (o dice mal):

1. **Dictado del navegador:** afirma «hoy esa función no está activa» (cláusula 5), y el dictado sí lo está. → cláusula 7.
2. **Revisión de llamadas reales** (permiso de terceros, datos a un proveedor de IA): no aparece. → cláusula 8.
3. **Coordinación:** no dice que las coordinadoras ven actividad y notas, ni los retos. → cláusula 10.
4. **Señales de estilo en vivo** y que las notas son estimaciones docentes con media de ejes: solo dice «estimaciones» en general. → cláusula 6.
5. **Asistente de respuestas con IA** y su límite de datos: no aparece. → cláusula 9.4.
6. **Precio, desistimiento, comunicaciones, preaviso de cambios y propiedad de tus textos:** precio y comunicaciones no aparecen; los cambios solo se mencionan de pasada. → cláusulas 11, 17 y 19.
7. **Retos y progreso derivado** sin ranking: no aparece. → cláusula 10.
8. **Datos del titular** sin datos registrales. → apartado 0.

# Cómo se publica

1. El asesor revisa la plantilla y resuelve las decisiones de los Anexos B y A.
2. Completar `LEGAL_ENTITY_*` en el entorno (y añadir datos registrales si hace falta).
3. Pasar el texto final a `apps/web/app/terminos/page.tsx` y subir `TERMS_VERSION`/`TERMS_DATE` en `apps/web/lib/legal.ts` **en la misma PR**; anotarlo en `docs/STATUS.md`.
4. Actualizar `/privacidad` (`POLICY_VERSION`) con los puntos que esta plantilla da por supuestos (visibilidad de la Coordinación, dictado del navegador, revisión de llamadas, asistente de respuestas, plazo de 180 días).
5. Cuando se implemente el re-consentimiento por versión (hoy no existe), pedir aceptación a las alumnas con la versión anterior. Hasta entonces, hacerlo a mano en el alta.

*Nota final: esta plantilla se ha redactado a partir del código y de los documentos del repositorio. No sustituye al criterio de un abogado ni cita jurisprudencia. Las referencias normativas indicadas (LSSI-CE, texto refundido de la Ley de Consumidores, RGPD/LOPDGDD, normativa de agencias de colocación y reglamento europeo de IA) son puntos para que el asesor los confirme, no conclusiones.*
