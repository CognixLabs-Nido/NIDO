# ADR-0040: Inicio "resumen de la semana" y consolidación del Calendario Escolar en uno por rol

## Estado

`accepted`

**Fecha:** 2026-06-03
**Autores:** responsable + claude-code
**Fase del proyecto:** Fase 7 — Calendario y eventos (pieza transversal AG-15, post-core de la Agenda)

## Contexto

Cerrado el core de la Agenda (F7b, [ADR-0039](./ADR-0039-modelo-agenda-citas-invitados-rsvp.md)) y el Calendario Escolar (F7, [ADR-0038](./ADR-0038-modelo-eventos-y-confirmaciones.md)), quedaban dos puntas sueltas en la experiencia de "ojeo rápido":

1. **El home de cada rol** mostraba el widget `ProximosDiasCerradosWidget`: un bloque de "próximos días cerrados" a 30 días vista (solo `dias_centro`). Daba poca señal —ni eventos del calendario ni citas de la agenda— y miraba a un horizonte (un mes) que no es lo que el usuario necesita al entrar. El ítem **AG-15** (promovido a Ola 1, `scope-ola-1.md`) pedía sustituirlo por un **resumen del día + la semana en curso** que **integre** las tres fuentes que el usuario ya puede ver: eventos (F7), citas (F7b) y cierres (`dias_centro`).

2. **La página `/admin/calendario`** renderizaba **dos rejillas de mes**: `CalendarioCentroEditor` (editor del calendario laboral — marcar festivos/vacaciones/escuela de verano sobre `dias_centro`) **y** `CalendarioConEventos` (overlay de eventos + coloreado de días). Para el usuario eran "dos calendarios" prácticamente idénticos, lo que se leía como duplicado. Profe y familia, en cambio, ya veían **un solo** calendario (`CalendarioConEventos`, solo lectura del laboral). El reto: deduplicar **sin perder** la visibilidad de eventos/excursiones (condición explícita del responsable) **ni** la capacidad del admin de editar días laborales.

Ambas decisiones son transversales (cruzan `eventos`, `citas`, `calendario-centro`) y difíciles de revertir sin retrabajo, por eso se registran.

## Opciones consideradas

### AG-15 — Inicio

#### Opción A: mantener el widget de cierres (statu quo)

**Pros:** cero trabajo.
**Contras:** no muestra eventos ni citas; horizonte de un mes en vez de la semana en curso; no cumple AG-15.

#### Opción B: resumen Hoy + semana integrando las 3 fuentes, read-only, scoping por RLS (elegida)

**Pros:** una sola mirada con todo lo relevante de la semana; el detalle sigue en `/calendario` y `/agenda` (enlaces); el ámbito por rol no se reimplementa (lo da la RLS de cada tabla). **Contras:** un agregador y queries de rango nuevas; el resumen no edita (es solo lectura).

#### Opción C: resumen como feature dentro de `agenda/`

**Pros:** menos carpetas. **Contras:** crea dependencia `agenda → eventos`; el resumen es transversal, no parte de la Agenda.

### Consolidación del calendario

#### Opción 1: quitar el editor laboral de admin

**Pros:** un solo calendario rápido. **Contras:** el admin pierde la única UI para marcar días cerrados (regresión funcional). Descartada.

#### Opción 2: fusionar la edición laboral dentro del calendario de eventos (elegida)

**Pros:** un único calendario en los 3 roles; eventos siempre visibles; el admin conserva la edición de días (inline). **Contras:** refactor (portar los 2 diálogos + las 3 server actions de `dias_centro` al componente de eventos, gateado a `esAdmin`).

#### Opción 3: dejar las dos rejillas y solo relabelar

**Pros:** rápido, cero refactor. **Contras:** sigue habiendo dos calendarios; no resuelve el duplicado de fondo. Descartada.

## Decisión

**Se elige la Opción B (Inicio) y la Opción 2 (calendario).**

**Inicio (AG-15):** `ProximosDiasCerradosWidget` se sustituye por `ResumenSemanaWidget`, que pinta dos secciones —**Hoy** y **Esta semana** (semana ISO lun–dom, `Europe/Madrid`)— mezclando eventos, citas y cierres en una lista ordenada por fecha/hora. El **ámbito por rol no se reimplementa**: `getCitasRango` filtra por `auth.uid()` (organizador/invitado) y `getEventosRango`/`getDiasCerradosRango` por centro, todo bajo RLS. Es **solo lectura**: el detalle vive en `/calendario` y `/agenda`, enlazados con "ver todo". La feature vive en `src/features/inicio/` (transversal; **no** cuelga de `agenda/` para no crear la dependencia `agenda → eventos`).

**Calendario:** el Calendario Escolar pasa de **dos calendarios a uno por rol**. `CalendarioConEventos` absorbe la edición del calendario laboral (solo `esAdmin`): clic en un día → panel con sus eventos + botón **"Editar día"** (diálogo de tipo `dias_centro`); **Shift+clic** → diálogo de aplicar tipo a un **rango**. Reusa las 3 server actions existentes (`upsertDiaCentro`, `eliminarDiaCentro`, `aplicarTipoARango`) y conserva los `data-testid` de los diálogos. Se elimina `CalendarioCentroEditor` (su rejilla duplicada) de la página de admin. **Los eventos/excursiones siguen visibles en los 3 roles** —condición innegociable del responsable—, porque la visualización de eventos siempre estuvo en `CalendarioConEventos`, no en el editor.

La diferencia clave que habilita la Opción 2 sin pérdida: profe y familia **ya** veían el calendario unificado; el editor solo añadía una segunda rejilla a admin. Llevar la edición a la vista unificada deja a admin consistente con lo que ya funcionaba.

## Consecuencias

### Positivas

- Home: una sola mirada con eventos + citas + cierres de la semana, por rol, sin reimplementar permisos.
- Calendario: un único calendario coherente en los 3 roles; menos superficie de UI y de código (se borra el editor y el widget de cierres).
- Edición de días laborales más rica en contexto: el admin ve eventos y cierres en la misma rejilla mientras edita.
- Reutilización total: el resumen reusa `getCitasRango` tal cual; la fusión reusa las 3 actions de `dias_centro`.

### Negativas

- El resumen de Inicio es **read-only**: editar/RSVP siguen en `/agenda` y `/calendario` (deliberado, Ola 1).
- La semana se muestra **entera** (lun–dom), incluidos días ya pasados, para no perder eventos multi-día anclados al lunes; un evento multi-día vigente "hoy" aparece en _Esta semana_, no en _Hoy_ (follow-up si molesta en uso real).
- La edición de un día pasa de "clic abre diálogo" (viejo editor) a "clic → panel → Editar día": un clic más, a cambio de no romper la navegación de eventos.

### Neutras

- Nueva carpeta `src/features/inicio/`. Dos queries de rango nuevas (`getEventosRango`, `getDiasCerradosRango`) junto a las existentes por mes.
- i18n nuevo `inicio_resumen.*` y `calendario.editar_dia` (es/en/va). Se elimina `calendario.widget_proximos_cerrados`.

## Plan de implementación

- [x] I0 — capa de datos: `ventanaSemana` (DST-safe), `construirResumen` (puro), `getResumenSemana`, queries de rango; 12 tests unit.
- [x] I1 — `ResumenSemanaWidget` + i18n trilingüe + wiring en los 3 home (family/teacher reemplazan; admin añade).
- [x] I2 — borrar `ProximosDiasCerradosWidget` + su query + i18n (huérfanos); E2E del tutor (gateado).
- [x] EXTRA — fusionar edición laboral en `CalendarioConEventos`; borrar `CalendarioCentroEditor`; E2E `school-calendar` actualizado al nuevo flujo.
- [x] FIX UI — `DialogContent` con tope de altura + footer fijo (crear evento / nueva cita no exceden pantalla).

## Verificación

- Unit: 12 tests del agregador (mezcla, orden, recorte, partición, cancelados, multi-día, vacío) + paridad i18n `inicio_resumen` (es/en/va).
- E2E (smoke + gateados con `E2E_REAL_SESSIONS=1`): los 3 home redirigen a login; tutor ve el resumen y "Ver agenda" → `/agenda`; `school-calendar` marca día/rango por el nuevo flujo.
- Checkpoint C (barrido pre-merge, 2026-06-03): typecheck exit 0 · lint 0 errores · test 682 passed / 42 skipped · build exit 0.
- Preview de Vercel validado por el responsable (Inicio + calendario sin duplicado + diálogos que no se salen).

## Notas

`getCitasRango` se acota por usuario (organizador/invitado), no por centro: es lo correcto para el resumen (cada uno ve sus invitaciones). El multi-día se ancla al lunes recortado; los cierres caen en su fecha exacta, así que "hoy es día cerrado" sí aparece en _Hoy_.

## Referencias

- Specs relacionadas: `docs/specs/agenda-citas.md` (AG-15), `docs/specs/scope-ola-1.md`
- ADRs relacionados: ADR-0038 (eventos), ADR-0039 (agenda/citas), ADR-0019 (calendario laboral / `dias_centro`)
- PR: CognixLabs-Nido/NIDO #52
