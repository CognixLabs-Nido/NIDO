---
feature: altas-serie
wave: 1
status: approved
priority: high
last_updated: 2026-10-31
related_adrs: [ADR-0049, ADR-0050, ADR-0063, ADR-0064]
related_specs: [alta-tutor-driven, autorizaciones-firma, retencion-plazos]
---

# Spec — Serie de altas: la ficha de inscripción del centro dentro de NIDO

## Resumen ejecutivo

Que lo que pide el alta de NIDO coincida con lo que pide hoy la directora en papel (ficha de
solicitud de plaza, orden de domiciliación SEPA, presupuesto y tarifas, normas de régimen interno),
y que la familia firme dentro de la app los documentos del centro tal cual los tiene el centro.

Esta spec recoge las **decisiones del responsable** (2026-10-29 y 2026-10-31) sobre el diagnóstico
del 2026-10-29, el **orden de la serie** y lo que **sigue pendiente**. Cada PR de la serie la
actualiza: lo decidido se mueve de «Pendiente» a su sección y lo construido se marca en «Estado».

## Contexto

Diagnóstico solo lectura del 2026-10-29 (main `777013f`), comparando el alta con los documentos
reales de ANAIA (curso 2026/2027). Lo medido entonces, que motiva la serie:

- DNI del tutor 1, libro de familia y mandato SEPA **ya existían** (F11-G, ADR-0049) y eran
  obligatorios para finalizar el alta. Lo que falta de la ficha de papel es otra cosa: el SIP, los
  teléfonos, el número de DNI y la fecha de nacimiento de los tutores, estudios y empresa, hermanos,
  lugar de nacimiento, DNI del alumno, provincia, «¿cómo nos has conocido?» y la firma de la ficha.
- El botón «Omitir por ahora» del paso SEPA no omitía: llama a finalizar y el gate respondía
  «falta: Mandato SEPA». Una familia que paga en efectivo no podía cerrar el alta.
- En producción, `autorizaciones` y `firmas_autorizacion` tenían 0 filas: las normas de régimen
  interno se aceptaban por casilla sin documento detrás.
- El PDF del mandato SEPA no lleva el identificador del acreedor (CID), ni lo lleva el texto
  canónico que se hashea.
- En el adeudo, el concepto (`Ustrd`) es el UUID del recibo.
- Ningún tutor tiene teléfono guardado: el del prospecto se queda en `lista_espera`.
- `purgar_sujeto_db` anonimiza `familia_tutores` nombrando columna a columna: una columna nueva de
  tutor sobreviviría al olvido sin aviso.
- `firmas_autorizacion` → `autorizaciones` es `ON DELETE CASCADE`.

## Agujeros encontrados al preparar la serie (2026-10-31)

1. **No había spec de la serie en el repo.** Las decisiones del 2026-10-29 solo existían en una
   conversación y en la memoria de la sesión. Esta spec es la primera fuente escrita.
2. **«CORE/B2B» y la «pantalla de altas en proceso»** figuran en el orden de la serie pero **no
   están especificadas en ningún sitio**. CORE/B2B lo decidió el responsable el 2026-10-31 (abajo,
   en SEPA). La pantalla de altas en proceso necesita su propio alcance antes de empezarla.
3. **`MndtId` y `EndToEndId` miden 36 caracteres y pain.008.001.02 admite 35** (`Max35Text`).
   Medido en producción el 2026-10-31: los 3 mandatos (`identificador_mandato`) y los 4 recibos
   (`recibos.id`, UUID con guiones) miden 36. El identificador se genera como
   `NIDO-{8}-{8}-{timestamp en ms, 13 dígitos}` y `MAX_LARGO_IDENTIFICADOR` es 80 (el CHECK de la
   columna), no el límite del banco. Un banco que valide el fichero contra el esquema rechazaría
   la remesa entera. El test del generador pasaba porque su fixture usaba un identificador
   inventado de 16 caracteres (`NIDO-DEMO-TUT1-1`), no la forma real.
4. **Apuntado, sin investigar (decisión del responsable):** CEI Ejemplo tiene una remesa en estado
   `enviada` sin acreedor configurado (sin CID, BIC ni IBAN de acreedor). Son datos de prueba.

## Decisiones del responsable

### Documentos del centro (presupuesto y normas)

- **D1 · Documento subido y firmado tal cual.** El centro sube su PDF, la familia lo ve, se lo
  descarga y lo firma. Nada de copiar el texto a una plantilla dentro de la app.
- **D2 · El presupuesto se firma con trazo,** como las normas. Lo que se busca es que después no
  puedan decir que no lo sabían, y una casilla aguanta menos que una firma.
- **D3 · Son dos documentos distintos y los dos se firman:** el presupuesto y tarifas (el PDF del
  curso, con las tarifas, qué incluye cada servicio y las preguntas frecuentes) y las normas de
  funcionamiento y régimen interno, que es otro fichero. El mecanismo soporta **N documentos
  obligatorios**. Queda abierto qué pasa si el centro no ha subido uno (P-6).
- La firma queda atada a **la versión exacta** firmada (hash del fichero). Subir el presupuesto del
  curso siguiente crea una versión nueva; las firmas anteriores siguen apuntando al documento viejo,
  y una versión con firmas no se puede borrar.
- **Las normas se firman aparte de la ficha** («una cosa es que firme NIDO APP y otra las reglas de
  funcionamiento y régimen interno»).

### Gastos de gestión

- Un paso del alta donde el tutor **adjunta el justificante de la transferencia o indica que pagará
  en efectivo**. El importe no es fijo: cambia de un curso a otro.
- **D5 · Sin bloqueo automático ni «exento».** La directora ve lo que declaró la familia y el
  justificante si lo hay, y ella decide al validar. Es su criterio, no una regla de la app.
- **D6 · No se crea ningún recibo** por los gastos de gestión. Solo queda la marca de que se cobró.

### SIP

- El **número** se pide en el alta; la **imagen** se adjunta después.
- **D7 · El número es un identificador como el DNI:** en claro, con los datos del niño, **no** en la
  ficha médica cifrada (la ficha se bloquea al terminar el curso de la baja, la Conselleria lo
  quiere en el expediente, y cada consulta ensuciaría el registro de lecturas).
- **D8 · La imagen va en su propio bucket,** como `dni-tutores`. Mismo criterio para el justificante
  de gastos de gestión. Un test comprueba que la purga alcanza los buckets nuevos.

### SEPA

- **D9 · El nombre del niño va en el concepto de cada adeudo,** no en el mandato (el mandato es de la
  familia y cubre a los hermanos).
- **D10 · El SEPA no es obligatorio para cerrar el alta.** «Omitir por ahora» omite de verdad, y esa
  familia queda en método **efectivo** (`familias.metodo_pago` ya vale `efectivo` por defecto).
- **El CID entra en el mandato con una versión 2 del texto canónico,** para que los mandatos ya
  firmados sigan verificando con su hash.
- **Longitud de los identificadores (2026-10-31):** los identificadores nuevos miden 35 caracteres o
  menos; el generador rechaza los largos con un mensaje claro; los 3 mandatos de prueba de CEI
  Ejemplo se quedan como están; los fixtures usan la forma real, no una inventada corta.

Decisiones del 2026-10-31 sobre las cinco preguntas del PR-0:

- **FRST en el primer cobro de cada mandato, RCUR en los siguientes.** La razón es **multicentro**,
  no lo que conteste un banco: cada centro trabaja con su banco, no se puede preguntar a todos ni
  dar por hecho que todos acepten RCUR en el primer cobro (lo que permiten las reglas desde 2016).
  Se emite lo que acepta cualquiera. Es el PR-0d y va el último. El riesgo que trae, que el mismo
  mandato salga dos veces como FRST (en dos remesas, o en una remesa que se vuelve a abrir), se
  traza junto con reabrir remesas (abajo, pendiente).
- **CORE para todos; B2B no se construye.** Hay centros donde la cuota la paga la empresa de un
  padre desde su cuenta de empresa, y CORE admite a una empresa como deudor. Lo único que añade B2B
  es que el deudor no puede pedir la devolución, a cambio de que cada empresa registre el mandato en
  su banco antes del primer cobro; si no lo hace, el cobro se rechaza. Para una guardería eso es más
  rechazos, no menos riesgo.
- **El CID no toca el alta.** Que el centro no tenga el identificador de acreedor no cambia nada en
  el alta de la familia: el mandato se firma igual. Lo que se añade es un **aviso en la pantalla
  donde el centro configura sus datos bancarios**: sin ellos no se pueden pasar recibos al banco. Se
  dice qué falta y para qué sirve, nada más. (Corrige la propuesta del 2026-10-31, que lo trataba
  como un caso del paso SEPA.)
- **El mandato pide el NIF y la dirección del titular**, como el papel. Hoy solo lleva nombre e
  IBAN. Se teclean en el paso SEPA, porque el titular puede no ser un tutor. Si al trazarlo aparece
  un caso donde no se puedan pedir, se para y se pregunta antes de construirlo.
- **Concepto del adeudo: centro, niño y mes, sin tildes.** Ejemplo: `ANAIA · Lucia Garcia Lopez ·
Octubre 2026`. Sin tildes porque el juego de caracteres de SEPA no las garantiza; máximo 140
  caracteres. Cada recibo es de un solo niño. Va en el 0b.

### Ficha y tutores

- **D11 · La ficha se firma.** Hoy el alta termina con «Finalizar» y no se firma nada.
- **D12 · DNI del tutor 2:** si hay segundo tutor, su DNI es obligatorio; si no lo hay (divorcio,
  fallecimiento…), no se pide. Las personas autorizadas a recoger ya tienen su DNI (recogida).
- **D13 · Nº de matrícula:** lo que hay sirve. No se construye nada.
- **D14 · Todo tutor que se dé de alta, con teléfono obligatorio.**
- **D15 · Fecha de nacimiento de los tutores: obligatoria.**
- **D16 · Estado civil: se queda como está.**
- **Estudios y empresa** de cada tutor: se quedan, **voluntarios** y marcados como tales en pantalla.

### Niño

- **Nº total de hermanos y lugar que ocupa:** se quedan.
- **DNI del alumno:** no obligatorio (los bebés no suelen tener).
- **Lugar de nacimiento y nacionalidad:** se quedan.
- **¿Cómo nos has conocido?:** se queda, voluntario.

### Servicios (media pensión)

- Media pensión es comedor más jornada extendida (matinera y tarde). En el alta, **una fila por
  servicio** que el centro tenga en Cuotas, con _No / Todos los meses / Días sueltos_. Es una
  **petición**: la directora la aplica al validar (`fijar_asignaciones_concepto`). La familia nunca
  escribe en la facturación.

### Purga

- El test que compara la purga con el **catálogo de columnas** entra en el **mismo PR** que añada
  los campos de tutor, no después.

> D4 del diagnóstico (las 3 aceptaciones de normas por casilla en CEI Ejemplo) no tuvo respuesta. La
> propuesta era ignorarlas: es un centro de prueba.

## Pendiente de decisión del responsable

P-1 a P-5 se contestaron el 2026-10-31 y están arriba, en SEPA. Quedan:

- **Reabrir remesas · sin especificar.** Va en el orden entre el 0c y el 0d, y el riesgo del FRST
  repetido se traza con él. Su alcance no está escrito en ningún sitio: se especifica aquí antes de
  empezarlo.
- **P-6 · Documento obligatorio del centro sin subir** (de D3; se pregunta al llegar al PR-2).
  Ejemplo: el centro ha subido el presupuesto pero no las normas, y una familia llega al final del
  alta. Propuesta: el alta no se puede cerrar y Dirección ve en su inicio qué documento falta.

## Orden de la serie

Del 3 en adelante todos tocan `purgar_sujeto_db`, `privado.purgar_nino` y la exportación del
art. 15 (las funciones de la serie de retención, ADR-0064). Cada PR parte de la **definición viva**
de esas funciones, no de la que haya en esta spec.

| #   | Pieza                             | Qué hace                                                                        |
| --- | --------------------------------- | ------------------------------------------------------------------------------- |
| 0   | SEPA                              | Se trocea en varios PRs (abajo)                                                 |
| ·   | Pantalla de altas en proceso      | Va justo después del PR-0. **Sin especificar** (agujero 2)                      |
| 1   | Documentos del centro versionados | Base: tabla de versiones con hash, firmas con `RESTRICT`, bucket propio         |
| 2   | Presupuesto y normas para firmar  | El gate exige la firma de la versión vigente de cada documento obligatorio; P-6 |
| 3   | Campos del niño                   | Y configuración de campos por centro                                            |
| 4   | Campos de tutores                 | Con el test de la purga contra el catálogo de columnas                          |
| 5   | SIP                               | Número en `ninos`, imagen en su bucket                                          |
| 6   | Servicios en el alta              | La petición de media pensión                                                    |
| 7   | Gastos de gestión                 | Paso del alta y confirmación de la directora al validar                         |
| 8   | Firma de la ficha                 | Resumen de los datos, hash y firma                                              |

Los documentos obligatorios (DNI de los tutores, SEPA, libro de familia) entran dentro de la serie.

### Troceo del PR-0

Orden: 0·doc y 0a → 0b → 0c → reabrir remesas → 0d.

| PR              | Alcance                                                                                                                                                                                                                                                                                 | Migración                                      |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 0·doc           | Esta spec                                                                                                                                                                                                                                                                               | No                                             |
| 0a              | «Omitir» de verdad: el gate de `finalizarAlta` deja de exigir `sepa`, se corrige el texto de la pantalla y se añade el primer test de `finalizarAlta`, con control negativo                                                                                                             | No (`marcar_matricula_lista` no exige mandato) |
| 0b              | El fichero que acepta el banco: `MndtId` y `EndToEndId` ≤ 35, concepto `centro · niño · mes` sin tildes, el generador rechaza los largos, fixtures con la forma real                                                                                                                    | No                                             |
| 0c              | Mandato v2: CID en el PDF y en el texto canónico v2, columna con la versión del canónico (los existentes en v1), NIF y dirección del titular, los tres caminos que crean mandatos (alta, `/family/domiciliacion`, presencial de Dirección) y el aviso en los datos bancarios del centro | Sí, pequeña                                    |
| Reabrir remesas | Sin especificar (ver «Pendiente»)                                                                                                                                                                                                                                                       | Por ver                                        |
| 0d              | FRST en el primer cobro de cada mandato, RCUR en los siguientes, sin FRST repetido                                                                                                                                                                                                      | Sí                                             |

## Estado

- [x] 0·doc — esta spec.
- [ ] 0a · [ ] 0b · [ ] 0c · [ ] reabrir remesas · [ ] 0d
- [ ] Pantalla de altas en proceso · [ ] 1 · [ ] 2 · [ ] 3 · [ ] 4 · [ ] 5 · [ ] 6 · [ ] 7 · [ ] 8

## Referencias

- ADR-0049 (F11-G, documentos del alta), ADR-0050 (cuotas, recibos y remesas; acreedor en
  `centros`), ADR-0063 (plan de recibos; FRST fuera, línea 121), ADR-0064 (plazos de conservación).
- `docs/follow-ups.md` — «Secuencia SEPA FRST / primera-vez (diferida en B-5)».
- Código: `src/features/alta/actions/finalizar-alta.ts`, `src/features/alta/components/PasoSepa.tsx`,
  `src/features/alta/lib/mandato-sepa.ts`, `src/features/alta/lib/mandato-pdf.ts`,
  `src/features/remesas/lib/generar-pain008.ts`, `src/features/remesas/lib/preparar-remesa.ts`.
