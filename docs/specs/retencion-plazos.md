---
feature: retencion-plazos
wave: 1
status: approved
priority: high
last_updated: 2026-10-29
related_adrs: [ADR-0053, ADR-0059]
related_specs: [proteccion-datos, olvido-peticiones, ficha-medica-lecturas]
---

# Spec — Plazos de conservación y alcance del olvido

## Resumen ejecutivo

Cuánto se conserva cada dato, desde cuándo cuenta y qué se hace al vencer o al ejercer el olvido:
borrar, anonimizar o bloquear. **Todos los plazos son PROVISIONALES (PENDIENTE política F11-B):
los fija el responsable, no el abogado todavía.** Si el abogado los cambia, se cambia la tabla de
abajo y las constantes que la siguen.

## Contexto

F11-B, punto 6. Hasta ahora el expediente del niño se guardaba indefinidamente tras la baja (contra
el art. 5.1.e RGPD), la operativa del día a día (agenda, mensajes, asistencia…) no tenía plazo y el
olvido no la alcanzaba, y lo que se conserva por obligación (recibos, mandatos, firmas) seguía
visible en la app después del olvido. El barrido de retención solo borraba objetos de Storage
(DNIs de recogida, fotos), las altas abandonadas y el registro de lecturas de la ficha.

Decisiones del responsable (2026-10-27), sobre el diagnóstico del punto 6.

## Criterio: borrar, anonimizar o bloquear

- **Hay que conservarlo y la obligación necesita la identidad → bloquear** (art. 32 LOPDGDD): se
  guarda tal cual, nadie lo ve en la app, solo se extrae para un juez, la Administración tributaria
  o una reclamación, y al vencer el plazo se destruye. Anonimizar no cumple: lo que se pide es de
  quién es (los recibos sostienen la contabilidad y la declaración de gastos de guardería; el
  mandato, la prueba ante una devolución; la firma, quién autorizó qué).
- **Hay que conservarlo pero la finalidad no necesita a la persona → anonimizar.** Mientras quede
  algo bloqueado del mismo sujeto, enlazado por sus ids, eso es seudonimizar: sigue siendo dato
  personal y va bloqueado y con plazo.
- **No hay obligación → borrar.**

## Principio: nada vive más en `audit_log` que en su tabla

Borrar una fila de una tabla auditada deja en `audit_log` una copia entera de cómo estaba
(`valores_antes` del DELETE). Si el plazo de una tabla vence y su copia sigue 5 años en
`audit_log`, el plazo no se cumple. Todo borrado por plazo o por olvido se lleva también sus copias
en `audit_log`: las anteriores y la que escribe el propio borrado. Amplía el principio rector («nada
entra en `audit_log` que la purga RGPD no sepa limpiar»).

Cómo (PR-2, `20261129120000`): la función que borra fija `app.borrar_sin_copia = 'on'`, y el
trigger de auditoría, sin humano, borra las copias de cada fila que se borra (también en cascada) y
no escribe la suya. Un DELETE con sesión se audita siempre.

## Plazos

La tabla la lee `src/features/retencion/__tests__/plazos.test.ts`: cada constante de
`src/features/retencion/types.ts` tiene que estar aquí con este valor, y cada constante `RETENCION_*`
o `GRACIA_*` del fichero tiene que estar aquí.

| Constante                               | Valor | Qué                                                                                                                                                                      | Desde                                                  | Al vencer                                                                                                                          |
| --------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `RETENCION_FISCAL_ANIOS`                | 6     | `recibos`, `lineas_recibo`, `remesas`, `recibos_remesa`, `parte_servicio_diario`, `asignacion_concepto`, `beca_comedor_*`                                                | el último recibo pagado de la familia                  | destruir; bloqueado desde el olvido                                                                                                |
| `RETENCION_MANDATOS_SEPA_ANIOS`         | 6     | `mandatos_sepa` y su documento                                                                                                                                           | el último recibo pagado de la familia                  | destruir; bloqueado desde el olvido                                                                                                |
| `RETENCION_FIRMAS_ANIOS`                | 5     | `firmas_autorizacion`, autorizaciones de un niño, `consentimientos`, `acuses_alta`, `administraciones_medicacion`, eventos de ámbito niño                                | la baja del niño                                       | destruir, con el niño ya purgado; bloqueado desde el olvido                                                                        |
| `RETENCION_CUENTA_TUTOR_ANIOS`          | 5     | la cuenta de un tutor o un autorizado en el centro, y los consentimientos de la cuenta                                                                                   | la baja de su último hijo allí                         | la purga del olvido, por una petición «por plazo», si no le queda otro rol vivo allí                                               |
| `RETENCION_EXPEDIENTE_ANIOS`            | 5     | el niño: ficha, ficha médica, datos pedagógicos, matrículas, vínculos, invitaciones, `rollover_finaliza`                                                                 | la baja del niño                                       | la purga del niño, como la del olvido. Hasta entonces lo ve Dirección, salvo la ficha médica, bloqueada pasado el curso de la baja |
| `RETENCION_OPERATIVA_ANIOS`             | 1     | agenda y sus cuatro tablas, `asistencias`, `ausencias`, `informes_evolucion`, conversaciones y mensajes, citas y sus invitados, `recordatorios`, `confirmaciones_evento` | el final del curso                                     | borrar                                                                                                                             |
| `RETENCION_LISTA_ESPERA_ANIOS`          | 1     | `lista_espera` que no llegó a alta                                                                                                                                       | que deja de estar viva                                 | borrar. La que llegó a alta sigue al expediente                                                                                    |
| `RETENCION_AUDIT_LOG_ANIOS`             | 5     | `audit_log`                                                                                                                                                              | la fecha de cada fila                                  | borrar; y antes, con su tabla, por el principio de arriba                                                                          |
| `RETENCION_REGISTROS_DERECHOS_ANIOS`    | 5     | `export_log`, `olvido_solicitudes`                                                                                                                                       | la fecha de cada fila                                  | borrar                                                                                                                             |
| `RETENCION_LECTURAS_FICHA_MEDICA_MESES` | 60    | `lecturas_ficha_medica`                                                                                                                                                  | la fecha de cada lectura                               | borrar. Con el olvido se conserva, bloqueado                                                                                       |
| `RETENCION_RECOGIDA_PUNTUAL_DIAS`       | 7     | DNI de una recogida puntual (Storage)                                                                                                                                    | que caduca                                             | borrar (sin cambios)                                                                                                               |
| `RETENCION_RECOGIDA_HABITUAL_MESES`     | 12    | DNI de una recogida habitual (Storage)                                                                                                                                   | la baja                                                | borrar (sin cambios)                                                                                                               |
| `RETENCION_FOTOS_MESES`                 | 12    | fotos del niño, de la ficha y del blog (Storage)                                                                                                                         | la baja de la matrícula                                | borrar (sin cambios)                                                                                                               |
| `GRACIA_ESQUELETO_DIAS`                 | 30    | el alta sin terminar (la invitación sin aceptar, o aceptada y el alta a medias)                                                                                          | que caduca o se cancela la invitación, o que se aceptó | proponer a Dirección, que confirma (20261209120000)                                                                                |

Notas:

- **Recibos, de 4 a 6 años:** el art. 30 del Código de Comercio da 6 años a los justificantes
  contables; más seguro conservar de más. Si el abogado lo baja, se baja.
- **Medicación administrada, con las firmas (5 años):** es la prueba del centro ante una
  reclamación por una reacción, y son datos de salud de menores.
- **«El último recibo pagado de la familia»:** por familia, no por recibo (confirmado por el
  responsable, 2026-10-28). Mientras la familia sigue pagando se conserva su histórico entero; el
  plazo empieza en el último recibo pagado, cobrado a mano (en efectivo, por transferencia, con
  cheque) o enviado al banco, da igual el método (2026-10-29). **Mientras quede algo pendiente no se
  destruye nada de la familia**: un recibo pendiente de procesar o un devuelto sin resolver la
  conserva entera, porque una denuncia puede tardar (2026-10-29). También un borrador que lleva
  dentro una deuda o un saldo (una devolución llevada al mes siguiente, el sobrante de un cheque
  diferido) y el dinero a favor de la familia sin devolver (un exceso de beca, una transferencia
  pendiente). Un borrador sin nada de eso no cuenta: nunca se emitió ni se mandó a nadie. Tampoco
  un pendiente sin importe que cobrar (total ≤ 0): no entra en una remesa ni se cobra a mano, así
  que no saldría nunca de pendiente (2026-10-29). Es el «dinero vivo», y vale para todo lo que va
  por plazo, también la cuenta del tutor (ver abajo). ⚖️ Si un impago no se resuelve nunca, la familia se conservaría
  indefinidamente: el tope lo decide el abogado (F11-B, `docs/follow-ups.md`). Se construye en la
  destrucción (PR-8).
- **El final del curso** es el cierre del curso en el que se escribió el registro: un niño que
  sigue tres cursos no arrastra la agenda del primero, y la familia conserva el curso entero
  mientras está.
- **«Deja de estar viva» (lista de espera, PR-3):** cuando se descarta o cuando termina el curso
  para el que se apuntó, lo que pase antes; el plazo cuenta desde ahí. Solo los prospectos sin
  niño: uno con `nino_id` llegó a alta y sigue al expediente, aunque luego se descartara. Se
  confirma en el informe del PR-3.
- **El olvido y la operativa (PR-4):** se borra la de la fila de `RETENCION_OPERATIVA_ANIOS`, la
  del niño: su conversación con la profe (las de Dirección con la familia no tienen niño), sus
  citas `reunion_familia`, sus recordatorios `familia_individual` y sus respuestas a eventos. Con
  sus copias en `audit_log`, también las de filas suyas borradas antes.
- **Los eventos de ámbito niño se quedan** (decidido por el responsable, 2026-10-28): de ellos
  cuelga la autorización firmada de la familia, que es prueba y se conserva 5 años
  (`RETENCION_FIRMAS_ANIOS`). Si se borrara el evento y se dejara la firma, la firma quedaría
  huérfana y perdería su sentido como prueba. Se van juntos cuando venza el plazo de las firmas
  (PR-8). Ni el olvido (PR-4) ni la operativa por tiempo (PR-5) los tocan.
- **La operativa por tiempo (PR-5):** cada registro vence cuando ha pasado el plazo desde el final
  del curso en que se escribió: el primero del centro (sin borrar) que termina en la fecha del
  registro o después. Un registro de verano, entre dos cursos, cuenta con el siguiente; si el
  centro aún no tiene un curso que termine después, no vence. La fecha del registro es la más
  tardía de las suyas, así nunca vence antes de tiempo: la del día y la de alta (y, en el informe,
  el final de su curso y su última edición; en la confirmación, la fecha del evento). Una
  conversación se va solo cuando ya no le queda ningún mensaje sin vencer. Con sus copias en
  `audit_log`, y también las copias de filas de la operativa que ya no existen, cuando vence el
  curso de la copia.
- **El expediente (PR-6):** decidido por el responsable (2026-10-28) que se quede **visible** los 5
  años, y la ficha médica **bloqueada pasado el curso de la baja**. «La baja» es la fecha más tardía
  entre el archivado y la `fecha_baja` de sus matrículas; «el curso de la baja», el primero del
  centro que termina en esa fecha o después (el predicado del PR-5); si el centro aún no tiene uno,
  no se bloquea. Bloqueada, nadie la lee ni la escribe, tampoco Dirección ni la familia, la lectura
  no se registra y no sale ni el aviso de alergia del aula. Reincorporar al niño la desbloquea. A
  los 5 años, la purga del niño, la misma que la del olvido (sin solicitud ni avisos), con sus
  ficheros de Storage. La familia y los perfiles de los tutores se quedan: sostienen los recibos y
  se van con la destrucción fiscal (PR-8).
- **La ficha bloqueada en el export** (decidido por el responsable, 2026-10-28): no se entrega, porque
  lo bloqueado solo se extrae para un juez, la Administración o una reclamación (art. 32 LOPDGDD) y
  el export es una pantalla de la app. Pero no se omite en silencio: el art. 15 da derecho a saber
  qué datos se tratan, así que el export dice que existe, que está bloqueada, desde cuándo, por qué
  y cómo pedirla.
- **El registro de lecturas y el olvido:** decidido que se conserve, bloqueado: sin él no se puede
  demostrar nada si una familia reclama después un acceso indebido. Desde el PR-7 la purga ya no lo
  borra (se quitó el trigger `ninos_purga_borra_lecturas`); se va con su plazo.
- **El bloqueo (PR-7)**, decidido por el responsable (2026-10-28 y 2026-10-29). Lo que se conserva
  por obligación legal tras la purga queda **bloqueado**: se guarda tal cual y nadie lo ve ni lo
  toca en el uso diario de la app (tampoco Dirección ni la profe).
  - **Lo del niño**, cuando está purgado (`deleted_reason = 'purga_rgpd'`, por el olvido o por el
    plazo del expediente): sus firmas, sus autorizaciones, sus consentimientos, sus acuses del alta,
    la medicación administrada y el registro de lecturas de su ficha.
  - **Lo de un tutor purgado** (sus firmas, sus acuses, sus consentimientos), en el centro donde se
    purgó; con su cuenta purgada entera, en todos.
  - **Nada fiscal ni financiero se oculta ni se modifica**: recibos y líneas (con el nombre del
    niño y de la familia), remesas, mandatos, método de pago, parte de servicio, conceptos
    asignados y becas. Son la base de lo que se cobró: sin ellos un recibo no se justifica ante
    Hacienda.
  - **Verlo cuando hay un requerimiento** (Hacienda, un juez, la autoridad de protección de datos,
    una reclamación): desde «Datos bloqueados», **solo la titular** (ni la directora, ni la profe,
    ni el superusuario), con un **motivo escrito** (tipo y texto de 10 a 1000 caracteres) antes de
    ver nada. **Cada vista y cada descarga quedan registradas** (`accesos_datos_bloqueados`):
    quién, cuándo, por qué y qué apartados. La descarga es un HTML imprimible para entregar.
  - **El export** no lo entrega y dice qué hay bloqueado, cuánto, desde cuándo, por qué y cómo
    pedirlo, como con la ficha médica; y cuántas veces lo consultó el centro, por qué tipo de motivo
    y cuándo, sin el texto del motivo (art. 15). El del tutor dice también las consultas de lo de los
    niños de los que fue tutor legal: tras la purga ya no puede exportar al niño.
  - **El registro de accesos** se destruye con los datos bloqueados del sujeto (PR-8): mientras
    existan, quién los miró tiene que poder demostrarse.
- **La retención (PR-8)**, decidido por el responsable (2026-10-29). La destrucción no se deshace,
  y un requerimiento puede llegar el último mes del plazo. La titular (ni la directora, ni la profe,
  ni el superusuario) **retiene** a un sujeto ante un procedimiento abierto, con un motivo escrito
  (tipo y texto), y mientras lo está no se destruye nada suyo al vencer su plazo: del niño, su
  expediente, sus firmas y lo fiscal de su familia; del tutor, su cuenta, sus firmas y
  consentimientos y lo fiscal de sus familias. Quitarla pide motivo. Queda registrado quién la puso
  y quién la quitó, cuándo y por qué (`retenciones`). Se pone desde «Datos bloqueados», en un
  listado con **todos** los sujetos del centro (los purgados y los que algún día se destruirán, sin
  límite de plazo), con filtro por clase, búsqueda por nombre y selección múltiple, como el pase de
  servicios o la beca de comedor. **La retención frena también el olvido que pide el interesado**
  (2026-10-29; art. 17.3.e: el centro no destruye las pruebas de su propio caso justo cuando las
  necesita): es un bloqueo más de la petición, que no se confirma y queda pendiente; la familia ve
  en su perfil que está retenida y por qué tipo de motivo (el texto del motivo se queda en el
  centro), y la titular puede explicarlo en la nota de la petición. Una petición ya confirmada y sin
  purgar vuelve a pendiente al retener, con los datos como estaban, y su familia recibe el correo
  de «deshecha», como en cada cambio de estado; la purga no coge a un retenido.
- **La cuenta del tutor (PR-8)**, decidido por el responsable (2026-10-29): se purga, como en el
  olvido y sin que nadie lo pida, a los 5 años de la baja de su último hijo en el centro (el mismo
  día que el expediente de ese hijo), si no le queda otro rol vivo allí. «No vamos a tener a todos
  los alumnos y padres para toda la vida, lo normal es no solicitar el olvido.» Su familia y sus
  recibos siguen hasta sus 6 años. Cómo (2026-10-29, `20261207120000`):
  - «Sus hijos» son todos los que ha tenido en el centro, por vínculo (no el de Dirección) o por
    familia, aunque el vínculo o su perfil estén borrados; todos tienen que estar de baja, y cuenta
    la baja más tardía. Un tutor que nunca tuvo hijos queda fuera (el alta abandonada).
  - «Otro rol vivo» es admin, directora o profe en el centro. Las cuentas de autorizado, igual que
    las del tutor, con sus hijos por vínculo. Multicentro: solo ese centro, y la cuenta entera con el
    último, como el olvido.
  - Si la familia tiene dinero vivo (un recibo pendiente con importe, un devuelto sin resolver, un
    borrador con una deuda o un saldo dentro, dinero a favor sin devolver), la cuenta espera.
    Retenido, también. Hasta `20261208120000` eran los bloqueos del olvido, que cuentan cualquier
    borrador con importe: un borrador olvidado frenaba la cuenta para siempre, y con ella lo fiscal
    de su familia. «Con B, un borrador olvidado hace seis años manda sobre el plazo legal y nadie se
    entera» (2026-10-29). El olvido que pide la familia sigue con sus bloqueos.
  - La purga es la del olvido, sobre una petición «del centro, por plazo» (`por_plazo`), que el
    cron crea confirmada y sin gracia y purga en el acto: así lo ya aplicado (Datos bloqueados, la
    exportación, qué firmas se bloquean, la lista de sujetos) la reconoce sin tocarlo. En Olvido
    sale con su etiqueta. No se avisa al tutor por correo, como con el expediente del niño. La
    purga del olvido no la coge, la retención no la devuelve a pendiente (nadie la pidió), y la
    purga vuelve a mirar que siga purgable. Si el tutor tiene abierta una petición suya, el plazo
    espera a que se resuelva.
  - Los consentimientos de la cuenta (sin niño) se van con la cuenta entera, al mismo plazo.
- **Las firmas al vencer (PR-8)**, decidido por el responsable (2026-10-29, `20261207120000`): a los
  5 años de la baja del niño, y solo con el niño ya purgado (la purga del expediente, al mismo
  plazo, va antes en el cron), se destruyen sus firmas, sus acuses del alta, sus consentimientos,
  la medicación administrada, sus autorizaciones y los eventos de ámbito niño, sin copia en
  `audit_log`. Lo normal es que Dirección las vea hasta el día en que se destruyen: solo están
  bloqueadas antes si hubo un olvido. El niño retenido conserva todo; el tutor retenido, sus
  firmas, acuses y consentimientos sobre ese niño, y la autorización de la que cuelgan. El
  registro de accesos de un sujeto se destruye cuando ya no le queda nada bloqueado en el centro;
  las lecturas de la ficha tienen su plazo (60 meses) y el registro las espera.
- **Lo fiscal al vencer (PR-8)**, decidido por el responsable (2026-10-29, `20261208120000`): a los
  6 años del último recibo pagado de la familia o, si no pagó ninguno, del final del curso de la
  baja de su último hijo (el criterio de la operativa). «Se destruye todo», sin esqueletos para
  siempre y sin copia en `audit_log`: los recibos con sus líneas, su parte de las remesas (una remesa
  que se queda vacía se borra; la compartida se queda con lo de las otras familias), los mandatos y
  su documento firmado, el método de pago, las asignaciones, el parte de servicio, las becas, los
  tutores (también el DNI de uno sin cuenta), la familia y las fichas ya anónimas de sus niños.
  - Espera al dinero vivo (ver «El último recibo pagado»).
  - Espera a que termine todo lo anterior: sus niños purgados y sin nada conservado ni registro que
    mirar, y sus tutores purgados en el centro (o con otro rol vivo allí). Si no, quedarían
    colgando.
  - Un niño retenido hace esperar a su familia entera; un tutor retenido, a todas sus familias.
  - Los documentos se borran antes que la BD. Si Storage falla, la familia no se toca y se
    reintenta: borrar la fila perdería la ruta del documento.
  - **La cuenta**, al final: purgada en todos sus centros, sin perfil de tutor en ninguna familia,
    sin rol vivo y sin retener, se borra de la BD y de Auth. Si algo la nombra todavía (su
    actividad en `audit_log` hasta su plazo, una petición de olvido que pidió ella), espera: «si no
    le queda nada».
- **El alta que no se termina (PR-8)**, decidido por el responsable (2026-10-29,
  `20261209120000`). Hasta ahora el alta abandonada se borraba sola a los 30 días de caducar la
  invitación y dejaba la familia y el perfil del tutor invitado, con su nombre y su email; el alta a
  medias (aceptada y sin terminar) no la limpiaba nada.
  - **No es automático**: a los 30 días el alta se le propone a Dirección (la admin y las
    directoras: «son altas nuevas», no el olvido), que confirma; y puede hacerlo cuando quiera.
    Cuentan desde que caduca o se cancela la invitación (o desde el alta, si nunca salió), o desde
    que la familia la aceptó. Solo la matrícula en `pendiente`: en `lista` le toca a Dirección.
  - **Un solo botón**, en «Avance del alta» de la ficha del niño: con la invitación sin aceptar y
    abierta, la cancela (el alta se queda para invitar otra vez; el email mal escrito); si no, borra
    el alta: «si la familia no quiere entrar se borra».
  - **Familia nueva**: desaparece todo, sin copia en `audit_log`: la familia, sus tutores con su
    nombre y su email, los borradores con sus líneas, las asignaciones, el método de pago, el
    mandato y su documento, lo que subieron y la ficha de la lista de espera. La cuenta de quien
    entró pierde su rol en el centro y, si no le queda nada en ningún otro, se borra de la base y
    de Auth; si algo la nombra todavía, espera.
  - **Familia que ya tuvo un hijo**: solo el alta (el niño, su matrícula, su invitación y sus
    líneas en los borradores). Lo demás sigue la regla de los 5 años.
  - **«Enviar una invitación nueva»**: corrige el email del tutor y vuelve a invitar; lo del email
    viejo (sus invitaciones, su cuenta de Auth sin confirmar y el email en `audit_log`) se va.
  - Queda quién lo hizo y cuándo, como evento `alta_sin_terminar`, sin datos de la familia.
- **Ningún tutor se olvida con un hijo matriculado** (decidido por el responsable, 2026-10-28),
  haya otro tutor o no: no puede quedar un niño sin tutor. Sus hijos son los de sus vínculos y los
  de sus familias. La petición queda pendiente hasta que el niño deje el centro; si vuelve a
  matricularse en los días de gracia, la purga espera.

## Troceo

En este orden; cada paso nuevo del barrido respeta la simulación (`RETENCION_DRY_RUN`).

1. **Plazos** (este PR): la tabla de arriba y las constantes; el registro de lecturas, de 24 a 60
   meses. Sin migración.
2. **Borrar sin dejar copia en `audit_log`**, y la retención de 5 años de `audit_log`.
3. **Lista de espera**: 1 año.
4. **El olvido alcanza la operativa del niño**, con sus copias en `audit_log`.
5. **La operativa por tiempo**: 1 año desde el final del curso.
6. **El expediente**: la purga del niño 5 años después de la baja; la ficha médica, bloqueada
   pasado el curso de la baja.
7. **El bloqueo** de lo que se conserva por obligación, también el registro de lecturas tras el
   olvido.
8. **La destrucción al vencer**, en piezas, el freno primero:
   1. la retención por procedimiento abierto, que frena desde ya la purga del expediente;
   2. las firmas a los 5 años de la baja del niño, y la cuenta del tutor a los 5 años de la baja de
      su último hijo (`20261207120000`);
   3. lo fiscal a los 6 años del último recibo pagado: recibos, remesas, mandatos, la familia y
      sus tutores, y la cuenta que ya no tiene nada (`20261208120000`);
   4. el alta que no se termina, que propone y confirma Dirección (`20261209120000`).

## Tests requeridos

- Unit (`plazos.test.ts`): cada constante coincide con la tabla, y no hay constante sin fila.
- PR-2 (`20261129120000`): `src/test/audit/retencion-sin-copia.test.ts` (sin el ajuste un DELETE
  deja su copia; las fotos del blog y el stub se van sin copia; `purgar_audit_log` simulado y
  real; con sesión, 42501), los esqueletos de `purga-rgpd-nino.test.ts` y `grupo1b-audit.test.ts`
  (ninguna fila que quede en `audit_log` es de un registro que ya no está en su tabla) y los unit
  `audit-log.test.ts` y `limpiar-db-sin-copia.test.ts`.
- PR-3 (`20261130120000`): `src/test/audit/retencion-lista-espera.test.ts` (la fecha del descarte
  y su CHECK; se borran sin copia el del curso terminado y el descartado viejo, y se conservan con
  la suya el descartado reciente, el que tiene niño y el vivo; con sesión, 42501) y el unit
  `lista-espera.test.ts`.
- PR-4 (`20261201120000`): `src/test/audit/olvido-operativa.test.ts` (la purga del niño deja a
  cero su operativa y sus copias en `audit_log`, también las de un biberón, una agenda con su
  comida y un invitado borrados antes; el otro niño conserva sus filas y sus copias; el evento del
  centro y el de ámbito niño se quedan).
- PR-5 (`20261203120000`): `src/test/audit/retencion-operativa.test.ts` (vence, con sus copias, lo
  de un curso de 1995-96 en cada tabla, con las hijas en cascada y la copia vieja de un biberón
  borrado antes; se quedan la agenda de verano, la ausencia vieja dada de alta hoy, la
  conversación vieja con un mensaje de hoy, la agenda de un centro sin curso viejo, los dos
  eventos y la copia reciente; la simulación cuenta justo las tablas de `TABLAS_OPERATIVA` sin
  borrar y el borrado da lo mismo; con sesión, 42501) y el unit `operativa.test.ts`. El volumen se
  midió en la BD efímera del CI: 59 niños, unas 65 000 filas, 3,3 s.
- PR-6 (`20261204120000`): `src/test/audit/retencion-expediente.test.ts` (con la baja en 1996, la
  ficha no la lee ni la escribe Dirección, no deja lectura, no da el aviso del aula y el export dice
  que existe y está bloqueada sin entregarla; la de baja hoy se lee; cuenta la fecha más tardía de
  la baja; reincorporar la desbloquea; solo `service_role` lista y purga; la purga es la del olvido,
  con su actor, una sola vez, y deja entero al de baja hoy), los unit `expediente.test.ts`,
  `ficha-medica-bloqueada.test.ts` y el de la nota en `render-html.test.ts`. El olvido sigue
  cubierto por sus tests (`purga-rgpd-nino.test.ts`, `olvido-operativa.test.ts`…), que ahora pasan
  por `privado.purgar_nino`.
- PR-8, la retención (`20261206120000`): `src/test/audit/retencion-retenciones.test.ts` (retenido,
  la purga del expediente espera y, quitada, vuelve a cogerlo; solo la titular pone, quita y lee,
  con motivo; la directora, la profe y el superusuario, 42501; una lista con alguien de otro centro
  no retiene a nadie; la tabla no se lee con sesión; retenida, la petición de olvido no se confirma
  y la familia ve por qué; una confirmada vuelve a pendiente y la purga no la coge) y el unit `datos-bloqueados/__tests__/retencion.test.ts`
  (el filtro, lo que se manda y los textos en los tres idiomas).
- PR-8, las firmas y la cuenta (`20261207120000`): `src/test/audit/retencion-firmas-cuenta.test.ts`
  (el niño retenido no pierde nada; el tutor retenido conserva su firma y la autorización; lo
  demás se va sin copia en `audit_log`; el registro de accesos espera a las lecturas; lo del niño
  vivo no se toca; la cuenta no vence con un hijo vivo, un rol de profe, dinero vivo de la familia
  o retenida, y sí con un borrador sin deuda; la petición por plazo es una, la purga del olvido no la coge, la titular la ve con su
  etiqueta, la retención no la devuelve a pendiente, la purga vuelve a mirar el rol y una
  pendiente no puede existir; purgada, se van los consentimientos de la cuenta; solo el servicio)
  y los unit `firmas.test.ts` y `cuentas.test.ts` (simulación, orden, sin correo, fallos).
- PR-8, lo fiscal (`20261208120000`): `src/test/audit/retencion-fiscal.test.ts` (la familia espera
  a que su tutora esté purgada, y la cuenta de la tutora vence con un borrador sin deuda; las rutas
  del mandato y del DNI salen para borrarlas antes; frenan un pendiente con importe, una devolución
  sin resolver, llevada a un borrador o vuelta a abrir, y una transferencia pendiente, y no un
  pendiente de 0 €; el niño o la tutora retenidos la hacen esperar; libre, se destruye entera, con
  la cadena del re-giro, sin copia en `audit_log`, y la remesa compartida se queda con lo de la otra
  familia; sin ningún recibo pagado cuenta el final del curso de la baja; la cuenta espera mientras
  `audit_log` la nombra y después se borra, y Auth la encuentra; solo el servicio) y los unit
  `fiscal.test.ts` (simulación, Storage antes que la BD, un fallo de Storage no toca la BD) y
  `cuentas-olvidadas.test.ts` (la BD antes que Auth, las de una pasada anterior se reintentan).
- PR-8, el alta sin terminar (`20261209120000`): `src/test/audit/altas-sin-terminar.test.ts` (el
  barrido ya no borra altas; la lista es de la admin y de la directora, y la profe recibe 42501; un
  niño con matrícula activada o en `lista` no entra; el botón es solo del servidor, y la base
  vuelve a mirar quién actúa y qué acción vio; con la invitación abierta la cancela y el alta se
  queda; la invitación nueva corrige el email y se lleva el viejo, su cuenta sin confirmar y sus
  copias; con la familia nueva desaparece todo, también la cuenta de la tutora que escribió con su
  sesión; con un hijo anterior, solo el alta; cada acción deja su evento) y el unit
  `matriculas/lib/__tests__/alta-sin-terminar.test.ts` (Storage antes que la base, un fallo de
  Storage no la toca, la cuenta que Auth no deja borrar se queda con el email de la purga).
