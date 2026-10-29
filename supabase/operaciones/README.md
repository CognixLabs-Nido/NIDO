# `supabase/operaciones/` — operaciones de datos de una sola vez

Aquí van los SQL que se ejecutan **una vez, a mano, en producción** y que **no son migraciones**: limpiezas, correcciones de datos o purgas. No cambian el esquema.

## Por qué no van en `supabase/migrations/`

- La CI aplica todas las migraciones en una BD efímera vacía en cada PR (`rls-local.yml`) y cada madrugada (`nocturna.yml`). Una operación de datos con guardas de recuento exacto fallaría allí siempre, porque esos datos no existen.
- No se registran en `supabase_migrations.schema_migrations`. El job vigía compara ese registro con los ficheros de `supabase/migrations/`; una operación registrada aparecería como deriva.

## Convención

- **Nombre:** `AAAAMMDDHHMMSS_descripcion.sql`, con la misma marca de tiempo que una migración, para ordenarlas.
- **Una sola sentencia:** todo el fichero es un único bloque `DO`, así que es una sola transacción. Si falla cualquier guarda, se lanza una excepción y no queda nada hecho.
- **Guardas obligatorias:**
  - al principio, que lo que se va a conservar está como se espera (por ejemplo, los recuentos de ANAIA);
  - recuentos exactos de lo que borra o cambia cada paso, fijados en el propio fichero tras el diagnóstico;
  - al final, que lo que se conserva sigue idéntico.
- **Ensayo:** anteponiendo `SET nido.ensayo = 'on';` el bloque corre entero, comprueba todas las guardas y termina en `RAISE EXCEPTION` con los recuentos, sin confirmar nada. Sin esa línea, el fichero tal cual aplica de verdad.
- **Cómo se aplica:** el responsable pega en el SQL Editor el `cat` del fichero commiteado, con el md5 verificado. Nunca se reescribe a mano.
- **Después:** el fichero se queda en el repo como registro de lo que se hizo; no se vuelve a ejecutar. Su diagnóstico va en `docs/operations/`.

## Operaciones

| Fichero                                        | Qué hace                                                                                      | Diagnóstico                                        |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `20261012120000_limpieza_basura_test.sql`      | Borra los 8 centros de test y la auditoría que dejó la suite RLS en producción                | `docs/operations/limpieza-basura-test-2026-10.md`  |
| `20261012130000_borrar_usuarios_auth_test.sql` | Borra los 16 usuarios `@nido.test` que la suite dejó en Auth, sin dejar rastro en `audit_log` | `docs/operations/limpieza-basura-test-2026-10.md`  |
| `20261210100000_vinculo_segundo_tutor.sql`     | Da al segundo tutor el vínculo con el hermano que el alta de antes del #291 no le dio         | `docs/operations/vinculo-segundo-tutor-2026-10.md` |
