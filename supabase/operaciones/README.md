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

## Lo que no se puede hacer con SQL: Storage

Los ficheros de Storage no se borran con SQL. `storage.protect_delete` rechaza el `DELETE` sobre `storage.objects`, y forzarlo con `storage.allow_delete_query` borra la fila y deja el fichero guardado, inalcanzable. Una operación que borra ficheros es un guion `.mjs` que va por la API de Storage, con el mismo patrón:

- **la lista fija en el fichero**, por el md5 de la ruta completa (`bucket/nombre`), nunca por un predicado («lo que esté bajo un centro inexistente»): si aparece otro, la operación falla y lo nombra;
- **las guardas antes de borrar**, en SQL de solo lectura (Management API con `read_only: true`): recuento exacto, la forma de cada fichero, que ninguna fila de la base lo nombra (con un control positivo en la misma pasada) y que la API lo ve;
- **después, que ya no están**: ni en `storage.objects` ni en la API, cada bucket con lo que tenía menos lo borrado y el resto idéntico. El 200 de la API no basta, como no basta el «success» del SQL Editor;
- **ensayo:** `--ensayo` comprueba todo, imprime lo que borraría y termina con error («ENSAYO OK, nada borrado»); `--aplicar` borra. Sin ninguno de los dos no hace nada;
- **el test:** el mismo `operar` corre en la CI contra la BD efímera, con un control negativo por guarda.

No es una transacción: si se corta a medias, la guarda de la lista falla al repetirla. Se mira qué quedó.

## Operaciones

| Fichero                                        | Qué hace                                                                                       | Diagnóstico                                         |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `20261012120000_limpieza_basura_test.sql`      | Borra los 8 centros de test y la auditoría que dejó la suite RLS en producción                 | `docs/operations/limpieza-basura-test-2026-10.md`   |
| `20261012130000_borrar_usuarios_auth_test.sql` | Borra los 16 usuarios `@nido.test` que la suite dejó en Auth, sin dejar rastro en `audit_log`  | `docs/operations/limpieza-basura-test-2026-10.md`   |
| `20261210100000_vinculo_segundo_tutor.sql`     | Da al segundo tutor el vínculo con el hermano que el alta de antes del #291 no le dio          | `docs/operations/vinculo-segundo-tutor-2026-10.md`  |
| `20261229100000_cid_prueba_cei_ejemplo.sql`    | Pone a CEI Ejemplo, centro de pruebas, un CID ficticio con formato válido: no vale para cobrar | `docs/operations/cid-prueba-cei-ejemplo-2026-11.md` |
| `20270106120000_borrar_huerfanos_storage.mjs`  | Borra por la API de Storage los 60 PDF de test bajo 20 centros que ya no existen               | `docs/operations/huerfanos-storage-2026-11.md`      |
