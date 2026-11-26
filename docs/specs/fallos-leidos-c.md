---
feature: fallos-leidos-c
wave: 1
status: in_progress
priority: high
last_updated: 2026-11-23
related_specs: [mandato-sepa-cierre]
---

# Spec — C: un fallo no se lee como «no hay», ni como regla, ni como «ok»

## Resumen

Tres formas del mismo defecto, y las tres se miden abiertas antes de cerrarse:

1. una lectura que falla y se lee como AUSENCIA («no hay comidas apuntadas», «el mes está vacío»);
2. una lectura que falla y se lee como REGLA («el centro no domicilia», «sin plantilla», «come
   sólidos»): no deja hueco visible, deja una explicación creíble;
3. una ESCRITURA que falla y se contesta como éxito, a veces con un comentario que lo justifica
   («el recibo se corregirá al regenerar. No es fatal.»).

El criterio de cierre, el de siempre: si no se pudo leer, la pantalla lo dice y no da el dato por
bueno; si no se pudo escribir, la acción no dice que sí.

## Decisiones del responsable (literales)

### 2026-11-23 · el orden y las dos condiciones del censo

«Y EL CENSO DEL RESTO, para darme el troceo. Con dos condiciones que ya aprendimos y que cambian el
resultado: CUENTA POR HELPER, no por sitio, porque un defecto en un helper se reparte entre todos sus
llamadores sin aparecer como sitio; y BUSCA LAS DOS FORMAS, el fallo leído como ausencia y el fallo
leído como REGLA. La segunda es la peligrosa: un hueco visible levanta sospechas, una explicación
plausible como «lo gestiona el otro tutor» no. Dame el número por grupos y el troceo propuesto antes
de tocar nada de ese tercer punto.»

### 2026-11-23 · la tercera forma

«AÑADE ESA TERCERA FORMA AL CENSO DEL PUNTO 3: escrituras que fallan y devuelven ok, incluidas las
que lo justifican con un comentario. Y esos comentarios son la mejor pista que tienes para
encontrarlas: busca las frases que explican por qué no pasa nada si algo falla —«se corregirá», «ya
quedó guardado», «no es crítico»—, porque cada una marca un sitio donde alguien decidió que un fallo
era aceptable sin medir si lo era. Dime cuántas salen de las tres formas, por separado, cuando tengas
el número.»

### 2026-11-23 · el esquema de hora: se cierra la clase

«El esquema de hora: alinéalo con el del pase de lista, que acepte los dos formatos y recorte, con su
test. «Protegido por coincidencia» es exactamente lo que no dejamos en pie: hoy ninguna ruta le manda
una hora leída de la base, y el día que alguien añada una pantalla que sí, se encontrará el mismo
fallo que ya arreglamos una vez. Cierra la clase, no el caso.»

### 2026-11-23 · los sólidos del pase de comidas van primero

«Y DE LOS DOS HALLAZGOS NUEVOS, EL DEL PASE DE COMIDAS VA CON PRIORIDAD, delante de los duplicados y
del menú: que un niño cuyo «come sólidos» no se puede leer cuente como que SÍ come sólidos no es un
dato mal pintado, es que a un bebé que no puede masticar se le ofrezca comida que no debe. Es la
misma clase de cosa que las alergias borradas, y por eso va primero.
Mídelo abierto como los demás y ciérralo con el criterio de siempre: si no se pudo leer, la pantalla
lo dice y no da el dato por bueno. Y que el valor por defecto, cuando no se sabe, sea el que no hace
daño: «no come sólidos» antes que «sí».»

### 2026-11-23 · «sin plantilla» de la imagen

«El de «sin plantilla» de la imagen es de la forma regla también: anótalo para el censo y ciérralo
con el resto.»

### 2026-11-23 · duplicados: producción antes del índice

«Bien comprobar los duplicados de producción antes de poner el índice único: si ya los hay, el
índice no se crea y te enteras a mitad de la migración.»

### 2026-11-23 · los niños sin datos pedagógicos: ni TRUE ni FALSE

«LO DE LA BASE NO SE ARREGLA PONIENDO FALSE. Tienes razón en que es el mismo defecto dentro de la
base, pero las dos salidas son malas: con TRUE le ofrecemos sólidos a un bebé que no debe masticar, y
con FALSE el niño desaparece del pase de comidas y nadie puede registrar lo que come.
La salida es no inventar el dato en ninguna dirección: que el niño SALGA en el pase marcado como «sin
datos pedagógicos», no como que sí ni como que no, y que la profe vea que falta ese dato antes de
darle de comer. Y que Dirección tenga la lista de los niños sin datos pedagógicos, como tiene la de
los que están sin tarjeta sanitaria, para poder reclamarlos.
Eso sí lleva migración, y va con su medición abierta: hoy los 2 niños sin datos cuentan como que
comen sólidos, y eso es lo que hay que medir antes.»

### 2026-11-23 · la lista de espera

«LA LISTA DE ESPERA: tu propuesta, entera. Reordenar el curso en una sola sentencia, la posición
asignada dentro de la base al crear, y después el índice único. Posiciones duplicadas no son un
detalle: son dos familias convencidas de ser la tercera, y el día que se libere una plaza el centro no
sabe a quién llamar. Y el choque con los invitados que conservan su posición cuéntalo en el PR, porque
es la prueba de que esto ya pasa hoy y no es un riesgo teórico.»

### 2026-11-23 · la imagen

«LA IMAGEN: una por niño y versión del texto, como propones. Es el significado correcto: cinco clics
de la misma versión no son cinco consentimientos, y una versión nueva sí es algo nuevo que la familia
tiene que poder firmar. Y cierra con ella lo que has visto de que un fallo al leer la instancia
existente crea otra: es la misma puerta.»

### 2026-11-23 · getCalendarioMes, al censo

«Y apunta getCalendarioMes para el censo, que un festivo contado como día de clase en el editor del
menú es forma regla de libro.»

### 2026-11-23 · el troceo, y lo que tiene que quedar dicho en los PR

«Los tres PR, tal cual: A sin migración, B los dos índices contra duplicados —que son el mismo tema— y
C los datos pedagógicos con sus pantallas. Y bien que cada uno lleve su medición abierta y su ensayo
propio.
Dos cosas del diseño que están bien resueltas y quiero que queden dichas en los PR:

- Que la función devuelva NULL cuando no hay registro vivo es la representación correcta de «no se
  sabe». Lo importante entonces está en la app: que NULL se pinte como «sin datos pedagógicos» y no se
  colapse a sí o a no en ninguna pantalla. Si alguna lo colapsa, estaríamos otra vez inventando el
  dato, solo que una capa más arriba.
- Que un registro borrado cuente hoy como «sin datos» y la función no los filtre: dilo así en el PR,
  porque es la razón de que 2 de 3 niños estén en este caso y no un número suelto.
  La precisión de la lista de espera es mejor que lo que me contaste antes y la medición que propones es
  la correcta: A(1), B descartado en 2, C(3), reordenas y A y B acaban los dos en 2. Eso demuestra que la
  colisión existe hoy.»

Corrección de los hechos (2026-11-24), dicha al responsable antes de escribirla aquí: los 2 de 3 son
niños SIN NINGUNA fila en `datos_pedagogicos_nino` (la lectura contó `NOT EXISTS` sobre la tabla
entera, sin filtrar `deleted_at`). Comen sólidos por el `COALESCE … TRUE`, no por registros borrados.
Un registro borrado hace hoy lo contrario: como la función no filtra `deleted_at`, sigue contando como
dato. Son dos defectos y el PR C los cuenta por separado.

### 2026-11-24 · el registro borrado también se cierra en el PR C

«Y el segundo defecto se cierra en el mismo PR C: que un registro BORRADO siga contando como dato es
inventar el dato igual que el COALESCE, solo al revés. Un niño al que le borraron los datos
pedagógicos no es un niño con datos antiguos, es un niño sin datos. La función filtra los borrados, y
el PR cuenta los dos defectos por separado con su medición cada uno.»

### 2026-11-24 · el formulario de datos pedagógicos, en blanco (Jose: opción B)

«Jose: opción B. La alimentación y el resto de los datos pedagógicos siguen OPCIONALES, como se decidió
en junio. No los hagas obligatorios.
Pero el formulario sí cambia, y es lo que de verdad arregla esto:

- Fuera las marcas preseleccionadas. Lactancia, esfínteres y alimentación salen EN BLANCO, sin nada
  elegido.
- Si nadie los toca, NO SE GUARDA NADA en esos campos. Guardar solo la hora de la siesta no puede crear
  un registro que diga que el niño come de todo.
- Y la consecuencia encaja con el PR C: queda NULL, la profe ve «sin datos» en el pase de comidas y
  Dirección lo tiene en su lista para reclamarlo.
  UNA COSA QUE QUIERO MEDIDA ANTES DE DARLO POR CERRADO: en producción hay un niño con registro. ¿Sus
  valores son exactamente los tres preseleccionados? Si lo son, no podemos distinguir si esa familia los
  eligió de verdad o si se guardaron solos, y eso hay que decirlo en el PR en vez de darlo por bueno.
  No toques ese registro: no se puede saber cuál es el caso y cambiarlo sería inventar en la otra
  dirección. Lo que sí hace falta es que Dirección pueda verlo y confirmarlo con la familia, con la misma
  lista de los que están sin datos.
  Y apunta para el censo esta forma, que es la cuarta y no la teníamos: un VALOR POR DEFECTO de un
  formulario que se guarda como si alguien lo hubiera elegido. No es un fallo de lectura ni de
  escritura: es un dato inventado en el origen. Busca cuántos formularios más vienen con una opción
  marcada de la que depende algo.»

Medido (2026-11-24, solo lectura, `~/nido-logs/14/c/prod/c4.txt`): la única fila de producción NO tiene
los tres valores preseleccionados (lactancia, esfínteres y alimentación distintos del defecto): alguien
los eligió. Idiomas (`['es']`) y hermanos (`false`) sí coinciden con su defecto: indistinguibles, y no
deciden la comida. El registro no se toca.

### 2026-11-24 · sin lista «a confirmar»; y medir quién lee las tres columnas antes del NOT NULL

«No construyas la lista de «a confirmar»: tu razonamiento la deja sin sentido —0 registros
indistinguibles en los campos que deciden la comida, y con el formulario en blanco no pueden aparecer
más—. La lista de Dirección es la de sin datos pedagógicos, con los tres casos que dices: sin registro,
registro borrado y lactancia vacía.
[…]
UNA MEDIDA ANTES DE QUITAR EL NOT NULL: dime TODO lo que lee esas tres columnas, en la base y en la
app, no solo lo que ya has listado. Pasar tres columnas de NOT NULL a nullable es cambiar un contrato
en el que puede apoyarse algo que no esperamos: otra función, una vista, un informe, el PDF de la
ficha firmada, la purga, la exportación del art. 15. Mídelo y dame el número, como hiciste con los 12
ficheros de ninos.
El check de tipos que montamos en el #523 va a cazar el cambio de nullability, así que eso ya está
cubierto, pero quiero saber qué más lo asume antes de aplicarlo, no después.»

### 2026-11-24 · C, desde main: lo que lleva

«La 20270205120000 está aplicada y el #547 mergeado. Verifícala en producción, solo lectura y con
control positivo. Y saca C de main, sin apilar.
C lleva esto, que ya está todo decidido:

- Las DOS MEDIDAS ABIERTAS POR SEPARADO, cada una con su predicción: un niño sin registro ninguno (hoy
  la función dice que come sólidos) y un niño con registro borrado (hoy decide con el registro
  borrado). Son dos defectos distintos y el PR los cuenta por separado.
- La función devuelve NULL cuando no hay registro vivo o la lactancia está vacía, y filtra los borrados.
- Las tres columnas dejan de ser NOT NULL.
- El formulario sale EN BLANCO, sin nada preseleccionado, y si nadie toca esos tres campos no se guarda
  nada. Siguen siendo OPCIONALES: Jose dijo B y eso no cambia.
- Las cinco cosas que asumen que siempre hay valor: la vista de la familia, que hoy pintaría la clave de
  traducción; el ✓ del avance del alta, que solo aparece con los tres contestados; y el conjunto del
  contrato —formulario, esquema, acción, tipo y la página del alta—.
- En el pase de comidas el niño SALE marcado «sin datos pedagógicos», ni como que sí ni como que no, y
  la profe lo ve antes de darle de comer.
- Dirección tiene la lista de los niños sin datos pedagógicos, con los tres casos: sin registro,
  registro borrado y lactancia vacía.
  Ensayo en producción terminando en RAISE, una sonda una defensa con su arrastre previsto, mide.sh para
  el build, espera-build.sh con su tope, y la predicción de cada ronda nombrando los tests con sus
  cuentas. Dame el md5 cuando ensayes y el orden de aplicación.»

Verificado (2026-11-24, solo lectura, `~/nido-logs/15/c/verif-b/`): 20270205120000 aplicada; los dos
cuerpos vivos son los del fichero con los CRLF del editor (md5 sin CR = el del fichero; control con una
letra cambiada = distinto); restricción, índice, trigger y permisos como en la migración.

### 2026-11-24 · guardar revive el registro borrado

«Que guardar revive el registro borrado. El motivo: hoy una familia rellenaría los tres campos, el
formulario diría que se ha guardado, y el niño seguiría contando como «sin datos» para la profe. Eso es
un formulario que se traga lo que le escribes, y es peor que el defecto que estamos cerrando.
Y revivir es seguro aquí porque lo has medido: ningún código de la app borra en blando esa tabla —las
purgas hacen DELETE—, así que no hay ningún borrado legítimo que estaríamos deshaciendo. Si algún día
existiera uno, esta decisión es la que habría que revisar; déjalo escrito así.
Con su test: guardar sobre una fila borrada a mano la deja viva y la función deja de decir «sin datos».»

**Lo que la sostiene, y cuándo revisarla:** medido el 2026-11-24, nada pone `deleted_at` en
`datos_pedagogicos_nino` (ni la app ni las funciones; las siete purgas y `anular_alta` hacen
`DELETE`). El día que algo la borre en blando, `upsertDatosPedagogicos` desharía ese borrado al
guardar: **esta decisión es la que hay que revisar**. Lo dice también el comentario de la acción.

### 2026-11-25 · el censo: forma 4 en blanco, y el troceo con el pase de curso en el grupo 1

Jose, sobre el biberón: «opción A. El formulario del biberón sale EN BLANCO y la profe elige las tres
cosas cada vez.»

«Y DE AHÍ SALE EL CRITERIO PARA LOS 14, no solo para el biberón: ningún campo del que dependa algo
viene preseleccionado. Aplícalo a los seis del niño —biberón, comida, pañal, recogida y el tipo de
personal en los dos sitios— y a los seis de dinero. El del tipo de personal me importa especialmente:
que venga marcado «profesora» significa que quien invite sin mirar está dando permiso para escribir
informes.
Los 9 que tienen un valor por defecto del que no depende nada, déjalos.
Si al construir alguno resulta que en blanco estorba de verdad en el uso diario, para y dímelo antes
de cambiarlo por tu cuenta.»

«EL TROCEO ME VALE TAL CUAL, con una precisión: el pase de curso sube al grupo 1. Tienes razón en
ordenar por lo irreversible, pero ese es el único que afecta a TODOS los niños del centro de una vez,
y un centro entero dado de baja por un fallo de lectura es de otra magnitud, aunque se pueda revertir
a mano. Que vaya con los borrados.»

«EMPIEZA POR EL GRUPO 1, y dentro de él por lo que no se deshace: las dos purgas, borrarObjetosBucket
y las fotos del blog, lo que la purga deja atrás de las invitaciones, el export del art. 15, y el pase
de curso. Mide cada uno abierto antes de cerrarlo […]. Y dime cuántos PRs te sale el grupo 1: si son
más de dos, prefiero varios cortos que uno que no se pueda leer.»

**El censo** (2026-11-25, sobre main `35792116`, `~/nido-logs/16/c/censo/CENSO.md` y `F4.md`): 298 de
582 helpers con forma 1-3 (niño 70, dinero 28, pantalla 200); forma 4, 14 formularios con una opción
marcada de la que depende algo y 9 con un defecto del que no depende nada.

**Los 12 nombrados, que salen en blanco** (los otros dos del censo —el `borrador.default(false)` de
autorizaciones y el tipo de día del calendario— el criterio «para los 14» los cubre pero no se
nombraron: **preguntado el 2026-11-25, sin tocar hasta la respuesta**): niño — SeccionBiberones, SeccionComidas, SeccionDeposiciones, CrearRecogidaDialog,
InvitarProfeDialog y GestionarPersonalDialog (más sus esquemas: `tomado_completo.default(true)`,
`tipo_personal_aula.default('profesora')`); dinero — ResolverDevolucionDialog, MarcarDevueltoDialog,
MarcarCobradoDialog, ConceptoFormDialog, ReciboEsporadicoDialog, EditarReciboDialog.

**El troceo:** grupo 1 (lo que se borra o no se borra, y el pase de curso) → 2 (el estado del niño) →
3 (salud, recogida y avisos) → 4 (forma 4 del niño) → 5 y 6 (dinero) → 7 y 8 (pantalla).

### 2026-11-25 · grupo 1 en cuatro PR; las fotos del blog, orden invertido

«Los cuatro PR cortos e independientes desde main me valen, y el orden dentro del grupo 1 también.»
(1 · los borrados de Storage; 2 · las dos purgas; 3 · el export del art. 15; 4 · el pase de curso.)

«LO DE LAS FOTOS DEL BLOG TIENE UNA SALIDA MEJOR QUE LAS DOS QUE PLANTEAS, y ya está en la casa:
INVIERTE EL ORDEN. Borra el fichero primero y la fila después, que es lo que ya hacen las purgas
precisamente «para no perder la ruta». Así, si el borrado del fichero falla, la fila sigue ahí con su
ruta y se puede reintentar; nunca llegas al caso de no tener vuelta atrás.
Y como red, lo mismo que hicimos con el mandato: que esos ficheros entren en el barrido de huérfanos
que ya corre a diario. Con el orden invertido y el barrido no necesitas ni reintentos ni maquinaria
nueva.
Donde no se pueda invertir el orden, entonces sí tu propuesta: error específico en vez de ok y las
rutas en el log, pero dime en cuántos sitios no se puede y por qué.»

«revocar-imagen-nino SÍ, en el PR 1 y bien distinguido: no es la limpieza del fichero viejo tras
guardar el nuevo, es que una familia ha RETIRADO el consentimiento y la foto se queda. Eso no es un
fichero huérfano, es seguir teniendo la imagen de un niño cuyos padres han dicho que no. Que no se
trague el fallo, y que Dirección vea que esa foto no se pudo borrar.
Y bien dejar quietos los otros 40 .catch(() => undefined): ahí el fallo solo deja un fichero viejo de
más, que es lo que recoge el barrido.»

### 2026-11-25 · los 200 de pantalla, de una vez: helper, componente, codemod y lint

Jose: «quiero que lo soluciones ya. De una, los 200 sitios. No vayas de uno en uno perdiendo el tiempo.
Haz una solución rápida para todo.»

«1 · UN HELPER ÚNICO de lectura que distinga «no hay» de «no se pudo leer», y un componente común que pinte
eso en pantalla. Una sola pieza, en un sitio.
2 · UN CAMBIO AUTOMÁTICO que lo aplique a los 200. […] Si algún sitio no encaja en el molde, lo apartas a una
lista y me dices cuántos son: esos se ven a mano, el resto van de golpe.
3 · UNA REGLA DE LINT que impida que el patrón vuelva a aparecer, con su control: un sitio nuevo con el patrón
viejo tiene que poner la CI roja.
4 · LA VERIFICACIÓN NO ES POR SITIO, es la suite entera: los 9.500 tests, el typecheck y el build. Y mutaciones
por GRUPOS, no por sitio: una por cada forma de pintar el «no se pudo leer».»

Medido (2026-11-25, `~/nido-logs/16/c/censo/`): 306 sitios en los 200 helpers. Al molde automático, 269 (215
no miran el error; 54 lo miran, lo loguean y devuelven un vacío). Apartados, 37 (16 lecturas de otra forma, 18
escrituras, 3 lecturas consumidas de otro modo). El plan, aprobado: dos PR (A: helper, componente, codemod y
regla de lint con lista blanca temporal; B: los 37 a mano, vaciando la lista blanca). «Y la pieza que lo hace
seguro es la que no te pedí: que el codemod se compruebe a sí mismo quitando lo que insertó y exigiendo que el
árbol quede idéntico.»

**Página entera o sección.** Medido: de 160 llamadas a esos helpers desde pantallas, 144 (en 53 ficheros) están
en la cabecera de la página y 16 (en 9 componentes) dentro de un componente que pinta una sola sección; el
`error.tsx` de una sección no captura lo de su propio layout. Jose, literal:

«MANTENGO LA DECISIÓN: 13 FICHEROS A MANO […] 13 ficheros a mano no es ir uno por uno, es el 6% de los 200. El
resto va mecánico.

- Los 16 de los 9 componentes, por sección y con el codemod.
- Los 7 layouts, por sección y a mano. Obligatorio.
- Las 6 pantallas diarias —pase de lista, pase de comidas, agenda del aula, ficha del niño, mensajes y la
  conversación—, por sección y a mano. Son 24 lecturas y son justo las que la profe y la familia abren todos
  los días: que se caigan por una lectura secundaria sería cambiar un defecto silencioso por una pantalla que no
  se puede usar.
- Todo lo demás, regla general: la página dice «no se ha podido leer».»

«en el cuerpo del PR A que quede escrito por qué 13 ficheros van a mano y los demás no.»

**El cruce del lint con el censo (2026-11-25).** El lint completo, tras el codemod, ve 241 sitios en 94 ficheros
(la lista blanca temporal). De ellos, 20 sitios en 17 ficheros el censo los dio por NO_DEFECTO; leídos uno a
uno: 3 son falso positivo del lint (`leer-panel-becas`, el error se mira en un bucle sobre la lista), 1 es un
hueco del censo (`asegurarAgenda`: la profe lee «Ya no puedes editar este día» cuando no se pudo leer; el
clasificador lo escribió y lo dejó en NO_DEFECTO) y 16 son los dos a la vez (el lint mira la forma; el censo,
el daño de hoy: 4 helpers sin llamadores, 5 que para un UNIQUE de la base, 7 que fallan con un mensaje que
nombra el síntoma). De las tres pantallas diarias que van por la regla general (pase de lista, pase de comidas,
conversación), Jose:

«Bien el razonamiento de las tres pantallas: si la única lectura que toca el codemod es la principal, no hay
nada secundario que aislar y la regla general es la correcta. Eso en el cuerpo del PR, con esa frase.»

Jose, literal:

«En el PR A. Es la pantalla que la profe usa todos los días para escribir lo que ha pasado, y el efecto es que
le dice «Ya no puedes editar este día» cuando lo que ha pasado es que no se pudo leer. […] Que el helper y sus
5 llamadores distingan «no se pudo leer» de «fuera de la ventana de edición».»

«Los 16 a PR B mecánicamente y los 4 helpers muertos borrados: de acuerdo […] el daño ausente por casualidad
vuelve el día que alguien toca la otra punta. Y el falso positivo del lint, arreglado con su caso en la regla.»

«Lo del segundo motivo falso de asegurarAgenda —que cualquier error de insert diga «Ya no puedes editar este
día»— entra en el mismo arreglo, de acuerdo.»

**Regla (Jose, 2026-11-25): CUANDO SE UNIFICA UN CRITERIO A MITAD DE UNA CLASIFICACIÓN, HAY QUE VOLVER A PASAR
LO YA CLASIFICADO CON EL CRITERIO NUEVO.** Aquí: el criterio «para con un motivo falso = F2» se unificó al
juntar las tandas y no se aplicó a las 201 filas NO_DEFECTO. Buscar la redacción en esas 201 dio 1 (es un
suelo: caza al clasificador que lo escribió, no al que lo vio y no lo escribió). «La re-clasificación de las
201 va DESPUÉS del PR A […] Lo que salga de ahí entra en el PR B, que viene pegado detrás.»

**El defecto inverso que trae el PR A (2026-11-25).** El codemod hace lanzar a 132 helpers; 33 acciones los
llaman directo (más por cadena, p. ej. `esAdminEn` → `leerCentrosDe`), contra la convención «Server Actions:
patrón Result, nunca `throw` visible al cliente». Y en sitios donde la lectura va DESPUÉS de una escritura
hecha, la parada informa como fallida una escritura que sí ocurrió (6 medidos dentro de una función:
activar-matricula, invitar-admin, actualizar-nino-tutor, vincular-hijo-tutor-existente, la ruta del avatar; y
por helper, el correo de invitación en send-invitation y crear-centro). Jose, literal:

«Lo que has encontrado es que nuestro arreglo introduce el defecto inverso: una escritura que SÍ ocurrió
informada como fallida. Y eso es peor que lo que arreglábamos, porque quien reintente puede duplicar una
invitación o un centro, y porque una directora a la que la pantalla le dice que el alta no se validó cuando
sí, va a validarla otra vez.»

«1 · MENSAJE VISIBLE, el tuyo: «Guardado; no se ha podido enviar el aviso o el correo». […] Un log en Sentry lo
ve quien mira Sentry, y ella no lo mira. Con eso puede reenviarlo, que es justo lo que no puede hacer hoy.»

«2 · LA FRONTERA ÚNICA PARA LAS ACCIONES, sí, con su regla de lint. Pero que quede claro que eso resuelve la
mitad: convertir el throw en un fail evita el spinner colgado, y NO evita que la pantalla diga «no se guardó»
después de haber guardado. Lo segundo solo se arregla sitio por sitio, no poniendo una frontera.»

«3 · Y EL 6 ES UN SUELO, QUE NO ME VALE. […] que el escaneo siga la cadena de llamadas, no solo el cuerpo de la
función, y dame el NÚMERO, no un suelo. […] Y que el lint cubra la clase, no los casos: una parada por lectura
fallida después de una escritura en la misma acción tiene que poner la CI roja.»

**El número (2026-11-25).** El escáner de cadena (`cadena.cjs`: checker de TypeScript, grafo de llamadas, RPC
volátil de producción = escribe, un `catch` que devuelve `fail` = parada) da 28 entradas, revisadas a mano: 13
reales desde 6 sitios raíz (el correo de invitación tras escribir la invitación: 7 acciones; `invitarAdmin`;
`activarMatricula`; la aceptación de una invitación de profe, que se salta el rollback de la cuenta: 2; la firma
del enlace tras guardar la foto: 2 rutas), 3 de ficheros huérfanos sin cambio en la base (libro de familia, DNI
de recogida, avatar: los recoge el barrido del #549) y 12 falsos positivos. Jose, literal:

«Las tres: la regla de ESLint para el caso de la misma función, el escáner de cadena como paso de CI esperando 0
reales, y los 15 en una lista con su motivo escrito que solo puede encoger. […] Una condición del paso de CI:
que vaya como job propio, en paralelo con los shards, no en serie. Si añade hasta 25 minutos a cada PR encima
de los que ya tarda, lo vamos a acabar odiando y alguien lo quitará.»

**Regla (Jose, 2026-11-25): «¿ESTE ARREGLO CONVIERTE EN FALLO ALGO QUE HOY FUNCIONA?»** El diseño primero de
`asegurarAgenda` («una lectura fallida para») habría convertido en un «no» un guardado que hoy funciona (la
lectura falla, el día no tiene agenda, el insert entra); lo cazó la predicción escrita antes de medir. Los 13
son lo mismo a otra escala. «Antes de hacer que algo pare, comprobar qué hace hoy cuando la lectura falla, no
qué debería hacer.» Entra en el molde del codemod y de los arreglos a mano: una parada nueva se mide contra lo
que el código hace hoy con esa lectura fallida, y no va después de una escritura hecha (el escáner de cadena en
la CI). «Bien que el arreglo final intente el insert igualmente y solo diga «fuera de ventana» con un 42501: eso
es parar por lo que la base dice, no por lo que suponíamos.»

**El proxy (2026-11-25).** `rolesEnCualquierCentro` (la puerta de `/admin`, `/teacher`…) lanza con la lectura
caída; en el proxy no la recoge ningún `error.tsx` y sale un 500 crudo (antes, `/forbidden`: «no tienes permiso»
a quien lo tiene). Jose, literal:

«La (b). Un 500 crudo no le dice nada a nadie y además parece que la app está caída, y el «/forbidden» de antes
era peor todavía: le decía a una directora que no tiene permiso cuando sí lo tiene. Una página que dice «no se
ha podido leer, vuelve a intentarlo» es lo único honesto de las tres.

La condición, porque la página va a ser pública: que no revele NADA. Ni si el usuario existe, ni si tiene
roles, ni el nombre del centro, ni nada que dependa de quién entra. El mismo texto para todo el mundo, sin
datos dentro, y sin dar acceso a ninguna parte. Con eso una página pública no aporta superficie.»

Y del escáner: «que el escáner enseñe TODAS las paradas de cada función, no solo la primera, porque si no el
número que da vuelve a ser un suelo sin que lo sepamos.»

### 2026-11-26 · la re-clasificación de las 201, y las dos clases que no veía ningún instrumento

Resultado (`~/nido-logs/16/c/reclas/RESULTADO-201.md`): 185 propagan con motivo verdadero, 9 sin efecto, 2
arregladas en el PR A, 3 paran con un motivo falso (ficha de gestión y tarjeta sanitaria → «no tienes
permiso»; el curso destino del paso de curso → «no encontrado») y 2 F2 (el detalle de un evento sin
«confirmar asistencia»; «cómo nos conociste»). Y dos clases que ni el censo ni el lint veían: el helper que
avisa del fallo (`leidos`, `null`/`undefined`) con llamadores que no lo usan, y el helper que devuelve el
constructor de la consulta sin `await`. Uno de los llamadores de la primera, `invitarTutor2AlValidar`, hace
falsa una afirmación del cuerpo del PR A: `activarMatricula` no avisa si la invitación no sale. Jose, literal:

«Los 5 defectos y las dos clases nuevas van al PR B, y las dos soluciones que propones son las correctas: un
tipo que no deje usar los tutores sin mirar `leidos` es estructura, no una regla que haya que recordar.

PERO LA SEGUNDA CLASE ESTÁ MEDIDA CON UNA REGEX Y ES UN SUELO, Y ESO NO ME VALE AQUÍ. Un helper que devuelve
el constructor de la consulta sin await es invisible para el censo Y para el lint, así que no tenemos ni idea
de cuántos hay, y uno de los tres que has encontrado se salta la comprobación de «ya existe» en una carga de
beca. Eso es dinero.
Mídelo con el compilador, como hiciste con el escáner de cadena: un helper cuyo tipo de retorno sea el
constructor, y los sitios que hacen await sobre él. Dame el número exacto con sus huecos declarados, no un
suelo. Y si al medirlo bien salen más sitios de dinero, me lo dices antes de seguir.

Y LA PRIMERA CLASE ES PEOR DE LO QUE PARECE, por el motivo que tú mismo das: el escáner marcó ese helper como
OK porque SÍ comprueba el error, y nunca llegó al clasificador. O sea que nuestro instrumento mira si el
helper se entera del fallo, no si el llamador hace algo con esa información. Censa esa clase también con el
compilador: helpers que informan del fallo —con un flag, con null o con undefined— y llamadores que no lo
usan. Que el número salga del tipo, no de una lista de nombres.

Y bien dicho lo de tu afirmación falsa del PR A: que activarMatricula no avisa cuando la invitación no sale,
porque invitarTutor2AlValidar dice «no hacía falta». Corrígelo en B y que el cuerpo del B lo diga, que el A
ya está mergeado y su descripción se queda como está.
El encabezado de roles-del-usuario, al barrido del B.»

### 2026-11-26 · la clase 2, medida con el compilador; aprobarCambio necesita diseño

Medido (`scripts/ci/fallo-que-se-pierde.cjs`, `~/nido-logs/16/c/reclas/CLASE2-BUILDER.md`): 8 helpers, 17
sitios, 9 miran el error, 8 no, 0 llamadas sin resolver; una función anónima de la clase, leída a mano
(mira). De los 8, el de dinero que no estaba en la lista: `aprobarCambio` → `revertir()`, cuyo resultado se
tira; si aplicar falla y deshacer también, el cambio queda «aprobado» sin aplicar y sale de la cola. Jose,
literal:

«Y aprobarCambio es el hallazgo, y NO se arregla comprobando el error. Lo que has descrito es un estado que no
debería existir: un cambio marcado «aprobado» que no se aplicó, fuera de la cola y sin forma de reintentarlo.
Comprobar el error te dice que pasó; lo que hace falta es decidir dónde queda ese cambio.
La salida es que NUNCA SALGA DE LA COLA SI NO SE APLICÓ: si aplicar falla, el cambio se queda pendiente; si
además falla el deshacer, se queda pendiente y marcado como «falló al aplicar», con lo que pasó, para que
Dirección lo vea y lo reintente. Lo que no puede es desaparecer. Y que Dirección lo tenga en su lista, como
los que están sin tarjeta sanitaria.
Mídelo abierto antes: monta el doble fallo y enséñame en qué estado queda el cambio hoy.

La clase 1 con el mismo escáner, sí, adelante.

Y una cosa de tamaño: el PR B ya lleva los 66 apartados, los 16, los 5 de la re-clasificación, estos 8 y lo
que salga de la clase 1. Si al juntarlo no se puede leer, PÁRTELO EN DOS: lo mecánico por un lado y lo que
necesita diseño —aprobarCambio y el rollback de la cuenta nueva— por otro. Dímelo tú si hace falta; no quiero
un PR que nadie pueda revisar, pero tampoco cinco.»

### 2026-11-26 · la clase 1 medida, el PR B en dos, y recalcularTotal adelantado a B1

Medido (`~/nido-logs/16/c/reclas/CLASE1-AVISO.md`): 316 helpers avisan del fallo, 464 sitios; los 77 que el
escáner no resolvió, leídos uno a uno: 14 defectos (9 nuevos: los 4 llamadores que no leen `leidos`, las 3
«altas sin terminar» con `?? []`, la publicación en lote que cuenta un fallo como «faltan ítems» y el borrado de
limpieza del blog). **Límite conocido del escáner, escrito para que el próximo no los cuente como defectos:** 7
sitios que el escáner da por «no usa» porque `!x` junta el fallo (`null`) con «no le toca» (`undefined`) son
correctos, porque para Dirección `ficha_gestion_ninos` y `sip_de_ninos` contestan siempre y «no le toca» no
puede darse (gate-alta 89/90, aplicar.ts 119, campos-ficha-familia 46, alta/[ninoId] 149 y 444,
admin/ninos/[id] 113). _(Corregido el 2026-11-26, al escribir el cuerpo de B1: son 6, no 7. La
444 de alta/[ninoId] era `esFamiliaNuevaEnCentro`, que no es un `!x`: es la re-clasificación 161, decidida
abajo como degradación deliberada. Las 6 y la 161 están en `scripts/ci/fallo-que-se-pierde.lista.json`, cada
una con su motivo.)_ El doble fallo de `aprobarCambio`, medido abierto (run 45785330097): la fila queda
`aprobado`, fuera de la cola, y Dirección lee el mismo «no se pudo aplicar» que con un fallo solo. Jose, literal:

«Sí, adelántalo. recalcularTotal es el único de todo esto que ESCRIBE un importe equivocado: un recibo con
líneas que se queda en 0 € y además responde ok. Todo lo demás de este tramo son mensajes falsos o pantallas
raras; esto es dinero escrito mal, y no espera a los grupos 5 y 6.
Que entre en B1 con su medición abierta y su control: hoy escribe 0 con el recibo lleno, y después no escribe
nada y lo dice.

La partición B1 mecánico y B2 de diseño me vale tal cual, y el reparto también. aprobarCambio con su migración
en B2, y el rollback de la cuenta nueva con él.

La medición de la clase 1 está bien hecha, y lo que la hace creíble es que declares los 77 que el escáner no
pudo resolver y los leyeras uno a uno, en vez de contarlos como buenos. Y los 7 que el escáner marcaba «no usa»
y resultaron correctos porque para Dirección ese caso no puede darse: bien dejarlo escrito como límite conocido
del instrumento, que es lo que evita que el próximo los cuente como defectos.

Adelante con B1.»

### 2026-11-26 · recalcularTotal: ¿cómo se pone al día? (Jose, literal)

«El arreglo es el correcto: no escribir el total cuando no se pudo leer, y decirlo en vez de responder ok.
Pero el aviso dice «el que ves no está al día», y eso deja una pregunta que hay que resolver en el mismo PR:
¿CÓMO SE PONE AL DÍA? Si Dirección no tiene forma de volver a recalcularlo, ese recibo se queda con un total
desfasado para siempre y el aviso solo le dice que tiene un problema sin salida.
Mira si ya existe algo que lo recalcule —regenerar el mes, confirmar el recibo, lo que sea— y si existe, que el
aviso lo diga. Si no existe, hace falta la forma de reintentarlo, y entonces dime si eso cabe en B1 o se va a B2
con lo de diseño.
Y de paso: un recibo con el total desfasado, ¿se puede confirmar y acabar en una remesa? Porque si se puede,
ahí sí se cobraría un importe equivocado, y eso cambia la prioridad.»

Leído en el código (rama fix/c-pantalla-b sobre main 1a84aac6), pendiente de su decisión:

- Lo que ya recalcula: volver a guardar cualquier línea de ese recibo, y regenerar / recalcular el mes
  (`generar_recibos_mes`, que reescribe el total de TODOS los borradores regulares del mes con la suma de sus
  líneas). Solo se editan líneas de borradores regulares (lineas-recibo.ts:309), así que los dos caminos cubren
  todo recibo que pueda quedar desfasado. Confirmar NO recalcula (`confirmar_recibo`, 20261223120000).
- Sí se puede confirmar y acabar en una remesa: `confirmar_recibo` no mira las líneas, la remesa cobra
  `total_centimos` (get-recibos-sepa-remesables, preparar-remesa) y `marcar_remesa_enviada` compara el fichero
  con `total_centimos`, no con las líneas. Hoy el 0 se queda FUERA de la remesa (`total_centimos > 0`); con el
  arreglo tal cual, el total desfasado es > 0 y entra: el arreglo solo convierte «no se cobra» en «se cobra mal»
  si el aviso se pierde.

### 2026-11-26 · El bloqueo de confirmar_recibo, en B1 (Jose, literal)

«1 · EL BLOQUEO DE confirmar_recibo VA EN B1, contigo. Tu propio argumento lo decide: sin él, el arreglo de
recalcularTotal es peor que no arreglar, y mandarlo a B2 abre una ventana en la que se cobra mal. Que B1 lleve
una migración no es un problema: «mecánico» era una descripción de lo que había dentro, no una regla.
Con su guarda de md5, su ensayo terminado en RAISE y su control negativo: un recibo con el total desfasado no se
confirma y lo dice con el HINT.
Y mídelo abierto antes: hoy ese recibo se confirma y entra en la remesa, y quiero el número y el camino copiados
del log.

2 · EL AVISO NOMBRA LOS DOS CAMINOS: volver a guardar una línea o recalcular el mes. Un aviso que dice que algo
no está al día sin decir cómo ponerlo al día es dejar a la directora con un problema y sin salida.

Y LA ALTERNATIVA DE FONDO ANÓTALA COMO LA BUENA, aunque no sea ahora: que la base mantenga el total con un
trigger sobre las líneas hace desaparecer la clase entera —ni relectura, ni segunda escritura, ni avisos—.
Déjalo escrito así, con lo que haría falta leer antes (las funciones que insertan la cabecera con su total),
para que cuando alguien lo retome no empiece de cero. No lo hagas ahora.»

### La solución buena, para después: el total lo mantiene la base (NO se hace ahora)

Un trigger `AFTER INSERT OR UPDATE OF importe_centimos OR DELETE` sobre `lineas_recibo` que reescriba
`recibos.total_centimos` con la suma de las líneas del recibo, en la misma transacción. Hace desaparecer la clase
entera: la app no relee las líneas, no hay segunda escritura que pueda fallar, no hay aviso, y un total no puede
quedar desfasado. `recalcularTotal` y su aviso se borran, y el bloqueo de `confirmar_recibo` queda como red.
Antes de escribirlo hay que leer, desde su definición VIVA, cada función que escribe `total_centimos` o inserta
una cabecera con su total antes (o sin) sus líneas, y decidir en cada una si el total es siempre la suma:

- `generar_recibos_mes` (última: 20270121120000): pone el total al final del bucle y en el barrido final; con el
  trigger sería redundante, y hay que medir el coste de un UPDATE por línea en la regeneración de un mes entero.
- el cargo puntual (`anadir_cargo_puntual`, 20261116120000:178), que crea el borrador con su total.
- la devolución (`resolver_devolucion`, 20261118120000:143-174): el re-giro nace con `total_centimos` del original
  más gastos, y una línea «Re-giro de recibo devuelto»; y la línea de arrastre al recibo del mes siguiente.
- `crear_recibo_esporadico`, el cheque (`cobrar_recibo_con_cheque`, la diferencia; `resolver_sobrante_cheque`,
  la línea negativa), `anular_alta` (20270203120000:672, que ya recalcula) y la facturación desde la
  incorporación (20270120130000:228 y 577).
- Los recibos que no son borrador: las líneas de un recibo confirmado o enviado no se tocan (freeze por estado),
  pero el trigger no debe intentar reescribir el total de un recibo en `enviado_banco` (lo protege
  `recibos_dinero_solo_por_funcion` solo por estado; el total no). Hay que decidir qué hace con ellos.
- Los datos: antes de aplicarlo, contar en producción los recibos cuyo total ya no es la suma de sus líneas
  (de cualquier estado), porque el trigger los dejaría como están hasta que se toque una línea.

### «Cómo nos has conocido» con la lectura caída: no se pregunta (reclasificación 161, 2026-11-26)

Decisión del 2026-11-26, literal: «La (a). «Cómo nos has conocido» es una pregunta opcional de marketing: no
preguntarla no cuesta nada, y preguntarla por si acaso significa molestar con ella a una familia que ya está en
el centro, que es justo lo que decidió Jose que no pasara. Documentada como degradación deliberada, con el
motivo, y no la toques.»

`esFamiliaNuevaEnCentro` (src/features/alta/queries/familia-nueva-en-centro.ts) devuelve `null` si no puede
contar, y la página del alta no pregunta. Es una degradación DELIBERADA, no un F1: lo que se pierde es una
respuesta opcional de marketing; lo que se evitaría preguntando «por si acaso» es justo lo que se decidió el
2026-11-10 que no pasara (preguntarla a una familia que ya está en el centro). No se cambia.

### 2026-11-26 · los 228 de la lista blanca, por áreas (Jose, literal)

«Y el detalle que más me ha gustado del mensaje es el del lint: que la regla ponga rojo también cuando un
fichero tiene MENOS sitios que su número, diciendo a cuánto bajarlo. Eso es lo que impide que la whitelist se
quede alta y esconda los nuevos detrás del hueco que deja lo arreglado. Sin eso, el contador habría sido una
puerta abierta con el tiempo.
Y bien medir la whitelist de verdad —228 contra los 237 que permitía— en vez de fiarte del número que había.

Adelante con los 228 por áreas. Y cuando el PR esté entero, dame el md5 de la 20270208120000 y le paso a Jose
el merge.»

Hecho en B1: los 228, por áreas, con su mutación por área; la lista blanca de `nido/lectura-mira-el-error`
queda vacía y se borra, y la regla reporta todo lo que ve. Lo que la regla no ve (su cabecera lo declara) lo
cubre el escáner `fallo-que-se-pierde`, ahora paso propio de la CI con su lista
(`scripts/ci/fallo-que-se-pierde.lista.json`), que tiene la misma propiedad que la de arriba: rojo con uno
más, y rojo con uno menos («la lista solo encoge»).

## Orden de trabajo (de las decisiones de arriba)

1. Sólidos del pase de comidas (forma regla; valor por defecto «no come sólidos»).
2. Dinero: recibo con línea manual; cambio de método (lectura y escritura, la tercera forma).
3. SEPA silencioso del alta (forma regla).
4. Pase de comidas (lo apuntado) y menú del mes (forma ausencia), por helper.
5. Duplicados: lista de espera e imagen; lectura de producción antes de la migración del índice.
6. Esquema de hora de agenda, citas y eventos: el del pase de lista (los dos formatos, recorta).
7. «Sin plantilla» de la imagen: con el resto, y contado en el censo como forma regla.
8. Censo del resto por helper, las tres formas por separado; número y troceo antes de tocar nada.

## Hecho

### Los sólidos (2026-11-23)

- Medido abierto (run 45202220193, sin arreglo): con `nino_toma_comida_solida` fallando, el bebé de
  biberón salía en el pase de los dos helpers y nada lo decía («expected [ …(2) ] to not include» y
  «expected [] …»).
- Arreglo: en los dos helpers del pase (`getPaseDeListaComidaTodosMomentos` y `getPaseDeListaComida`,
  este sin llamador en la app hoy), un fallo de esa llamada cuenta como «no come sólidos» y el niño
  va a `sinComprobarSolidos`. La pantalla lo nombra (`aviso-sin-comprobar-solidos`), también cuando
  la lista se queda vacía: ahí no dice «ningún niño come sólidos».
- Tests: `src/test/rls/solidos-no-se-suponen.rls.test.ts` (página real) y
  `src/features/menus/__tests__/solidos-no-se-suponen.test.tsx` (unidad, para mutar). Cuatro
  mutaciones, cada una un rojo en el test previsto.
- **Pendiente de decisión (no tocado):** la función SQL `nino_toma_comida_solida` devuelve `TRUE` a un
  niño SIN fila de datos pedagógicos («COALESCE de seguridad»): la misma regla, en la base. En
  producción (2026-11-23, solo lectura) son 2 de los 3 niños con matrícula activa. Cambiarlo es una
  migración y saca del pase a todo niño sin esos datos. Tampoco filtra `deleted_at` de esa tabla.
  _Decidido el 2026-11-23 y 2026-11-24 (arriba: «ni TRUE ni FALSE», «el registro borrado…», «C, desde
  main») y cerrado en el PR C: la función devuelve NULL y el pase SACA al niño marcado, no lo quita._

### La hora (2026-11-23)

- Medido abierto (unidad, contra los esquemas de HEAD): sueño, citas y eventos rechazaban una hora
  'HH:MM:SS'; el test de la clase nombraba 4 ficheros con su propia regex.
- Arreglo: `src/shared/lib/hora.ts`, un solo esquema (las dos formas, deja 'HH:MM'); los cuatro lo
  importan. `src/shared/lib/__tests__/hora.test.ts` se pone rojo si otro fichero de `src` valida una
  hora con su regex (mutación: eventos con la suya → 2 rojos, el de eventos y el de la clase).

### El dinero (2026-11-23)

- Medido abierto (run 45200099198): «el método del recibo: expected 'transferencia' to be 'efectivo'»
  (recibo con línea manual) y lo mismo en el cambio de método, con la lectura del recibo fallando y
  con su UPDATE fallando (la tercera forma). Sonda sin arreglo para `mes_cerrado` (run 45261410542):
  «no dice que sí: expected true to be false».
- Arreglo: `crearReciboConLineaManual` falla si no lee la excepción del mes o `mes_cerrado`.
  `setMetodoPagoFamilia` lee el recibo antes de escribir nada, y si el UPDATE del borrador falla
  contesta `metodo_recibo_sin_cambiar` (sale el comentario «se corregirá al regenerar. No es fatal.»).
  La lectura de `yaExiste` no se toca: si falla y el recibo existe, el UNIQUE devuelve 23505 →
  `recibo_ya_existe` (garantía de la base).
- Mutaciones (unidad): quitar el `return` de la lectura → 1 rojo; volver al comentario → 1 rojo.

### El SEPA del alta (2026-11-23)

- Medido abierto (run 45204687262, con el rol del tutor): «el centro tiene CID: expected false to be
  true». Arreglo: si la página no lee el centro, lanza, como sus otras lecturas.

### El pase de comidas y el menú del mes (2026-11-23)

- Pase, abierto: «expected 'todo' to be 'poco'». Por helper: las 8 lecturas de los dos helpers lanzan
  si fallan (9 de 9 con la de sólidos). Unidad contra HEAD: 14 rojos, uno por lectura y helper.
- Menú, abierto: los 5 platos a `null`. `getPlantillaMes` lanza en vez de `null` (404) o `menus: []`.
- Medido cerrado: run 45262811042, solo los duplicados en rojo (van al PR B).

### Los duplicados, PR B (2026-11-24)

- Medido abierto (run 45370448276, sin migración ni arreglo): reordenar [C, A] con B descartado en 2
  («posiciones: A=2, B=2, C=1: expected 2 to be 3»), sin concurrencia ninguna; cinco altas a la vez
  («posiciones: 1,1,1,1,1»); cinco «crear imagen» a la vez («expected 5 to be 1»).
- En producción (2026-11-24, solo lectura): el único curso con lista tiene invitados en 1, 4 y 5 y
  descartados en 2 y 3. Un arrastre con el código de antes numeraba los invitados 1, 2, 3 y pisaba a
  los descartados: la colisión estaba a un arrastre.
- Migración `20270205120000_fix_sin_duplicados`: la posición la pone un trigger con cerrojo por curso;
  `reordenar_lista_espera` numera el curso entero en una sentencia (descartados detrás) y rechaza un
  orden desfasado (`orden_desfasado`); restricción única `DEFERRABLE` (curso, posición); índice único
  de imagen (niño, versión del texto) sobre las publicadas. Aborta antes si hay duplicados de partida.
- App: `crearProspecto` ya no calcula la posición; `reordenarListaEspera` llama a la función y el
  panel recarga si falla; `crearImagenAutorizacion` falla en cada lectura que falla (antes: «no eres
  tutor», «sin plantilla», o creaba otra instancia) y ante un 23505 devuelve la que quedó.
- Ensayo en producción (`~/nido-logs/14/c/duplicados/ensayo`, terminado en RAISE): todo como predicho
  en la 2.ª corrida; la 1.ª no midió la imagen (el montaje no llevaba plantilla).

### 2026-11-24 · el PR C no se apila

«Y para C, que también la ibas a apilar: no la apiles sobre B. Sácala de main en cuanto B esté dentro,
que acabamos de ver lo que cuesta el apilado con squash.» (B se rebasó sobre main tras el squash de A:
árbol idéntico al de antes, migración con el mismo md5.)
