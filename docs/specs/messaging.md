---
feature: messaging
wave: 1
phase: 5
status: extended-by-phase-5-6
priority: critical
last_updated: 2026-05-28
related_adrs: [ADR-0023, ADR-0024, ADR-0025, ADR-0029, ADR-0030, ADR-0031]
related_specs: [core-entities, daily-agenda, attendance, phase-5-6-admin-family-messaging]
---

# Spec — Mensajería profe ↔ familia + anuncios (Fase 5)

> Canal de comunicación cotidiano del centro: conversaciones bidireccionales niño-a-niño entre profe y tutores, más anuncios unidireccionales (profe → aula, admin → aula, admin → centro). Sin push en esta fase (llega en F5.5).

> **Extensiones en Fase 5.6 (2026-05-28)** — ver [phase-5-6-admin-family-messaging.md](phase-5-6-admin-family-messaging.md):
>
> - **F5.6-A**: añade un segundo tipo de conversación `admin_familia` (1 hilo por (admin, tutor), `expires_at` 3 días, reapertura por admin). Ver ADR-0029 y ADR-0030.
> - **F5.6-B**: "marcar como erróneo" pasa a tener **ventana de 5 minutos** desde `created_at`. Aplica a mensajes (ambos tipos) y anuncios. Sin moderación admin. Ver ADR-0031. **Deroga** la sección B29/B34 de F5 que decía "sin ventana temporal".
> - **F5.6-C**: scroll WhatsApp en las 3 vistas de conversación. Cambio de UI sin impacto en el modelo.

## Resumen ejecutivo

Implementa la **mensajería** de NIDO en dos formatos complementarios:

1. **Conversaciones bidireccionales**: 1 hilo por niño donde la profe del aula actual y los tutores con permiso `puede_recibir_mensajes` intercambian mensajes en tiempo real.
2. **Anuncios unidireccionales** (broadcasts): profe → aula, admin → aula concreta, admin → centro entero. La audiencia los lee pero no responde.

> **`puede_recibir_mensajes` es el flag global de recepción digital**: el tutor con este flag a `false` no recibe **ni conversaciones ni anuncios** (ni ámbito aula ni ámbito centro). Los profes y admin del centro sí reciben todos los anuncios de su ámbito y actúan como **puente humano** para tutores excluidos del canal digital (ej. autorizado que solo recoge): la profe puede transmitir la información en persona o por canal privado. Un solo bit por vínculo controla todo el canal digital entrante de mensajería.

Cinco tablas nuevas (`conversaciones`, `mensajes`, `lectura_conversacion`, `anuncios`, `lectura_anuncio`), Realtime activado sobre `mensajes` y `anuncios`, badge de no leídos en la navegación, marcado como erróneo idéntico al patrón de F3/F4. Push notifications **fuera del alcance** — se aborda en F5.5 como módulo transversal.

## Contexto

ANAIA necesita un canal directo entre profes y familias para coordinar la jornada (un retraso, un cambio de pañal, una nota sobre la siesta) sin recurrir a WhatsApp privado del personal. La directora necesita además poder difundir avisos a un aula o al centro entero (cierre por nieve, recordatorio de cuotas, fiesta de fin de curso) sin convertirse en parte activa de cada conversación.

Las fases anteriores ya tienen:

- **F2.6**: `vinculos_familiares.permisos` JSONB con clave `puede_recibir_mensajes` (default `true` para `tutor_legal_*`, `false` para `autorizado`).
- **F2**: `audit_log` con triggers automáticos, helpers RLS estables (`es_admin`, `es_profe_de_aula`, `es_profe_de_nino`, `centro_de_nino`, `pertenece_a_centro`, `tiene_permiso_sobre`).
- **F3/F4**: patrón "marcar como erróneo" con prefijo en texto (`[anulado] `, `[cancelada] `) y Realtime con RLS aplicada también a las notificaciones.

Las decisiones de modelo (5 tablas, participantes calculados dinámicamente), de scope (admin lee pero no inicia, familias no inician con admin) y de fuera-de-scope (push) ya están fijadas en el prompt del responsable. Esta spec las desarrolla y ata cabos sueltos.

## User stories

- **US-26**: Como **profe**, quiero escribir a la familia de un niño concreto desde la ficha del niño, y que el mensaje llegue al tutor en vivo sin recargar.
- **US-27**: Como **profe**, quiero ver la lista de conversaciones abiertas con badge de no leídos para priorizar respuestas.
- **US-28**: Como **profe**, quiero publicar un anuncio a las familias de mi aula (cumpleaños, recordatorio, cambio de horario puntual) sin tener que escribir mensaje por mensaje.
- **US-29**: Como **tutor legal con `puede_recibir_mensajes`**, quiero hablar con la profe de mi hijo sobre la jornada y ver sus respuestas en tiempo real.
- **US-30**: Como **tutor legal sin `puede_recibir_mensajes`** (por ejemplo "autorizado" que solo recoge), quiero un mensaje claro de que no tengo acceso al chat **ni a los anuncios** — la profe me transmitirá en persona lo que necesite.
- **US-31**: Como **admin del centro**, quiero ver todas las conversaciones de las aulas (transparencia operativa) pero no participar salvo que decida intervenir.
- **US-32**: Como **admin del centro**, quiero publicar anuncios a un aula concreta o al centro entero (ej. "Cerrado por temporal" o "Reunión de tutoría tercer aula").
- **US-33**: Como **tutor**, quiero marcar un mensaje mío como erróneo si me he equivocado al escribir, en vez de borrarlo silenciosamente.
- **US-34**: Como **auditor / DPD**, quiero que cada mensaje y anuncio quede en `audit_log` con autor, contenido y centro.

## Alcance

**Dentro:**

- 5 tablas nuevas (`conversaciones`, `mensajes`, `lectura_conversacion`, `anuncios`, `lectura_anuncio`) y 1 ENUM nuevo (`ambito_anuncio`).
- Helpers SQL `SECURITY DEFINER`: `centro_de_conversacion`, `nino_de_conversacion`, `puede_participar_conversacion`, `usuario_es_audiencia_anuncio`.
- Políticas RLS con default DENY ALL siguiendo patrón ADR-0007 (lookups por helper, no por subquery).
- **`puede_recibir_mensajes` como flag global**: bloquea conversaciones **y** anuncios (aula y centro) para tutores. Profes y admin siempre reciben todos los anuncios de su ámbito (puente humano para tutores excluidos).
- Auto-creación lazy de la conversación: la fila padre se crea on-demand al enviar el primer mensaje. No se pre-crean conversaciones vacías.
- Trigger `mensajes_after_insert_touch_conversacion` que actualiza `conversaciones.last_message_at` para ordenar la lista.
- Audit log en `conversaciones`, `mensajes`, `anuncios` (no en `lectura_*` — telemetría de usuario).
- Realtime activado en `mensajes` y `anuncios`. RLS de SELECT filtra notificaciones (igual que F3).
- Server actions: enviar mensaje, marcar mensaje como erróneo, marcar conversación como leída, publicar anuncio, marcar anuncio como erróneo, marcar anuncio como leído.
- UI:
  - `/messages` — lista combinada (tabs Conversaciones / Anuncios), badge de no leídos en sidebar.
  - `/messages/conversacion/[id]` — hilo bidireccional.
  - `/messages/anuncios/[id]` — detalle del anuncio + lista de lectores si soy el autor.
  - `/messages/nuevo-anuncio` — composer.
- i18n trilingüe (es/en/va) en namespace `messages.*`.
- Tests RLS (≥10), helpers (≥3), schemas Zod, audit (≥1), Playwright E2E (≥3).
- ADRs 0023, 0024, 0025.

**Fuera (no se hace aquí):**

- **Push notifications**: queda para F5.5 como módulo transversal (ADR-0025). Solo badge in-app en esta fase.
- **Adjuntos** (fotos, audio, documentos): llegan en F10 (Storage) y se aplicarán retroactivamente a `mensajes`.
- **Conversaciones de grupo** (varios niños o varios tutores con varios profes simultáneamente): el modelo actual es 1 hilo por niño con participantes calculados. Si en Ola 2 se quiere "grupo de aula" se reutilizará el patrón de anuncios o se modelará aparte.
- **Edición libre de mensajes**: no se permite editar el contenido. Solo marcar como erróneo (UPDATE flag + prefijo, idéntico a F3/F4).
- **Borrado de mensajes/anuncios**: bloqueado a todos (default DENY de DELETE).
- **Mute / archivar conversación**: Ola 2.
- **Búsqueda full-text**: Ola 2 (en Ola 1 hay scroll vertical + paginación implícita por fecha).
- **Reacciones / emojis**: Ola 2.
- **Indicadores "escribiendo…"**: Ola 2 (requiere ephemeral channel).
- **Recibos de lectura por mensaje individual**: en F5 el read-receipt es por conversación (timestamp `last_read_at`). Por mensaje queda para Ola 2 si se demanda.
- **Difusión cross-centro**: no aplica (NIDO es single-tenant en Ola 1, pero la arquitectura ya está preparada por `centro_id`).
- **Conversaciones tutor ↔ admin directas**: explícitamente fuera. La familia escala al profe; el profe escala al admin si procede.

## Comportamientos detallados

### B26 — Apertura del módulo de mensajería (lista)

**Pre-condiciones:**

- Usuario autenticado con rol `profe`, `tutor_legal`, `autorizado` o `admin`.

**Flujo:**

1. Ruta `/messages` carga server-side dos queries paralelas:
   - `get-conversaciones-del-usuario()` — devuelve todas las conversaciones donde el usuario es participante o admin observador, ordenadas por `last_message_at DESC`, con datos del niño (nombre, foto, aula) y conteo de no leídos (mensajes con `created_at > last_read_at` o sin fila en `lectura_conversacion`).
   - `get-anuncios-del-usuario()` — anuncios donde `usuario_es_audiencia_anuncio(id) = true`, ordenados por `created_at DESC`, con flag "leído" (existe fila en `lectura_anuncio` para ese usuario).
2. UI renderiza dos tabs: "Conversaciones" (por defecto) y "Anuncios". Contador en cada tab.
3. Click en un item → navega al detalle.
4. Subscription Realtime cliente sobre `mensajes` y `anuncios` para refrescar contadores sin recargar.

**Post-condiciones:**

- Badge global en navegación actualizado: suma de no leídos en conversaciones + anuncios.

### B27 — Apertura de una conversación

**Pre-condiciones:**

- Usuario es participante (`puede_participar_conversacion(conv) = true`) o admin del centro.

**Flujo:**

1. Ruta `/messages/conversacion/[id]` carga server-side:
   - Datos del niño (nombre, aula, foto, fecha_nacimiento para badge edad).
   - Lista de mensajes ordenados por `created_at ASC` (más antiguos arriba) paginados (50 por bloque, scroll hacia atrás carga más).
   - Autor de cada mensaje (nombre, rol).
2. Server action `marcar-conversacion-leida(id)` hace UPSERT en `lectura_conversacion` con `last_read_at = now()`.
3. Cliente abre subscription Realtime canal `conversacion-${id}` filtrada por `conversacion_id`. Cuando llega un mensaje nuevo:
   - Si la pestaña/ventana está activa, se hace UPSERT inmediato de `lectura_conversacion`.
   - Si no, el mensaje aparece pero el badge se incrementa.
4. Mensajes erróneos se renderizan tachados con badge "Anulado" (i18n `messages.estado.anulado`). Detección: campo `erroneo = true` o `contenido` empieza por `[anulado] `. Patrón idéntico a F3.

**Post-condiciones:**

- Conversación marcada como leída para este usuario hasta `now()`.
- Realtime sub activa mientras la pestaña esté montada.

### B28 — Envío de un mensaje (incluye auto-creación de conversación)

**Pre-condiciones:**

- Usuario es participante (profe del aula actual del niño O tutor con `puede_recibir_mensajes`).
- Si está en `/messages/conversacion/[id]`, la conversación ya existe.
- Si está creando por primera vez (botón "Escribir a la familia" en ficha del niño), la conversación se crea al vuelo.

**Flujo:**

1. Composer abajo: `<textarea>` (max 2000 chars) + botón "Enviar". Enter envía, Shift+Enter nueva línea, Ctrl+Enter alterna (móvil).
2. Submit → server action `enviar-mensaje(ninoId, contenido)`:
   1. Validación Zod (contenido no vacío, trim, max 2000).
   2. Lookup conversación existente para `nino_id`. Si no existe, INSERT atómico (`INSERT ... ON CONFLICT (nino_id) DO NOTHING`).
   3. INSERT en `mensajes` con `autor_id = auth.uid()`.
   4. Trigger BD actualiza `conversaciones.last_message_at = NEW.created_at`.
   5. Trigger audit graba INSERT.
   6. Resultado `{success: true, data: {mensaje, conversacion_id}}`.
3. Realtime propaga a todos los participantes y al admin observador.
4. En la UI del autor, el mensaje aparece optimistamente con estado "enviando" (latencia <300ms en condiciones normales) y pasa a "enviado" tras confirmar.

**Post-condiciones:**

- Mensaje persistido.
- Conversación creada si era el primer mensaje.
- Audit log con INSERT.
- Otros clientes ven el mensaje en vivo (RLS filtra notificaciones).

### B29 — Marcar mensaje como erróneo

**Pre-condiciones:**

- Usuario es el autor del mensaje (`autor_id = auth.uid()`).
- Mensaje no marcado ya como erróneo.

**Flujo:**

1. Sobre los mensajes propios aparece menú overflow con opción "Marcar como erróneo".
2. Modal de confirmación i18n (`messages.anular.confirm_title` / `confirm_descripcion` / `confirm_si` / `cancelar`).
3. Server action `marcar-mensaje-erroneo(id)`:
   1. UPDATE `mensajes SET erroneo = true, contenido = '[anulado] ' || contenido WHERE id = $1 AND autor_id = auth.uid() AND NOT erroneo`.
   2. RLS permite el UPDATE porque `autor_id = auth.uid()`. El server action enforza adicionalmente que **el único cambio aceptable es la anulación** (no se pueden editar otros campos).
   3. Idempotente: si ya está anulado, devuelve `{success: false, error: 'messages.errors.ya_anulado'}`.
   4. Trigger audit graba UPDATE con `valores_antes` y `valores_despues`.
4. Realtime propaga.

**Render visual del mensaje anulado:**

- Burbuja con `opacity-60` + `line-through` sobre el contenido (tras retirar el prefijo `[anulado] ` para el render).
- Badge `<Badge variant="muted">{t('messages.estado.anulado')}</Badge>`.
- No se puede des-anular desde UI.

**Post-condiciones:**

- Mensaje queda visible pero claramente marcado como inválido.
- Audit log conserva el contenido original.

### B30 — Vista admin: ver todas las conversaciones del centro

**Pre-condiciones:**

- Usuario con rol `admin` activo en el centro.

**Flujo:**

1. La lista de `/messages` para admin incluye **todas** las conversaciones del centro, no solo aquellas donde participa.
2. Cada conversación marca claramente el niño / aula / participantes.
3. Admin puede entrar a leer cualquier conversación (RLS de SELECT lo permite).
4. **Admin NO recibe badge de no leídos por defecto** sobre conversaciones donde no participa: las RLS de `lectura_conversacion` solo le permiten gestionar su propio marcador. Para evitar inflar el badge global con el centro entero, la query del badge cuenta solo conversaciones donde el usuario es **participante** (profe del aula actual del niño o tutor con permiso). Admin observador ve todas las conversaciones en la lista, pero el badge global solo contabiliza aquellas en las que el rol de admin coincide con un rol de participación (raro: admin que también es profe del aula).
5. Admin puede enviar mensajes en cualquier conversación del centro (RLS permite). Esto materializa el "salvo que decida intervenir" del scope.

**Post-condiciones:**

- Transparencia operativa sin ruido cognitivo: el admin ve todo pero no le pita todo.

### B31 — Familia sin permiso `puede_recibir_mensajes`

**Pre-condiciones:**

- Tutor con `vinculos_familiares.permisos.puede_recibir_mensajes = false` (caso típico: `autorizado` que solo recoge).

**Flujo:**

1. Al entrar en `/messages`:
   - **Tab Conversaciones**: query no devuelve conversaciones (RLS filtra: el usuario no es participante en ninguna).
   - **Tab Anuncios**: query no devuelve anuncios (helper `usuario_es_audiencia_anuncio` exige `puede_recibir_mensajes=true` también para anuncios `aula` y `centro`).
   - La UI muestra `EmptyState` con i18n `messages.sin_permiso.{title,description,cta_admin}` en **ambos tabs**.
2. Si intenta entrar por URL directa a `/messages/conversacion/[id]` o `/messages/anuncios/[id]`, RLS rechaza el SELECT y la página redirige a `/messages` con toast.
3. **El badge global de no leídos siempre es 0** para este usuario, porque las queries que lo alimentan están filtradas por las mismas RLS.

**Coherencia con el resto del producto:**

- `puede_recibir_mensajes` actúa como **flag único** del canal digital de mensajería entrante: si está a `false`, el tutor no aparece en ninguna lista (conversaciones, anuncios, badges) ni recibe ninguna notificación push futura (F5.5 leerá el mismo flag).
- La profe y el admin **sí** ven todos los anuncios de su ámbito. Funcionan como puente humano: si el centro publica un anuncio importante, la profe del aula del niño lo transmite en persona al tutor excluido (autorizado que solo recoge), o el admin contacta por canal privado fuera de la app.

**Post-condiciones:**

- Acceso completamente bloqueado al canal digital (chat + anuncios + badges) coherentemente con el resto del producto.

### B32 — Publicación de anuncio

**Pre-condiciones:**

- Usuario rol `profe` (puede publicar `ambito='aula'` solo en su aula) o `admin` (puede publicar `ambito='aula'` para cualquier aula del centro o `ambito='centro'` para el centro entero).

**Flujo:**

1. Ruta `/messages/nuevo-anuncio`. Form RHF + Zod:
   - **ámbito**: radio. Si rol profe, fijo `aula` (sin opción `centro`). Si admin, ambos.
   - **aula**: select. Visible si `ámbito='aula'`. Si profe, pre-seleccionada y deshabilitada con su aula activa. Si admin, lista todas las aulas del centro.
   - **título**: input (max 200).
   - **contenido**: textarea (max 4000).
2. Submit → server action `publicar-anuncio({ambito, aula_id?, titulo, contenido})`:
   1. Validación Zod (cross-field: `ambito='centro' ⇔ aula_id is null`, `ambito='aula' ⇔ aula_id requerida`).
   2. Si profe, valida que `aula_id` es su aula activa.
   3. INSERT en `anuncios`. RLS reverifica autorización.
   4. Trigger audit.
3. Redirección a `/messages/anuncios/[id]` con toast "Anuncio publicado".
4. Realtime broadcast.

**Post-condiciones:**

- Anuncio creado.
- Toda la audiencia lo ve aparecer en `/messages` tab Anuncios en vivo.
- Push notification queda pendiente (F5.5).

### B33 — Detalle de anuncio + read receipt

**Pre-condiciones:**

- `usuario_es_audiencia_anuncio(id) = true`.

**Flujo:**

1. Ruta `/messages/anuncios/[id]` carga el anuncio + autor + (si soy autor) lista de lectores.
2. Si no soy autor: server action `marcar-anuncio-leido(id)` hace `INSERT ... ON CONFLICT DO NOTHING` en `lectura_anuncio`.
3. Si soy autor: vista adicional "Lectura: N de M" donde M es el tamaño teórico de la audiencia calculado al renderizar (cuenta participantes únicos del aula o centro al momento). N es `COUNT(DISTINCT usuario_id) FROM lectura_anuncio WHERE anuncio_id = id`.

**Post-condiciones:**

- Anuncio marcado leído para este usuario.
- Autor ve cobertura.

### B34 — Marcar anuncio como erróneo

**Pre-condiciones:**

- Usuario es el autor del anuncio.

**Flujo:**

Idéntico a B29 pero sobre `anuncios.titulo` (se prefija `[anulado] ` al título; `erroneo = true`).

Render visual: card del anuncio con `opacity-60` + `line-through` sobre el título. Banner "Este anuncio ha sido anulado por su autor" arriba del contenido. El contenido permanece visible para preservar trazabilidad — la audiencia no debe quedarse con la duda de qué decía.

### B35 — Badge global de no leídos en navegación

**Pre-condiciones:**

- Usuario autenticado.

**Flujo:**

1. Layout principal monta un Client Component `<MessagingBadge>` que llama una query ligera `count-no-leidos()`:
   - Conversaciones: `COUNT(*) FROM mensajes m JOIN conversaciones c ON c.id = m.conversacion_id LEFT JOIN lectura_conversacion lc ON lc.usuario_id = auth.uid() AND lc.conversacion_id = c.id WHERE puede_participar_conversacion(c.id) AND m.autor_id != auth.uid() AND (lc.last_read_at IS NULL OR m.created_at > lc.last_read_at) AND NOT m.erroneo`.
   - Anuncios: `COUNT(*) FROM anuncios a WHERE usuario_es_audiencia_anuncio(a.id) AND a.autor_id != auth.uid() AND NOT a.erroneo AND NOT EXISTS (SELECT 1 FROM lectura_anuncio la WHERE la.anuncio_id = a.id AND la.usuario_id = auth.uid())`.
2. Subscription Realtime sobre `mensajes`, `anuncios`, `lectura_conversacion`, `lectura_anuncio` refresca el count incrementalmente.
3. Badge oculto si count = 0. Visible con "9+" si > 9.

**Post-condiciones:**

- Badge siempre coherente con el estado del usuario, sin recargas manuales.

### B36 — Concurrencia y orden

**Pre-condiciones:**

- Dos clientes (profe y tutor, o dos tutores legales del mismo niño) enviando mensajes simultáneamente.

**Flujo:**

- Cada `INSERT` en `mensajes` es independiente. El trigger `mensajes_after_insert_touch_conversacion` actualiza `last_message_at` con `NEW.created_at` solo si `NEW.created_at > conversaciones.last_message_at` (evita race que retroceda el cursor).
- Realtime entrega los eventos al receptor en el orden que llegan al servidor. El cliente los ordena por `created_at` antes de renderizar. Si llegan dos con el mismo `created_at` (microsegundos idénticos, raro), se desempata por `id` lexicográfico.
- No hay locks. No hay merge. Ganador implícito = orden de inserción Postgres.

### B37 — Realtime: cierre y reconexión

- Cada vista (`/messages`, conversación, anuncio) abre su propia subscription Supabase. El `useEffect` de cleanup desuscribe al desmontar.
- Si el navegador se va a background o pierde red, Supabase reintenta con backoff. Al volver, la UI recarga (`router.refresh()`) los mensajes recientes para llenar el gap. Patrón heredado de F3.

## Casos edge

- **Conversación nunca tuvo mensajes**: no existe en BD (auto-creación lazy). Si la profe quiere "iniciar conversación" desde la ficha del niño y no hay mensajes aún, el textarea está visible pero la conversación se crea **al pulsar enviar**. No hay placeholder en lista hasta ese momento.
- **Profe cambia de aula a mitad de día**: la profe saliente pierde acceso a las conversaciones de los niños que ya no son suyos (RLS reevalúa `es_profe_de_nino` dinámicamente, ADR-0024). La profe entrante gana acceso. Las conversaciones siguen siendo del **niño**, no de la profe.
- **Tutor pierde `puede_recibir_mensajes` a mitad de conversación**: en la próxima query/subscription Realtime ya no recibe nada — **ni mensajes ni anuncios**. Mensajes y anuncios en BD permanecen. Si vuelve a tener el permiso, vuelve a verlos íntegramente. La profe puede transmitir en persona lo que necesite mientras tanto.
- **Niño con dos tutores legales con permiso**: ambos participan en el mismo hilo. La profe ve los mensajes de ambos. Mensajes muestran el nombre del autor.
- **Niño soft-deleted** (`ninos.deleted_at IS NOT NULL`): las RLS de los helpers filtran. La conversación queda histórica pero inaccesible a profe/tutor; admin del centro la puede leer (audit/cumplimiento). El comportamiento en este caso queda **fuera del scope explícito de F5**: el flujo de soft-delete de niños es de Ola 2 (derecho al olvido funcional, F11).
- **Mensaje con solo espacios en blanco**: Zod rechaza tras `trim`.
- **Mensaje > 2000 chars**: Zod rechaza. UI muestra contador en vivo.
- **Anuncio profe con `ambito='centro'` o `aula_id` de otra aula**: RLS y server action lo rechazan. La UI no muestra estas opciones, pero defensa en profundidad.
- **Anuncio admin con `aula_id` de otro centro**: RLS rechaza por `pertenece_a_centro`.
- **Sin conexión**: server action devuelve error → toast i18n `messages.errors.conexion`. Subscription Realtime reintenta solo. Sin cola de envío offline en F5 (queda para Ola 2).
- **Cambio de día durante una conversación**: a diferencia de F3/F4, **no hay ventana de edición** en mensajería. Un mensaje enviado ayer sigue siendo enviable hoy (de hecho, una conversación es continua). El "marcar como erróneo" no tiene límite temporal: si te das cuenta una semana después, puedes anular tu propio mensaje.
- **Borrado físico de la conversación**: bloqueado a todos. Si el responsable del centro pide borrar contenido (RGPD), se hace por SQL `service_role` y queda en `audit_log`.
- **Borrado físico de un niño**: `conversaciones.nino_id` es `ON DELETE RESTRICT`. No se puede borrar el niño si tiene conversación. Soft delete (`ninos.deleted_at`) sí permitido y la conversación queda histórica.
- **Mensaje con HTML o XSS**: el contenido se renderiza como **texto plano** (`<p>{contenido}</p>` con escapado natural de React). No se interpreta markdown ni HTML. Si en Ola 2 se quiere bold/cursiva, se evaluará un subset seguro.
- **URLs en el contenido**: detección de enlaces con regex simple → renderizar `<a href="..." target="_blank" rel="noopener noreferrer nofollow">`. Solo `http:` y `https:` se linkifican.
- **Anuncio centro sin aulas activas**: caso raro (centro recién creado). El query de audiencia devuelve 0 lectores potenciales; el anuncio se crea pero nadie lo recibe. Sin tratamiento especial.
- **Realtime sobrecargado**: 1 canal por vista. Si el cliente abre `/messages`, abre **un solo canal** filtrado por `centro_id` que cubre todas las conversaciones del usuario. Al entrar en una conversación concreta, cierra el canal global y abre uno específico. Patrón heredado de F3.
- **Idiomas**: contenido de mensajes/anuncios se almacena tal cual escribe el autor. La UI (botones, badges, labels) sí está i18n. No hay traducción automática.
- **Audit log y derecho al olvido**: si la familia ejerce derecho al olvido, los mensajes se borran físicamente por SQL `service_role` (no soft delete — RGPD). El audit log conserva la traza del borrado pero **no** el contenido (la función trigger redacta `valores_antes` a `{"contenido": "[REDACTED-RGPD]"}` si se invoca con flag `service_role` específico). Esto último queda como TODO técnico para F11 (derecho al olvido funcional).

## Validaciones (Zod)

Schemas en `src/features/messaging/schemas/messaging.ts`:

```typescript
import { z } from 'zod'

// ENUMs
export const ambitoAnuncioEnum = z.enum(['aula', 'centro'])

// Helpers comunes
const contenidoMensajeSchema = z
  .string()
  .trim()
  .min(1, 'messages.validation.contenido_vacio')
  .max(2000, 'messages.validation.contenido_largo')

const tituloAnuncioSchema = z
  .string()
  .trim()
  .min(1, 'messages.validation.titulo_vacio')
  .max(200, 'messages.validation.titulo_largo')

const contenidoAnuncioSchema = z
  .string()
  .trim()
  .min(1, 'messages.validation.contenido_vacio')
  .max(4000, 'messages.validation.contenido_largo_anuncio')

// Mensaje (input al server action enviar-mensaje)
export const mensajeInputSchema = z.object({
  nino_id: z.string().uuid(),
  contenido: contenidoMensajeSchema,
})
export type MensajeInput = z.infer<typeof mensajeInputSchema>

// Anuncio (input al server action publicar-anuncio)
export const anuncioInputSchema = z
  .object({
    ambito: ambitoAnuncioEnum,
    aula_id: z.string().uuid().nullable(),
    titulo: tituloAnuncioSchema,
    contenido: contenidoAnuncioSchema,
  })
  .superRefine((v, ctx) => {
    if (v.ambito === 'aula' && !v.aula_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['aula_id'],
        message: 'messages.validation.aula_requerida',
      })
    }
    if (v.ambito === 'centro' && v.aula_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['aula_id'],
        message: 'messages.validation.aula_no_aplica_centro',
      })
    }
  })
export type AnuncioInput = z.infer<typeof anuncioInputSchema>

// Marcado como leído (server actions)
export const marcarConversacionLeidaSchema = z.object({
  conversacion_id: z.string().uuid(),
})

export const marcarAnuncioLeidoSchema = z.object({
  anuncio_id: z.string().uuid(),
})

// Marcar como erróneo
export const marcarMensajeErroneoSchema = z.object({
  mensaje_id: z.string().uuid(),
})

export const marcarAnuncioErroneoSchema = z.object({
  anuncio_id: z.string().uuid(),
})
```

Las server actions devuelven `{ success: true, data } | { success: false, error }`.

## Modelo de datos afectado

### Tablas nuevas

#### 1. `conversaciones` — un hilo por niño

```sql
CREATE TABLE public.conversaciones (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nino_id     uuid NOT NULL UNIQUE REFERENCES public.ninos(id) ON DELETE RESTRICT,
  centro_id   uuid NOT NULL REFERENCES public.centros(id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NULL
);
CREATE INDEX conversaciones_centro_last_msg_idx ON public.conversaciones (centro_id, last_message_at DESC NULLS LAST);
```

`centro_id` denormalizado para que las RLS y queries sean baratas sin JOIN a `ninos` (patrón ya usado en operativas). Se rellena con `centro_de_nino(nino_id)` en el INSERT (trigger BEFORE INSERT o por la server action — usar trigger para defensa en profundidad).

#### 2. `mensajes` — un mensaje dentro de una conversación

```sql
CREATE TABLE public.mensajes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversacion_id uuid NOT NULL REFERENCES public.conversaciones(id) ON DELETE CASCADE,
  autor_id        uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  contenido       text NOT NULL CHECK (length(contenido) <= 2000 + 11), -- 11 = length('[anulado] ')
  erroneo         boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mensajes_conv_created_idx ON public.mensajes (conversacion_id, created_at DESC);
```

`CHECK length(contenido) <= 2011` permite el prefijo `[anulado] ` sin chocar con el límite Zod de 2000. La validación de input "real" la hace Zod (2000 chars sin prefijo); el límite BD da margen para el marcado.

#### 3. `lectura_conversacion` — read-receipt por usuario

```sql
CREATE TABLE public.lectura_conversacion (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id      uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  conversacion_id uuid NOT NULL REFERENCES public.conversaciones(id) ON DELETE CASCADE,
  last_read_at    timestamptz NOT NULL,
  UNIQUE (usuario_id, conversacion_id)
);
```

UPSERT cada vez que el usuario abre la conversación o llega un mensaje y la pestaña está activa.

#### 4. `anuncios` — broadcasts unidireccionales

```sql
CREATE TYPE public.ambito_anuncio AS ENUM ('aula', 'centro');

CREATE TABLE public.anuncios (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  autor_id    uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  centro_id   uuid NOT NULL REFERENCES public.centros(id) ON DELETE RESTRICT,
  ambito      public.ambito_anuncio NOT NULL,
  aula_id     uuid NULL REFERENCES public.aulas(id) ON DELETE RESTRICT,
  titulo      text NOT NULL CHECK (length(titulo) <= 200 + 11),
  contenido   text NOT NULL CHECK (length(contenido) <= 4000),
  erroneo     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT anuncios_aula_segun_ambito CHECK (
    (ambito = 'aula'   AND aula_id IS NOT NULL) OR
    (ambito = 'centro' AND aula_id IS NULL)
  )
);
CREATE INDEX anuncios_centro_created_idx ON public.anuncios (centro_id, created_at DESC);
CREATE INDEX anuncios_aula_created_idx   ON public.anuncios (aula_id, created_at DESC) WHERE aula_id IS NOT NULL;
```

#### 5. `lectura_anuncio` — leído por usuario

```sql
CREATE TABLE public.lectura_anuncio (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id  uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  anuncio_id  uuid NOT NULL REFERENCES public.anuncios(id) ON DELETE CASCADE,
  leido_at    timestamptz NOT NULL,
  UNIQUE (usuario_id, anuncio_id)
);
```

INSERT idempotente al abrir.

### ENUMs nuevos

- `ambito_anuncio` (`aula`, `centro`).

### Triggers

```sql
-- 1) Rellenar conversaciones.centro_id automáticamente
CREATE OR REPLACE FUNCTION public.conversaciones_set_centro_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.centro_id IS NULL THEN
    NEW.centro_id := public.centro_de_nino(NEW.nino_id);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER conversaciones_set_centro_id_trg
  BEFORE INSERT ON public.conversaciones
  FOR EACH ROW EXECUTE FUNCTION public.conversaciones_set_centro_id();

-- 2) Actualizar last_message_at al insertar mensaje
CREATE OR REPLACE FUNCTION public.mensajes_touch_conversacion()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.conversaciones
     SET last_message_at = NEW.created_at,
         updated_at      = now()
   WHERE id = NEW.conversacion_id
     AND (last_message_at IS NULL OR NEW.created_at > last_message_at);
  RETURN NULL;
END;
$$;
CREATE TRIGGER mensajes_touch_conversacion_trg
  AFTER INSERT ON public.mensajes
  FOR EACH ROW EXECUTE FUNCTION public.mensajes_touch_conversacion();

-- 3) Trigger set_updated_at en conversaciones, mensajes, anuncios (helper ya existe en F2)

-- 4) Audit log: AFTER INSERT/UPDATE/DELETE en conversaciones, mensajes, anuncios
--    Extender audit_trigger_function() con branches para las 3 tablas nuevas
--    (lectura_* NO se audita).
```

### Tablas modificadas

Ninguna (el permiso `puede_recibir_mensajes` ya existe en `vinculos_familiares.permisos` desde F2).

### Tablas consultadas

- `vinculos_familiares` (vía `tiene_permiso_sobre`).
- `profes_aulas` (vía `es_profe_de_nino`).
- `roles_usuario` (vía `es_admin`, `pertenece_a_centro`).
- `ninos` (centro_id, nombre, foto, aula actual vía matrícula activa).
- `aulas`, `matriculas` (para listar audiencia de anuncios ámbito='aula' y ámbito='centro').

## Helpers SQL

```sql
-- Anti-recursión: lookup de centro desde id de conversación
CREATE OR REPLACE FUNCTION public.centro_de_conversacion(p_conversacion_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT centro_id FROM public.conversaciones WHERE id = p_conversacion_id;
$$;

-- Lookup de niño desde id de conversación
CREATE OR REPLACE FUNCTION public.nino_de_conversacion(p_conversacion_id uuid)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT nino_id FROM public.conversaciones WHERE id = p_conversacion_id;
$$;

-- ¿El usuario actual puede participar (leer/escribir) en esta conversación?
-- "Participar" = profe del aula actual del niño OR tutor con puede_recibir_mensajes OR admin del centro
CREATE OR REPLACE FUNCTION public.puede_participar_conversacion(p_conversacion_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversaciones c
    WHERE c.id = p_conversacion_id
      AND (
        public.es_admin(c.centro_id)
        OR public.es_profe_de_nino(c.nino_id)
        OR public.tiene_permiso_sobre(c.nino_id, 'puede_recibir_mensajes')
      )
  );
$$;

-- ¿El usuario actual es audiencia de este anuncio?
CREATE OR REPLACE FUNCTION public.usuario_es_audiencia_anuncio(p_anuncio_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a public.anuncios%ROWTYPE;
BEGIN
  SELECT * INTO a FROM public.anuncios WHERE id = p_anuncio_id;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Admin del centro siempre ve los anuncios del centro
  IF public.es_admin(a.centro_id) THEN
    RETURN TRUE;
  END IF;

  -- Autor del anuncio siempre ve su anuncio (defensa en profundidad; ya es admin/profe)
  IF a.autor_id = public.usuario_actual() THEN
    RETURN TRUE;
  END IF;

  -- Ámbito 'aula': profe del aula concreta o tutor con permiso de mensajes de un niño matriculado activamente en esa aula
  IF a.ambito = 'aula' THEN
    IF public.es_profe_de_aula(a.aula_id) THEN
      RETURN TRUE;
    END IF;
    RETURN EXISTS (
      SELECT 1
      FROM public.matriculas m
      JOIN public.vinculos_familiares vf ON vf.nino_id = m.nino_id
      WHERE m.aula_id = a.aula_id
        AND m.fecha_baja IS NULL
        AND vf.usuario_id = public.usuario_actual()
        AND vf.deleted_at IS NULL
        AND (vf.permisos->>'puede_recibir_mensajes')::boolean = true
    );
  END IF;

  -- Ámbito 'centro': profe activo en cualquier aula del centro, o tutor con permiso de mensajes
  -- de algún niño matriculado activamente en cualquier aula del centro
  IF a.ambito = 'centro' THEN
    -- Profe de cualquier aula activa del centro
    IF EXISTS (
      SELECT 1
      FROM public.profes_aulas pa
      JOIN public.aulas au ON au.id = pa.aula_id
      WHERE pa.usuario_id = public.usuario_actual()
        AND pa.fecha_fin IS NULL
        AND au.centro_id = a.centro_id
    ) THEN
      RETURN TRUE;
    END IF;
    -- Tutor con permiso de algún niño con matrícula activa en aula del centro
    RETURN EXISTS (
      SELECT 1
      FROM public.matriculas m
      JOIN public.aulas au ON au.id = m.aula_id
      JOIN public.vinculos_familiares vf ON vf.nino_id = m.nino_id
      WHERE au.centro_id = a.centro_id
        AND m.fecha_baja IS NULL
        AND vf.usuario_id = public.usuario_actual()
        AND vf.deleted_at IS NULL
        AND (vf.permisos->>'puede_recibir_mensajes')::boolean = true
    );
  END IF;

  RETURN FALSE;
END;
$$;
```

Todas con `LANGUAGE sql/plpgsql STABLE SECURITY DEFINER SET search_path = public`. Patrón consistente con ADR-0007.

## Políticas RLS

### `conversaciones`

```sql
ALTER TABLE public.conversaciones ENABLE ROW LEVEL SECURITY;

-- SELECT: participantes + admin del centro
CREATE POLICY conversaciones_select
  ON public.conversaciones FOR SELECT
  USING (
    public.es_admin(centro_id)
    OR public.es_profe_de_nino(nino_id)
    OR public.tiene_permiso_sobre(nino_id, 'puede_recibir_mensajes')
  );

-- INSERT: cualquier participante (la auto-creación se hace en el server action al enviar el primer mensaje).
-- centro_id se rellena por trigger BEFORE; el WITH CHECK valida que el invocador es participante del niño.
CREATE POLICY conversaciones_insert
  ON public.conversaciones FOR INSERT
  WITH CHECK (
    public.es_admin(public.centro_de_nino(nino_id))
    OR public.es_profe_de_nino(nino_id)
    OR public.tiene_permiso_sobre(nino_id, 'puede_recibir_mensajes')
  );

-- UPDATE: bloqueado a usuarios (last_message_at lo actualiza el trigger BD via SECURITY DEFINER, que bypassa RLS)
-- Sin policy de UPDATE → default DENY. El trigger AFTER INSERT mensajes hace su UPDATE como SECURITY DEFINER.

-- DELETE: nadie. Sin policy → default DENY.
```

### `mensajes`

```sql
ALTER TABLE public.mensajes ENABLE ROW LEVEL SECURITY;

CREATE POLICY mensajes_select
  ON public.mensajes FOR SELECT
  USING (public.puede_participar_conversacion(conversacion_id));

CREATE POLICY mensajes_insert
  ON public.mensajes FOR INSERT
  WITH CHECK (
    public.puede_participar_conversacion(conversacion_id)
    AND autor_id = public.usuario_actual()
  );

-- UPDATE: SOLO el autor, y la única columna que realmente cambia (el server action lo enforza) es erroneo=true + prefijo.
-- La RLS comprueba autoría + idempotencia ("no anular dos veces").
CREATE POLICY mensajes_update_autor
  ON public.mensajes FOR UPDATE
  USING (autor_id = public.usuario_actual())
  WITH CHECK (autor_id = public.usuario_actual());

-- DELETE: nadie. Sin policy → default DENY.
```

### `lectura_conversacion`

```sql
ALTER TABLE public.lectura_conversacion ENABLE ROW LEVEL SECURITY;

CREATE POLICY lectura_conv_select_self
  ON public.lectura_conversacion FOR SELECT
  USING (usuario_id = public.usuario_actual());

CREATE POLICY lectura_conv_insert_self
  ON public.lectura_conversacion FOR INSERT
  WITH CHECK (
    usuario_id = public.usuario_actual()
    AND public.puede_participar_conversacion(conversacion_id)
  );

CREATE POLICY lectura_conv_update_self
  ON public.lectura_conversacion FOR UPDATE
  USING (usuario_id = public.usuario_actual())
  WITH CHECK (usuario_id = public.usuario_actual());

-- DELETE: nadie.
```

### `anuncios`

```sql
ALTER TABLE public.anuncios ENABLE ROW LEVEL SECURITY;

CREATE POLICY anuncios_select
  ON public.anuncios FOR SELECT
  USING (public.usuario_es_audiencia_anuncio(id));

CREATE POLICY anuncios_insert
  ON public.anuncios FOR INSERT
  WITH CHECK (
    autor_id = public.usuario_actual()
    AND (
      -- Admin del centro: cualquier ámbito en su centro
      (public.es_admin(centro_id))
      -- Profe: solo ámbito='aula' en un aula donde es profe activo
      OR (
        ambito = 'aula'
        AND aula_id IS NOT NULL
        AND public.es_profe_de_aula(aula_id)
        AND public.centro_de_aula(aula_id) = centro_id
      )
    )
  );

CREATE POLICY anuncios_update_autor
  ON public.anuncios FOR UPDATE
  USING (autor_id = public.usuario_actual())
  WITH CHECK (autor_id = public.usuario_actual());

-- DELETE: nadie.
```

### `lectura_anuncio`

```sql
ALTER TABLE public.lectura_anuncio ENABLE ROW LEVEL SECURITY;

CREATE POLICY lectura_anuncio_select_self
  ON public.lectura_anuncio FOR SELECT
  USING (usuario_id = public.usuario_actual());

CREATE POLICY lectura_anuncio_insert_self
  ON public.lectura_anuncio FOR INSERT
  WITH CHECK (
    usuario_id = public.usuario_actual()
    AND public.usuario_es_audiencia_anuncio(anuncio_id)
  );

-- UPDATE, DELETE: nadie.
```

> **Nota sobre `conversaciones.UPDATE`**: la política es **ausencia explícita de política de UPDATE**. La actualización de `last_message_at` la hace el trigger `mensajes_touch_conversacion` como `SECURITY DEFINER`, que bypassa RLS por definición. Esto evita que un usuario con SQL crudo pueda renombrar `centro_id` o `nino_id` de una conversación. Defensa en profundidad sin gymnastics.

### Realtime

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE
  public.mensajes,
  public.anuncios;
```

`conversaciones`, `lectura_*` **NO** se publican en Realtime. Las actualizaciones se infieren del lado cliente desde los cambios de `mensajes`/`anuncios` (el cliente ya sabe en qué conversación está y reordena lista localmente).

Las RLS de `SELECT` se aplican también a las notificaciones Realtime — Supabase descarta eventos sobre filas que el rol del cliente no podría leer. Filtrado client-side por `conversacion_id` o `aula_id` es cosmético (igual que F3).

## Audit log

Extender `audit_trigger_function()` con branches:

```sql
ELSIF TG_TABLE_NAME = 'conversaciones' THEN
  v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
ELSIF TG_TABLE_NAME = 'mensajes' THEN
  v_centro_id := public.centro_de_conversacion(COALESCE((NEW).conversacion_id, (OLD).conversacion_id));
ELSIF TG_TABLE_NAME = 'anuncios' THEN
  v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
```

Aplicar trigger `AFTER INSERT OR UPDATE OR DELETE EXECUTE FUNCTION audit_trigger_function()` en `conversaciones`, `mensajes`, `anuncios`. DELETE no se ejecuta nunca por RLS, pero se deja registrado por completitud (si un día se ejecuta vía `service_role`, queda traza).

`lectura_conversacion` y `lectura_anuncio` **NO** se auditan: son telemetría de usuario, no contenido. Recursos limitados, no aporta valor RGPD ni operativo.

## Pantallas y rutas

- **`/messages`** — lista combinada con tabs Conversaciones / Anuncios. Default tab según último uso (cookie en cliente).
- **`/messages/conversacion/[id]`** — hilo bidireccional. Composer al pie, lista scrollable, header con datos del niño.
- **`/messages/anuncios/[id]`** — detalle del anuncio. Lectores (si soy autor). Botón "Marcar como erróneo" (si soy autor).
- **`/messages/nuevo-anuncio`** — composer del anuncio.
- En la ficha del niño (`/family/nino/[id]` y `/teacher/aula/[id]/nino/[ninoId]`) añadir botón "Escribir a la familia" / "Escribir a la profe" que abre o crea la conversación correspondiente.

Las rutas viven bajo el grupo `[locale]` (i18n). El layout principal añade un `<MessagingBadge>` en la sidebar/header (componente Client).

## Componentes UI

`src/features/messaging/components/`:

- `MessagingLayout.tsx` (Server) — wrapper de `/messages/*`.
- `MessagesListClient.tsx` (Client) — tabs Conversaciones/Anuncios + lista + subscription Realtime para refresco de badge.
- `ConversacionItem.tsx` (Server-friendly) — card en la lista (foto del niño + último mensaje + badge no leídos + hora).
- `AnuncioItem.tsx` (Server-friendly) — card en la lista (icono + título + flag leído + ámbito + autor + fecha).
- `ConversacionViewClient.tsx` (Client) — hilo + composer + subscription Realtime.
- `MensajeBurbuja.tsx` (Client-friendly) — burbuja con render de erróneo.
- `MensajeComposer.tsx` (Client) — textarea + envío + autosize.
- `AnuncioViewClient.tsx` (Client) — detalle + read receipts.
- `AnuncioComposer.tsx` (Client) — form del nuevo anuncio (RHF + Zod).
- `MessagingBadge.tsx` (Client) — badge global de no leídos en sidebar.
- `SinPermisoMensajes.tsx` (Server) — empty state cuando no hay `puede_recibir_mensajes`.

## Eventos y notificaciones

- **Push notifications**: NO en F5. Llega en F5.5 (módulo transversal: registro de `push_subscriptions`, edge function `notify-on-message-or-anuncio`, integración con OneSignal/Web Push). Ver ADR-0025.
- **Audit log**: automático en `conversaciones`, `mensajes`, `anuncios`.
- **Realtime**: `mensajes` y `anuncios` publicados; RLS filtra.
- **Telemetría custom** (sin PII):
  - `messaging_conv_abierta { aula_id, rol }`
  - `messaging_mensaje_enviado { rol }`
  - `messaging_mensaje_anulado { rol }`
  - `messaging_anuncio_publicado { ambito, rol }`
  - `messaging_anuncio_leido { ambito }`

## i18n

Namespace nuevo `messages.*` en `messages/{es,en,va}.json`. Extracto en español:

```json
{
  "messages": {
    "title": "Mensajería",
    "tabs": { "conversaciones": "Conversaciones", "anuncios": "Anuncios" },
    "lista": {
      "vacia_conversaciones": "Aún no tienes conversaciones.",
      "vacia_anuncios": "Sin anuncios por ahora."
    },
    "conversacion": {
      "title": "Conversación con la familia de {nombre}",
      "sin_mensajes": "Empieza la conversación escribiendo abajo.",
      "composer_placeholder": "Escribe tu mensaje…",
      "enviar": "Enviar",
      "contador": "{n} de {max} caracteres",
      "yo": "Tú",
      "rol_profe": "Profe",
      "rol_tutor": "Familia",
      "rol_admin": "Dirección"
    },
    "anuncio": {
      "nuevo": "Nuevo anuncio",
      "ambito": { "aula": "Aula", "centro": "Centro" },
      "campos": {
        "ambito": "Ámbito",
        "aula": "Aula",
        "titulo": "Título",
        "contenido": "Contenido"
      },
      "lectores": "Leído por {n} de {total}",
      "publicar": "Publicar",
      "publicado_toast": "Anuncio publicado",
      "ver_lectores": "Ver lectores"
    },
    "anular": {
      "boton": "Marcar como erróneo",
      "confirm_title": "Marcar como erróneo",
      "confirm_descripcion": "Quedará tachado y visible para todos como anulado. No se puede deshacer desde la app. ¿Continuar?",
      "confirm_si": "Sí, marcar como erróneo",
      "cancelar": "Cancelar"
    },
    "estado": { "anulado": "Anulado" },
    "sin_permiso": {
      "title": "No tienes permiso para usar la mensajería",
      "description": "Pide al administrador del centro que te lo active.",
      "cta_admin": "Contactar con el administrador"
    },
    "validation": {
      "contenido_vacio": "Escribe algo antes de enviar.",
      "contenido_largo": "Máximo 2000 caracteres.",
      "contenido_largo_anuncio": "Máximo 4000 caracteres.",
      "titulo_vacio": "El título es obligatorio.",
      "titulo_largo": "Máximo 200 caracteres.",
      "aula_requerida": "Selecciona un aula.",
      "aula_no_aplica_centro": "El ámbito centro no lleva aula."
    },
    "errors": {
      "envio_fallo": "No se pudo enviar. Inténtalo de nuevo.",
      "ya_anulado": "Este mensaje ya estaba anulado.",
      "no_autorizado": "No tienes acceso a esta conversación.",
      "conexion": "Sin conexión. Reintentando…"
    }
  }
}
```

Lint i18n (configurado en F0): cero `messages.*` faltantes en `en` y `va`.

## Accesibilidad

- Tabs: `role="tablist"` + `role="tab"` con `aria-selected` y `aria-controls`.
- Lista de mensajes: `role="log"` + `aria-live="polite"` para anunciar mensajes nuevos al lector.
- Composer: `<label>` asociado al textarea; contador con `aria-live="polite"`.
- Burbujas: distinción semántica además de visual (icono + nombre del autor + hora), no solo color.
- Burbuja anulada: `aria-label` con prefijo "Mensaje anulado: ..." para que el lector lo anuncie claramente.
- Badge de no leídos: `aria-label` traducido ("{n} mensajes sin leer").
- axe-core: 0 violations en las 4 rutas.

## Performance

- Query principal `/messages` (lista conversaciones del usuario): 1 query con CTE para conteos, usando los índices `(centro_id, last_message_at)` y `(conversacion_id, created_at DESC)`. Objetivo: < 100ms p95 con 100 conversaciones.
- Query principal `/messages/conversacion/[id]`: 1 SELECT con LIMIT 50 + index `(conversacion_id, created_at DESC)`. Scroll inverso carga bloques de 50 con `created_at < cursor`.
- Bundle:
  - `/messages` ~ 60KB JS (lista + Realtime).
  - `/messages/conversacion/[id]` ~ 90KB JS (hilo + composer + Realtime).
- Realtime: máximo 2 canales simultáneos por sesión (lista + conversación activa).
- Lighthouse > 90 en performance y accesibilidad en las 4 rutas.

## Telemetría

Ver "Eventos y notificaciones". Sin PII (sin `nino_id`, sin `usuario_id`, sin texto del mensaje).

## Tests requeridos

### Vitest (unit/integration)

- [ ] `messaging.schema.test.ts` — `mensajeInputSchema`, `anuncioInputSchema` (cross-field ámbito ↔ aula), boundaries (1, 2000, 2001, 200, 201, 4000, 4001), trim, espacios.
- [ ] `messaging.action.test.ts` — server actions devuelven `Result`; auto-creación de conversación idempotente; rechazo a duplicar marcado erróneo; rechazo a editar contenido (solo el flag y el prefijo son aceptados).

### Vitest (RLS) — `src/test/rls/messaging.rls.test.ts` — **mínimo 10**:

- [ ] **t01** Tutor sin `puede_recibir_mensajes` NO ve conversaciones de su niño (SELECT vacío).
- [ ] **t02** Tutor de niño A NO ve conversaciones de niño B (otro tutor legal con permiso ajeno).
- [ ] **t03** Profe de aula A NO ve conversaciones de aula B del mismo centro.
- [ ] **t04** Profe de centro X NO ve conversaciones de centro Y.
- [ ] **t05** Admin del centro ve **todas** las conversaciones del centro.
- [ ] **t06** Profe del aula del niño puede INSERT en `mensajes` con su `autor_id = auth.uid()`.
- [ ] **t07** Tutor con `puede_recibir_mensajes` puede INSERT en `mensajes`.
- [ ] **t08** Usuario NO puede INSERT en `mensajes` con `autor_id != auth.uid()` (suplantación rechazada).
- [ ] **t09** Profe NO puede INSERT anuncio con `ambito='centro'` (solo admin).
- [ ] **t10** Profe NO puede INSERT anuncio con `aula_id` de un aula que no es la suya.
- [ ] **t11** Profe NO puede INSERT anuncio con `aula_id` de otro centro (RLS rechaza vía `centro_de_aula(aula_id) = centro_id`).
- [ ] **t12** Admin puede INSERT anuncio `ambito='centro'` sin `aula_id`.
- [ ] **t13** Admin puede INSERT anuncio `ambito='aula'` con `aula_id` de su centro.
- [ ] **t14** Tutor de un niño del aula recibe el anuncio `ambito='aula'` correspondiente.
- [ ] **t15** Tutor con `puede_recibir_mensajes` recibe el anuncio `ambito='centro'` si su niño está matriculado en alguna aula.
- [ ] **t16** Tutor sin `puede_recibir_mensajes` NO recibe ningún anuncio (audiencia vacía).
- [ ] **t17** DELETE bloqueado en las 5 tablas para todos los roles (admin incluido).
- [ ] **t18** UPDATE de `mensajes` por un usuario que no es el autor: rechazado.
- [ ] **t19** UPDATE de `conversaciones` por cualquier rol normal: rechazado (sin policy, default DENY).
- [ ] **t20** `lectura_conversacion`: usuario A NO puede insertar fila con `usuario_id = B`.

### Vitest (helpers) — `src/test/rls/messaging-helpers.test.ts` — **mínimo 3**:

- [ ] `puede_participar_conversacion(conv)` para profe del aula del niño → true; para profe de otra aula del mismo centro → false; para tutor con/sin permiso → true/false; para admin del centro → true.
- [ ] `usuario_es_audiencia_anuncio(anuncio)` con ámbito `aula`: profe del aula → true; tutor con permiso de niño matriculado → true; tutor sin permiso → false; profe de otra aula → false; admin del centro → true.
- [ ] `usuario_es_audiencia_anuncio(anuncio)` con ámbito `centro`: profe activo en cualquier aula del centro → true; tutor con permiso de niño matriculado en cualquier aula → true; tutor sin permiso → false; admin → true; usuario de otro centro → false.

### Vitest (audit) — `src/test/audit/messaging-audit.test.ts`:

- [ ] INSERT en `mensajes` genera fila en `audit_log` con `accion='INSERT'`, `tabla='mensajes'`, `centro_id` correcto (derivado vía `centro_de_conversacion`), `valores_despues` JSONB contiene `contenido` y `autor_id`.
- [ ] UPDATE en `mensajes` (marcar erróneo) registra `valores_antes` con `erroneo=false` y `valores_despues` con `erroneo=true` y prefijo en `contenido`.
- [ ] INSERT en `anuncios` genera fila con `centro_id` correcto.

### Playwright (E2E) — `e2e/messaging.spec.ts` — **mínimo 3**:

- [ ] **mensaje-realtime**: profe en aula A abre la conversación del niño X (creándola al enviar el primer mensaje). En contexto Playwright secundario, tutor del niño X ve aparecer el mensaje sin recargar y el badge global pasa de 0 a 1.
- [ ] **anuncio-aula**: profe del aula A publica anuncio `ambito='aula'`. Tutor de niño A en otra ventana ve el anuncio aparecer en `/messages` tab Anuncios sin recargar. Tutor de niño en aula B (mismo centro) NO lo ve.
- [ ] **leer-baja-badge**: tutor con un mensaje no leído ve badge=1; al abrir la conversación, el badge baja a 0 sin recargar (vía Realtime de `lectura_conversacion` + recálculo client-side).

## Criterios de aceptación

- [ ] Todos los tests Vitest + Playwright en CI verde.
- [ ] Lighthouse > 90 (performance + accesibilidad) en `/messages`, `/messages/conversacion/[id]`, `/messages/anuncios/[id]`, `/messages/nuevo-anuncio`.
- [ ] axe-core sin violations en las 4 rutas.
- [ ] 100% claves i18n en es/en/va; lint i18n verde.
- [ ] Realtime verificado en preview Vercel antes de mergear (smoke manual en Checkpoint C: dos navegadores simultáneos, un mensaje aparece en vivo).
- [ ] Audit log captura INSERT/UPDATE de `conversaciones`, `mensajes`, `anuncios` con `centro_id` correcto.
- [ ] ADRs 0023, 0024, 0025 escritos.
- [ ] `docs/architecture/data-model.md` actualizado: añadir las 5 tablas, marcar Fase 5 como ✅, mover `notificaciones_push` / `push_subscriptions` a F5.5 explícitamente.
- [ ] `docs/architecture/rls-policies.md` actualizado: sección "Mensajería (Fase 5)" con helpers y patrón.
- [ ] `CLAUDE.md` actualizado: línea de modelo de datos cuenta correcta (21 → 26 tablas implementadas).
- [ ] Entrada en `docs/journey/progress.md` con Fase 5 cerrada.

## Decisiones técnicas relevantes

- **ADR-0023 — Modelo de mensajería con 5 tablas separadas (conversaciones vs anuncios)**.
  - Por qué no una sola tabla `comunicaciones` con un discriminador: los dos flujos tienen políticas RLS distintas (audiencia calculada vs participantes), índices distintos (por `conversacion_id` vs por `aula_id`/`centro_id`), forma de la UI distinta (chat scroll vs cards de lectura), y restricciones distintas (DELETE bloqueado en ambas, pero UPDATE en `mensajes` solo autor, en `anuncios` solo autor también pero con CHECK de ámbito). Unificarlos crearía una tabla con muchas columnas nullable y políticas RLS llenas de OR ramificados. Separar es más limpio.
  - Alternativa rechazada: anuncios como caso especial de mensajes (autor=admin/profe, audiencia computada). Compleja en RLS y trae problemas de Realtime (cada cliente recibe eventos que no le interesan).
  - Coste: 5 tablas + 1 ENUM + 4 helpers vs 1 tabla. Aceptable.

- **ADR-0024 — Participantes y audiencia calculados dinámicamente (no persistidos)**.
  - Por qué no `conversacion_participantes` con filas explícitas: la profe cambia de aula durante el curso; los tutores pueden ver/perder `puede_recibir_mensajes`. Persistir participantes implicaría procesos de mantenimiento (triggers cuando cambia `profes_aulas` o `vinculos_familiares`) para insertar/borrar filas, y dejaría filas zombi si algo se olvida. Calcular dinámicamente vía helpers `SECURITY DEFINER` es más simple y siempre coherente con el estado actual.
  - Coste: cada query RLS evalúa helpers. Índices en `profes_aulas (usuario_id, fecha_fin)` y `vinculos_familiares (usuario_id, nino_id)` mantienen el coste bajo. ANAIA tendrá <200 vínculos y <30 profes activos a la vez; no es problema de performance.
  - Trade-off explícito: si en Ola 2 un caso de uso pide "histórico de quién participó en cada conversación", se añadirá una tabla append-only de eventos de membresía sin tocar la lógica de runtime.

- **ADR-0025 — Push notifications fuera de F5 (módulo transversal en F5.5)**.
  - Por qué no en F5: push es transversal a mensajería, recordatorios (F6), eventos (F7), autorizaciones (F8), informes (F9), publicaciones (F10). Implementarlo como módulo "messaging-only" haría que F6+ tengan que rehacerlo. Mejor extraer F5.5 como módulo transversal que sirve a las 6 fases.
  - Componentes de F5.5 (no de F5): `push_subscriptions` table, `notificaciones_push` table, edge function `notify-on-event`, integración Web Push API + OneSignal para nativo, registros de service worker en cliente, opt-in/opt-out UI.
  - Decisión: F5 termina con badge in-app vivo y sin push. F5.5 añade push retroactivamente sobre mensajes/anuncios + nuevos triggers para F6/F7/F8.

## Referencias

- ADR-0006 — Permisos granulares JSONB en `vinculos_familiares` (la clave `puede_recibir_mensajes` se activa en F5).
- ADR-0007 — RLS recursion avoidance (patrón helpers `SECURITY DEFINER` para lookups cruzados).
- ADR-0011 — Timezone Madrid (no aplica en F5; aquí no hay ventana de edición temporal).
- ADR-0013 / ADR-0016 — "Día cerrado" en operativas (F5 NO sigue este patrón: la mensajería es continua).
- Spec `daily-agenda.md` § B18 — patrón "marcar como erróneo" (UPDATE + prefijo `[anulado] ` + flag, sin DELETE). F5 lo reutiliza con `erroneo boolean` explícito.
- Spec `daily-agenda.md` — patrón Realtime + RLS + audit.
- Spec `attendance.md` — patrón ausencias y prefijo `[cancelada] ` (paralelo al `[anulado] ` de mensajes).

---

**Workflow:**

1. Spec en estado `draft`.
2. Responsable revisa y aprueba (→ `approved`). ← **Checkpoint A**.
3. Migración + tests RLS + tests helpers + tests audit + Vitest schemas. Migración mostrada antes de aplicar. ← **Checkpoint B**.
4. Server actions + queries + UI (4 rutas + composer + badge) + i18n trilingüe + Playwright + ADRs + docs. ← **Checkpoint C** (pre-merge).
5. PR draft → preview verde → merge a `main` (responsable hace el merge).
