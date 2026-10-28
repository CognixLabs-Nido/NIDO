---
feature: retencion-plazos
wave: 1
status: approved
priority: high
last_updated: 2026-10-27
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

| Constante                               | Valor | Qué                                                                                                                                                                      | Desde                         | Al vencer                                                                                                             |
| --------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `RETENCION_FISCAL_ANIOS`                | 6     | `recibos`, `lineas_recibo`, `remesas`, `recibos_remesa`, `parte_servicio_diario`, `asignacion_concepto`, `beca_comedor_*`                                                | el último cobro de la familia | destruir; bloqueado desde el olvido                                                                                   |
| `RETENCION_MANDATOS_SEPA_ANIOS`         | 6     | `mandatos_sepa` y su documento                                                                                                                                           | el último cobro de la familia | destruir; bloqueado desde el olvido                                                                                   |
| `RETENCION_FIRMAS_ANIOS`                | 5     | `firmas_autorizacion`, autorizaciones de un niño, `consentimientos`, `acuses_alta`, `administraciones_medicacion`                                                        | la baja del niño              | destruir; bloqueado desde el olvido                                                                                   |
| `RETENCION_EXPEDIENTE_ANIOS`            | 5     | el niño: ficha, ficha médica, datos pedagógicos, matrículas, vínculos, invitaciones, `rollover_finaliza`                                                                 | la baja del niño              | la purga del niño, como la del olvido. Hasta entonces lo ve Dirección, salvo la ficha médica, bloqueada desde la baja |
| `RETENCION_OPERATIVA_ANIOS`             | 1     | agenda y sus cuatro tablas, `asistencias`, `ausencias`, `informes_evolucion`, conversaciones y mensajes, citas y sus invitados, `recordatorios`, `confirmaciones_evento` | el final del curso            | borrar                                                                                                                |
| `RETENCION_LISTA_ESPERA_ANIOS`          | 1     | `lista_espera` que no llegó a alta                                                                                                                                       | que deja de estar viva        | borrar. La que llegó a alta sigue al expediente                                                                       |
| `RETENCION_AUDIT_LOG_ANIOS`             | 5     | `audit_log`                                                                                                                                                              | la fecha de cada fila         | borrar; y antes, con su tabla, por el principio de arriba                                                             |
| `RETENCION_REGISTROS_DERECHOS_ANIOS`    | 5     | `export_log`, `olvido_solicitudes`                                                                                                                                       | la fecha de cada fila         | borrar                                                                                                                |
| `RETENCION_LECTURAS_FICHA_MEDICA_MESES` | 60    | `lecturas_ficha_medica`                                                                                                                                                  | la fecha de cada lectura      | borrar. Con el olvido se conserva, bloqueado                                                                          |
| `RETENCION_RECOGIDA_PUNTUAL_DIAS`       | 7     | DNI de una recogida puntual (Storage)                                                                                                                                    | que caduca                    | borrar (sin cambios)                                                                                                  |
| `RETENCION_RECOGIDA_HABITUAL_MESES`     | 12    | DNI de una recogida habitual (Storage)                                                                                                                                   | la baja                       | borrar (sin cambios)                                                                                                  |
| `RETENCION_FOTOS_MESES`                 | 12    | fotos del niño, de la ficha y del blog (Storage)                                                                                                                         | la baja de la matrícula       | borrar (sin cambios)                                                                                                  |
| `GRACIA_ESQUELETO_DIAS`                 | 30    | alta abandonada (niño, matrícula e invitación)                                                                                                                           | que caduca la invitación      | borrar (sin cambios)                                                                                                  |

Notas:

- **Recibos, de 4 a 6 años:** el art. 30 del Código de Comercio da 6 años a los justificantes
  contables; más seguro conservar de más. Si el abogado lo baja, se baja.
- **Medicación administrada, con las firmas (5 años):** es la prueba del centro ante una
  reclamación por una reacción, y son datos de salud de menores.
- **«El último cobro de la familia»:** por familia, no por recibo (confirmado por el responsable,
  2026-10-28). Mientras la familia sigue pagando se conserva su histórico entero; el plazo empieza
  cuando deja de haber cobros. Se construye en la destrucción (PR-8).
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
- **El registro de lecturas y el olvido:** decidido que se conserve, bloqueado: sin él no se puede
  demostrar nada si una familia reclama después un acceso indebido. Hasta el PR que lo construya, la
  purga del niño lo sigue borrando (trigger `ninos_purga_borra_lecturas`).

## Troceo

En este orden; cada paso nuevo del barrido respeta la simulación (`RETENCION_DRY_RUN`).

1. **Plazos** (este PR): la tabla de arriba y las constantes; el registro de lecturas, de 24 a 60
   meses. Sin migración.
2. **Borrar sin dejar copia en `audit_log`**, y la retención de 5 años de `audit_log`.
3. **Lista de espera**: 1 año.
4. **El olvido alcanza la operativa del niño**, con sus copias en `audit_log`.
5. **La operativa por tiempo**: 1 año desde el final del curso.
6. **El expediente**: la purga del niño 5 años después de la baja; la ficha médica, bloqueada
   desde la baja.
7. **El bloqueo** de lo que se conserva por obligación, también el registro de lecturas tras el
   olvido.
8. **La destrucción al vencer**: recibos, remesas, mandatos y firmas.

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
