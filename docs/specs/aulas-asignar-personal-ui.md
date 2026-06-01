---
feature: aulas-asignar-personal-ui
wave: 1
status: accepted
priority: high
last_updated: 2026-05-30
checkpoint_a_aprobado: 2026-05-30
related_adrs: [ADR-0032, ADR-0034]
related_specs: [phase-5b-tabla-aulas-enriquecida.md, core-entities.md]
---

# Spec — UI para asignar personal a aulas (sprint pre-F6, item 4)

## Resumen ejecutivo

Dar a la dirección del centro (Susana, directora de ANAIA, **no técnica**) una UI para asignar, reclasificar, mover y retirar personal de las aulas, sin depender del SQL Editor de Supabase. El backend (`tipo_personal_aula` ENUM + índice único de coordinadora) está listo desde el PR #34; falta la capa de interacción. **Bloqueante para el piloto (Ola 1).**

## Contexto y hallazgos de auditoría

- `asignarProfeAula(aulaId, input)` ya existe pero **solo hace INSERT**. No hay desasignar / cambiar tipo / terminar / mover → se crean en este PR.
- `profes_aulas`: `fecha_inicio`, `fecha_fin` (nullable, CHECK ≥ inicio), `deleted_at`, `tipo_personal_aula` (NOT NULL default `profesora`), `es_profe_principal` (deprecated). Índice único parcial `idx_un_coordinadora_activa_por_aula (aula_id) WHERE tipo='coordinadora' AND fecha_fin IS NULL AND deleted_at IS NULL`. Activa = `fecha_fin IS NULL AND deleted_at IS NULL`.
- RLS: `profes_aulas_admin_all` (`FOR ALL` admin del centro, CRUD completo) + `profes_aulas_self_select` (profe lee lo suyo). No hay rol "direccion" separado (= admin).
- Candidatos = usuarios con `roles_usuario.rol='profe'` en el centro (no hay flag `es_profe`).
- Patrón UI admin: `<Dialog>` + `useTransition` + `toast` (sonner) + `useTranslations`. Componentes shadcn disponibles: dialog, select (base-ui), badge, button, table… **sin `Sheet`**.
- `profes_aulas` **no está auditada** (sin trigger `audit_log`).

## User stories

- US-01: Como directora, asigno una profe a un aula con su tipo sin pedir SQL.
- US-02: Como directora, retiro a quien ya no trabaja conservando el histórico.
- US-03: Como directora, cambio el tipo de una persona resolviendo el conflicto de coordinadora única.
- US-04: Como directora, muevo a alguien de un aula a otra.
- US-05: Como profe, veo mi asignación pero no puedo modificar personal.

## Alcance

**Dentro:** añadir persona con tipo · retirar (soft, `fecha_fin`) · cambiar tipo · mover entre aulas · resolver conflicto coordinadora con sustitución.

**Fuera (follow-up):** crear/invitar usuario nuevo · auditar `profes_aulas` en `audit_log` · drop de `es_profe_principal` · reactivar los 6 tests skip de `profes-aulas.rls.test.ts`.

## Decisiones (cerradas en Checkpoint A, 2026-05-30 — todas a favor de la recomendación)

- **D1 Entry point:** (a) botón "Gestionar personal" por fila en `/admin/aulas` (no se crea `/admin/aulas/[id]`).
- **D2 Forma:** `<Dialog>` (consistencia; sin componente nuevo).
- **D3 Operaciones:** añadir · retirar · cambiar tipo · mover. Crear perfil = fuera. "Mover" = `moverProfeAula` (insert destino → `fecha_fin` origen).
- **D4 Conflicto coordinadora:** (b) confirmación de sustitución → `sustituirCoordinadora` (degrada actual + promociona nueva). `23505` = red de seguridad de carrera.
- **D5 Múltiples aulas:** permitido (personal compartido). Único límite: 1 coordinadora activa por aula.
- **D6 Borrado:** soft vía `fecha_fin = hoy` (huso Madrid). Conserva histórico. `deleted_at` reservado a borrados por error. Sin hard delete.
- **D7 Permisos:** solo admin muta; profe solo lectura. Verificado en RLS, sin cambios.
- **D8 Candidatos:** profes del centro (`rol='profe'`) no asignados activamente a ese aula. Orden alfabético.

## Comportamientos detallados

### Añadir

Pre: aula del centro del admin. Flujo: elegir persona (candidato) + tipo → `asignarProfeAula`. Si tipo=coordinadora y ya hay una → confirmación de sustitución (añade como profesora y luego `sustituirCoordinadora`). Post: `revalidatePath('/[locale]/admin/aulas','page')`.

### Retirar

`terminarAsignacion(asignacionId)` → `fecha_fin = hoyMadrid()`. Confirmación inline previa. La persona desaparece de "personal activo" (histórico preservado).

### Cambiar tipo

`cambiarTipoPersonal(asignacionId, tipo)`. Si tipo=coordinadora y ya hay otra → confirmación → `sustituirCoordinadora`. Resto directo.

### Mover

`moverProfeAula(asignacionId, aulaDestinoId)`: INSERT destino primero (tipo `profesora` si el origen era coordinadora, para no chocar con el índice; resto preserva tipo); si la persona ya está activa en destino → aborta sin tocar origen; si OK → `fecha_fin` en origen.

## Casos de uso de Susana (clicks ≤ 4)

A: añadir coordinadora (4). B: mover de aula (4). C: retirar (4 con confirm). D: profesora→coordinadora con sustitución (4). E: técnico en 2 aulas (4+4).

## Riesgos y gotchas

1. **Race coordinadora:** índice único protege; `23505` → toast "recarga, otra persona fue nombrada coordinadora".
2. **`profes_aulas` no auditada:** follow-up post-sprint (decisión RGPD), NO en este PR.
3. **Revalidación:** `revalidatePath('/[locale]/admin/aulas','page')` en toda mutación. Sin optimistic update en v1.
4. **Mover no atómico:** insert destino primero; si falla, no se toca origen (Nota D).
5. **i18n VA con TODOs** en el componente (no en JSON), patrón #35/#36.

## Plan de archivos (≈1.0–1.2k líneas)

Ver tabla en §9 del reporte de Checkpoint A. Actions nuevas (4) + queries (2) + `GestionarPersonalDialog` + integración `TablaAulas`/`page` + i18n ×3 + tests (component, action cores, RLS) + ADR-0034.

## Tests

- Component `GestionarPersonalDialog.test.tsx` (unit): añadir, conflicto coordinadora→sustitución, retirar, mover, empty, error.
- Action cores (unit, fake supabase): terminar/cambiarTipo/sustituir/mover, happy + bordes.
- RLS reales (proyecto `rls`): admin muta, otro centro rechazado, profe solo lectura, sustitución respeta índice. Gate `F5B34_MIGRATION_APPLIED`.
- E2E `test.skip`.

## Branch + PR

- Rama: `feat/aulas-asignar-personal-ui`
- Título: `feat(admin): UI para asignar personal a aulas (sprint pre-F6 item 4)`
