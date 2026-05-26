# ADR-0024: Participantes y audiencia calculados dinámicamente (no persistidos)

## Estado

`accepted`

**Fecha:** 2026-05-25
**Autores:** Responsable NIDO + Claude Code
**Fase del proyecto:** Fase 5 — Mensajería profe ↔ familia + anuncios

## Contexto

Cada conversación en mensajería tiene un conjunto de "participantes" que cambia con el tiempo:

- La **profe del aula actual del niño**: puede cambiar si la profe es reasignada a otra aula a mitad de curso, o si la matrícula del niño cambia.
- Los **tutores con `puede_recibir_mensajes`**: el flag JSONB puede pasar a `false` (por ejemplo si el centro decide retirar el acceso digital a un autorizado).
- El **admin del centro**: rol estable, pero podría ser revocado.

La audiencia de un anuncio (ámbito 'aula' o 'centro') sigue una lógica análoga: profes activos + tutores con permiso en aulas con matrículas activas.

La cuestión: ¿persistir la membresía en tablas `conversacion_participantes` y `anuncio_audiencia` (snapshot en el momento de la creación o sincronizado con triggers), o calcularla en runtime cada vez que se evalúa la RLS?

## Opciones consideradas

### Opción A: Tablas de membresía persistidas, sincronizadas por triggers

Crear `conversacion_participantes(conversacion_id, usuario_id, rol)` y `anuncio_audiencia(anuncio_id, usuario_id)`. Triggers en `profes_aulas`, `vinculos_familiares.permisos`, `matriculas` mantienen las filas sincronizadas.

**Pros:**

- Histórico: "¿quién participaba en esta conversación el 12 de marzo?" se responde directo.
- RLS triviales: `SELECT 1 FROM conversacion_participantes WHERE usuario_id = auth.uid()`.
- Queries de "no leídos" más simples (basta JOIN con la tabla de membresía).

**Contras:**

- Mantenimiento por triggers: 4-5 tablas fuente que requieren triggers cruzados → superficie alta de bugs y filas zombi cuando un trigger falla.
- Cambio operativo silencioso: si la profe cambia de aula, el sistema tiene que decidir si dejar a la profe anterior "participando" o expulsarla automáticamente. Reglas implícitas que tarde o temprano divergen del producto.
- Backfill: cualquier corrección manual en `profes_aulas` o `vinculos_familiares` requiere recordar tocar también las tablas de membresía → fricción operativa.
- Inconsistencia eventual entre el estado "real" (profes_aulas, vinculos) y el "persistido" (participantes). En seguridad eso es inaceptable.

### Opción B: Cálculo dinámico vía helpers `SECURITY DEFINER` (la elegida)

Helpers SQL como `puede_participar_conversacion(conv_id)` y `usuario_es_audiencia_anuncio_row(centro_id, autor_id, ambito, aula_id)` consultan en runtime las tablas fuente (`roles_usuario`, `profes_aulas`, `vinculos_familiares`, `matriculas`) cada vez que se evalúa una policy.

**Pros:**

- **Estado único de verdad**: las tablas existentes mandan; no hay tablas duplicadas que sincronizar.
- **Cambios operativos instantáneos**: si la profe cambia de aula, su acceso a las conversaciones afectadas se ajusta sin acción adicional.
- **Sin triggers cruzados**: cero código de sincronización que mantener.
- **Tests RLS más fáciles**: cambiar un permiso en `vinculos_familiares` y observar el efecto en una query basta.

**Contras:**

- Cada evaluación de policy invoca el helper → leemos varias tablas por chequeo. Mitigable con índices (`profes_aulas (profe_id, fecha_fin)`, `vinculos_familiares (usuario_id, nino_id)`) que ya existían.
- No tenemos histórico nativo de quién era participante un día concreto del pasado. Si se necesitase, se añade en el futuro una tabla `eventos_membresia` append-only sin tocar la lógica de runtime.

### Opción C: Híbrido (snapshot al crear conversación, sin sincronización posterior)

Persistir los participantes al crear la conversación y nunca sincronizar.

**Pros:**

- Histórico explícito.

**Contras:**

- Las profes nuevas no aparecerán como participantes a menos que se añadan manualmente. Roto de fábrica.
- Tutores que pierdan el permiso seguirán "participando".
- Lo peor de los dos mundos.

## Decisión

**Se elige la Opción B (cálculo dinámico)** porque la mensajería es por su naturaleza "estado actual": quién puede hablar con quién depende de la situación operativa del centro hoy, no de quién lo era hace 3 meses. Persistir la membresía duplicaría el estado y crearía un vector de inconsistencia para una pregunta de seguridad — exactamente donde menos podemos permitirnos drift.

ANAIA tendrá <200 vínculos y <30 profes activos a la vez. El coste por evaluación de RLS es despreciable.

## Consecuencias

### Positivas

- Cambios de aula, permisos y matrículas se propagan instantáneamente a la mensajería sin scripts de sincronización.
- Helpers `SECURITY DEFINER` reutilizables fuera de RLS (RPC, server actions, queries de UI) — `puede_participar_conversacion` y `usuario_es_audiencia_anuncio_row` cubren los dos casos.
- Tests RLS con sesiones reales y mutaciones de `vinculos_familiares` validan el comportamiento sin tener que mantener fixtures separados.

### Negativas

- Sin histórico de membresía. Si en Ola 2 se demanda "auditar quién participaba en esta conversación el día X", se añadirá una tabla `eventos_membresia_conversacion` append-only que registra altas/bajas mediante triggers en `profes_aulas` y `vinculos_familiares`. Decisión postergada hasta tener el caso de uso real.
- Cada evaluación de policy lee 2-3 tablas. Aceptable con los índices existentes y los tamaños esperados.

### Neutras

- Las queries de "no leídos" se hacen en JS sobre filas ya filtradas por RLS (`countNoLeidos`). Si el volumen crece, se moverá a una RPC SQL agregadora — no cambia la decisión de cálculo dinámico.

## Plan de implementación

- [x] Helpers `puede_participar_conversacion`, `usuario_es_audiencia_anuncio_row`, `usuario_es_audiencia_anuncio` (versión por id para `lectura_anuncio`).
- [x] Policies de SELECT/INSERT/UPDATE en `conversaciones`, `mensajes`, `anuncios`, `lectura_*` que los invocan.
- [x] Tests helpers (`src/test/rls/messaging-helpers.test.ts`): 4 tests cubren mismo centro vs otro centro, ámbito aula vs centro, con/sin permiso.

## Verificación

- 20 tests RLS verdes incluyendo: cambio de permiso `puede_recibir_mensajes` desde fixture → la siguiente query no devuelve filas.
- Cero tablas de membresía en el schema. `git grep "participantes"` solo encuentra la documentación.

## Notas

La regla coincide con el principio general de NIDO: el estado de seguridad se evalúa en runtime contra las tablas fuente, no se duplica. Ya lo aplicamos en F2 con `es_admin`, `pertenece_a_centro`, `es_profe_de_aula` — F5 sigue la misma línea.

## Referencias

- Spec: `/docs/specs/messaging.md`
- ADR-0007 — RLS recursion avoidance (mismo patrón helpers `SECURITY DEFINER`)
- ADR-0023 — Modelo de mensajería con 5 tablas
