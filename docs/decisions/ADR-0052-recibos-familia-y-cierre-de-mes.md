# ADR-0052: Recibos a grano familia, ciclo borrador → confirmado y cierre de mes reabrible

## Estado

`accepted`. **Supera parcialmente a [ADR-0050](ADR-0050-modelo-cuotas-recibos-remesas-f12b.md)**:
sus decisiones C, D, F y H. La tabla de abajo da el estado de cada una.

Las decisiones se tomaron y se aplicaron entre el 2026-07-13 y el 2026-08-15; este ADR las
documenta después, el 2026-10-10.

**Fecha:** 2026-07-13 (F-4-0) → 2026-08-15 (R-5)
**Autores:** responsable + claude-code
**Fase del proyecto:** posterior a F12-B. Serie F-4 (recibos por familia), bloque B y serie R.

## Contexto

ADR-0050 (F12-B) montó el ciclo de cobro **por niño**:

- la asignación de cuotas era por niño y mes (`asignacion_cuota`);
- un motor de cierre, `cerrar_mes_cobros`, generaba recibos ya definitivos;
- el método de pago era por niño;
- el cierre de mes era **inmutable**: «`cierre_mensual` sin UPDATE/DELETE; no se reabre. Errores →
  recibos correctivos/esporádicos + devoluciones» (decisión F).

Con la familia como unidad (ADR-0051), ese modelo dejó de encajar:

- Una familia con dos hijos recibía dos recibos y el **descuento por hermanos** no tenía dónde
  calcularse.
- Las cuotas había que volver a asignarlas cada mes.
- La directora no tenía forma de **revisar los recibos antes de darlos por buenos**. Tampoco podía
  corregir un error después de confirmar: la única salida era un recibo esporádico de ajuste,
  que ensucia el mes (cabecera de R-5).
- Regenerar el mes **borraba lo escrito a mano**. `generar_recibos_mes` borraba el borrador entero
  y lo volvía a crear (cabecera de R-2).

Restricciones:

- **Datos:** 0 datos reales cuando se rehízo, así que el esquema se cambió sin backfill (F-4-0,
  F-4-1).
- **Dinero:** en céntimos enteros.
- **Migraciones:** van a mano por el SQL Editor.
- **IBAN:** solo se descifra en el servidor (ADR-0050, se mantiene).

## Opciones consideradas

> Son las disyuntivas que documentan las migraciones y los PRs de la serie. No hay un documento
> de diseño previo para el cambio de conjunto.

### Grano del recibo

- **Por niño** (ADR-0050). Más simple, pero no admite descuentos de familia y multiplica los
  recibos.
- **Por familia (elegida, F-4-1).** Un recibo regular por familia y mes, con las líneas de todos
  los hijos.

### Dónde se ancla el cierre del mes (decisión R8, F-4-3)

- Al generar los recibos.
- Al generar el fichero del banco. **Descartado:** el efectivo, el cheque guardería y la
  transferencia no generan fichero, así que esos meses no se cerrarían nunca.
- **Cuando ya no queda ningún borrador regular en el mes (elegida).** El cierre significa «mes
  íntegramente procesado».

### Cómo corregir un recibo ya confirmado (R-5)

- **Statu quo:** un esporádico de ajuste. Ensucia el mes.
- **Desconfirmar (elegida, «decisión de Jose (A)»):** el recibo vuelve a borrador, se edita y se
  confirma de nuevo. El candado sigue, pero tiene llave y la llave se ve.

### Qué pasa con lo escrito a mano al regenerar (R-2, R-3)

- **Borrar y reconstruir** (antes): lo manual se pierde.
- **`origen` en cada línea (elegida):** el motor solo vacía las automáticas y reutiliza el recibo,
  con el mismo id.
- Para una línea automática tocada a mano:
  - **Bloquear la edición.** Descartado, porque sería trabajo perdido.
  - **Convertirla en manual (elegida, B1).**

## Decisión

**Recibos a grano familia, con un ciclo borrador → confirmado por recibo, cierre de mes anclado a
«mes íntegramente procesado» y reabrible desconfirmando un recibo que no esté en ninguna remesa.**

### Esquema (F-4-0, F-4-1, F-4-2)

- **`recibos.familia_id NOT NULL`**, y `nino_id` pasa a ser informativo. Hay un único recibo regular
  por familia y mes, con un índice único parcial que deja fuera esporádicos, devoluciones y
  borrados.
- **`lineas_recibo.nino_id` admite NULL:** una línea sin niño es una línea familiar, como el
  descuento por hermanos, el saldo o un cargo de la familia.
- **`estado_recibo` gana `borrador`.**
  - El motor crea los recibos en `borrador`.
  - Confirmar es pasar de `borrador` a `pendiente_procesar`.
  - Los esporádicos nacen confirmados.
- **`metodo_pago` gana `cheque_guarderia`.**
- **`conceptos_cobro` tiene un modelo de valor único** (F-4-0):
  - `signo`: +1 cobro, −1 descuento;
  - `tipo_valor`: `fijo` → `importe_centimos`, `porcentaje` → `porcentaje_bp`;
  - `tipo_concepto`: la periodicidad;
  - `ambito`: niño o familia;
  - `concepto_base_id`, para los descuentos porcentuales.

  Desaparecen `precio_mensual_centimos` y `precio_diario_centimos`.

- **La asignación es permanente:** `asignacion_concepto`, sin mes (F-4-2). La edición de cada mes
  vive en las líneas del borrador. Se borran `asignacion_cuota` y `aplicaciones_concepto`.

### Motor (F-4-3, B1, B2, R-2)

- **`generar_recibos_mes(centro, anio, mes)`** genera los borradores de cada familia.
  - Se puede volver a ejecutar: nunca regenera un recibo confirmado y un mes cerrado no se regenera.
  - Usa un advisory lock por centro y mes.
  - Se borra `cerrar_mes_cobros`.
- **Pases**, con los nombres de la migración:
  - PASE 1: cargos de cada niño;
  - PASE 2: becas fijas, en negativo;
  - PASE 1b: cargos de la familia;
  - PASE 3: descuentos, incluido el **de hermanos**: el que más paga es el primero y no lo recibe;
    si hay empate, decide `nino_id` ASC;
  - PASE 4: saldo a favor del mes anterior.
- **Importe por año de nacimiento (B1).** Precedencia: ajuste manual del niño, luego la tarifa por
  año (si el concepto tiene el flag y hay fila para ese año) y luego el importe base.
- **Beca de comedor v2 (B2).** Cada tramo separa el mes al que corresponde la beca del mes en que se
  aplica.
  - La beca solo descuenta cuota positiva y nunca deja el recibo en negativo.
  - El exceso se registra en `beca_comedor_desborde`, que se resuelve por transferencia o
    difiriéndolo al mes siguiente.
  - Un desborde resuelto queda cerrado al regenerar (B2-3).
  - Spec: `docs/specs/beca-comedor-v2.md`.
- **Origen de cada línea (R-2):** `automatico` | `manual`. El motor nunca toca una manual.
  - El tope de la beca se mide sobre el recibo entero, manuales incluidas.
  - Los descuentos que se derivan de otras líneas solo miran las automáticas.

### Ciclo y congelado (F-4-3, R-5)

- **El congelado de los recibos regulares y sus líneas va por estado.**
  - `borrador`: editable.
  - Al salir de borrador: inmutable salvo el avance de estado y de `fecha_envio_banco`.
  - El parte de servicio sigue congelándose por mes cerrado.
  - `service_role` está exento: es el backend de confianza.
- **`confirmar_recibo`** confirma un recibo. Cuando ya no queda ningún borrador regular en el mes,
  ancla `cierre_mensual` (R8).
- **`desconfirmar_recibo` (R-5)** devuelve `pendiente_procesar` a `borrador`, con dos condiciones:
  - **solo desde `pendiente_procesar`:** `cobrado_manual` queda fuera, porque ese dinero ya ha
    entrado;
  - **solo si el recibo no está en ninguna remesa creada y no borrada.** Lo comprueba
    `recibo_en_remesa`, que comparten el trigger y la RPC.
- **Desconfirmar reabre el mes.** Borra la fila de `cierre_mensual` y la auditoría registra la
  reapertura (`audit_cierre_mensual`). Al confirmar el último borrador, el cierre se vuelve a
  anclar.
- **Lo que no toca desconfirmar:** el contenido económico. Es un UPDATE de una sola columna y el
  bloque de inmutabilidad sigue intacto.
- **Editar a mano (R-3):** añadir una línea la crea `manual`, y editar una automática la convierte
  en manual. El botón de «Recalcular el mes» (R-1) encadena `proponer_asignaciones` y
  `generar_recibos_mes`, e informa de lo que ha cambiado de verdad.

### Método de pago y remesa (F-4-3, F-4-5)

- `metodo_pago_familia` va por familia (R10).
- `get_mandatos_remesa` resuelve el mandato por `recibos.familia_id`. El XML pain.008 se sigue
  generando bajo demanda, igual que en G1 de ADR-0050.

### Estado de cada decisión de ADR-0050

| ADR-0050                                                           | Estado                                                                                                                                                                                            |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Subfases B-0…B-8                                                | Histórico.                                                                                                                                                                                        |
| B. `parte_servicio_diario` como señal de uso                       | **Vigente.**                                                                                                                                                                                      |
| C. `asignacion_cuota` por niño, concepto, año y mes                | **Superada.** `asignacion_concepto` es permanente y la edición de cada mes va en las líneas del borrador (F-4-2).                                                                                 |
| D. Cierre: mensual = 1 línea, diario = días × precio               | **Superada en el motor.** `cerrar_mes_cobros` se borra y lo sustituyen `generar_recibos_mes` y `confirmar_recibo`. El cálculo de una línea mensual y de días × precio se mantiene (F-4-0, F-4-3). |
| E. Becas como línea negativa, saldo arrastrado                     | **Vigente y ampliada:** beca de comedor v2 con desborde (B2).                                                                                                                                     |
| F. Cierre de mes inmutable, no se reabre                           | **Superada.** El cierre significa «mes íntegramente procesado» (R8) y desconfirmar un recibo que no está en ninguna remesa lo reabre, con traza en la auditoría (R-5).                            |
| G1. XML pain.008 bajo demanda                                      | **Vigente.** Solo cambia que el mandato se resuelve por familia (F-4-5).                                                                                                                          |
| H. Método de pago por niño                                         | **Superada.** Va por familia (R10), y se añade `cheque_guarderia`.                                                                                                                                |
| I. Estados del recibo                                              | **Vigente**, con `borrador` añadido delante.                                                                                                                                                      |
| J. Precio congelado en `lineas_recibo`                             | **Vigente.** Las líneas se editan en el borrador (R-2, R-3) y el total se congela al confirmar.                                                                                                   |
| K. Solo Dirección cobra; el IBAN no llega al cliente               | **Vigente.**                                                                                                                                                                                      |
| Congelado afinado de B-5 y doble precio en `conceptos_cobro` (B-4) | **Superados**, por el congelado por estado (F-4-3) y el modelo de valor único (F-4-0).                                                                                                            |

## Consecuencias

### Positivas

- Un recibo por familia, con el descuento por hermanos y los cargos de la familia en el mismo sitio.
- La directora revisa los recibos y los confirma uno a uno. El mes se cierra solo, sea cual sea el
  método de pago.
- Los errores se corrigen sin esporádicos: desconfirmar, editar y confirmar. La reapertura queda en
  la auditoría.
- Lo escrito a mano sobrevive a cualquier regeneración.
- Las becas que paga el ayuntamiento con retraso se descuentan en el recibo donde llegan, sin
  dejarlo en negativo.

### Negativas

- **El cierre de mes deja de ser una garantía de inmutabilidad.** Un mes cerrado puede reabrirse
  mientras alguno de sus recibos no esté en una remesa. La garantía pasa a ser «nada que haya ido al
  banco ni se haya cobrado a mano se modifica».
- Mientras el motor de F-4-3 no estuvo listo, el cierre quedó **temporalmente inoperativo** (F-4-1).
  Se aceptó porque no había datos.
- Se arrastran los follow-ups de ADR-0050: `FRST`/`RCUR` y que `cobrado_manual` no distingue efectivo
  de transferencia.
- Un cargo diario de ámbito familia no se factura: no hay contador de días bien definido para varios
  hijos (F-4-3, «no se inventa»).

### Neutras

- El panel de Dirección se rehace: pestañas Panel del mes, Conceptos, Asignación permanente, Becas,
  Remesas y Resumen. «Cerrar mes» deja de ser un botón (F-4-4, #223).
- La familia ve su recibo familiar en su portal (F-4-6) y lo descarga en PDF con el logo del centro
  (B4).

## Plan de implementación

Ejecutado:

- [x] **F-4-0** (#214): modelo de valor único en `conceptos_cobro`.
- [x] **F-4-1** (#220): recibos y líneas a grano familia, `borrador` y `cheque_guarderia`.
- [x] **F-4-2** (#221): `asignacion_concepto` permanente; se borran `asignacion_cuota` y
      `aplicaciones_concepto`.
- [x] **F-4-3** (#222): `generar_recibos_mes`, `confirmar_recibo`, congelado por estado (R8) y
      método de pago por familia (R10).
- [x] **F-4-4** (#223): panel de revisión y confirmación.
- [x] **F-4-5 / F-4-6** (#224, #225): remesa por familia y recibo en el portal del tutor.
- [x] **F-6c** (#226): `aplicacion` automática o manual en el catálogo.
- [x] **B1** (#244–#246): tarifa por año de nacimiento.
- [x] **B2** (#247, #248, #251–#253, #276): beca de comedor v2.
- [x] **B3 / B4** (#243, #242): descripción sin el nombre del niño y PDF.
- [x] **R-1…R-5** (#271–#275): recalcular, `origen`, edición a mano, test del ciclo completo y
      desconfirmar.

## Verificación

- **Tests RLS con flag**, activados en la suite nocturna contra producción y en la BD efímera de cada
  PR:
  - `F40_*`, `F41_*`, `F42_*`, `F43_*`, `F45_*`;
  - `B1_TARIFA_ANIO_APPLIED`, `B1_MOTOR_TARIFA_ANIO_APPLIED`;
  - `BECA_COMEDOR_V2_APPLIED`, `BECA_COMEDOR_V2_MOTOR_APPLIED`, `B23_MIGRATION_APPLIED`;
  - `R2_MIGRATION_APPLIED`, `R5_MIGRATION_APPLIED`.
- **R-3 (#273)** añadió 9 casos contra la BD real que fijan el contrato de R-2:
  - una línea manual sobrevive a dos regeneraciones y el recibo conserva su id;
  - un recibo con solo líneas manuales no se borra;
  - el desborde no se duplica;
  - y el resto de casos de #273.
- **R-4 (#274)** prueba el ciclo completo de punta a punta.

## Notas

- **Fuentes:** las cabeceras de las migraciones citadas, en especial las de F-4-3 (decisiones R8 y
  R10), R-2 y R-5, y los cuerpos de los PRs #220, #223, #271 y #273.
- La beca de comedor variable por mes (D-6, `beca_comedor_mes`) existió entre B2-0 y B2-6 y se
  retiró en favor de la v2.

## Referencias

- **Migraciones:**
  - serie F-4: `20260724120000_phase_f40_reconciliar_conceptos_valor`,
    `20260728120000_phase_f41_recibos_grano_familia`,
    `20260730120000_phase_f42_asignacion_persistente`,
    `20260801120000_phase_f43_motor_recibos_familia`,
    `20260803120000_phase_f45_get_mandatos_remesa_familia`;
  - bloque B: `20260814120000_phase_b3_motor_descripcion_sin_nombre`,
    `20260815120000_phase_b1_0_tarifa_concepto_anio`, `20260816120000_phase_b1_1_motor_tarifa_anio`,
    `20260817120000_phase_b2_0_beca_comedor_v2_modelo`,
    `20260818120000_phase_b2_1_motor_beca_comedor_v2`,
    `20260819120000_phase_b2_6_drop_beca_comedor_mes`,
    `20260829120000_phase_beca_b2_3_desborde_resuelto_cerrado`;
  - serie R: `20260827120000_phase_recibos_r2_origen_lineas`,
    `20260828120000_phase_recibos_r5_desconfirmar`.
- **ADRs relacionados:**
  - ADR-0050: F12-B, parcialmente superado por este;
  - ADR-0051: la familia como unidad;
  - ADR-0004: cifrado pgcrypto + Vault.
- **Spec:** `docs/specs/beca-comedor-v2.md`.
- **Diario:** `docs/journey/progress.md`, secciones «Serie F-4», «Bloque B de recibos» y «Serie R».
