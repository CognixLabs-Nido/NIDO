# ADR-0061: El superusuario

## Estado

`accepted`

**Fecha:** 2026-10-19
**Autores:** responsable + claude-code
**Fase del proyecto:** Multicentro, Fase 3

## Contexto

Para dar de alta centros nuevos y atenderlos, Cognix Labs necesita una cuenta que entre en cualquier centro con los permisos de la directora. Hasta ahora esa cuenta era la admin de CEI Ejemplo (antes ANAIA) y solo valía para ese centro.

Decisiones del responsable (2026-10-19):

- Un solo superusuario, con acceso total: es admin de todos los centros. Cada entrada a un centro queda auditada.
- Su rol de admin en CEI Ejemplo se retira (borrado lógico con su motivo): entra ahí como en cualquier otro centro. En la misma migración entra una directora en CEI Ejemplo, para que el centro no quede ni un momento sin admin.
- Es admin, no profe ni tutor. Si fuera tutor podría firmar autorizaciones o consentimientos en nombre de una familia.

## Opciones consideradas

### Opción A: una tabla `platform_admins` y `es_admin` con `OR is_superadmin()`

Como en MisterFC: quién es superusuario lo dice una tabla sin policies, y el permiso entra por el helper que ya usan casi todas las policies.

**Pros:** `es_admin(centro)` aparece en 177 de las 245 policies y lo llaman 44 funciones (censo del 2026-10-19). Un solo cambio cubre casi todo, y lo que no pasa por él se puede censar. El superusuario no tiene filas en `roles_usuario`, así que no sale en los recuentos de ningún centro ni recibe lo que va dirigido a las directoras.

**Contras:** hay que encontrar los permisos de admin que no pasan por `es_admin`.

### Opción B: una fila de admin en `roles_usuario` por cada centro

**Contras:** cada centro nuevo necesita su fila. El superusuario contaría como una directora más (recuentos, destinatarios de avisos, «centro sin directora»). Y la entrada a un centro no se distinguiría de la de una directora.

### Opción C: un claim en el token de sesión

**Contras:** la base de datos tendría que confiar en un dato que firma Auth. Quitar el permiso no surte efecto hasta que caduca el token.

## Decisión

**Se elige la Opción A.**

### Base de datos (`20261023120000` y `20261023120100`)

- **`platform_admins(usuario_id, created_at)`**: RLS activada, ninguna policy y ningún permiso para `anon` ni `authenticated`. Se escribe solo en migraciones; desde la app solo se pregunta, con `is_superadmin()`. Un censo (`platform-admins.test.ts`) se pone rojo si el código de `src/` la nombra. No se audita: su histórico es git.
- **`is_superadmin()`**: ¿quien llama está en `platform_admins`?
- **`es_admin(centro)`**: el superusuario es admin de todo centro que **exista**. Con un centro inexistente da FALSE, como a cualquier admin (sin esto podría escribir en carpetas de Storage de un centro que no existe). Con NULL («admin de algún centro») da TRUE, igual que a cualquier admin. Censo previo: en producción no hay ninguna llamada a `es_admin(NULL)`. Las cuatro que aparecen son comentarios de funciones que ya rechazan el centro NULL antes de preguntar, porque ese hueco ya existía para cualquier admin.
- **Lo que no pasaba por `es_admin`**, medido y arreglado en la misma migración:
  - las lecturas del calendario laboral y de los menús (`dias_centro_select`, `plantillas_menu_select`, `menu_dia_select`), que la directora hacía como miembro del centro: se añade `OR es_admin`;
  - los avatares (`es_admin_de_usuario`, `es_staff_de_usuario`), que leían el rol de quien llama en `roles_usuario`: ahora preguntan a `es_admin` y a `es_profe_en_centro`;
  - `firma_imagen_sync`: la firma presencial de Dirección también genera el consentimiento de imagen cuando la hace el superusuario (`firmas_insert` le deja firmar por `es_admin`).
- **`usuarios_admin_select` y `consentimientos_admin_select`** no cambian. Leen `roles_usuario` del usuario **objetivo**, pero el permiso lo da `es_admin(ru.centro_id)`, así que el superusuario ya entra.
- **No va en los helpers de profe ni de tutor** (`es_profe_*`, `es_tutor_*`, `tiene_permiso_sobre`, `pertenece_a_centro`).
- **Entrada auditada**: `registrar_entrada_superusuario(centro)` escribe en `audit_log` una fila `tabla = 'entrada_superusuario'` con el centro (`registro_id` y `centro_id`) y el actor (`usuario_id`), sin valores. No hay datos de ningún sujeto, así que la purga no tiene nada que limpiar. Está dada de alta en `data-model.md`, y `audit-log-eventos-directos.test.ts` exige que cada evento que una función escriba directamente en `audit_log` esté ahí. La directora del centro ve esas filas (`audit_admin_select`).
- **Siembra y relevo**:
  - la migración busca la cuenta del responsable por email. Si no la encuentra, no siembra y lo dice; imprime el recuento en los dos casos;
  - si es admin de CEI Ejemplo, en la misma transacción da el rol de admin a la directora (`jovimib+director@gmail.com`) y retira el suyo con el motivo `paso_a_superusuario`, que va en su propia migración porque Postgres no deja usar un valor de enum en la transacción que lo crea;
  - la cuenta de la directora la crea el responsable en Supabase Auth antes de aplicar. Sin ella la migración aborta entera;
  - la guarda de salida comprueba que ningún centro que tenía admin se queda sin él.

### App (PR siguiente)

- `getContextoCentro` le da rol `admin` en cualquier centro, y el proxy le deja pasar a `/admin`.
- `elegirCentro` llama a `registrar_entrada_superusuario` antes de escribir la cookie. Si la auditoría falla, no entra.

## Consecuencias

### Positivas

- El superusuario entra en cualquier centro como la directora, sin filas en `roles_usuario`.
- Cada entrada queda en `audit_log`, y la ve la directora de ese centro.
- CEI Ejemplo tiene directora propia y el superusuario ya no cuenta como una.

### Negativas

- El superusuario hereda **todo** lo que puede una directora. Eso incluye los registros presenciales en nombre de una familia: la firma presencial de una autorización, el consentimiento de imagen presencial (queda a nombre del tutor, sin rastro de quién lo registró, igual que hoy con la directora) y el mandato SEPA presencial.
- Un permiso de admin futuro que no pase por `es_admin` dejará fuera al superusuario sin que nada se ponga rojo. Lo cubren el censo de esta ADR y el test de RLS `superusuario.rls.test.ts`, no un guard.
- La lectura de la ficha médica no se audita para nadie, tampoco para el superusuario (en MisterFC se auditaba aparte, `medical.read.platform`). Pendiente de decisión.
- ⚖️ Cognix Labs accede a datos de salud de menores de todos los centros: tiene que constar en el RAT y en el contrato de encargado (DPA). Va al abogado.

### Neutras

- El superusuario puede ser además profe o tutor en un centro con su propio rol; ese rol funciona como el de cualquiera.

## Plan de implementación

- [x] `20261023120000`: el motivo `paso_a_superusuario`.
- [x] `20261023120100`: tabla, helpers, permisos, entrada auditada, siembra y relevo, con guardas de entrada y salida.
- [x] Tests: `superusuario.rls.test.ts`, `platform-admins.test.ts` y `audit-log-eventos-directos.test.ts`.
- [ ] App: `getContextoCentro`, proxy y `elegirCentro` con la entrada auditada.
