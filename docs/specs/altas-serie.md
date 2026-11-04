---
feature: altas-serie
wave: 1
status: approved
priority: high
last_updated: 2026-11-04
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

- ~~**FRST en el primer cobro de cada mandato, RCUR en los siguientes.**~~ **REVERTIDA el
  2026-11-01: el 0d no se construye y se emite RCUR siempre, como ya hace la app.** Por qué cayó: «A Collection with the optional transaction type ‘first’ is processed as a recurrent Collection» (SDD Core Rulebook 2025, EPC016-06 v1.0, AT-M006). Si FRST se procesa como RCUR, marcarlo no cambia nada en el banco, y lo que acepta
  cualquier banco, la misma razón multicentro de abajo, es RCUR siempre. Lo que se decidió, tal
  cual: La razón es **multicentro**,
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
    comprobación de la forma española es de la app (0c-2).

Decisiones del 2026-11-04 sobre el 0c, al trazarlo:

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
  de CID. La base comprueba al firmar que son los del centro. Es un añadido del 0c-1 al trazarlo,
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

> **0c-2 construido el 2026-11-04** (la app; sin migración). Los tres caminos firman el v2: el alta
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

> **0c-3, el 2026-11-04** (decisión del responsable, después del despliegue del 0c-2): la base deja
> de aceptar mandatos v1 nuevos (`20261230120000`). Si la app ya no los crea, nadie tiene por qué
> crearlos por otra vía. Los 3 que había se quedan como están, firmados y con su hash recalculable
> con el texto v1: se revocan al sustituirlos por un v2 y se pueden volver a firmar en su sitio como
> v2; como v1, no. Registrar y sustituir sin los datos del v2 dan `v1_cerrado`, y por la tabla,
> también como `postgres`, el trigger `mandatos_sepa_v1_cerrado` da `v1_solo_existentes`. Detalle
> en `rls-policies.md`.

- **Concepto del adeudo: centro, niño y mes, sin tildes.** Ejemplo: `ANAIA · Lucia Garcia Lopez ·
Octubre 2026`. Sin tildes porque el juego de caracteres de SEPA no las garantiza; máximo 140
  caracteres. Va en el 0b.
  - **Corrección del 2026-10-31 (al construir el 0b):** esta spec decía «cada recibo es de un solo
    niño», y es falso. El recibo es **de la familia** (`recibos.nino_id` es NULL en los 4 de
    producción) y el niño sale de sus líneas; uno de los 4 lleva **dos hermanos**. El 0b pone los
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

> D4 del diagnóstico (las 3 aceptaciones de normas por casilla en CEI Ejemplo) no tuvo respuesta. La
> propuesta era ignorarlas: es un centro de prueba.

## Pendiente de decisión del responsable

P-1 a P-5 se contestaron el 2026-10-31 y están arriba, en SEPA. Quedan:

- **Reabrir remesas:** el alcance está decidido (abajo, «Reabrir una remesa»). Quedan R-1 a R-4,
  las preguntas de su traza.
- **P-6 · Documento obligatorio del centro sin subir** (de D3; se pregunta al llegar al PR-2).
  Ejemplo: el centro ha subido el presupuesto pero no las normas, y una familia llega al final del
  alta. Propuesta: el alta no se puede cerrar y Dirección ve en su inicio qué documento falta.

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
  borrador; la marca del fichero no se quita **para nadie**, tampoco con `service_role`; de una
  remesa enviada o con fichero no entra ni sale ningún recibo. El congelado de los recibos sí deja
  `enviado_banco → pendiente_procesar` (solo prohíbe volver a `borrador`).
- **Permisos:** crear, descargar y marcar enviada es `es_admin` (la admin y las directoras).
  `dar_deuda_por_perdida` es `privado.es_titular`: la admin del centro, sin la directora ni el
  superusuario.
- **El `MsgId` cambiaba en cada descarga** (llevaba la hora: `NIDO-{remesa}-{AAAAMMDDhhmmss}`). Dos
  descargas de la misma remesa eran dos ficheros distintos para el banco, y su control de ficheros
  repetidos (que mira el `MsgId`) no paraba el segundo. Pasaba sin reabrir nada: quien descargaba
  dos veces y subía los dos cobraba dos veces. El `EndToEndId` de cada adeudo es estable (el id del
  recibo; desde el 0b, sin guiones), pero no todos los bancos rechazan por él. **Arreglado aparte,
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

### Cruce con el FRST (0d): ya no hay cruce

**El 0d se canceló el 2026-11-01** (ver «Decisiones del 2026-10-31», la de FRST, revertida). Reabrir
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
el centro ponga sus datos bancarios (el aviso del 0c), y lo dirá. El punto 7 impide que se repita.

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
  en una red imaginaria: el esquema procesa FRST como RCUR y no rechaza un segundo. El 0d se canceló
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
> - **la marca solo la pone el registro del fichero**, para todos (trigger y marcador
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
  el fichero (422). El aviso de los datos bancarios es del 0c.
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
> `recibos_dinero_solo_por_funcion` (BEFORE INSERT OR UPDATE OF estado, de invocador, para todos).
> `marcar_remesa_enviada` pasa ahora los recibos del fichero uno a uno, cada uno con el marcador
> `app.marcar_recibo_enviado` = su id (el patrón de la casa: el marcador es el id de la fila). Con
> un marcador por remesa, los recibos enviados fuera de toda remesa que preparan los tests no se
> podían preparar como la función. El ensayo en producción comprobó primero que las 18 vías del
> censo estaban abiertas, y lo estaban todas.

> **C y D construidos el 2026-11-03** (`20261223120000`, cuarto PR de reabrir remesas). Decidido ese
> día por el responsable: **C y D valen para todos, también service_role**. Para D, la razón no es
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
> - **Una remesa enviada no vuelve a borrador por fuera, para nadie:** `remesas_proteger` dejaba
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
> se borra (soft delete) un borrador que nunca tuvo fichero, para todos, también service_role. El
> DELETE no cambia: el rollback de `crearRemesa`, la destrucción fiscal y el borrado de un centro
> siguen pasando, medidos uno a uno.

**Sin FRST.** El 0d está cancelado (R-2, revisada): el fichero de cada versión va en RCUR. No se
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
  0c; el 0d se canceló). Ver «La fecha de cobro», abajo.

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
  secuencia es siempre RCUR (el 0d se canceló), así que no parte bloques.

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
la R-2 se revisa (al reabrir no se vuelve a FRST) y el 0d se cancela.

## La pantalla de altas en proceso

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
- **La invitación es de la familia** aunque cuelgue de un niño: al aceptarla, el segundo tutor queda
  vinculado a todos los hijos. Por eso el reenvío y la cancelación —del botón y de la cola— limpian
  las invitaciones a otros emails y sus cuentas provisionales en **todos los hermanos**, no solo en
  el niño por el que se entra, y si un hermano ya tiene la invitación al email actual se reenvía esa
  en vez de abrir otra. Medido en producción el 2026-11-04: ninguna familia tenía invitaciones del
  segundo tutor en dos hijos, y la cola estaba vacía; hasta este PR, el botón limpiaba solo el niño
  de su fila.
- Sin migración: usa `cancelar_invitacion_tutor2` (`20261231120000`) una vez por hermano.

## Orden de la serie

Del 3 en adelante todos tocan `purgar_sujeto_db`, `privado.purgar_nino` y la exportación del
art. 15 (las funciones de la serie de retención, ADR-0064). Cada PR parte de la **definición viva**
de esas funciones, no de la que haya en esta spec.

| #   | Pieza                             | Qué hace                                                                        |
| --- | --------------------------------- | ------------------------------------------------------------------------------- |
| 0   | SEPA                              | Se trocea en varios PRs (abajo)                                                 |
| ·   | Pantalla de altas en proceso      | Va justo después del PR-0, antes del 1 (2026-11-04). Ver su sección             |
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

Orden: 0·doc y 0a → 0b → `MsgId` (R-3) → fecha de cobro (F1 → F2 → F3) → reabrir remesas → 0c. El 0d se
canceló el 2026-11-01 (FRST se procesa como RCUR).

| PR              | Alcance                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Migración                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 0·doc           | Esta spec                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | No                                                                                                               |
| 0a              | «Omitir» de verdad: el gate de `finalizarAlta` deja de exigir `sepa`, se corrige el texto de la pantalla y se añade el primer test de `finalizarAlta`, con control negativo                                                                                                                                                                                                                                                                                                                                                                                                     | No (`marcar_matricula_lista` no exige mandato)                                                                   |
| 0b              | El fichero que acepta el banco: `MndtId` y `EndToEndId` ≤ 35, concepto `centro · niño · mes` sin tildes, el generador rechaza los largos, fixtures con la forma real                                                                                                                                                                                                                                                                                                                                                                                                            | No                                                                                                               |
| 0c              | Mandato v2: CID en el PDF y en el texto canónico v2, columna con la versión del canónico (los existentes en v1), NIF y dirección del titular, los tres caminos que crean mandatos (alta, `/family/domiciliacion`, presencial de Dirección) y el aviso en los datos bancarios del centro. Sin CID del centro no se firma ningún mandato (2026-11-04). En dos: **0c-1**, la base (las columnas, registrar y sustituir con los datos del v2 y sin CID cerradas, fuera de `audit_log`, en el export) y el CID de prueba de CEI Ejemplo; **0c-2**, la app; y **0c-3**, sin v1 nuevos | Sí, en el 0c-1 (`20261229120000`), y la operación del CID de prueba; y en el 0c-3 (`20261230120000`)             |
| Reabrir remesas | Ver «Reabrir una remesa» y su «Diseño»: recibos enviados a pendiente, remesa a borrador sin la marca, solo la admin, el aviso con familias e importe, su fila en `audit_log`; el fichero de cada versión guardado en privado con su registro y plazo fiscal en el barrido; marcar enviada por función y con el fichero                                                                                                                                                                                                                                                          | Sí: la función, el marcador en `remesas_proteger`, las dos tablas, el bucket, el barrido y la clave de la pasada |
| ~~0d~~          | **Cancelado el 2026-11-01.** Era FRST en el primer cobro de cada mandato y RCUR en los siguientes. El Rulebook procesa FRST como RCUR (AT-M006): marcarlo no cambia nada en el banco. Se emite RCUR siempre                                                                                                                                                                                                                                                                                                                                                                     | No                                                                                                               |

## Estado

- [x] 0·doc — esta spec.
- [x] 0a (#459) · [x] 0b (#461) · [x] `MsgId` (#462) · fecha de cobro: [x] F1 (#464) · [x] F2 (#465) · [x] F3 (#466) · [x] reabrir remesas · 0c: [x] 0c-1 (#487) · [x] 0c-2 (#488) · [x] 0c-3 (#489) · ~~0d~~ (cancelado)
- [ ] Pantalla de altas en proceso (este PR) · [ ] 1 · [ ] 2 · [ ] 3 · [ ] 4 · [ ] 5 · [ ] 6 · [ ] 7 · [ ] 8

## Referencias

- ADR-0049 (F11-G, documentos del alta), ADR-0050 (cuotas, recibos y remesas; acreedor en
  `centros`), ADR-0063 (plan de recibos; FRST fuera, línea 121, que ya decía que RCUR vale en el primer cobro), ADR-0064 (plazos de conservación).
- `docs/follow-ups.md` — «Secuencia SEPA FRST / primera-vez», cancelada el 2026-11-01.
- Código: `src/features/alta/actions/finalizar-alta.ts`, `src/features/alta/components/PasoSepa.tsx`,
  `src/features/alta/lib/mandato-sepa.ts`, `src/features/alta/lib/mandato-pdf.ts`,
  `src/features/remesas/lib/generar-pain008.ts`, `src/features/remesas/lib/preparar-remesa.ts`.
