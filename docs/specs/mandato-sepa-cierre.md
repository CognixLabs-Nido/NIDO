# El mandato SEPA como prueba: el cierre de A

Abierto el 2026-11-17 (`docs/follow-ups.md`, «El PDF del mandato SEPA»). Medido paso a paso el
2026-11-22 (`~/nido-logs/13/sepa/`). Jose, el 2026-11-22: «no dejamos cosas a medias, por lo que es
importante cerrar A y C. Pero debes entender cómo funciona cada cosa para hacerlo». C (los 454 del
censo) va después, con su propio troceo.

## Lo medido (2026-11-22)

- El PDF lo genera el navegador y el servidor solo mira que sea un PDF de menos de 10 MB. El sello
  (`texto_hash`) se calcula sobre los datos del formulario: ni los bytes del PDF ni el trazo entran.
- En el alta, el PDF va a una ruta fija con `upsert`. El tutor lo puede sobrescribir mientras el alta
  no está validada y Dirección siempre; Dirección también lo borra.
- El servidor sube el PDF ANTES de registrar la fila: un intento fallido deja un PDF que no es el del
  mandato activo.
- Volver a firmar con el mismo IBAN reescribe la fila en su sitio. Uno de los 3 mandatos de
  producción se firmó dos veces en 12 segundos y la primera firma no queda en ninguna parte.
- El IBAN, el documento y la dirección del titular van en claro en los bytes del PDF.
- El enlace firmado dura una hora (24 en el export), se genera al pintar la página aunque nadie lo
  abra, y no queda constancia de quién lo abre.
- Los 2 mandatos activos de producción son v1: se firmaron antes de que el PDF llevara el CID del
  centro y el documento y la dirección del titular.
- El export entrega el PDF con el IBAN completo y su propio texto dice «del IBAN, solo los 4 últimos».

## Las decisiones (2026-11-22)

**5 · El otro tutor sigue viendo el mandato entero. Decisión de Jose (opción B).** Literal: «tutor
suele ser padre y madre, por lo que no hay información confidencial para ellos en este aspecto, es su
cuenta». **La condición que la sostiene:** vale porque la cuenta es común. Si algún día hay familias
separadas con cuentas distintas, esta es la decisión que habría que revisar.

Las otras, del responsable, literales:

**1 · Nadie sobrescribe ni borra la prueba.** «Ni el tutor, ni Dirección, nunca. Una firma nueva es
un objeto nuevo, sin upsert y con nombre propio. Esto es lo primero porque es lo que de verdad
convierte el PDF en prueba.»

**2 · El PDF lo genera el servidor y sus bytes entran en el sello.** «Las dos cosas, no una. Que lo
fabrique el móvil y nadie mire lo que pone es lo que permite que el fichero diga algo distinto de lo
registrado. Y no hace falta preguntar al banco para esto: un PDF generado por el servidor desde los
datos sellados es mejor prueba que uno subido en cualquier escenario que el banco pida.»

**3 · Volver a firmar crea un mandato nuevo y conserva el anterior.** «Hoy reescribe la fila y la
firma anterior desaparece, y ya ha pasado con uno de los tres de producción. Una firma no se borra:
eso lo tenemos resuelto desde la fase 3 con los documentos del centro, copia ese criterio.»

**4 · Queda constancia de quién abre el PDF**, «con el mismo mecanismo que lecturas_ficha_medica, y
el enlace pasa a durar segundos en vez de una hora. También en el export, que hoy da 24 horas. Y que
el enlace no se genere al pintar la página si nadie lo pide.»

**6 · Los dos mandatos v1.** «No toques sus datos. Que Dirección los vea marcados como pendientes de
refirmar, como ve quién está sin SIP. Son de prueba, pero el mecanismo tiene que existir para cuando
no lo sean.»

**7 · El registro y el fichero van juntos o no van.** «Si no se puede en una transacción porque
Storage no es transaccional, entonces el fichero se nombra por el sello y solo cuenta el que la fila
referencia.»

**8 · El export dice la verdad de lo que entrega.** «Con la decisión B de Jose el IBAN completo al
tutor está bien, así que lo que hay que corregir es el texto.»

**Método:** «Mide cada una abierta antes de cerrarla, con la plantilla, una sonda una defensa, y el
md5 cuando ensayes. Y dime el orden de aplicación.»

## Las dos del diseño y el huérfano (decididas el 2026-11-22)

**El mandato se va con el alta anulada, y queda constancia.** «Un alta que nunca se activó no generó
ningún recibo, así que ese mandato no cobró nada y es un número de cuenta de una familia que no llegó
a matricularse: guardarlo sería conservar datos bancarios sin ninguna finalidad. Se borra, y el
borrado solo para service_role, como propones. Pero con una condición: QUE QUEDE CONSTANCIA de que
existió y se borró, con la fecha y quién anuló el alta. Si la familia vuelve dentro de un año, o
reclama, tiene que poder saberse que hubo un mandato y que se destruyó al anular, no que nunca
existió.»

_Cómo se cumple (2026-11-22):_ el evento del final de `anular_alta` en `audit_log` lleva de cada
mandato destruido el identificador, los cuatro últimos dígitos del IBAN, el estado, el método y la
fecha de firma, con quién anuló y cuándo. **Sin el apellido de la familia ni el titular:** en
`audit_log` no entra lo que la purga no sabe redactar, y esa familia ya no existe para redactarla. Si
la familia vuelve, se reconoce por los cuatro últimos dígitos y la fecha.

**Sin enlace, como la 10c.** «Si la ruta entrega los bytes, no queda ninguna URL que alguien pueda
reenviar, y además es el precedente de la casa de hace tres días. Copia ese mecanismo entero,
incluida la fila de lectura antes de servir. Y que el export use esa misma ruta: así el mandato y la
ficha firmada se comportan igual y nadie tiene que recordar dos reglas.» Sustituye al «enlace de 30
segundos» del diseño de abajo.

**El huérfano no queda suelto.** «Mete ese bucket en el barrido de huérfanos que ya existe —el que
usamos para los 60 ficheros que limpiamos en la fase de retención— y que el barrido los cuente. Un
huérfano con un IBAN dentro que nadie busca es justo lo que no queremos.»

**El resto del diseño, aprobado**, con el orden: la migración 1 antes del despliegue y la 2 después.

## Medido abierto (2026-11-22, ensayo en producción terminado en RAISE)

`~/nido-logs/13/sepa/abierto/` (predicciones antes; LF y CRLF iguales salvo los uuid de cada pasada):

- **1:** Dirección actualiza, mueve y borra el PDF de un mandato activo (1, 1, 1); `service_role`,
  actualiza y borra (1, 1); el tutor, con el alta validada, no (0), y antes de validar, sí (1). El
  tutor no borra (0). Control: el tutor de otra familia, 0.
- **2 y 7:** el tutor propone un mandato con un sello inventado y la ruta de un fichero que no
  existe, y la base lo guarda («propuesto, objeto existe: false»).
- **3:** con un v2 activo, registrar el mismo IBAN deja las mismas filas y el mismo id, y cambia el
  identificador: la firma anterior desaparece.
- **4:** no hay tabla de lecturas del mandato, y leer el PDF no deja ninguna fila en `audit_log`.

## El diseño (propuesto el 2026-11-22, pendiente de aprobar)

### Migración 1, antes del despliegue (solo añade y no rompe la app de hoy)

- **El sello v3** (decisión 2): `mandatos_sepa` gana `documento_sha256` y `documento_idioma`.
  El texto canónico v3 es el v2 más el sha256 del PDF, el idioma y la versión de la plantilla del
  PDF. Las tres funciones que crean un mandato (`registrar`, `sustituir`, `proponer`) aceptan esos
  datos como parámetros nuevos con DEFAULT, y con ellos la **base recalcula el sello** con el IBAN
  en claro que recibe y rechaza el que no cuadra (principio de la casa: lo que la base puede
  derivar no lo acepta del cliente). También comprueba que la ruta es la que sale del sello y que
  el objeto existe en el bucket, como `registrar_version_documento`.
- **Volver a firmar crea un mandato nuevo** (decisión 3): `registrar_mandato_sepa` con el mismo
  IBAN ya no reescribe la fila activa. Revoca la activa y crea otra, como `sustituir`.
- **Quién abre el PDF** (decisión 4): tabla `lecturas_mandato_sepa`, con el mecanismo de
  `lecturas_ficha_medica`. La escribe `abrir_documento_mandato(mandato, origen)` en la misma
  transacción en la que autoriza: Dirección del centro o un tutor de la familia (decisión 5). Sin
  políticas ni privilegios para las sesiones. La leen Dirección y los tutores de la familia, y
  sale en el export.

### La app (con la migración 1 aplicada)

- **El PDF lo genera el servidor** (decisión 2): el móvil manda los datos y el trazo; el servidor
  genera el identificador, compone el PDF de forma determinista (fecha de creación = la fecha de
  firma, identificador del fichero sacado del sello) y calcula su sha256. Con los mismos datos
  sellados sale el mismo fichero, byte a byte, así que el PDF se puede rehacer y comparar.
- **El fichero se nombra por el sello** (decisión 7): `{centro}/familia/{familia}/mandato-{sello}.pdf`,
  sin `upsert`. Primero se sube y después se registra; si el registro falla, el servidor borra
  ese fichero, que ninguna fila nombra. Si no lo consigue, queda como huérfano y no cuenta, porque
  la fila solo nombra el suyo.
- **El enlace** (decisión 4): ninguna página firma el enlace al pintarse. Un botón lleva a
  `/{locale}/mandato-sepa/{mandato}`, que llama a `abrir_documento_mandato` (deja la lectura) y
  redirige a un enlace firmado de 30 segundos. El export enlaza a esa misma ruta, en vez de dar
  un enlace de 24 horas.
- **Los v1** (decisión 6): Dirección ve en «Altas en proceso», como ve quién está sin tarjeta
  sanitaria, las familias cuyo mandato activo es v1 («pendiente de volver a firmar»). Sus datos no
  se tocan.
- **El export** (decisión 8): el texto dice que el PDF adjunto lleva el IBAN completo.

### Migración 2, después del despliegue (cierra)

- **Nadie sobrescribe ni borra la prueba** (decisión 1):
  - fuera las políticas de UPDATE y DELETE del bucket `mandato-sepa` y la de INSERT por la ruta
    del niño (los mandatos nuevos van por la de la familia);
  - un trigger en `storage.objects`, como `documentos_centro_objeto_defensa`, impide cambiar
    cualquier objeto del bucket, también a `service_role`;
  - borrar un objeto que nombra una fila solo lo puede `service_role`: lo usan la destrucción a
    los 6 años y la anulación del alta sin terminar, que borran el fichero antes que la fila.
- **Una firma no cambia** (decisión 3, el criterio de la fase 3): un trigger en `mandatos_sepa`
  solo deja cambiar el estado, por sus transiciones. Borrar una fila solo se puede con el
  marcador de los borrados por plazo.
- **Un mandato digital nuevo tiene que ser v3**: sin el sha del PDF, las tres funciones lo
  rechazan. El presencial sigue siendo v2: no tiene PDF, la prueba es el papel.

### El orden de aplicación

1. Migración 1, con la app de hoy en producción.
2. Merge y despliegue de la app.
3. Migración 2.

**Por qué en este orden:** al revés, la app de hoy deja de poder volver a firmar (su `upsert` choca
con el trigger) y manda mandatos v2 que la migración 2 rechaza.

## La migración 2 (encargada el 2026-11-22)

Literal: «La 20270203120000 está aplicada y el #543 mergeado. Verifica en producción, solo lectura y
con control positivo, que llegó entera y que el registro tiene la versión. Y a por la migración 2, en
su propio PR, después del despliegue: quitar del bucket las políticas de actualizar y borrar, el
trigger que impide cambiar un PDF del bucket —tampoco a service_role, como el de los documentos del
centro—, el trigger que deja cambiar solo el estado de la fila del mandato, y que ningún mandato
digital nuevo pueda ser v2. Mide abierto cada una antes de cerrarla, una sonda una defensa, y el md5
cuando ensayes. Después borra las ramas sonda/13-\* y el worktree wt-sondas-13. Y cuando esté,
empezamos C: los 454 sitios, con su troceo y buscando las dos formas, el fallo leído como ausencia y
el fallo leído como regla.»

**La migración 1 en producción (2026-11-22, solo lectura, `~/nido-logs/13/m2/verifica/`):** el
registro tiene `20270203120000`; las 10 funciones vivas dan el md5 normalizado de su cuerpo en el
fichero; columnas, CHECK (versión 1, 2 y 3; 14 claves en `retencion_pasadas`), tabla con RLS y sin
políticas, y `zz_centro_coherente`, presentes. Controles positivos, los dos «distinto»: el cuerpo de
`registrar_mandato_sepa` de antes de la migración, y el de `abrir_documento_mandato` con una línea de
lógica añadida.

**El censo antes de medir (2026-11-22, producción, solo lectura):** la fila del mandato ya no la
escribe ninguna sesión ni `service_role` (la tabla solo les da `rxt`): solo funciones. Cambian el
estado `registrar`, `sustituir` y `decidir_mandato_propuesto`; borran `anular_alta` y
`destruir_fiscal_familia`; y `anular_alta` pone `nino_id = NULL` cuando borra un niño cuya familia se
queda (el `nino_id` es informativo). En el bucket hay 3 objetos, los 3 nombrados por un mandato; los
3 mandatos son v1 digitales (2 activos, 1 revocado).

**Medido abierto (2026-11-22, producción, ensayo terminado en RAISE, LF = CRLF,
`~/nido-logs/13/m2/abierto/`):**

- **El bucket:** Dirección actualiza, mueve y borra el PDF de M3 (1, 1, 1); el tutor, antes de
  validar, lo actualiza (1); el tutor legal sube un fichero por la ruta del niño (1); `service_role`
  lo actualiza y lo mueve (1, 1).
- **La fila:** `postgres`, haciendo de una función cualquiera, reescribe el `texto_hash` de un v2
  (1), pasa un revocado a rechazado (1) y borra un mandato sin marcador (1). En un v1, el sello ya
  lo guarda el trigger que hay (`v1_solo_existentes`), y `service_role` ya no escribe la tabla
  (42501): solo la tienen las funciones.
- **El v2 digital:** el tutor propone, registra y sustituye un mandato digital v2 (PASA las tres).

**El diseño (2026-11-22):**

- **El bucket:** fuera `mandato_sepa_update`, `mandato_sepa_update_familia`, `mandato_sepa_delete` y
  `mandato_sepa_insert` (la de la ruta del niño: los mandatos nuevos van por la de la familia).
  Quedan las dos de leer y la de subir por la ruta de la familia.
- **El PDF no cambia** (`privado.mandato_sepa_objeto_defensa`, en `storage.objects`, como
  `documentos_centro_objeto_defensa`): ningún objeto del bucket cambia, para nadie, también
  `service_role` (salvo `updated_at`, `last_accessed_at` y las generadas: la lectura). Un objeto
  que nombra un mandato solo lo borra `service_role`: la anulación del alta y la destrucción
  fiscal borran el fichero antes que la fila, y el huérfano no lo nombra nadie.
- **La fila no cambia salvo el estado** (`privado.mandato_sepa_firma_inmutable`, trigger
  `zz_firma_inmutable`): solo las transiciones que hacen las funciones (`activo → revocado`,
  `propuesto → activo`, `propuesto → rechazado`) y `nino_id` a NULL, que es informativo, no entra
  en el sello y lo pone `anular_alta` al borrar un niño cuya familia se queda. Borrar, solo con el
  marcador de los borrados sin copia (`app.borrar_sin_copia`, sin humano), que ya ponen
  `anular_alta` y `destruir_fiscal_familia`; un borrado en cascada desde el niño o el centro, no.
- **Un digital nuevo es v3** (`privado.mandato_sepa_digital_v3`, trigger `zz_digital_v3`): un
  mandato digital que entra sin ser v3 se rechaza, por cualquier función. El presencial sigue v2.
- **Los nombres `zz_`** hacen que el trigger del v1 dispare antes: en un v1 se sigue leyendo su
  motivo (`v1_solo_existentes`).
