# ADR-0063: El plan de recibos: cerrar el circuito del cobro

## Estado

`accepted`

**Fecha:** 2026-10-25
**Autores:** responsable + claude-code
**Fase del proyecto:** F12-B, plan de recibos (#399–#418)

## Contexto

El 2026-10-21 un diagnóstico en solo lectura de recibos, cobros y becas encontró que el circuito estaba a medias, cuando se creía construido. El cálculo del recibo funcionaba (ADR-0052). Lo que fallaba era todo lo que pasa **después** de calcularlo: cómo se cobra, qué pasa con una devolución y dónde va el dinero que sobra.

**Seis agujeros:**

- **1a.** El cobro a mano no distinguía efectivo de transferencia ni guardaba fecha.
- **1b.** No había forma de cobrar con cheque guardería o ticket restaurant. Tampoco de saber qué hacer si el cheque no cuadra con el recibo.
- **2.** Una devolución se podía cobrar dos veces: re-girarla y además cobrarla en efectivo.
- **3.** Un recibo se validaba con el desborde de beca pendiente, y ese dinero de la familia no iba a ningún sitio.
- **4.** El motor cobraba la cuota mensual de un servicio y también sus días.
- **5.** Nadie escribía la beca «aplicada», así que no se sabía qué becas se habían descontado.

**Nueve mejoras** que el responsable pidió en el mismo diagnóstico:

- importe propio por niño;
- método de pago en la ficha de la familia;
- descuento por hermano por familia;
- una sola forma de poner una beca;
- carga de beca por alumno;
- panel de becas;
- un listado único del pase de servicios;
- cargo puntual a varios niños;
- llevar una devolución al recibo siguiente.

El plan se cerró con el responsable en seis rondas antes de escribir código, y se construyó en orden, un PR cada vez.

## Opciones consideradas

### Opción A: dejarlo como estaba y corregir a mano

**Pros:** sin trabajo.

**Contras:** cada caso raro dependía de que la directora supiera el apaño, y algunos apaños cobraban dos veces o perdían dinero de la familia sin dejar rastro. Con familias reales, la primera devolución lo habría destapado.

### Opción B: rehacer el módulo de cobros

Un modelo nuevo de pagos y saldos, con recibos que se parten en varios cobros.

**Pros:** un modelo general que cubre cualquier combinación.

**Contras:**

- tira lo que ya funciona (el motor, el borrador → confirmado, el cierre de mes de ADR-0052);
- partir un recibo cambia lo que la familia ve y lo que el banco recibe;
- el responsable no lo quería («no se parten recibos»).

### Opción C: cerrar cada agujero sobre el modelo existente, un PR cada vez

Cada salida del dinero (cobro, devolución, desborde, sobrante) tiene un estado explícito y una sola función que la escribe. El motor solo se toca cuando el cálculo está mal.

**Pros:**

- cada PR se aplica, se verifica en vivo y se puede revertir solo;
- lo que ya está en producción no cambia de forma;
- las decisiones de producto se toman una a una, con el caso delante.

**Contras:** son muchos PRs en fila, porque cuatro reescriben `generar_recibos_mes` y dos tocan `confirmar_recibo`. Cada uno parte de la definición viva que dejó el anterior.

## Decisión

**Se elige la Opción C.** Los PRs se numeraron por el plan, no por el orden de llegada. Las decisiones del responsable van marcadas.

### Cómo se cobra

- **PR-1a, cobro a mano** (`20261105120000`, #399). El cobro guarda su forma (efectivo o transferencia), su fecha y una nota que no entra en `audit_log`. Los pendientes que no son SEPA salen en «Cobros y devoluciones» con «Marcar cobrado». Un SEPA pendiente solo se cobra por remesa (trigger `recibos_validar_cobro_manual`). Aparte, #400 montó el toaster: los avisos de la app no se veían.
- **PR-1b, cheque guardería / ticket restaurant** (`20261106120000`, #401). La directora mete el importe del cheque y la app resta. Si el cheque es menor, la diferencia va a un recibo esporádico ligado (`diferencia_de_recibo_id`), por SEPA, efectivo o transferencia. **No se parten recibos** (decisión del responsable; se descartó el PR-15). Lo escribe `cobrar_recibo_con_cheque` en una transacción.
- **PR-1c, cheque mayor que el recibo** (`20261119120000`, #418). El sobrante tiene **el mismo trato que el desborde de beca** (decisión del responsable): diferirlo al mes siguiente o devolverlo por transferencia. Va en la misma tabla, que distingue el origen (`beca_comedor_desborde.origen`). Diferir no reparte entre hermanos: es una línea de saldo a favor en el recibo del mes siguiente.

### Una devolución, una sola salida

- **PR-2** (`20261107120000`, #402). Cada devolución tiene una sola salida (`devolucion_salida`), escrita por `resolver_devolucion` con la fila bloqueada. El recibo sigue `devuelto` y dice por dónde se cobró. Las salidas posibles:
  - banco: un re-giro por total + gastos, uno por devolución;
  - efectivo;
  - transferencia.

  Los gastos se preguntan al registrar la devolución y van en columna propia, porque el total validado está congelado.

- **PR-14, la cuarta salida: llevarla al siguiente recibo** (`20261117120000`, #415; corregida en `20261118120000`, #417). Es una línea manual con su origen (`lineas_recibo.arrastre_de_recibo_id`) en el recibo de la familia **del mes siguiente, sin saltos, exista o no** (decisión del responsable). Si no existe, se crea en borrador. Si ya está validado, o el mes está cerrado sin recibo, la salida no se ofrece.

### El dinero de la familia no se queda en el aire

- **PR-3** (`20261108120000`, #403). Un recibo con su desborde de beca pendiente no sale de borrador por ningún camino, tampoco con `service_role` (trigger `recibos_validar_sin_desborde`).
- **PR-5** (`20261110120000`, #405). La línea de beca guarda qué tramo descuenta. Al validar, el tramo pasa a `aplicada`; al volver a borrador, a `pendiente` (trigger `recibos_aplicar_becas`). Una beca aplicada no se toca.
- **Si se borra la línea que lleva el dinero al mes siguiente**, a mano o con su recibo, la devolución vuelve a quedar sin resolver y el sobrante, pendiente (triggers AFTER DELETE `SECURITY DEFINER`).

### El cálculo

- **PR-4** (`20261109120000`, #404). Un mensual puede llevar servicio, y el motor no cobra los días de ese servicio a quien tiene ese mensual.
- **PR-6, importe propio por niño y por familia** (`20261111120000`, #406). Va en la asignación y se arrastra cada mes.
- **PR-7, el método de pago en la ficha** (`20261112120000`, #407). El mandato del alta pasa a la familia a recibo por banco, salvo que la directora ya lo haya elegido. El selector mensual queda como excepción de un mes. Con él, el aviso a Dirección cuando una familia firma o cambia su domiciliación ya dada de alta (#408, sin migración).
- **PR-8, descuento por hermano fijo o porcentaje por familia** (`20261113120000`, #409). El porcentaje solo se aplica sobre la escolaridad.
- **PR-9, una sola forma de poner una beca** (`20261114120000`, #410). Se eliminan `becas` y `tipos_beca`, que tenían 0 filas, junto con el PASE 2 del motor y su sección del export (art. 15).

### Las pantallas

- **PR-10, carga de beca por alumno** (#411, sin migración). Precargada con los importes de la anterior.
- **PR-11, panel de becas** (#412, sin migración). Una fila por alumno y una columna por mes, con el estado de cada beca.
- **PR-12, listado único del pase de servicios** (`20261115120000`, #413). Para cualquier profe del centro (`es_profe_en_centro`), sin abrirle fichas de otras aulas.
- **PR-13, cargo puntual a varios niños** (`20261116120000`, #414). Una línea manual en el recibo de cada familia, en una transacción (`anadir_cargo_puntual`).

### Lo que se repite en todos

- **Una función escribe, un trigger vigila.** Las transiciones de dinero (cobrar, resolver, diferir) solo las hace su función. Un trigger con marcador local (`set_config(…, true)`) rechaza el mismo cambio por cualquier otro camino, también con `service_role`.
- **Nada entra en `audit_log` que la purga no sepa limpiar.** La nota del cobro, texto libre, queda fuera. Y el export del art. 15 se actualiza en el mismo PR que añade la columna.
- **Guardas de md5 normalizado** delante, sobre todo lo que la migración recrea o cruza, y detrás, sobre lo que deja. Cada una tiene su control negativo, ensayado en producción con transacción implícita.
- **Primero el despliegue, después la migración.** El código nuevo funciona sin la migración.

**Fuera del plan** (decisión del responsable):

- la secuencia SEPA FRST: el responsable lo pregunta a su banco, y desde 2016 RCUR vale en el primer cobro;
- el becado tardío: se corrige a mano.

## Consecuencias

### Positivas

- Cada euro que entra o sobra tiene un estado y una salida, y una segunda resolución se rechaza.
- Lo que antes era un apaño de la directora ahora es una pantalla con su función y su test contra la base de datos real.
- Las salidas que llevan dinero al mes siguiente (devolución y sobrante) siguen las mismas reglas y crean el recibo si no existe.

### Negativas

- Un recibo creado en un mes sin generar puede cerrar ese mes al validarse. Riesgo aceptado: los recibos se pasan el día 1 (`follow-ups.md`).
- `resolverDesborde` (beca) sigue siendo varias escrituras desde la app, no una transacción (`follow-ups.md`).
- `beca_comedor_desborde` guarda también el sobrante del cheque. Sus columnas (`cuota_total`, `beca_total`) leen «recibo» y «cheque» cuando el origen es `cheque`, y lo fija un CHECK.

### Neutras

- `generar_recibos_mes` y `confirmar_recibo` se recrearon varias veces en fila. La siguiente migración que las toque parte de la definición viva, con su md5 en la guarda.

## Plan de implementación

- [x] PR-1a #399 · toaster #400 · PR-1b #401 · PR-2 #402 · PR-3 #403 · PR-4 #404 · PR-5 #405
- [x] PR-6 #406 · PR-7 #407 + aviso #408 · PR-8 #409 · PR-9 #410 · PR-10 #411 · PR-11 #412 · PR-12 #413 · PR-13 #414
- [x] PR-14 #415 + corrección #417 · PR-1c #418
- [x] Las 15 migraciones (`20261105120000`–`20261119120000`), aplicadas y registradas. El 2026-10-25 el registro de producción coincide con el repo (197 de 197).

## Verificación

- **Cada PR con migración tiene su propio test RLS contra la base de datos efímera**, de `recibos-cobro-manual.rls.test.ts` (PR-1a) a `cheque-sobrante.rls.test.ts` (PR-1c). Los que cambian el motor actualizan además los tests del motor que ya existían.
- **Cada migración, verificada en vivo en solo lectura tras aplicarla:** registro, md5 de las funciones, triggers, restricciones y permisos.

## Referencias

- ADRs relacionados: ADR-0050 (cuotas, recibos y remesas), ADR-0052 (recibos por familia y cierre de mes).
- `docs/architecture/rls-policies.md`: una sección por PR del plan.
- `docs/follow-ups.md`, F12: lo cerrado y lo que queda.
