# ADR-0058: Una familia por adulto y por centro

## Estado

`accepted`

**Fecha:** 2026-10-19
**Autores:** responsable + claude-code
**Fase del proyecto:** Multicentro · Fase 2

## Contexto

La Fase 1 (ADR-0057) dio a la app un centro activo. Quedaba el supuesto «un adulto, una familia» de la serie F (ADR-0051): el índice único parcial `ux_familia_tutores_usuario_unico` sobre `familia_tutores.usuario_id` impedía que un tutor tuviera familia en dos centros. Con hijos en dos escuelas, el alta del segundo centro chocaba con el índice (23505).

Ese índice sostenía además, sin decirlo, a toda la parte familia de la app. Las consultas de `/family` leían «lo de mis hijos» y se fiaban de la RLS, que deja ver lo de todos sus hijos. Mientras un tutor solo pudiera tener hijos en un centro, eso era lo mismo que «lo de este centro». Sin el índice, mezclaría los dos centros en el inicio, el gate del alta, los recibos, la domiciliación, las autorizaciones, los informes, las fotos y las citas.

`familia_tutores` no tenía centro: lo tiene la familia.

## Opciones consideradas

### Opción A: `centro_id` en `familia_tutores` derivado por trigger + índice único `(usuario_id, centro_id)`

**Pros:** lo garantiza la BD sin carreras: dos altas simultáneas del mismo adulto en el mismo centro las para el índice. Es el patrón de la casa (`derivar_centro_id_de_familia`).

**Contras:** una columna redundante que hay que mantener coherente con la familia.

### Opción B: un trigger que compruebe «no tiene otra familia viva en este centro»

**Pros:** sin columna nueva.

**Contras:** con dos altas a la vez, las dos comprobaciones pasan antes de que ninguna inserte; haría falta un bloqueo. Y es código nuevo que vigilar donde un índice no lo es.

### Opción C: mantener el índice global

**Contras:** un tutor con hijos en dos centros no se puede dar de alta en el segundo.

## Decisión

**Se elige la Opción A**, porque la regla la guarda la BD por sí sola y sin carreras.

Migración `20261020120000_feat_familia_tutores_por_centro`:

- `familia_tutores.centro_id`, rellenado desde la familia. Va con `CHECK (centro_id IS NOT NULL)` en vez de columna `NOT NULL`. El CHECK se evalúa después de los triggers BEFORE, así que la BD garantiza igual que nunca está vacío, y los tipos generados no obligan a pasarlo en cada insert, porque lo pone el trigger.
- Trigger `familia_tutores_derivar_centro`: el centro es siempre el de la familia.
  - Si quien escribe pasa otro, da 23514.
  - Si la fila cambia de familia (reasignación por service role), se recalcula.
- Trigger `familias_centro_inmutable`: el centro de una familia no cambia (23514). Si cambiara, el centro de sus tutores quedaría viejo. Nadie lo cambiaba.
- Fuera `ux_familia_tutores_usuario_unico`, dentro `ux_familia_tutores_usuario_centro (usuario_id, centro_id)` sobre filas vivas con cuenta.

**En la app, un único módulo acota la parte familia a un centro:** `src/features/centros/contexto/ambito-familiar.ts`.

- `ambitoFamiliar(centroId)` devuelve el centro y los hijos del usuario en él: vínculo vivo de cualquier tipo, con la ficha del niño en ese centro.
  - Las consultas de `/family` reciben un `AmbitoFamiliar` y no se pueden llamar sin él: el tipo lleva una marca que solo pone el módulo.
  - Las filas con su propio `centro_id` (autorizaciones, informes, publicaciones, recibos, citas) filtran por `ambito.centroId`. Es exacto también para lo que no cuelga de un hijo, como una autorización de todo el centro o un recibo de la familia.
  - Las listas de hijos (el inicio, el gate del alta, los diálogos de medicación y recogida) usan `ambito.hijos`.
- `familiaDelUsuarioEn(centroId)` sustituye a `familiaDelUsuarioActual()`, que leía «la» familia del usuario con `limit(1)`. La usan `/family/recibos` y la ruta de domiciliación. La ruta recibe el centro de la página, como las acciones con centro explícito de la Fase 1, y busca la familia con `auth.uid()` en él: un centro ajeno da «sin familia», no la de otro.
- `esDelAmbito(ambito, centroDeLaFila)`: los detalles abiertos por URL (niño, autorización, informe, recibo y su PDF) de otro centro dan **«no encontrado»**, como la lista de espera en #363. No enseñan nada que el tutor no pueda ver, pero lo enseñarían bajo el centro equivocado.

Fuera de `/family` salieron dos consultas compartidas con el personal que tampoco filtraban por centro. Se acotan al centro de la página para todos los roles:

- `getMedicacionesConActividad`, la sección de medicación de autorizaciones;
- `getCitasRango`, el widget de la semana y `/agenda`.

## Consecuencias

### Positivas

- Un tutor puede tener familia en varios centros, y cada centro le enseña solo lo suyo.
- Las altas simultáneas del mismo adulto en un centro no pueden duplicar su familia.
- Una consulta nueva de la parte familia no compila sin el ámbito.

### Negativas

- `familia_tutores.centro_id` es redundante con la familia; lo mantiene el trigger.
- El tipo generado de `familia_tutores.centro_id` es `string | null` aunque la BD no lo deje vacío (el precio del CHECK).

### Neutras

- La migración va a producción **antes** del merge: `familiaDelUsuarioEn` lee `familia_tutores.centro_id`.

## Verificación

- `src/test/rls/familia-por-centro.rls.test.ts`: un tutor con familia en A, con un hijo matriculado, y en B, creada por el alta real (`crear_o_anadir_a_familia`) con el hermano a medio alta.
  - BD: el índice (segunda familia en el mismo centro → 23505), el trigger (centro ajeno → 23514; reasignación → recalcula) y el centro de la familia, que no cambia.
  - App: el ámbito, la familia de la domiciliación, el gate (el hijo activo en A no desbloquea B), recibos (lista, detalle y PDF), citas, informes, avisos del inicio, medicación y fotos.
  - Cada caso empieza por su premisa: sin acotar, la RLS deja ver lo de los dos centros.
- `src/features/alta/lib/__tests__/gate-familia.test.ts`: el gate pide el ámbito del centro y solo cuenta los hijos `tutor_legal_*` de él.
- Ensayo de la migración contra producción, en transacción revertida: 4 filas con su centro, 0 sin centro, el índice nuevo, duplicado en el mismo centro → 23505, centro ajeno y cambio de centro de una familia → 23514. También con saltos CRLF (como la deja el SQL Editor) y con un control negativo: con un índice viejo distinto del de F-0, la guarda de entrada aborta.

## Referencias

- ADR-0051 (modelo familia), ADR-0057 (centro activo, Fase 1).
