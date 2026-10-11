# Credencial del job vigía (`vigia_catalogo`)

El job vigía de producción (suite a efímera, PR 2) lee producción con el rol `vigia_catalogo`, que
crea la migración `20261012120000_feat_rol_vigia_catalogo`. El rol nace **sin contraseña**: no
puede conectarse hasta que el responsable haga estos pasos.

1. **Aplicar la migración** por el SQL Editor (`cat` del fichero commiteado, md5 verificado).
2. **Generar la credencial en local:** `python3 scripts/vigia-credencial.py`.
   - Genera una contraseña aleatoria, que no se muestra en ningún momento.
   - Guarda la cadena de conexión en el secret `PROD_CATALOGO_DB_URL` del repo con `gh secret set`, por stdin.
   - Imprime una sentencia `ALTER ROLE vigia_catalogo WITH PASSWORD 'SCRAM-SHA-256$…'`. Lleva el **verificador** SCRAM, no la contraseña.
3. **Pegar esa sentencia en el SQL Editor** de producción. El historial del editor solo ve el verificador.

Para **rotar** la contraseña, se repiten los pasos 2 y 3. Para **cortar el acceso**:
`ALTER ROLE vigia_catalogo NOLOGIN;`.

La cadena de conexión es `postgresql://vigia_catalogo.<proyecto>:<contraseña>@aws-1-eu-north-1.pooler.supabase.com:5432/postgres?sslmode=require`:
el pooler en modo sesión, por IPv4, porque los runners de GitHub no tienen IPv6.

## Qué puede ver el rol y qué no

**Puede ver:**

- el catálogo de Postgres (`pg_catalog`), que cualquier rol lee por defecto: nombres y definiciones de tablas, columnas, constraints, índices, triggers, policies (con sus expresiones), funciones (con su cuerpo), tipos, permisos y privilegios por defecto;
- las estimaciones de filas por tabla (`pg_class.reltuples`, `pg_stat_user_tables`): recuentos aproximados, nunca contenido;
- a través de las tres funciones de `vigia`:
  - la versión y el nombre de cada migración aplicada;
  - la configuración de los buckets (id, nombre, si es público, límite de tamaño y tipos MIME);
  - los **nombres** de los secretos de Vault.

**No puede ver:**

- ninguna fila de ninguna tabla de negocio (`public`, `auth`, `storage.objects`, `audit_log`…);
- el valor, cifrado o no, de ningún secreto de Vault;
- el texto de las consultas de otras sesiones (`pg_stat_activity` y `pg_stat_statements` lo ocultan sin `pg_read_all_stats`);
- las estadísticas de valores de columnas (`pg_stats` filtra por privilegio de columna).

**No puede escribir** en ninguna tabla, vista o secuencia. Sus transacciones nacen en solo lectura (`default_transaction_read_only`). Lo único que Postgres concede a todo rol que se conecta es:

- tablas temporales de la propia sesión, que desaparecen al desconectar;
- `SET` de parámetros de usuario en su sesión;
- crear objetos grandes (_large objects_) propios, solo si desactiva a mano la transacción de solo lectura.

Ninguna de esas tres cosas toca datos de negocio. La guarda de salida de la migración comprueba todo esto con `has_*_privilege` cada vez que se aplica.
