# ADR-0066: Un DEFAULT no afirma un hecho que nadie ha comprobado

## Estado

`accepted`

**Fecha:** 2026-11-03
**Autores:** responsable + claude-code
**Fase del proyecto:** F12, serie «reabrir remesas» (#480 y el PR de `20261226120000`)

## Contexto

Un DEFAULT es lo que la base escribe cuando nadie lo dice. Si es un estado inicial inocuo
(borrador, pendiente, `false`, vacío), no pasa nada. Si **afirma un hecho**, una fila que nadie
rellenó entera queda diciendo algo que nadie comprobó, y nada se pone rojo.

El caso que lo destapó fue `recibos.estado`, con DEFAULT `pendiente_procesar`: un INSERT sin estado
creaba un recibo «pendiente de cobrar». Ahora es `borrador` (#480, `20261224120000`). Al revisar el
resto, el censo en producción (2026-11-03, solo lectura) encontró 70 columnas con DEFAULT que no
son fechas de alta, ids ni NULL. Casi todas son estados iniciales inocuos. Cuatro afirman un hecho,
y hay otra de menos peso.

## Opciones consideradas

### Opción A: dejarlos todos como están

**Pros:** sin trabajo; hoy la app dice cada valor.

**Contras:** la app no es el único camino. Las políticas dejan a una sesión escribir directamente
por la API, y `service_role` lo escribe todo. Por cualquiera de esos caminos, el DEFAULT afirma el
hecho sin que nadie lo vea.

### Opción B: cambiarlos todos en bloque

**Pros:** cierra la clase entera de una vez.

**Contras:** algunos tienen funciones que cuentan con ellos (`lineas_recibo.origen`). Quitarlos de
golpe rompe esas funciones, y cada columna tiene una respuesta distinta.

### Opción C: la regla para lo que venga, y cada columna decidida con su porqué

**Pros:** lo nuevo no nace mal, y cada columna existente queda escrita con lo que depende de ella.

**Contras:** las que se aceptan siguen afirmando el hecho por los caminos que no son la app.

## Decisión

**Se elige la Opción C.** La regla:

> **Un DEFAULT no afirma un hecho que nadie ha comprobado.** Un DEFAULT solo puede ser un estado
> inicial inocuo. Donde haga falta distinguir «no consta» de «sí», eso es `NULL`, no un valor
> alegre. Y donde «no consta» ya tiene su forma (que no haya fila), la columna va `NOT NULL` y sin
> DEFAULT: quien escribe la fila dice el hecho, o el INSERT falla.

No se aplica en bloque. Vale para toda columna nueva y para toda columna que se toque. Las que ya
existen quedan así:

| Columna                                                                    | DEFAULT      | Qué afirma                                                  | Decisión y porqué                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `recibos.estado`                                                           | `borrador`   | (era `pendiente_procesar`: «pendiente de cobrar»)           | Cambiado a `borrador` (`20261224120000`, #480).                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `parte_servicio_diario.presente`                                           | sin DEFAULT  | (era `true`: que el niño **usó el servicio**, que se cobra) | **Sin DEFAULT** (`20261226120000`). Medido en producción: una profe por la API con su sesión, y `service_role`, creaban un parte sin `presente` y quedaba `true`. La columna sigue `NOT NULL`: quien apunta el parte dice si estaba (la acción `guardarPaseServicios` siempre lo dice), y «no consta» es que no haya fila.                                                                                                                                       |
| `mandatos_sepa.estado`                                                     | `activo`     | un mandato que **ya autoriza cobrar por banco**             | Se queda. `registrar_mandato_sepa` y `sustituir_mandato_sepa` dicen `'activo'` explícitamente: medido en producción con el DEFAULT cambiado a `revocado` dentro del ensayo, las dos siguen creando el mandato `activo`. Así que el DEFAULT no es carga de ninguna función. Y desde `20261225120000` (ADR-0065) la tabla solo se escribe por sus funciones: no queda ningún camino que cree un mandato sin decir su estado.                                       |
| `biberones.tomado_completo`                                                | `true`       | un dato de un menor: **se tomó el biberón entero**          | Se acepta (decisión del responsable del 2026-11-03). Ninguna función de la base escribe biberones. La acción `upsertBiberon` siempre envía el valor, pero su esquema Zod tiene también `.default(true)`: si el formulario no lo manda, la app afirma «entero». Si algún día se distingue «no consta», es `NULL`, en la columna y en el esquema.                                                                                                                  |
| `lineas_recibo.origen`                                                     | `automatico` | que la línea es del motor (el motor la regenera)            | Se acepta (decisión del responsable del 2026-11-03). Cuentan con él 13 INSERT, medidos en producción: los 10 de `generar_recibos_mes`, el de `crear_recibo_esporadico` y 2 de los 3 de `resolver_devolucion`. Dicen `manual` la línea de la app, `anadir_cargo_puntual`, `resolver_sobrante_cheque` y la línea de arrastre de `resolver_devolucion`. Una línea manual que no lo dijera se perdería al regenerar; quien toque una de esas funciones, que lo diga. |
| `metodo_firma` (`consentimientos`, `firmas_autorizacion`, `mandatos_sepa`) | `digital`    | cómo se firmó                                               | De menos peso. Las RPC que lo escriben lo dicen, salvo `firma_imagen_sync`. Se revisa cuando se toque esa función.                                                                                                                                                                                                                                                                                                                                               |

## Consecuencias

### Positivas

- Lo nuevo no nace con un valor que afirma algo.
- Cada DEFAULT que afirma un hecho tiene escrito qué depende de él, y quién lo tiene que decir si se
  cambia.

### Negativas

- `biberones.tomado_completo` y `lineas_recibo.origen` siguen afirmando su hecho por los caminos que
  no dicen el valor. Es aceptado y está escrito aquí. `mandatos_sepa.estado` ya no tiene ese camino
  (ADR-0065).
- Sin DEFAULT en `presente`, un cliente que no envíe la columna falla (23502) en vez de guardar.
  Es lo que se busca: la app la envía siempre.

### Neutras

- `src/types/database.ts`: en el tipo Insert de `parte_servicio_diario`, `presente` pasa a ser
  obligatorio, así que un INSERT que no lo diga no compila.

## Verificación

- `pase-servicios-unico.rls.test.ts`: un parte sin `presente`, ni con la sesión de la profe ni con
  `service_role`, entra (23502). Antes lleva la premisa: la misma profe, con el mismo niño y día,
  sí apunta un parte que lo dice.
- `recibo-devuelto-cobrado-por-funcion.rls.test.ts`: un recibo sin estado nace en borrador.

## Referencias

- Migraciones: `20261224120000_fix_recibos_estado_default_borrador`,
  `20261226120000_fix_parte_presente_sin_default`.
- Spec: `docs/specs/altas-serie.md`, «Las puertas del recibo».
