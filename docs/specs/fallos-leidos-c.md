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
