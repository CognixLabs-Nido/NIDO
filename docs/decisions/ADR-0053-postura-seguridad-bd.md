# ADR-0053: Postura de seguridad de la base de datos (auditoría de octubre de 2026)

## Estado

`accepted`. Las decisiones se tomaron y se aplicaron entre el 2026-10-01 y el 2026-10-09; este ADR
las documenta después, el 2026-10-10.

**Fecha:** 2026-10-01 (#283) → 2026-10-09 (#316)
**Autores:** responsable + claude-code
**Fase del proyecto:** F11-D, auditoría de seguridad. Incluye la limpieza de RPCs para anon y los
hallazgos R1–R5 de la auditoría de los 49 usos de `createServiceRoleClient` (2026-10-03).

## Contexto

A principios de octubre de 2026 una auditoría encontró varios agujeros con una misma raíz: **la base
de datos confiaba en cosas que no garantizaba ella misma.**

1. **Privilegios por defecto de Supabase.**
   - Cada función nueva nace con `EXECUTE` para `PUBLIC` y `anon`, y cada tabla con todos los
     privilegios (`arwdDxtm`) para `anon` y `authenticated`.
   - Con la anon key, que es pública porque va en el bundle, PostgREST podía ejecutar `_get_medical_key`
     y `_get_sepa_key`, que **devolvían las claves de cifrado de Vault sin ninguna guarda**
     (`20261002140000`).
   - El carácter de solo-añadir de `audit_log` descansaba solo en RLS, pero `TRUNCATE` y `MAINTAIN` no pasan por RLS (`20261001120000`).
2. **«`auth.uid()` NULL» tratado como si fuera el servicio.** Varias funciones `SECURITY DEFINER`
   (olvido, consentimientos) dejaban pasar a quien no tenía uid. Anon no tiene uid: podía pedir y
   ejecutar el olvido de cualquiera, o dar un consentimiento de imagen en nombre de un tutor
   inventado (`20261002140000`, `20261001130000`).
3. **Escrituras con service role que borraban al autor.** Cinco flujos escribían tablas auditadas
   con service role después de autorizar en la app. El trigger de auditoría grababa
   `usuario_id = NULL`: en ANAIA había 9 filas de `ninos` imposibles de atribuir (#307).
4. **Rutas e identificadores del cliente sin validar en la BD.**
   - Un tutor podía encolar en `cambios_pendientes` la ruta del documento de otra familia.
   - Una redactora podía meter en `media` la ruta de una foto ajena.
   - En los dos casos, la app la borraba o la escribía después con service role (R1 y R4).
5. **Multicentro sin garantizar en la BD.** Un admin del centro A podía escribir invitaciones y
   anuncios apuntando a niños o aulas del centro B (R2 y R3).
6. **RLS filtra filas, no columnas.** `matriculas.motivo_baja`, que puede llevar notas internas del
   centro, lo leía cualquiera que pudiera leer la fila: la familia y la profe (#316).
7. **Signup público abierto.** Cualquiera podía crear una cuenta sin invitación, en contra de
   ADR-0001 (D5, #310).

Hoy hay un solo centro y ningún dato real. Por eso varios agujeros no eran explotables en la
práctica, pero sí estaban **latentes**. Se cierran antes del primer dato real y antes de un segundo
centro.

## Opciones consideradas

> Son las disyuntivas que documentan las migraciones y los PRs.

| Tema                                   | Alternativas                                                                            | Elegida y motivo                                                                                                                                                                                                                          | Fuente           |
| -------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Helpers de RLS con `EXECUTE` para anon | revocarlos ya / **primero pasar las policies a `TO authenticated` y luego revocar**     | **Ese orden.** Revocar antes habría cambiado las lecturas de anon de «0 filas» a «permission denied for function», que además revela que la tabla existe y está protegida.                                                                | #297             |
| Autor real en `audit_log` (D2)         | policy de escritura para el tutor en `ninos` / **RPC `SECURITY DEFINER` con la sesión** | **RPC.** Una policy decide filas, no columnas: abriría al tutor las 23 columnas de `ninos`. La RPC conserva `auth.uid()`, porque `SECURITY DEFINER` cambia el rol pero no las claims.                                                     | #307             |
| Validar la ruta de `media` (R4)        | CHECK / **trigger**                                                                     | **Trigger.** `media` no tiene `aula_id` y un CHECK no puede consultar `publicaciones`. En `cambios_pendientes` (R1) sí basta un **CHECK**, porque la ruta se valida contra columnas de la propia fila.                                    | #300, #302       |
| Coherencia de centro (R2, R3)          | validarlo solo en la app / **trigger BEFORE en la BD**                                  | **Trigger.** Validarlo en `sendInvitation` no basta, porque PostgREST deja escribir directamente. El trigger aplica también a service role y al dueño con BYPASSRLS.                                                                      | `20261004120000` |
| `motivo_baja` solo para Dirección      | policy / vista / **permiso de columna + RPC**                                           | **Permiso de columna.** RLS no filtra columnas. La lectura legítima va por RPCs `SECURITY DEFINER`.                                                                                                                                       | #316             |
| Cerrar el signup (D5)                  | trigger en `handle_new_user` / **configuración de GoTrue**                              | **Configuración.** GoTrue aplica el `app_metadata` de admin después del INSERT, así que un trigger no distingue el alta en papel, la primera directora ni las fixtures. `DisableSignup` no afecta a la API de admin ni a la recuperación. | #310             |

## Decisión

**Se adoptan estos principios para todo objeto nuevo de la BD.** Cada uno indica dónde se aplicó.

### 1. Nada para `anon` ni para `PUBLIC` por defecto

- **Toda función nueva** lleva `REVOKE ALL ... FROM PUBLIC, anon`.
  - `GRANT EXECUTE TO authenticated` solo si la app la llama con sesión.
  - Las que solo usan el servidor o el cron tampoco se dan a `authenticated`.
- Aplicado:
  - **10 RPCs críticas** (#293). Las claves de Vault quedan solo para su dueño; `purgar_sujeto_db`,
    `olvido_pendientes` y las de esqueletos, solo para `service_role`.
  - **35 RPCs del grupo B**, solo ACL (#295).
  - **20 helpers de RLS** (#297).
  - Las RPCs de consentimiento de imagen (#284).
- **Toda policy de la app es `TO authenticated`.** Las 156 que eran `TO public` pasaron a
  `TO authenticated` y una guarda impide que quede ninguna. La única excepción deliberada es
  `storage.objects · centro_assets_select`: el logo del bucket público, ADR-0010.

### 2. «Sin uid» nunca es el servicio

Cuando `auth.uid()` es NULL, una función `SECURITY DEFINER` solo deja pasar a:

- `auth.role() = 'service_role'`;
- una **sesión directa sin JWT**: `session_user <> 'authenticator'` y sin `request.jwt.claims`.
  Ejemplo: el SQL Editor.

PostgREST entra siempre como `authenticator`, así que una petición anónima nunca cuenta como sesión
directa. Todo lo demás da 42501. Aplicado en #284 y #293. En la migración, el cambio va marcado
como `[CRIT-ANON]`.

### 3. `audit_log`: solo añadir, también por permisos

A `anon` y `authenticated` se les revocan `TRUNCATE`, `MAINTAIN`, `UPDATE`, `DELETE`, `INSERT`,
`REFERENCES` y `TRIGGER`; a `anon` también `SELECT` (#283).

- `authenticated` conserva `SELECT` para la página de auditoría, que filtra RLS.
- Solo escriben `audit_trigger_function` y `purgar_sujeto_db`, las dos `SECURITY DEFINER` con dueño
  `postgres`.

### 4. El autor real queda en la auditoría

Las escrituras en tablas auditadas se hacen **con la sesión del usuario**, no con service role.

- Cuando la RLS no basta (escribir columnas concretas de `ninos`), se usa una RPC `SECURITY DEFINER`
  que la app llama con el cliente de sesión: `actualizar_familia_nino`, `fijar_libro_familia_nino` y
  `quitar_foto_perfil_nino` (D2, #307).
- El service role queda para Storage y para un **censo de escrituras justificadas**, recogido en
  #307 (por ejemplo, `accept-invitation`).
- **La migración de #307 se pegó mal en producción** y hubo que repararla con `20261005140000`
  (#308), con guardas que comparan lógica normalizada.

### 5. Todo lo que llega del cliente se valida en la BD contra la fila

Rutas e identificadores que la app usará después con service role se validan **en la BD, contra la
propia fila o la entidad con la que se relaciona, nunca contra el valor de entrada**:

- **CHECK `cambios_pendientes_ruta_documento_del_nino`** (R1, #300): `{centro}/{niño}/<nombre>.pdf`.
- **Trigger `media_validar_ruta_trg`** (R4, #302): `{centro}/{aula}/{publicacion}/<nombre>.jpg`, con
  el prefijo sacado de la publicación de la fila.
- La app valida lo mismo antes de borrar (`rutaDocumentoDelNino`, `rutaDeLaPublicacion`), como
  segunda capa.

Del mismo frente (#302):

- **D1:** los barridos irreversibles (`purgarVencidos`, `barrerRetencion`) dejan de ser server
  actions y pasan a `server-only`. Solo los llama el cron.
- **R5 y D3:** se autoriza **antes** de crear el cliente service role o de leer nada.

### 6. Multicentro garantizado en la BD

- Triggers BEFORE INSERT OR UPDATE:
  - **`invitaciones_validar_centro_trg`**: el niño y el aula son del centro;
  - **`anuncios_validar_aula_centro_trg`**: el aula es del centro.
- La rama admin de `anuncios_insert` y los helpers de audiencia de anuncios comprueban el centro
  (`20261004120000`, R2 y R3).
- En la app, la audiencia de las notificaciones push filtra por centro.
- Precedente de la misma idea: `beca_comedor_mes` (D-6-1b, D-6-1c) exigía `centro_de_nino(nino_id)
= centro_id` en el WITH CHECK.

### 7. Columnas que solo puede leer Dirección: permiso de columna

Si una tabla compartida tiene una columna que solo debe leer Dirección, se quita el `SELECT` de
tabla y se concede `SELECT (columnas…)` sin ella. La lectura legítima va por RPCs
`SECURITY DEFINER` con su propia autorización (#316):

- `get_motivos_baja_matriculas`, para la admin del centro de todos los niños pedidos;
- `get_recorrido_nino_familia`, para el tutor legal: sin el motivo ni los tramos pendientes.

**Cada columna nueva de `matriculas` necesita su `GRANT SELECT (columna)` explícito.**

### 8. Signup público cerrado por configuración (D5)

- `[auth] enable_signup = false` en `config.toml`, y «Allow new users to sign up» desactivado en el
  panel (#310 y #311).
- Todas las cuentas legítimas las crea el servidor con la API de admin.
- `[auth.email] enable_signup` se queda en `true` a propósito: en la CLI esa clave enciende el
  proveedor de email, y a `false` apagaría todos los logins.

### 9. D4: el oráculo de email queda como riesgo aceptado

> ⚠️ **Fuente: decisión del responsable, sin PR ni migración.** Este apartado documenta una decisión
> tomada durante la auditoría (2026-10-08) que no consta en el repositorio. **El responsable tiene
> que confirmar el texto.**

- **El riesgo:** la vista previa del alta, `resolverTutorParaProspecto`
  (`src/features/lista-espera/actions/resolver-tutor.ts`), deja saber a una admin si un email ya
  tiene cuenta en NIDO. Es un bit de información.
  - Solo lo puede consultar una admin del centro (`esAdminDelCentro`).
  - Devuelve la clase de la cuenta y, como mucho, la etiqueta de la familia del propio centro, nunca
    datos de la cuenta.
- **Se acepta sin cambiar código** mientras haya un solo centro.
- **Huecos que se vieron al diagnosticarlo, a cerrar juntos si llega un segundo centro real:**
  - al promover un prospecto se vincula en silencio una cuenta de otro centro;
  - aceptar una invitación con una cuenta que ya existe no enlaza `familia_tutores.usuario_id`;
  - una cuenta que ya existe no recibe aviso de su invitación.

## Consecuencias

### Positivas

- Con la anon key no se puede llamar a ninguna RPC ni helper de la app, y ninguna policy de la app se
  evalúa para anon.
- Las claves de cifrado ya no salen de la BD.
- La auditoría registra a la persona real en los flujos que antes dejaban `usuario_id = NULL`.
- Las rutas e identificadores del cliente ya no pueden hacer que el servidor borre o enlace objetos
  ajenos, ni cruzar de centro.
- Queda un patrón para los datos de una sola columna.

### Negativas

- **Cada objeto nuevo necesita su ACL explícita**: `REVOKE` en las funciones y `GRANT` de columna en
  `matriculas`. Si se olvida, el fallo es silencioso a favor de anon (default privileges) o deja a
  todos con 42501 (columnas).
- Un `select=*` o un embed `matriculas(*)` con sesión da **42501**, también a la admin.
- Siguen escrituras con service role en tablas auditadas. Están en el censo de #307 y justificadas.
  Las purgas no tienen todavía un `actor_sistema`.
- D4 sigue abierto por decisión: los tres huecos hay que cerrarlos antes de que una cuenta pueda
  pertenecer a dos centros.

### Neutras

- Algunas lecturas que daban «0 filas, sin error» pasan a 42501. Por ejemplo, el UPDATE o DELETE de
  `audit_log`. Los tests se ajustaron.
- Cada PR de seguridad trajo su flag `*_APPLIED` y su PR de una línea para la suite nocturna.

## Plan de implementación

Ejecutado:

- [x] #283: `audit_log` con REVOKE (`20261001120000`).
- [x] #284, #286: RPCs de consentimiento de imagen: gate sin uid, `p_tutor` forzado y solo el tutor
      legal.
- [x] #293, #295, #297: anon fuera de las 10 RPCs críticas, de las 35 del grupo B y de los 20
      helpers, y las 156 policies a `TO authenticated`.
- [x] #300: R1, rutas de `cambios_pendientes`.
- [x] #302: R4 (rutas de `media`), D1, R5 y D3.
- [x] #304, #305: R2 y R3 multicentro, con guardas normalizadas.
- [x] #307, #308: D2, actor humano, y la reparación en producción.
- [x] #310: D5, signup cerrado. El panel lo cambió el responsable el 2026-10-08.
- [x] #316: `motivo_baja` por permiso de columna.

## Verificación

- **Tests RLS con flag**, en la BD efímera de cada PR y en la suite nocturna contra producción:
  - `AUDIT_LOG_REVOKE_APPLIED`, `CONSENT_IMAGEN_RPC_SEGURIDAD_APPLIED`,
    `CONSENT_IMAGEN_TUTOR_LEGAL_APPLIED`;
  - `RPC_CRITICAS_ANON_APPLIED`, `RPC_GRUPO_B_ANON_APPLIED`, `RLS_HELPERS_ANON_APPLIED`;
  - `CAMBIOS_PENDIENTES_RUTA_APPLIED`, `MEDIA_RUTA_APPLIED`, `MULTICENTRO_APPLIED`;
  - `ACTOR_HUMANO_APPLIED`, `SIGNUP_CERRADO_APPLIED`, `MATRICULAS_MOTIVO_COLUMNA_APPLIED`.
- **Guardas dentro de las migraciones:**
  - #297 aborta si queda alguna policy `TO public` o si anon conserva `EXECUTE` en algún helper;
  - #316 comprueba los privilegios al final.
- **Ensayos en producción** antes de aplicar: en una transacción que termina en
  `RAISE EXCEPTION`, sin COMMIT. Cada uno reproduce el agujero antes del cambio e incluye controles
  negativos. Ejemplo: el ensayo de R4 en #302.

## Notas

- **Fuentes:** las cabeceras de las migraciones citadas y los cuerpos de los PRs #284, #297, #302,
  #307, #310 y #316. D4 es la excepción, ver el apartado 9.
- **Choque de nombre:** «F11-D» en `docs/follow-ups.md` es el barrido de `createServiceClient` de
  junio (#132). La auditoría de octubre reutiliza el nombre para sus hallazgos D1–D5. Los hallazgos
  R1–R5 vienen de la auditoría de los usos de `createServiceRoleClient` (2026-10-03, ver #299).
- **Lección de proceso** (regla en `CLAUDE.md` desde #305): las guardas de equivalencia de las
  migraciones que se aplican por el SQL Editor comparan la lógica normalizada (sin `\r`, sin
  comentarios y con los espacios colapsados), no los bytes.

## Referencias

- **Migraciones:** `20261001120000_fix_audit_log_revoke_anon_authenticated`,
  `20261001130000_fix_consent_imagen_rpc_seguridad`,
  `20261002120000_fix_consent_imagen_solo_tutor_legal`, `20261002140000_fix_rpc_criticas_anon`,
  `20261002150000_fix_rpc_grupo_b_anon`, `20261002160000_fix_policies_authenticated_helpers_anon`,
  `20261003120000_fix_cambios_pendientes_ruta_documento`,
  `20261003140000_fix_media_ruta_publicacion`,
  `20261004120000_fix_multicentro_anuncios_invitaciones`,
  `20261005120000_fix_actor_humano_rpcs_ninos`, `20261005140000_fix_reparar_rpcs_actor_humano`,
  `20261009120000_fix_matriculas_motivo_baja_por_columna`.
- **ADRs relacionados:**
  - ADR-0001: acceso solo por invitación;
  - ADR-0002 y ADR-0007: helpers de RLS en `public` y sin recursión;
  - ADR-0004: cifrado pgcrypto + Vault;
  - ADR-0010: logo en el bucket público.
- **Documentación:** `docs/architecture/rls-policies.md`, sección «Postura de seguridad (octubre de
  2026)».
