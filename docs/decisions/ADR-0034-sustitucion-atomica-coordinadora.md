# ADR-0034: Sustitución atómica de coordinadora en `profes_aulas`

## Estado

`accepted`

**Fecha:** 2026-05-30
**Autores:** Jovi Mibimbi + claude-code (Opus 4.8)
**Fase del proyecto:** Sprint pre-F6 — item 4 (UI asignar personal a aulas)

## Contexto

El índice único parcial `idx_un_coordinadora_activa_por_aula (aula_id) WHERE tipo='coordinadora' AND fecha_fin IS NULL AND deleted_at IS NULL` (F5B-#34, ADR-0032) garantiza **una sola coordinadora activa por aula**. Funciona bien para integridad, pero plantea un problema de UX cuando la directora quiere **cambiar** la coordinadora: asignar/promocionar a la nueva mientras la actual sigue siéndolo dispara un `23505` crudo.

Caso real de Susana (directora ANAIA): "Ana pasa a ser coordinadora del aula; la anterior, María, pasa a profesora." Es una operación de **relevo** que el usuario percibe como un solo gesto, pero que en BD son dos UPDATE que, en el orden equivocado, chocan con el índice.

Hay que decidir cómo modela la app este relevo.

## Opciones consideradas

### Opción A: Error seco al cliente (`23505` → toast)

La UI intenta promocionar a la nueva; si hay coordinadora, el índice rechaza y se muestra el error.

**Pros:** cero lógica nueva.

**Contras:** obliga a la directora a, primero, degradar manualmente a la actual y, luego, promocionar a la nueva (dos gestos mentales + posible confusión "¿por qué me da error?"). UX inaceptable para un perfil no técnico.

### Opción B: Transacción RPC en Postgres (`SECURITY DEFINER`)

Una función SQL `sustituir_coordinadora(aula, nueva)` que hace ambos UPDATE en una transacción real.

**Pros:** atomicidad estricta a nivel BD.

**Contras:** otra función SQL que mantener + migración nueva (con el bug `SIGILL` del CLI hay que aplicarla a mano vía SQL Editor). Para esta operación, la atomicidad de transacción no aporta sobre el orden seguro (ver Decisión): el peor caso de una request interrumpida deja a la actual ya degradada y la nueva sin promocionar — un estado **válido** (aula sin coordinadora), reparable con un clic. No justifica el coste de una RPC.

### Opción C: Dejar al cliente hacer 2 calls

El componente llama a `cambiarTipoPersonal(actual, 'profesora')` y luego `cambiarTipoPersonal(nueva, 'coordinadora')`.

**Pros:** reutiliza la action existente.

**Contras:** dos round-trips desde el navegador; si el segundo falla (red, cierre de pestaña), el estado queda a medias sin que el servidor lo controle. La lógica de "qué coordinadora degradar" vive en el cliente, fácil de desincronizar.

## Decisión

**Se elige una action server-side `sustituirCoordinadora(aulaId, nuevaAsignacionId)` que ejecuta los dos UPDATE en orden seguro dentro de una sola request del servidor (Opción mixta A-server, descartando B y C).**

Orden seguro (evita el `23505` sin necesidad de transacción):

1. **Degradar primero** la coordinadora activa actual del aula a `profesora` (si existe).
2. **Promocionar después** la asignación nueva a `coordinadora`.

Degradar antes de promocionar garantiza que en ningún instante hay dos coordinadoras activas, así que el índice nunca se viola en el camino feliz. El `23505` queda como **red de seguridad de carrera**: si dos admins ejecutan el relevo a la vez, el índice impide la doble coordinadora y la segunda request recibe `23505`, que la UI traduce a "otra persona acaba de ser nombrada coordinadora, recarga".

La lógica de "qué fila degradar" vive en el servidor (lee la coordinadora activa por `aula_id`), no en el cliente. Las dos escrituras corren bajo la RLS `profes_aulas_admin_all` con la sesión del admin.

## Consecuencias

### Positivas

- Relevo de coordinadora en un solo gesto para la directora (1 confirmación).
- Sin migración nueva ni función SQL adicional (vs. Opción B).
- El peor caso de interrupción deja un estado válido y reparable (aula sin coordinadora), nunca corrupto.

### Negativas

- No es una transacción estricta: una interrupción entre los dos UPDATE deja el aula temporalmente sin coordinadora. Aceptado: es un estado legal del modelo y la directora lo resuelve con un clic.
- La action asume "1 coordinadora activa" como invariante; si en el futuro se permitieran varias, habría que revisarla.

### Neutras

- El `23505` se mantiene como contrato de error de carrera, mapeado en cliente a un mensaje claro.

## Referencias

- Origen: este PR (`feat/aulas-asignar-personal-ui`).
- Índice y ENUM: ADR-0032 + migración `20260529193000_phase5b_tipo_personal_aula.sql`.
- Action: `src/features/profes-aulas/actions/sustituir-coordinadora.ts`.
- Spec: `docs/specs/aulas-asignar-personal-ui.md`.
