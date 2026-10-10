# ADR-0051: La familia como unidad del modelo (serie F)

## Estado

`accepted`. Las decisiones se tomaron y se aplicaron entre el 2026-07-07 y el 2026-08-05; este ADR
las documenta después, el 2026-10-10.

**Fecha:** 2026-07-07 (F-0) → 2026-08-05 (D-5)
**Autores:** responsable + claude-code
**Fase del proyecto:** posterior a F12-B. Rediseño de la agrupación y la facturación (serie F).

## Contexto

Hasta F12-B el modelo colgaba casi todo **del niño**:

- **El perfil del tutor era por niño.** `datos_tutor` guardaba identidad, dirección y DNI, con una
  fila por cada niño. Un tutor con dos hijos tenía dos copias de sus datos.
- **El mandato SEPA era por niño.** `mandatos_sepa.nino_id` era `NOT NULL`, así que el alta del
  2.º hijo obligaba a volver a firmar el mandato.
- **El recibo era por niño.** Una familia con dos hijos recibía dos recibos al mes y el descuento
  por hermanos no tenía dónde vivir.
- **El método de pago era por niño.** `metodo_pago_familia` se configuraba niño a niño.

Esta duplicación ya había causado errores reales. El asistente de alta escribía `familia_tutores`
mientras la cola de cambios aplicaba sobre `datos_tutor` (#198 lo llama «split-brain»). Además,
no existía ningún sitio donde guardar «esta familia», ni para facturarla ni para decidir cuándo
pierde el acceso.

También faltaba el **ciclo de vida**:

- pasar de curso no distinguía «no continúa» de «sin marcar»;
- no había baja a mitad de curso ni reincorporación como operaciones atómicas;
- al terminar el curso, nadie retiraba el acceso a una familia sin hijos activos.

Restricciones que condicionan el diseño:

- **El momento:** la BD del piloto no tenía datos reales cuando se hizo el cambio. F-2b-3 y F-2c-1
  verifican 0 filas. Por eso se pudo endurecer sin backfill.
- **Cómo se aplica:** las migraciones van a mano por el SQL Editor.
- **Auth:** las cuentas de GoTrue solo se crean por la Admin API, nunca en SQL.
- **Auditoría:** `audit_log` es polimórfico de sujeto: `tabla + registro_id + centro_id`.

## Opciones consideradas

> No hay un documento de diseño previo con alternativas para el cambio de fondo. Lo que sigue son
> las disyuntivas que **sí** documentan las migraciones y los PRs de la serie.

### Opción A: mantener el modelo por niño

Seguir con `datos_tutor` por niño y colgar el mandato, el recibo y el método de pago del niño.

**Pros:**

- Sin migración ni riesgo de cambio.

**Contras:**

- Datos del tutor duplicados entre hermanos, que divergen (el split-brain de #198).
- El 2.º hijo vuelve a firmar el mandato SEPA.
- No hay recibo familiar ni descuento por hermanos.
- No hay unidad sobre la que decidir la pérdida de acceso.

### Opción B: la familia como unidad (elegida)

Crear `familias` y `familia_tutores` (membresía más perfil único del adulto), y colgar de la
familia el niño (`ninos.familia_id NOT NULL`), el mandato, el recibo y el método de pago.

**Pros:**

- Un solo perfil por adulto, compartido entre hermanos.
- Un solo mandato por familia, que vale para el 2.º hijo.
- Un recibo por familia y mes (ADR-0052).
- La familia es la unidad sobre la que se archiva y se revoca el acceso.

**Contras:**

- Hay que migrar todas las lecturas y escrituras del alta, y retirar `datos_tutor`.
- Aparecen casos límite nuevos: familia archivada que vuelve, tutor invitado sin cuenta y un adulto
  con roles en varias familias (ver Notas).

### Disyuntivas internas documentadas

| Tema                              | Alternativas                                                | Elegida y motivo                                                                                                                                                                                                 | Fuente                    |
| --------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Máximo de 2 tutores por familia   | trigger con `count(*)` / índice único parcial               | **Índice** `(familia_id, rol_familia) WHERE deleted_at IS NULL`. No depende de `current_user`, no tiene carreras porque el índice se valida de forma atómica y además prohíbe dos titulares.                     | F-2b-3a, `20260711120000` |
| «Finaliza» al pasar de curso      | matrícula especial / tabla de decisión                      | **Tabla `rollover_finaliza`**. Una matrícula exige un aula real (`aula_id NOT NULL` con FK a `aulas_curso`).                                                                                                     | F-3-A, `20260716120000`   |
| Mandato SEPA                      | por niño / **por familia** («opción a»)                     | **Por familia.** `nino_id` queda como dato informativo y hay un solo mandato activo por familia, con índice único parcial.                                                                                       | F-2c-1, #216              |
| RPCs del mandato                  | una / dos                                                   | **Dos.** `registrar_mandato_sepa` actualiza el mandato activo en su sitio y repetirla no cambia nada, así el alta puede corregir el IBAN. `sustituir_mandato_sepa` es atómica: revoca el activo y crea el nuevo. | #216                      |
| Guard de `revocar_acceso_familia` | niño activo con vínculo vivo / niño activo de la familia    | **Por `ninos.familia_id`.** El guard por vínculo no veía al niño de un tutor invitado y sin cuenta, y dar de baja a un hermano en esa ventana revocaba una familia que seguía viva.                              | F-3-D, `20260721120000`   |
| Qué se puede revivir              | revivir todo lo borrado / guardar el **motivo** del borrado | **Motivo.** `deleted_reason` con el ENUM `motivo_borrado` («opción a»). Sin él, `desarchivar_nino` resucitaba datos de un sujeto purgado por RGPD.                                                               | D-5, `20260805120000`     |
| Purga de curso a 5 años           | reescribirla como archivado / retirarla                     | **Retirarla** («opción b»). El sistema no codifica los 5 años; el borrado real es un acto deliberado de Dirección.                                                                                               | F-2b-3f, #201             |

## Decisión

**Se elige la Opción B: la familia es la unidad del modelo.**

### Datos

- **`familias`** es una unidad dentro de un centro, con borrado lógico y una etiqueta (los
  apellidos que se enseñan). La dirección del hogar no va aquí, va en el perfil del tutor; así cubre
  a padres separados.
- **`familia_tutores`** es la membresía y el **perfil único del adulto**. Sustituye a `datos_tutor`,
  que se borra en F-2b-5.
  - `usuario_id` puede ser NULL: el tutor tecleado aún no tiene cuenta.
  - `rol_familia` se valida con un CHECK (`titular` | `segundo_tutor`), no con un ENUM.
  - «Un adulto = una familia»: índice único parcial sobre `usuario_id` en las filas activas.
  - Máximo de 2 tutores activos por familia.
  - El tutor nunca escribe `usuario_id`: lo enlaza solo `accept-invitation`, con service role. Un
    trigger congela `usuario_id`, `familia_id` y `rol_familia`.
- **`ninos.familia_id`** es `NOT NULL` (F-2b-3): todo niño cuelga de una familia.
- **Mandato SEPA:** cuelga de `familia_id`. El tutor lo gestiona desde su portal con firma digital
  y lo guarda en una ruta de Storage de la familia (`{centro}/familia/{familia}/mandato-*.pdf`).
  `iban_ultimos4` permite enseñarlo enmascarado sin descifrar el IBAN (F-2c).
- **Recibo y método de pago:** van por familia. Ver ADR-0052.
- **RLS y auditoría:**
  - el admin puede leer y escribir todo lo de su centro;
  - el tutor lee y escribe el perfil compartido de **su** familia, incluida la fila del segundo
    tutor, que aún no tiene cuenta;
  - las escrituras se auditan con `audit_trigger_function`, igual que el dato médico (F-2a,
    F-2b-3a).
- **Helpers:** `familia_de_nino`, `centro_de_familia` y `es_tutor_de_familia`.

### Alta

El alta pasa por una única RPC transaccional, `crear_o_anadir_a_familia` (F-2b-1). Hace todo o
nada:

- detecta la familia o la crea;
- crea el perfil;
- crea el niño, siempre con `familia_id`;
- crea la matrícula pendiente y el vínculo con el niño.

Las cuentas no entran en la transacción: la app crea la cuenta de GoTrue **antes** y, si la RPC
falla, la compensa borrándola. Al detectar la familia también busca entre las **archivadas** y, si
encuentra una, la reactiva (F-2b-4-1).

### Ciclo de vida

Son RPCs atómicas `SECURITY DEFINER`. Todas cumplen estas reglas:

- el gate `es_admin(centro) OR service_role` es la primera sentencia con efecto;
- no llevan bloque `EXCEPTION`: un error revierte todo;
- se pueden repetir sin efectos nuevos;
- la auditoría queda a nombre del admin, porque usan su JWT.

Primitivos:

- **`archivar_nino`:** cierra todas las matrículas abiertas, borra lógicamente los vínculos y marca
  `ninos.deleted_at`.
- **`revocar_acceso_familia`:** si la familia ya no tiene niños activos, revoca el rol
  `tutor_legal` de sus tutores con cuenta y archiva la familia. No toca `auth.users`.

Operaciones que los usan:

- **`cerrar_curso`:** archiva a los que finalizan, revoca las familias que se quedan vacías, activa
  las matrículas pendientes, cierra las viejas y las `profes_aulas` del curso saliente, y activa el
  curso nuevo.
- **`baja_nino`:** baja a mitad de curso, con fecha de hoy.
- **`desarchivar_nino`:** reincorpora al niño. Deshace los borrados lógicos en cadena y abre una
  matrícula nueva en el curso activo.

**Motivo del borrado (D-5).** `vinculos_familiares`, `roles_usuario`, `familias` y `ninos` llevan
`deleted_reason`, y un CHECK exige que vaya siempre junto a `deleted_at`.

- Reactivar solo revive lo que borró una baja: `baja_nino` y `revocacion_familia`.
- `solicitud_olvido` y `purga_rgpd` no se pueden revivir nunca.
- El orden es monótono: `baja_nino` → `solicitud_olvido` → `purga_rgpd`.

## Consecuencias

### Positivas

- Un solo perfil por adulto. Se acaba la divergencia entre hermanos (el split-brain de #198).
- El 2.º hijo hereda el mandato de la familia y no vuelve a firmar.
- Hay base para el recibo familiar y el descuento por hermanos (ADR-0052).
- El fin de curso, la baja y la reincorporación son operaciones atómicas y auditadas, y un hermano
  que sigue activo protege a su familia de la revocación.
- Un sujeto anonimizado por RGPD no puede volver por la reactivación.

### Negativas

- **Deuda que registra D-5:** `roles_usuario` es una fila por usuario, centro y rol. Si un adulto
  tuviera el rol `tutor_legal` por dos familias del mismo centro, `deleted_reason` sobre esa fila
  compartida sería ambiguo. D-5 lo deja registrado como borde preexistente, sin resolver.
- Se pierde la purga automática a 5 años: el borrado real queda como acto deliberado de Dirección.
  La retención formal sigue pendiente en el paquete RGPD (ver `docs/follow-ups.md`).
- Exclusión entre «pendiente» y «finaliza» al pasar de curso: la garantizan las server actions, no
  un trigger (decisión de producto F-3-A.3).

### Neutras

- La cola de cambios conserva las etiquetas `datos_tutor` y `datos_tutor_dni`, que son identificadores
  lógicos. Desde #198 escriben en `familia_tutores`.
- La factory de tests crea una familia por cada niño, y se añadieron flags nuevos de tests
  (Verificación).

## Plan de implementación

Ejecutado:

- [x] **F-0** (#185): `familias`, `familia_tutores`, columnas `familia_id` inertes y helpers.
- [x] **F-2a** (#187): RLS para el admin y auditoría de escritura.
- [x] **F-2b-1 / F-2b-2** (#188–#191): RPC `crear_o_anadir_a_familia`, cableada al modo Dirección
      y a la invitación.
- [x] **F-2b-3a / F-2b-3** (#192, #198): RLS del tutor sobre `familia_tutores`, lecturas y
      escrituras del alta movidas a `familia_tutores`, y `ninos.familia_id NOT NULL`.
- [x] **F-2b-3f / F-2b-5** (#201, #202): se retira la purga de curso y se borra `datos_tutor`.
- [x] **F-3-A…F-3-F** (#203–#209): «Finaliza», `archivar_nino`, `revocar_acceso_familia`,
      `cerrar_curso`, `baja_nino`, archivo y `desarchivar_nino`.
- [x] **F-2b-4** (#210–#212): reactivar una familia archivada, añadir un hijo a una familia
      existente y guardarraíl para un tutor con cuenta.
- [x] **F-2c** (#216–#219): mandato por familia, `iban_ultimos4` y gestión por el tutor con firma
      digital.
- [x] **D-5** (#232): `reproponer_asignaciones` y motivo del borrado. Incluye las reparaciones de
      `solicitar_olvido_nino` en `20260806`–`20260808`.

## Verificación

- Tests RLS con flag, activados en la suite nocturna contra producción y en la BD efímera de cada PR:
  - `F3A_MIGRATION_APPLIED`, `F3C1_*`, `F3C2_*`, `F3C3_*`, `F3D_*`, `F3F_*`;
  - `F2B41_*`;
  - `F2C1_*`, `F2C2_*`, `F2C4_*`;
  - `D5_MIGRATION_APPLIED`.
- Los tests RLS de `familia_tutores` (#198) cubren:
  - el titular puede actualizar y el segundo tutor puede insertar;
  - el máximo de tutores da `23505`;
  - el tutor no puede secuestrar `usuario_id` ni el puesto de titular;
  - no se cruza de una familia a otra.
- Las 149 migraciones del repo están registradas en producción (verificado el 2026-10-10).

## Notas

- **Fuentes:** las cabeceras de las migraciones citadas y los cuerpos de los PRs #185, #198, #201,
  #202 y #216. El cambio de fondo a familia no tiene un documento de diseño previo.
- El alta del 2.º hijo se completó después: serie U y los arreglos de #261–#263 y #289–#291. Ver
  «Después de F12-B» en `docs/journey/progress.md`.
- La ficha de familia y la gestión de familias para Dirección llegaron en F-6a (#215).

## Referencias

- **Migraciones:**
  - fundación y alta: `20260707120000_phase_f0_familia_fundacion`,
    `20260709120000_phase_f2a_familia_rls_auditoria`,
    `20260710120000_phase_f2b1_rpc_crear_familia_alta`,
    `20260711120000_phase_f2b3a_familia_tutores_rls_tutor`,
    `20260714120000_phase_f2b3_ninos_familia_id_not_null`,
    `20260715120000_phase_f2b5_drop_datos_tutor`;
  - ciclo de vida: `20260716120000_phase_f3a_rollover_finaliza`,
    `20260717120000_phase_f3c1_archivar_nino`,
    `20260718120000_phase_f3c3_revocar_acceso_familia`,
    `20260719120000_phase_f3c2_cerrar_curso`, `20260720120000_phase_f3d_baja_nino`,
    `20260721120000_phase_f3d_revocar_guard_familia_id`,
    `20260722120000_phase_f3f_desarchivar_nino`,
    `20260723120000_phase_f2b41_reactivar_familia_archivada`;
  - mandato: `20260725120000_phase_f2c1_mandato_familia`,
    `20260726120000_phase_f2c2_iban_ultimos4`,
    `20260727120000_phase_f2c4_mandato_storage_familia`;
  - motivo del borrado: `20260805120000_phase_d5_2_blindar_desarchivar_motivo_borrado`,
    `20260806120000`…`20260808120000` (reparaciones de `solicitar_olvido_nino`).
- **ADRs relacionados:**
  - ADR-0052: recibos a grano familia y cierre de mes;
  - ADR-0050: F12-B, parcialmente superado por ADR-0052;
  - ADR-0049: altas con documentos, origen del mandato;
  - ADR-0048: matrícula multicurso;
  - ADR-0004: cifrado pgcrypto + Vault;
  - ADR-0007: recursión RLS y helpers `SECURITY DEFINER`.
- **Diario:** `docs/journey/progress.md`, sección «Serie F — modelo de familia».
