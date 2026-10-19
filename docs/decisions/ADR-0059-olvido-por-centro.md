# ADR-0059: El olvido es por centro

## Estado

`accepted`

**Fecha:** 2026-10-19
**Autores:** responsable + claude-code
**Fase del proyecto:** Multicentro · Fase 2 · PR B

## Contexto

Desde la Fase 2 (ADR-0058) un adulto puede tener familia, rol e hijos en varios centros. El derecho al olvido (F11-A4) seguía siendo de la persona entera:

- `solicitar_olvido_usuario` deducía el centro del rol más antiguo y bloqueaba la cuenta (`usuarios.deleted_at`) aunque tuviera otro centro.
- La rama del usuario de `purgar_sujeto_db` borraba sin mirar el centro: su nombre en los mensajes de cualquier conversación, su perfil de tutor en todas sus familias, sus roles y vínculos de todos los centros, toda su auditoría, sus invitaciones.
- `purgar-vencidos.ts` anonimizaba siempre la cuenta de Auth y borraba todos sus DNI y su avatar.
- El hilo dirección↔familia era uno por par (admin, tutor): con hijos en dos centros, las dos direcciones compartían hilo si la directora era la misma.

Cada centro es responsable de su tratamiento: pedir el olvido en un centro no puede borrar lo que es de otro.

## Opciones consideradas

### Opción A: una sola purga que, si no es el último centro, acota cada sentencia al centro

**Pros:** la purga del último centro es literalmente la de siempre, ya probada; la del centro es la misma sentencia con un filtro. Nada que no estuviera ya.

**Contras:** dos ramas casi iguales que hay que mantener a la par.

### Opción B: dos funciones, una de centro y otra de cuenta, que el orquestador llama por orden

**Pros:** cada función hace una cosa.

**Contras:** el orquestador tendría que saber cuándo es el último centro y llamarlas en el orden correcto; un fallo entre las dos dejaría la solicitud a medias, y la purga dejaría de ser un solo punto de commit.

## Decisión

**Se elige la Opción A.** Decisiones del responsable (2026-10-19): si el dato tiene centro, se borra por centro; si no lo tiene, es de la cuenta y se va con el último centro, junto con «el resto» (lo de centros donde no se pidió el olvido).

Migración `20261022120000_feat_olvido_por_centro`:

- **`olvido_solicitudes`:** una solicitud pendiente por sujeto **y centro** (índice `olvido_solicitudes_sujeto_centro_pendiente`). El `ON CONFLICT` de las dos funciones de solicitud nombra el índice nuevo.
- **`olvido_es_ultimo_centro(solicitud)`:** al sujeto no le queda ningún rol vivo en otro centro ni otra solicitud pendiente. Para un niño, siempre (es de un solo centro). Solo `service_role`. La usan la BD y la app, para que decidan lo mismo.
- **`solicitar_olvido_usuario(usuario, centro, inmediato)`:** el centro es explícito (el de la página de la directora, que tiene que ser admin en él). El usuario tiene que estar o haber estado en ese centro (un rol o un perfil de tutor). Retira sus roles de ese centro (`solicitud_olvido`) y bloquea la cuenta solo si no le queda otro centro. La versión sin centro desaparece.
- **`purgar_sujeto_db`, rama del usuario:**
  - **Último centro:** literal la rama de antes (`20261019120000`): la cuenta entera y todo lo que quede.
  - **Le queda otro centro:** las mismas sentencias acotadas a `s.centro_id`: su nombre en los mensajes de las conversaciones del centro y en su auditoría; los consentimientos ligados a un niño del centro; las lecturas de conversaciones y anuncios del centro; su perfil de tutor, sus cambios pendientes, sus comentarios de cita y sus prospectos del centro; sus roles del centro y sus vínculos con niños del centro; su auditoría con ese `centro_id`; sus invitaciones del centro. No toca `usuarios`, push, preferencias ni los consentimientos sin niño.
- **`conversaciones`:** un hilo dirección↔familia por admin, tutor **y centro** (`idx_conv_admin_familia_centro_unique`).

En la app:

- `purgar-vencidos.ts` pregunta una vez `olvido_es_ultimo_centro`. Si no es el último: las invitaciones de su email solo del centro, ni avatar ni Auth. El manifiesto de adjuntos recibe el alcance (`soloCentroId`): el DNI es el de la familia de ese centro.
- `solicitarOlvidoUsuario(usuarioId, centroId, inmediato)`.
- Hilo: `abrirConversacionAdminFamilia(tutorId, centroId)` (el de la página; al reabrir, el del hilo), `getAdminFamiliaList(rol, centroId)`, y el hilo de cada tutor en la pestaña Dirección y la rama del admin del badge de mensajes, los de ese centro.

## Consecuencias

### Positivas

- Pedir el olvido en un centro no toca lo de otro, y la cuenta sigue viva mientras le quede uno.
- La purga del último centro no cambió: lo que ya estaba probado sigue igual.

### Negativas

- Dos ramas de la purga que mantener a la par: una sentencia nueva en una tiene que ir también, acotada, en la otra.
- `purgar-vencidos.ts` decide «último centro» antes del punto de commit. Si en ese intervalo le dan un rol en otro centro, la cuenta de Auth ya se habrá bloqueado.

### Neutras

- La migración va a producción **antes** del merge. Con el código viejo, la solicitud sin centro falla (no hay ninguna llamada desde la interfaz) y la parte de Auth de `purgar-vencidos.ts` viejo bloquearía la cuenta de un usuario con dos centros. En producción había 0 solicitudes pendientes y 0 hilos dirección↔familia (2026-10-19).

## Verificación

- `src/test/audit/olvido-por-centro.test.ts`: una tutora con un hijo en A y otro en B.
  - Solicitud: sin centro ya no existe; la dirección de otro centro da 42501; un centro donde no está da `no_data_found`.
  - A y después B: la solicitud de A retira solo su rol de A y no bloquea la cuenta; purgar A borra lo de A y deja intacto lo de B y la cuenta; la de B bloquea la cuenta y su purga se lo lleva todo.
  - Con las dos pendientes, ninguna es la última hasta que se purga la otra.
  - `purgarUno`: las invitaciones de su centro, y la cuenta de Auth solo con el último.
  - El manifiesto: sin ser el último, solo el DNI de ese centro y ni el avatar.
- `src/test/rls/hilo-direccion-por-centro.rls.test.ts`: una directora de A y B y una tutora con hijos en los dos. Dos hilos, uno por centro; reabrir da el del centro; la dirección de otro centro no abre; la lista de la tutora, el badge de la directora y la pestaña Dirección, cada uno con el hilo de su centro.
- Los tests de purga que ya existían (un solo centro, es decir, el último) siguen pasando sin cambiar lo que comprueban.
- Ensayo de la migración contra producción en transacción revertida, también con CRLF y sin comentarios (como la deja el SQL Editor), y control negativo: con `solicitar_olvido_nino` cambiada, la guarda de entrada aborta.

## Referencias

- ADR-0057 (centro activo), ADR-0058 (familia por centro), `docs/specs/proteccion-datos.md` (F11-A4).
