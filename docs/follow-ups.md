# Follow-ups acumulados — NIDO

Backlog vivo de deudas técnicas, hardening y decisiones diferidas que **no** bloquean la fase en curso pero deben atenderse en su momento. Cada entrada indica origen (PR/sprint) y condición de disparo.

> Consolidado por primera vez en el **sprint pre-F6** (2026-05-31, PR #42) recogiendo lo apuntado durante F5.6, F5B y el propio sprint. Actualiza esta lista al cerrar cada follow-up (mover a "Resueltos" o borrar) y al abrir nuevos.

> **Olas (modelo nuevo):** 1️⃣ producto web completo · 2️⃣ app nativa · 3️⃣ mejoras/diferenciación. Plan **scope-driven**, sin deadline externo. Cada entrada se etiqueta con la ola a la que pertenece.

## Registro de operaciones de mantenimiento

- 2026-06-20 · Purga de datos de test (operación de mantenimiento, sin migración): 6.830 usuarios fixture `rls-%` + árbol (174 centros, 235 niños…) + 18.541 filas de `audit_log` de fixtures, borrado SCOPED en orden FK; + tutor8 (usuario `be863720` + niño `4f930fd3`) por IDs. Scope estricto: datos/audit de usuarios reales de ANAIA intactos (verificado: 13 usuarios, 5 niños, 4 fotos, 250 audit, 0 huérfanos).

## Bloqueantes pre-piloto — Ola 1

- [ ] **UI de alta de profesor + invitación al centro** (admin de usuarios). Hoy el admin del centro depende del **SQL Editor** para dar de alta personal. Sin esta UI el piloto no es autónomo. PR aparte post-sprint. _(Ola 1)_
- [ ] **Confirmar traducciones VA con usuario nativo.** Quedan TODOs de valenciano en el código de los PRs **#35, #36, #40** (strings marcados en componente, no en JSON). Revisar con hablante nativo antes del piloto. _(Ola 1)_

## Hardening — post 1 sprint en producción (Ola 1)

- [ ] **Drop de `es_profe_principal` en `profes_aulas`** (deprecated desde PR #34, reemplazado por ENUM `tipo_personal_aula`). ~10 min de SQL una vez confirmado que nada lo lee en producción tras un sprint.
- [ ] **Reactivar los 6 tests `skip` de `profes-aulas.rls.test.ts`** (gate `F5B34_MIGRATION_APPLIED`). La migración ya está aplicada en remoto → el gate puede pasar a `1` por defecto / eliminarse.

## Hardening de datos / auditoría — Ola 1 (parte del paquete RGPD bloqueante)

- [ ] **Trigger `audit_log` para `profes_aulas`** + sweep de otras tablas sin auditar. Es una decisión RGPD: revisar qué tablas con datos sensibles aún no tienen trigger de audit y decidir cobertura. _(Ola 1 — RGPD)_
- [ ] **Cleanup de tests RLS que dejan residuos en la BD remota.** Hay centros basura acumulados en remoto (p.ej. `Centro Menus A` ×4, `Centro Profes A/B`…). Investigar qué suite no limpia tras de sí y añadir teardown. _(Ola 1)_

## Reactivos / condicionales (solo cuando se cumpla la condición)

- [ ] **Columna "Apoyos" en `/admin/aulas`** — añadir cuando aparezca el primer `apoyo` real en ANAIA (omitida hoy por YAGNI, ver ADR-0033). _(Ola 1)_
- [ ] **Telemetría de `getTutoresParaAdminDireccion`** — solo si hay reporte de lentitud o un centro supera ~100 tutores. _(Ola 1)_
- [ ] **Refinar `autorizado` vs `tutor_legal` en la sidebar** — hoy comparten la lista de items de familia. Decisión de producto, a resolver pre-piloto (detectado en auditoría del item 6 del sprint pre-F6). _(Ola 1)_

## Post-F6 — Ola 1

- [ ] **Seeds E2E:** _(Ola 1)_
  - `seed-mensajes.ts` — ≥50 mensajes para el test de scroll tipo WhatsApp (PR #31).
  - `seed-aulas-multitutor.ts` — para los tests de pickers (PRs #31, #32, #33).
- [ ] **Investigar el patrón `Select` de base-ui en jsdom** — exploración técnica (el componente no renderiza igual bajo jsdom; varios tests lo esquivan). _(Ola 1)_

## F11 — pulido final (Ola 1)

- [ ] **Salud de CI — la suite RLS está roja en `main`.** La BD efímera que levanta la CI **no recibe las migraciones** que en este proyecto se aplican **a mano por el SQL Editor** (el CLI de Supabase peta con SIGILL en el equipo, ver `db:types`/migraciones). Como la CI corre los tests RLS contra esa BD desfasada, **fallan tests RLS no gateados** que dependen de policies/esquema recientes (p. ej. `src/test/rls/enviar-mensaje-admin-familia.test.ts > regresión profe_familia … crea conv lazy + inserta`, `AssertionError: expected false to be true`). Consecuencia: la CI viene en **rojo estable** en `main` y los PRs (#91, #92, #93, #94…) se han venido **mergeando con la CI roja**, lo que anula su valor como red de seguridad. **A arreglar antes del piloto**, dos vías posibles: **(a)** aplicar las migraciones a la BD de CI (resolver el SIGILL del CLI, o un paso de CI que ejecute el SQL pendiente / `supabase db push`), o **(b)** **gatear/saltar** esos tests RLS en CI de forma **consistente** (un flag tipo `*_MIGRATION_APPLIED`, como ya se hace con otros RLS) para que el verde de CI vuelva a ser señal fiable. Detectado al resolver el conflicto de #94 (2 reruns → mismo fallo; confirmado idéntico en el run de #93 en `main`). _(Ola 1, F11 — bloqueante pre-piloto)_
- [ ] **Recalibrar `h-[calc(100dvh-3rem)]`** en `ConversacionView` y `ConversacionAdminFamiliaView` — detectado ~1rem de infra-descuento. _(Ola 1)_
- [ ] **Implementación de ADR-0028** — `theme_color` provisional del manifest PWA, Service Worker versionado. _(Ola 1, F11)_
- [ ] **Derecho al olvido funcional** — redactar/anonimizar `valores_antes` en `audit_log` al ejercer borrado. _(Ola 1 — RGPD bloqueante, antes del primer dato real)_
- [ ] **Limpieza de stubs `auth.users` huérfanos (junto al predicado A6 de esqueletos huérfanos).** `sendInvitation` envía el correo con `inviteUserByEmail`, que **pre-crea un stub** en `auth.users` (sin roles) por cada invitación. Si la invitación expira sin aceptarse, el stub queda huérfano. El predicado de auto-limpieza de esqueletos huérfanos de **F11-A6** debe borrar **también** ese stub auth (usuario sin `roles_usuario` + única invitación expirada/no aceptada). Implementación con ese predicado, no en el fix de invitación. Ver `docs/specs/alta-tutor-driven.md` (decisión menor d). _(Ola 1)_
- [ ] **`process-logos.mjs` multi-fuente** — soportar varias fuentes de logo. _(Ola 1)_
- [ ] **HEIC en subida de fotos (F10-1)** — hoy el HEIC se **rechaza** con mensaje claro ("Convierte la foto a JPG o PNG antes de subirla"); JPG/PNG funcionan. Como iPhone fotografía en HEIC por defecto (el dispositivo real de las profes), conviene recuperar el soporte. Origen: F10-1 (PR #81), tras descartar 3 vías (decode en cliente con `heic-to`/`heic2any` → Web Worker `blob:` que **cuelga en silencio** en el navegador, reproducido en headless con HEIC real; decode en servidor con `heic-decode` → Turbopack **no embarca `libheif.wasm`** en la función, ni vía `outputFileTracingIncludes` —lo ignora— ni vía `require.resolve` —rompe el build—). **DOS candidatos a evaluar al retomar (no uno):**
  1. **Decode server-side con build Webpack en vez de Turbopack (Opción B).** Webpack + `outputFileTracingIncludes` **sí** embarca el `.wasm` (Turbopack no). Coste: cambia el pipeline de build de **toda la app** → más alcance/riesgo. Restaurar `heic-decode`/`libheif-js`, `serverExternalPackages`, `maxDuration=60` y el pipeline `heic-decode→sharp` (todo ya existió en ramas previas de #81).
  2. **[NO EXPLORADA, posiblemente más limpia] Decode en el cliente con el decodificador NATIVO del navegador, sin wasm.** `<img>`/`createImageBitmap` del HEIC → `<canvas>` → `toBlob('image/jpeg')`. Safari/iOS decodifica HEIC de forma nativa (es el formato propio del iPhone), así que evita el Web Worker que cuelga, el `.wasm` que no se embarca y el coste de CPU en servidor. **Limitación:** no funciona en navegadores sin HEIC nativo (Chrome/Firefox de escritorio) → **combinar con el rechazo actual como respaldo** (detectar soporte y, si no lo hay, mostrar el aviso de convertir). **Verificar en un iPhone REAL** — el harness headless de Chromium NO sirve (Chromium no tiene HEIC nativo).
     _(Ola 1 — candidato para F11 o tarea aparte)_
- [ ] **Subida directa a Storage para fotos > ~4,5 MB** — hoy el tope efectivo es **4 MB/foto** (la foto viaja en el multipart de una función serverless de Vercel, body máx. ~4,5 MB). Las fotos grandes de móvil pueden superarlo. Iteración futura: subida directa cliente→Storage con URL firmada (saltando la función). Origen: F10-1/F10-3. _(Ola 1, F11 o tarea aparte)_
- [ ] **Foto del DNI / foto del niño desde móvil = también HEIC** — el follow-up de HEIC de arriba **aplica también a las subidas de familia** de F10-3 (foto del niño y DNI de recogida), no solo al blog de la profe. _(Ola 1)_
- [ ] **(Opcional) Wizard de onboarding del tutor** que empuje a poner la **foto del niño** al completar el alta tras la invitación — hoy la foto se sube desde la ficha persistente `/family/nino/[id]` (no hay asistente). Sería pieza de **F2.6**, no de F10. _(Ola 1 — opcional)_

## F12 — funcionalidad pendiente post-F11 (Ola 1)

> Fase **registrada, sin abrir** (PR #87). Sigue siendo **Ola 1** (secuencial tras F11, no una ola posterior). El análisis de cierre de F11 poblará esta lista. Backlog canónico en `scope-ola-1.md` (§Backlog F12) y `progress.md` (Fase 12); esta sección los refleja.

- [ ] **Tutorías — reserva de franjas formal con la profesora.** Hoy existe una **vía informal** (familia y profe acuerdan la tutoría por **mensajería** y/o la cuelgan en la **Agenda/Calendario** — citas de F7b `reunion_familia`). F12 añadiría la **capa de reserva formal encima** (franjas ofertadas, autoservicio de reserva por la familia, confirmación), **reusando** Agenda + mensajería, **no desde cero**. Reclasificada desde la etiqueta previa "Ola 3" (es funcionalidad, no una mejora de IA). _(Ola 1, F12)_
- [ ] **Selección de idioma en el perfil.** Hoy el perfil **MUESTRA** el idioma pero **no permite cambiarlo**. Añadir un selector (`es`/`en`/`va`) que **persista** la preferencia del usuario y **aplique** el locale elegido (hoy el cambio de locale solo va por URL). Al implementarlo, **verificar si es feature ausente o selector roto**. _(Ola 1, F12)_
- [ ] **Branding por centro (white-label).** La app es **NIDO por defecto**; al ser invitado a un centro, la **PWA se instala con el nombre + logo del centro** en la pantalla de inicio del dispositivo. **Decisión pendiente:** subdominios por centro vs. manifest dinámico (cada vía tiene implicaciones distintas en instalación PWA, caché del manifest y deploy). Mantener el **footer "NIDO by Cognix Labs"** en todas las pestañas (web y app) como atribución de marca. _(Ola 1, F12)_

## Ola 2 — infra de test y rendimiento (pre-ola-2)

> Hallazgos de la sesión de **activación de gated-tests en CI** (2026-06-20, PR #124). No bloquean Ola 1; quedan para antes de / durante Ola 2.

- [ ] **Infra de test pre-ola-2 — activar E2E en CI + A′ (DB de test aislada).** Hoy CI corre solo los vitest (incluidos los 26 gated-tests RLS/audit activados en PR #124). Falta **activar los E2E (Playwright / `E2E_REAL_SESSIONS`)** en CI, que necesitan **app corriendo + sesiones reales sembradas** (credenciales `E2E_*`). Va **junto con A′ (DB de test aislada)** — plan ya escrito esta sesión (proyecto Supabase dedicado, 54 migraciones por `db push` desde CI, repunte de 3 secrets, drift-check). Ambos se difieren a **pre-ola-2**: con datos reales en producción (Ola 2) deja de ser aceptable que CI cree fixtures contra la DB del piloto. _(Ola 2 — infra de test)_
- [ ] **Rendimiento de `purgar_sujeto_db` (borrado RGPD) bajo carga.** La RPC de olvido/anonimización **roza el `statement_timeout` del pooler** cuando CI la corre en paralelo con el resto de la suite (visto en PR #124: `o04` de `olvido-funcional.rls.test.ts` cayó una vez con `canceling statement due to statement timeout`; el re-run aislado pasó). Como **hábito de CI**: reintento del job aislado antes de declarar regresión (es flaky por contención, no fallo real). Pero es una **nota de rendimiento para Ola 2**: con **volumen real** de datos la RPC tardará más → **optimizar la RPC o subir el `statement_timeout`** para ese borrado. _(Ola 2 — rendimiento RGPD)_

## Tooling / mantenimiento

- [ ] **Fijar la versión del CLI de Supabase en el repo** (`package.json`/`.tool-versions`). Hoy `npm run db:types` usa `npx supabase` sin pin → al regenerar tipos cambia el formato (`Json`, reordenación) y mete **ruido de reformateo** de ~1600 líneas ajeno al esquema real. Menor pero recurrente. Origen: F10-2/F10-3. _(Ola 1)_

## Consolidado de cierre de Ola 1 — backlog F11 / pendiente

> **Auditoría al cerrar F10 (2026-06-12).** Lista única de TODO lo aparcado para F11 o tarea aparte, recogido de `progress.md` (cierres de F8, reparación de Mensajería, F10) y `scope-ola-1.md` (Bloqueantes). Las secciones de arriba detallan cada uno; aquí va el índice completo para no perder ninguno.

**🔴 RGPD — bloqueante ANTES del primer dato real (familia/niño real en producción):**

- [ ] **Derecho al olvido funcional** — anonimizar/redactar `valores_antes` en `audit_log` al ejercer borrado.
- [ ] **Consentimiento de imagen de menores** + **`autorizacion_imagenes` firmable** (reusa F8; alimenta el interruptor `ninos.puede_aparecer_en_fotos`, hoy lo pone dirección a mano).
- [ ] **Retención formal de fotos de menores y DNIs de terceros** (`recogida-adjuntos`) + **Registro de Actividades de Tratamiento (RAT)** + DPA con encargados.
- [x] ⚖️ **Least-privilege en supervisión de mensajería (admin):** **CERRADO en F11-A** (`20260613180000_phase11a_mensajeria_least_privilege`): el helper `puede_postear_en_conversacion` excluye al admin en `profe_familia` (lee pero no postea); regresión en `enviar-mensaje-admin-familia.test.ts`. Origen: reparación de Mensajería (PR #66). _(Queda aparte la transparencia/RAT del acceso de lectura — ítem siguiente.)_
- [ ] ⚖️ **Transparencia del acceso de dirección a la mensajería privada:** la supervisión expone a dirección **todos** los mensajes familia↔profe → debe constar en el **aviso de privacidad** y el **RAT**. Origen: PR #66.

**⚖️ Legal (bloquea uso con familias reales):**

- [ ] **Textos legales reales + validación del abogado** de F8 (autorizaciones/firma): 6 flags ⚖️ pendientes (validez eIDAS/LOPDGDD/normativa educativa). F8 es un mecanismo técnico auditable, NO certifica validez jurídica.

**📷 Fotos / Storage (F10):**

- [ ] **HEIC en subida** (blog + foto niño + DNI), **dos vías**: (a) decode server-side con build Webpack; (b) decode nativo en el navegador del iPhone (sin wasm, verificar en iPhone real). Ver arriba.
- [ ] **Subida directa a Storage para fotos > ~4,5 MB** (hoy tope 4 MB). Ver arriba.

**🧰 Tooling:**

- [ ] **Fijar la versión del CLI de Supabase** (ruido de reformateo de tipos). Ver arriba.

**📝 Residuales de F8 (autorizaciones):**

- [ ] **Migración legacy #56** — engancha las reglas de Régimen interno a la plantilla publicada; **pendiente de aplicar** al publicar el formato real (`20260608130000_phase8_migrar_reglas_56`, idempotente, salta centros sin plantilla).
- [x] **F8-4 — DNI del tutor condicional** ✅ **RESUELTO (decisión 2026-06-21).** La firma electrónica **simple** (nombre tecleado + trazo + hash del texto + IP/UA) **basta** para la validez del mecanismo; **no** se embebe el DNI del firmante en la firma. El DNI/identificación del tutor, cuando haga falta, se recoge en la **fase de documentación del alta** (post-F11-B), no acoplado a `firmas_autorizacion`. Por tanto F8 NO añade `usuarios.dni`/`tutor_datos` ni toca el modelo de firma.
- [ ] **Recogida puntual con fecha futura** (hoy la puntual vale solo "hoy"; permitir programarla).
- [ ] **Aviso del botón "Enviar" deshabilitado** en el flujo de firma (UX: explicar por qué está inactivo).

**📝 Residuales de F11 (alta tutor-driven):**

- [ ] **Gate del panel `/family` per-hijo** (P3c). Hoy el bloqueo es **global**: mientras exista algún hijo con matrícula no-`activa`, `/family` redirige al wizard. Correcto para el arranque de ANAIA (no hay hijos `activa` previos). **Refinar a per-hijo** cuando haya hermanos post-lanzamiento: un hijo `activa` + un hermano `pendiente` NO debe tapar el panel del que ya está activo (redirigir solo al entrar a la ficha del hijo no-`activa`, no bloquear todo `/family`).
- [x] **Apretar el gate de las RPCs de escritura del tutor de 3a a `es_tutor_legal_de`** (F11-D/E). ✅ **Resuelto en F11-E (PR #113**, migración `20260619120000_phase11_e_apretar_tutor_legal`**)**, alcance ampliado a **6 objetos**: RPC `set_info_medica_emergencia_cifrada_tutor` (médica) y `actualizar_identidad_nino_tutor` (identidad); policies `dp_tutor_insert`/`dp_tutor_update` (pedagógico) y `cartilla_tutor_insert/select/delete` + `ninos_fotos_insert_tutor` (storage). Además movió el `UPDATE ninos.foto_url` a la RPC SECURITY DEFINER `actualizar_foto_nino_tutor` (gate `es_admin OR es_tutor_legal_de` + backstop de path). Negativos del `autorizado` en `alta-p3a-tutor-writes.rls.test.ts`. `CREATE OR REPLACE` + `DROP+CREATE POLICY`, sin DDL destructivo.
- [x] **F8 — apretar `firmas_autorizacion` INSERT y la rama tutor de `autorizaciones_insert`** ✅ **RESUELTO (2026-06-21, migración `20260621140000_phase8_apretar_firmar_autorizaciones`).** Análisis de casos legítimos: el único flujo válido de un vínculo NO legal es un `autorizado` al que la dirección **conceda** `puede_firmar_autorizaciones=true` (ADR-0006). Por eso el apriete se hizo por **enfoque B** —gatear por el PERMISO `tiene_permiso_sobre(nino_id,'puede_firmar_autorizaciones')`, no por `es_tutor_legal_de`—: por defecto excluye al autorizado (default-false), **pero preserva la delegación** y **honra la revocación** de un tutor_legal. Cubre `firmas_insert` y la rama tutor B2 de `autorizaciones_insert` (admin/profe verbatim). Saneo JSONB del permiso a vínculos vivos sin la clave (110/114; 107 tutores legales habrían quedado bloqueados con fail-closed). Tests en `firmar-autorizaciones-permiso.rls.test.ts` (gate `F8_FIRMAR_PERMISO_MIGRATION_APPLIED`). `DROP+CREATE POLICY`, sin DDL destructivo.

- [ ] **CI — activar los tests RLS gateados por `F11_ALTA_P3A_MIGRATION_APPLIED`** (parte del pase de **CI hardening**). El flag **no se setea en CI** (ni en `.env.local`), así que `alta-p3a-tutor-writes.rls.test.ts` —**incluidos los 8 negativos del `autorizado` de F11-E**— se **salta** en cada corrida; localmente se ejecuta con `F11_ALTA_P3A_MIGRATION_APPLIED=1 npm test` → 1740 passed. Es el mismo patrón que el resto de gated (`F10_3_MIGRATION_APPLIED`, `F5B34_MIGRATION_APPLIED`, …): la migración ya está aplicada en remoto, pero ~195 tests gateados no corren en CI. Activarlos (poner los flags a `1` por defecto / en el entorno de CI, **una vez resuelto** que la BD de CI tenga las migraciones — ver "Salud de CI" arriba) para que el verde de CI cubra de verdad estos gates. _(Ola 1, F11 — CI hardening)_

**🔒 F11-D — barrido `createServiceClient` (cookie-bound) → service role real:**

- **Mecanismo (confirmado por sonda read-only en F11-D).** `createServiceClient` ([lib/supabase/server.ts](../../src/lib/supabase/server.ts)) usa la service key PERO adjunta cookies → `supabase-js` resuelve `Authorization = session?.access_token ?? supabaseKey`. **CON sesión** → prevalece el JWT del usuario → actúa como ese usuario (RLS aplica, infra-entrega silenciosa). **SIN sesión** → cae a la service key = `service_role` → **bypass** (sonda: `count(vinculos_familiares)`=32 con service key sin sesión, =0 con anon). **Refuta** la hipótesis previa "sin sesión → anon": sin sesión es `service_role`, NO anon. Origen del helper: bug de la foto (P3b-2), ya corregido en `ninos/[id]/foto/route.ts`. (Distinto de `createServiceRoleClient` de [\_service-role.ts](../../src/features/auth/actions/_service-role.ts), cookie-less = service role real.)
- [x] **F11-D fase 1 — migrados a `createServiceRoleClient`** (cookie-less, service role real; **PR aparte, solo TS, sin migración**). Helpers: `push/lib/audiencia` (`destinatariosDeNino`, `destinatariosPushDeAnuncio`, `getAutorPushInfo`), **`push/lib/enviar-push` (`enviarPushANotificarUsuarios` — #4 CRÍTICO)**, `recordatorios/lib/audiencia`, `eventos/lib/audiencia`, y defensivamente `olvido/actions/purgar-vencidos` + `retencion/actions/barrer-retencion`. Gates de autorización de las server actions INTACTAS (solo cambia el cliente dentro de los helpers). Guardia de regresión a nivel de datos en `push-audiencia-service-role.integration.rls.test.ts`.
  - **#4 era el bug grave (push a nadie):** `enviarPushANotificarUsuarios` es el paso final de TODOS los flujos push (mensajes/anuncios/recordatorios/eventos), corre **con sesión** del emisor y leía `push_subscriptions` de los destinatarios bajo `usuario_id = auth.uid()` → **0 subs → push a nadie**. Coherente con el síntoma "el push de NIDO no llega" (puede coexistir con el problema de VAPID env — causas independientes, cada una basta).
  - **#7-8 (`olvido`/`retencion`) eran correctos HOY pero frágiles:** corren solo desde el cron (`/api/cron/retencion`, sin sesión → `service_role` → bypass OK). Migrados igualmente para blindar el flujo RGPD contra un futuro caller con sesión (un botón admin "purgar ahora" infra-purgaría en silencio).
- [ ] **F11-D fase 2 — matar el footgun + per-site del resto.** (a) Deprecar/eliminar `createServiceClient` (sin uso legítimo: si necesitas al usuario → `createClient` anon+cookies; si necesitas bypass → `createServiceRoleClient`) y renombrar para que no se reuse por error. (b) Revisar caso por caso el resto de call-sites: `informes/[id]/pdf`, `fotos/upload`, `export/[tipo]/[id]`, `export/me`, `agenda/lib/invitados` (×2), `agenda/queries/get-cita-detalle`, `agenda/actions/crear-cita`, `fotos/actions/gestionar-publicacion` (×2), `fotos/queries/get-publicaciones-aula`, `fotos/queries/get-publicaciones-familia` — algunos corren con sesión admin (funcionan) o leen lo que el propio usuario ya ve (sin fuga). _(Ola 1, F11)_

**📝 Doc stale a corregir:**

- [x] **`scope-ola-1.md` — "Least-privilege en supervisión de mensajería (admin)"** estaba listado como bloqueante RGPD pendiente. **Texto actualizado a CERRADO** (F11-F2): el bloqueante ya estaba resuelto por `20260613180000_phase11a_mensajeria_least_privilege.sql` (F11-A) — el helper `puede_postear_en_conversacion` excluye al admin en `profe_familia` (lee pero no postea). Queda aparte la **transparencia/RAT** del acceso de lectura, que sí sigue pendiente. Regresión blindada en `enviar-mensaje-admin-familia.test.ts` (admin posteando profe_familia → `sin_permisos`).

**🧱 Otros pre-piloto / hardening** (detallados en las secciones de arriba): UI de alta de profesor + invitación; confirmar traducciones VA con nativo; drop de `es_profe_principal`; reactivar tests `skip` de `profes-aulas`; trigger audit de `profes_aulas` + sweep; cleanup de residuos de tests RLS en remoto; implementación de ADR-0028 (PWA/manifest); recalibrar alturas de `ConversacionView`; `process-logos.mjs` multi-fuente; seeds E2E; patrón `Select` de base-ui en jsdom.

## Resueltos

- [x] **Índice del README de `docs/decisions/`** — actualizado hasta **ADR-0037** (con 0035 `superseded` por 0037 y 0036 `accepted`) en el sprint de sincronización de docs de planificación. _(cerrado en el PR de docs/sync-planificacion-olas)_
