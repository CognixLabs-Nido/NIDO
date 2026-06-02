# ADR-0039: Modelo de Agenda — citas con invitados nominales y RSVP

## Estado

`accepted`

**Fecha:** 2026-06-02
**Autores:** responsable + claude-code
**Fase del proyecto:** Fase 7b — Agenda (citas con invitados nominales y RSVP)

## Contexto

Al cerrar la Fase 7 ([ADR-0038](./ADR-0038-modelo-eventos-y-confirmaciones.md)) se
detectó que la tabla `eventos` mezclaba **dos productos** distintos:

- **Difusión** (broadcast): el centro anuncia algo a una **audiencia por ámbito**
  (centro / aula / niño), con confirmación de asistencia opcional y ligera. Eso es
  F7 (`eventos` + `confirmaciones_evento`), ya cerrado.
- **Invitación nominal**: un **organizador** del staff convoca a **personas
  concretas** y cada una responde con **RSVP individual** (pendiente / acepta /
  rechaza). Esto es el modelo "tipo Outlook/Google Calendar" y **no encaja** en el
  modelo de audiencia-por-ámbito de `eventos`.

F7 cerró como **solo difusión** y la **invitación** se sacó a una fase propia con
modelo nuevo: la **Agenda** (`/agenda`). Hay que decidir su modelo de datos, su
matriz de permisos, cómo se materializan los invitados, y cómo se re-encuadra la
nomenclatura para que "Calendario" (difusión) y "Agenda" (invitación) no se
confundan. La spec completa con las decisiones cerradas (AG-01..AG-15) vive en
`docs/specs/agenda-citas.md`.

## Opciones consideradas

### Opción A: Reusar `eventos` con un flag `requiere_rsvp_nominal`

Extender la tabla de difusión con columnas para invitados nominales y RSVP.

**Pros:**

- Una sola tabla de "cosas del calendario".
- Reutiliza la vista mes y la UI de F7 sin duplicar.

**Contras:**

- Mezcla dos semánticas incompatibles (audiencia-por-ámbito vs lista nominal) en una
  tabla con CHECKs condicionales cada vez más enrevesados — justo el problema que
  ADR-0038 acababa de separar.
- La RLS tendría que multiplexar dos modelos de visibilidad en las mismas policies.
- `confirmaciones_evento` es por **niño** (la familia confirma por hijo); el RSVP de
  la Agenda es por **persona** (el invitado responde por sí mismo). No son la misma
  fila.

### Opción B: Modelo nuevo de 2 tablas `citas` + `cita_invitados` (elegida)

Tabla `citas` (la cita: organizador, tipo, título, fecha/hora, lugar, estado) y
`cita_invitados` (un invitado por fila: usuario interno **o** externo-texto + estado
RSVP). Espejo estructural de `eventos`/`confirmaciones_evento` pero con semántica
**nominal**.

**Pros:**

- Cada modelo (difusión vs invitación) queda en su tabla, con su RLS y sus CHECKs
  propios — coherente con el re-encuadre de ADR-0038.
- El RSVP por-persona cae natural en `cita_invitados` (una fila por invitado).
- Reutiliza patrones probados: row-aware anti-MVCC (F5), cancelación por estado
  (F7), expansión de grupos a personas (F6-C), `centro_id` explícito en el action.

**Contras:**

- Dos tablas nuevas + 3 ENUMs + helpers + triggers de audit (más superficie).
- Cierta duplicación de UI respecto a F7 (vista mes), mitigada reusando
  `<CalendarioMensual/>`.

### Opción C: Una tabla `citas` con `invitados jsonb`

Guardar los invitados como array JSONB dentro de la cita.

**Pros:**

- Una tabla; lectura de la cita trae sus invitados sin join.

**Contras:**

- El RSVP individual (UPDATE de la respuesta de un invitado) sobre un JSONB es
  hostil a RLS: no se puede aislar "tu fila" ni auditar quién/cuándo por persona.
- Rompe el patrón del proyecto (filas auditables, FKs, índices). Imposible el
  "roster privado" (un invitado solo ve su propia respuesta) vía RLS.

## Decisión

**Se elige la Opción B** (modelo nuevo de 2 tablas) porque es la única que mantiene
la separación difusión/invitación que ADR-0038 estableció, modela el RSVP
**por-persona** de forma auditable, y permite el **roster privado** vía RLS (un
invitado solo lee su propia fila; la lista completa es solo para
organizador/admin). Reutiliza sin duplicar lógica los patrones ya probados del
proyecto.

Decisiones de diseño cerradas (detalle y trazabilidad en `agenda-citas.md`):

- **4 tipos** (`tipo_cita`): `reunion_familia` · `reunion_clase` · `reunion_claustro`
  · `visita`. CHECK estructural `citas_tipo_coherencia` (familia⇒`nino_id`;
  clase⇒`aula_id`; claustro/visita⇒ninguno) — espejo de `eventos_ambito_coherencia`.
- **Matriz organizador→invitado (AG-tipos)**: admin organiza los 4 tipos; profe solo
  `reunion_familia` (su niño) y `reunion_clase` (su aula); claustro/visita solo
  admin. La RLS de `citas_insert` es el espejo exacto. **tutor/autorizado solo
  reciben + responden**, nunca organizan.
- **Grupos se expanden a personas al crear** (snapshot, AG-02): `reunion_clase` →
  familias del aula (con `puede_recibir_mensajes`) + profes del aula;
  `reunion_claustro` → profes del centro. Se reutilizan los resolutores de audiencia
  de F6-C (extraídos a `src/shared/lib/audiencia-personas.ts`, + `profesDeAula`
  nuevo). **No hay re-sync automático**; editar la lista (añadir/quitar) es manual y
  está en Ola 1.
- **RSVP 3 estados** (`rsvp_estado`): `pendiente` / `aceptado` / `rechazado`. Ventana
  abierta hasta la **hora de inicio** (AG-11), enforzada por el server action (la RLS
  de `cita_invitados` no lleva ventana temporal).
- **Invitado externo = solo texto** (`usuario_id NULL` + `nombre_externo`): sin
  cuenta ni RSVP digital; su asistencia la marca el organizador. Email/magic-link
  diferido.
- **Cancelación por estado** (`cita_estado='cancelada'`, no DELETE), patrón del
  proyecto. **Excepción**: `cita_invitados` **sí** permite DELETE a
  organizador/admin (quitar un invitado es gestión de lista, sin contenido que
  preservar; traza en `audit_log`), análoga a `dias_centro` (F4.5a).
- **Anti-MVCC row-aware**: `usuario_es_audiencia_cita_row(centro_id, organizador_id,
cita_id)` no re-lee `citas`; consulta `cita_invitados` (otra tabla) → el gotcha
  MVCC no aplica. Tests `.insert().select()` en ambas tablas como bloqueo de
  regresión.
- **Preferencia de vista** (AG-07): tabla genérica `preferencias_usuario
(usuario_id, clave, valor)`, aislamiento estricto por `auth.uid()` (patrón
  `push_subscriptions`). No se audita.
- **Vistas** día (default) / semana / mes: mes reusa `<CalendarioMensual/>`;
  día/semana son rejilla **horaria** nueva (jornada de guardería, no 24h). Alta por
  botón "+ Nueva cita" **y** clic directo en el día/franja (patrón Calendario).

**Refinamientos cerrados durante la implementación:**

- **AG-14 — Badge de invitaciones pendientes**: RPC
  `contar_invitaciones_pendientes()` (`SECURITY DEFINER STABLE`, scoping por
  `auth.uid()`), patrón exacto de `contar_recordatorios_pendientes` (F6-C). Cuenta
  las pendientes en citas programadas y aún no comenzadas, **excluyendo las que el
  propio usuario organiza**. Migración aditiva propia
  (`20260602130000_phase7b_agenda_badge.sql`). **Sin push ni Realtime** — recuento
  en server-render; inyectado en los 6 layouts (como el de recordatorios) para que
  se vea desde cualquier módulo.
- **AG-15 — Inicio: resumen de la semana** (eventos del Calendario + citas de la
  Agenda, día + semana, por rol según RLS): **integra** los cierres del centro de la
  semana (no sustituye) y elimina el bloque "Sin cierres previstos el próximo mes".
  Es **pieza propia posterior** al core (cruza F7 + Agenda); recupera el Dominio C
  "Inicio Hoy" de la spec f7a. Pendiente de su propio PR tras el merge.

**Re-encuadre Calendario / Agenda (AG-08):** la etiqueta visible del Calendario
escolar (eventos F7, ruta `/calendario`) pasa a **"Calendario Escolar"**; el módulo
nuevo es **"Agenda"** (ruta `/agenda`). La **agenda diaria del niño (F3)** no se
toca. El namespace i18n nuevo es `citas` (evita colisión con `agenda` de F3).

## Consecuencias

### Positivas

- Difusión e invitación quedan en modelos separados, cada uno con su RLS — sin
  CHECKs condicionales que multiplexan semánticas.
- RSVP auditable por persona y **roster privado** real vía RLS.
- Reutilización máxima: resolutores F6-C, `<CalendarioMensual/>`, patrones
  anti-MVCC y de cancelación; sin duplicar el motor de audiencia.
- El badge reusa el patrón RPC de F6-C tal cual (riesgo bajo, ya probado).

### Negativas

- Dos tablas + 3 ENUMs + helpers + triggers nuevos (superficie de mantenimiento).
- Cierta duplicación de UI de calendario respecto a F7 (mitigada por reuso).
- Deuda explícita aceptada y diferida: push de la Agenda, externos con RSVP digital
  (magic-link), recurrencia, Realtime del roster, re-sync automático de invitados
  por cambio de matrícula, change-log completo del RSVP, rejilla horaria
  pixel-perfect. Todo registrado como follow-up / Ola posterior en la spec.

### Neutras

- Migraciones aplicadas al remoto vía **SQL Editor** (bug SIGILL del CLI), no por
  `db reset`. Dos migraciones aditivas: el modelo (`…120000_phase7b_agenda`) y el
  badge (`…130000_phase7b_agenda_badge`).
- Nuevo namespace i18n `citas` (es/en/va) a mantener trilingüe.

## Plan de implementación

Ejecutado en sub-pasos reviewables (Checkpoint B, PR #51), commits atómicos:

- [x] B0 — migración del modelo (3 ENUMs, `citas`, `cita_invitados`,
      `preferencias_usuario`, helpers row-aware, RLS, audit, triggers).
- [x] B1 — tipos + schemas Zod.
- [x] B2 — server actions + queries (resolución `centro_id` explícita, expansión
      snapshot, limpieza best-effort).
- [x] B3 — tests RLS gateados (`AGENDA_MIGRATION_APPLIED=1`).
- [x] B4 — UI vistas (día/semana/mes) + alta (botón y clic-en-día/franja).
- [x] B5 — detalle + control RSVP + roster (añadir/quitar, marcar externo).
- [x] B8 — badge de invitaciones (AG-14): RPC + `AgendaBadge` + 6 layouts.
- [x] ADR de cierre (este documento) y actualización de `data-model.md` /
      `rls-policies.md`.
- [ ] AG-15 (Inicio: resumen de la semana) — **pieza aparte, tras el merge**.

## Verificación

- Tests RLS gateados en verde contra el remoto: aislamiento, profe no crea
  claustro/visita, tutor no crea, RSVP solo sobre fila propia, roster privado,
  alta/baja solo organizador/admin, `INSERT…RETURNING` sin fallo MVCC,
  `preferencias_usuario` self-only, y **badge**: dos usuarios → cada uno su recuento;
  el organizador no cuenta sus citas; al aceptar deja de contar.
- 56 tests unit de la feature (schemas, expansión por tipo, idempotencia RSVP,
  dedup, ventana) en verde.
- `npm run typecheck`, `npm run lint`, `npm run build` (regla `'use server'`) en
  verde antes de cada PR.
- Preview de Vercel verificado visualmente por el responsable.

## Notas

El "roster privado" es la pieza de diseño que justifica el modelo de 2 tablas frente
al JSONB: solo con filas auditables y RLS por fila se puede dar a cada invitado
**únicamente** su propia respuesta sin exponer la lista. La separación difusión vs
invitación es la continuación directa del Eje 4 de ADR-0038.

## Referencias

- Specs relacionadas: `docs/specs/agenda-citas.md` (decisiones AG-01..AG-15, plan
  Checkpoint B), `docs/specs/f7-calendario.md`, `docs/specs/scope-ola-1.md`.
- ADRs relacionados: ADR-0038 (cierre F7, re-encuadre difusión/invitación),
  ADR-0037 (resolutores de audiencia F6-C reutilizados), ADR-0007 (recursión RLS),
  ADR-0031 (gotcha "USING falso → 0 filas"), ADR-0011 (huso Madrid).
- Arquitectura: `docs/architecture/data-model.md`, `docs/architecture/rls-policies.md`.
- PR: #51 (CognixLabs-Nido/NIDO).
