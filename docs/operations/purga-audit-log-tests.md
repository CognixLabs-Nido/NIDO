# Purga única de `audit_log`: residuo de las suites RLS

**Estado:** preparada, SIN ejecutar. La ejecuta el responsable tras aprobar el conteo.

## Por qué

- **El problema:** las suites RLS corren contra el remoto compartido. Sus fixtures escriben en `audit_log` con service_role, así que esas filas llevan `usuario_id` NULL. El wipe solo borraba `audit_log` por `usuario_id`, y esas filas no se borraban nunca.
- **Lo que se acumuló:** a 30-sep-2026 había 805.059 filas de 38.492 centros de test que ya no existen, el 97 % de la tabla. De ahí vinieron los timeouts del nightly (resueltos con el índice de #279).
- **Lo que evita que vuelva a pasar:** desde este PR, el wipe (paso 8-bis de `src/test/rls/global-setup.ts`) y `deleteTestCentro` limpian la auditoría de sus centros de test. El wipe **no** hace esta purga histórica: si ve más de 2.000 centros de test borrados, avisa y no toca nada.

## Qué se borra y qué no

**Se borran** las filas cuyo `centro_id` cumple las tres condiciones:

1. El centro **ya no existe** en `centros`.
2. Su **propia auditoría** prueba que era de test: el alta (`INSERT`, `valores_despues`) o la baja (`DELETE`, `valores_antes`) tiene `email_contacto` en `@nido.test`, **y ninguna** fila de ese centro muestra otro email. El invariante de las suites es que los centros de test usan siempre `@nido.test` y los reales nunca.
3. No es ANAIA (`33c79b50-13b5-4962-b849-d88dd6a21366`), que queda excluida por id.

**No se tocan:**

- las filas de centros que existen (459 a 30-sep, de las que 163 son de ANAIA);
- las filas con `centro_id` NULL (24.606): no hay un criterio seguro para atribuirlas a test.

**Protección de la tabla:** `audit_log` no tiene triggers ni reglas. El «append-only» es solo RLS (no hay policy de DELETE). postgres y service_role se la saltan, así que la purga no necesita tocar ni debilitar nada.

## 1. Identificar (solo lectura)

```sql
WITH centros_test_borrados AS (
  SELECT a.registro_id AS centro_id
  FROM public.audit_log a
  WHERE a.tabla = 'centros'
    AND a.registro_id <> '33c79b50-13b5-4962-b849-d88dd6a21366'
    AND NOT EXISTS (SELECT 1 FROM public.centros c WHERE c.id = a.registro_id)
  GROUP BY a.registro_id
  HAVING bool_or(coalesce(a.valores_despues, a.valores_antes)->>'email_contacto' ILIKE '%@nido.test')
     AND NOT bool_or(coalesce(a.valores_despues, a.valores_antes)->>'email_contacto' NOT ILIKE '%@nido.test')
)
SELECT
  (SELECT count(*) FROM centros_test_borrados)                                              AS centros_test_borrados,
  (SELECT count(*) FROM public.audit_log a JOIN centros_test_borrados t USING (centro_id))  AS filas_a_borrar,
  (SELECT count(*) FROM public.audit_log a WHERE a.centro_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.centros c WHERE c.id = a.centro_id))              AS filas_centro_inexistente_total,
  (SELECT count(*) FROM public.audit_log a
     WHERE EXISTS (SELECT 1 FROM public.centros c WHERE c.id = a.centro_id))                AS filas_centros_vivos,
  (SELECT count(*) FROM public.audit_log a JOIN centros_test_borrados t USING (centro_id)
     WHERE EXISTS (SELECT 1 FROM public.centros c WHERE c.id = a.centro_id))                AS vivas_que_tocaria,
  (SELECT count(*) FROM centros_test_borrados
     WHERE centro_id = '33c79b50-13b5-4962-b849-d88dd6a21366')                              AS anaia_que_tocaria,
  (SELECT count(*) FROM public.audit_log WHERE centro_id IS NULL)                           AS filas_sin_centro_no_se_tocan,
  (SELECT count(*) FROM public.audit_log)                                                   AS total;
```

Resultado a 30-sep-2026:

| centros_test_borrados | filas_a_borrar | filas_centro_inexistente_total | filas_centros_vivos | vivas_que_tocaria | anaia_que_tocaria | filas_sin_centro_no_se_tocan | total   |
| --------------------- | -------------- | ------------------------------ | ------------------- | ----------------- | ----------------- | ---------------------------- | ------- |
| 38.492                | 805.059        | 805.059                        | 459                 | **0**             | **0**             | 24.606                       | 830.124 |

Hay que parar si `vivas_que_tocaria` o `anaia_que_tocaria` salen distintos de 0, o si `filas_a_borrar` no cuadra con lo aprobado. Cada nightly añade unas 30.000 filas, así que el número exacto crece un poco de un día para otro.

## 2. Ensayo (no confirma nada)

El ensayo no usa `BEGIN … ROLLBACK`. Si la petición se corta a mitad, el ROLLBACK podría no ejecutarse, y la Management API trata una petición con varias sentencias como una transacción implícita que **confirma**. En su lugar, un bloque `DO` termina **siempre** en `RAISE EXCEPTION`, y ese error deshace el DELETE pase lo que pase.

```sql
DO $$
DECLARE borradas bigint; vivas_d bigint; anaia_d bigint; t0 timestamptz := clock_timestamp(); t_del interval;
BEGIN
  WITH centros_test_borrados AS (
    SELECT a.registro_id AS centro_id
    FROM public.audit_log a
    WHERE a.tabla = 'centros'
      AND a.registro_id <> '33c79b50-13b5-4962-b849-d88dd6a21366'
      AND NOT EXISTS (SELECT 1 FROM public.centros c WHERE c.id = a.registro_id)
    GROUP BY a.registro_id
    HAVING bool_or(coalesce(a.valores_despues, a.valores_antes)->>'email_contacto' ILIKE '%@nido.test')
       AND NOT bool_or(coalesce(a.valores_despues, a.valores_antes)->>'email_contacto' NOT ILIKE '%@nido.test')
    LIMIT 2000
  )
  DELETE FROM public.audit_log a USING centros_test_borrados t WHERE a.centro_id = t.centro_id;
  GET DIAGNOSTICS borradas = ROW_COUNT;
  t_del := clock_timestamp() - t0;
  SELECT count(*) INTO anaia_d FROM public.audit_log WHERE centro_id = '33c79b50-13b5-4962-b849-d88dd6a21366';
  SELECT count(*) INTO vivas_d FROM public.audit_log a JOIN public.centros c ON c.id = a.centro_id;
  RAISE EXCEPTION 'ENSAYO_ROLLBACK lote: borradas=% en % | tras el DELETE: vivas=% anaia=%', borradas, t_del, vivas_d, anaia_d;
END $$;
```

Resultado a 30-sep-2026:

- Salida: `borradas=43541 en 00:00:11.858 | tras el DELETE: vivas=459 anaia=163`.
- Recuento posterior: la tabla seguía con 830.124 filas.
- El ensayo es de **un lote**. El DELETE completo en una sola transacción supera los ~100 s de la ventana HTTP de la API y del SQL Editor, así que ese ensayo único no es posible.

## 3. Purga (SOLO con visto bueno)

Por lotes de 2.000 centros, unas 43.000 filas y unos 12 s cada uno. Cada ejecución es **una** sentencia y se confirma sola. Se repite hasta que devuelva `DELETE 0`: unos 19 lotes a 30-sep. Cada lote borra también las filas `centros` de esos centros, así que el siguiente avanza solo.

```sql
WITH centros_test_borrados AS (
  SELECT a.registro_id AS centro_id
  FROM public.audit_log a
  WHERE a.tabla = 'centros'
    AND a.registro_id <> '33c79b50-13b5-4962-b849-d88dd6a21366'
    AND NOT EXISTS (SELECT 1 FROM public.centros c WHERE c.id = a.registro_id)
  GROUP BY a.registro_id
  HAVING bool_or(coalesce(a.valores_despues, a.valores_antes)->>'email_contacto' ILIKE '%@nido.test')
     AND NOT bool_or(coalesce(a.valores_despues, a.valores_antes)->>'email_contacto' NOT ILIKE '%@nido.test')
  LIMIT 2000
)
DELETE FROM public.audit_log a USING centros_test_borrados t WHERE a.centro_id = t.centro_id;
```

**No lanzarla mientras corre la suite RLS.** Hay que comprobar antes que no hay ningún run `in_progress` ni `queued` de `rls-suite.yml`.

## 4. Después

1. Repetir el SELECT del paso 1: `filas_a_borrar = 0`, `filas_centros_vivos = 459` (o las que hubiera), `anaia` sin cambios.
2. `VACUUM (ANALYZE) public.audit_log;` en una ejecución aparte, para recuperar el espacio y que el planner vea el tamaño real.
