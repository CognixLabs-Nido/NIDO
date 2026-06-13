---
feature: proteccion-datos
wave: 1
status: approved
priority: critical
last_updated: 2026-06-13
related_adrs:
  [ADR-0002, ADR-0004, ADR-0006, ADR-0007, ADR-0027, ADR-0029, ADR-0041, ADR-0045, ADR-0046]
related_specs: [autorizaciones-firma.md, fotos-publicaciones.md, messaging.md, auth.md]
---

# Spec — Protección de datos (paquete RGPD, F11-A/F11-B)

> **Borrador.** Esta spec cubre el **paquete RGPD bloqueante** del cierre de Ola 1
> (ver `scope-ola-1.md` §Bloqueantes y `docs/follow-ups.md` §"Consolidado de cierre
> de Ola 1"). Se divide en **F11-A (código + migraciones)** y **F11-B (documentos:
> RAT, DPA, política de retención, textos legales reales del abogado)**. El **texto
> legal definitivo lo aporta el abogado al cierre de F11**; hasta entonces, marcadores
> de prueba (decisión ya tomada por el responsable). **No hay datos reales de familias
> en producción hasta cerrar F11.**

## Resumen ejecutivo

Convertir NIDO en una aplicación **operable con datos reales de menores** cerrando las
obligaciones RGPD que hoy están inertes o ausentes: derecho al olvido funcional
(anonimización de `audit_log.valores_antes` + purga de contenidos asociados),
activación de la tabla `consentimientos` (hoy definida pero sin escritura desde la app),
consentimiento de imagen **firmable** reusando F8 como única fuente de verdad, cierre
del agujero de **least-privilege** del admin en mensajería (la RLS deja postear donde la
UI es solo-lectura), política de **retención** de fotos de menores y DNIs de terceros, y
los documentos de cumplimiento (**RAT art. 30**, **DPA** con encargados) + páginas
**privacy/terms** reales enlazadas.

## Contexto

Estado real auditado al cerrar F10 (2026-06-13). Anclajes verificados en código:

- **`audit_log`** ([migración phase2](../../supabase/migrations/20260513202012_phase2_core_entities.sql) L215-225):
  columnas `valores_antes jsonb` / `valores_despues jsonb` poblados por
  `audit_trigger_function()` (L446-477) con `to_jsonb(OLD)` / `to_jsonb(NEW)` — es decir,
  **vuelca la fila entera con su PII** (nombres, emails, datos médicos, observaciones).
  RLS append-only: `audit_admin_select` (L423), sin UPDATE/DELETE para nadie. Al ejercer
  un borrado, **la PII permanece en claro en `valores_antes`** → bloqueante.
- **`consentimientos`** (L233-244): tabla append-only con `tipo`
  (`consentimiento_tipo`: `terminos` | `privacidad` | `imagen` | `datos_medicos`),
  `version text`, `aceptado_en`, `ip_address`, `user_agent`. RLS ya lista:
  `consentimientos_self_select` / `consentimientos_admin_select` / `consentimientos_insert`
  (L428-440). **Pero NO se escribe desde la app**: el único versionado real corre por las
  columnas `usuarios.consentimiento_privacidad_version` / `_terminos_version`, fijadas a
  `CONSENT_VERSION = 'v1.0'` en
  [accept-invitation.ts:11,76-77](../../src/features/auth/actions/accept-invitation.ts#L11).
  Los tipos `imagen` y `datos_medicos` no tienen ninguna ruta de escritura → **tabla inerte**.
- **Consentimiento de imagen**: el gate efectivo es `ninos.puede_aparecer_en_fotos`
  (boolean DEFAULT false, [phase10_0](../../supabase/migrations/20260611120000_phase10_0_storage_publicaciones.sql#L57)),
  **hoy lo pone dirección a mano**. El formato `autorizacion_imagenes` existe como **valor
  del ENUM `tipo_autorizacion`** (catálogo F8, patrón A), **no como tabla**; su plantilla
  arranca con `texto='PENDIENTE'` / `texto_definitivo=false` → no publicable ni firmable.
- **Least-privilege mensajería**: `puede_participar_conversacion`
  ([phase5_6](../../supabase/migrations/20260528100000_phase5_6_admin_family_messaging.sql#L137-156))
  devuelve TRUE para `es_admin(c.centro_id)` en hilos `profe_familia` (L145), y
  `mensajes_insert` (L272-278) usa ese helper en su `WITH CHECK`. La pestaña "Dirección"
  (PR #66, `AdminSupervisionSplitView`) es **solo-lectura en la UI**, pero **la RLS deja al
  admin postear** en conversaciones profe↔familia → ⚖️ bloqueante.
- **Storage** (F10, ADR-0045/0046): buckets privados `ninos-fotos`, `recogida-adjuntos`
  (DNIs de terceros), `aula-fotos` (blog) y público `centro-assets`. **Sin política de
  retención** — los objetos viven indefinidamente.
- **privacy/terms**: rutas reales `/[locale]/privacy` y `/[locale]/terms`
  ([page.tsx](../../src/app/[locale]/privacy/page.tsx)) que hoy renderizan
  `legal.privacy.placeholder` = _"Contenido legal pendiente. Se publicará antes del
  lanzamiento (Fase 11)."_ **Sin enlace** desde footer/login.
- **Soft-delete**: `usuarios.deleted_at` / `roles_usuario.deleted_at`
  ([phase1](../../supabase/migrations/20260513114319_phase1_auth.sql#L26,L38)) y `deleted_at`
  en entidades sensibles; índices parciales `WHERE deleted_at IS NULL`. **No hay** flujo de
  borrado de cuenta, anonimización, ni purga.

Modelo operativo (CLAUDE.md): single-tenant ANAIA, multi-centro listo. El **responsable
del tratamiento es el centro**; CognixLabs es **encargado** (provee la plataforma). Esto
condiciona quién ejerce el derecho al olvido (la dirección del centro) y a quién apunta el
RAT/DPA.

## User stories

- **US-01** — Como **dirección del centro** (responsable del tratamiento), quiero **ejercer
  el derecho de supresión** de un usuario/niño para cumplir el art. 17 RGPD: el sistema
  borra/anonimiza sus datos personales (incl. los históricos en `audit_log`) y purga sus
  contenidos (fotos, DNIs, mensajes) tras un periodo de gracia.
- **US-02** — Como **usuario** (tutor/profe), quiero **dar y revocar consentimiento** por
  tipo (términos, privacidad, imagen) con constancia de versión y fecha, y poder
  **consultar** qué he aceptado.
- **US-03** — Como **tutor legal**, quiero **firmar la autorización de imagen** de mi hijo
  (reusando la firma de F8) y que ese acto, y solo ese, active que mi hijo pueda aparecer
  en fotos — sin que dirección lo marque a mano.
- **US-04** — Como **dirección**, quiero **supervisar** las conversaciones profe↔familia en
  solo-lectura **sin poder escribir en ellas** (ni siquiera por API), y que ese acceso
  **conste** en el aviso de privacidad y el RAT.
- **US-05** — Como **responsable de cumplimiento** (CognixLabs/centro), quiero un **RAT**
  (art. 30) y plantillas de **DPA** con los encargados (Supabase, Vercel, error-tracking
  futuro) para acreditar la base legal del tratamiento.
- **US-06** — Como **visitante**, quiero llegar a **aviso de privacidad y términos** desde
  un enlace visible (footer/login) y leer su contenido.

## Alcance

**Dentro — F11-A (código + migraciones):**

- Derecho al olvido funcional: anonimización de `audit_log.valores_antes` + purga de
  Storage y mensajes, con periodo de gracia (soft-delete → purga).
- Activación de `consentimientos`: captura por tipo+versión, revocación, lectura/auditoría.
- Consentimiento de imagen firmable: cableado `autorizacion_imagenes` (F8) →
  `ninos.puede_aparecer_en_fotos` + fila `consentimientos` tipo=`imagen` coherente.
- Migración de least-privilege: quitar el INSERT del admin en `profe_familia`, conservando
  su SELECT (supervisión).
- Enganche de retención (jobs/RPC de purga; la **política** redactada va en F11-B).
- **Export completo de datos**: derecho de **acceso (art. 15)** + **portabilidad (art. 20)**,
  con **auto-servicio de la familia** ("descargar mis datos", formato legible + máquina) y la
  vía de la dirección. Es funcionalidad core de Ola 1, no se difiere (Decisión Abierta #10).
- Páginas privacy/terms con estructura real + enlace visible + **marcadores de prueba**
  (no el texto final).

**Dentro — F11-B (documentos, sin código):**

- **RAT** (art. 30) — plantilla + contenido inicial; lo valida el abogado.
- **DPA** con encargados (Supabase, Vercel, futuro error-tracking) — enfoque/plantilla.
- **Política de retención** escrita (plazos por categoría de dato).
- **Texto legal definitivo** del abogado → sustituye marcadores; flip de `texto_definitivo`
  en las plantillas F8 y levantamiento de los **6 flags ⚖️** de ADR-0041.

**Fuera (no se hace aquí):**

- Banner de cookies / gestor de consentimiento de cookies (la app no usa cookies de
  terceros/tracking hoy; si se añade analytics con cookies, sería su propia pieza).
- Validez jurídica de la firma electrónica (eIDAS) — la **certifica el abogado**; F8/F11
  solo aportan el mecanismo técnico auditable.
- Cifrado adicional más allá del ya existente (pgcrypto en `info_medica_emergencia`, ADR-0004).

## Comportamientos detallados

### Comportamiento 1: Derecho al olvido funcional (supresión)

**Quién lo ejerce:** la **dirección del centro** (responsable). CognixLabs (encargado) solo
ejecuta a instrucción documentada. El sujeto puede solicitarlo; la dirección lo tramita.

**Modelo (anonimización vs hard-delete):** se propone un modelo en **dos tiempos**
(detalle y alternativa en Decisión Abierta #1):

1. **Soft-delete + periodo de gracia** — `usuarios.deleted_at = now()` (ya existe el
   mecanismo). El usuario deja de operar; los datos siguen presentes para reversión/disputa
   durante un plazo (Decisión Abierta #2).
2. **Anonimización/purga al vencer la gracia** — una **RPC `SECURITY DEFINER`**
   (p. ej. `ejercer_olvido_usuario(p_usuario_id)`), autorizada a `es_admin` del centro:
   - **`audit_log`**: redacta `valores_antes`/`valores_despues` de las filas del sujeto
     sustituyendo los campos PII por marcador (`'[redactado]'`) **conservando** la traza
     (qué tabla, qué acción, cuándo, `usuario_id` → reemplazado por marcador). Esto **rompe
     la condición append-only** vigente (`audit_log` no permite UPDATE/DELETE) → requiere
     una vía controlada (Decisión Abierta #3).
   - **`usuarios`**: anonimiza nombre/email/teléfono (tombstone), conservando el `id` para
     integridad referencial (FKs RESTRICT existentes).
   - **Storage**: borra objetos del sujeto en `ninos-fotos`, `recogida-adjuntos`, y media de
     `aula-fotos` donde solo aparezca etiquetado el niño (Decisión Abierta #5).
   - **Mensajes**: anonimiza autoría/contenido de `mensajes` del sujeto (Decisión Abierta #6).
   - **Firmas (`firmas_autorizacion`)**: append-only e inmutables, con valor probatorio
     legal → **no se purgan** por defecto; entran en retención legal (Decisión Abierta #7).

**Post-condiciones:** el sujeto no es identificable en datos operativos ni en histórico de
auditoría; las filas de auditoría conservan su utilidad estructural (no su PII). Todo el
ejercicio queda **a su vez auditado** (quién ejerció el olvido, cuándo, sobre quién — sin
re-introducir la PII borrada).

### Comportamiento 2: Activar la tabla `consentimientos`

**Pre-condiciones:** la tabla y su RLS ya existen (no se recrean). Falta la **ruta de
escritura** y la lectura desde la app.

**Flujo (captura):**

1. En el alta (`accept-invitation`) y en cambios de versión, se inserta **una fila por tipo
   aceptado** en `consentimientos` (`tipo`, `version`, `ip_address`, `user_agent`,
   `aceptado_en`) además de (o en lugar de) las columnas `usuarios.consentimiento_*_version`
   — ver Decisión Abierta #4 sobre cuál es la fuente de verdad.
2. Las **versiones** se centralizan en una constante/catálogo (hoy `CONSENT_VERSION='v1.0'`
   hardcoded; se sube a un módulo por tipo: privacidad/términos/imagen tienen versiones
   independientes).
3. **Revocación**: como la tabla es append-only, revocar = **fila nueva** con marca de
   revocación (Decisión Abierta #4 cubre el modelo: nueva fila `revocado` vs columna).
   Estado vigente = última fila por (usuario, tipo).

**Auditoría:** `consentimientos` hoy **no tiene trigger de audit** (no está en la lista de
`audit_trigger_function`). Es append-only por RLS, lo que ya da traza; añadir trigger sería
redundante salvo que se quiera `centro_id` indexado (Decisión Abierta #8).

### Comportamiento 3: Consentimiento de imagen firmable (reuso F8)

**Una sola fuente de verdad por tipo.** El acto legal es la **firma F8** del formato
`autorizacion_imagenes` (patrón A: dirección publica plantilla → tutor firma). Al
registrarse una firma `decision='firmado'` válida sobre una instancia de
`autorizacion_imagenes` para un niño:

1. Se activa `ninos.puede_aparecer_en_fotos = true` (hoy manual). El `UPDATE` de `ninos`
   que el tutor no puede hacer por RLS va con **service role tras autorizar** (patrón
   ADR-0027, idéntico a cómo F10-3 actualiza `ninos.foto_url`).
2. Se registra/concilia la fila `consentimientos` tipo=`imagen` (coherencia, Decisión
   Abierta #9: ¿es la firma F8 la única fuente y `consentimientos.imagen` un espejo, o se
   escriben ambas?).
3. **Revocar la firma** (fila `revocado` en `firmas_autorizacion`) → `puede_aparecer_en_fotos
= false` → la RLS de F10 **oculta** las publicaciones donde el niño está etiquetado
   (comportamiento ya implementado en F10, solo cambia el disparador del flag).

**No se inventa modelo nuevo**: reusa plantilla durable + `firmas_autorizacion` (hash
SHA-256 compuesto, append-only) + el gate RLS de F10. Lo único nuevo es el **disparador**
firma→flag→consentimiento.

### Comportamiento 4: Least-privilege RLS del admin en mensajería

**Problema anclado:** `mensajes_insert.WITH CHECK` usa
`puede_participar_conversacion(conversacion_id)`, que para `profe_familia` incluye
`es_admin(c.centro_id)` → el admin puede insertar. Pero **el mismo helper** se usa en
`mensajes_select` para que el admin **lea** (supervisión PR #66). No se puede cambiar el
helper sin romper la lectura.

**Decisión (anclada, ver Decisión Abierta #11 para la forma exacta):** separar lectura de
escritura. Introducir un helper de **posteo** (p. ej. `puede_postear_en_conversacion`) que
para `profe_familia` exija ser **profe del niño** o **familia con `puede_recibir_mensajes`**
(NO `es_admin`), y para `admin_familia` exija `admin_id=auth.uid() OR tutor_id=auth.uid()`.
`mensajes_insert` pasa a usar ese helper; `mensajes_select` conserva
`puede_participar_conversacion` (admin sigue leyendo). Migración aditiva (`CREATE FUNCTION` +
`DROP/CREATE POLICY mensajes_insert`), inmutable respecto a las ya aplicadas.

**Post-condiciones:** el admin **no** puede crear mensajes en hilos profe↔familia ni vía
API; su supervisión sigue siendo solo-lectura, ahora también a nivel RLS. Test de regresión:
admin intenta `mensajes.insert` en `profe_familia` → `42501`; admin `select` sigue OK.

### Comportamiento 5: Retención de fotos de menores y DNIs de terceros

**Categorías y enganche con el olvido:**

- `recogida-adjuntos` (DNIs de terceros, F10-3): plazo corto tras dejar de ser necesarios
  (la recogida puntual caduca; la habitual mientras el niño esté matriculado). Decisión
  Abierta #12 fija el plazo.
- `ninos-fotos` / `aula-fotos` (imágenes de menores): retención mientras matrícula activa +
  plazo tras baja; al ejercer el olvido se purgan antes.
- Mecanismo: la **política** (plazos) se redacta en F11-B; el **enganche técnico** (RPC/job
  de barrido que el responsable dispara, o cron) se especifica aquí pero la frecuencia/
  automatización es Decisión Abierta #12.

### Comportamiento 6: RAT + DPA (F11-B, documentos)

- **RAT (art. 30)**: documento por actividad de tratamiento (autenticación, agenda,
  mensajería, fotos de menores, autorizaciones/firmas, datos médicos). Plantilla en
  `docs/legal/rat.md`; **una entrada explícita** para "supervisión de dirección sobre
  mensajería privada" (transparencia, ver Comportamiento 7). Contenido inicial lo redacta el
  equipo; lo valida el abogado.
- **DPA**: NIDO (centro=responsable) ↔ CognixLabs (encargado) y CognixLabs ↔ sub-encargados
  (Supabase, Vercel, futuro error-tracking). Plantilla + lista de sub-encargados en
  `docs/legal/dpa.md`. El **error-tracking** (Sentry/GlitchTip/highlight, hoy sin elegir)
  entra como sub-encargado en cuanto se elija — condiciona el cierre.

### Comportamiento 7: Transparencia del acceso de dirección

La supervisión (pestaña "Dirección") expone a la directora **todos** los mensajes privados
familia↔profe del centro. Debe **constar** en: (a) el **aviso de privacidad** (sección
"quién accede a tus comunicaciones"), y (b) el **RAT** (finalidad + base legal de la
supervisión). Es un requisito **documental**, no de código (el acceso ya existe y es
legítimo para la función directiva); F11-A no lo toca salvo el least-privilege del
Comportamiento 4.

### Comportamiento 8: Páginas privacy/terms

- Estructura real (secciones: responsable, finalidades, base legal, destinatarios,
  conservación, derechos, contacto DPD si aplica). Contenido = **marcadores de prueba**
  ahora (no lorem: texto estructurado que el abogado sustituye).
- **Enlace visible**: footer global + pantalla de login/invitación. i18n es/en/va.
- Al cierre de F11: el abogado entrega el texto, se sustituye, y se **levantan los 6 flags
  ⚖️** (ADR-0041) + `texto_definitivo=true` en las plantillas F8.

## Modelo de datos (cambios propuestos — a confirmar en las Decisiones)

> Ningún cambio se implementa en esta spec. Resumen de lo que F11-A tocaría:

- **`audit_log`**: vía controlada de redacción (rompe append-only puro) — Decisión #3.
- **`consentimientos`**: sin cambio de esquema (se activa la escritura); posible columna/fila
  de revocación — Decisión #4.
- **`ninos.puede_aparecer_en_fotos`**: sin cambio de esquema; cambia el **disparador**.
- **`mensajes` (RLS)**: helper nuevo + `mensajes_insert` reescrita — Comportamiento 4.
- **Storage**: políticas de retención/purga (RPC o job) — Decisión #12.
- **Nuevas RPC** `SECURITY DEFINER`: `ejercer_olvido_usuario`, registro/revocación de
  consentimiento, activación de imagen tras firma. Todas autorizadas y auditadas.
- **Export** (acceso + portabilidad): recolector server-side (route handler con descarga
  binaria, patrón ADR-0043 del PDF de F9) que arma el dump del sujeto respetando RLS; sin
  tabla nueva. Auto-servicio en el perfil de la familia + vía de la dirección.

## Tests obligatorios (anticipo, no se implementan aquí)

- Olvido: tras ejercerlo, `audit_log` del sujeto sin PII; Storage purgado; FKs intactas;
  el ejercicio queda auditado.
- Consentimientos: captura por tipo+versión; revocación → estado vigente correcto;
  aislamiento RLS (self + admin del centro).
- Imagen firmable: firmar → flag true + fila consentimiento; revocar → flag false + RLS F10
  oculta publicaciones (regresión sobre el test de F10).
- Least-privilege: admin `insert` en `profe_familia` → `42501`; admin `select` OK; profe y
  familia inalterados.
- Retención: barrido purga lo vencido y respeta lo vigente.
- Export: la familia exporta **solo lo suyo** (acceso + portabilidad); la dirección, lo de su
  centro; aislamiento RLS verificado (una familia no exporta datos de otra); el export queda
  auditado.

---

## Decisiones abiertas (numeradas, con recomendación)

> Como en el cierre de F10: cada una anclada al código real. Resuélvelas antes de tocar
> código. **Recomendación** = mi propuesta por defecto.

**1. Modelo de supresión: ¿anonimización in-place o hard-delete?**
Hay FKs `RESTRICT`/`SET NULL`/`CASCADE` heterogéneos (p. ej. `creado_por RESTRICT`,
`firmas_autorizacion.firmante_id RESTRICT`). Un hard-delete chocaría con RESTRICT y borraría
firmas con valor probatorio.
**Recomendación:** **anonimización in-place** (tombstone del `usuarios.id`, PII → marcador),
NO hard-delete. Conserva integridad referencial y firmas; cumple "no identificable" sin
romper FKs. Hard-delete solo para datos sin valor legal y sin FK entrante.

**2. Periodo de gracia antes de purgar.**
Hoy no existe ningún plazo.
**Recomendación:** **30 días** de soft-delete (`deleted_at`) antes de la anonimización/purga
automática, con posibilidad de purga inmediata a petición expresa del sujeto. Plazo
configurable por centro en el futuro; fijo en F11.

**3. Romper el append-only de `audit_log` para redactar.**
`audit_log` no permite UPDATE/DELETE a nadie (ni admin); el trigger es la única vía de
INSERT. Redactar `valores_antes` exige una excepción.
**Recomendación:** RPC `SECURITY DEFINER` **dedicada y auditada** (`redactar_audit_de_usuario`)
que hace `UPDATE` solo de los campos PII dentro de `valores_antes`/`valores_despues` (vía
`jsonb_set`/`-`), **sin** abrir una policy UPDATE general. La RPC queda registrada (en
`audit_log` mismo o en una tabla de "ejercicios de derechos"). Alternativa rechazada:
abrir policy UPDATE a admin (expone el log a manipulación arbitraria).

**4. Fuente de verdad del consentimiento: tabla `consentimientos` vs columnas `usuarios`.**
Hoy conviven la tabla (inerte) y `usuarios.consentimiento_*_version`.
**Recomendación:** la **tabla `consentimientos` pasa a ser la fuente de verdad** (histórico
completo por tipo+versión+revocación); las columnas en `usuarios` quedan como **caché de la
versión vigente** (lectura rápida) o se deprecan. Revocación = **fila nueva** (append-only,
patrón del proyecto), no UPDATE. Estado vigente = `DISTINCT ON (usuario_id, tipo) … ORDER BY
aceptado_en DESC`. Requiere ampliar `consentimiento_tipo` o añadir una marca de revocación
(sub-decisión: añadir columna `revocado boolean` o un tipo de evento — recomiendo columna
`revocado_en timestamptz NULL` para no tocar el ENUM).

**5. Purga de fotos: ¿solo las exclusivas del niño o también las compartidas?**
Una `media` del blog puede etiquetar a varios niños.
**Recomendación:** al ejercer el olvido de un niño, **eliminar solo su etiqueta**
(`media_etiquetas`) y purgar el **objeto** únicamente si el niño era el **único** etiquetado;
si hay más niños, se conserva la foto (datos de terceros con su propio consentimiento) y solo
desaparece la asociación. Coherente con el gate RLS de F10.

**6. Mensajes en el olvido: ¿anonimizar autoría/contenido o conservar?**
Los mensajes son comunicación bilateral (el otro interlocutor tiene interés legítimo en su
copia).
**Recomendación:** **anonimizar la autoría** del sujeto (`autor_id` → tombstone, nombre no
resoluble) y **conservar el contenido** (es también dato del interlocutor); no borrar el hilo.
Si el contenido contiene PII del propio sujeto y se exige borrado, se redacta igual que el
audit. Confirmar con criterio legal en F11-B.

**7. Retención de firmas (`firmas_autorizacion`) frente al olvido.**
Son append-only, inmutables, con hash probatorio; algunas (medicación, recogida) tienen valor
legal/sanitario.
**Recomendación:** **excluir las firmas de la purga por defecto**: entran en **retención
legal** (plazo de prescripción de responsabilidades, lo fija el abogado en F11-B). El derecho
al olvido cede ante la obligación legal de conservación (art. 17.3.b/e RGPD). Documentarlo en
el RAT.

**8. ¿Añadir trigger de audit a `consentimientos`?**
Hoy no lo tiene; ya es append-only por RLS.
**Recomendación:** **no añadir** trigger (sería redundante: la propia tabla es el registro).
Si se quiere `centro_id` para el `audit_admin_select`, basta indexar; no justifica trigger.
Revisar en el sweep de "tablas sin auditar" del follow-up RGPD (decisión menor).

**9. Coherencia imagen: ¿firma F8 única fuente y `consentimientos.imagen` espejo, o ambas
independientes?**
**Recomendación:** la **firma F8 es la fuente legal**; al firmar se **escribe también** una
fila `consentimientos` tipo=`imagen` (con la `version` de la plantilla firmada) como índice
homogéneo para el panel de consentimientos del usuario. `ninos.puede_aparecer_en_fotos` es el
**derivado operativo** (lo consume la RLS de F10). Tres representaciones, **una sola escritura
transaccional** disparada por la firma. Evita divergencia (el bug clásico de "marcado a mano"
que F11 viene a cerrar).

**10. Export de datos / portabilidad (art. 15 + art. 20). — RESUELTA: incluido completo en Ola 1.**
El inventario lo marcó ausente. **Decisión:** es **funcionalidad core**, entra **completo en
F11-A**, sin diferir. Cubre: **derecho de acceso (art. 15)** + **portabilidad (art. 20)** con
**auto-servicio de la familia** ("descargar mis datos" desde su perfil) **y** la vía de la
dirección (export de un usuario/niño del centro). Formato **legible + estructurado/máquina**
(JSON; PDF opcional de cortesía). Respeta la RLS (la familia solo exporta lo suyo; la dirección,
lo de su centro) y queda **auditado** (acceso a datos personales). Sub-decisión de
implementación (alcance del dump, no de wave): qué tablas/Storage incluye y si los binarios van
como enlaces firmados o empaquetados — se concreta al implementar F11-A.

**11. Forma exacta del least-privilege en mensajería.**
Opciones: (a) helper nuevo `puede_postear_en_conversacion` usado solo en `mensajes_insert`;
(b) añadir condición inline a `mensajes_insert` excluyendo admin en `profe_familia`.
**Recomendación:** **(a)** helper nuevo (más legible, testeable, y reutilizable si aparece un
segundo punto de escritura). Mantener `puede_participar_conversacion` intacto para SELECT.
Migración inmutable nueva, no editar las aplicadas.

**12. Plazos y automatización de retención.**
**Recomendación:** plazos iniciales (a validar por abogado en F11-B): DNIs de recogida
puntual → purga al caducar la recogida + 7 días; DNI de recogida habitual y fotos → mientras
matrícula activa + 12 meses tras baja. Automatización: la **RPC de barrido** y el **cron
programado** que la ejecuta entran **ambos en Ola 1** (F11-A) — la enforcement de retención es
funcionalidad, no se difiere. Matiz operativo (no de wave): mientras el piloto madura, el cron
puede arrancar en modo **avisar/semi-manual** (lista lo que vencería; la dirección confirma)
antes de pasar a borrado autónomo; es un flag de operación dentro de F11, no una pieza de otra
ola. (Corrige la etiqueta previa "Ola 2", que era el bucket equivocado: Ola 2 = app nativa.)

**13. Versionado de los textos legales y re-consentimiento.**
Cuando llegue el texto del abogado, su versión cambia (de `v1.0` marcador a la real).
**Recomendación:** al publicar el texto definitivo, **bump de versión** por tipo; los usuarios
existentes (que no los hay aún en prod hasta cerrar F11) **no** necesitan re-consentir en el
piloto inicial; el mecanismo de re-consentimiento (mostrar de nuevo si la versión vigente >
la aceptada) se implementa pero no se dispara hasta el primer cambio post-lanzamiento.

**14. Nombre/ubicación de los documentos F11-B.**
**Recomendación:** `docs/legal/` nuevo (`rat.md`, `dpa.md`, `retencion.md`,
`aviso-privacidad.md`, `terminos.md`), separado de `docs/specs/` y `docs/operations/`. Enlazar
desde esta spec y desde el RAT a las actividades de tratamiento.

---

## Referencias

- `scope-ola-1.md` §Bloqueantes de Ola 1 (paquete RGPD, 2 ⚖️).
- `docs/follow-ups.md` §"Consolidado de cierre de Ola 1 — backlog F11".
- `autorizaciones-firma.md` + ADR-0041 (firma F8, 6 flags ⚖️, `autorizacion_imagenes`).
- `fotos-publicaciones.md` + ADR-0045/0046 (`puede_aparecer_en_fotos`, Storage, retención).
- `messaging.md` + PR #66 (supervisión de dirección, least-privilege).
- `docs/architecture/rls-policies.md` (helpers, gotchas MVCC/USING, append-only audit).
- Migraciones ancla: `20260513202012_phase2_core_entities` (audit_log, consentimientos),
  `20260528100000_phase5_6_admin_family_messaging` (mensajería),
  `20260611120000_phase10_0_storage_publicaciones` (`puede_aparecer_en_fotos`, buckets).
