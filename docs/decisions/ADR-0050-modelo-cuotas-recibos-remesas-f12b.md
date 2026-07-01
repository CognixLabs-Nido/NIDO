# ADR-0050: Modelo de cuotas, recibos y remesas SEPA (F12-B)

## Estado

`accepted`

**Fecha:** 2026-07-01
**Autores:** responsable + claude-code
**Fase del proyecto:** Fase 12-B — Cuotas, recibos y remesas SEPA

## Contexto

Una escuela infantil cobra a las familias una mezcla de conceptos: cuotas fijas mensuales
(plaza, permanencias), servicios de uso variable facturados por día (comedor, matinera,
vespertina), becas/ayudas que reducen el importe, y cobros esporádicos (excursiones,
material). El cobro real se domicilia mayoritariamente por **SEPA** (adeudo directo), con
un mandato firmado por la familia (capturado en F11-G-2/G-2bis, con el IBAN cifrado en
reposo). El resto se cobra en efectivo/transferencia y se concilia a mano.

F12-B construye ese ciclo completo dentro de NIDO: catálogo de conceptos, configuración por
niño/mes, señal de uso diario, motor de cierre que genera los recibos, remesa SEPA
(pain.008), devoluciones, y las vistas para dirección y familia. Es la primera fase de
funcionalidad de F12 (sigue en Ola 1) y **consume** el mandato SEPA de G-2bis
(`mandatos_sepa.iban_cifrado` + `identificador_mandato`).

Decidir ahora el modelo importa porque toca dinero (integridad e inmutabilidad), datos
personales sensibles (IBAN → RGPD) y un formato bancario normalizado (pain.008.001.02), y
porque el piloto de ANAIA necesita operar el cobro de forma autónoma.

Restricciones del proyecto que condicionan el diseño: dinero en **céntimos enteros**; RLS
default-DENY con helpers `SECURITY DEFINER`; cifrado de columna con pgcrypto + Vault (patrón
médico ADR-0004); migraciones aplicadas **a mano por SQL Editor** (el CLI peta con SIGILL);
tests RLS gated por flags `*_MIGRATION_APPLIED` contra la BD compartida.

## Opciones consideradas

El grueso de las alternativas se evaluó por decisión (A–K) durante el arranque
(2026-06-28). Se resumen las tres disyuntivas con más peso arquitectónico; el resto quedan
listadas en "Decisión".

### Opción A: Becas como línea negativa (elegida)

Modelar la beca/ayuda como una **línea de recibo con importe negativo** que resta sobre el
total, con su propio tipo (`tipos_beca`) e importe/periodo por niño (`becas`).

**Pros:**

- El recibo es transparente: la familia ve el cargo y el descuento como líneas separadas.
- El total puede ser **negativo** (saldo a favor) y arrastrarse al mes siguiente sin lógica
  especial: es una línea más.
- No hay que tocar los precios del catálogo ni inventar "conceptos exentos".

**Contras:**

- Hay que cuidar que el total negativo se propague (línea de apertura del mes siguiente).
- La devolución de dinero al irse del centro se gestiona a mano (no se automatiza).

### Opción B: Beca como exención / precio 0

Marcar el concepto como exento o poner el precio a 0 para ese niño.

**Pros:**

- Menos filas.

**Contras:**

- Opaco (la familia no ve cuánto se le ha bonificado).
- No permite saldo a favor ni ayudas parciales configurables.
- Rompe la congelación de precios (el catálogo dejaría de ser la fuente del importe vigente).

### Opción C (XML SEPA): almacenar el fichero pain.008 vs generarlo bajo demanda

Guardar el XML generado en un bucket (`remesas-sepa`) con su `xml_path`, **o** generarlo
bajo demanda y descargarlo sin persistirlo (G1).

**Pros de bajo demanda (elegida):** menos superficie RGPD (IBANs en claro no quedan en
reposo en la app); regenerable; `remesas` solo guarda estado + fecha de envío.
**Contras:** hay que reconstruir el fichero si se pierde la descarga (aceptable: es
determinista); el fichero descargado por la directora queda fuera del control de la app (va
al RAT).

## Decisión

**Se elige el modelo A–K acordado el 2026-06-28**, implementado en las subfases B-0…B-8:

- **A** Código F12-B, subfases una-por-PR (B-0…B-8).
- **B** Señal de uso diario = tabla nueva `parte_servicio_diario` (comedor/matinera/vespertina,
  `presente` por niño/fecha/servicio). No se reutiliza `comidas` (señal nutricional).
- **C** `asignacion_cuota`(niño, concepto, año, mes, modalidad `mensual|diario`), UNIQUE por
  (niño, concepto, año, mes). Sin prorrateo intra-mes.
- **D** Cierre: mensual → 1 línea a precio mensual; diario → nº de días marcados presentes en
  el parte × precio diario.
- **E** **Becas = línea negativa** (Opción A). `tipos_beca` catálogo por centro, `becas`
  tipo+importe+periodo por niño. Total puede ser negativo → se arrastra como línea de apertura
  negativa. Saldo al irse = gestión manual.
- **F** Cierre de mes **inmutable**: `cierre_mensual` sin UPDATE/DELETE; no se reabre. Errores
  → recibos correctivos/esporádicos + devoluciones.
- **G1** XML SEPA **no se almacena**: se genera bajo demanda (server) y se descarga,
  regenerable. Sin bucket ni `xml_path`.
- **H** `metodo_pago_familia` a nivel niño, por niño/mes (`sepa|efectivo|transferencia`). Solo
  `sepa` entra al XML; el resto → recibo `pendiente_procesar`.
- **I** Estados de recibo: `pendiente_procesar | enviado_banco (con fecha) | devuelto |
cobrado_manual`. Sin reconciliación automática con el banco. Devoluciones manuales
  (`devuelto_de_recibo_id`; puede haber >1 recibo/mes por re-giros).
- **J** Precio **congelado** en `lineas_recibo` (el catálogo guarda el vigente; cambiarlo no
  reescribe recibos pasados).
- **K** Solo el admin cierra el mes y gestiona remesas; la profe solo apunta el parte; el IBAN
  nunca es legible por el cliente (descifrado = RPC server-side admin-only).

Y las dos decisiones grandes con ADR propio dentro de esta fase:

- **XML pain.008 bajo demanda (G1, Opción C)**: `remesas` guarda estado + `fecha_envio_banco`;
  el fichero se genera server-side y se descarga; el generador es **TypeScript puro y
  determinista** (recibe los timestamps por parámetro), no una Edge Function.
- **IBAN del acreedor cifrado** en `centros` (`iban_acreedor_cifrado bytea`), mismo trato que
  el IBAN del mandato (pgcrypto + clave `sepa_encryption_key` en Vault). CID e `bic_acreedor`
  van en claro (no son secreto). El descifrado (deudor y acreedor) solo ocurre en RPCs
  `SECURITY DEFINER` admin-only, y **solo** para construir el XML.

**Congelado afinado (trigger `congelar_si_mes_cerrado`).** Con `cierre_mensual` del periodo,
el trigger bloquea el parte y los recibos regulares + líneas. En B-5 se **afinó** para
permitir el ciclo de cobro: un UPDATE que solo cambia `estado`/`fecha_envio_banco` de un
recibo regular de mes cerrado **pasa**; tocar contenido económico o de identidad
(`total_centimos`, `metodo`, `nino_id`, `anio`, `mes`, `es_esporadico`, `concepto_esporadico`,
`devuelto_de_recibo_id`) o hacer INSERT/DELETE **falla con P0001**. Los esporádicos y los
re-giros (`devuelto_de_recibo_id NOT NULL`) están exentos: las correcciones van por ahí.

## Consecuencias

### Positivas

- Ciclo de cobro completo y auditable dentro de la app; el piloto opera sin SQL manual.
- Integridad del dinero: precios congelados por línea, cierre inmutable, motor atómico e
  idempotente, mutaciones de mes cerrado acotadas por trigger a nivel BD.
- Minimización de datos: el IBAN (deudor y acreedor) vive cifrado en reposo y solo se
  descifra server-side en el momento de generar el XML; nunca viaja al cliente.
- La familia ve sus recibos y el desglose (conceptos, becas, saldo) en solo lectura; el aviso
  de "recibos nuevos" reutiliza el patrón derivado de informes/fotos (sin push ni tabla).

### Negativas

- Deuda RGPD explícita pendiente con F11-B (retención de recibos/remesas, el XML descargado
  fuera del control de la app, RAT). Bloqueante antes del primer dato real.
- Follow-ups diferidos: secuencia SEPA **FRST/primera-vez** (hoy siempre RCUR) y `cobrado_manual`
  sin distinguir efectivo/transferencia.
- La devolución de saldo a favor al causar baja es manual (por diseño, no se automatiza).

### Neutras

- Nuevo flujo operativo para dirección (`/admin/cuotas`: conceptos, asignación, becas, cierre,
  remesas, resumen).
- Tres flags de gated tests nuevos en CI (`F12B_RLS_APPLIED`, `F12B_5_RLS_APPLIED`,
  `F12B_6_RLS_APPLIED`) → CI corre más suites RLS contra la BD compartida.

## Plan de implementación

Ejecutado en subfases (una por PR):

- [x] **B-0** Fundación: 11 tablas + 6 ENUMs + audit + RLS default-DENY + helpers/triggers.
- [x] **B-1** Catálogo de conceptos (`/admin/cuotas`).
- [x] **B-2** Configuración por niño/mes (modalidad + método + becas).
- [x] **B-3** Parte de servicio diario (feature `parte-servicio`, ruta de aula).
- [x] **B-4** Motor de cierre (`cerrar_mes_cobros`) + doble precio en `conceptos_cobro` +
      trigger de congelado + esporádicos.
- [x] **B-5** `get_mandatos_remesa` + acreedor cifrado + generador pain.008 bajo demanda +
      congelado afinado.
- [x] **B-6** Devoluciones (CHECK reescrito, re-giro, gastos como esporádico).
- [x] **B-7** Vistas admin (pivote + CSV) y familia (recibos + desglose) + aviso in-app derivado.
- [x] **B-8** ADR (este documento) + tests RLS gated activados en CI + `progress.md`/`follow-ups.md`.

## Verificación

- Tests de schema de B-4 (17/17) y unit de B-7 (builder pivote / pivote→CSV / export-csv).
- Suites RLS gated (contra la BD remota, con las migraciones aplicadas): B-0 (11 tablas,
  aislamiento familia/centro, admin-only, cierre inmutable), B-5 (`get_mandatos_remesa`
  admin-only + acreedor round-trip + congelado afinado PASA/FALLA P0001), B-6 (CHECK de fechas
  - re-giro exento), B-7 (aislamiento entre dos familias del **mismo** centro). **4 suites /
    22 tests** en verde; activadas en `ci-pr.yml` en B-8.
- Verde local por PR (typecheck + lint + prettier + build + unit) antes de abrir.

## Notas

- El generador pain.008 emite `SeqTp=RCUR` fijo; `FRST` queda diferido (requiere una marca
  por mandato de "ya girado alguna vez").
- Gotcha recurrente `db:types`: al aplicar una migración se regenera `database.ts` y revierte
  el hand-typing de argumentos nullable de RPC (`p_metodo`, `p_iban`) → restaurar de HEAD y
  re-aplicar solo las columnas nuevas a mano.
- Gotcha de los embeds: las tablas B-0 se tiparon a mano sin `Relationships`, así que los
  `select` con tabla foránea embebida no tipan → selects separados + join en memoria.

## Referencias

- Progreso: `docs/journey/progress.md` (F12-B — CERRADA: B-0 a B-8).
- Follow-ups: `docs/follow-ups.md` (F12-B — dependencia RGPD F11-B, FRST, cobrado_manual).
- ADRs relacionados: ADR-0004 (cifrado de columna pgcrypto + Vault), ADR-0007 (recursión RLS),
  ADR-0049 (F11-G altas con documentos, captura del mandato SEPA).
- Migraciones: `20260628120000_phase12b_0_*`, `20260630120000_phase12b_4_motor_cierre`,
  `20260701120000_phase12b_5_get_mandatos_remesa`, `20260701140000_phase12b_6_devoluciones`.
