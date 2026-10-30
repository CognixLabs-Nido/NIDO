# ADR-0064: Los plazos de conservación: cuánto vive cada dato y qué pasa al vencer

## Estado

`accepted`

**Fecha:** 2026-10-29
**Autores:** responsable + claude-code
**Fase del proyecto:** F11-B, punto 6 (#435–#446)

## Contexto

Hasta el 2026-10-27, lo único con plazo en NIDO era el barrido de retención de F11-A6: los DNI de las recogidas, las fotos del niño de baja, las altas abandonadas y el registro de lecturas de la ficha médica. Todo lo demás se guardaba sin fin:

- **El expediente del niño**, indefinidamente tras la baja. Va contra el art. 5.1.e RGPD (limitación del plazo de conservación).
- **La operativa del día a día** (agenda, asistencia, mensajes, citas, informes), sin plazo. Además, el olvido no la alcanzaba.
- **`audit_log`**, que guarda una copia entera de cada fila borrada (`valores_antes`). Al borrar una tabla por plazo, su copia en `audit_log` se habría quedado años.
- **Lo que se conserva por obligación** (recibos, mandatos, firmas), visible en la app después del olvido. Y nada lo destruía al vencer.

El responsable decidió los plazos el 2026-10-27, sobre el diagnóstico del punto 6. **Son provisionales: los fija el responsable, no un abogado todavía** (PENDIENTE política F11-B). La tabla vive en `docs/specs/retencion-plazos.md`, y un test la ata a las constantes de `src/features/retencion/types.ts`.

## Opciones consideradas

### Opción A: dejarlo como estaba

**Pros:** sin trabajo, y nada se destruye por error.

**Contras:** incumple el art. 5.1.e con datos de menores. Con el primer centro real, cada año añade un curso entero de datos que nadie necesita.

### Opción B: anonimizar todo al vencer un plazo único

Un solo plazo por sujeto y, al vencer, la misma anonimización del olvido para todo.

**Pros:** un único mecanismo, ya construido.

**Contras:**

- Hay datos que **no se pueden anonimizar**. Los recibos sostienen la contabilidad y la declaración de gastos de guardería; el mandato es la prueba ante una devolución; la firma prueba quién autorizó qué. Todos necesitan la identidad.
- Otros datos **no tienen por qué esperar** un plazo largo: la agenda de hace dos cursos o un prospecto descartado.
- Un plazo único no distingue la obligación fiscal (6 años) de la operativa (1 año).

### Opción C: un criterio por tipo de dato, construido en piezas

Cada dato se borra, se anonimiza o se bloquea según su obligación, con su plazo y desde su fecha. Se construye en ocho PRs, cada uno aplicado y verificado antes del siguiente. La destrucción va la última, y lleva el freno delante.

**Pros:**

- cada dato vive lo que su obligación exige, ni más ni menos;
- lo que hay que conservar se guarda entero, pero fuera del uso diario;
- cada pieza se aplica, se verifica en vivo y se puede revertir sola.

**Contras:** muchos PRs en fila, y varios recrean las mismas funciones de purga.

## Decisión

**Se elige la Opción C.** Las decisiones del responsable van marcadas con su fecha en la spec.

### El criterio

- **Hay que conservarlo y la obligación necesita la identidad → bloquear** (art. 32 LOPDGDD). Se guarda tal cual y nadie lo ve en la app. Solo se extrae para un juez, la Administración tributaria o una reclamación, y al vencer el plazo se destruye.
- **Hay que conservarlo, pero la finalidad no necesita a la persona → anonimizar.** Mientras quede algo bloqueado del mismo sujeto, enlazado por sus ids, eso es seudonimizar: sigue siendo dato personal, y va bloqueado y con plazo.
- **No hay obligación → borrar.**
- **Nada vive más en `audit_log` que en su tabla.** Todo borrado por plazo o por olvido se lleva también sus copias. Amplía el principio rector de la auditoría: «nada entra en `audit_log` que la purga RGPD no sepa limpiar».

### Los plazos

Son provisionales. La tabla completa está en la spec.

- **Fiscal** (recibos, remesas, mandatos y becas): **6 años** desde el último recibo pagado de la familia.
- **Firmas, consentimientos, acuses y medicación administrada**: **5 años** desde la baja del niño.
- **Expediente del niño**: **5 años** desde la baja. Lo ve Dirección, salvo la ficha médica, que se bloquea al terminar el curso de la baja.
- **Cuenta del tutor**: **5 años** desde la baja de su último hijo en el centro.
- **Operativa**: **1 año** desde el final del curso en que se escribió.
- **Lista de espera** que no llegó a alta: **1 año**.
- **`audit_log`**: **5 años**.
- **Registro de lecturas de la ficha médica**: **60 meses**.
- **El alta que no se termina**: a los **30 días** se le propone a Dirección.
- **`export_log`**: **5 años** desde cada fila (`20261210120000`).
- **Peticiones de olvido** (`olvido_solicitudes`): **sin plazo** (ver abajo).

### Las peticiones de olvido no caducan, y la cuenta que las pidió se queda (2026-10-30)

Decisión del responsable. Ninguna petición de olvido se borra por tiempo, y cada una sigue
diciendo quién la pidió, quién la retiró y quién la confirmó o la rechazó (`solicitado_por`,
`retirada_por`, `confirmada_por`, `rechazada_por`, claves ajenas a `usuarios`).

La consecuencia es buscada, no un olvido a medias: mientras la petición esté guardada, la fila
de `usuarios` de esas cuentas no se borra (`destruir_cuentas_olvidadas` espera mientras algo la
nombra). Queda **anonimizada**, sin nombre y sin email, por la purga de la cuenta; lo que
conserva es el id, y con él la petición sigue pudiendo responder quién ejerció el derecho y
quién lo resolvió. Se eligió la trazabilidad completa frente a vaciar esas referencias al
destruir la cuenta, que dejaba la petición sin saber de quién era.

### La ficha médica bloqueada se abre a la admin, con motivo (2026-10-30)

Decisión del responsable. Lo bloqueado no se borra: se conserva para poder entregarlo. El art. 32
de la LOPDGDD dice que los datos bloqueados solo se ponen a disposición de **jueces y tribunales,
el Ministerio Fiscal y las Administraciones públicas competentes**, en particular las autoridades
de protección de datos, para exigir las responsabilidades derivadas del tratamiento y solo
mientras duren. Esa es la razón de que exista una puerta, y también su límite.

Hasta `20261211120000` la ficha médica de un niño de baja, bloqueada desde el final del curso de
la baja, no la podía leer nadie durante los años que se conserva: `get_info_medica_emergencia` da
55000 a todos y `ver_datos_bloqueados` solo cubría al niño purgado. Si un juez la pedía, el centro
no podía darla. Ahora `ver_datos_bloqueados` la entrega:

- **solo a la admin** (`privado.es_titular`): ni la directora ni el superusuario;
- **con motivo escrito obligatorio**, de 10 a 1000 caracteres, además del tipo de motivo. El texto
  es lo que permite reconstruir a instancia de quién se abrió; el tipo es lo que ve el interesado
  en su export;
- **solo para leer**: los setters siguen contestando 55000, y un dato bloqueado no se modifica;
- **registrada dos veces**, en la misma transacción que descifra: en `accesos_datos_bloqueados`
  (quién, motivo, apartados) y en `lecturas_ficha_medica` (origen `datos_bloqueados`), que la
  familia ve en el registro de lecturas y en su export.

### El cuadro de conservación del niño (2026-10-30)

Decisión del responsable: la ficha del niño dice la verdad entera, dato por dato y con fecha. La
ficha médica, el día a día, las firmas, el expediente, lo fiscal de la familia y la cuenta de cada
adulto, cada uno con lo que le pasa y cuándo, o con el motivo de que todavía no haya fecha (un
hermano en el centro, dinero pendiente, una retención). Lo calcula `estado_retencion_nino` con
los mismos plazos que el cron, que le pasa la app: cuando el abogado cambie un plazo, cambian a la
vez la purga y lo que se enseña. Una fecha pasada solo se da como hecha si el dato ya no está; si
el plazo venció y sigue ahí, se dice que está pendiente. Lo ve Dirección (son fechas); el camino a
lo bloqueado, solo la admin.

### La deuda dada por perdida (2026-10-30)

Decisión del responsable: «si hay deuda no podemos borrar los datos hasta que se cobre. es
necesario poder justificar todo ante un posible juicio». Un impago bloquea el olvido del tutor, y
la salida es una decisión de la admin, no un plazo: **dar la deuda por perdida y ejecutar el olvido
de quien lo pidió** (`dar_deuda_por_perdida`).

- **Pulsar es renunciar.** La admin da el dinero por perdido y acepta que ya no podrá reclamarlo. El
  aviso lo dice con esas palabras y con el importe delante.
- **La contabilidad no se mueve.** Los recibos llevan la marca (`deuda_perdida_en`,
  `deuda_perdida_por`, la petición), sin cambiar su estado, su importe ni su remesa. El trigger de
  auditoría de `recibos` guarda quién, cuándo y el importe: es la prueba de que lo decidió una
  persona. Una deuda a la que se renunció no entra en una remesa.
- **Los 7 días de gracia se mantienen.** Es una acción irreversible sobre dinero y sobre datos;
  deshacer la confirmación en la gracia devuelve también la deuda.
- **Solo borra a quien lo pidió.** El derecho es de cada persona: el otro tutor, los niños y la
  familia siguen enteros.
- **La etiqueta de la familia se queda, con sus apellidos, mientras exista el recibo.** Si la admin
  da un importe por perdido, Hacienda puede pedirle que justifique esa pérdida durante los plazos
  fiscales, y sin saber de quién era la deuda no se justifica. Lo amparan el art. 17.3.e del RGPD
  (formulación, ejercicio o defensa de reclamaciones) y la obligación fiscal. El mandato SEPA se
  conserva entero como prueba; quitarle el nombre sigue en la lista del abogado (F11-B).
- **Solo la admin** (`privado.es_titular`): dar por perdido un impago es gestión del negocio. La
  directora no ve las peticiones de olvido; el superusuario no tiene el botón.
- **No se puede** con otro bloqueo además de la deuda, con un recibo en borrador (el motor lo
  rehace) ni con uno en una remesa en borrador (el banco lo acabaría cobrando): la línea dice qué
  hacer antes.

### Las piezas

- **PR-1, los plazos** (#435, sin migración). La tabla y sus constantes. El registro de lecturas pasa de 24 a 60 meses.
- **PR-2, borrar sin dejar copia** (`20261129120000`, #436). La función que borra fija `app.borrar_sin_copia = 'on'`. Sin una persona delante, el trigger de auditoría borra entonces las copias de cada fila que se borra (también en cascada) y no escribe la suya; con sesión, un DELETE se audita siempre. Añade el plazo de `audit_log` (`purgar_audit_log`). El borrado de copias va por el índice desde `20261202120000` (#439).
- **PR-3, la lista de espera** (`20261130120000`, #437). Un prospecto sin niño se borra 1 año después del descarte o del final de su curso, lo que pase antes. El que tiene niño sigue al expediente.
- **PR-4, el olvido alcanza la operativa del niño** (`20261201120000`, #438). La purga del niño borra su agenda, asistencias, ausencias, informes, su conversación con la profe, sus citas, recordatorios y respuestas a eventos. Se lleva también sus copias, incluidas las de filas borradas antes. Los eventos de ámbito niño se quedan: de ellos cuelga la autorización firmada.
- **PR-5, la operativa por tiempo** (`20261203120000`, #440). Cada registro vence 1 año después del final del curso en que se escribió (el primero del centro que termina en su fecha o después). Un registro de verano cuenta con el curso siguiente. El volumen se midió en la BD efímera del CI: unas 65 000 filas en 3,3 s.
- **PR-6, el expediente** (`20261204120000`, #441). A los 5 años de la baja, la purga del niño, la misma que la del olvido (`privado.purgar_nino`). La ficha médica se bloquea al terminar el curso de la baja: nadie la lee ni la escribe, la lectura no se registra y no sale el aviso de alergia del aula. Reincorporar al niño la desbloquea.
- **PR-7, el bloqueo** (`20261205120000`, #442). Lo que se conserva tras la purga y no es fiscal queda bloqueado: una política `RESTRICTIVE` por tabla, las primeras de la casa. **Lo fiscal no se oculta ni se modifica**: sin ello un recibo no se justifica ante Hacienda. Solo la titular lo ve, con un motivo escrito, y cada consulta queda en `accesos_datos_bloqueados`. La purga ya no borra el registro de lecturas.
- **PR-8, la destrucción al vencer**, en cuatro piezas:
  1. **La retención por procedimiento abierto** (`20261206120000`, #443): el freno, antes que lo que frena. La destrucción no se deshace, y un requerimiento puede llegar el último mes del plazo. La titular retiene a un niño o a un tutor con motivo, y mientras lo está no se destruye nada suyo. Frena también el olvido que pide el interesado (art. 17.3.e).
  2. **Las firmas y la cuenta del tutor** (`20261207120000`, #444):
     - las firmas se destruyen a los 5 años de la baja del niño, y solo con el niño ya purgado;
     - la cuenta del tutor se purga a los 5 años de la baja de su último hijo si no le queda otro rol vivo en el centro, sin que nadie lo pida. Lo hace la purga del olvido, sobre una petición «del centro, por plazo».
  3. **Lo fiscal** (`20261208120000`, #445): a los 6 años del último recibo pagado se destruye todo lo de la familia, sin copia en `audit_log`; después, la cuenta que ya no tiene nada en ningún centro, de la BD y de Auth. **Mientras haya dinero vivo** (un recibo pendiente con importe, un devuelto sin resolver, un borrador con una deuda o un saldo dentro, dinero a favor sin devolver), **no se destruye nada de la familia**: una denuncia puede tardar. Mientras quede, la cuenta del tutor tampoco se purga.
  4. **El alta que no se termina** (`20261209120000`, #446). Ya no se borra sola: a los 30 días se le propone a Dirección (admin y directoras), que la confirma con un solo botón cuando quiera.
     - Con la invitación sin aceptar, el botón la cancela. Con el alta empezada, la borra.
     - Familia nueva: desaparece todo, también la cuenta de quien entró si no le queda nada.
     - Familia con un hijo anterior: solo el alta.
     - «Enviar una invitación nueva» corrige el email del tutor y se lleva lo del viejo.

### Lo que se repite en todas

- **El cron lista, la función vuelve a mirar.** Cada destrucción tiene una función que lista lo vencido y otra que destruye. La que destruye bloquea el sujeto y vuelve a comprobar el plazo, la retención y el dinero vivo antes de borrar. Todas son solo de `service_role`, con los predicados en `privado`.
- **La simulación** (`RETENCION_DRY_RUN`): cada paso nuevo del barrido cuenta sin borrar. **El olvido a demanda (`purgarVencidos`) no simula nunca**: lo pidió la familia, la titular lo confirmó y ya pasaron los días de gracia, así que no hay nada que verificar antes; la simulación es para los plazos que el centro aplica solo (decisión del responsable, 2026-10-30).
- **Cada pasada deja su fila** en `retencion_pasadas` (`20261213120000`), encuentre algo o no: cuándo, si simuló o borró y el recuento de los doce barridos. Sale también en los logs de Vercel. Hasta entonces no había forma de saberlo desde la base: medido el 2026-10-30, el cron corría cada día a las 03:00 UTC en simulación (la variable no existe en Vercel) y no había borrado nada nunca. Pasar a borrado real es poner `RETENCION_DRY_RUN=false` en Vercel, y la primera pasada se mira en esa tabla.
- **En `barrerRetencion`, primero el registro y luego el borrado**: si la fila de `retencion_ejecuciones` no entra, esa unidad no se borra y se reintenta.
- **Storage antes que la BD.** Las rutas de los documentos salen de la base, la app los borra primero y, si Storage falla, la base no se toca: borrar la fila perdería la ruta.
- **Borrar sin copia exige que no haya una persona delante.** Cuando hay una (el botón del alta), la app comprueba la sesión, llama a una función solo del servidor con el actor, y la base vuelve a mirar quién actúa (`privado.es_direccion`) y qué acción vio.
- **Guardas de md5 normalizado** delante y detrás de cada migración, con sus controles negativos. Cada una se ensayó contra producción por la API y por el SQL Editor, terminando en `RAISE`.
- **Ningún ensayo de volumen contra producción** (`CLAUDE.md`, desde el 2026-10-28). El volumen se mide en la BD efímera del CI.

## Consecuencias

### Positivas

- Cada dato tiene un plazo, una fecha desde la que cuenta y una salida, y lo dice una tabla que un test ata al código.
- Lo que se conserva por obligación está entero, pero fuera de la vista. Quién lo consulta, cuándo y por qué queda registrado, y el interesado lo sabe en su export.
- Un procedimiento abierto frena la destrucción y el olvido, así que el centro no destruye las pruebas de su propio caso.
- Al vencer no quedan esqueletos: ni la familia, ni la cuenta, ni sus copias en `audit_log`.

### Negativas

- **Los plazos no están validados por un abogado.** Si cambian, se cambian la tabla y sus constantes.
- **Un impago que no se resuelve nunca conserva a la familia para siempre.** El tope lo decide el abogado (`follow-ups.md`). _Después (PR-B1, `20261212120000`): lo resuelve el producto, no un plazo: la admin puede dar la deuda por perdida (ver «La deuda dada por perdida» en la Decisión)._
- **El plazo de los registros de derechos** (`export_log`, `olvido_solicitudes`, 5 años) **no está construido**. Hasta que lo esté, la cuenta que pidió ella misma un export o el olvido no se borra nunca (`follow-ups.md`). _Después (PR-A2, `20261210120000`): `export_log` se borra a los 5 años; `olvido_solicitudes` no tiene plazo, y la cuenta que pidió, retiró, confirmó o rechazó un olvido se queda anonimizada en `usuarios` mientras la petición exista. Es una decisión del responsable del 2026-10-30, no un cabo (ver «Las peticiones de olvido no caducan…» en la Decisión)._
- `purgar_esqueleto_huerfano_nino` sigue en la base, pero el barrido ya no la llama. _Después: la retira el PR-A2 (`20261210120000`)._

### Neutras

- `purgar_sujeto_db`, `privado.purgar_nino` y los predicados del olvido se recrearon varias veces en fila. La siguiente migración que los toque parte de la definición viva, con su md5 en la guarda.
- Las listas del barrido que cruzan centros llevan su marca `entre-centros` (23 desde `20261209120000`).

## Plan de implementación

- [x] PR-1 #435 · PR-2 #436 + índice #439 · PR-3 #437 · PR-4 #438 · PR-5 #440 · PR-6 #441 · PR-7 #442
- [x] PR-8: retención #443 · firmas y cuenta #444 · fiscal #445 · alta sin terminar #446
- [x] Las 11 migraciones (`20261129120000`–`20261209120000`), aplicadas y registradas. El 2026-10-29, `20261209120000` verificada en vivo en solo lectura: las 7 funciones con el md5 del fichero, sus permisos y la base en 97 MB.

## Verificación

- **Cada PR con migración tiene su test contra la BD efímera** en `src/test/audit/`, de `retencion-sin-copia.test.ts` (PR-2) a `altas-sin-terminar.test.ts` (PR-8, pieza 4). La lista, con lo que prueba cada uno, está en la spec («Tests requeridos»).
- **`plazos.test.ts`**: cada constante coincide con la tabla de la spec, y no hay constante sin fila.
- **Cada migración, verificada en vivo en solo lectura tras aplicarla**: registro, md5 de las funciones, políticas y permisos.

## Referencias

- Spec: `docs/specs/retencion-plazos.md` (la tabla, el criterio y cada decisión con su fecha).
- ADRs relacionados: ADR-0053 (postura de seguridad), ADR-0059 (el olvido es por centro), ADR-0063 (el plan de recibos: el dinero vivo sale de sus estados).
- `docs/architecture/data-model.md` («Reglas obligatorias») y `docs/architecture/rls-policies.md`: una sección por pieza.
- `docs/follow-ups.md`: lo que queda (F11-B).
