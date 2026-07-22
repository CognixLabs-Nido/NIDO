---
feature: beca-comedor-v2
wave: 1
status: draft
priority: high
last_updated: 2026-07-22
related_adrs: []
related_specs: [cuotas, beca-comedor-mes]
---

# Spec — Beca comedor v2 (elegibilidad por curso + desacople temporal + desborde)

> BLOQUE 2 de las mejoras de RECIBOS. **Sustituye** el modelo D-6 (`beca_comedor_mes` + PASE 2-bis del motor). Fase de spec: este documento cierra decisiones antes de tocar código.

## Resumen ejecutivo

La beca comedor es una ayuda que el ayuntamiento concede a un alumno y que la escuela descuenta en el recibo de la familia. v2 modela tres cosas que el modelo actual no cubre: (a) **elegibilidad** por alumno y curso (se marca en un listado, se puede perder → deja de aplicarse en el futuro sin tocar el pasado); (b) **desacople temporal** entre el mes al que corresponde la beca y el recibo donde se descuenta (el ayuntamiento paga en enero las becas de sep+oct+nov → las tres se descuentan en el recibo de enero); (c) **desborde**: cuando lo que hay que descontar supera la cuota del recibo, se avisa a Dirección y se resuelve por una de tres vías (reducir, transferencia, resto al mes siguiente).

## Contexto

El modelo D-6 (`beca_comedor_mes`) guarda un importe por (niño, año, mes) y el motor de recibos (D-6-2, PASE 2-bis) lo aplica como línea negativa **del mismo mes**. Ese acople es incorrecto en la práctica real de ANAIA: el importe de la beca no se conoce hasta que el ayuntamiento paga, normalmente en bloque y meses después, y a veces supera la cuota del alumno (habría que devolver dinero). El piloto **no ha arrancado**, así que se puede sustituir el modelo entero con bajo riesgo (soltar tabla + datos, patrón de los "remodel" destructivos del repo, p. ej. F6-C D1).

Decisiones **ya cerradas por Jose** (no se re-preguntan):

- Pestaña propia en el menú superior de cuotas, junto a "Conceptos".
- Listado de alumnos para marcar quién tiene beca comedor. La beca es del **alumno por CURSO**. Perderla → deja de aplicarse en recibos **futuros**; los pasados no se tocan.
- Importe **mes a mes, variable**.
- **Desacople temporal**: al meter la cantidad se indica en **qué recibo/mes** se aplica el descuento, que puede NO ser el mes al que corresponde la beca.
- **Desborde** (beca a descontar > cuota del recibo): AVISAR a admin, con 3 vías — (1) reducir cuántas becas se descuentan ese mes; (2) transferencia (listado de a quién pagar + marcar "transferencia realizada" en el recibo); (3) dejar la diferencia como concepto el mes siguiente ("Resto beca octubre −17 €").
- **Reemplaza** `beca_comedor_mes` (no extender). Sustituir el acople del PASE 2-bis por el modelo desacoplado.

## User stories

- US-01: Como **directora**, quiero marcar en un listado de alumnos quién tiene beca comedor este curso, para que solo esos alumnos entren en la gestión de becas.
- US-02: Como **directora**, quiero registrar el importe de la beca de un alumno indicando **a qué mes corresponde** y **en qué recibo se descuenta**, para reflejar que el ayuntamiento paga en bloque y con retraso.
- US-03: Como **directora**, al generar los recibos de un mes quiero que se descuenten las becas cuyo **recibo de aplicación** es ese mes (no las "de ese mes").
- US-04: Como **directora**, cuando una beca a descontar supera la cuota del recibo quiero que el sistema me **avise** y me deje elegir entre reducir, pagar por transferencia o pasar el resto al mes siguiente.
- US-05: Como **directora**, quiero un **listado de transferencias a realizar** (a quién y cuánto) y poder marcar cada una como "realizada".
- US-06: Como **familia**, quiero ver en mi recibo la línea de beca con el mes al que corresponde ("Beca comedor septiembre", "Resto beca octubre").

## Alcance

**Dentro:**

- Nuevo modelo de datos: elegibilidad por (niño, curso); tramos de beca con desacople correspondiente↔aplicación; estado de desborde; transferencias.
- Sustitución del PASE 2-bis del motor por un pase por "recibo de aplicación" + detección de desborde.
- Las 3 vías de resolución del desborde y el listado de transferencias.
- Nueva pestaña "Beca comedor" en `/admin/cuotas`.
- Retirada de `beca_comedor_mes` (tabla, UI `BecaComedorMesPanel`, tests D-6).

**Fuera (no se hace aquí):**

- Integración bancaria real de la transferencia (SEPA de pagos salientes): se genera el **listado** y se marca "realizada" a mano; no se emite fichero de pago.
- Importar el importe de la beca desde un fichero del ayuntamiento (entrada manual).
- Notificaciones push por desborde (se resuelve in-app; si se decide push, va en fase aparte).
- Cambios en el resto del motor de recibos (PASE 1/1b/2/3/4 intactos, salvo el reemplazo del 2-bis).

## Comportamientos detallados

### Comportamiento 1 — Elegibilidad por alumno y curso

**Pre-condiciones:** admin del centro; hay un curso activo.

**Flujo:**

1. La pestaña "Beca comedor" lista los alumnos con matrícula activa del curso, con un check "tiene beca comedor".
2. Marcar → crea (o reactiva) la elegibilidad del alumno para ese curso. Desmarcar → la pone de baja (no borra: conserva historia).
3. Un alumno de baja de elegibilidad **deja de aparecer** como candidato para registrar nuevos tramos y deja de aplicarse en el futuro (ver Casos edge para el matiz "tramos ya registrados").

**Post-condiciones:** existe una fila de elegibilidad por (niño, curso) con su estado; queda en `audit_log`.

### Comportamiento 2 — Registrar el importe con desacople (tramos)

**Pre-condiciones:** alumno con elegibilidad activa en el curso.

**Flujo:**

1. Para un alumno, Dirección añade un **tramo**: importe (€), **mes al que corresponde** (año+mes) y **mes/recibo de aplicación** (año+mes). Ej.: importe 45 €, corresponde a septiembre 2026, se aplica en el recibo de enero 2027.
2. Se pueden registrar varios tramos con el mismo mes de aplicación (sep, oct, nov → todos aplicación enero).
3. El tramo nace en estado `pendiente`.

**Post-condiciones:** existe el tramo; al (re)generar el recibo de su mes de aplicación se descontará.

### Comportamiento 3 — Aplicación en el motor por "recibo de aplicación"

Ver sección **Motor**. En síntesis: al generar los recibos del mes M, el nuevo pase aplica todos los tramos `pendiente` con `(año, mes) de aplicación = M` de los hijos activos de la familia, cada uno como línea negativa colgada del niño, con descripción por el mes al que **corresponde**. Marca cada tramo aplicado con el recibo generado.

### Comportamiento 4 — Desborde y sus 3 vías

Ver secciones **Motor** (detección) y **Desborde** (resolución).

## Casos edge

- **Sin alumnos elegibles / sin tramos**: la pestaña muestra el listado vacío o sin tramos; el motor no aplica nada (idéntico a hoy sin becas).
- **Alumno pierde elegibilidad con tramos ya registrados de aplicación futura**: DECISIÓN ABIERTA (ver D-P3). Propuesta por defecto: los tramos ya registrados **se respetan** (dinero ya concedido), la baja solo impide crear nuevos; alternativa: la baja anula los tramos `pendiente` de aplicación futura.
- **Regeneración idempotente**: regenerar el mes M debe re-aplicar los mismos tramos sin duplicar líneas ni desbordes (el motor borra borradores y recomputa; los tramos vuelven a marcarse). Un recibo **confirmado** no se regenera (R8) → sus tramos aplicados quedan congelados.
- **Mes de aplicación en un mes ya cerrado/confirmado**: no se puede aplicar sobre un recibo confirmado; el tramo queda `pendiente` y se avisa (o se fuerza a un mes futuro). DECISIÓN ABIERTA (D-P8).
- **Desborde encadenado**: el "resto" pasado al mes M+1 vuelve a desbordar en M+1. Debe poder resolverse otra vez (nuevo desborde sobre el tramo `resto`). El modelo lo soporta (un `resto` es un tramo normal); se documenta el riesgo de bucle si el importe es crónicamente mayor que la cuota.
- **Cambio de curso / baja de matrícula a mitad**: la elegibilidad es por curso; una beca de un curso no aplica a otro. Un alumno dado de baja de matrícula deja de tener recibo → sus tramos pendientes no se aplican (quedan pendientes; ver D-P3).
- **Idiomas**: el nombre del mes en la descripción de la línea ("Beca comedor septiembre") se localiza es/en/va; el importe con formato de moneda por locale.
- **Datos sensibles**: importe de beca = dato económico del menor; RLS admin-only, se audita.

## Modelo de datos afectado

> Sin SQL final aquí (fase de spec). Se describen tablas, columnas, relaciones y RLS en prosa/tabla. Todas las PK uuid, timestamps `timestamptz`, `centro_id` redundante para RLS simple, patrón de coherencia de centro con helpers `SECURITY DEFINER` (`centro_de_nino`, y uno nuevo `centro_de_beca_tramo` si hace falta).

**Tablas nuevas:**

### `beca_comedor_elegibilidad` — quién tiene beca, por curso

| Columna                 | Tipo                        | Nota                               |
| ----------------------- | --------------------------- | ---------------------------------- |
| id                      | uuid PK                     |                                    |
| centro_id               | uuid NN → centros           | RLS                                |
| nino_id                 | uuid NN → ninos             |                                    |
| curso_academico_id      | uuid NN → cursos_academicos | la beca es por curso               |
| activa                  | boolean NN                  | true = tiene beca; false = de baja |
| fecha_alta              | date NN                     |                                    |
| fecha_baja              | date NULL                   | se rellena al desmarcar            |
| created_by              | uuid → auth.users           |                                    |
| created_at / updated_at | timestamptz                 |                                    |

- **UNIQUE (nino_id, curso_academico_id)** — una fila de elegibilidad por alumno y curso; marcar/desmarcar togglea `activa` (no crea filas nuevas).
- Estado "activa/baja" = el interruptor. Baja conserva la fila (historia + auditoría).

### `beca_comedor_tramo` — el importe con desacople

| Columna                 | Tipo                           | Nota                                                             |
| ----------------------- | ------------------------------ | ---------------------------------------------------------------- |
| id                      | uuid PK                        |                                                                  |
| centro_id               | uuid NN → centros              | RLS                                                              |
| nino_id                 | uuid NN → ninos                |                                                                  |
| curso_academico_id      | uuid NN → cursos_academicos    | contexto de la beca                                              |
| anio_correspondiente    | int NN                         | mes al que CORRESPONDE la beca                                   |
| mes_correspondiente     | int NN (1–12)                  |                                                                  |
| anio_aplicacion         | int NN                         | recibo donde se DESCUENTA                                        |
| mes_aplicacion          | int NN (1–12)                  |                                                                  |
| importe_centimos        | int NN (> 0)                   | en **céntimos** (coherente con recibos/conceptos; decisión D-I1) |
| estado                  | enum `beca_tramo_estado`       | pendiente / aplicada / anulada                                   |
| origen                  | enum `beca_tramo_origen`       | normal / resto                                                   |
| tramo_padre_id          | uuid NULL → beca_comedor_tramo | si `origen='resto'`, el tramo que lo generó                      |
| aplicada_en_recibo_id   | uuid NULL → recibos            | recibo donde se aplicó (se sella al aplicar)                     |
| created_by              | uuid → auth.users              |                                                                  |
| created_at / updated_at | timestamptz                    |                                                                  |

- **Desacople**: el par (`anio_correspondiente`, `mes_correspondiente`) ≠ (`anio_aplicacion`, `mes_aplicacion`). El motor filtra por el par de **aplicación**; la descripción de la línea usa el par **correspondiente**.
- ENUM `beca_tramo_estado`: `pendiente` (aún no aplicado) · `aplicada` (línea creada en un recibo) · `anulada`. (Se valora un estado `diferida` para "reducir" — ver D-I3; alternativa: "diferir" = cambiar `mes_aplicacion`, sin estado nuevo.)
- ENUM `beca_tramo_origen`: `normal` · `resto` (el remanente auto-creado por la vía 3 del desborde).
- **Unicidad**: se propone UNIQUE (nino_id, anio_correspondiente, mes_correspondiente, origen) para evitar duplicar la beca de un mismo mes correspondiente (los `resto` no colisionan con el `normal`). DECISIÓN D-I2.

### `beca_comedor_desborde` — estado del desborde de un recibo

| Columna                 | Tipo                     | Nota                                 |
| ----------------------- | ------------------------ | ------------------------------------ |
| id                      | uuid PK                  |                                      |
| centro_id               | uuid NN → centros        | RLS                                  |
| recibo_id               | uuid NN → recibos        | recibo (familiar) que desborda       |
| familia_id              | uuid NN → familias       |                                      |
| anio / mes              | int NN                   | mes de aplicación (= mes del recibo) |
| cuota_centimos          | int NN                   | suma de cargos positivos aplicables  |
| beca_centimos           | int NN                   | suma de becas de aplicación este mes |
| exceso_centimos         | int NN (> 0)             | beca − cuota (lo que desborda)       |
| estado                  | enum `desborde_estado`   | pendiente / resuelto                 |
| via                     | enum `desborde_via` NULL | reducir / transferencia / resto      |
| resuelto_por            | uuid NULL → auth.users   |                                      |
| resuelto_at             | timestamptz NULL         |                                      |
| created_at / updated_at | timestamptz              |                                      |

- **UNIQUE (recibo_id)** — un desborde por recibo (familiar) y mes.
- ENUMs `desborde_estado` (`pendiente`/`resuelto`), `desborde_via` (`reducir`/`transferencia`/`resto`).

### `beca_comedor_transferencia` — a quién pagar (vía 2)

| Columna                 | Tipo                        | Nota                           |
| ----------------------- | --------------------------- | ------------------------------ |
| id                      | uuid PK                     |                                |
| centro_id               | uuid NN → centros           | RLS                            |
| recibo_id               | uuid NN → recibos           | recibo del desborde            |
| familia_id              | uuid NN → familias          | destinatario del pago          |
| nino_id                 | uuid NULL → ninos           | si se quiere granular por niño |
| anio / mes              | int NN                      |                                |
| importe_centimos        | int NN (> 0)                | lo que hay que transferir      |
| estado                  | enum `transferencia_estado` | pendiente / realizada          |
| realizada_por           | uuid NULL → auth.users      |                                |
| realizada_at            | timestamptz NULL            |                                |
| created_at / updated_at | timestamptz                 |                                |

- ENUM `transferencia_estado` (`pendiente`/`realizada`). El "listado de transferencias" = query sobre `pendiente` (opcional: por mes). Marcar "realizada" = UPDATE de estado. El "marcado en el recibo" se satisface mostrando esta fila enlazada en el detalle del recibo (no una columna en `recibos`, decisión D-I4).

**Tablas modificadas:** ninguna estructuralmente (los `recibos`/`lineas_recibo` no cambian de esquema; las líneas de beca se siguen insertando como líneas negativas por el motor).

**Tablas consultadas:** `recibos`, `lineas_recibo`, `ninos`, `matriculas`, `cursos_academicos`.

**Tabla conservada hasta V2-6:** `beca_comedor_mes` NO se toca en V2-0 (aditivo puro). Su DROP es de V2-6 (ver "Qué se hace con lo actual").

## Motor: cambios en `generar_recibos_mes`

Estado actual (a sustituir) — **PASE 2-bis** (D-6-2), dentro del bucle por niño:

```
-- lee beca_comedor_mes del MISMO (nino, anio, mes) y crea 'Beca comedor' negativa
SELECT importe INTO v_beca_com FROM beca_comedor_mes WHERE nino_id=r_nino.id AND anio=p_anio AND mes=p_mes;
IF v_beca_com IS NOT NULL AND v_beca_com > 0 THEN INSERT línea 'Beca comedor' -importe; END IF;
```

**Nuevo PASE 2-bis (por recibo de aplicación):**

1. Dentro del bucle por niño, seleccionar los **tramos** con `estado='pendiente'`, `nino_id = r_nino.id`, `(anio_aplicacion, mes_aplicacion) = (p_anio, p_mes)`. (Nota: filtra por **aplicación**, no por correspondiente — este es el cambio central del desacople.)
2. Por cada tramo, insertar una línea negativa colgada del niño (`nino_id` seteado, `concepto_id` NULL), descripción localizada por el mes **correspondiente** (`'Beca comedor ' || nombre_mes(mes_correspondiente)`, y `'Resto beca ' || nombre_mes(...)` si `origen='resto'`), `precio_unitario = importe = -importe_centimos`.
3. Marcar el tramo como `aplicada` y sellar `aplicada_en_recibo_id = v_recibo`. (Al ser el motor idempotente y borrar los borradores del mes, la regeneración debe **re-derivar** el estado: se propone que el motor, al borrar borradores del mes, revierta a `pendiente` los tramos cuyo `aplicada_en_recibo_id` apunte a un borrador borrado — o, más simple, que el estado `aplicada` se calcule por la existencia de la línea y no se persista en el tramo. DECISIÓN D-I5: ¿persistir estado en el tramo, o derivarlo del recibo?)

**Detección de desborde (al generar, tras PASE 1/1b/2/2-bis/3, antes de congelar el total):**

1. Calcular el total del recibo familiar tras aplicar todas las becas de aplicación de este mes.
2. Si el total < 0 (la familia tendría saldo a favor por beca que supera su cuota), es un **desborde**: `exceso = -total` (o `beca − cuota` a nivel familia; unidad de comparación = recibo familiar, decisión D-P4).
3. El motor NO deja el recibo en negativo por beca: **capa** la beca aplicada de modo que el recibo quede ≥ 0 (p. ej. reduce la última línea de beca o inserta un ajuste), y **registra/actualiza** una fila `beca_comedor_desborde` (estado `pendiente`, con `cuota`, `beca`, `exceso`). El exceso NO se pierde: queda pendiente de que Dirección elija vía.
   - Alternativa (D-P5): dejar el recibo negativo y no capar, y que la resolución (transferencia/resto) lo corrija. Propuesta por defecto: capar a ≥ 0 para que las remesas SEPA nunca lleven importes negativos.

**Prueba de equivalencia obligatoria** (patrón B1-1): el diff del motor contra la definición viva debe mostrar SOLO el reemplazo del bloque PASE 2-bis + el bloque de detección de desborde; nada más (PASE 1/1b/2/3/4 idénticos).

## Desborde — las 3 vías (modelo + flujo)

Punto de partida: existe una fila `beca_comedor_desborde` (estado `pendiente`) para el recibo, con `exceso_centimos`. Dirección la ve en el aviso y elige una vía. La resolución fija `via`, `estado='resuelto'` y ejecuta:

### Vía 1 — Reducir (descontar menos becas este mes)

- Dirección elige qué tramos NO aplicar este mes. Cada tramo elegido se **difiere**: su `mes_aplicacion` pasa al mes siguiente (o a un mes elegido), volviendo a `pendiente` para ese nuevo mes. (Si se adopta el estado `diferida`, se marca así; ver D-I3.)
- Al regenerar el recibo con menos becas, el desborde desaparece (o se recalcula con menos exceso).
- Registro: los tramos diferidos cambian `mes_aplicacion`; el desborde queda `resuelto` vía `reducir`.

### Vía 2 — Transferencia (pagar el exceso a la familia)

- Se crea una fila `beca_comedor_transferencia` (estado `pendiente`) por el `exceso_centimos` (a nivel familia; granular por niño si se decide, D-P6).
- El recibo se queda con la beca capada a cuota (neto ≥ 0); el exceso se paga aparte.
- Dirección ve el **listado de transferencias** (todas las `pendiente`, filtrable por mes) con familia + importe; marca cada una "realizada" (setea `estado='realizada'`, `realizada_at/por`). En el detalle del recibo se muestra la transferencia enlazada ("Transferencia de beca: 17 € — realizada").
- El desborde queda `resuelto` vía `transferencia`.

### Vía 3 — Resto al mes siguiente

- Se **auto-crea** un tramo `origen='resto'`, `importe = exceso`, `mes_correspondiente = el del tramo original` (para la descripción "Resto beca octubre"), `mes_aplicacion = mes siguiente`, `estado='pendiente'`, `tramo_padre_id` = tramo original (o el desborde).
- El recibo actual queda con la beca capada a cuota; el resto se descontará al regenerar el mes siguiente (y puede volver a desbordar → nuevo desborde, resoluble igual).
- El desborde queda `resuelto` vía `resto`.

**Idempotencia:** la resolución modifica tramos/crea filas ANTES de regenerar. Regenerar el recibo tras resolver recomputa sin desborde (o con el exceso ya reducido). Un desborde `resuelto` no se re-crea salvo que el recibo vuelva a desbordar tras un cambio.

## Pantallas y rutas

- `/admin/cuotas` (existente) — **nueva pestaña "Beca comedor"** en `TabsList`, junto a "Conceptos". Contenido:
  - **Elegibilidad**: listado de alumnos activos del curso con check "tiene beca".
  - **Tramos**: por alumno elegible, editor de tramos (importe + mes correspondiente + mes de aplicación), con añadir/editar/quitar.
  - **Desbordes pendientes**: aviso/lista de recibos que desbordan, con las 3 opciones por recibo.
  - **Transferencias**: listado de transferencias pendientes/realizadas del mes, con "marcar realizada".
- Detalle del recibo (Panel del mes, `PanelMesRecibos`): mostrar la línea de beca con su mes y, si aplica, la transferencia enlazada.

## Componentes UI

- `BecaComedorTab.tsx` (Server) — orquesta las sub-secciones y carga datos.
- `ElegibilidadPanel.tsx` (Client) — listado de alumnos + toggle beca (patrón `BecaComedorMesPanel`/`ConceptosCatalogo`).
- `TramosBecaEditor.tsx` (Client) — editor de tramos por alumno (patrón `TarifasAnioEditor` de B1-2: filas + upsert/delete directo con server actions + `revalidatePath`).
- `DesbordeAviso.tsx` (Client) — tarjeta por recibo con exceso + 3 botones/opciones.
- `TransferenciasPanel.tsx` (Client) — listado + marcar realizada.
- Server actions/queries nuevas (patrón beca/tarifa): elegibilidad (toggle), tramo (guardar/eliminar), desborde (resolver por vía), transferencia (marcar realizada), y las queries de lectura por centro/mes. Todas con `getCentroActualId`, RLS como puerta, `revalidatePath('/[locale]/admin/cuotas')`.

## Políticas RLS

- Las 4 tablas nuevas: **admin-only** por `es_admin(centro_id)` en SELECT/INSERT/UPDATE/DELETE (idéntico a `beca_comedor_mes` y a `tarifa_concepto_anio` de B1-0). Deliberadamente NO `pertenece_a_centro` (excluye profes/tutores).
- **Coherencia de centro** en INSERT/UPDATE con WITH CHECK: `centro_id = centro_de_nino(nino_id)` (tramos/elegibilidad) y, para desborde/transferencia, `centro_id` derivado del recibo (helper `centro_de_recibo` — existe o se añade). Patrón B1-0 (`centro_de_concepto`).
- La familia **no** accede a estas tablas; ve la beca solo como línea del recibo (RLS de `lineas_recibo`/`recibos` ya vigente). El importe de la transferencia se le muestra vía la línea/estado del recibo, no dándole acceso a `beca_comedor_transferencia` (decisión D-I6: ¿la familia ve el estado de su transferencia? por defecto no en v2).
- **Gotcha MVCC**: las SELECT policies usan solo columnas del propio row + helpers que leen OTRAS tablas → no aplica el problema de `INSERT…RETURNING` (igual que B1-0). Test `.insert().select()` como bloqueo de regresión.

## Eventos y notificaciones

- **Audit log**: auditar las 4 tablas (rama nueva en `audit_trigger_function`, `centro_id` directo). D-6-1 no auditaba beca; v2 sí (dato económico del menor). DECISIÓN D-P7 (confirmar que se audita).
- **Sin Realtime** ni push en v2 (el desborde se ve al entrar en la pestaña; push = fase futura si se pide).

## i18n

Namespace `admin.cuotas.beca` (nuevo, reemplaza el actual `admin.cuotas.beca_comedor`): tab, elegibilidad (col alumno, check), tramos (importe, mes correspondiente, mes aplicación, añadir/guardar/quitar), desborde (aviso, exceso, las 3 opciones, confirmaciones), transferencias (listado, marcar realizada), descripciones de línea `linea_beca` / `linea_resto` con interpolación del **nombre del mes** (necesita `meses.1..12` localizados si no existen ya). Errores/validación bajo `beca_comedor.*` para las server actions. Las 3 lenguas es/en/va desde el inicio.

## Tests requeridos

**Vitest (unit):** schemas Zod (tramo: importe > 0, meses 1–12, año 2024–2100; elegibilidad); mapeo euros↔céntimos; lógica de detección de desborde y de "resto" si se extrae a función pura.

**Vitest (RLS, gated `BECA_COMEDOR_V2_APPLIED`):** admin ve/escribe; profe/tutor/outsider 0 filas y 42501 en INSERT; coherencia de centro (cruce → 42501); UNIQUE (elegibilidad por curso; tramo por correspondiente+origen); semántica USING en UPDATE/DELETE (fila sobrevive).

**Vitest (RLS motor, gated):** un tramo con aplicación=M genera línea negativa en el recibo de M (no en el correspondiente); dos tramos (sep, oct) con aplicación=enero → dos líneas en enero; desborde detectado (recibo no queda negativo + fila desborde pendiente); resolución por cada vía (reducir difiere; transferencia crea fila + capa; resto crea tramo mes+1); idempotencia de regeneración. **Prueba de equivalencia** del motor obligatoria.

**Playwright (E2E):** marcar beca → registrar tramo desacoplado → generar recibo del mes de aplicación → ver la línea; provocar desborde → resolver por transferencia → marcar realizada. (Requiere sesión admin real; hoy no configurada — ver nota de B1-2.)

## Criterios de aceptación

- [ ] Los tramos se aplican por **mes de aplicación**, no por correspondiente (test).
- [ ] El desborde se detecta al generar y el recibo nunca queda negativo por beca (test).
- [ ] Las 3 vías funcionan y quedan registradas; el listado de transferencias y el "realizada" funcionan.
- [ ] `beca_comedor_mes` (tabla, UI, tests) retirada; motor sin PASE 2-bis viejo.
- [ ] Prueba de equivalencia del motor = solo el bloque de beca/desborde.
- [ ] es/en/va completas; RLS admin-only + coherencia de centro; audit.
- [ ] ADR de v2 (modelo desacoplado + desborde) escrito.

## Qué se hace con `beca_comedor_mes` actual

- **Tabla + datos**: DROP en **V2-6** (limpieza final), NO en V2-0. Decisión de secuencia (Jose): V2-0 es aditivo puro para que cada PR se aplique/mergee independiente sin romper main; `beca_comedor_mes` se conserva viva (muerta funcionalmente cuando V2-1 cambie el motor) y se suelta al final, junto con la retirada de la feature/tests. El piloto no ha arrancado → 0 filas confirmadas (D-P11), sin migración de datos (v1 acopla mes=aplicación; v2 desacopla). El DROP de V2-6 debe ir acompañado de la retirada de la feature y los tests D-6 (abajo) para no romper el build al regenerar tipos.
- **Motor**: quitar el PASE 2-bis viejo (D-6-2) y su lectura de `beca_comedor_mes`; poner el nuevo pase (V2-1). Retirar el flag/gate `D6_BECA_COMEDOR_APPLIED` del workflow tras retirar sus tests.
- **UI**: quitar `BecaComedorMesPanel` del Panel del mes (`admin/cuotas/page.tsx`, tab "mes") y borrar la feature `src/features/beca-comedor-mes/` (panel, form, action, query, schema).
- **Tests**: retirar/rehacer `src/test/rls/d6-beca-comedor.rls.test.ts` (→ nuevos tests v2) y las aserciones de beca comedor del motor en `f43-motor-recibos-familia.rls.test.ts` (el bloque `D-6` gated) → reescribir para v2. Ajustar la config del gate en `rls-suite.yml`.

## Troceo propuesto (subfases)

Mismo patrón que B1 (modelo → motor → UI → …), cada PR tras revisar+mergear el anterior.

| Sub                       | Alcance                                                                                                                                                                                                                                                                                              | Tamaño | Depende de          |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------- |
| **V2-0 MODELO**           | **ADITIVO PURO**: 4 tablas + ENUMs + RLS admin-only + coherencia centro (reusa `centro_de_nino`/`centro_de_recibo`) + auditoría; TS types; tests RLS gated (`BECA_COMEDOR_V2_APPLIED`). **NO** dropea `beca_comedor_mes` (queda para V2-6). Se aplica/mergea en solitario sin romper motor ni build. | M-L    | —                   |
| **V2-1 MOTOR**            | `CREATE OR REPLACE generar_recibos_mes`: reemplazar PASE 2-bis por el pase por aplicación + detección de desborde (capa a ≥0 + fila desborde). Retirar lectura de `beca_comedor_mes`. Prueba de equivalencia + tx+ROLLBACK. Tests motor gated.                                                       | L      | V2-0                |
| **V2-2 UI elegibilidad**  | Pestaña "Beca comedor" + listado alumnos + toggle beca por curso (query + action). Retirar `BecaComedorMesPanel` del Panel del mes.                                                                                                                                                                  | M      | V2-0                |
| **V2-3 UI tramos**        | Editor de tramos por alumno (importe + mes corresp. + mes aplic.) con upsert/delete.                                                                                                                                                                                                                 | M      | V2-0 (V2-2 UI base) |
| **V2-4 DESBORDE**         | Aviso de desbordes pendientes + las 3 vías (reducir/transferencia/resto) con su resolución en el modelo.                                                                                                                                                                                             | M-L    | V2-1, V2-3          |
| **V2-5 TRANSFERENCIAS**   | Listado de transferencias + marcar realizada + enlace en el detalle del recibo.                                                                                                                                                                                                                      | M      | V2-4                |
| **V2-6 LIMPIEZA + TESTS** | **DROP `beca_comedor_mes`** + borrar feature `beca-comedor-mes`, retirar tests D-6 y el gate `D6_BECA_COMEDOR_APPLIED`, E2E, i18n completo, ADR. Todo junto para no romper el build al regenerar tipos.                                                                                              | S-M    | todas               |

Dependencias: V2-0 → V2-1 y (V2-2, V2-3) en paralelo lógico (pero secuencial por la regla de una fase a la vez) → V2-4 → V2-5 → V2-6. La UI (V2-2/V2-3) puede ir antes o después del motor, pero el desborde (V2-4) necesita motor + tramos.

## Decisiones abiertas

### Producto (las decide Jose)

- **D-P1**: Elegibilidad — ¿basta un check activa/baja por (niño, curso), o hace falta también fecha de concesión / referencia del expediente del ayuntamiento?
- **D-P2**: Al desmarcar la beca (baja), ¿pedir confirmación? ¿mostrar desde/hasta en el listado?
- **D-P3**: Baja de elegibilidad con **tramos ya registrados de aplicación futura**: ¿se respetan (dinero ya concedido) o se anulan los `pendiente` futuros? (Propuesta: respetarlos.)
- **D-P4**: Unidad del desborde: ¿se compara la beca contra la cuota **del niño** o contra el **total del recibo familiar**? (Propuesta: total familiar = "hay que devolver dinero".)
- **D-P5**: Ante desborde, ¿el recibo se **capa a ≥ 0** (propuesta) o se deja negativo hasta resolver?
- **D-P6**: La transferencia, ¿por **familia** (propuesta) o granular por **niño**?
- **D-P7**: ¿Se **audita** el importe de beca/tramos/transferencias en `audit_log`? (Propuesta: sí.)
- **D-P8**: Si el mes de aplicación cae en un recibo **ya confirmado/cerrado**, ¿se prohíbe (forzar mes futuro), se avisa, o se genera un esporádico?
- **D-P9**: "Reducir" (vía 1): al diferir tramos, ¿el destino por defecto es **el mes siguiente** o Dirección elige el mes?
- **D-P10**: ¿La familia debe **ver** el estado de su transferencia (además de la línea del recibo)? (Propuesta: no en v2.)
- **D-P11**: ¿Confirmar que en producción **no hay** filas reales en `beca_comedor_mes` antes del DROP? (Piloto no arrancado → esperado vacío.)

### Implementación (las resuelvo yo salvo veto)

- **D-I1**: Importe en **céntimos** (int) en las tablas nuevas, no euros-directos como `beca_comedor_mes` (coherencia con recibos/conceptos y con B1).
- **D-I2**: UNIQUE del tramo = (nino_id, anio_correspondiente, mes_correspondiente, origen) para no duplicar el mismo mes correspondiente.
- **D-I3**: "Reducir" se implementa **cambiando `mes_aplicacion`** del tramo (sin estado `diferida` nuevo), salvo que se prefiera un estado explícito.
- **D-I4**: "Transferencia realizada en el recibo" se modela con la tabla `beca_comedor_transferencia` enlazada (no columnas nuevas en `recibos`).
- **D-I5**: Estado `aplicada` del tramo: **derivar** de la existencia de la línea/recibo vs. persistir en el tramo. (Propuesta: sellar `aplicada_en_recibo_id` y revertir a `pendiente` al borrar el borrador en la regeneración, para idempotencia.)
- **D-I6**: Familia sin acceso a las tablas de beca; ve solo la línea del recibo.
- **D-I7**: Descripción de línea con nombre de mes localizado (`meses.N`) — añadir claves si no existen.

## Referencias

- Modelo D-6 a sustituir: `supabase/migrations/20260809120000_phase_d6_1_beca_comedor_mes.sql` … `20260812120000_phase_d6_2_motor_beca_comedor_mes.sql`; feature `src/features/beca-comedor-mes/`; tests `src/test/rls/d6-beca-comedor.rls.test.ts` + bloque D-6 de `f43-motor-recibos-familia.rls.test.ts`.
- Patrón reusable: B1-0 (tabla + RLS + coherencia de centro), B1-2 (editor de importes con upsert/delete), `beca_comedor_mes` (toggle/panel).
- Motor: `generar_recibos_mes` (PASE 2-bis actual, líneas ~145-154 de la definición viva).
