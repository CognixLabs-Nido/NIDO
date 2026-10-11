# La nocturna: suite en efímera y vigía de producción

Workflow: `.github/workflows/nocturna.yml`. Corre cada madrugada a las 02:17 UTC (03:17 en invierno y 04:17 en verano, hora de Madrid). También se puede lanzar a mano desde `main` (Actions → «Nocturna» → _Run workflow_), por ejemplo justo después de aplicar una migración en producción.

Sustituye a la nocturna antigua (`rls-suite.yml`), que corría la suite contra producción y dejó allí 28.331 filas de `audit_log` y 8 centros de test. Su cron está apagado desde #340, y `src/test/guarda-bd-local.ts` impide que la suite vuelva a correr contra una BD que no sea local.

## Qué hace cada job

**Suite RLS (efímera).** La suite RLS completa sobre `main` en una BD efímera: es `rls-local.yml`, el mismo check de los PRs (tres shards y el resumen), llamado como workflow reutilizable. Caza lo que rompe `main` por la combinación de varios merges y los tests intermitentes. No toca producción ni siembra nada.

**Vigía de producción (solo lectura).** Se conecta a producción con el rol `vigia_catalogo` (secret `PROD_CATALOGO_DB_URL`; ver `docs/vigia-credencial.md`). No escribe ni siembra. Hace tres comprobaciones:

- **a. Registro de migraciones.** Las versiones de `vigia.migraciones()` contra los ficheros de `supabase/migrations`. Si falta o sobra alguna, falla y dice cuál. Compara versiones y no nombres: hay filas antiguas registradas a mano sin nombre.
- **b. Deriva de catálogo.** La huella `scripts/vigia/huella.sql` se saca dos veces como `vigia_catalogo`: en producción y en una BD efímera construida desde el repo. `scripts/vigia/comparar-huellas.mjs` dice qué objeto difiere. La huella cubre:
  - de las funciones de `public` y `vigia`: cuerpo normalizado, definición, `SECURITY DEFINER` y dueño, `search_path` y permisos;
  - de las tablas: si existen, la RLS activada, los permisos de tabla y de columna, las columnas, los constraints y los índices;
  - los enums, los triggers (también los de nuestras funciones sobre `auth.users`), las policies de `public` y `storage`, los privilegios por defecto de `postgres` y los buckets.
- **b. Control negativo.** Después, en la efímera (nunca en producción), provoca tres derivas: cambia el cuerpo de `hoy_madrid()`, borra una policy de `centros` y da `SELECT` de `centros` a `anon`. El comparador tiene que encontrar exactamente esas tres; si no, la vigilancia está ciega y el job falla.
- **c. Configuración que no está en migraciones.** Que el signup público siga cerrado (`disable_signup` de `/auth/v1/settings`) y que en Vault existan los secretos que declara `[db.vault]` de `supabase/config.toml`. Los nombres se comparan dentro de la BD y solo salen recuentos.

**Aviso de rojo.** Si cualquiera de los dos jobs falla, se abre un issue con la etiqueta `nocturna-roja`, con una tabla de qué comprobación falló y el enlace al run. Si ya hay uno abierto con esa etiqueta, se añade un comentario en vez de abrir otro. El issue no se cierra solo: se cierra a mano cuando alguien lo ha revisado.

## Qué sale en el log

El repo es público y el log también. El job vigía imprime nombres de objeto (funciones, tablas, policies… que ya están en el repo), versiones de migración, recuentos y, solo cuando difieren, los permisos de los dos lados (roles y privilegios). Nunca contenido de datos, nunca definiciones de función y nunca nombres de secretos de Vault.

## Cuando la vigía da rojo

- **Registro:** una migración del repo sin registrar en producción suele ser una que está mergeada y Jose aún no ha aplicado. Una registrada sin fichero es una aplicada a mano que no está en el repo.
- **Catálogo:** «difiere» quiere decir que el objeto existe en los dos lados con otra definición; «solo en producción» o «solo en el repo», que falta en uno. Si la diferencia es legítima y se va a quedar, va a `scripts/vigia/diferencias-conocidas.tsv` con su motivo. Si no, se arregla con una migración.
- **Control negativo:** el comparador o la huella se han roto; no es un problema de producción.

## En un pull request

El workflow corre también en los PRs que tocan `nocturna.yml` o `scripts/vigia/**`, para validar el cambio contra producción antes de mergearlo. En ese caso la efímera sale de la rama del PR, y el aviso solo enseña en el log el issue que abriría (simulacro).
