# ADR-0062: El panel de plataforma y el alta de centros

## Estado

`accepted`

**Fecha:** 2026-10-22
**Autores:** responsable + claude-code
**Fase del proyecto:** Multicentro, Fase 5

## Contexto

Hasta la Fase 5, un centro nuevo solo podía nacer a mano: una migración o el SQL Editor, y la primera admin creada desde el panel de Supabase. Para dar de alta el ANAIA real (Fase 6) y los centros que vengan, el superusuario (ADR-0061) necesita verlos todos de un vistazo, crear uno y conseguirle una admin sin tocar la base de datos.

Tres cosas había que resolver antes de que existiera un segundo centro:

- **Las lecturas que confiaban en la RLS para acotar al centro.** La RLS dice quién ve una fila, no de qué centro es la página. Al superusuario y a quien tiene rol en dos centros les devuelve las filas de todos.
- **Qué ve el superusuario de cada centro sin entrar en él.** Entrar se audita (ADR-0061); mirar el panel no debía exigirlo, así que el panel no puede enseñar datos de personas.
- **Quién da la primera admin de un centro**, y qué pasa si un centro se queda sin ella.

## Opciones consideradas

### Opción A: el panel lee las tablas con la sesión del superusuario

El superusuario es admin de todos los centros, así que la RLS ya le deja leerlo todo. El panel contaría filas desde la app.

**Pros:** sin migración.

**Contras:** el panel tendría acceso a nombres, fichas y mensajes de todos los centros, y cada recuento repetiría en TypeScript su predicado de «activo». Un error de predicado contaría filas retiradas como vivas (lección BC-8 de MisterFC).

### Opción B: una RPC de métricas y RPCs de alta, solo para el superusuario

`SECURITY DEFINER`, la primera sentencia `is_superadmin()` y solo cifras. Crear un centro y su invitación de admin en una sola transacción.

**Pros:** los predicados viven en un único sitio, con su test RLS. El panel no recibe ningún dato de personas. Una guarda de la migración comprueba la puerta en el cuerpo.

**Contras:** cada métrica nueva es una migración.

### Opción C: crear el centro con `service_role` desde la app

**Contras:** `audit_log` no tendría actor humano. Además, centro, curso e invitación irían en tres escrituras sin transacción común: un fallo a mitad dejaría un centro sin curso o sin admin.

## Decisión

**Se elige la Opción B.** Va en cuatro PRs:

### PR 0 — las lecturas filtran por su centro (#392, sin migración)

- Un censo con el AST de TypeScript sobre todas las cadenas `.from()` encontró 19 consultas en 14 sitios que mezclaban centros. Ahora se acotan al centro de la página o del registro. Hay 9 más que acotaban en JS, y ahora llevan el filtro en la consulta.
- `scripts/check-lecturas-por-centro.mjs` (CI y unit) exige que toda lectura de una tabla de centro filtre por centro, por `id` o por una FK. Lo que cruza centros a propósito lleva `// entre-centros: <motivo>` (24 sitios).
- Detalle en `rls-policies.md`, «Las lecturas filtran por su centro».

### PR 1 — el panel (`20261103120000`, #393)

- **`platform_metricas()`**: una fila por centro vivo. Cuenta personas, niños, familias o aulas **distintas** con fila viva, cada recuento con su predicado explícito:
  - niños matriculados, y aparte los que están en alta;
  - familias;
  - personal, y aparte el de baja temporal;
  - Dirección;
  - aulas del curso activo;
  - invitaciones pendientes.
- **Alertas:** sin admin viva; sin curso activo; y, solo sin admin, el estado de la última invitación de admin (pendiente o caducada).
- **Mirar el panel no se audita** (decisión del responsable): solo enseña cifras. Entrar en un centro sigue pasando por `elegirCentro`, que lo registra.
- `/plataforma` lo guardan el proxy y su layout (`is_superadmin`; un fallo cuenta como «no»). «Salir del centro» vuelve al panel.

### El superusuario entra al panel (#394)

Al iniciar sesión va a `/plataforma`, no al selector de centro. Desde el panel elige centro, y esa entrada queda registrada. Un `returnTo` explícito se sigue respetando. Si la comprobación falla, va al selector, como cualquiera.

### PR 2 — crear un centro e invitar a su admin (`20261104120000`, #395)

- **`platform_crear_centro`**: en una transacción crea el centro, su curso `activo` y la invitación de su admin.
  - **Formulario** (decisiones del responsable): nombre, dirección, teléfono, email de contacto e idioma, sin SEPA ni logo. El curso se calcula por la fecha (a partir del 1 de agosto se propone el siguiente) y se puede cambiar. El email de la admin es obligatorio.
  - **No siembra nada más**: ni aulas, que las pone la directora, ni roles, autorizaciones o conceptos.
- **`platform_invitar_admin`**: la invitación de admin es solo de la plataforma, al crear el centro y siempre que se quede sin admin viva. Una directora o una admin no pueden invitar a otra admin.
  - Si el centro ya tiene admin viva, 55000: aceptarla chocaría con `idx_roles_usuario_una_admin_viva`.
  - Sin email, reenvía la última invitación con otros 7 días.
  - Con un email nuevo, caduca las pendientes (decisión del responsable): un email mal tecleado no deja dos invitaciones vivas a la cuenta responsable de un centro.
- **Las dos RPC escriben con la sesión del superusuario**, que queda como actor en `audit_log`.
- **Nombres de centro únicos, bloqueado** (decisión del responsable: no avisar, bloquear). Lo hace `idx_centros_nombre_vivo_unico`, entre centros vivos y sin distinguir mayúsculas ni espacios repetidos. Las tildes sí cuentan, porque no hay `unaccent`. También frena renombrar.
- **Aceptación tardía**: si el centro consiguió admin entre la invitación y la aceptación, la persona ve `centro_ya_tiene_admin` y no entra como admin.

## Consecuencias

### Positivas

- Un centro nace completo o no nace, sin SQL a mano, y su alta queda auditada con el superusuario como actor.
- El panel ve el estado de todos los centros sin acceder a datos de personas.
- Ninguna lectura de la app mezcla centros, y una nueva que lo haga se pone roja en la guarda.

### Negativas

- Cada métrica nueva del panel es una migración, con su md5 en la guarda.
- Dos centros cuyos nombres solo se distinguen por una tilde pueden convivir.
- El centro no se puede borrar ni archivar desde el panel. Los centros no se borran (`centros_responsable_delete` sigue en `follow-ups.md`).

### Neutras

- `createTestCentro` añade al nombre el principio del id, para que los tests que repiten un nombre fijo no choquen con el índice.
- El correo de invitación sale por `enviarCorreoInvitacion`, el mismo que usa `sendInvitation`.

## Plan de implementación

- [x] PR 0: censo, acotado y `check-lecturas-por-centro` (#392).
- [x] PR 1: `platform_metricas` y `/plataforma` (#393, migración aplicada el 2026-10-22).
- [x] Login del superusuario al panel (#394).
- [x] PR 2: `platform_crear_centro`, `platform_invitar_admin`, el índice de nombres y las pantallas (#395, migración aplicada el 2026-10-22).
- [ ] Fase 6: el responsable crea el ANAIA real desde el panel. Está bloqueada por el RAT y el DPA (ADR-0061, «Negativas»).

## Verificación

- **RLS:**
  - `platform-metricas.rls.test.ts`: cada estado no activo recorriendo los catálogos, las alertas y el 42501 a admin, directora, profe y anon;
  - `platform-crear-centro.rls.test.ts`: crear sin nada más, nombres, atomicidad, reenviar, otro email, los 42501 y la aceptación con y sin admin entre medias.
- **Guardas de las migraciones:** md5 normalizado del cuerpo, primera sentencia `is_superadmin()`, sin `es_admin`, `SECURITY DEFINER`, `search_path` y permisos. Cada una tiene sus controles negativos, ensayados en producción y en la CI.
- **En vivo, solo lectura (2026-10-22):**
  - las dos migraciones están registradas;
  - los md5 coinciden con el fichero;
  - anon recibe 42501 por la API.

## Referencias

- ADRs relacionados: ADR-0057 (centro activo), ADR-0061 (superusuario).
- `docs/architecture/rls-policies.md`: «Las lecturas filtran por su centro», «El panel de plataforma» y «Crear un centro e invitar a su admin».
