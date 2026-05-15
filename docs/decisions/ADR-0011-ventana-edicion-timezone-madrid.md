# ADR-0011: Timezone `Europe/Madrid` hardcoded en la ventana de edición de agendas

## Estado

`accepted`

**Fecha:** 2026-05-15
**Autores:** Claude Code + responsable NIDO
**Fase del proyecto:** Fase 3 — Agenda diaria + bienestar

## Contexto

La agenda diaria tiene una **ventana de edición** que define cuándo la profe puede crear/modificar registros del día. Postgres aplica la ventana vía el helper `public.dentro_de_ventana_edicion(fecha date)` referenciado en las políticas RLS de las 5 tablas nuevas (`agendas_diarias`, `comidas`, `biberones`, `suenos`, `deposiciones`).

La ventana es "mismo día calendario" (ver ADR-0013). Pero "día calendario" depende del huso horario: las 23:30 en Madrid son las 22:30 UTC, y a las 00:00 UTC del día siguiente todavía sería el día anterior en muchos husos. Hay que elegir un huso de referencia.

NIDO arranca single-tenant con ANAIA (Valencia, huso `Europe/Madrid` = CET/CEST). La idea es expandir a otros centros más adelante, pero **dentro del huso CET en Ola 1**. Centros en husos diferentes solo aparecen en Ola 2+.

## Opciones consideradas

### Opción A: hardcodear `Europe/Madrid` en el helper

`now() AT TIME ZONE 'Europe/Madrid'` directamente en la función SQL.

**Pros:**

- Simplicidad máxima: una sola línea, sin parámetros.
- Postgres maneja DST (cambio horario marzo/octubre) sin código adicional.
- Tests RLS triviales: comparar contra `(now() AT TIME ZONE 'Europe/Madrid')::date`.
- Cero cambios en la tabla `centros`.

**Contras:**

- Bloquea incorporación de centros fuera de CET sin cambio de esquema.
- Acoplamiento explícito a un huso en código de BD.

### Opción B: columna `centros.timezone TEXT NOT NULL DEFAULT 'Europe/Madrid'`

Pasar el `centro_id` al helper, leer su `timezone`, aplicarlo.

**Pros:**

- Multi-tenant correcto desde el día 1.
- Cambiar el huso de un centro = un `UPDATE`.

**Contras:**

- Complica el helper: necesita un JOIN o lookup adicional (el helper se llama desde políticas RLS sobre filas que tienen `nino_id` o `agenda_id`, hay que resolver `centro_id` primero).
- Aumenta la superficie de bugs (¿qué pasa si un centro tiene un huso inválido? ¿con `nino_id` cross-centro?).
- YAGNI: no tenemos centros fuera de Madrid en el horizonte de Ola 1.

### Opción C: usar UTC y delegar interpretación al cliente

Helper devuelve simplemente `fecha = CURRENT_DATE` en UTC.

**Pros:**

- Sin acoplamiento a huso en BD.

**Contras:**

- Las 23:30 hora Madrid son las 22:30 UTC: la familia ve la agenda "cerrarse" a las 02:00 hora local, no a las 00:00 — confuso.
- La profe en Valencia que rellena la agenda a las 23:50 vería cómo "se cierra" media hora después de medianoche local.
- Imposible alinear el cierre con la jornada laboral real.

## Decisión

**Se elige la Opción A (hardcodear `Europe/Madrid`)** porque el coste de migrar a Opción B cuando llegue el primer centro fuera de CET (probablemente Ola 2+) es bajo y conocido, mientras que el coste de mantener Opción B desde ya añade complejidad para un problema que aún no existe.

```sql
CREATE OR REPLACE FUNCTION public.dentro_de_ventana_edicion(p_fecha date)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p_fecha = (now() AT TIME ZONE 'Europe/Madrid')::date;
$$;
```

## Consecuencias

### Positivas

- Una sola línea de código de BD. Mínima superficie de bugs.
- Postgres gestiona DST automáticamente (transición CET ↔ CEST en marzo y octubre).
- Tests RLS no necesitan mockear husos: comparar contra `(now() AT TIME ZONE 'Europe/Madrid')::date` es determinista.
- El "día cerrado" se alinea con la percepción humana real de las familias y profes de Valencia.

### Negativas

- Incorporar un centro fuera de CET (ej. Canarias `Atlantic/Canary`, o internacional) requiere:
  1. Añadir columna `centros.timezone`.
  2. Reescribir el helper para aceptar el huso del centro asociado al registro.
  3. Migrar tests RLS.
- Cualquier desarrollador que lea el helper podría asumir que es por convenio del proyecto y replicarlo en otras funciones futuras, propagando el acoplamiento.

### Neutras

- Documentamos explícitamente el supuesto y el plan de migración para que el cambio futuro sea predecible.

## Plan de implementación

- [x] Crear helper `public.dentro_de_ventana_edicion(fecha)` en la migración Fase 3 con huso Madrid hardcoded.
- [x] Comentar el porqué en la migración SQL.
- [x] Documentar el helper en `docs/architecture/rls-policies.md`.
- [x] Añadir tests Vitest (`src/test/rls/dentro-de-ventana-edicion.test.ts`) cubriendo HOY/AYER/MAÑANA.
- [ ] **Plan futuro de internacionalización** (cuando llegue un centro fuera de CET):
  1. `ALTER TABLE public.centros ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Europe/Madrid' CHECK (...)`.
  2. Crear nuevo helper `dentro_de_ventana_edicion_v2(fecha, p_centro_id uuid)` que mire `centros.timezone`.
  3. Migrar todas las políticas RLS de Fase 3 a `_v2` en una migración correctiva.
  4. Dejar el helper viejo como deprecated 1 mes antes de eliminarlo.

## Verificación

- Tests Vitest `src/test/rls/dentro-de-ventana-edicion.test.ts` pasan en verde.
- Tests RLS de agenda (`agenda-diaria.rls.test.ts`) validan que la profe puede INSERT con fecha=HOY hora Madrid y NO puede con fecha=ayer/anteayer.
- Smoke manual: a las 23:55 hora Madrid → INSERT permitido; a las 00:05 hora Madrid → INSERT denegado para el día anterior.

## Notas

- Postgres maneja correctamente el cambio de hora (CET/CEST). `now() AT TIME ZONE 'Europe/Madrid'` siempre devuelve el timestamp local correcto.
- ¿Por qué no `TIMESTAMP WITH TIME ZONE` en lugar de `DATE`? Porque la ventana es por **día calendario completo** (00:00–23:59:59) y operar con `DATE` simplifica la comparación.

## Referencias

- Spec: `/docs/specs/daily-agenda.md`
- Helper: `supabase/migrations/20260515153711_phase3_daily_agenda.sql`
- ADR-0013 — Ventana = mismo día calendario (define el "qué"; este ADR define el "huso")
- ADR-0012 — 5 tablas separadas (contexto de modelo)
