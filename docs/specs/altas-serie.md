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

- **Estados.** La remesa: `borrador` → `enviada` (`marcarRemesaEnviada`, con `fecha_envio_banco`).
  Sus recibos: `pendiente_procesar` → `enviado_banco` al marcarla enviada. Después, un recibo puede
  pasar a `devuelto` y, resuelta la devolución, a `cobrado_manual` (efectivo o transferencia), o
  quedarse `devuelto` con un re-giro (otro recibo) o con la deuda llevada al siguiente.
- **El XML no se guarda** (decisión G1 de ADR-0050): se genera cada vez que se descarga. No hay
  fichero que borrar ni que marcar caducado. Lo único que queda es `fichero_generado_at`, la primera
  vez que salió.
- **Los triggers de `20261120120000` cierran la remesa:** con sesión, una enviada no vuelve a
  borrador; la marca del fichero no se quita **para nadie**, tampoco con `service_role`; de una
  remesa enviada o con fichero no entra ni sale ningún recibo. El congelado de los recibos sí deja
  `enviado_banco → pendiente_procesar` (solo prohíbe volver a `borrador`).
- **Permisos:** crear, descargar y marcar enviada es `es_admin` (la admin y las directoras).
  `dar_deuda_por_perdida` es `privado.es_titular`: la admin del centro, sin la directora ni el
  superusuario.
- **El `MsgId` cambia en cada descarga** (lleva la hora: `NIDO-{remesa}-{AAAAMMDDhhmmss}`). Dos
  descargas de la misma remesa son dos ficheros distintos para el banco, y su control de ficheros
  repetidos (que mira el `MsgId`) no para el segundo. **Esto ya pasa hoy, sin reabrir nada:** quien
  descarga dos veces y sube los dos cobra dos veces. El `EndToEndId` de cada adeudo es estable
  (el id del recibo; desde el 0b, sin guiones), pero no todos los bancos rechazan por él.

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
   - **Enviada sin fichero generado** (el fichero no salió nunca de NIDO): se dice así, y que
     reabrirla no puede cobrar dos veces lo que ningún banco tiene.
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
   - **Hoy** la ruta del XML lo calcula con la hora de la descarga
     (`NIDO-{remesa 8}-{AAAAMMDDhhmmss de now()}`), y `PmtInfId` es el mismo valor. Cada descarga,
     también la de una remesa ya enviada (G1: «regenerable»), da un fichero que el banco no
     reconoce como repetido.
   - **La versión ya existe en la BD:** `fichero_generado_at`, que pone la primera descarga y no
     se quita. El `MsgId` sale de ella (`NIDO-{remesa 8}-{AAAAMMDDhhmmss de fichero_generado_at}`,
     28 caracteres) y no de `now()`: todas las descargas de esa versión dan el mismo `MsgId`.
     `CreDtTm` sigue siendo la hora de la descarga (no lo mira el control de repetidos).
   - **Al reabrir**, la función quita la marca (punto 2); la siguiente descarga pone una nueva y
     con ella sale un `MsgId` nuevo. Es la única forma de tener otro.
   - **La primera descarga** genera, marca y vuelve a generar (`20261120120000`): el `MsgId` se
     calcula con la marca ya puesta, y el primer fichero (el que comprueba que sale) no se sirve.
   - **Una remesa enviada antes de esta pieza** puede no tener marca (la de CEI Ejemplo): sin
     marca no hay versión, y la descarga la pone igual que con una en borrador.
   - Si va solo y antes de reabrir es la R-3.
7. **Marcar enviada exige el fichero generado.** Hoy se puede marcar enviada una remesa cuyo fichero
   no salió nunca: así nació la de CEI Ejemplo (abajo).

### Cruce con el FRST (0d)

El 0d marca el primer cobro de cada mandato como FRST. Al reabrir una remesa, los mandatos cuyo
primer cobro iba en ella **vuelven a estar sin primer cobro**: el fichero nuevo los lleva otra vez
como FRST. Si el banco nunca tuvo el primero, es lo correcto. Si sí lo tuvo, el segundo FRST del
mismo mandato es un error de secuencia que el banco rechaza, y ese rechazo es una red más contra el
doble cobro. La otra opción (dejarlos consumidos y mandar RCUR) cobra sin red si el banco ya tenía el
primero. La marca del FRST va en el 0d; este PR deja escrito qué hace con ella.

### La remesa de CEI Ejemplo (agujero 4)

Medido en producción el 2026-10-31: remesa `146d28b6`, octubre de 2026, **creada y marcada enviada
11 segundos después, sin descargar nunca el fichero** (`fichero_generado_at` NULL), con un recibo de
12,00 € en `enviado_banco` de una familia con mandato activo. El centro no tiene CID, BIC ni IBAN de
acreedor. Con la propuesta **se recupera**: se reabre con el aviso de «el fichero no salió nunca de
NIDO», el recibo vuelve a pendiente y la remesa a borrador. El fichero seguirá sin salir hasta que
el centro ponga sus datos bancarios (el aviso del 0c), y lo dirá. El punto 7 impide que se repita.

### Preguntas al responsable

- **R-1 · ¿Se guarda el fichero que se envió?** Hoy no hay nada que guardar: es la prueba de lo que
  se envió y no existe. El fichero lleva los IBAN en claro, así que guardarlo entero es otra decisión
  de protección de datos (un bucket cifrado o privado, con su plazo). Propuesta: guardar de cada
  versión el `MsgId`, la huella sha256 del fichero, el número de adeudos, el importe y la lista de
  `EndToEndId` con su importe y mandato, sin IBAN. Basta para probar qué se pidió al banco y cuándo.
- **R-2 · ¿Los mandatos vuelven a FRST al reabrir** (arriba)? Propuesta: sí.
- **R-3 · El `MsgId` estable (punto 6)** arregla un doble cobro que ya puede pasar hoy. ¿Va en este
  PR o antes, sola?
- **R-4 · ¿Marcar enviada exige el fichero** (punto 7)?

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

| PR              | Alcance                                                                                                                                                                                                                                                                                 | Migración                                          |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| 0·doc           | Esta spec                                                                                                                                                                                                                                                                               | No                                                 |
| 0a              | «Omitir» de verdad: el gate de `finalizarAlta` deja de exigir `sepa`, se corrige el texto de la pantalla y se añade el primer test de `finalizarAlta`, con control negativo                                                                                                             | No (`marcar_matricula_lista` no exige mandato)     |
| 0b              | El fichero que acepta el banco: `MndtId` y `EndToEndId` ≤ 35, concepto `centro · niño · mes` sin tildes, el generador rechaza los largos, fixtures con la forma real                                                                                                                    | No                                                 |
| 0c              | Mandato v2: CID en el PDF y en el texto canónico v2, columna con la versión del canónico (los existentes en v1), NIF y dirección del titular, los tres caminos que crean mandatos (alta, `/family/domiciliacion`, presencial de Dirección) y el aviso en los datos bancarios del centro | Sí, pequeña                                        |
| Reabrir remesas | Ver «Reabrir una remesa»: recibos enviados a pendiente, remesa a borrador sin la marca, solo la admin, el aviso con familias e importe, su fila en `audit_log`, `MsgId` por versión                                                                                                     | Sí: la función y el marcador en `remesas_proteger` |
| 0d              | FRST en el primer cobro de cada mandato, RCUR en los siguientes, sin FRST repetido                                                                                                                                                                                                      | Sí                                                 |

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
