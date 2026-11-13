---
feature: altas-serie
wave: 1
status: approved
priority: high
last_updated: 2026-11-13
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
   en SEPA). La pantalla de altas en proceso la decidió el 2026-11-04 (abajo, «La pantalla de
   altas en proceso»).
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

**Decisiones del 2026-11-04 y del 2026-11-05 (la fase 3, entera):**

- **Se firma una vez por niño.** La familia García, con Lucía y Pablo, firma el presupuesto dos veces,
  una por cada hijo. Si Pablo entra un año después con la misma versión vigente, firma la suya igualmente.
- **La lista de documentos la define cada centro**, con su marca de obligatorio (D3: N documentos).
- **Las firmas van en una tabla nueva** que apunta a la versión con `ON DELETE RESTRICT`. No se
  reutiliza `firmas_autorizacion`: va en `CASCADE` y su hash es de un texto, no de un fichero.
- **J1 · Solo la admin** sube y gestiona los documentos del centro, no la directora. Es el criterio
  que ya rige las plantillas legales (`privado.es_responsable`).
- **J2 · Cada documento dice si es de curso o no.**
  - El **presupuesto es de curso**: cada versión lleva su curso, y la familia firma la de **su
    matrícula**. Lucía, que entra tarde al 2026/27, firma el presupuesto de 2026/27, no el de 2027/28
    que ya está subido.
  - Las **normas no son de curso**: vale la última.
  - En palabras de Jose: **«tienen que firmar uno cada año con los nuevos precios»**. Cada curso trae
    su presupuesto, y se firma otra vez.
- **J3 · Basta con uno de los tutores**, y se guarda quién firmó. La clave única es **(versión,
  niño)**, no por firmante. En la familia García basta con que firme Ana por Lucía; si firma Ana, Luis
  no tiene que firmar.
- **J4 · Una versión corregida a mitad de curso no obliga a volver a firmar.** La firma de septiembre
  sigue valiendo, y la versión nueva la firman solo las altas que entren después. Si las normas pasan
  a la v2 en octubre, Pablo, validado en julio con la v1, no firma otra vez.

> **No confundir «curso nuevo» con «versión corregida».** Se parecen y no son lo mismo:
>
> |                                                                 | ¿Se vuelve a firmar?                   | Ejemplo                                                                                                     |
> | --------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
> | **Curso nuevo** de un documento de curso (J2)                   | **Sí**: cada niño firma el de su curso | El presupuesto de 2027/28: Pablo, que sigue, firma el de 2027/28 aunque ya firmara el de 2026/27            |
> | **Versión corregida** del mismo documento y el mismo curso (J4) | **No**: vale la firma que ya hay       | Una errata corregida en el presupuesto de 2026/27 en noviembre: quien firmó en septiembre no firma otra vez |
>
> Lo que decide es si cambia **el curso**, no si cambia **el fichero**.

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

Decisiones del 2026-10-31 sobre las cinco preguntas de la fase 1:

- ~~**FRST en el primer cobro de cada mandato, RCUR en los siguientes.**~~ **REVERTIDA el
  2026-11-01: el FRST no se construye y se emite RCUR siempre, como ya hace la app.** Por qué cayó: «A Collection with the optional transaction type ‘first’ is processed as a recurrent Collection» (SDD Core Rulebook 2025, EPC016-06 v1.0, AT-M006). Si FRST se procesa como RCUR, marcarlo no cambia nada en el banco, y lo que acepta
  cualquier banco, la misma razón multicentro de abajo, es RCUR siempre. Lo que se decidió, tal
  cual: La razón es **multicentro**,
  no lo que conteste un banco: cada centro trabaja con su banco, no se puede preguntar a todos ni
  dar por hecho que todos acepten RCUR en el primer cobro (lo que permiten las reglas desde 2016).
  Se emite lo que acepta cualquiera. Era la última pieza de la fase 1. El riesgo que trae, que el mismo
  mandato salga dos veces como FRST (en dos remesas, o en una remesa que se vuelve a abrir), se
  traza junto con reabrir remesas (abajo, pendiente).
- **CORE para todos; B2B no se construye.** Hay centros donde la cuota la paga la empresa de un
  padre desde su cuenta de empresa, y CORE admite a una empresa como deudor. Lo único que añade B2B
  es que el deudor no puede pedir la devolución, a cambio de que cada empresa registre el mandato en
  su banco antes del primer cobro; si no lo hace, el cobro se rechaza. Para una guardería eso es más
  rechazos, no menos riesgo.
- ~~**El CID no toca el alta.**~~ **REVOCADA el 2026-11-04** (decidida el 2026-10-31). Ahora: **sin
  CID del centro no se firma ningún mandato.** El paso de domiciliación no aparece y el alta se
  completa en efectivo, como cuando la familia omite. Por qué cayó: se creía que el mandato
  firmado sin CID se completaría después, y no es así. El CID forma parte del mandato que firma la
  familia, así que un mandato sin él no vale para el banco y habría que volver a firmarlo. El
  aviso de la pantalla de datos bancarios se queda y dice además que sin el CID no se pueden
  domiciliar las familias. La base lo cierra en `registrar_mandato_sepa` y
  `sustituir_mandato_sepa` (HINT `centro_sin_cid`, `20261229120000`). Lo que se decidió, tal cual:
  **El CID no toca el alta.** Que el centro no tenga el identificador de acreedor no cambia nada en
  el alta de la familia: el mandato se firma igual. Lo que se añade es un **aviso en la pantalla
  donde el centro configura sus datos bancarios**: sin ellos no se pueden pasar recibos al banco. Se
  dice qué falta y para qué sirve, nada más. (Corrige la propuesta del 2026-10-31, que lo trataba
  como un caso del paso SEPA.)
- **El mandato pide el NIF y la dirección del titular**, como el papel. Hoy solo lleva nombre e
  IBAN. Se teclean en el paso SEPA, porque el titular puede no ser un tutor. Si al trazarlo aparece
  un caso donde no se puedan pedir, se para y se pregunta antes de construirlo.
  - **El caso apareció y se decidió (2026-11-04):** la app acepta IBAN de 15 países, así que un
    titular con cuenta extranjera puede no tener NIF español (un abuelo francés). El campo es
    **«NIF o documento de identidad»** (no «NIF», en los tres idiomas): admite cualquier documento
    del titular, y solo se comprueba el dígito de control cuando tiene forma española (DNI, NIE o
    CIF). Un titular con documento extranjero puede domiciliar. La columna es
    `mandatos_sepa.titular_documento`, sin formato en la base (1 a 40 caracteres); la
    comprobación de la forma española es de la app (#488).

Decisiones del 2026-11-04 sobre el mandato v2, al trazarlo:

- **El hash v2 también en el mandato presencial de Dirección**, sobre lo que teclea la directora y
  sin PDF (el respaldo es el papel). Hasta aquí `gestionar-domiciliacion-familia.ts` registraba el
  mandato con `texto_hash` NULL: un mandato sin hash no tiene prueba de integridad, y que la
  presencial fuera la única sin ella no tiene defensa.
- **El documento y la dirección del titular se tratan como `titular`:** en claro en la tabla,
  fuera de `audit_log`, dentro del export, y se destruyen con el mandato.
- **Nada recalcula hoy el hash de un mandato.** Se calcula al firmar y se guarda. Que los
  mandatos ya firmados «sigan en v1» significa que su hash se puede recalcular con el texto v1;
  la columna de la versión es lo que lo permite. No hay ningún verificador que buscar.
- **El mandato v2 guarda la foto del acreedor con la que se firmó** (`acreedor_cid`,
  `acreedor_nombre`): sin ella, el hash v2 no se podría recalcular si el centro cambia de nombre o
  de CID. La base comprueba al firmar que son los del centro. Es un añadido de la base del mandato v2 (#487) al trazarlo,
  no una decisión del responsable: el v1 tiene el mismo hueco con el nombre del centro, y se queda.
- **CEI Ejemplo es un centro de pruebas** y no tiene CID. Se le pone uno ficticio con formato
  válido, `ES81ZZZB00000000` (dígitos de control mod 97-10 correctos; el NIF B00000000, un CIF
  todo ceros con su dígito de control, es la marca de que es de prueba), por una operación de
  datos (`supabase/operaciones/20261229100000_cid_prueba_cei_ejemplo.sql`), no por una migración.
  **Ese CID no vale para cobrar nada.** Lo pidió Jose: «el CID es obligatorio, pero lo que tenemos
  ahora es un centro falso y no tiene CID, invéntate algo para que funcione».
- **Los dos mandatos vivos de CEI Ejemplo** miden 36 caracteres (el `MndtId` admite 35) y no
  tienen CID: no sirven para el banco. Se quedan como están (v1); esas familias tendrían que
  volver a firmar.

> **La app del mandato v2, construida el 2026-11-04** (#488; sin migración). Los tres caminos firman el v2: el alta
> (`/alta/[ninoId]/mandato-sepa`), la familia desde Recibos (`/family/domiciliacion`) y el presencial
> de Dirección (`gestionarDomiciliacionFamilia`), con el texto canónico v2 (`textoCanonicoMandatoV2`)
> y los datos que la base guarda (`mandato-v2-servidor.ts`). El v1 (`textoCanonicoMandato`) no
> cambia. Decidido al construirlo, sin decisión del responsable que lo cubra (se puede cambiar):
>
> - **Sin CID del centro, los otros dos caminos tampoco se ofrecen.** La decisión decía el alta (el
>   paso no aparece); en `/family/recibos` y en la ficha de la familia, en lugar del botón sale una
>   línea que lo explica. Si llega igual, la ruta y la acción lo rechazan antes de subir nada, y la
>   base después.
> - **La dirección del titular parte de la del tutor 1** en el alta, que es quien suele firmar; el
>   documento se teclea siempre, porque la app no guarda el número del DNI en ningún otro sitio.
> - **Un acreedor que cambia mientras se firma** (`cid_distinto`, `acreedor_distinto`) se dice: «los
>   datos bancarios del centro han cambiado mientras firmabas».
> - **El número de pasos se calcula una vez, al empezar** (corregido el 2026-11-04 por el
>   responsable: el contador no salta). En un centro sin CID el alta tiene 7 pasos desde el
>   principio, también en la invitación, antes de entrar: la página lee con el cliente de servicio
>   si el centro tiene CID y le pasa al wizard solo ese sí o no. El wizard congela la lista de pasos
>   al montarse. Es el único contador de pasos de la app (`AltaTutorWizard.tsx`).

> **Sin v1 nuevos, el 2026-11-04** (#489; decisión del responsable, después del despliegue de #488): la base deja
> de aceptar mandatos v1 nuevos (`20261230120000`). Si la app ya no los crea, nadie tiene por qué
> crearlos por otra vía. Los 3 que había se quedan como están, firmados y con su hash recalculable
> con el texto v1: se revocan al sustituirlos por un v2 y se pueden volver a firmar en su sitio como
> v2; como v1, no. Registrar y sustituir sin los datos del v2 dan `v1_cerrado`, y por la tabla,
> también como `postgres` mientras el trigger esté encendido ([la llave de `postgres`](../architecture/rls-policies.md#la-llave-de-postgres)), el trigger `mandatos_sepa_v1_cerrado` da `v1_solo_existentes`. Detalle
> en `rls-policies.md`.

- **Concepto del adeudo: centro, niño y mes, sin tildes.** Ejemplo: `ANAIA · Lucia Garcia Lopez ·
Octubre 2026`. Sin tildes porque el juego de caracteres de SEPA no las garantiza; máximo 140
  caracteres. Va en el fichero del banco (#461).
  - **Corrección del 2026-10-31 (al construir el fichero del banco, #461):** esta spec decía «cada recibo es de un solo
    niño», y es falso. El recibo es **de la familia** (`recibos.nino_id` es NULL en los 4 de
    producción) y el niño sale de sus líneas; uno de los 4 lleva **dos hermanos**. #461 pone los
    dos nombres (`ANAIA · Ana Garcia y Pablo Garcia · Octubre 2026`, en orden alfabético) y, sin
    ninguna línea con niño, solo centro y mes. **Confirmado (2026-10-31):** los nombres de todos los
    niños del recibo, para que al ver el extracto se sepa de quién es el cobro.
  - **Caber en 140, decidido y no por recorte (2026-10-31).** Cuatro hermanos con nombre y
    apellidos, o un centro como «Centro de Educación Infantil Els Xiquets de Benimaclet» (54
    caracteres), no caben: el caso medido de cuatro hermanos con apellidos compuestos y ese centro
    mide 247. Orden de importancia: el **niño** dice de quién es el cobro; el **mes** no se toca
    nunca; el **centro** es lo primero que cede, porque el extracto ya enseña al acreedor por su
    nombre (`Cdtr/Nm`). Se prueba cada forma en este orden y se queda la primera que cabe:
    - nombre y apellidos de todos los niños;
    - si todos comparten apellidos, los nombres y los apellidos una vez
      (`Ana, Pablo y Lucia Garcia Lopez`), que es el caso normal de unos hermanos;
    - solo los nombres;
    - cada una de las tres, primero con el centro entero y, si no cabe, con el centro acortado
      **por palabras** a 30 caracteres (`Centro de Educacion Infantil`);
    - si ninguna cabe: el centro acortado, los nombres que quepan y «y N más».

    Nunca se corta a mitad de una palabra (salvo una sola palabra más larga que todo el hueco). Está
    en `concepto-adeudo.ts`, con un test por escalón y otro que comprueba en todos los casos que
    cabe en 140 y que ninguna palabra sale cortada.

  - **El punto medio `·` no está en el juego de caracteres de SEPA** (letras sin tildes, cifras,
    espacio y `/ - ? : ( ) . , ' +`). El concepto se compone con `·`, como lo decidió el
    responsable, y al escribir el fichero pasa a guion: el extracto dice
    `ANAIA - Lucia Garcia Lopez - Octubre 2026`. Cualquier otro carácter de fuera del juego, a
    espacio. **Confirmado (2026-10-31).** **Regla escrita para que nadie los iguale:** el concepto
    se compone con `·` (es el formato decidido, y el que use una pantalla si algún día lo enseña) y
    **solo el fichero** lo escribe con guion (`textoSepa` en `generar-pain008.ts`). Son dos sitios
    con dos reglas; lo dicen los comentarios de los dos ficheros y un test.

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

> D4 del diagnóstico (las 3 aceptaciones de normas por casilla en CEI Ejemplo) se contestó el
> 2026-11-05: «Los acuses de normas por casilla no valen como firma» (Fase 4, «Decisiones
> (2026-11-05)»). Lo aplica el 4b-2 (`20270109120000`): el cierre ya no los acepta y las filas se
> quedan como histórico.

## Pendiente de decisión del responsable

P-1 a P-5 se contestaron el 2026-10-31 y están arriba, en SEPA. Quedan:

- **Reabrir remesas:** el alcance está decidido (abajo, «Reabrir una remesa»). Quedan R-1 a R-4,
  las preguntas de su traza.
- **P-6** se contestó el 2026-11-05: ver «Fase 4: presupuesto y normas, para firmar».

## Reabrir una remesa

Petición del responsable, textual: «una remesa que tiene algún problema, aunque esté validada:
error en la creación del archivo o cualquier otro error, o porque no la pasó finalmente. Se debe
poder abrir, editar y volver a crear.»

### Decidido (2026-10-31)

- **Se puede reabrir cualquier remesa, esté en el estado que esté**, también la que consta como
  enviada al banco. Razón del responsable, textual: «genera o subida al banco, qué coño le importa a
  la app porque no lo va a saber». La app no sabe ni puede saber si el fichero llegó al banco: solo
  sabe lo que alguien marcó. Una puerta cerrada ahí fingiría un conocimiento que no hay.
- **Pero la app avisa, y el aviso da miedo cuando toca.** Si la remesa consta como enviada, antes
  de reabrirla: si el banco ya la tiene, volver a enviarla **cobrará dos veces** a esas familias,
  **con el número de familias y el importe delante**. No un «¿seguro?».
- Queda en `audit_log` quién la reabrió, cuándo, con cuántos recibos y qué importe.

### Lo que hay hoy (medido el 2026-10-31, código de `main` y producción en solo lectura)

- **Estados.** La remesa: `borrador` → `enviada` (`marcarRemesaEnviada`, con `fecha_envio_banco`; desde R-4, por `marcar_remesa_enviada`).
  Sus recibos: `pendiente_procesar` → `enviado_banco` al marcarla enviada. Después, un recibo puede
  pasar a `devuelto` y, resuelta la devolución, a `cobrado_manual` (efectivo o transferencia), o
  quedarse `devuelto` con un re-giro (otro recibo) o con la deuda llevada al siguiente.
- **El XML no se guarda** (decisión G1 de ADR-0050, sustituida el 2026-11-01 por la P-1): se genera cada vez que se descarga. No hay
  fichero que borrar ni que marcar caducado. Lo único que queda es `fichero_generado_at`, la primera
  vez que salió.
- **Los triggers de `20261120120000` cierran la remesa:** con sesión, una enviada no vuelve a
  borrador; la marca del fichero no se quita **para nadie**, tampoco con `service_role` (salvo `postgres`: [la llave de `postgres`](../architecture/rls-policies.md#la-llave-de-postgres)); de una
  remesa enviada o con fichero no entra ni sale ningún recibo. El congelado de los recibos sí deja
  `enviado_banco → pendiente_procesar` (solo prohíbe volver a `borrador`).
- **Permisos:** crear, descargar y marcar enviada es `es_admin` (la admin y las directoras).
  `dar_deuda_por_perdida` es `privado.es_titular`: la admin del centro, sin la directora ni el
  superusuario.
- **El `MsgId` cambiaba en cada descarga** (llevaba la hora: `NIDO-{remesa}-{AAAAMMDDhhmmss}`). Dos
  descargas de la misma remesa eran dos ficheros distintos para el banco, y su control de ficheros
  repetidos (que mira el `MsgId`) no paraba el segundo. Pasaba sin reabrir nada: quien descargaba
  dos veces y subía los dos cobraba dos veces. El `EndToEndId` de cada adeudo es estable (el id del
  recibo; desde #461, sin guiones), pero no todos los bancos rechazan por él. **Arreglado aparte,
  antes de reabrir (R-3):** el `MsgId` sale de la marca del fichero (punto 6).

### Propuesta

1. **Los recibos.** Al reabrir, los que están en `enviado_banco` vuelven a `pendiente_procesar`
   (sin `fecha_envio_banco`) y siguen en la remesa. Los `devuelto` y `cobrado_manual` no se tocan:
   su historia es real, y además **prueban que el banco recibió ese fichero**, así que el aviso los
   nombra. El fichero nuevo no los lleva (`get_mandatos_remesa` solo coge pendientes y enviados).
2. **La remesa** vuelve a `borrador`, sin `fecha_envio_banco` y sin la marca del fichero, para que
   se puedan quitar y añadir recibos. Para eso la migración deja quitar la marca **solo** a la
   función de reabrir, con un marcador local como el de `resolver_devolucion`
   (`app.reabrir_remesa`). Cualquier otro camino sigue sin poder.
3. **Quién:** la admin del centro (`privado.es_titular`), como dar una deuda por perdida. No choca
   con lo que hay: es una función nueva con su propia puerta, y la directora sigue creando,
   descargando y marcando enviadas. Lo que no puede es reabrir la que marcó ella: se lo pide a la
   admin.
4. **El aviso**, con lo que la app sabe de verdad:
   - **Enviada y con fichero generado:** «Esta remesa consta como enviada al banco el {fecha}. Si el
     banco ya la tiene, volver a enviarla cobrará dos veces a {n} familias: {importe} €». Si tiene
     devoluciones: «{k} recibos ya se devolvieron: el banco recibió este fichero».
   - ~~**Enviada sin fichero generado** (el fichero no salió nunca de NIDO): se dice así, y que
     reabrirla no puede cobrar dos veces lo que ningún banco tiene.~~ **Sustituido el 2026-11-03**
     (decisión del responsable): sin la marca, NIDO no sabe que el fichero no salió, solo que no
     consta su descarga, y pudo llegar al banco por otro camino. El aviso dice el síntoma («NIDO no
     tiene constancia de que su fichero se descargara») y el mismo riesgo de cobrar dos veces. Lo
     que decide el caso es la marca, no el fichero guardado: una remesa descargada antes de R-1
     tiene la marca y no el fichero.
   - **Borrador con fichero:** el fichero se descargó y pudo subirse; el mismo aviso, sin la fecha
     de envío.
   - La función recibe el número de recibos y el importe que vio la persona y falla si han cambiado
     entre medias, como `dar_deuda_por_perdida` con `p_centimos`.
5. **`audit_log`:** una fila directa `tabla = 'remesa_reabierta'`, `registro_id` = la remesa,
   `usuario_id` = quien la reabre, `valores_antes` = estado, fecha de envío y marca del fichero, y
   `valores_despues` = `{n_recibos, n_familias, total_centimos, n_devueltos}`. Sin nombres ni
   IBAN: nada que redactar en la purga. Entra en la lista de eventos directos
   (`audit-log-eventos-directos.test.ts`). Los cambios de la remesa y de los recibos los audita
   además su trigger.
6. **El `MsgId`, estable por versión del fichero:** el mismo en todas las descargas de una versión
   y uno nuevo al reabrir. Así un banco que ya tenga el fichero rechaza la segunda subida de la
   misma versión. Trazado:
   - **Antes de la R-3** la ruta del XML lo calculaba con la hora de la descarga
     (`NIDO-{remesa 8}-{AAAAMMDDhhmmss de now()}`), y `PmtInfId` es el mismo valor. Cada descarga,
     también la de una remesa ya enviada (G1: «regenerable»), daba un fichero que el banco no
     reconocía como repetido.
   - **La versión ya existe en la BD:** `fichero_generado_at`, que pone la primera descarga y no
     se quita. El `MsgId` sale de ella (`NIDO-{remesa 8}-{AAAAMMDDhhmmss de fichero_generado_at}`,
     28 caracteres) y no de `now()`: todas las descargas de esa versión dan el mismo `MsgId`.
     `CreDtTm` sigue siendo la hora de la descarga (no lo mira el control de repetidos).
   - **Al reabrir**, la función quita la marca (punto 2); la siguiente descarga pone una nueva y
     con ella sale un `MsgId` nuevo. Es la única forma de tener otro.
   - **La primera descarga** genera, marca y vuelve a generar (`20261120120000`): el `MsgId` se
     calcula con la marca ya puesta, y el primer fichero (el que comprueba que sale) no se sirve.
   - **Una remesa enviada antes de esta pieza** puede no tener marca (la de CEI Ejemplo): sin
     marca no hay versión, y la descarga la pone igual que con una en borrador. Su primera descarga
     fija el `MsgId` de las siguientes; un fichero que ya se bajó antes de la R-3 llevaba otro, que
     no se puede saber (G1: no se guardaba). La de CEI Ejemplo no tiene ese problema: su fichero no
     salió nunca.
   - **Tras poner la marca se vuelve a leer:** si otra descarga la puso a la vez, el UPDATE (con
     `fichero_generado_at IS NULL`) no toca nada y vale la de la otra. Si no se puede leer, la
     descarga da 500: un `MsgId` con la hora sería el doble cobro que esto evita.
   - **Hecho en un PR propio, antes de reabrir (R-3):** `message-id.ts` y la ruta del XML.
7. **Marcar enviada exige el fichero generado.** Hoy se puede marcar enviada una remesa cuyo fichero
   no salió nunca: así nació la de CEI Ejemplo (abajo).

### Cruce con el FRST: ya no hay cruce

**El FRST se canceló el 2026-11-01** (ver «Decisiones del 2026-10-31», la de FRST, revertida). Reabrir
no toca la secuencia: el fichero nuevo va en RCUR, como el primero.

Aquí se escribió que, al reabrir, los mandatos volverían a FRST y que el banco rechazaría el segundo
FRST del mismo mandato, como una red contra el doble cobro. **Esa red no existe:** según el
Rulebook, un FRST se procesa como un RCUR, así que nadie rechaza el segundo. Lo que protege del
doble cobro es:

- el `MsgId` estable por versión (punto 6), con el que el banco ve repetido un fichero que ya tiene;
- el aviso de reabrir, con el número de familias y el importe (punto 4).

### La remesa de CEI Ejemplo (agujero 4)

Medido en producción el 2026-10-31: remesa `146d28b6`, octubre de 2026, **creada y marcada enviada
11 segundos después, sin descargar nunca el fichero** (`fichero_generado_at` NULL), con un recibo de
12,00 € en `enviado_banco` de una familia con mandato activo. El centro no tiene CID, BIC ni IBAN de
acreedor. Con la propuesta **se recupera**: se reabre con el aviso de «el fichero no salió nunca de
NIDO», el recibo vuelve a pendiente y la remesa a borrador. El fichero seguirá sin salir hasta que
el centro ponga sus datos bancarios (el aviso del mandato v2), y lo dirá. El punto 7 impide que se repita.

### Preguntas al responsable

Contestadas el 2026-10-31: ver «Respuestas del responsable», abajo.

- **R-1 · ¿Se guarda el fichero que se envió?** Hoy no hay nada que guardar: es la prueba de lo que
  se envió y no existe. El fichero lleva los IBAN en claro, así que guardarlo entero es otra decisión
  de protección de datos (un bucket cifrado o privado, con su plazo). Propuesta: guardar de cada
  versión el `MsgId`, la huella sha256 del fichero, el número de adeudos, el importe y la lista de
  `EndToEndId` con su importe y mandato, sin IBAN. Basta para probar qué se pidió al banco y cuándo.
- **R-2 · ¿Los mandatos vuelven a FRST al reabrir** (arriba)? Propuesta: sí.
- **R-3 · El `MsgId` estable (punto 6)** arregla un doble cobro que ya puede pasar hoy. ¿Va en este
  PR o antes, sola? **Decidido: en un PR propio, ya, antes que el resto.** Hecho.
- **R-4 · ¿Marcar enviada exige el fichero** (punto 7)?

### Respuestas del responsable (2026-10-31) y lo que cambian

- **R-1 · Se guardan las dos cosas:** el registro de cada versión enviada (`MsgId`, sha256, número
  de adeudos, importe total y, por adeudo, `EndToEndId`, importe y mandato, sin IBAN) **y el fichero
  entero, en privado, como los documentos de los mandatos.** El plazo es el fiscal, con la constante
  que ya existe (`ANIOS_FISCAL`, `retencion/lib/fiscal.ts`), nunca un número escrito a mano. Entra
  en el barrido de retención y en la pasada que lo registra: si se guardan IBAN en un sitio nuevo,
  ese sitio se borra solo como todo lo demás. Se apunta al RAT para cuando vuelva la lista del
  abogado. La razón va al ADR.
- **R-2 · Revisada el 2026-11-01: al reabrir, los mandatos NO vuelven a FRST.** La respuesta
  del 2026-10-31 («sí, como defensa: el rechazo del segundo FRST protege del doble cobro») se apoyaba
  en una red imaginaria: el esquema procesa FRST como RCUR y no rechaza un segundo. El FRST se canceló
  con ella. La protección real contra el doble cobro es el `MsgId` estable y el aviso con las familias
  y el importe.
- **R-3 · El `MsgId` estable, en un PR propio y antes que el resto.** Hecho (punto 6).
- **R-4 · Sí: marcar enviada exige el fichero generado**, y el mensaje dice qué falta, no solo que
  no se puede.

### Diseño (propuesta, pendiente del visto bueno)

**El fichero de cada versión** (R-1). Una versión empieza con la marca (`fichero_generado_at`) y
acaba al reabrir.

> **Construido el 2026-11-02** (`20261220120000`, primer PR de reabrir remesas): el fichero, el
> registro, el plazo y el barrido. Dos cosas que el diseño no decía, decididas al construirlo:
> la marca de una versión nueva va al segundo (como el `MsgId`, para que dos marcas del mismo
> segundo no den el mismo `MsgId`), y los objetos del bucket sin registro (una subida cuyo registro
> no entró) se borran al día siguiente en la misma pasada. Marcar enviada (R-4) y reabrir van en
> sus PR.

- **Se guarda la primera vez que sale, y desde ahí la descarga sirve el guardado** en vez de
  generarlo otra vez. Es el único modo de que lo guardado sea, byte a byte, lo que se pudo subir al
  banco. Generado de nuevo, cambia aunque los recibos no cambien:
  - `CreDtTm` y la fecha de cobro (`ReqdColltnDt`) llevan hoy la hora y el día de cada descarga;
  - el mandato de una familia puede cambiar entre dos descargas (un IBAN nuevo).

  **La razón de peso es el mandato, no la fecha:** `get_mandatos_remesa` toma el mandato activo
  más reciente de la familia **en cada descarga** (cuerpo vivo leído en producción el 2026-11-01).
  Si la familia firma otro mandato entre dos descargas (otro IBAN), la segunda lleva el IBAN nuevo
  y el `MndtId` nuevo para el mismo recibo; y si se lo revocan sin otro, la remesa ya enviada deja
  de generarse (`sin_mandato`). Hoy, dos descargas de la misma remesa pueden llevar IBAN distintos
  para la misma familia.

  Cambia G1 («regenerable»): dentro de una versión el fichero ya no se regenera. Al reabrir sale una
  versión nueva, con su fichero.

- **El fichero, en el bucket privado `remesas-ficheros`**, en `{centro}/{remesa}/{MsgId}.xml`. Sin
  políticas de Storage para las sesiones: lo lee y lo escribe el servidor con `service_role`, después
  de autorizar con la RLS de la remesa (`es_admin`), como el export con los documentos.
- **El registro**, en tablas nuevas sin políticas ni privilegios para las sesiones, sin auditar (lo
  fiscal se borra sin copia) y leído por funciones de Dirección:
  - `remesa_ficheros`: centro, remesa, `msg_id`, `generado_at` (la marca), sha256, número de
    adeudos, importe total, ruta, `enviada_at` (la pone marcar enviada) y `reabierta_at` (la pone
    reabrir);
  - `remesa_fichero_adeudos`: el fichero, el recibo, `end_to_end_id`, importe y `mandato_id` con su
    `MndtId`. Sin IBAN ni nombres.

  Se escribe en la misma transacción que la marca. Si no se puede guardar, no hay marca ni fichero
  (500): sin registro no se sirve nada.

- **Cada versión se conserva, también la reabierta.** Si el banco la tuvo, es la prueba.

**Plazo y barrido** (R-1).

- **Cada fichero vence a los `ANIOS_FISCAL` años de su `generado_at`.** Se borran el fichero de
  Storage, sus adeudos y su fila. Es el patrón de los documentos de los mandatos: la app borra el
  fichero antes y, si falla, no toca la base de datos.
- **Espera a la retención:** con una familia del fichero retenida (`privado.retenido`), no se
  destruye.
- **Lo fiscal de la familia espera a sus ficheros.** `privado.familia_fiscal_vencida` añade «ningún
  fichero de remesa vivo con un recibo suyo». Casi nunca frena: un recibo entra en un fichero
  después de quedar pendiente y se paga después, así que el plazo de la familia acaba igual o más
  tarde que el del fichero. La excepción es la familia que no pagó nunca (un devuelto dado por
  perdido), cuyo plazo cuenta desde el final del curso de la baja y puede acabar antes. Sin esta
  espera se borraría la familia y seguiría su IBAN en un fichero; con ella se conserva de más, como
  el resto de lo fiscal.
- **El barrido nuevo** (`ficheros_remesa_vencidos` y `destruir_fichero_remesa`, solo
  `service_role`) entra en el cron y en `retencion_pasadas` con su clave. El CHECK de los recuentos
  pasa de doce claves a trece, y su test con él.
- **Docs:** fila en la tabla de `retencion-plazos.md`, el ADR con la razón, y el apunte en
  `follow-ups.md`: el punto del pain.008 que decía «no se almacena» pasa a «se almacena, en privado,
  con plazo fiscal», pendiente del RAT y de la lista del abogado.

**Marcar enviada** (R-4).

> **Construido el 2026-11-02** (`20261221120000`, segundo PR de reabrir remesas). Decidido al
> construirlo, con el visto bueno del responsable del 2026-11-02:
>
> - la función es `SECURITY DEFINER` con `es_admin` explícito, no de invocador: tiene que poner
>   `enviada_at` y `remesa_ficheros` no tiene privilegios para las sesiones (R-1);
> - **la marca solo la pone el registro del fichero**, para todos salvo `postgres` (trigger y marcador
>   `app.registrar_fichero`): Dirección podía ponerla con un UPDATE directo, sin fichero detrás.
>   Cerrada esa puerta, una caída entre la subida y el registro deja la remesa sin marca y la
>   siguiente descarga guarda (otra marca, otra ruta), sin el 409 hasta el día siguiente;
> - **la remesa solo pasa a enviada por esta función** (trigger y marcador
>   `app.marcar_remesa_enviada`): con un UPDATE directo se saltaba las exigencias;
> - **marcar enviada exige además que los recibos cobrables sean los del fichero**, con el mismo
>   importe (HINT `fichero_no_coincide`, que dice que hay que reabrirla), y **pasan a
>   `enviado_banco` solo los del fichero**: marcar enviados los que el banco no recibió es decirle
>   al centro que ha cobrado algo que nadie pidió cobrar. Hasta que exista reabrir (el PR
>   siguiente), una remesa así se queda en borrador.

- **Una función** (`marcar_remesa_enviada`, `SECURITY DEFINER`, `es_admin`; la propuesta decía de
  invocador) en vez de dos UPDATE desde la
  app. Hoy la app pasa la remesa a enviada y después, en otra llamada, los recibos a `enviado_banco`:
  si la segunda falla, la remesa queda enviada con los recibos pendientes.
- **Exige la marca y su fichero guardado.** Sin ellos, P0001 con HINT `sin_fichero`, y el mensaje
  dice qué falta: «Falta descargar el fichero: descárgalo, súbelo al banco y vuelve a marcarla
  enviada».
- **Lo que el centro no tiene** (CID, BIC, IBAN de acreedor) ya lo dice la descarga, que no genera
  el fichero (422). El aviso de los datos bancarios es del mandato v2.
- **Pone `enviada_at`** en el fichero de la versión.

**Las puertas del recibo** (censo del 2026-11-02, decisiones A a E del responsable de ese día). La
RLS de `recibos` deja a Dirección INSERT y UPDATE de cualquier columna, y el congelado exime entero
a `service_role`: los estados de dinero del recibo se podían poner y quitar por fuera de sus
funciones. La regla: **un hecho de dinero no se deshace por fuera**, y lo pone solo su función.

- **A · `enviado_banco`, solo por `marcar_remesa_enviada`, también para `service_role`.** Los tests
  preparan sus recibos enviados con el helper de psql, como la función.
- **B · ninguna vuelta atrás por fuera**, en el mismo PR y el mismo trigger que A: de
  `cobrado_manual` no se sale, y de `enviado_banco` solo a `devuelto`. Reabrir trae su vuelta
  atrás con su marcador (`app.reabrir_recibo`, `20261227120000`).
- **C · `devuelto` y `cobrado_manual` por función**, PR propio después del de A y B.
  `marcarReciboDevuelto` y `marcarCobradoManual` son UPDATE directos desde la app, sin función SQL
  detrás: crear esas dos funciones es el trabajo del PR, y el trigger es la consecuencia. Cierra
  también entrar en `devuelto` sin haber ido al banco y el INSERT directo en `cobrado_manual`.
- **D · confirmar y desconfirmar por sus funciones**, en el PR de C: saltarse `confirmar_recibo`
  deja un recibo en pendiente sin su ancla de `cierre_mensual`, y la vuelta sin quitarla. Y el
  INSERT de un recibo regular directamente en `pendiente_procesar`.
- **E · `service_role` conserva la exención del congelado. Es una decisión, no un hueco.**
  - **Qué permite esa llave:** con `service_role`, `congelar_si_mes_cerrado` no actúa, así que se
    puede cambiar el total, el método, la familia, el mes o el concepto de un recibo confirmado,
    enviado o cobrado, y borrar un recibo regular que no está en borrador. Desde A y B no puede
    poner ni quitar los estados de dinero (`enviado_banco`, `cobrado_manual`).
  - **Por qué se deja:** es la llave del servidor, que nunca va al cliente. La usan la limpieza de
    los tests, el borrado de un centro en cascada y las destrucciones por plazo
    (`destruir_fiscal_familia` borra recibos de meses cerrados). Cerrarla obligaría a cada una de
    ellas a llevar su propio marcador.
  - **Hoy no hay ningún guion que la use para corregir un recibo:** ni en `scripts/`, ni en
    `supabase/operaciones/`, ni en un runbook.
  - **La condición:** el día que haga falta corregir un recibo con esa llave, se hace con una
    función con nombre y su registro en `audit_log`, nunca con un UPDATE suelto.

> **A y B construidos el 2026-11-03** (`20261222120000`, tercer PR de reabrir remesas). Trigger
> `recibos_dinero_solo_por_funcion` (BEFORE INSERT OR UPDATE OF estado, de invocador, para todos
> salvo `postgres`: [la llave de `postgres`](../architecture/rls-policies.md#la-llave-de-postgres)).
> `marcar_remesa_enviada` pasa ahora los recibos del fichero uno a uno, cada uno con el marcador
> `app.marcar_recibo_enviado` = su id (el patrón de la casa: el marcador es el id de la fila). Con
> un marcador por remesa, los recibos enviados fuera de toda remesa que preparan los tests no se
> podían preparar como la función. El ensayo en producción comprobó primero que las 18 vías del
> censo estaban abiertas, y lo estaban todas.

> **C y D construidos el 2026-11-03** (`20261223120000`, cuarto PR de reabrir remesas). Decidido ese
> día por el responsable: **C y D valen para todos, también service_role** (no `postgres`: [la llave de `postgres`](../architecture/rls-policies.md#la-llave-de-postgres)). Para D, la razón no es
> la simetría: una excepción que se deja «porque cuesta» es la que nadie recuerda dentro de un año,
> y E ya es la excepción, escrita y con su condición.
>
> - **Los dos hechos de dinero tienen dueño en la base:** `marcar_recibo_devuelto` y
>   `marcar_cobrado_manual`, de invocador, con el recibo bloqueado, `es_admin` y los mismos
>   rechazos que hacía la app, cada uno con su HINT. La app hace una sola llamada a cada una. Un
>   test compara los HINT de cada función con el mapa que los traduce, en los dos sentidos: un
>   rechazo que se quedara sin traducir sería un rechazo perdido por el camino.
> - **El trigger es la consecuencia:** en devuelto solo se entra con la función de la devolución; en
>   cobrado, con la del cobro a mano, el cheque o la devolución resuelta; de borrador a pendiente
>   solo `confirmar_recibo`, y la vuelta solo `desconfirmar_recibo`; y un recibo nace en borrador,
>   salvo el esporádico de `crear_recibo_esporadico` y el re-giro de `resolver_devolucion`.
> - **Lo que descuadraba un cierre ya hecho.** La vuelta de pendiente a borrador por fuera pasaba
>   también con el mes cerrado, y dejaba la marca de cierre (`cierre_mensual`) puesta: el mes
>   quedaba cerrado con un borrador dentro. No era solo saltarse una función. El ensayo lo comprobó
>   aparte: sin la migración, el mes 8 seguía cerrado y con un borrador regular dentro; con ella,
>   la vuelta no pasa y `desconfirmar_recibo` quita el cierre.
> - El ensayo comprobó primero que las 20 vías del censo de C y D estaban abiertas, y lo estaban
>   todas.
> - **Las defensas de antes siguen vivas, detrás.** Siete grupos de tests medían una defensa antigua
>   (el cobro a mano de un SEPA, el cheque, la devolución resuelta, el desborde, la remesa) por el
>   UPDATE directo, que ahora para antes el trigger nuevo. Cada uno lleva dos casos: por fuera, el
>   HINT del trigger nuevo; y el que separa las dos defensas, con el marcador de la función puesto,
>   donde la de detrás tiene que seguir respondiendo con lo suyo (con su control positivo: el mismo
>   marcador en un caso bueno pasa). Es lo que caza una función que un día se equivoque.
> - **Un rechazo se afirma por su HINT, o por su mensaje si no tiene, no por el P0001 a secas.** En
>   el mismo camino ya hay dos defensas, y un P0001 no dice cuál respondió. El que parecía contestar
>   por otra razón no lo hacía: a la vuelta a borrador de un recibo en remesa, con sesión, responde
>   la salvaguarda del congelado, que corre antes que el trigger nuevo (los triggers van por orden
>   alfabético); con service_role, el trigger nuevo, y con el marcador puesto, la de la remesa.
>   Medido en el ensayo, y afirmado así en el test.
> - **El DEFAULT de `recibos.estado` es `pendiente_procesar`.** Un INSERT sin estado nace en
>   pendiente, y desde la D lo rechaza `recibo_nace_en_borrador`. Las funciones que crean recibos
>   dicen todas su estado (medido en producción), y la app también. Un test del tutor que insertaba
>   sin estado y solo miraba que hubiera error seguía en verde por esa razón: ahora inserta en
>   borrador y afirma el 42501 de la RLS.
> - **Desde `20261224120000` el DEFAULT es `borrador`** (decisión del responsable del 2026-11-03: el
>   estado por defecto tiene que ser el inocuo). Un INSERT sin estado nace en borrador. El mismo día
>   se censaron los demás DEFAULT de la base y se le contaron los que afirman un hecho, sin cambiar
>   ninguno.

**Reabrir.** Puntos 1 a 5 de la propuesta, con el `MsgId` y el fichero de arriba. La función
(`reabrir_remesa`, `privado.es_titular`) pone `reabierta_at` en el fichero de la versión y quita la
marca con `app.reabrir_remesa`. La siguiente descarga crea la versión nueva. La vuelta de sus
recibos de `enviado_banco` a pendiente pasa por `recibos_dinero_solo_por_funcion` (B): reabrir la
abre con su propio marcador, como el resto.

> **Reabrir, la base de datos, construida el 2026-11-03** (`20261227120000`, quinto PR de reabrir
> remesas, #484; el botón y el aviso, en el sexto, abajo). Decidido ese día por el responsable:
>
> - **Una remesa enviada no vuelve a borrador por fuera, para nadie salvo `postgres`:** `remesas_proteger` dejaba
>   pasar a service_role antes de mirarlo. Medido abierto en producción antes de cerrarlo.
> - **Un recibo devuelto o cobrado a mano no se desvincula de la remesa reabierta**
>   (`recibo_con_historia`): si se pudiera quitar, se perdería la prueba de que el banco recibió ese
>   fichero, que es justo lo que se guarda el fichero para demostrar. Para las sesiones:
>   service_role conserva la excepción del DELETE, porque la destrucción por plazo de lo fiscal
>   borra los enlaces de la familia en cualquier estado.
> - **El aviso y la comprobación leen la misma consulta** (`resumen_reabrir_remesa` y
>   `reabrir_remesa`, las dos sobre `privado.resumen_reabrir_remesa`): el aviso que dice un importe y
>   la comprobación que mira otro es el fallo clásico de estos botones.
> - **Reabrir un borrador sin fichero dice qué pasa** (`nada_que_reabrir`): no hay nada que
>   reabrir porque nunca se generó el fichero.

> **Reabrir, la app, construida el 2026-11-03** (sexto PR de reabrir remesas). «Reabrir» sale solo
> a la admin del centro (responsable y no superusuario, como `privado.es_titular`) y solo en las
> remesas con algo que reabrir: la enviada y la del fichero descargado. El aviso se lee al abrir el
> diálogo y, hasta tenerlo, no hay botón de confirmar: la admin ve **antes de pulsar** el número de
> familias y el importe, el riesgo de cobrar dos veces en sus tres casos (enviada, enviada sin
> constancia de la descarga, borrador con el fichero descargado) y **por su nombre** a las familias
> de los recibos devueltos o cobrados a mano, que no se tocan. Esos nombres se leen con la sesión y
> tienen que salir tantos como cuenta el resumen; si no, no hay aviso (`aviso_incompleto`).
> Confirmar manda los números que se enseñaron; si cambiaron, no reabre y enseña los de ahora.

> **Borrar una remesa, cerrado el 2026-11-04** (`20261228120000`, séptimo PR de reabrir remesas).
> Medido antes de construir: borrar una remesa no deja huérfano su fichero (el barrido de retención
> lo busca por su fecha, no por su remesa) y la FK impide el DELETE de una con fichero; hoy no hay
> ningún fichero huérfano. Lo que se cerró es que una remesa con historia desaparezca de la app: solo
> se borra (soft delete) un borrador que nunca tuvo fichero, para todos, también service_role (no `postgres`: [la llave de `postgres`](../architecture/rls-policies.md#la-llave-de-postgres)). El
> DELETE no cambia: el rollback de `crearRemesa`, la destrucción fiscal y el borrado de un centro
> siguen pasando, medidos uno a uno.

**Sin FRST.** El FRST está cancelado (R-2, revisada): el fichero de cada versión va en RCUR. No se
construye ninguna marca de «primer cobro» por mandato.

### Respuestas del responsable (2026-11-01)

- **P-1 · Sí.** El fichero se guarda la primera vez que sale y todas las descargas siguientes
  entregan ese mismo, byte a byte. Para cambiar algo, se reabre y sale una versión nueva con su
  fichero. G1 queda escrita como sustituida, con la fecha y el porqué (ADR-0050 y ADR-0052). La
  razón de peso es que hoy dos descargas pueden llevar IBAN distintos para la misma familia
  (arriba).
- **P-3 · Sí.** Lo fiscal de una familia no se destruye mientras exista un fichero guardado donde
  salga. El fichero no se recorta: dejaría de ser lo que se envió al banco. Va al ADR, con el plazo
  provisional como los demás hasta que lo valide el abogado.
- **P-2 · La fecha de cobro, pieza aparte y antes de reabrir** (orden: fecha de cobro → reabrir →
  el mandato v2; el FRST se canceló). Ver «La fecha de cobro», abajo.

### La fecha de cobro (pieza aparte)

Lo dicho por Jose: «la fecha se indica en cada recibo, es decir, si no indicas nada, el banco lo
cobra al día siguiente; si seleccionas una fecha futura se cobra el día que indiques».

Lo que hay (medido el 2026-11-01, `main` y producción en solo lectura):

- **El generador** escribe un solo bloque de pago (`PmtInf`) con una sola `ReqdColltnDt` para todos
  los adeudos, y esa fecha es el día de la descarga (`route.ts`, `collectionDate`). _(Hasta la F2:
  desde entonces, un bloque por fecha, y la fecha por defecto y `CreDtTm` salen de la marca.)_
- **El recibo no tiene fecha de cobro al banco.** Ni `recibos`, ni `remesas`, ni `lineas_recibo`, ni
  `recibos_remesa` tienen una columna así, ni en el código ni en producción. Lo que se llama «fecha
  de cobro» en el código es la del cobro a mano (`cobro_fecha`: efectivo, transferencia, cheque), que
  no admite fechas futuras.
- **En pain.008 la fecha va por bloque**, no por adeudo. Un fichero con fechas distintas lleva un
  bloque por fecha, todos con el mismo `MsgId`, cada uno con su `PmtInfId` y sus totales. La
  secuencia es siempre RCUR (el FRST se canceló), así que no parte bloques.

**Decidido (responsable y Jose, 2026-11-01):**

- **Cada recibo lleva su propia fecha de cobro, opcional.** Palabras de Jose: «cada recibo tiene su
  propia fecha, si no indicas nada es el próximo día, si indicas una fecha es cuando se indica».
- **Sin fecha en el recibo, el fichero pone la del día en que se genera la versión** (el día de la
  marca, no el de cada descarga). Si no cumple plazos, el banco la ajusta: el cuaderno 19-14 dice
  que la entidad «podrá rechazar su proceso o ajustar la fecha de cobro a la primera disponible», y
  la guía de CaixaBank que la ajusta «a la primera que cumpla los plazos mínimos». No es cosa
  nuestra.
- **No hay aviso de «fichero caducado».** Generar el lunes y subir el jueves no rompe nada: el banco
  cobra en cuanto puede. (Se propuso y se retira.)
- **Un bloque de pago por fecha distinta**, todos con el mismo `MsgId` y cada uno con su `PmtInfId`
  (`{MsgId}-{n}`, 31 caracteres como mucho) y sus totales. Con una sola fecha, un bloque, como hoy.
- **La directora no toca los recibos uno a uno:** pone «el 5» a todos los de una remesa de golpe, o
  a los que marque, y también en uno solo si hace falta.
- **Días hábiles:** TARGET2, y si el banco de un centro dice otra cosa, manda el banco. Con lo
  decidido, NIDO no calcula ningún día hábil: solo se usaría si algún día se valida.

**Hecho en la F2 (el generador):**

- Un bloque por fecha, de la más temprana a la más tardía. Con una sola fecha, `PmtInfId` = `MsgId`,
  como antes; con varias, `{MsgId}-{n}`, que entra en la comprobación de Max35.
- Todo lo que no sale de los recibos sale de la marca (`versionRemesa`): el `MsgId`, `CreDtTm` (antes
  era la hora de la descarga) y la fecha de los recibos sin la suya, que es el día de la marca en
  Europe/Madrid. Con la marca puesta, la BD no deja cambiar la fecha de ningún recibo de la remesa
  (F1), así que dos descargas en días distintos sin cambios dan el mismo fichero byte a byte.
- Los adeudos van en un orden fijo (familia y recibo). `get_mandatos_remesa` solo ordena por familia,
  y una familia con dos recibos en la remesa podía salir en otro orden en la descarga siguiente.
- La cabecera cuenta los adeudos que entraron y cada bloque los suyos. Si el reparto no cuadra con
  el total, el fichero no sale.
- Lo que sigue pudiendo cambiar entre descargas es el mandato activo de la familia: eso lo cierra
  guardar el fichero (P-1, con reabrir remesas).

**Hecho en la F3 (la pantalla, Cuotas → Remesas):**

- Cada recibo por marcar dice cuándo se cobra: «El 5 nov 2026» o «En cuanto el banco pueda».
- Debajo de la lista, el campo «Fecha de cobro» con «Poner esta fecha a los N marcados» y «Dejar
  sin fecha». Junto al campo, a la vista y como su descripción, qué pasa sin fecha: «el banco lo
  cobra en cuanto pueda: normalmente, el siguiente día hábil». No es una ayuda escondida.
- Cada remesa dice cuándo se cobran sus recibos. En borrador y sin fichero, «Cambiar fecha de
  cobro» abre sus recibos, todos marcados, para cambiarlos a la vez o uno a uno. Con el fichero
  generado o enviada no hay botón: dice por qué no se deja.
- Cada «no» de la BD llega con su motivo (`fecha_cobro_en_fichero`, `fecha_cobro_recibo_cerrado`,
  `recibo_no_sepa`) y con «no se ha cambiado ninguno».

**El plazo vigente, de la fuente** (SDD Core Rulebook 2025, EPC016-06 versión 1.0, emitido el
28-11-2024, en vigor desde el 5-10-2025; la 1.1 no cambia reglas, y rige hasta el 21-11-2027):

- **D-1 para todos los adeudos**, primeros, recurrentes y únicos, desde la versión 9.0 (noviembre
  de 2016). El 7 y el 4 de los cuadernos de 2013-2014 ya no rigen, y no van al código.
- **No antes de 14 días naturales** de la fecha de cobro, «unless otherwise agreed between the
  Creditor and the Creditor PSP».
- En consulta pública (EPC010-26, marzo de 2026) hay una propuesta de pasar de D-1 a D. No está en
  vigor.
- **No se valida nada.** El banco ajusta. Si algún día se valida, el plazo sale de una constante con
  su fuente escrita al lado.

**Lo que cambia la R-2, de la misma fuente.** El Rulebook dice, en AT-M006: «A Collection with the
optional transaction type ‘first’ is processed as a recurrent Collection». Desde 2016, FRST es
opcional y se procesa como RCUR. **Un segundo FRST no lo rechaza el esquema**, así que la red de la
R-2 («el rechazo del segundo FRST protege del doble cobro») no existe en las reglas del esquema.
Puede existir en un banco concreto, pero eso no lo dice el Rulebook. **Decidido el 2026-11-01:**
la R-2 se revisa (al reabrir no se vuelve a FRST) y el FRST se cancela.

## Fase 2: la pantalla de altas en proceso

Decidida por el responsable el 2026-11-04. Lo que dijo el 2026-10-29, que es el punto de partida:
«la directora deberia ver un listado con todas las altas en proceso»; «un listado con todo donde
puedes filtrar y seleccionar»; «a los 30 dias, pero la directora puede verlo y cancelar cuando
quiera»; «si el email es incorrecto se debera poder cancelar y enviar otra nueva. Si la familia no
quiere entrar se borra»; «Si no ha aceptado la invitacion el boton la cancela. Si ha iniciado el
proceso, se anula el proceso.»

**Lo que ya había, medido el 2026-11-04** (código de `main` `572c263` y producción en solo
lectura): casi todo por debajo, del PR-8 pieza 4 (#446, `20261209120000`): la lista
`altas_sin_terminar` con su estado y sus 30 días, el botón que cancela o borra (con el borrado de
la familia nueva o solo del alta, que decide la base) y «Enviar una invitación nueva». Se veía en
tres sitios sueltos: un aviso en Inicio (solo las de más de 30 días), el filtro de Niños (solo el
nombre y una etiqueta) y la ficha del niño (el estado y los botones, de una en una). Lo que no se
veía en ninguna parte: la invitación al segundo tutor que sale al validar el alta y no se acepta.

**Decisiones:**

- **La lista es todo** («la lista es todo de todo»): las altas sin terminar (invitación sin
  aceptar, invitación caducada o cancelada, la familia ha empezado), las terminadas que falta
  validar (con el enlace para validarlas y sin borrar) y, porque no salía en ninguna parte, el
  segundo tutor que no ha entrado en un alta ya validada, con su invitación sin aceptar o sin
  ninguna. ~~Solo se ve: no hay botón para reenviar ni cancelar su invitación.~~ **Sustituida el
  2026-11-04** por «El segundo tutor: reenviar y cancelar» (abajo).
- **No hay borrado múltiple** («que se borren de una en una»). Los filtros sirven para ver y
  acotar; ninguna acción opera sobre varias a la vez. Cada alta se cancela o se borra en su fila,
  con su confirmación, como en la ficha.
- **Se enseña lo que llevan hecho, no dónde se pararon** (opción A), sacado de lo que ya está
  guardado, sin migración. Cada línea dice «hecho» solo por algo que hizo la familia: la identidad
  del niño y el nombre del tutor 1 los ponen la invitación y aceptarla, así que «Datos del niño» es
  el libro de familia y «Tutor 1» es su DNI. Lo mismo en la ficha, que marcaba «Datos del niño»
  hecho desde el principio. El tutor 2 y el SEPA son opcionales y, sin hacer, salen neutros; sin
  CID del centro no hay línea de SEPA.
- **Página propia** en el menú de Dirección, junto a Admisiones (`/admin/altas`). El aviso de
  Inicio lleva a ella, con el filtro de más de 30 días.

### La invitación del segundo tutor es de la familia

**Esta invitación es de la familia, no de un niño.** La fila de `invitaciones` lleva un `nino_id`,
pero al aceptarla el segundo tutor queda vinculado a **todos** los hijos de la familia
(`ninosAVincular` en `accept-invitation.ts`: el niño de la invitación y sus hermanos, con
`dar_vinculos_de_invitacion`, todos o ninguno), y su ficha es una sola (`familia_tutores`, rol `segundo_tutor`). Que cuelgue
de un niño es un detalle de cómo se guarda; lo que se invita es a una persona a una familia.

**La trampa:** tratarla como si fuera de un niño deja basura en los hermanos. Pasó en #492 (el botón
limpiaba solo el niño de su fila) y lo cerró #493; no fue un descuido de un caso, fue este desajuste
de concepto. La base no lo protege: `cancelar_invitacion_tutor2` trabaja **por niño**, y quien la
llama tiene que recorrer la familia.

**Lo siguiente que la toque**, antes de escribir:

- **Buscar en toda la familia**, nunca solo en el niño por el que se entra: las invitaciones del
  segundo tutor, sus cuentas provisionales y si ya tiene una abierta.
- **No abrir una segunda** si un hermano ya tiene la invitación al mismo email: se reenvía esa.
- **Cancelar o corregir el email es para toda la familia**: lo de los emails viejos se va en cada
  hermano.
- **Leer con la misma idea**: una familia es una fila del segundo tutor, no una por hijo.

**Dónde se cumple hoy:** `invitarTutor2AlValidar` (no invita si un hermano ya tiene una abierta),
`invitarTutor2` y `cancelarInvitacionTutor2Familia` (`src/features/matriculas/lib/invitacion-tutor2.ts`;
los usan el botón de «Altas en proceso» y la cola), y la pantalla, que saca una fila por familia.
Lo afirma el test del cambio que entra por el hermano sin la invitación
(`cola-invita-tutor2.rls.test.ts`). Medido el 2026-11-04 en producción: 0 familias con invitaciones
del segundo tutor en dos hijos.

### El segundo tutor: reenviar y cancelar (2026-11-04)

**Por qué existe** (medido el 2026-11-04): la invitación al segundo tutor solo sale al validar el
alta (`invitarTutor2AlValidar`, desde `activar-matricula.ts`). Hoy, si la familia corrige el email
del tutor 2 o añade un tutor 2 después de validar, la cola escribe la fila (`aplicar.ts`) y **no se
invita a nadie**. Esa persona se queda fuera para siempre y nadie se entera. El botón de reenviar
es lo único que cierra los dos casos. _(Desde el 2026-11-04 la cola también invita al aprobar:
«La cola invita al segundo tutor», abajo.)_

**Decisiones del responsable:**

- **Reenviar y cancelar, en la fila del segundo tutor** de «Altas en proceso». Reenviar va siempre
  al email de su ficha; cancelar pide confirmación y deja la ficha, para poder reenviar después.
- **El email no lo corrige Dirección.** Sería una segunda vía que se salta la cola, y un cambio
  pendiente de ese tutor se la pisaría al aprobarse. Lo corrige el tutor 1 por la cola, como hoy, y
  Dirección lo aprueba; después, reenvía.
- **Sin basura.** Una invitación que se cancela se lleva la cuenta provisional que creó y nunca
  entró, en Auth y en `usuarios`, con el mismo filtro que `reinvitar_alta`. El reenvío al mismo
  email reutiliza la invitación y la cuenta provisional (`sendInvitation` le alarga el plazo y
  GoTrue reenvía a la misma cuenta): una cuenta y una invitación, no dos. El reenvío a un email
  corregido cancela antes las invitaciones a los emails viejos.
- **La base** (`20261231120000`): `cancelar_invitacion_tutor2(niño, actor, email_que_se_queda)`,
  solo `service_role`, que vuelve a mirar `privado.es_direccion`. Borra sin copia las invitaciones
  sin aceptar del segundo tutor del niño (salvo la del email que se queda), no toca la del tutor
  principal, y deja quién lo hizo como evento `invitacion_tutor2`.
- ~~**Pendiente de decidir:** que aprobar en la cola un cambio de email del tutor 2, o su alta
  después de validar, mande la invitación por sí solo.~~ **Decidido el 2026-11-04** (abajo).

### La cola invita al segundo tutor (2026-11-04)

**Por qué:** el botón está bien para recuperar, pero que alguien tenga que acordarse de pulsarlo es
lo que deja a una persona fuera durante meses. Si la cola ya sabe que el email cambió, que invite
ella (decisión del responsable).

- **Al aprobar** (`aprobarCambio`) un cambio de datos del segundo tutor con el alta validada, si su
  email es nuevo —cambió, o el segundo tutor se añade ahora— se le invita con el mismo núcleo que
  el botón (`invitarTutor2`). Un cambio que deja el mismo email (la dirección, el nombre) no manda
  nada: no se mandan correos por cambiar un piso.
- **El email de antes se lee ANTES de aplicar**, del perfil compartido (`familia_tutores`). Si esa
  lectura falla, no se aplica nada y el cambio vuelve a pendiente.
- **Un fallo al invitar no deshace la aprobación.** Queda como aviso: el dato está aprobado y la
  invitación no ha salido; se reenvía a mano desde «Altas en proceso».
- **En toda la familia** («La invitación del segundo tutor es de la familia», arriba): el
  reenvío y la cancelación, del botón y de la cola, limpian en todos los hermanos, y si uno ya tiene
  la invitación al email actual se reenvía esa. Hasta #493 el botón limpiaba solo el niño de su
  fila.
- Sin migración: usa `cancelar_invitacion_tutor2` (`20261231120000`) una vez por hermano.

## Fase 3: documentos del centro versionados

### Lo que dice Jose del presupuesto (2026-11-05)

> «Si se ha equivocado al subir el presupuesto, lo puede modificar y que lo vuelvan a firmar todos.
> Es una cosa de cajón. Lo que hay que tener en cuenta es que se sube uno por curso. Es decir, yo
> este año puedo subir uno para el curso 26-27 con unos precios y a la vez para el curso 27-28 tener
> otro presupuesto para otros niños que se estén dando de alta ya. Entonces tengo los dos y cada uno
> firma el suyo, el que se dé de alta. Y al finalizar el curso, los que vayan a continuar, pues
> firmarán el nuevo.»

**Hay varios vivos a la vez.** No hay «la versión vigente» de un documento de curso: hay **la
vigente de cada curso**. En mayo de 2027 pueden estar vivos a la vez el presupuesto de 2026/27 (lo
firma Lucía, que entra tarde a 2026/27) y el de 2027/28 (lo firman los que se dan de alta para
septiembre, y en junio los que continúan). Cada familia firma el de **su matrícula**. El modelo y la
pantalla cuentan con eso desde el principio: la vigente es la última versión **de ese documento y
ese curso**. En un documento que no es de curso, como las normas, es la última del documento.

### Decisiones (2026-11-05)

- **J5 · Una versión se puede borrar mientras no tenga ninguna firma**, y queda registro de quién la
  borró. Un PDF subido por error puede llevar datos de otra familia, y guardarlo para siempre es un
  problema de protección de datos sin ninguna contrapartida. En cuanto tenga una firma, el `RESTRICT`
  de la tabla de firmas (3b) lo impide y ya no se borra nunca, salvo con [la llave de `postgres`](../architecture/rls-policies.md#la-llave-de-postgres), que con `replica` también se salta un `RESTRICT`. Borrar no es cambiar: lo que se borra
  se va entero, la fila y el fichero.
- **J6 · «De curso» se puede cambiar mientras el documento no tenga versiones.** Después queda fijo:
  si estaba mal, se crea otro documento. Así ninguna versión se queda sin curso en un documento de
  curso, ni con curso en uno que no lo es.
- **J7 · El título va en un solo idioma**, como lo escribe el centro: el PDF también está en uno.
- **Cursos:** una versión solo se sube para un curso del centro `planificado` o `activo`, nunca
  `cerrado`, y el curso tiene que existir antes. Para subir el presupuesto de 2027/28, antes se crea
  el curso 2027/28.

### Pedir que lo vuelvan a firmar (la refirma)

Jose: «si se ha equivocado al subir el presupuesto, lo puede modificar y que lo vuelvan a firmar
todos». Es funcionalidad nueva, y **no es el J4**: una versión nueva **no** obliga a refirmar por sí
sola. Lo que se pide es que la admin **pueda pedirlo** cuando se ha equivocado. Es una acción suya,
no un automatismo. **Construida en el 4d** (`20270111120000`; ver «4d · La refirma»).

**Lo que el 3a dejó preparado para no impedirlo:** cada versión lleva `pide_refirma` (`false` hasta
el 4d). Con `true`, las firmas de las versiones anteriores del mismo documento y curso
dejan de valer. La fila de una versión no cambia nunca, así que se decide **al subir la corregida**:
«sube la buena y pide que la firmen otra vez». Si algún día hiciera falta pedirlo después de subirla,
iría en una tabla aparte, sin tocar la de versiones.

### 3a · Documentos y versiones (base de datos)

- **`documentos_centro`**: centro, título (J7), `de_curso` (J2; J6), `obligatorio`, orden,
  `retirado_at`, quién lo creó.
- **`documentos_centro_versiones`**: documento, curso (obligatorio si el documento es de curso,
  prohibido si no), número (correlativo por documento y curso), `sha256`, ruta, bytes,
  `pide_refirma`, quién y cuándo la subió.
- **Sin políticas ni privilegios para nadie** en las dos tablas, como `remesa_ficheros`: solo las
  funciones. Todas exigen la admin del centro (`privado.es_responsable`, J1): crear y editar un
  documento, registrar una versión, borrarla y la lista para la pantalla.
- **El bucket `documentos-centro`**: privado, PDF, 10 MB, sin políticas en `storage.objects`. Ruta
  `{centro}/{documento}/{sha256}.pdf`. El hash lo calcula **el servidor** a partir de los bytes que
  sube. La función que registra comprueba que la ruta es esa y que el objeto está en el bucket, con
  su tamaño y su tipo, y la base vuelve a mirar el curso y el documento.
- **Una versión no cambia nunca**: ni la admin, ni `service_role`, ni `postgres` mientras los
  triggers estén puestos y encendidos ([la llave de `postgres`](../architecture/rls-policies.md#la-llave-de-postgres)):
  - un trigger impide todo `UPDATE` de la fila;
  - otro impide su `DELETE` salvo por la función de borrar, que deja el registro (J5);
  - en `storage.objects`, solo para este bucket y solo sobre un objeto al que apunta una versión,
    otro impide cambiar su contenido (sustituirlo, moverlo) y borrarlo. No impide leerlo: Storage
    toca `last_accessed_at` y `updated_at` al servirlo.
- **«La vigente» no existe a secas.** La tabla de versiones guarda varias vivas a la vez del mismo
  documento, una por curso: la de 2026/27 y la de 2027/28 del presupuesto son las dos vigentes, cada
  una de su curso. La vigente es la de número mayor **de ese documento y ese curso**; leer «la de
  número mayor del documento» daría a Lucía, que entra tarde a 2026/27, el presupuesto de 2027/28.
- **`postgres` conserva su llave sobre las dos defensas.** Puede quitar los dos triggers, el de la
  fila y el del fichero, o apagarlos con `session_replication_role = replica`. Es una decisión, no un
  hueco, y vale para todas las defensas de la base: [la llave de `postgres`](../architecture/rls-policies.md#la-llave-de-postgres). Ningún guion la
  usa sobre estas tablas: la limpieza de los tests borra versiones como `postgres`, pero por el
  marcador de la función, sin quitar ni apagar el trigger.
- **Registro (J5):** crear y editar un documento, subir una versión y borrarla dejan un evento
  directo en `audit_log` (`documento_centro`), con la acción y los identificadores, sin datos de
  ninguna familia.
- **En la app**, sin pantalla (la pantalla es el 3c): la acción que sube (comprueba la sesión, que es
  un PDF, calcula el hash, sube y registra) y la que borra (borra la versión y después su fichero; si
  el fichero no se va, lo dice, y se reintenta).

### 3b · Las firmas (base de datos)

Migración `20270102120000_feat_firmas_documentos_centro`. La pantalla de firmar es la fase 4: el 3b
deja la tabla, sus defensas y toda la retención, y nadie escribe todavía con sesión.

- **`firmas_documentos_centro`**: una firma por versión y niño (J3), con quién firmó, su rol, cómo
  (`metodo_firma`), el nombre tecleado, el trazo, la IP y el navegador. Apunta a la versión con
  `RESTRICT`; al niño, con `CASCADE` (anular un alta sin terminar se la lleva, como las de
  autorizaciones); al firmante, con `RESTRICT`.
- **La copia de lo firmado**: título, número, curso con su nombre y `sha256`, que pone el trigger
  desde la versión aunque quien firma diga otra cosa. La familia no lee la tabla de versiones, y la
  firma tiene que decir sola qué se firmó (lo usa el export).
- **No cambia nunca** (`firma_inmutable`). Se borra por la destrucción a los 5 años o con el niño.
- **Leen** quien firmó, los tutores del niño y la Dirección del centro. La profe no: la firma es del
  alta, no del aula.
- **J5, con el primer `ENABLE ALWAYS` del esquema.** Una versión con firmas no se borra nunca. El
  `RESTRICT` no basta: con `session_replication_role = replica` no dispara (rls-policies.md, «La
  llave de `postgres`»). Dos triggers en `ENABLE ALWAYS` lo sostienen, uno por fila y otro por
  sentencia, porque `TRUNCATE … CASCADE` no pasa por los de fila. Medido en producción el
  2026-11-05, en ensayos terminados en RAISE: en `replica`, borrar la versión firmada y vaciar la
  tabla dan `version_firmada` (23503); con el trigger vuelto a `ENABLE` normal, los dos pasan.
- **La retención, la misma que `firmas_autorizacion`**, en la misma migración, partiendo de las
  definiciones vivas de producción (la guarda previa compara su md5 normalizado): la política
  `RESTRICTIVE` `bloqueo_retencion`, `datos_bloqueados` y `contenido_bloqueado` (código
  `firmas_documentos`), `queda_conservado_nino`, `quedan_firmas_usuario`, `destruir_firmas_nino`
  (salvo la del tutor retenido), `_claves_pii_nino` (`firma_imagen`) y `audit_trigger_function`
  (centro directo). El export, en las dos capas: la base, por `datos_bloqueados`; la app, con dos
  secciones (`nino.firmas_documentos` y `usuario.firmas_documentos_realizadas`) con las reglas de
  las firmas de autorizaciones: del otro tutor no salen su IP, su navegador ni su trazo.

**La firma en persona (decisión de Jose del 2026-11-05):** «ya está previsto, como cuando la
directora sube toda la información, porque se lo entregan en físico». El presupuesto y las normas se
firman también en papel, delante de Dirección, como el mandato presencial y la firma presencial de
las autorizaciones. Va en el 3b, como una columna más. Las dos formas acaban en la misma tabla, y
esto es lo que las distingue como prueba (la base lo exige con
`firmas_documentos_centro_forma_por_metodo`):

|                        | Con el dedo (`digital`)                                              | En persona (`presencial`)                                                       |
| ---------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Quién la firma         | El tutor, con su sesión                                              | La familia, en papel, delante de Dirección                                      |
| `firmante_id`, `rol`   | El tutor; su vínculo (nunca `admin`)                                 | Quien de Dirección la registró; `admin`                                         |
| `nombre_tecleado`      | El que teclea el tutor al firmar                                     | El nombre de quien firmó el papel, que teclea Dirección                         |
| Trazo (`firma_imagen`) | Obligatorio (D2)                                                     | Ninguno: no se dibuja una firma que no se ha hecho en la pantalla               |
| IP y navegador         | Los del tutor                                                        | Los de quien registró, si los hay: no dicen nada de la familia                  |
| Lo que prueba la fila  | Que el tutor firmó en la app ese PDF exacto (`sha256`), con su trazo | Que Dirección registró que la familia firmó ese PDF exacto (`sha256`), y cuándo |
| La prueba de la firma  | La fila                                                              | **El papel firmado, que guarda el centro**; la fila es su registro              |

El hash, como en el mandato presencial desde el mandato v2, es de lo que se firma: allí, el texto canónico
que sale de lo que teclea la directora; aquí, el PDF de la versión (`sha256`), que es el mismo en
las dos formas. Quién puede registrar una en persona (Dirección del centro, no el superusuario,
como en las autorizaciones) lo decide la función de firmar de la fase 4.

### 3c · La pantalla de la admin

`/admin/documentos-centro`, en el menú de la admin junto a «Centro». Sin migración: usa las
funciones del 3a y la tabla de firmas del 3b. La familia sigue sin ver nada hasta la fase 4.

- **Solo la admin del centro (J1)**, con el mismo criterio que la base (`es_responsable`): ni la
  entrada del menú ni la página existen para una directora, y la base contesta 42501 si llega.
- **La lista** sale de `documentos_centro_admin`: cada documento con su orden, título, si es de
  curso, si es obligatorio y si está retirado, y debajo sus versiones **agrupadas por curso**, con el
  nombre del curso, el número, la fecha, el tamaño y la vigente de cada curso marcada. Varias vivas
  a la vez se ven como lo que son: una por curso, no «la vigente» del documento.
- **Cuántas firmas tiene cada versión** se lee de `firmas_documentos_centro` con la sesión de la
  admin (la Dirección lee las firmas, 3b), solo `version_id`. No es la regla de borrar, es lo que se
  enseña: el botón de borrar sale solo con cero firmas visibles, y si la base encuentra alguna que la
  admin no ve (una firma bloqueada por retención), contesta `version_firmada` y la pantalla lo dice.
- **Crear y editar un documento:** título (J7), de curso o no, obligatorio y orden. «De curso» solo
  se puede cambiar mientras no tenga versiones (J6): con versiones, la casilla no se ofrece, y la
  base lo vuelve a mirar (`de_curso_fijo`). **Retirar** y **volver a poner**, sin borrar nada.
- **Subir una versión:** un PDF de hasta 10 MB, por la ruta del 3a. En un documento de curso se
  elige el curso entre los `planificado` y `activo` del centro; en uno que no es de curso no se
  pregunta. La pantalla avisa de lo que hace: **una versión nueva no pide que vuelvan a firmar**
  (J4), salvo que la admin lo pida al subirla (4d).
- **Ver el PDF de una versión:** un enlace firmado de 60 segundos, después de comprobar que la
  versión está en la lista de la admin.
- **Borrar una versión sin firmas (J5):** con confirmación. Si el fichero no se va, la pantalla lo
  dice, y los **ficheros pendientes de borrar** salen arriba con «reintentar».

## Fase 4: presupuesto y normas, para firmar

### Decisiones (2026-11-05)

- **P-6 · Un documento que no existe no bloquea el alta.** Jose: «B — lo firmará cuando se genere el
  documento». Si el centro no tiene definido un documento, o no hay versión para el curso del niño,
  el alta se cierra igual, y esa familia queda con la firma **pendiente**: la firma cuando se suba.
  Lo que sí bloquea es una versión que existe y está por firmar.
- **Los acuses de normas por casilla no valen como firma.** Los niños validados con la casilla
  firmarán cuando el documento exista, igual que los demás, y con el J2 pasan por ahí de todas formas
  al curso siguiente. Las filas de `acuses_alta` se quedan como histórico. Medido en producción el
  2026-11-05: los 3 acuses de normas son los 3 niños activos, y los tres firmantes son del buzón del
  responsable (dos alias `+nino1` y `+nino3`, y su cuenta de entonces como admin). No hay ninguna
  familia de otro buzón. El gate deja de aceptarlos en el 4b, que es quien lo cambia (y barre lo que
  lo afirma, regla 12). **Hecho en el 4b-2** (`20270109120000`).
- **El 4c es lo importante de la fase**, no un extra: sin él, una familia que se matricula hoy no firma
  nunca y nadie se entera. La familia ve «documentos por firmar» en cuanto existe la versión que le
  toca, y Dirección lo ve **en su inicio y por niño**, sin buscarlo.
- **«No existía» no es «no ha firmado».** Pendiente porque el documento no existe no es de la
  familia; pendiente porque no lo ha firmado, sí. Por eso hay dos estados distintos, y el segundo
  lleva desde cuándo pudo firmarlo.
- **U-3, corregido en la base.** El acuse médico del cierre del alta se exigía de quien cierra para
  cualquier niño; U-3 lo pasó a «de ese niño» solo en la app. El 4a lo corrige en
  `marcar_matricula_lista`.

### Decisiones (2026-11-06)

- **Las normas son un documento del centro, y se firman solo por ahí.** Jose: se quita el tipo
  «normas de régimen interno» del catálogo de Autorizaciones. Su razón: **dos caminos para firmar lo
  mismo significa que dentro de un año nadie sabrá cuál vale.** En producción hay 0 autorizaciones de
  ese tipo (medido el 2026-11-06): nada que migrar, solo cerrar. Va en el 4b-3, detrás del 4b-2,
  porque cerrar el tipo es recrearlo: lo usan su columna, su índice único, dos funciones, las dos
  políticas de escritura y el CHECK de la tabla (y la de lectura, que llama a una de las funciones con
  el tipo en su firma: tres políticas en total). **Hecho en el 4b-3** (`20270110120000`).
- **El único momento de la historia del producto en que un alta se cierra sin normas.** Con la P-6 y
  la casilla fuera, mientras el centro no suba sus normas un alta se cierra **sin normas de ninguna
  clase**, ni casilla ni firma, y la familia las firma en el 4c cuando la admin las suba. Es lo que
  eligió Jose con la P-6 («lo firmará cuando se genere el documento»). La casilla no se queda con una
  condición: un camino viejo que sobrevive «solo mientras» no se quita nunca. Ejemplo, medido el
  2026-11-06: CEI Ejemplo no tiene ningún documento subido y tiene un alta pendiente; con el 4b-2 esa
  alta se cierra sin normas.
- **La puerta, también en la base.** Hoy un tutor que llama directamente a `marcar_matricula_lista`
  cierra el alta sin haber firmado nada: la puerta de las normas vive solo en `finalizarAlta`. La de
  los documentos va en las dos (4b-2, con su migración y sus controles).
- **El botón de firmar sale después de abrir el PDF** (decisión del responsable). No prueba que lo
  hayan leído, y no se presenta así: una familia que firma sin haber abierto el documento es una
  reclamación esperando, y abrirlo cuesta un toque. Ningún texto dice «he leído»: la pantalla dice
  «Has abierto el documento» y el botón, «Firmar «Normas»».

**Orden:** 4a (base) → 4b (la familia firma en el alta) → 4c (firmar fuera del alta y lo pendiente en
el inicio de Dirección) → 4d (la refirma, que necesita dónde firmar otra vez).

### 4b · La familia firma en el alta

En tres PRs, porque la puerta no puede llegar antes que el sitio donde firmar (el 3c ya está
desplegado: la admin puede subir un documento en cualquier momento):

- **4b-1, dónde firmar** (sin migración). En el paso de los acuses del alta, antes que las normas de
  siempre, los documentos que le tocan al niño (`documentos_firma_nino`), cada uno con su estado:
  - el que el centro no ha subido: «El centro todavía no ha subido «Normas». Se firmará cuando
    esté.» No frena nada (P-6);
  - el que está por firmar: «Abrir el documento» (un enlace firmado de un minuto, a la versión que
    al niño le toca, `ruta_version_documento_nino`), y al abrirlo, el nombre, el trazo y «Firmar»;
  - el firmado: cuándo, y si fue en papel.

  **Cómo se firma lo decide el servidor**, con la regla de la entrada del alta: con vínculo vivo con
  el niño, como familia, con el dedo (`firmar_documento_centro`); sin vínculo y de Dirección del
  centro del niño, en persona, sin trazo (`registrar_firma_documento_presencial`), aunque el
  navegador mande uno; el superusuario no (ADR-0061). Es el patrón del mandato con una diferencia:
  el mandato decide «en persona» por ser de Dirección, sin mirar el vínculo, y aquí se mira primero
  el vínculo, para que la pantalla (que entra en modo Dirección solo sin vínculo) y el servidor
  digan lo mismo. Una directora que es madre del niño firma como madre.

  La casilla, la autorización de normas y la puerta de `finalizarAlta` no cambian en este PR.

- **4b-2, la puerta y el barrido** (con migración, `20270109120000`). `finalizarAlta` y
  `marcar_matricula_lista` exigen firmada cada versión obligatoria que está por firmar; lo que falta no
  frena (P-6), ni lo opcional. La regla vive en tres sitios que dicen lo mismo: `frenaElAlta`
  (`regla-documentos-alta.ts`) para el gate y el avance, y en la base
  `d.obligatorio AND d.estado = 'por_firmar'` sobre `privado.documentos_del_nino`. Si la base frena
  (`documentos_por_firmar`), la app dice lo que falta. Fuera del alta la casilla y la autorización de
  normas, con todo lo que las afirma (regla 12), y la casilla cerrada también en la base: sin la
  política de INSERT de `acuses_alta` y sin el privilegio para `authenticated` (cada cerrojo basta
  solo; `service_role` lo conserva, sin código que lo use). Las filas de `acuses_alta` se quedan como
  histórico. En «Altas en proceso», la línea «Normas» pasa a «Documentos del centro», con la regla del
  gate, y no sale mientras el niño no tenga nada obligatorio subido (como el SEPA sin CID): «hecho»
  por un documento que no existe diría que la familia hizo algo.

  **Orden: mergear, esperar el despliegue, aplicar.** La migración cierra la casilla que la app de
  antes todavía enseña.

- **4b-3, el tipo fuera del catálogo** (con migración). Ver «Decisiones (2026-11-06)».

### 4d · La refirma

Migración `20270111120000`. Decidido (J4): una versión nueva no pide volver a firmar sola; **la admin
lo pide al subir una versión corregida**. Una versión no cambia nunca, así que se decide al subirla.

- **Pedirlo:** al subir, «Pedir que vuelvan a firmar». Solo se ofrece si ese documento y ese curso ya
  tienen una versión: en la primera no hay nada que volver a firmar, y la base tampoco lo deja
  (`sin_version_anterior`). La pantalla dice cuántos niños firmaron una versión anterior. Se manda
  siempre dicho: no pedirlo es `false`, no olvidarlo. La versión que lo pidió lleva su etiqueta en la
  lista de la admin, y el evento `version_subida` lo dice.
- **Qué firma vale** (`privado.documentos_del_nino`): una firma de ese documento y ese curso vale si
  su versión es la misma o posterior a la última que pidió volver a firmar. Si no, el niño vuelve a
  «por firmar» la vigente:
  - con la firma de antes a la vista (`firma_id`): la pantalla dice «el centro ha corregido… y pide
    volver a firmarlo», con la fecha de la firma anterior;
  - desde la subida de la versión que lo pidió. Quien nunca firmó cuenta desde la primera versión.
- **Dónde sale:** donde ya sale lo pendiente, porque todo lee esa función: el alta (y su puerta, que
  frena el cierre hasta volver a firmar), la ficha del niño y los dos inicios (4c).
- **Se firma la vigente:** ni la que se firmó antes ni una intermedia (`version_no_vigente`).
- **Una versión posterior que no lo pide** no deshace nada: la firma de la que lo pidió sigue
  valiendo.
- **Orden: aplicar antes de mergear.** La migración no rompe la app de antes (subir con cuatro
  argumentos es no pedirlo), y la app nueva manda el quinto.

### 4c · Firmar fuera del alta y lo pendiente en el inicio

Sin migración: la base del 4a ya lo tiene todo, y nada de firmar depende del alta
(`firmar_documento_centro` y `registrar_firma_documento_presencial` piden una matrícula viva, no una
pendiente). Lo que faltaba era dónde.

- **Dónde se firma:** en la ficha del niño, con la misma pieza que en el alta
  (`DocumentosParaFirmar`, que sale de `alta/` a `documentos-centro/` con nombres que no dicen «alta»,
  y su PDF en `/{locale}/documento-centro/{niño}/{versión}`). La familia, en `/family/nino/{id}`,
  solo el tutor legal (el autorizado ni los lee, 4a). La Dirección, en la pestaña Documentación de
  su ficha del niño, con el modo que decide el servidor con la regla de siempre
  (`modoFirmaDocumento`: con vínculo, con el dedo; sin él, en papel).
- **Qué se reclama:** lo obligatorio por firmar, con la misma regla que no deja cerrar el alta
  (`laFamiliaLoDebe` llama a `frenaElAlta`). Un opcional sale en la lista del niño, pero no en un
  aviso: una familia que decide no firmarlo lo vería para siempre.
- **El inicio de la familia:** una línea por hijo con algo debido, que lleva a su ficha. Los hijos
  con el alta en curso no: el alta ya se lo pide.
- **El inicio de Dirección**, sin buscarlo (`documentos_firma_centro`):
  - **por firmar**, de la familia: por documento y curso, cuántos niños y desde cuándo el que más
    lleva, y desplegada la lista de niños, cada uno a la pestaña Documentación de su ficha;
  - **sin subir**, del centro, aparte y dicho como lo que es: «el centro no lo ha subido; lo
    necesitan N niños». El enlace para subirlo, solo a la admin (la pantalla de documentos es suya,
    J1); la directora ve la línea sin el enlace.
- **Una lectura que falla se dice** («no hemos podido comprobar…»), en los dos inicios y en la ficha.
  Callar diría «no hay nada que firmar».

### 4a · La base

Migración `20270103120000_feat_firmar_documentos_centro`. Sin pantalla.

- **Lo que le toca a cada niño** (`privado.documentos_del_nino`): por cada documento no retirado de
  su centro, en uno de curso una fila por cada curso no cerrado de sus matrículas vivas (Lucía, en el
  curso activo y en el planificado, tiene dos presupuestos), y en uno que no es de curso, una. Cada
  fila con su estado:

  | Estado            | Qué es                                                            | De quién es      |
  | ----------------- | ----------------------------------------------------------------- | ---------------- |
  | `falta_documento` | No hay versión para ese curso: no hay nada que firmar             | Del centro (P-6) |
  | `por_firmar`      | La versión existe y no hay firma de ese documento y curso         | De la familia    |
  | `firmado`         | Hay una firma de ese documento y curso, de cualquier versión (J4) | —                |

  Desde el 4d, una firma vale salvo que una versión posterior a la firmada pidiera volver a firmar.

  `por_firmar` lleva `disponible_desde`: la primera versión subida de ese documento y curso, o la
  entrada del niño si fue después. Un documento subido hoy dice «desde hoy». Un niño sin matrícula
  viva no tiene nada que firmar.

- **Quién lo lee:** por niño, sus tutores legales y la Dirección de su centro
  (`documentos_firma_nino`); el centro entero, solo lo pendiente, la Dirección
  (`documentos_firma_centro`, para el inicio del 4c). El autorizado y la profe, no.
- **Firmar con el dedo** (`firmar_documento_centro`): el tutor legal, solo la versión vigente que le
  toca y está por firmar. Basta uno (J3): el segundo recibe `ya_firmado`. La IP y el navegador los
  pone la app de la petición, como en las firmas de autorizaciones.
- **En persona** (`registrar_firma_documento_presencial`): la Dirección del centro, sin trazo y con
  rol `admin`; el superusuario no, como el mandato presencial.
- **El PDF** (`ruta_version_documento_nino`): la ruta de la versión que le toca o que ya firmó, para
  que la app la sirva con un enlace firmado.
- **Lo que no va aquí:** la puerta de los documentos en el cierre del alta va en el 4b, con la
  pantalla de firmar. Con ella aquí, un documento subido desde la pantalla del 3c (ya desplegada)
  dejaría todas las altas sin poder cerrarse y sin sitio donde firmar.

## Fase 5: campos del niño

Lo que pide la ficha de solicitud de plaza de ANAIA (curso 2026/2027) y la app no tenía. Medido el
2026-11-07 contra el texto de la ficha (llegó pegado el 2026-10-29, con la comparación de ese día) y
contra `main` 5bda873: las columnas de `ninos` eran las mismas que el 29-10. Faltaban el lugar de
nacimiento, el DNI, los hermanos, la provincia, las observaciones de la familia y «¿cómo nos has
conocido?», y los dos apellidos por separado. Nacionalidad y fecha de nacimiento ya estaban. El SIP
es la Fase 7; la media pensión, la 8; el número de matrícula no se construye (D13); los tutores, la 6.

### Decisiones (2026-11-07)

- **P5-1 · Dos apellidos**, primero y segundo, también en el prospecto de la lista de espera: la
  Dirección escribe dos casillas. Nadie parte unos apellidos, ni por el primer espacio ni de ninguna
  forma: «de la Fuente Martín» no tiene una partición que se pueda adivinar, y una mal hecha no se
  distingue luego de un apellido simple.
- **P5-2 · La provincia** se añade, opcional, junto a la ciudad.
- **P5-3 · No hay teléfono del niño.** Los teléfonos son de los tutores (Fase 6), y el de emergencia
  está en la ficha médica.
- **P5-4 · Observaciones de la familia**, con el aviso de que los datos de salud van en la ficha
  médica. Se borran con el niño.
- **P5-5 · «¿Cómo nos has conocido?»**: lista cerrada (internet, redes sociales, recomendación de otra
  familia, pasé por delante) con «otro» y su texto. Solo a las familias nuevas en el centro: al
  segundo hijo no se le pregunta.
- **P5-6 · Hermanos**: el total cuenta al niño, y el lugar que ocupa va de 1 (el mayor) al total.
  Lucía, con Pablo mayor y Ana menor: 3 hermanos, lugar 2. `tiene_hermanos_en_centro` (datos
  pedagógicos) se queda: es otra pregunta.
- **P5-7 · Campos fijos.** La configuración por centro (oculto, opcional u obligatorio) se hace cuando
  exista el segundo centro. Coste aceptado: entonces se vuelven a tocar el alta y las fichas.
- **P5-8 · Lo obligatorio para cerrar el alta:** lugar de nacimiento, nacionalidad (antes opcional) y
  hermanos. Opcionales: DNI del alumno, «¿cómo nos has conocido?», provincia y observaciones.
- **Lo que se tomó por defecto:** nada es retroactivo (los niños con el alta ya validada no se
  bloquean); el DNI del niño va en claro, como el SIP (D7), y se borra con el niño; se aceptan DNI y
  NIE, con la letra comprobada.

### 5a · La base

Migración `20270112120000`, sin pantalla (la pone la 5b).

- **Los apellidos, derivados por la base.** `ninos.apellidos` y `lista_espera.apellidos_nino` pasan a
  ser columnas generadas de `primer_apellido`/`segundo_apellido` y
  `primer_apellido_nino`/`segundo_apellido_nino`: lo que la base puede derivar, no lo acepta del
  cliente (#507, ver `rls-policies.md`, «Rutas e identificadores del cliente: se validan en la BD
  contra la fila»). Tres consecuencias:
  - los que solo **leen** el nombre (102 ficheros de la app, el concepto del adeudo SEPA, las listas,
    los avisos, el export y cinco funciones) no se tocan: siguen recibiendo «García López»;
  - escribir `apellidos` pasa a ser un **error** para todos, también para la Dirección y el servicio
    (428C9). Un escritor que se escape lo caza el CI, y el compilador: en los tipos es `never`;
  - el concepto del adeudo, el PDF del mandato y las listas no tuvieron que partir nada: ninguno lo
    hacía.
- **La conversión**, niño a niño y prospecto a prospecto, con su valor escrito en la migración y una
  guarda que comprueba que cada uno sigue teniendo exactamente ese valor. Los 4 niños y los 5
  prospectos de producción son de una sola palabra: van enteros al primer apellido. Una fila que no
  esté en la lista, o que haya cambiado, **para** la migración, y se pregunta.
- **Los campos nuevos de `ninos`:** `lugar_nacimiento`, `dni` (normalizado; CHECK con la letra,
  `privado.dni_nie_valido`), `hermanos_total` y `hermanos_lugar` (juntos, 1 ≤ lugar ≤ total ≤ 20),
  `direccion_provincia`, `observaciones_familia` y `como_nos_conocio` con `como_nos_conocio_otro`.
  Todos opcionales en la base: lo obligatorio para cerrar el alta va en la 5b, que es la que los
  pregunta. Los CHECK escriben el `IS NOT NULL` a la vista: un CHECK que da NULL deja pasar la fila,
  y el ensayo lo midió («otro» sin texto entraba).
- **Quién los escribe:** la tutora legal por `actualizar_identidad_nino_tutor` (firma nueva: los dos
  apellidos en pareja y los campos nuevos; NULL deja lo que hay y vacío lo borra, como el setter
  médico); la provincia, con la dirección, por `actualizar_familia_nino`; los dos apellidos del
  prospecto, por `crear_o_anadir_a_familia` (firma nueva). La Dirección sigue escribiendo la ficha
  directamente (`ninos_admin_all`), con los mismos CHECK.
- **La purga** los borra (`privado.purgar_nino`) y la redacción de `audit_log` los conoce
  (`_claves_pii_nino`, también los dos del prospecto). `purgar_sujeto_db` no escribe `apellidos` y no
  se toca (su `k_nino` no se usa en el cuerpo); va en la guarda.
- **El export** entrega los campos nuevos de la ficha del niño. Del prospecto entrega `apellidos_nino`,
  que es los dos unidos.
- **ORDEN: aplicar y mergear seguidos.** Con la migración aplicada, la app de antes no puede escribir
  los apellidos, y la nueva no funciona sin la migración. No hay orden sin ventana que no adivine.
- Medido en producción el 2026-11-07 (ensayo terminado en RAISE, LF y CRLF idénticos, sobre el alta
  pendiente de CEI Ejemplo y el niño validado).
- Test: `src/test/rls/campos-nino-base.rls.test.ts`.

**Lo que queda para la 5b:** las pantallas (el alta, las dos fichas, el prospecto ya lleva sus dos
casillas desde la 5a), lo obligatorio al cerrar el alta (la app y `marcar_matricula_lista`), la
pregunta de «cómo nos has conocido» solo a familias nuevas, sus valores traducidos en el export y la
provincia en la cola de cambios.

**Cerrado el 2026-11-08** («La puerta de identidad», abajo): con el alta validada,
`actualizar_identidad_nino_tutor` dejaba a la tutora legal cambiar la identidad de su hijo sin pasar
por la cola.

### La puerta de identidad (entre la 5a y la 5b)

**Decisiones (2026-11-07 y 2026-11-08).** PR propio, detrás de la 5a y antes de la 5b: la 5b no se
construye encima de una puerta que se va a cerrar.

- **Los ocho campos que identifican al niño van a la cola**: nombre, los dos apellidos, fecha y lugar
  de nacimiento, sexo, nacionalidad y DNI. Los otros seis siguen directos: idioma, hermanos (total y
  lugar), observaciones y cómo nos conoció. Corregir el número de hermanos no necesita a Dirección;
  cambiar el nombre o el DNI, sí. Meter los catorce haría de la cola un trámite que se aprueba sin
  mirar, y una cola que se aprueba sin mirar no protege nada.
- **Solo se encola lo que cambia** respecto a lo guardado, también en el domicilio y en los datos del
  tutor. Hasta ahora, con el alta validada, guardar el paso del menor encolaba un cambio de domicilio
  cada vez, aunque no se hubiera tocado nada (en producción, el 2026-11-08, la cola tenía 0 entradas:
  no había nada que limpiar).
- **La cola enseña antes → después de cada campo, en todas las entradas**: si unas enseñaran los
  valores y otras solo el nombre del campo, se aprendería a aprobar las segundas sin mirar. Sustituye
  a «el valor propuesto no se muestra; la dirección revisa el dato real en la ficha».
- **El aviso de la pantalla dice qué va a la cola y qué se guarda al momento**, y el mensaje de
  después de guardar, qué pasó con cada parte. El de antes decía que los datos sensibles iban a
  Dirección mientras la identidad se guardaba directa.

**En la base** (`20270113120000`): con el alta validada, `actualizar_identidad_nino_tutor` rechaza
(42501, HINT `cola_validacion`) un CAMBIO en cualquiera de los ocho; mandar el mismo valor no es un
cambio, con las mismas expresiones que el UPDATE (el DNI sin espacios, puntos ni guiones). Es el
respaldo: la app encola antes de llamar. La entrada de identidad lleva el DNI en el payload: la
auditoría no lo copia y la purga del niño la borra (lo comprueba la guarda posterior).

**Antes:** la tutora legal cambiaba la identidad de su hijo con el alta validada sin pasar por la
cola, cuando el domicilio sí iba a la cola (`actualizar_familia_nino`). Medido en el ensayo de la 5a,
antes y después, y en el de esta pieza.

- Medido en producción el 2026-11-08 (ensayo terminado en RAISE, LF y CRLF idénticos): antes, la
  puerta abierta; después, cada uno de los ocho da `cola_validacion`, los mismos ocho valores y el
  mismo DNI escrito de otra forma pasan, el idioma y los hermanos siguen directos, el niño sin validar
  y la Dirección no cambian, y la entrada con el DNI no deja copia del payload y la purga la borra.
- **ORDEN: da igual**, en el sentido de que ningún orden rompe nada: con la migración y la app de
  antes, un cambio de identidad con el alta validada falla con «no autorizado» sin escribir nada; la
  app nueva funciona con o sin la migración. Se hizo con el orden prudente (#518: mergear, esperar el
  despliegue, aplicar): aplicada el 2026-11-11 a las 09:10 UTC, comprobada en producción la puerta
  en la función y su fila en `schema_migrations`.
- Tests: `src/test/rls/campos-nino-puerta.rls.test.ts`, y los unit
  `src/features/cambios-pendientes/lib/__tests__/diff.test.ts`,
  `src/features/ninos/actions/__tests__/actualizar-nino-tutor.test.ts`,
  `src/features/cambios-pendientes/queries/__tests__/get-cola.test.ts` y
  `src/test/i18n/cola-antes-despues-keys.test.ts`.

### 5b · Las pantallas y lo obligatorio al cerrar el alta

**Decisiones (2026-11-10 y 2026-11-11).** Las de la fase (P5-1 a P5-8) y, al medir antes de construir:

- **La Dirección rellena la ficha del niño con su sesión, decidido en el servidor, sin pasar por la
  cola. Dirección no se valida a sí misma.** En el alta en papel («modo Dirección») el paso del menor
  guardaba la identidad con la función de la tutora, cuya puerta es `es_tutor_legal_de` en todas sus
  versiones: la Dirección recibía 42501 (medido en producción el 2026-11-08 y otra vez el 2026-11-11,
  con su control positivo y su control negativo; ver abajo). Con los obligatorios de la 5b, la
  Dirección no habría podido cerrar nunca un alta en papel, que es el camino de CEI Ejemplo cuando
  la familia llega con los papeles. `actualizarNinoTutor` pregunta en el servidor si quien guarda es
  Dirección del centro del niño (`esAdminDeCentroDeNino`, como `registrar-consentimiento-tutor`) y,
  si lo es, escribe la ficha directamente (`ninos_admin_all`, con los mismos CHECK), con la misma
  regla que la función aplica a la tutora (`parcheNinoDireccion`: NULL deja lo que hay, vacío borra).
  Una tutora no tiene ese camino: la RLS no la deja escribir la tabla (0 filas, sin error).
- **Qué ve el autorizado en la ficha de la familia** (decidido por el responsable el 2026-11-11, con la
  línea que ya había en esa pantalla: la identidad básica la ve cualquier vínculo, lo de gestión solo
  el tutor legal). El lugar de nacimiento es identidad y lo ven todos; el DNI, los hermanos, la
  provincia, las observaciones y «cómo nos has conocido», solo el tutor legal. El DNI no entra aunque
  identifique: quien recoge a un niño no necesita su número de documento, y es el dato que más daño
  hace suelto. Lo que no se enseña tampoco se lee (`leerCamposAltaFicha`).
- **El agujero de la base** (el autorizado leía la fila entera de `ninos` saltándose la pantalla):
  cerrado en su propia pieza, «El autorizado: lo que ve y lo que no», justo debajo.
- **«Familia nueva en el centro»** = ningún otro niño con su `familia_id`, vivo, de baja o archivado.
  Se cuenta con el servicio y solo sale un número (`esFamiliaNuevaEnCentro`): con la sesión, la tutora
  no ve a un hermano de baja y la Dirección no tiene vínculos, y las dos darían «nueva» sin serlo. Si
  la lectura falla no se pregunta. Si ya está contestada, se enseña para poder corregirla.

**En la base** (`20270114120000`): `marcar_matricula_lista`, con la matrícula pendiente, frena
(P0001, HINT `datos_nino_por_completar`) si falta el lugar de nacimiento, la nacionalidad o los
hermanos, o los apellidos o la fecha. Esos dos ya se exigían, pero **en silencio**: el UPDATE tocaba 0
filas, la función devolvía NULL y la app lo trataba como un cierre ya hecho. No es retroactivo: solo
mira al cerrar una pendiente (una reactivación crea una pendiente y pasa por el asistente: también se
le piden). Lo demás de la función no cambia.

**En la app:**

- El paso del menor pregunta lugar de nacimiento, DNI o NIE (opcional, con la letra comprobada),
  hermanos (total y lugar), provincia, observaciones (con el aviso de que lo médico va en la ficha
  médica) y, a las familias nuevas, «¿cómo nos has conocido?». Obligatorios marcados: lugar,
  nacionalidad y hermanos.
- Con el alta validada, el lugar de nacimiento y el DNI van a la cola (puerta de identidad); los
  hermanos, las observaciones y «cómo nos conoció», directos.
- La provincia viaja con el domicilio (`actualizarNinoFamilia`); en la cola, el parche de domicilio
  es `strict` desde aquí: sin eso, una clave que no estaba en el esquema (la provincia lo estuvo hasta
  ahora) se descartaba en silencio al aprobar.
- `finalizarAlta` exige los mismos cinco datos (bloque «identidad») y traduce el HINT nuevo a lo que
  falta.
- La exportación traduce los cinco códigos de «cómo nos conoció»: cuatro salían en castellano en en y
  va. Un test lee los códigos del CHECK de la base, del enum de la app, del diccionario del export y
  de los mensajes.
- La ficha de Dirección enseña los campos nuevos, solo lectura; la de la familia, por quién mira (arriba).
- `PasoIdentidad.tsx` se quita: nadie lo pintaba. El #518 le cambió el mensaje de después de
  guardar, y ese mismo arreglo está en `PasoMenor`, que es el que se pinta (con sus tests): no había
  nada del #518 que viviera solo en el componente muerto. Otros tres componentes muertos, de mayo
  (`CalendarioCentroReadOnly`, `BrandedLoading`, `LoadingSkeleton`), van aparte.

- Medido en producción el 2026-11-11 (sonda sin migración y ensayo LF y CRLF, terminados en RAISE):
  la Dirección recibe 42501 de la función de la tutora (control positivo: la tutora pasa) y escribe
  directo con su sesión (los CHECK le valen: el DNI con la letra mala, 23514); la tutora, por ese
  camino, 0 filas. Antes de la migración, el niño sin los datos nuevos cerraba y sin apellidos daba
  NULL en silencio; después, cada uno de los cinco, quitado solo, frena con su motivo, completo
  cierra, la Dirección rellena y cierra, el niño validado no se toca, y el acuse médico sigue
  frenando antes.
- **ORDEN: mergear, esperar el despliegue, aplicar.** Con la migración aplicada y la app de antes,
  que no pregunta lugar ni hermanos, nadie podría cerrar un alta.
- Tests: `src/test/rls/alta-exige-datos-nino.rls.test.ts`, y los unit
  `src/features/ninos/actions/__tests__/actualizar-nino-tutor.test.ts`,
  `src/features/ninos/lib/__tests__/parche-nino.test.ts`,
  `src/features/alta/actions/__tests__/finalizar-alta.test.ts`,
  `src/features/alta/components/__tests__/PasoMenor.campos-5b.test.tsx` y
  `src/test/i18n/como-nos-conocio-codigos.test.ts`.

### El autorizado: lo que ve y lo que no (entre la 5b y la fase 6)

Migraciones `20270115120000_feat_lecturas_por_funcion` (las funciones; solo añade, va en su PR y se
aplica antes) y `20270115130000_fix_autorizado_lee_solo_lo_suyo` (el cierre). Decisiones del responsable del
2026-11-11.

**Medido abierto antes de tocar nada** (2026-11-11). En producción, con un ensayo terminado en RAISE,
un vínculo de autorizado con todos los permisos a falso simulado dentro y una fila marcada de cada
cosa (en producción ese día no había ningún autorizado, ni firmas, ni recogidas, ni medicación
administrada, ni fotos de DNI): el autorizado leía la fila entera del niño (`notas_admin`, DNI,
observaciones), la firma del tutor legal con su trazo, su IP, su navegador y el DNI de la persona
autorizada, la recogida que creó el tutor legal, la medicación administrada sin permiso médico y la
foto del DNI de recogida (por `storage.objects`; no por la API de Storage, que pasa por la misma
política). En la base efímera del CI, con el `GET` real de `/export/nino/[id]`: el autorizado
exportaba al niño con la nota y el DNI, y descargaba el libro de familia con el enlace que firma el
servicio, aunque su sesión no puede abrir ese bucket. Con el mismo montaje, `/export/usuario/[id]` le
daba 404 (no lee la fila del tutor en `usuarios`), y los DNI de los tutores y de la recogida no
entran en la exportación del niño: van en la del usuario. La causa: las políticas eran `es_tutor_de`
(cualquier vínculo vivo) sin mirar ningún permiso, y `ninos` no tenía permisos por columna.

**Lo que ve cada uno:**

- **`ninos`**: la identidad (nombre, apellidos, fecha, sexo, nacionalidad, lugar de nacimiento,
  idioma, foto…) la sigue leyendo la sesión de cualquiera con acceso al niño. Las 14 de gestión —las
  notas de Dirección, el DNI, las observaciones, la dirección con la provincia, el estado civil, el
  libro de familia, los hermanos y «cómo nos conoció»— solo la Dirección y el tutor legal, por
  `ficha_gestion_ninos`. **La profe tampoco**: que la fila le llegara entera no fue una decisión, era
  la forma de la puerta (las notas, además, «no se comparten con nadie nunca, es como si escribe notas
  en una agenda personal»). Ninguna pantalla de la profe las pedía; su exportación adelgaza.
- **Firmas de autorización (opción b)**: la fila se sigue viendo —quién firmó, qué decidió y cuándo,
  el estado de una autorización—, pero el trazo, la IP, el navegador, el nombre tecleado, el
  comentario y `datos` salen por `contenido_firmas`: quien firmó, el tutor legal, la profe del niño y
  la Dirección. El autorizado, de las firmas de otros, no. El trazo de una firma se copia.
- **Autorizaciones de ámbito niño**: el autorizado ve las suyas (las que creó o firmó: necesita saber
  a qué se ha comprometido) y no las de otros; las de medicación, con `puede_ver_info_medica`.
- **Medicación administrada**: con `puede_ver_info_medica`, como la ficha médica (y la Dirección y la
  profe, como antes). Un dato de salud con permiso y otro sin ninguno era incoherente.
- **Fotos del DNI de recogida**: el tutor legal, o quien subió el fichero (`owner_id`).
- **La exportación del niño** (art. 15): la Dirección, la profe del niño (sin lo de gestión) y el
  tutor legal (`puede_exportar_nino`). El autorizado recibe 404.
- **El alta** (`/alta/[ninoId]`): el autorizado va a su inicio. El alta es del tutor legal.

**El radio**, medido antes de construir: 12 ficheros de la app leían columnas de gestión de `ninos`
(un escáner que se autocomprueba con 9 casos, y a mano los que las nombran por variable) y 5 leían
`datos` de las firmas. En la base, ninguna función de invocador ni política lee esas columnas. Las
dos listas de la app (`COLUMNAS_GESTION_NINO`, `COLUMNAS_CONTENIDO_FIRMA`) se comparan en un test con
las de la migración. Cada columna nueva de `ninos` o de `firmas_autorizacion` necesita su
`GRANT SELECT (columna)` o su sitio en la función.

**ORDEN: mergear la primera → aplicarla → mergear la segunda con la app → esperar el despliegue →
aplicar la segunda.** En una sola migración no había orden sin ventana rota: la app de antes lee las
columnas cerradas con la sesión (la migración antes la rompe), y la app nueva llama a las funciones
nuevas en 16 sitios (antes que la migración, la exportación fallaba para todos, la profe no podía
registrar la medicación y el formulario del alta abría vacío). Partida, la primera solo añade: la app
de antes no la nota (medido: con ella sola en producción, todo lo que cierra la segunda sigue abierto)
y la nueva funciona con ella y la tabla abierta. La segunda exige en su guarda previa la primera
aplicada, con el md5 normalizado de cada función.

- Medido cerrado en producción (ensayo terminado en RAISE, LF y CRLF, 25 medidas), con los controles
  de las guardas: un `GRANT` de más, una política con `es_tutor_de` y un `EXECUTE` para `anon` las
  hacen saltar. Partida, el ensayo en serie (la primera y después la segunda, también la primera en
  CRLF y la segunda en LF) da las mismas 25; la primera sola deja todo abierto; y la guarda previa de
  la segunda salta sin la primera, con un cuerpo cambiado y con `EXECUTE` para `anon`.
- Tests: `src/test/rls/lecturas-por-funcion.rls.test.ts` (la primera),
  `src/test/rls/autorizado-lee-solo-lo-suyo.rls.test.ts`,
  `src/test/i18n/columnas-cerradas-migracion.test.ts` y los unit de `entrada-alta` y
  `campos-ficha-familia`.
- Las tablas de gravedad media y baja (`firmas_documentos_centro`, `acuses_alta`, `matriculas`,
  `confirmaciones_evento`) van en el PR siguiente, medidas abiertas antes igual.

#### Una lectura que falla no se lee como «no hay» (2026-11-11 y 2026-11-12)

Pasar lecturas a funciones abre una pregunta en cada sitio: ¿qué hace la pantalla si la lectura
falla? Donde la respuesta era «como si no hubiera nada», se cambia. **El formulario no guarda lo que
no pudo leer.**

- **El detalle de una autorización** (`getAutorizacionDetalle`): si fallan las firmas o su contenido,
  error. Antes salía sin firmas: una recogida «sin nadie autorizado».
- **La documentación del alta** (`getAltaDocumentacion`): `libroLeido`; la pestaña dice que no se
  pudo leer en vez de «—».
- **La ficha del niño en el alta**: sin la fila o sin la ficha de gestión, la página no pinta el
  asistente. Medido antes: «Guardar» del paso del menor dejaba a null el DNI, las observaciones, la
  dirección y «cómo nos conoció», con el aviso de guardado.
- **La ficha médica en el alta** (`leerInfoMedicaParaEditar`): si no se lee —falla, o se le niega al
  tutor sin `puede_ver_info_medica`—, los dos pasos médicos lo dicen y no guardan; se pueden omitir,
  y el acuse sigue. Medido antes: guardar sin tocar no pisaba (`null` no toca), pero lo tecleado
  sustituía lo guardado y lo borrado lo vaciaba, sobre algo que nadie había visto, con el aviso de
  guardado. El camino sin fallo simulado es el tutor legal sin el permiso: la escritura del tutor solo
  mira `es_tutor_legal_de`. En producción, el 2026-11-12, los 6 vínculos de tutor legal tienen el
  permiso. La ausencia legítima (sin ficha) llega como 0 filas sin error, y entonces se escribe.
- El resto del patrón en la app (el censo: 454 sitios) va aparte.
- Tests: `alta-no-pisa-lo-que-no-leyo.rls.test.ts`, `alta-no-pisa-ficha-medica.rls.test.ts` y el
  bloque «una lectura que falla no se lee como «no hay»» de `autorizado-lee-solo-lo-suyo.rls.test.ts`;
  cada uno afirma la fila guardada, no cómo se evita, con su control sin fallo.

## Fase 6: campos de tutores

### Decisiones (2026-11-12 y 2026-11-13)

- **Lo que se pide de cada tutor.** Teléfono (D14), fecha de nacimiento (D15), número del DNI y,
  si hay segundo tutor, el PDF de su DNI (D12): obligatorios para cerrar el alta, para los dos
  tutores, también si solo hay uno. Dirección de los dos: calle, código postal y ciudad sí; el
  número no («s/n»). Estudios y empresa, voluntarios y marcados así en pantalla. El email y el
  nombre del segundo tutor, obligatorios. «No hay segundo tutor» sigue siendo un clic, sin motivo.
  El teléfono que dejó en la lista de espera rellena el del tutor 1, editable.
- **Validaciones que no dejan fuera a una familia real.** Teléfono internacional (de 6 a 15 cifras,
  con o sin +; uno español sin prefijo también). Número del DNI: cualquier documento de 1 a 40
  caracteres, y la letra solo se comprueba cuando tiene forma de DNI o NIE (como el titular del
  mandato SEPA). Fecha de nacimiento en el pasado y de hace menos de 120 años, **sin mayoría de
  edad**: un padre o una madre menor existe.
- **UNA REGLA.** Mientras el tutor 2 no tiene cuenta, sus datos los gestiona el tutor 1: los escribe
  y los lee (teléfono, fecha de nacimiento, número y foto del DNI). En cuanto acepta la invitación
  y tiene cuenta, el tutor 1 deja de ver todo eso salvo el teléfono, y cada tutor ve los suyos. El
  bucket `dni-tutores` se cierra con la misma regla.
- **Quién ve qué.** El teléfono: la Dirección, los dos tutores y la profe del aula del niño. La
  fecha de nacimiento, el número del DNI, los estudios y la empresa: la Dirección y el propio tutor
  (y el tutor 1 mientras el 2 no tiene cuenta). El autorizado, nada. Una pantalla que no puede leer
  un dato lo dice y no ofrece guardar: nunca un formulario en blanco.
- **La cola de cambios, en la base y por familia** (2026-11-13). Con el alta validada, cualquier
  cambio de un tutor en sus datos va a la cola que aprueba la Dirección: los cinco nuevos igual que
  el nombre, el email, la dirección y el DNI. La Dirección escribe siempre.
- **La profe ve el teléfono** con el botón «Llamar a la familia», junto a «Escribir a la familia» en
  la tarjeta de cada niño de su aula. Los teléfonos se leen al pulsar, no con la lista.
- **El export art. 15** lleva los cinco datos a la fila de su tutor. Los del tutor 2 sin cuenta no van
  en el export del tutor 1: son del tutor 2, y si los pide se los da la Dirección (sujeto `tutor`).
- **Nada es retroactivo.** La Dirección puede rellenar los campos, y el alta en papel cumple lo mismo.
  La base exige los datos de los tutores al cerrar el alta (`marcar_matricula_lista`); los documentos
  y la imagen, en el punto 3.
- **D3 sustituida en la parte del DNI** (ver `alta-tutor-driven.md`). El abogado revisa en F11-B la
  base legal para exigir el DNI: D3 la apoyaba en el consentimiento (art. 7.4).

### Lo que se midió antes (producción, ensayos terminados en RAISE)

- **La tabla estaba abierta por columnas** (paso 1, `20270117120000`): una columna nueva la leían la
  Dirección y los dos tutores, cada uno la del otro. Ahora cada columna nueva nace cerrada.
- **La cola del tutor solo existía en la app.** Con el alta validada, un tutor escribía directo su
  dirección, el nombre del otro tutor aunque tuviera cuenta, el email del titular, y su ruta del DNI.
  La identidad del niño sí la paraba la base desde el 2026-11-08.
- **Por el alta de un hermano sin validar**, la app no encolaba: decidía por niño y los datos son de
  la familia.
- **El tutor 2 abría el PDF del DNI del tutor 1.**
- **La Dirección no podía exportar a un tutor sin cuenta** por ningún camino: no es un usuario, y el
  export del niño no lleva los tutores.

### 6 · La base (`20270118120000`)

- Las cinco columnas, sin `GRANT` a la sesión. CHECK del teléfono, del documento
  (`privado.documento_tutor_valido`), de la fecha (tope fijo; el de 120 años y el «pasado» los aplica
  la función) y del largo de estudios y empresa.
- La escritura del tutor, solo por `guardar_tutor` y `fijar_dni_tutor`: la regla
  (`privado.gestiona_tutor`) y la cola por familia (`privado.familia_alta_validada`, 42501 HINT
  `cola_validacion`). Las políticas de escritura del tutor se van; las de la Dirección se quedan.
- La lectura, por `tutores_de_familia` (con `ve_telefono` y `ve_personales`) y
  `telefonos_familia_de_nino`.
- `dni-tutores`: el tutor abre el PDF de una fila que gestiona, el que dejó en la cola mientras siga
  gestionando la fila, o el que acaba de subir mientras nadie lo apunta (la subida lo relee).
- `marcar_matricula_lista` frena con HINT `datos_tutor_por_completar` (`privado.tutor_completo`).
- La purga (`purgar_sujeto_db`, las dos ramas y su redacción en `audit_log`) y el export
  (`export_datos_sujeto`, más el sujeto `tutor`), regenerados desde su cuerpo vivo con guarda de md5.

## Fase 7: la tarjeta sanitaria

### Decisiones

- **D7 y D8 (2026-10-29), se construyen tal cual:** el número en claro en `ninos`, con los datos del
  niño y **no** en la ficha médica cifrada; la imagen en su propio bucket (`sip-ninos`), con el
  criterio de `dni-tutores`.
- **2026-11-13, del responsable (copiando el criterio del DNI y del teléfono de la fase 6):**
  - **El número es obligatorio para cerrar el alta**, y la base también lo exige. En España la
    tarjeta sanitaria es obligatoria: todo niño la tiene. Obligatorio es **tenerla**, no que sea
    valenciana.
    - _Sustituida el 2026-11-13 por la línea de arriba:_ «no es obligatorio para cerrar el alta: un
      bebé de cuatro meses puede no tener SIP todavía». Se dijo y se corrigió el mismo día, antes de
      construir nada.
  - **Cualquier tarjeta**: de otra comunidad, de una aseguradora privada o de una familia extranjera.
    La forma propia solo se valida cuando parece un SIP valenciano, como la letra del DNI en la fase
    6 (ver «Lo que no se construyó», abajo).
  - **La imagen** la suben la familia o Dirección, después del alta, y **no es obligatoria nunca**.
    Anverso y reverso en un PDF, como el DNI de los tutores.
  - **Quién la ve:** el número, la Dirección, el tutor legal y **la profe del aula** (puede ser ella
    quien lleve al niño al centro de salud); la imagen, no: con el número le basta. El autorizado,
    ni número ni imagen.
  - **Lo demás, como el DNI del niño:** un cambio con el alta validada pasa por la cola, sale en el
    export del art. 15, se purga con el niño, el autorizado no lo ve y no es retroactivo.
  - **Dirección ve quién está sin tarjeta.** Como no es retroactivo, las familias ya matriculadas no
    la tienen y alguien se la tiene que reclamar.
  - **El test de los buckets es más que D8.** D8 pedía comprobar que la purga alcanza los buckets
    nuevos; eso cubre el del SIP y deja el agujero abierto para el siguiente. El test compara la
    lista de la purga con los buckets **que existen**, y se pone rojo con uno que no esté.
- **Para el abogado, sin resolver:** si la Conselleria exige conservar el expediente más allá de la
  baja, eso afecta al expediente entero, no solo al SIP, y es la política de retención pendiente en
  F11-B. Mientras tanto, el SIP se purga con el niño.

### Lo que se midió antes (producción, 2026-11-13, solo lectura y ensayo terminado en RAISE)

- **No había SIP en ningún sitio:** ni columna (tampoco con otro nombre: `sanitari`, `tarjeta`,
  `cip`, `nuss`, `mutua`), ni bucket, ni función. Control: el mismo patrón con `dni` encuentra 3
  columnas y 5 funciones.
- **Un alta se cerraba sin tarjeta:** con los datos del niño, el titular completo y el acuse, la
  tutora y la Dirección cerraban el alta pendiente (id y matrícula en `lista`). Controles: sin acuse,
  42501; sin lugar de nacimiento, `datos_nino_por_completar`.
- **La purga borra los ficheros según una lista escrita a mano** (`FUENTES_ADJUNTOS`) y nada la
  comparaba con los buckets reales: un bucket nuevo sin añadir sobreviviría al olvido sin rojo.
- `ninos` va por columnas: una columna nueva nace cerrada para leer; el UPDATE de la sesión es de
  tabla y solo lo deja pasar `ninos_admin_all` (la Dirección).

### Lo que no se construyó: la forma del SIP valenciano

La tarjeta valenciana trae el «Nº de SIP» y un «DC: dígito de control» aparte
([Conselleria de Sanidad](https://www.san.gva.es/es/web/tarjeta-sanitaria/tarjeta-sanitaria-individual)),
y una fuente secundaria da 7 u 8 cifras para el código autonómico. **El cálculo del dígito de
control no está publicado** (buscado el 2026-11-13). Sin él no hay equivalente a la letra del DNI que
comprobar: validar la longitud dejaría fuera una tarjeta buena y no cazaría una mala. Se acepta la
forma que comparten todas (5 a 30 letras o cifras, sin espacios, puntos, guiones ni barras) y la
comprobación valenciana espera a tener la regla de una fuente oficial.

### 7 · La base, en dos migraciones

**`20270119120000` (aditiva; antes del despliegue):**

- `ninos.sip` (normalizado por `privado.sip_normalizado`; CHECK `ninos_sip_forma`) y
  `ninos.sip_documento_path` (el trigger de rutas la valida como la del libro), sin `GRANT` a la
  sesión.
- `actualizar_identidad_nino_tutor` recibe `p_sip` (último, con DEFAULT) y lo trata como el DNI: con
  el alta validada, un cambio → 42501 `cola_validacion`.
- `fijar_sip_documento_nino`: la imagen, del tutor legal o de la Dirección; con el alta validada, el
  tutor a la cola; la misma ruta no es un cambio.
- `sip_de_ninos`: el número a la Dirección, al tutor legal y a la profe del niño; la ruta, solo a los
  dos primeros (`ve_documento`). El autorizado no recibe filas.
- El bucket `sip-ninos` (privado, PDF, 10 MB) con las políticas de `libro-familia`.
- La cola: el CHECK de la ruta admite `ninos_sip_documento`.
- La purga: `privado.purgar_nino` borra las dos columnas y `_claves_pii_nino` las conoce.

**`20270119130000` (después del despliegue):** `marcar_matricula_lista` añade `sip IS NULL` al bloque
`datos_nino_por_completar`. No es retroactivo.

### Pantallas

- El paso del menor pide el número (obligatorio; «vale la de cualquier comunidad o la de una
  aseguradora»), y el cierre del alta y la vista de avance lo exigen («Datos del niño»).
- La ficha del niño (Dirección y familia): el número y la imagen, que se sube cuando se quiera.
- La profe: «Tarjeta sanitaria» en la tarjeta del niño del aula, junto a «Llamar a la familia» (se
  lee al pulsar).
- «Altas en proceso»: los matriculados sin tarjeta, para reclamarla.
- El catálogo de buckets (`catalogo-buckets.ts`): cada bucket que existe lo borra el olvido o está
  fuera con su motivo y quién lo borra.

## Orden de la serie

Diez fases, en este orden. De la 5 en adelante todas tocan `purgar_sujeto_db`, `privado.purgar_nino`
y la exportación del art. 15 (las funciones de la serie de retención, ADR-0064). Cada PR parte de la
**definición viva** de esas funciones, no de la que haya en esta spec.

| Fase | Pieza                             | Qué hace                                                                        | Estado       |
| ---- | --------------------------------- | ------------------------------------------------------------------------------- | ------------ |
| 1    | SEPA                              | En varios PRs (abajo)                                                           | ✅           |
| 2    | Pantalla de altas en proceso      | Ver «Fase 2: la pantalla de altas en proceso»                                   | ✅           |
| 3    | Documentos del centro versionados | Base: tabla de versiones con hash, firmas con `RESTRICT`, bucket propio         | ✅           |
| 4    | Presupuesto y normas, para firmar | El gate exige la firma de la versión vigente de cada documento obligatorio; P-6 | ✅           |
| 5    | Campos del niño                   | Campos fijos; la configuración por centro, con el segundo centro (P5-7)         | ✅           |
| 6    | Campos de tutores                 | Con el test de la purga contra el catálogo de columnas                          | ✅           |
| 7    | SIP                               | Número en `ninos`, imagen en su bucket                                          | 🔸 en marcha |
| 8    | Servicios en el alta              | La petición de media pensión                                                    |              |
| 9    | Gastos de gestión                 | Paso del alta y confirmación de la directora al validar                         |              |
| 10   | Firma de la ficha                 | Resumen de los datos, hash y firma                                              |              |

Los documentos obligatorios (DNI de los tutores, SEPA, libro de familia) entran dentro de la serie.

### Fase 1, por PRs

| Pieza                                  | Alcance                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Migración                                                                                                        |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Esta spec                              | La primera fuente escrita de la serie                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | No                                                                                                               |
| «Omitir» de verdad (#459)              | El gate de `finalizarAlta` deja de exigir `sepa`, se corrige el texto de la pantalla y se añade el primer test de `finalizarAlta`, con control negativo                                                                                                                                                                                                                                                                                                                                                                                                        | No (`marcar_matricula_lista` no exige mandato)                                                                   |
| El fichero del banco (#461)            | `MndtId` y `EndToEndId` ≤ 35, concepto `centro · niño · mes` sin tildes, el generador rechaza los largos, fixtures con la forma real                                                                                                                                                                                                                                                                                                                                                                                                                           | No                                                                                                               |
| El `MsgId` (#462)                      | Sale de la marca del fichero, no de la hora de la descarga                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | No                                                                                                               |
| La fecha de cobro (#464, #465, #466)   | Ver «La fecha de cobro»                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Sí                                                                                                               |
| Reabrir remesas (#475–#478, #484–#486) | Ver «Reabrir una remesa» y su «Diseño»: recibos enviados a pendiente, remesa a borrador sin la marca, solo la admin, el aviso con familias e importe, su fila en `audit_log`; el fichero de cada versión guardado en privado con su registro y plazo fiscal en el barrido; marcar enviada por función y con el fichero                                                                                                                                                                                                                                         | Sí: la función, el marcador en `remesas_proteger`, las dos tablas, el bucket, el barrido y la clave de la pasada |
| El mandato v2 (#487, #488, #489)       | CID en el PDF y en el texto canónico v2, columna con la versión del canónico (los existentes en v1), NIF y dirección del titular, los tres caminos que crean mandatos (alta, `/family/domiciliacion`, presencial de Dirección) y el aviso en los datos bancarios del centro. Sin CID del centro no se firma ningún mandato (2026-11-04). En tres PRs: la base (#487: las columnas, registrar y sustituir con los datos del v2 y sin CID cerradas, fuera de `audit_log`, en el export, y el CID de prueba de CEI Ejemplo), la app (#488) y sin v1 nuevos (#489) | Sí: `20261229120000` (con la operación del CID de prueba) y `20261230120000`                                     |
| ~~FRST~~                               | **Cancelado el 2026-11-01.** Era FRST en el primer cobro de cada mandato y RCUR en los siguientes. El Rulebook procesa FRST como RCUR (AT-M006): marcarlo no cambia nada en el banco. Se emite RCUR siempre                                                                                                                                                                                                                                                                                                                                                    | No                                                                                                               |

### Fase 2, por PRs

La pantalla (#491), reenviar y cancelar la invitación del segundo tutor (#492), la cola que lo invita
(#493) y la invitación del segundo tutor es de la familia (#494).

### Fase 3, por PRs

3a, documentos y versiones (#496, #497) · 3b, las firmas (#499) · 3c, la pantalla de la admin (#501).

### Fase 4, por PRs

4a, la base (#502) · 4b, la familia firma en el alta (4b-1, 4b-2, 4b-3) · 4c, firmar fuera del alta y lo pendiente en el
inicio de Dirección · 4d, la refirma (#515).

### Fase 5, por PRs

5a, la base (`20270112120000`, #516) · la puerta de identidad (`20270113120000`, #518) · 5b, las
pantallas y lo obligatorio al cerrar el alta (`20270114120000`, #519 y #520) · el autorizado lee solo
lo suyo (`20270115130000`).

## Estado

- [x] Fase 1 · [x] Fase 2 · [x] Fase 3
- [x] Fase 4: [x] 4a (#502) · 4b: [x] 4b-1 (#510) · [x] 4b-2 (#511) · [x] 4b-3 (#513) · [x] 4c (#514) · [x] 4d (#515)
- [x] Fase 5: [x] 5a (#516) · [x] la puerta de identidad (#518) · [x] 5b (#519, #520) · [x] el autorizado lee solo lo suyo (#522, #521)
- [x] Fase 6 (#526) · [ ] Fase 7 · [ ] Fase 8 · [ ] Fase 9 · [ ] Fase 10

## Referencias

- ADR-0049 (F11-G, documentos del alta), ADR-0050 (cuotas, recibos y remesas; acreedor en
  `centros`), ADR-0063 (plan de recibos; FRST fuera, línea 121, que ya decía que RCUR vale en el primer cobro), ADR-0064 (plazos de conservación).
- `docs/follow-ups.md` — «Secuencia SEPA FRST / primera-vez», cancelada el 2026-11-01.
- Código: `src/features/alta/actions/finalizar-alta.ts`, `src/features/alta/components/PasoSepa.tsx`,
  `src/features/alta/lib/mandato-sepa.ts`, `src/features/alta/lib/mandato-pdf.ts`,
  `src/features/remesas/lib/generar-pain008.ts`, `src/features/remesas/lib/preparar-remesa.ts`.
