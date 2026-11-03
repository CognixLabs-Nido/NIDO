# ADR-0065: Los mandatos SEPA solo se escriben por sus funciones

## Estado

`accepted`

**Fecha:** 2026-11-03
**Autores:** responsable + claude-code
**Fase del proyecto:** F12, serie «reabrir remesas» (#481, migración `20261225120000`)

Este ADR se escribe **después** de aplicar el cierre en producción, a propósito: mientras la puerta
estuvo abierta, el PR, los commits y la documentación solo decían «se cierra la escritura directa
en `mandatos_sepa`; solo las funciones». Aquí queda la historia entera.

## Contexto

Un mandato SEPA activo es lo que autoriza al centro a cobrar a una familia por banco: la remesa
toma de ahí el IBAN y el titular. Su ciclo legítimo tiene cuatro funciones, todas SECURITY DEFINER
de `postgres`, el dueño de la tabla:

- `registrar_mandato_sepa`: la familia firma (o la admin registra una firma presencial). Exige
  firma, hash del texto, fecha, y cifra el IBAN.
- `sustituir_mandato_sepa`: revoca el activo y crea el nuevo, en la misma transacción. Es el único
  sitio donde se revoca un mandato.
- `anular_alta` y `destruir_fiscal_familia`: el servidor, al deshacer un alta o al destruir lo
  fiscal de una familia.

Pero la tabla también se podía escribir **directamente**, sin pasar por ellas.

- `mandatos_sepa_insert` y `mandatos_sepa_update` (desde `20260624120000`, rehechas en
  `20260725120000` al pasar el mandato a la familia) dejaban a una sesión `authenticated`
  insertar y actualizar si era admin del centro o tutor de la familia. Su único filtro era quién;
  no qué ni cómo.
- `service_role` tenía los privilegios por defecto de Supabase: INSERT, UPDATE, DELETE, TRUNCATE y
  MAINTAIN, sin RLS.

### Qué se podía hacer, medido

Ensayo en producción del 2026-11-03, con roles y claims reales y terminado en RAISE (no dejó
filas; LF y CRLF), por la API como la usaría un cliente:

| Quién                                  | Qué                                                                                                                                                                                                                                                                          | Resultado                                                                     |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| tutor, admin del centro, service_role  | **Crear un mandato sin firma**: solo centro, familia, usuario, identificador, titular e IBAN. Sin imagen de firma, sin hash, sin fecha. El estado no se decía, así que tomaba el DEFAULT, `activo`                                                                           | abierto                                                                       |
| tutor de la familia                    | **Cambiar cualquier columna de su mandato**, una a una: el titular, el IBAN cifrado y sus cuatro últimas cifras, el estado, `deleted_at`, el identificador, la firma, el hash, la fecha de firma, el método, el niño, el usuario, el centro y las fechas de alta y de cambio | abierto en 18 de 19 columnas; `familia_id` no (la RLS: no es de otra familia) |
| admin del centro, service_role         | Cambiar el titular y el estado de un mandato                                                                                                                                                                                                                                 | abierto                                                                       |
| tutor de la familia                    | **Revocar el activo y reactivar uno revocado**: dos UPDATE de `estado`, sin pasar por `sustituir_mandato_sepa`                                                                                                                                                               | abierto                                                                       |
| tutor, admin del centro                | Borrar un mandato                                                                                                                                                                                                                                                            | 0 filas (no había política de DELETE)                                         |
| service_role                           | Borrar un mandato; vaciar la tabla (TRUNCATE)                                                                                                                                                                                                                                | abierto                                                                       |
| un usuario sin relación con la familia | Crear un mandato (control)                                                                                                                                                                                                                                                   | 42501, la RLS                                                                 |

Es decir: el tutor o la admin podían dejar una familia con un mandato **activo que nadie había
firmado**, cambiar el titular o el IBAN de uno firmado, o volver a activar uno revocado. La remesa
siguiente lo habría cobrado. `service_role` solo vive en el servidor, así que su camino no lo tenía
un usuario; se cierra igual porque ningún camino legítimo lo necesita.

### Lo que la app hizo, medido

- **La app nunca escribió la tabla con la sesión de un usuario.** Medido en todo el historial de
  `src/` fuera de los tests (`git log -G`): ninguna escritura directa con el cliente de sesión.
- **El código del servidor sí la escribió directamente, con `createServiceRoleClient()`, en dos
  ventanas, y ya no:**
  - el paso 8 del alta hacía el INSERT y el UPDATE del mandato en #151 (2026-06-26); #152, el mismo
    día, lo pasó a la función;
  - `purgarCurso` anulaba la ruta del documento y después borraba los mandatos (#153 y #154,
    2026-06-27); #201 (2026-07-10) retiró la purga entera.

  Desde #201, la app solo **lee** `mandatos_sepa` (siete consultas, censadas el 2026-11-03) y
  escribe por `registrar_mandato_sepa` y `sustituir_mandato_sepa`.

- **En los datos de producción no se ve ningún caso, dentro de lo que se puede ver.** Hay tres
  mandatos. La auditoría de la tabla (`audit_mandatos_sepa`) existe desde #334 (2026-10-11) y
  registra dos escrituras: un INSERT y un UPDATE en el mismo instante, el UPDATE cambiando solo
  `estado` de `activo` a `revocado`. Es exactamente lo que hace `sustituir_mandato_sepa`. Los otros
  dos mandatos son anteriores a la auditoría (2026-07-20 y 2026-08-13), así que **su historia no
  está registrada**. Tienen la forma de los que crea la función (hash de 64, firma digital), pero
  eso es una forma, no una prueba.

## Opciones consideradas

### Opción A: dejarlo como estaba

**Pros:** sin trabajo; la app no usa esos caminos.

**Contras:** que la app no los use no los cierra. Cualquiera con una sesión de tutor o de admin
llega a la API sin la app. Es dinero de una familia.

### Opción B: estrechar las políticas (columnas, transiciones de estado)

**Pros:** mantiene la escritura directa para lo que la necesite.

**Contras:** nada la necesita. Habría que reescribir en políticas lo que ya comprueban las
funciones (firma, hash, una transición de estado legítima, el cifrado del IBAN), en dos sitios, y
el segundo se queda atrás en el primer cambio.

### Opción C: quitar la escritura directa a todos; solo las funciones

**Pros:** un solo camino, el que ya valida. Es el precedente de la casa:
`info_medica_emergencia`, `20261124120000`.

**Contras:** los tests que se montaban mandatos a mano con `service_role` tienen que escribirlos
de otra forma.

## Decisión

**Se elige la Opción C** (decisión del responsable del 2026-11-03), con el criterio de siempre
para `service_role`: si ningún camino legítimo lo necesita, se cierra para todos.

`20261225120000_fix_mandatos_solo_por_funciones`:

- `DROP POLICY mandatos_sepa_insert` y `mandatos_sepa_update`; queda `mandatos_sepa_select`.
- `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, MAINTAIN` a `PUBLIC`, `anon`, `authenticated` y
  `service_role`. El SELECT no cambia.
- Las cuatro funciones siguen escribiendo porque son SECURITY DEFINER de `postgres`, el dueño de la
  tabla, al que el REVOKE no alcanza.
- **Guarda previa:** las políticas son las esperadas, las cuatro funciones son SECURITY DEFINER de
  `postgres`, la tabla es de `postgres` y **ninguna otra función de la base la escribe**. Si un día
  aparece una quinta, la migración no corre hasta revisarla.
- **Guarda posterior:** ningún rol de los tres conserva un privilegio de escritura, ni de tabla ni
  de columna. `authenticated` y `service_role` conservan el SELECT, `postgres` sigue escribiendo y
  queda solo la política de lectura.

**Regla para lo que venga:** una escritura nueva de un mandato va por función, nunca por política
ni por `service_role`.

## Consecuencias

### Positivas

- Un mandato activo solo existe si lo creó `registrar_mandato_sepa` o `sustituir_mandato_sepa`, con
  su firma, su hash y su IBAN cifrado. Solo se revoca por `sustituir_mandato_sepa`.
- La guarda previa vigila que no aparezca otro escritor sin que nadie lo mire.

### Negativas

- Los tests escriben los mandatos que necesitan a mano como `postgres` por psql
  (`src/test/rls/mandatos-como-postgres.ts`). Ese camino solo existe en la BD efímera del CI
  (`DB_URL`).

### Neutras

- Los dos mandatos anteriores a la auditoría no se pueden reconstruir. Se deja escrito arriba.

## Verificación

- **Ensayo en producción** (2026-11-03, terminado en RAISE): antes de la migración, los caminos de
  la tabla de arriba, abiertos; con la migración, los 33 caminos directos dan 42501, y registrar
  (tutor), registrar presencial (admin) y sustituir pasan.
- **Control de cada guarda:** aplicada dos veces, sin el REVOKE a `service_role`, sin quitar la
  política de UPDATE y con una quinta función que escribe la tabla, la migración aborta.
- **Test** `mandatos-solo-por-funciones.rls.test.ts`: lo legítimo pasa; el INSERT, el UPDATE de cada
  columna y el DELETE, del tutor, de la admin y de `service_role`, dan 42501, y el mandato queda
  igual. **Control negativo:** la misma rama sin la migración (run 41678885828) pone en rojo cada
  una de esas celdas, salvo el `familia_id` del tutor, que ya cerraba la RLS. El INSERT se intenta
  en una familia sin mandato, para que el 42501 no pueda salir del índice de un activo por familia.
- **Aplicado en producción**, comprobado el 2026-11-03 en solo lectura y probándolo: registrada en
  `schema_migrations`; solo la política de lectura; `authenticated` y `service_role` sin INSERT,
  UPDATE, DELETE, TRUNCATE ni MAINTAIN; y un INSERT, dos UPDATE y un DELETE de cada uno dan 42501,
  mientras `postgres` (el control) pasa.

## Referencias

- Migración: `20261225120000_fix_mandatos_solo_por_funciones`. Precedente:
  `20261124120000` (`info_medica_emergencia`).
- Políticas de origen: `20260624120000_phase11g_0_altas_documentos_fundacion`,
  `20260725120000_phase_f2c1_mandato_familia`.
- PRs: #481 (el cierre); #151, #152, #153, #154 y #201 (las escrituras del servidor y su retirada);
  #334 (la auditoría).
- `docs/architecture/rls-policies.md`, «Los mandatos SEPA: solo por sus funciones».
