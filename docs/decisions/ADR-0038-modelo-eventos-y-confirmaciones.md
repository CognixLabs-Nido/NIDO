# ADR-0038: Modelo de eventos y confirmaciones de asistencia (cierre F7)

## Estado

`accepted`

**Fecha:** 2026-06-01
**Aceptado:** 2026-06-02 (decisiones tomadas; fase cerrada)
**Autores:** responsable + claude-code
**Fase del proyecto:** Fase 7 — Calendario y eventos (**lean**)

## Contexto

F7 añade un **calendario de eventos** sobre el calendario laboral de F4.5a:
excursiones, reuniones, fiestas, vacaciones y "otros", con **confirmación de
asistencia** opcional por parte de las familias. Queda **lean** por decisión de
alcance (`scope-ola-1.md`): solo eventos + confirmaciones; la **reserva de
franjas para tutorías** se mueve a Ola 3.

Fuerzas en juego:

- **Reuso máximo, cero duplicación.** F4.5a aporta el `<CalendarioMensual/>` y el
  coloreado de `dias_centro`; F6-C aporta el motor de audiencia push
  (`expandirDestinatariosRecordatorio`) y el patrón de roles emisor/receptor;
  F5/F5.5 aportan `enviarPushANotificarUsuarios`. F7 debe apoyarse en todo eso.
- **Coherencia con los patrones del proyecto:** RLS default-DENY con helpers
  `SECURITY DEFINER`, row-aware contra el gotcha MVCC en `INSERT…RETURNING`,
  cancelación por estado en vez de DELETE, `centro_id` redundante, audit en
  tablas de contenido y NO en telemetría.
- **Límite RGPD:** la confirmación de F7 es **asistencia ligera**, no una
  autorización legal con firma — esa línea es F8. F7 no debe cruzarla.

La spec `docs/specs/f7-calendario.md` (Checkpoint A) dejó 13 decisiones abiertas
(D1–D13); el Checkpoint B las cerró e implementó. Este ADR las registra junto al
modelo de datos resultante y dos refinamientos surgidos en revisión post-B.

**Re-encuadre (al cerrar):** la revisión de F7 detectó que el alcance original
mezclaba **dos productos** en la tabla `eventos`: la **difusión** (un centro/aula
anuncia algo a su audiencia, con confirmación opcional) y la **invitación** (un
organizador convoca a personas concretas y espera un RSVP individual: reuniones
con padres/claustro, visitas comerciales, citas de nueva matrícula). F7 cierra
como **solo la capa de difusión** (eventos/calendario); la agenda de invitaciones
se saca a una **fase propia** con modelo nuevo. Esto cierra el Eje 4 (abajo) y
queda especificado en `docs/specs/f7a-calendario-agenda.md` (Checkpoint A, PR #50).

## Opciones consideradas

Las decisiones D1–D13 cubren muchos ejes; aquí se documentan los tres con
trade-off real. El resto se listan en **Decisión**.

### Eje 1 — Granularidad de la confirmación (D2)

**Opción A: por familia** — UNIQUE `(evento_id, usuario_id)`. Un tutor confirma
"yo voy/no voy".
**Opción B: por niño** — UNIQUE `(evento_id, nino_id)` con `confirmado_por`.
Cualquier tutor del niño confirma por él, last-write-wins.

- A es más simple pero no responde la pregunta real del centro ("¿qué **niños**
  vienen a la excursión?") y se rompe con dos tutores que responden distinto.
- B modela el dato útil (asistencia del niño), tolera multi-tutor con
  last-write-wins y deja traza de quién respondió.

### Eje 2 — Mecanismo de cancelación (D7)

**Opción A: DELETE** de la fila.
**Opción B: ENUM `evento_estado` (`programado`/`cancelado`)** + push a quien ya
había confirmado.

- A pierde el histórico, rompe FKs de confirmaciones y va contra el patrón del
  proyecto (DELETE bloqueado en todas las tablas de contenido).
- B conserva la fila (se muestra tachada), avisa a las familias que contaban con
  ir (no es un flip silencioso) y es coherente con `[anulado]`/`[cancelada]` de
  F5/F4. Introduce un 4.º ENUM además de los 3 de la spec, asumido como el modo
  correcto de materializar el estado.

### Eje 3 — Re-notificación al editar (refinamiento post-B)

**Opción A: notificar siempre** (cualquier edición empuja push a la audiencia,
indiferenciado del alta).
**Opción B: notificar solo en cambio material** (`fecha`, `fecha_fin`,
`hora_inicio`, `hora_fin`, `lugar`) con copy y categoría propios.

- A es lo que dejó el Checkpoint B: simple, pero ruidoso (una corrección de
  título empuja push a todo el centro) e indistinguible de un evento nuevo.
- B silencia el typo, solo molesta a las familias cuando cambia el **cuándo/dónde**
  acudir, y diferencia el mensaje ("Evento actualizado: …", `tipo:
'evento_actualizado'`).

### Eje 4 — ¿`eventos` debe cubrir también la agenda de invitaciones?

**Opción A: una sola tabla `eventos`** que sirva difusión **e** invitaciones
(reuniones/visitas), con la "audiencia" haciendo doble función.
**Opción B: separar** — `eventos` cubre solo difusión; la agenda de invitaciones
va a una **fase y modelo propios** (invitados nominales + RSVP por persona).

- A fuerza un modelo de audiencia por ámbito (centro/aula/niño) sobre un caso que
  es nominal (invito a personas concretas), sin "lo que organizo vs lo que me
  invitan", sin RSVP por invitado, sin vistas día/semana. Acopla dos productos.
- B mantiene `eventos` simple y correcto para difusión, y deja la invitación para
  un modelo diseñado para ella. Coste: una fase más; un valor de ENUM (`reunion`)
  queda sin uso en `tipo_evento`.

## Decisión

**Se cierra F7 con el modelo de 2 tablas + 4 ENUMs descrito abajo, eligiendo la
Opción B en los tres ejes** (confirmación por niño; cancelación por estado;
re-notificación solo en cambio material). Justificación: las tres B modelan el
dato realmente útil para el centro y son coherentes con patrones ya asentados
(estado vs DELETE como en F5/F4; audiencia y roles como en F6-C), a cambio de un
ENUM extra y una comparación de campos previos en el server action — coste
marginal frente al valor.

### Modelo de datos

- **ENUMs (4):** `ambito_evento` (`centro`/`aula`/`nino`), `tipo_evento`
  (`excursion`/`reunion`/`fiesta`/`vacaciones`/`otro`, **D1**), `evento_estado`
  (`programado`/`cancelado`, **D7**), `confirmacion_estado`
  (`pendiente`/`confirmado`/`rechazado`, **D9**).
- **`eventos`:** `centro_id` (redundante, derivado por trigger), `ambito`,
  `aula_id` NULL, `nino_id` NULL, `tipo`, `titulo` (1..200), `descripcion`,
  `lugar` NULL, `fecha`, `fecha_fin` NULL (CHECK `>= fecha`, **D6**),
  `hora_inicio`/`hora_fin` NULL (**D5**), `requiere_confirmacion`, `estado`,
  `creado_por`. CHECK estructural `eventos_ambito_coherencia` (cada ámbito lleva
  exactamente su referencia). Trigger `eventos_set_centro_id` BEFORE INSERT (red
  de seguridad; el server action ya lo resuelve explícito, sin sentinela).
- **`confirmaciones_evento`:** `evento_id`, `nino_id`, `estado`
  (`confirmado`/`rechazado`; `pendiente` = ausencia de fila), `confirmado_por`,
  `confirmado_at`, `comentario`. UNIQUE `(evento_id, nino_id)` (**D2**), CHECK
  `estado <> 'pendiente'`.

### Decisiones D1–D13 (cerradas)

| #   | Decisión                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------- |
| D1  | Tipos: `excursion`/`reunion`/`fiesta`/`vacaciones`/`otro`.                                                                |
| D2  | Confirmación **por niño**, UNIQUE `(evento_id, nino_id)` + `confirmado_por`/`confirmado_at`; cualquier tutor, LWW.        |
| D3  | Sin multi-aula: un evento de aula apunta a 1 aula.                                                                        |
| D4  | Push respeta `puede_recibir_mensajes` (vía `expandirDestinatariosRecordatorio`).                                          |
| D5  | `lugar` y `hora` (inicio/fin) opcionales **SÍ**; adjuntos **NO** (Storage es F10).                                        |
| D6  | Rango: `fecha_fin` nullable (CHECK `>= fecha`).                                                                           |
| D7  | Cancelación: `estado='cancelado'` (no DELETE) + **push a quien ya había confirmado**.                                     |
| D8  | Edita/cancela: el **autor o un admin** del centro.                                                                        |
| D9  | Confirmación 3 estados (`pendiente`/`confirmado`/`rechazado`); `pendiente` = sin fila.                                    |
| D10 | Overlay sobre `/calendario` (reusa F4.5a). Sin ruta `/eventos` separada.                                                  |
| D11 | Sin Realtime (fuera del LEAN).                                                                                            |
| D12 | Ventana de confirmación: hasta la **fecha (inicio)** del evento, inclusive.                                               |
| D13 | `confirmaciones_evento` **NO se audita** (telemetría, como `lectura_*`/`push_subscriptions`). `eventos` **sí** se audita. |

> **Límite RGPD (D13):** la confirmación es asistencia ligera, **no** autorización
> legal — sin firma, sin tratarse como consentimiento. Eso es F8. F7 no cruza esa
> línea.

### RLS (resumen)

- **Helper row-aware** `usuario_es_audiencia_evento_row(centro_id, ambito, aula_id,
nino_id)` para `eventos_select` (evita el gotcha MVCC en `INSERT…RETURNING`).
- `eventos_insert`: admin cualquier ámbito; profe solo `aula` de su aula
  (`creado_por = auth.uid()`). `eventos_update`: autor **o** admin (D8), `USING +
WITH CHECK` simétricos. DELETE → default DENY (D7).
- `confirmaciones_*`: SELECT tutor/profe/admin de la audiencia; INSERT/UPDATE solo
  tutor del niño + `evento_aplica_a_nino(evento_id, nino_id)` + `confirmado_por =
auth.uid()`.
- Audit: rama nueva `eventos` en `audit_trigger_function` (`centro_id` directo);
  `confirmaciones_evento` no auditada.

### Refinamientos post-Checkpoint B

1. **Cancelar gateado a autor-o-admin (D8).** El botón "Cancelar evento" se
   mostraba a todo el staff aunque la RLS de `eventos_update` solo deja cancelar
   al autor o admin; un profe no-autor lo veía y la acción se rechazaba. Ahora
   editar y cancelar comparten `puedeGestionar = (esAdmin || es_autor) &&
!cancelado`; como ese gate implica staff, se eliminó el prop `esStaff`
   (muerto) del diálogo, el calendario y las 3 rutas. `es_autor` se deriva en
   `getEventoDetalle`.
2. **Edición re-notifica solo en cambio material, con copy propio.**
   `editarEvento` lee el estado previo y solo empuja push si cambió `fecha`,
   `fecha_fin`, `hora_inicio`, `hora_fin` o `lugar` (`huboCambioMaterial`, con
   normalización `HH:MM:SS`↔`HH:MM`); título/descripción/tipo **no** notifican.
   `notificarEdicionEvento` usa `tipo: 'evento_actualizado'` y cuerpo
   `eventos.push.actualizado` ("Evento actualizado: …", i18n es/en/va, traducido
   al idioma del autor). El envío a la audiencia se extrajo a un único helper,
   compartido con el alta.

## Re-encuadre: la Agenda sale a fase propia (Eje 4)

**Se elige la Opción B del Eje 4.** F7 queda definida como **la capa de
difusión** (calendario escolar: `eventos` + `confirmaciones_evento`). La **agenda
de invitaciones** — reuniones (individuales con padres, de clase, de claustro) y
visitas (comerciales, nuevas matrículas, dirección) — **NO vive en `eventos`**: se
saca a una **fase propia** con **modelo nuevo** (organizador + invitados nominales

- RSVP por persona + vistas día/semana/mes). Especificado en
  `docs/specs/f7a-calendario-agenda.md` (Checkpoint A, PR #50), con todas las
  decisiones de ese modelo aún **abiertas**.

**`reunion` queda como valor de ENUM en desuso.** El ENUM `tipo_evento` shippeó
con `reunion` en F7. Tras el re-encuadre, las reuniones pertenecen a la Agenda, no
a `eventos`. **Decisión: NO se migra el ENUM** — `reunion` permanece como **valor
muerto**, simplemente **oculto en la UI** del calendario escolar (no se ofrece al
crear). Motivos: (a) recrear un ENUM en Postgres es una migración destructiva
desproporcionada para un cleanup cosmético; (b) un valor de ENUM sin uso es
**inocuo** (no rompe nada, no ocupa, no confunde si la UI no lo expone); (c) evita
tocar `eventos` recién creada justo al cerrarla. Si en el futuro molesta, se retira
en una migración de limpieza agrupada (igual criterio que `es_profe_principal`
deprecado en F5B). _(Esto cierra, en sentido contrario, la D-A1 de la spec f7a, que
contemplaba recrear el ENUM: se prefiere el valor muerto a la migración.)_

## Consecuencias

### Positivas

- El centro obtiene el dato útil: qué **niños** asisten a cada evento, con traza
  de quién confirmó.
- Cero duplicación de audiencia (reuso de F6-C) y de calendario (reuso de F4.5a).
- Notificaciones de edición señal-sobre-ruido: solo cambios logísticos molestan a
  las familias, y se distinguen de un alta.
- Cancelar/editar gateados igual que la RLS → la UI no ofrece acciones que el
  backend rechaza.

### Negativas

- 4.º ENUM (`evento_estado`) además de los 3 de la spec original — coste asumido
  por coherencia (ENUM para columnas de valores fijos).
- `editarEvento` hace un SELECT extra de los campos previos antes del UPDATE para
  decidir si re-notifica (un round-trip más; aceptable).
- La restricción de columnas en editar/cancelar la enforza el server action, no la
  RLS (el UPDATE multiplexa ambas operaciones) — mismo patrón que recordatorios
  (ADR-0036).
- El **canal push sigue aparcado** (push-a-device es bloqueante temprano de Ola 1,
  diagnóstico aparte): F7 deja el cableado correcto pero la notificación no salta
  al dispositivo hasta que se reviva el canal.
- `tipo_evento` lleva un **valor muerto** (`reunion`) tras el re-encuadre — deuda
  cosmética asumida (oculto en UI; limpieza diferida).

### Neutras

- La UI de edición reusa el formulario de alta en modo `editar` (oculta
  ámbito/aula/niño: la audiencia no se edita).
- Migración additiva `20260601140000_phase7_eventos.sql` aplicada manualmente vía
  Supabase SQL Editor (CLI con bug SIGILL), patrón del proyecto.
- Hasta aplicar la migración, `database.ts` se editó a mano; `db:types` regenera
  idéntico desde el remoto.

## Plan de implementación

- [x] Migración additiva (2 tablas, 4 ENUMs, CHECKs, helpers row-aware, RLS, audit).
- [x] `database.ts` a mano (tablas + 4 ENUMs).
- [x] Backend: actions crear/editar/cancelar/confirmar; audiencia reusando F6-C;
      push (alta, cancelación, edición material) best-effort; queries de mes/detalle.
- [x] UI: overlay `<CalendarioConEventos/>`, detalle con roster/confirmación,
      formulario alta/edición; cableado en `/{admin,teacher,family}/calendario`.
- [x] i18n es/en/va (namespace `eventos`, incl. `push.actualizado`).
- [x] Tests unit (schemas, audiencia, crear, confirmar, `huboCambioMaterial`) +
      RLS gateados por `EVENTOS_MIGRATION_APPLIED=1`.
- [x] Refinamientos post-B (cancelar gateado; notificación material-only).
- [x] Aplicar la migración en SQL Editor + registrar en `schema_migrations`.
- [x] `EVENTOS_MIGRATION_APPLIED=1 npm run test:rls -- eventos.rls` en verde (**6/6**).
- [ ] Smoke en preview de Vercel; squash-merge de #49 (responsable).
- [ ] Actualizar `data-model.md`, `rls-policies.md`, `scope-ola-1.md` (F7 cerrada)
      y `progress.md` tras el merge.

## Verificación

- `typecheck` + `lint` + `build` (Regla `'use server'`) en verde local y CI.
- `test:unit` **413/413** en verde (incl. 8 de `huboCambioMaterial`: igualdad,
  normalización de horas, cambio de fecha/hora/lugar/fecha_fin, null↔"" ).
- `test:rls` gateado por `EVENTOS_MIGRATION_APPLIED=1` — **6/6 en verde** tras
  aplicar la migración (audiencia por ámbito, aislamiento aula/familia,
  autor-o-admin en update, confirmación por tutor del niño).
- Deploy de preview de Vercel OK en PR #49.

## Notas

El 4.º ENUM `evento_estado` reconcilia la instrucción "3 ENUMs" de la spec con D7:
es la forma coherente con el proyecto de materializar `estado='cancelado'`. La
columna `recordatorios.evento_id` (recordatorio automático pre-evento) queda
prevista como `ALTER TABLE ADD COLUMN` futuro (data-model.md 🔒), **fuera** de F7.

## Referencias

- Specs relacionadas: `/docs/specs/f7-calendario.md` (fuente de verdad de la capa
  de difusión), `/docs/specs/f7a-calendario-agenda.md` (re-encuadre: calendario
  escolar vs agenda; **modelo de la agenda abierto**), `/docs/specs/scope-ola-1.md`
  (F7 lean; tutorías → Ola 3).
- ADRs relacionados: ADR-0037 (audiencia/roles de recordatorios, reutilizada),
  ADR-0007 (recursión RLS), ADR-0019/0020 (calendario F4.5a/menús), ADR-0031
  (ventana de anulación 5 min, patrón análogo), ADR-0036 (restricción de columnas
  en server action).
- PRs: [#49](https://github.com/CognixLabs-Nido/NIDO/pull/49) (esta capa),
  [#50](https://github.com/CognixLabs-Nido/NIDO/pull/50) (spec del re-encuadre).
