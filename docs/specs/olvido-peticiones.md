---
feature: olvido-peticiones
wave: 1
status: approved
priority: high
last_updated: 2026-10-27
related_adrs: [ADR-0053, ADR-0059]
related_specs: [proteccion-datos]
---

# Spec — Peticiones de olvido desde la app

## Resumen ejecutivo

La familia pide desde la app que se borren los datos de un hijo o los de su cuenta. Es una
**petición, no un borrado**: la titular del centro la revisa con una lista de lo que falta,
calculada en el momento, y la confirma, la deja pendiente o la rechaza con un motivo que la familia
ve. Confirmada, hay 7 días en los que solo la titular puede deshacerla; después se purga como hasta
ahora.

## Contexto

F11-B, punto 5. Hasta ahora el olvido no tenía pantalla: `solicitar_olvido_nino` y
`solicitar_olvido_usuario` existían en el código pero no las llamaba nadie. Además solo las podía
llamar la titular, borraban de forma lógica en el momento de pedir y daban 30 días de gracia sin
ninguna forma de deshacerlos: la gracia solo retrasaba la purga.

Decisiones del responsable (2026-10-26 y 2026-10-27):

1. La familia puede pedir el olvido desde la app, en cualquier momento. Es una petición.
2. El centro la confirma. La titular comprueba antes que no queda nada pendiente.
3. Puede rechazarla con un motivo escrito, que la familia ve («si el niño sigue matriculado, los
   datos deben seguir»).
4. Una petición que todavía no se puede atender pero se podrá se queda pendiente, y la titular la
   confirma cuando se resuelve. No se rechaza para que la familia tenga que volver a pedirla.
5. Tras confirmar, **7 días** en los que **solo la titular** puede deshacer su confirmación.
6. El dinero a favor de la familia **avisa, no bloquea**: el centro hace la transferencia igual.
7. La petición de un hijo la pueden retirar **los dos tutores legales**, no solo quien la pidió.
8. Correo a la familia en cada cambio y push genérica a la titular por cada petición nueva.
9. **Los recibos no bloquean el olvido del niño, y sí el de un tutor.** La deuda es de la familia,
   no del niño: sus datos se borran igual. Los de la familia se mantienen hasta que pague
   (art. 17.3.e RGPD: lo necesario para reclamar).

## User stories

- US-01: Como tutor legal, quiero pedir que se borren los datos de mi hijo, para ejercer el derecho
  al olvido sin tener que ir al centro.
- US-02: Como tutor o autorizado, quiero pedir que se borren los datos de mi cuenta en un centro.
- US-03: Como tutor legal, quiero ver en qué estado está la petición y qué falta, y poder retirarla
  mientras esté pendiente, aunque la haya pedido el otro tutor.
- US-04: Como titular, quiero ver las peticiones abiertas y qué falta en cada una, para confirmar
  las que estén listas y no olvidar las que esperan.
- US-05: Como titular, quiero rechazar una petición con un motivo que la familia lea.
- US-06: Como titular, quiero deshacer una confirmación hecha por error en los 7 días siguientes.
- US-07: Como titular, quiero registrar una petición que la familia me hace en persona o por correo.

## Alcance

**Dentro:**

- Estados de la petición en `olvido_solicitudes` y las funciones que los mueven.
- La lista de lo que falta (bloqueos y avisos), calculada en el momento.
- Perfil de la familia: pedir, ver el estado, retirar.
- Página de la titular («Peticiones de borrado»), entrada en su menú y aviso en su Inicio.
- Correo a la familia en cada cambio; push genérica a la titular por cada petición nueva.
- Gracia de 7 días tras confirmar y «deshacer» de la titular.

**Fuera:**

- El olvido del personal: sigue por Dirección (los datos de un trabajador tienen otra retención).
- Cambiar qué borra la purga (`purgar_sujeto_db`): no se toca.
- El plazo legal de respuesta (art. 12.3, un mes ampliable): la página muestra los días abiertos,
  pero el tratamiento de los plazos lo valida el abogado de F11-B.

## Comportamiento

### Estados

| Estado       | Qué significa                                  | Qué ha pasado con los datos               |
| ------------ | ---------------------------------------------- | ----------------------------------------- |
| `pendiente`  | Pedida; la titular no la ha resuelto           | Nada. La familia sigue con acceso         |
| `confirmada` | La titular la confirmó; corre la gracia        | Borrado lógico, como hacía antes al pedir |
| `rechazada`  | La titular la rechazó, con motivo              | Nada                                      |
| `retirada`   | La familia la retiró mientras estaba pendiente | Nada                                      |

«Borrada» no es un estado: es `purgado_en`, que pone la purga nocturna a una `confirmada` cuya
gracia ha vencido. Una persona tiene como mucho una petición abierta (`pendiente`, o `confirmada`
sin purgar) por centro; rechazada o retirada, puede volver a pedir.

### Quién pide qué

| Petición                                   | Quién                                                          |
| ------------------------------------------ | -------------------------------------------------------------- |
| Borrar los datos de un hijo                | Un tutor legal del niño, con el vínculo vivo. No un autorizado |
| Borrar los datos de mi cuenta en un centro | El propio tutor o autorizado de una familia del centro         |
| Cualquiera de las dos, en nombre de otro   | La titular (`privado.es_responsable`)                          |

Quien pide puede marcar que se borre en cuanto se confirme (`inmediato`): sin los 7 días.

### Lo que falta (calculado en el momento)

**Bloqueos** (no se puede confirmar mientras haya alguno):

| Sujeto | Bloqueo              | Regla                                                                                                            |
| ------ | -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Niño   | `matricula_viva`     | Una matrícula suya sin borrar que no esté en `baja` (pendiente, lista o activa)                                  |
| Tutor  | `hijos_matriculados` | Un niño del centro con el que tiene vínculo vivo y matrícula viva                                                |
| Tutor  | `recibos_pendientes` | Un recibo de su familia en el centro sin cerrar: en borrador o por procesar con importe, o devuelto sin resolver |

**Avisos** (no bloquean):

| Sujeto | Aviso                        | Regla                                                                              |
| ------ | ---------------------------- | ---------------------------------------------------------------------------------- |
| Niño   | `recibos_familia_pendientes` | Recibos sin cerrar de su familia: se quedan con la familia                         |
| Tutor  | `cobro_banco_reciente`       | Recibos enviados al banco hace menos de 8 semanas: con SEPA aún se pueden devolver |
| Tutor  | `dinero_a_favor`             | Un exceso de beca o de cheque pendiente, o una transferencia sin hacer             |
| Tutor  | `mandato_activo`             | Un mandato SEPA activo: se conserva como prueba legal                              |

La familia ve lo mismo que la titular: son sus propios datos (y es la respuesta con motivo del
art. 12.4 mientras la petición espera).

### Confirmar, rechazar, deshacer

- **Confirmar** (titular): solo `pendiente` y sin bloqueos; la función lo vuelve a comprobar con la
  fila bloqueada. Hace lo que antes hacía pedir: el niño queda borrado de forma lógica (motivo
  `solicitud_olvido`), o el tutor pierde sus roles en el centro y, si no le queda otro, la cuenta se
  bloquea. Guarda cómo estaba antes (`estado_previo`) y la gracia es de 7 días (o ninguna con
  `inmediato`).
- **Rechazar** (titular): solo `pendiente`; motivo obligatorio (1 a 1000 caracteres).
- **Nota para la familia** (titular): opcional, mientras está pendiente («falta el recibo de
  octubre»).
- **Deshacer** (titular): una `confirmada` sin purgar y con la gracia sin vencer vuelve a
  `pendiente` y los datos quedan como estaban (`estado_previo`): el niño con su borrado de antes
  (por ejemplo, la baja) o sin borrar; los roles retirados por esa confirmación, de vuelta (salvo
  que ya tenga uno vivo igual); la cuenta, desbloqueada si la bloqueó la confirmación.
- **Retirar** (familia): solo `pendiente`. Quien la pidió; en la de un hijo, también cualquier
  tutor legal del niño con el vínculo vivo; en la de una cuenta, la propia persona.

### Lo que ve la titular

Página «Peticiones de borrado» (`/admin/olvido`), solo para la titular (como Auditoría). Las abiertas
primero, y entre ellas las listas para confirmar; después las cerradas de los últimos 90 días. Cada
una: de quién es, quién la pidió y cuándo, los días que lleva abierta (marcadas a partir de 25), lo
que falta y los botones. En su Inicio, un aviso con cuántas hay por revisar.

### Lo que ve la familia

En su perfil, que es la única página abierta a cualquier cuenta tenga rol o no: con la baja del niño
la familia pierde los vínculos y, si no tiene más hijos en el centro, el rol, pero sigue entrando a
su perfil.

| Estado     | Qué ve                                                                |
| ---------- | --------------------------------------------------------------------- |
| Sin pedir  | El botón para pedirla, con qué significa y qué se conserva            |
| Pendiente  | Cuándo la pidió y quién, lo que falta, la nota del centro y «Retirar» |
| Confirmada | Cuándo se confirmó y el día en que se borrarán                        |
| Rechazada  | Cuándo y el motivo; puede volver a pedirla                            |
| Retirada   | Cuándo                                                                |
| Borrada    | Cuándo se borraron                                                    |

### Avisos

- **Correo a la familia** (Resend) en cada cambio: pedida (acuse), confirmada, rechazada, retirada,
  deshecha y borrada (este, justo antes de purgar, mientras aún se conoce la dirección). Va a quien
  la pidió, a los tutores legales vivos del niño y, en la de una cuenta, a la propia persona. No
  nombra al niño: dice el centro y lleva al perfil.
- **Push a la titular** por cada petición nueva que no haya registrado ella: «Petición de borrado de
  datos» / «Tienes una petición nueva por revisar», sin nombres (punto 8).

## Modelo de datos

Migración `20261126120000_feat_olvido_peticiones`. Sobre `olvido_solicitudes` (0 filas en
producción a 2026-10-27):

- `estado olvido_estado NOT NULL DEFAULT 'pendiente'` (`pendiente`, `confirmada`, `rechazada`,
  `retirada`).
- `confirmada_en`, `confirmada_por`, `rechazada_en`, `rechazada_por`, `motivo_rechazo`,
  `retirada_en`, `retirada_por`, `nota_centro`, `estado_previo jsonb`.
- `gracia_hasta` pasa a NULL mientras no se confirma. CHECK de coherencia por estado.
- El índice único de la petición abierta pasa a `WHERE purgado_en IS NULL AND estado IN
('pendiente', 'confirmada')`.
- Trigger: al purgar, se vacían `motivo_rechazo` y `nota_centro` de todas las peticiones de esa
  persona en el centro (son texto libre que puede hablar de ella). La tabla no se audita.
- Solo se escribe por funciones `SECURITY DEFINER`: `pedir_olvido_nino`, `pedir_olvido_usuario`,
  `retirar_peticion_olvido`, `confirmar_peticion_olvido`, `rechazar_peticion_olvido`,
  `nota_peticion_olvido`, `deshacer_confirmacion_olvido`. Se leen por `peticiones_olvido_centro`
  (titular), `mis_peticiones_olvido` y `opciones_olvido` (familia).
- `solicitar_olvido_nino` y `solicitar_olvido_usuario` (registrar y confirmar de una vez) quedan
  solo para `service_role`, con 7 días de gracia. `olvido_pendientes` solo devuelve confirmadas.

## Tests

- RLS (`olvido-peticiones.rls.test.ts`): quién pide y quién no; una abierta por persona; los
  bloqueos y avisos de cada caso; confirmar bloqueado y desbloqueado; deshacer deja los datos como
  estaban; rechazar exige motivo y la familia lo lee; retirar por los dos tutores y no por un
  autorizado; la directora no es la titular; la purga ignora lo no confirmado y vacía los textos.
- Unit: las acciones mandan el correo a quien toca y la push a la titular, sin nombres.
