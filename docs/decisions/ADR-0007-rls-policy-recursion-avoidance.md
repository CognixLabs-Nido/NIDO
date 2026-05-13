# ADR-0007: Evitar recursión en políticas RLS con helpers SECURITY DEFINER

## Estado

`accepted`

**Fecha:** 2026-05-13
**Autores:** Iker Milla, claude-code
**Fase del proyecto:** Fase 2 — Entidades core + RLS + audit log

## Contexto

Al aplicar las primeras políticas RLS de Fase 2 sobre `ninos`, `matriculas`, `info_medica_emergencia` y `vinculos_familiares`, los tests de aislamiento fallaron sistemáticamente con:

```
SQLSTATE 42P17: infinite recursion detected in policy for relation "ninos"
```

Las políticas afectadas eran de este estilo:

```sql
-- ninos_profe_select
CREATE POLICY ninos_profe_select ON public.ninos
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.matriculas m
      WHERE m.nino_id = public.ninos.id
        AND m.fecha_baja IS NULL
        AND public.es_profe_de_aula(m.aula_id)
    )
  );

-- matriculas_admin_all
CREATE POLICY matriculas_admin_all ON public.matriculas
  FOR ALL USING (
    public.es_admin((SELECT centro_id FROM public.ninos WHERE id = matriculas.nino_id))
  );
```

### Por qué se manifiesta

PostgreSQL evalúa la política RLS de una tabla cada vez que un usuario lee/escribe esa tabla. Las **subqueries inline** dentro del `USING (...)` se ejecutan en el contexto del invocador, no del propietario, lo que dispara recursivamente las políticas RLS de la tabla referenciada.

En nuestro caso:

1. El cliente hace `SELECT * FROM ninos`.
2. Postgres evalúa `ninos_profe_select`. La subquery `SELECT 1 FROM matriculas ...` se ejecuta con RLS aplicada a `matriculas`.
3. Postgres evalúa `matriculas_admin_all`. La subquery `SELECT centro_id FROM ninos WHERE ...` se ejecuta con RLS aplicada a `ninos`.
4. Vuelta al paso 2. Bucle. Postgres detecta y lanza `42P17`.

Esto no se ve hasta que hay **dos o más políticas que se referencian cruzadamente vía subqueries inline**. Una política aislada con subquery a otra tabla funciona; pero en cuanto la segunda tabla también referencia a la primera, recursión garantizada.

Las funciones `SECURITY DEFINER` que usamos como helpers (`public.es_admin`, `public.es_profe_de_aula`, etc.) **sí** bypassean RLS internamente, pero la subquery `(SELECT centro_id FROM ninos WHERE ...)` que se pasa como argumento se evalúa **antes** de invocar al helper, en el contexto del invocador, así que sigue disparando las políticas de `ninos`.

## Opciones consideradas

### Opción A: Encapsular los lookups en SECURITY DEFINER helpers (elegida)

Crear funciones helper que devuelvan los valores derivados y se ejecuten con bypass de RLS:

```sql
CREATE OR REPLACE FUNCTION public.centro_de_nino(p_nino_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT centro_id FROM public.ninos WHERE id = p_nino_id;
$$;

CREATE OR REPLACE FUNCTION public.es_profe_de_nino(p_nino_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.matriculas m
    JOIN public.profes_aulas pa ON pa.aula_id = m.aula_id
    WHERE m.nino_id = p_nino_id
      AND m.fecha_baja IS NULL AND m.deleted_at IS NULL
      AND pa.profe_id = auth.uid()
      AND pa.fecha_fin IS NULL AND pa.deleted_at IS NULL
  );
$$;
```

Y reescribir las políticas:

```sql
CREATE POLICY ninos_profe_select ON public.ninos
  FOR SELECT USING (public.es_profe_de_nino(id));

CREATE POLICY matriculas_admin_all ON public.matriculas
  FOR ALL USING (public.es_admin(public.centro_de_nino(nino_id)));
```

**Pros:**

- Resuelve la recursión por construcción: los joins viven dentro de funciones que bypassean RLS.
- Las políticas quedan más legibles (`USING (public.es_profe_de_nino(id))` lee como inglés).
- Las helpers son reutilizables por server actions y por queries directas (con `GRANT EXECUTE`).
- Sin cambio en la semántica de seguridad: las funciones tienen autorización explícita en su lógica.

**Contras:**

- Una función adicional por cada relación derivada que aparezca en políticas.
- Requiere disciplina: cualquier dev nuevo escribiendo una política con `SELECT col FROM otra_tabla` inline puede reintroducir la recursión.

### Opción B: Materializar el lookup en una columna denormalizada

Por ejemplo, añadir `centro_id` a `matriculas` (ya está en `ninos`, derivable pero almacenada redundante) para que la política compare con la columna directamente.

**Pros:**

- Sin subquery → sin recursión.
- Marginalmente más rápido (sin join).

**Contras:**

- Denormalización con todos los costes asociados: triggers para mantener consistencia, riesgo de divergencia.
- Multiplicado por cada relación que aparezca en políticas (matriculas, info_medica_emergencia, vinculos_familiares, agendas_diarias, ...). El esquema se contamina rápido.
- Las migraciones que cambien la relación canónica niño↔centro tienen que sincronizar muchas tablas.

### Opción C: Desactivar RLS para las tablas con relaciones cruzadas y validar en server actions

Solución poco honesta: no puede llamarse "default DENY ALL en RLS" si los datos sensibles dependen de validación aplicativa.

**Pros:**

- Cero recursión.

**Contras:**

- Pierde el modelo de seguridad central de NIDO. Un bug en server actions filtra datos. Tests RLS dejan de ser válidos.
- Inadmisible para datos médicos / RGPD.

## Decisión

**Se elige la Opción A**: helpers SECURITY DEFINER que devuelven valores derivados (centro_id, booleano de pertenencia, etc.) y se invocan desde las políticas con argumento simple, no subquery.

Como **regla operativa** para todas las fases siguientes:

> Cuando una política RLS necesite consultar otra tabla, el lookup va en una función `SECURITY DEFINER STABLE` con `search_path = public` (más `extensions` si usa pgcrypto u otras). La política la invoca con argumentos de columna directamente, **nunca con `(SELECT col FROM otra_tabla WHERE ...)` inline**.

## Consecuencias

### Positivas

- Las políticas quedan legibles y atómicas.
- Las helpers son testeables independientemente.
- Fases 3–10 (que tendrán políticas más complejas: agendas, mensajería, autorizaciones, etc.) tienen un patrón ya validado.
- Los `GRANT EXECUTE ... TO authenticated` permiten que las helpers se llamen también desde server actions cuando el cliente quiera la información derivada (por ejemplo, "¿soy profe de este niño?" desde la UI sin tener que hacer un join).

### Negativas

- Hay que descubrir la recursión en tests RLS, no es obvia leyendo el SQL. Mitigación: este ADR y los tests RLS son el airbag.
- Catálogo de helpers crece con cada fase. Mitigación: agruparlos en una sección "Helpers RLS" de la migración, y en `docs/architecture/rls-policies.md`.

### Neutras

- Helpers en `public.*` (no `auth.*`) por la restricción de plataforma documentada en [ADR-0002](ADR-0002-rls-helpers-in-public-schema.md).

## Plan de implementación

- [x] Crear migración correctiva `20260513213550_phase2_fix_rls_recursion.sql` con `centro_de_nino`, `centro_de_aula`, `es_profe_de_nino` y reescribir las políticas afectadas.
- [x] `GRANT EXECUTE` de las nuevas helpers a `authenticated`.
- [x] Verificar con tests RLS (`aulas.rls.test.ts`, `vinculos.rls.test.ts`, `info-medica.rls.test.ts`) que la recursión desaparece y la semántica se mantiene.
- [ ] En `docs/architecture/rls-policies.md`: añadir sección "Patrón: helpers para lookups en políticas" con ejemplo de antipatrón y patrón correcto. Hacerlo durante la actualización de docs de Fase 2.
- [ ] En cada futura migración con políticas RLS sobre joins: revisar que ningún `USING (...)` contiene `SELECT col FROM otra_tabla`.

## Verificación

- Tests RLS de Fase 2 pasan en verde (13/13 archivos, 36/36 tests).
- En particular, los 8 tests que fallaban con `42P17` (`aulas.rls.test.ts` x2, `vinculos.rls.test.ts` x2, `info-medica.rls.test.ts` x2, y derivados en `cifrado.test.ts` x2) pasan tras aplicar la migración correctiva.
- Lectura cualitativa: las políticas quedan `USING (public.helper(columna))` sin subqueries.

## Notas

- **`SECURITY DEFINER` no es lo mismo que "bypass RLS"** — lo que da el bypass es que el rol propietario de la función (`postgres` en Supabase) tiene atributo `BYPASSRLS`. La función ejecuta su SQL como ese rol, por eso las queries internas no disparan políticas. Si en algún momento creamos funciones cuyo owner no sea `postgres`, el bypass desaparece.
- **`STABLE` es importante**: marca la función como deterministic dentro de la query y permite a Postgres cachear resultados en planes, lo que importa cuando la helper se invoca muchas veces por fila en un `SELECT` grande.
- **Las funciones que devuelven booleano** (`es_profe_de_nino`, `tiene_permiso_sobre`, `pertenece_a_centro`) se invocan con `USING (helper(col))` directamente y son lo más limpio. Las que devuelven UUIDs (`centro_de_nino`, `centro_de_aula`) se invocan **dentro** de otra helper booleana: `public.es_admin(public.centro_de_nino(nino_id))`. Ese patrón compuesto también está libre de recursión porque ambas son SECURITY DEFINER.

## Referencias

- Spec: `docs/specs/core-entities.md` (sección Políticas RLS).
- ADR-0002 (helpers en `public.*`).
- Migraciones: `supabase/migrations/20260513202012_phase2_core_entities.sql`, `supabase/migrations/20260513213550_phase2_fix_rls_recursion.sql`.
- Postgres docs: [SECURITY DEFINER + RLS interactions](https://www.postgresql.org/docs/current/sql-createpolicy.html).
