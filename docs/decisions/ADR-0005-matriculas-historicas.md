# ADR-0005: `matriculas` como tabla histórica niño↔aula

## Estado

`accepted`

**Fecha:** 2026-05-13
**Autores:** Iker Milla, claude-code
**Fase del proyecto:** Fase 2 — Entidades core

## Contexto

Un niño en NIDO pertenece a un aula durante el curso. Pero también puede:

1. Cambiar de aula a mitad de curso (por edad, por agrupación distinta, por decisión pedagógica).
2. Pasar a un aula nueva al cambiar de curso académico.
3. Causar baja a mitad de curso (familia se muda, traslado a otra escuela).
4. Volver al centro tras un periodo de ausencia.

Tenemos que decidir cómo modelar esta relación niño↔aula. Las opciones son:

- FK directa `ninos.aula_id` que se sobrescribe en cada cambio.
- Tabla histórica `matriculas (nino_id, aula_id, fecha_alta, fecha_baja)`.
- Híbrido: FK directa + tabla de "transiciones".

## Opciones consideradas

### Opción A: Tabla `matriculas` histórica (elegida)

Cada cambio de aula genera **dos** operaciones en `matriculas`: UPDATE de la matrícula actual con `fecha_baja` y `motivo_baja`, INSERT de una nueva con `fecha_alta` y `aula_id` nuevo. Constraint: índice parcial único `(nino_id, curso_academico_id) WHERE fecha_baja IS NULL`. Garantiza una sola matrícula activa por curso.

**Pros:**

- Historial completo y consultable: "muéstrame el recorrido de Lucas en sus 3 años de escuela".
- Permite reportes pedagógicos: estabilidad por aula, número de transiciones, etc.
- Auditoría de calidad: la baja queda con motivo, lo que ayuda a entender retrocesos.
- Las agendas diarias (Fase 3) ya pueden mostrar el aula correcta para "hoy" sin perder la información de aulas previas.
- El cambio de curso a curso se modela igual: baja en el curso anterior, alta en el nuevo. Sin lógica especial.

**Contras:**

- Las queries "¿en qué aula está hoy?" requieren `WHERE fecha_baja IS NULL` o `WHERE fecha_alta <= today AND (fecha_baja IS NULL OR fecha_baja > today)`. Mitigado con índices parciales.
- Más complejo que un FK directo.

### Opción B: FK directa `ninos.aula_id`

`ninos` tiene una columna `aula_id` que apunta al aula actual. Cambiar de aula = `UPDATE ninos SET aula_id = ...`.

**Pros:**

- Trivial.
- Queries directas.

**Contras:**

- Pierde TODO el histórico. Sin auditoría de "qué pasó en septiembre cuando lo movieron de Sea a Farm".
- El audit log capturaría el UPDATE pero no estructuradamente: el dato "estuvo 3 meses en Sea, después en Farm" requiere reconstruir desde audit log, lo cual es frágil.
- Multi-curso: no hay forma natural de modelar "cuál fue su aula el curso pasado".

### Opción C: Híbrido

`ninos.aula_id_actual` + tabla `historial_aulas`. La FK rápida para el "ahora", la tabla para el "antes".

**Pros:**

- Queries rápidas para el caso común.

**Contras:**

- Redundancia: dos fuentes de verdad. Si falla la sincronización entre `aula_id_actual` y la última fila de `historial_aulas`, hay inconsistencia silenciosa.
- Triggers para mantener consistencia = complejidad oculta.
- La diferencia de coste contra el índice parcial único de la Opción A es marginal.

## Decisión

**Se elige la Opción A: tabla histórica con constraint de una matrícula activa por curso.**

```sql
CREATE TABLE public.matriculas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nino_id uuid NOT NULL REFERENCES public.ninos(id) ON DELETE RESTRICT,
  aula_id uuid NOT NULL REFERENCES public.aulas(id) ON DELETE RESTRICT,
  curso_academico_id uuid NOT NULL REFERENCES public.cursos_academicos(id) ON DELETE RESTRICT,
  fecha_alta date NOT NULL DEFAULT CURRENT_DATE,
  fecha_baja date,
  motivo_baja text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (fecha_baja IS NULL OR fecha_baja >= fecha_alta)
);

CREATE UNIQUE INDEX idx_matricula_activa_unica
  ON public.matriculas (nino_id, curso_academico_id)
  WHERE fecha_baja IS NULL AND deleted_at IS NULL;
```

`ON DELETE RESTRICT` a `ninos` evita que un borrado físico de niño deje matrículas huérfanas (el flujo real es soft delete vía `deleted_at`).

El server action `cambiarAula` envuelve UPDATE + INSERT en orden. Sin transacciones explícitas (Supabase HTTP client no las expone directamente), pero como ambas operaciones son idempotentes y el INSERT depende del UPDATE, el rollback manual es factible si el INSERT falla.

## Consecuencias

### Positivas

- Historial completo gratis. Un futuro reporte de "trayectoria pedagógica" es una query.
- Cambio de aula auditado tanto en `audit_log` como en la tabla misma (la fila de la matrícula anterior queda con `motivo_baja` poblado).
- Fase 3+ (agendas diarias) puede unir agenda con `matriculas` y mostrar el aula correcta del día sin extraer lógica.

### Negativas

- Las queries "dame el aula actual de este niño" no son un SELECT trivial. Mitigado con queries auxiliares en `src/features/ninos/queries/get-ninos.ts` (`getMatriculasPorNino`).
- Existe la posibilidad de "matrícula zombi" si un UPDATE de baja se aplica y el INSERT de la nueva matrícula falla. Mitigado: el server action hace ambas con rollback manual, y `audit_log` captura el estado parcial para reconstruir.

### Neutras

- El admin opera el cambio de aula desde un diálogo único que dispara `cambiarAula(matricula_actual_id, nueva_aula_id, fecha_baja, motivo_baja)`.

## Plan de implementación

- [x] Tabla con índice parcial único en migración.
- [x] Server action `cambiarAula` con UPDATE + INSERT secuencial.
- [x] Query `getMatriculasPorNino` ordenada por `fecha_alta DESC` para mostrar historial.
- [x] Tab "Matrículas" en `/admin/ninos/[id]` lista historial completo.
- [x] Tests RLS verifican que profe/tutor solo ven matrículas autorizadas.

## Verificación

- Test `src/test/audit/audit.test.ts` verifica que el soft delete (UPDATE de `deleted_at`) en `matriculas` se audita.
- Test RLS `aulas.rls.test.ts` verifica que profe de aula A solo ve la matrícula del aula A, no la de B.
- Build / typecheck verdes.

## Notas

- Si en Ola 2 aparece la necesidad de "días no lectivos" o "interrupciones temporales" (ej. ingreso hospitalario sin baja definitiva), la tabla está preparada: añadir columna `tipo_baja` o tabla `interrupciones_matricula` referenciando `matricula_id`.
- El audit log captura cada INSERT/UPDATE de matrícula con `centro_id` derivado vía `centro_de_nino(...)`, así que el historial está doblemente capturado (en la propia tabla y en `audit_log`).

## Referencias

- Spec: `docs/specs/core-entities.md` (B13)
- Migración: `supabase/migrations/20260513202012_phase2_core_entities.sql`
- Server action: `src/features/matriculas/actions/cambiar-aula.ts`
