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
