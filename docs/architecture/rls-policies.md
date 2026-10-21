# Políticas RLS — NIDO

## Principios

- **Default DENY ALL** en todas las tablas.
- Service role bypass para Edge Functions (nunca expuesto al cliente).
- Funciones helper `SECURITY DEFINER` con `STABLE` y `search_path` explícito.
- **Antipatrón prohibido**: subqueries inline `(SELECT col FROM otra_tabla WHERE ...)` dentro de `USING (...)` — causa recursión RLS (SQLSTATE 42P17). Ver [ADR-0007](../decisions/ADR-0007-rls-policy-recursion-avoidance.md).
- **Nada para `anon` ni para `PUBLIC`.** Toda policy de la app es `TO authenticated` y toda función nueva lleva `REVOKE ALL … FROM PUBLIC, anon`. Una RPC solo se da a `authenticated` si la app la llama con sesión. Ver la sección «Postura de seguridad (octubre de 2026)» y [ADR-0053](../decisions/ADR-0053-postura-seguridad-bd.md).
- **«Sin uid» nunca es el servicio.** En una función `SECURITY DEFINER`, `auth.uid()` NULL solo deja pasar a `service_role` o a una sesión directa sin JWT, como el SQL Editor.
- **El superusuario es admin, no profe ni tutor** ([ADR-0061](../decisions/ADR-0061-superusuario.md)). `es_admin(centro)` le da TRUE en todo centro que exista (`is_superadmin()`, tabla `platform_admins` sin policies). Un permiso de admin nuevo pasa por `es_admin`, o por `privado.es_responsable` si es de lo que solo hace la admin del centro (ver «Lo exclusivo de la admin»); si lee el rol de quien llama en `roles_usuario`, deja fuera al superusuario. Nunca en los helpers de profe ni de tutor. Los registros presenciales en nombre de una familia (firma presencial, consentimiento de imagen presencial, mandato SEPA presencial) son solo de la directora: su rama de admin lleva `AND NOT is_superadmin()`.

## Funciones helper

> **Nota:** viven en `public.*`, no `auth.*`. Supabase Cloud no permite crear funciones en el schema `auth`. Decisión documentada en [ADR-0002](../decisions/ADR-0002-rls-helpers-in-public-schema.md).

```sql
-- Fase 1
public.usuario_actual()                                  → uuid
public.es_admin(p_centro_id uuid DEFAULT NULL)           → boolean  -- Dirección: admin o directora + superusuario

-- Multicentro, Fase 3 (ADR-0061)
public.is_superadmin()                                   → boolean

-- Modelo de roles, PR 1 (20261029120000): solo la admin del centro (+ superusuario); NULL → FALSE
privado.es_responsable(p_centro_id uuid)                 → boolean

-- Fase 2 (originales)
public.pertenece_a_centro(p_centro_id uuid)              → boolean
public.es_profe_de_aula(p_aula_id uuid)                  → boolean
public.es_tutor_de(p_nino_id uuid)                       → boolean
public.tiene_permiso_sobre(p_nino_id uuid, p_permiso text) → boolean

-- Fase 2 (añadidas en migración correctiva para evitar recursión)
public.centro_de_nino(p_nino_id uuid)                    → uuid
public.centro_de_aula(p_aula_id uuid)                    → uuid
public.es_profe_de_nino(p_nino_id uuid)                  → boolean

-- Fase 3
public.dentro_de_ventana_edicion(p_fecha date)           → boolean

-- Fase 4
public.hoy_madrid()                                      → date

-- Fase 4.5a
public.tipo_de_dia(p_centro_id uuid, p_fecha date)       → tipo_dia_centro
public.centro_abierto(p_centro_id uuid, p_fecha date)    → boolean

-- Fase 4.5b
public.nino_toma_comida_solida(p_nino_id uuid)           → boolean
public.centro_de_plantilla(p_plantilla_id uuid)          → uuid
public.menu_del_dia(p_centro_id uuid, p_fecha date)      → menu_dia

-- Fase 5
public.centro_de_conversacion(p_conv_id uuid)            → uuid
public.nino_de_conversacion(p_conv_id uuid)              → uuid
public.puede_participar_conversacion(p_conv_id uuid)     → boolean
public.usuario_es_audiencia_anuncio(p_anuncio_id uuid)   → boolean
-- Row-aware: usada en anuncios_select para evitar el gotcha MVCC.
public.usuario_es_audiencia_anuncio_row(
  p_centro_id uuid, p_autor_id uuid,
  p_ambito public.ambito_anuncio, p_aula_id uuid
)                                                        → boolean
```

Todas con `LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public`.

> **Desde `20261028120000` (PR 2b de la Fase 4),** `centro_de_nino`, `centro_de_aula`,
> `centro_de_plantilla` y otras 22 auxiliares de las policies viven en el esquema `privado`, que la
> API no expone. Los ejemplos de este documento las escriben con `public.` porque son de antes. Ver
> «Funciones auxiliares fuera de la API».

## Patrón: helpers para lookups en políticas

**Antipatrón** (recursión RLS garantizada):

```sql
CREATE POLICY ime_admin_all ON public.info_medica_emergencia
  FOR ALL USING (
    public.es_admin((SELECT centro_id FROM public.ninos WHERE id = info_medica_emergencia.nino_id))
  );
```

La subquery `SELECT centro_id FROM ninos` se ejecuta en el contexto del invocador y dispara las políticas RLS de `ninos`, que a su vez referencian `matriculas` cruzadamente → recursión.

**Patrón correcto** (lookups en helpers `SECURITY DEFINER`):

```sql
CREATE OR REPLACE FUNCTION public.centro_de_nino(p_nino_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT centro_id FROM public.ninos WHERE id = p_nino_id;
$$;

CREATE POLICY ime_admin_all ON public.info_medica_emergencia
  FOR ALL USING (public.es_admin(public.centro_de_nino(nino_id)));
```

Ver detalle completo en [ADR-0007](../decisions/ADR-0007-rls-policy-recursion-avoidance.md).

## Gotcha MVCC: helpers en policies SELECT evaluadas vía `INSERT … RETURNING`

> **Aprendizaje crítico de Fase 5** (migración correctiva `20260525201151_phase5_fix_audience_returning.sql`). Cualquier nueva policy que se evalúe sobre filas recién insertadas por la misma sentencia debe seguir esta regla.

### Síntoma

Un cliente PostgREST (o supabase-js) hace `from('tabla').insert(...).select('id')`. El INSERT pasa la WITH CHECK pero la operación entera devuelve `42501 — new row violates row-level security policy for table "tabla"`. El error parece confuso porque el INSERT estaba autorizado.

### Causa

PostgREST traduce `.insert(...).select(...)` a `INSERT INTO tabla (...) VALUES (...) RETURNING ...`. La cláusula `RETURNING` evalúa la **policy de SELECT** sobre la fila recién insertada **dentro de la misma sentencia**. Si la USING de SELECT invoca un helper `STABLE SECURITY DEFINER` que hace un lookup interno a la propia tabla (p. ej. `SELECT * FROM tabla WHERE id = NEW.id`), Postgres garantiza que esa función **no ve los cambios producidos por la sentencia que la invoca** — la fila aún no es visible para el helper STABLE. Resultado: el helper devuelve FALSE, la policy de SELECT rechaza, y el cliente recibe `42501`.

El INSERT en sí ocurrió (la fila se persiste). Lo que falla es el `RETURNING`. Por eso un `.insert(...)` sin `.select()` parece "funcionar" — la fila se inserta pero el cliente no recibe el id.

### Regla

> **Si un helper SQL se usa en la policy de SELECT de una tabla, y la aplicación hace `INSERT … RETURNING` sobre esa misma tabla, el helper NO debe hacer lookup interno a la tabla. Debe ser "row-aware": recibir los campos de la fila por parámetro y operar sobre ellos sin re-leer.**

### Patrón anti-MVCC (anti-patrón)

```sql
-- ❌ Falla en INSERT … RETURNING sobre `anuncios`
CREATE FUNCTION public.usuario_es_audiencia_anuncio(p_anuncio_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.anuncios%ROWTYPE;
BEGIN
  SELECT * INTO a FROM public.anuncios WHERE id = p_anuncio_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  -- ... lógica usando a.centro_id, a.autor_id, etc.
END $$;

CREATE POLICY anuncios_select ON public.anuncios
  FOR SELECT
  USING (public.usuario_es_audiencia_anuncio(id));
```

### Patrón row-aware (correcto)

```sql
-- ✅ Recibe los campos por parámetro; no hace lookup a `anuncios`
CREATE FUNCTION public.usuario_es_audiencia_anuncio_row(
  p_centro_id uuid,
  p_autor_id  uuid,
  p_ambito    public.ambito_anuncio,
  p_aula_id   uuid
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- ... lógica usando p_centro_id, p_autor_id, etc.
END $$;

CREATE POLICY anuncios_select ON public.anuncios
  FOR SELECT
  USING (public.usuario_es_audiencia_anuncio_row(centro_id, autor_id, ambito, aula_id));
```

### Cuándo aplica y cuándo no

- **Aplica**: SELECT policy sobre una tabla cuya INSERT con `RETURNING` ejecuta cliente. Caso típico: cualquier tabla que se inserte y se lea inmediatamente desde la app (la mayoría).
- **No aplica**: helpers que leen una tabla **distinta** a la que se está insertando (la fila ya existe en la otra tabla en sentencias previas, sin conflicto MVCC). Por ejemplo `puede_participar_conversacion(conversacion_id)` se usa en la policy de SELECT/INSERT de `mensajes`: el helper consulta `conversaciones`, que ya existía. Sin problema.
- **No aplica**: SELECT directos sin INSERT en la misma sentencia (lectura normal).

### Cómo se descubre

Sintomatología típica que delata el bug:

1. Tests RLS de "el usuario X puede insertar" fallan con `42501` aunque la WITH CHECK del INSERT esté correcta.
2. Hacer `client.from('tabla').insert(payload)` sin `.select()` devuelve `error: null` — la fila se insertó.
3. Hacer la misma operación con `.select()` falla.
4. Los helpers de SELECT, ejecutados por separado vía RPC desde la misma sesión, devuelven `true`.

Si tienes 3 de 4, es este gotcha. Convierte el helper en row-aware y la policy se evalúa contra los valores del NEW.

### Aplicación en F5

- `anuncios_select` se reescribió para usar `usuario_es_audiencia_anuncio_row(centro_id, autor_id, ambito, aula_id)`.
- `usuario_es_audiencia_anuncio(uuid)` (versión por id) se mantuvo: sigue siendo correcta para `lectura_anuncio_insert.WITH CHECK`, donde el anuncio ya existe en sentencias previas.

### Implicaciones para fases siguientes

F8 (autorizaciones), F9 (informes), F10 (publicaciones) tendrán este patrón cuando inserten filas que luego se leen con RLS. Antes de escribir una policy SELECT que invoque un helper, comprobar: ¿el helper lee la misma tabla del INSERT? Si sí, hacer el helper row-aware.

## Cifrado de columnas sensibles

Las funciones `public.set_info_medica_emergencia_cifrada(...)` y `public.get_info_medica_emergencia(...)`:

- Son `SECURITY DEFINER` con `search_path = public, extensions` (pgcrypto vive en `extensions`).
- Leen la clave de Supabase Vault con `name='medical_encryption_key'` vía la función interna `public._get_medical_key()`.
- Incorporan autorización (admin del centro / profe del aula actual / tutor con `puede_ver_info_medica=true`) antes de descifrar.
- Contrato del setter: NULL = preservar campo (no sobrescribe con NULL). Ver ADR-0004.

## Audit log automático

`audit_trigger_function()` SECURITY DEFINER aplicada `AFTER INSERT OR UPDATE OR DELETE` en:

- `centros`, `ninos`, `info_medica_emergencia`, `vinculos_familiares`, `roles_usuario`, `matriculas`, `datos_pedagogicos_nino`, `agendas_diarias`, `comidas`, `biberones`, `suenos`, `deposiciones`, `asistencias`, `ausencias`, `dias_centro`, `plantillas_menu_mensual`, `menu_dia`, `conversaciones`, `mensajes`, `anuncios`, `recordatorios`.

Esa lista es la de Fase 2. Hoy son **62 tablas**; la lista completa, las columnas excluidas y las que no se auditan a propósito están en `data-model.md` («Reglas obligatorias»). Desde `20261011120000` (Grupo 1, PR A) la función quita columnas del JSON antes de grabar: nada entra en `audit_log` que la redacción de la purga RGPD no sepa limpiar.

Deriva `centro_id` con un IF/ELSIF por tabla. RLS en `audit_log`:

- SELECT solo para la admin del centro del registro (`privado.es_responsable(centro_id)`, desde `20261029120000`). Las filas sin centro (las de `usuarios`) solo las lee `service_role`. Hasta esa migración la policy era `es_admin(centro_id)`, y con NULL cualquier admin de cualquier centro las leía.
- INSERT solo desde la función trigger (SECURITY DEFINER bypassa).
- UPDATE/DELETE bloqueados a TODOS los roles (append-only estricto).
- **También por permisos** (`20261001120000`, #283). `anon` y `authenticated` no tienen `TRUNCATE`, `MAINTAIN`, `UPDATE`, `DELETE`, `INSERT`, `REFERENCES` ni `TRIGGER`, porque `TRUNCATE` y `MAINTAIN` no pasan por RLS. `anon` tampoco tiene `SELECT`. Un UPDATE o DELETE de un usuario da **42501**, no «0 filas».

## Roles

| Rol           | Descripción                                                         |
| ------------- | ------------------------------------------------------------------- |
| `admin`       | Acceso total al centro. Una viva por centro (`20261030130000`)      |
| `directora`   | Dirección: el día a día de `es_admin`, sin lo exclusivo de la admin |
| `profe`       | Sus aulas asignadas (`profes_aulas` activos) con su rol vivo        |
| `tutor_legal` | Sus hijos vía `vinculos_familiares`, con permisos JSONB granulares  |
| `autorizado`  | Como tutor_legal pero con permisos por defecto a `false`            |
| `service`     | Edge Functions (bypass RLS)                                         |

## Ventana de edición y "día cerrado" (transversal — Fase 3 + Fase 4)

> **Cambio respecto a doc previo:** la regla anterior ("hasta 06:00 del día siguiente, admin edita histórico") **queda derogada** por [ADR-0013](../decisions/ADR-0013-ventana-edicion-mismo-dia.md). En Fase 4, [ADR-0016](../decisions/ADR-0016-dia-cerrado-transversal.md) eleva esta regla a **principio transversal del producto**: toda tabla operativa que registra hechos diarios sigue la misma ventana. Aplica a la agenda (5 tablas de F3) y a `asistencias` (F4). Las ausencias futuras se rigen por una regla análoga pero distinta (ver `hoy_madrid()` abajo).

- Profe / admin editan **agenda y asistencia** solo si `fecha = (now() AT TIME ZONE 'Europe/Madrid')::date` (helper `public.dentro_de_ventana_edicion(fecha)`, ver [ADR-0011](../decisions/ADR-0011-ventana-edicion-timezone-madrid.md)).
- A las 00:00 hora Madrid del día siguiente, **read-only para todos los roles** (incluido admin) por RLS.
- Correcciones de histórico solo vía SQL con `service_role` (queda en `audit_log` igualmente).
- `DELETE` bloqueado a todos por default DENY: eventos erróneos se marcan con `UPDATE observaciones = '[anulado] ' || COALESCE(observaciones, '')` (agenda) o con prefijo `[cancelada] ` en `ausencias.descripcion` (F4).

Helpers gemelos (viven en `public.*`):

```sql
CREATE OR REPLACE FUNCTION public.hoy_madrid()
RETURNS date
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (now() AT TIME ZONE 'Europe/Madrid')::date;
$$;

CREATE OR REPLACE FUNCTION public.dentro_de_ventana_edicion(p_fecha date)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_fecha = (now() AT TIME ZONE 'Europe/Madrid')::date;
$$;
```

**Diferencia entre `hoy_madrid()` y `dentro_de_ventana_edicion(fecha)`**:

- `hoy_madrid()` devuelve la fecha "hoy" en huso Madrid. Se usa en las RLS de `ausencias` para "solo desde hoy en adelante" (`fecha_inicio >= public.hoy_madrid()`).
- `dentro_de_ventana_edicion(fecha)` compara una fecha dada con hoy Madrid (`fecha = hoy_madrid()`). Se usa en RLS de agenda y asistencia para "solo el día corriente, ni ayer ni mañana".

## Asistencia y ausencias (Fase 4)

- **`asistencias`**: lazy ([ADR-0015](../decisions/ADR-0015-asistencia-lazy.md)). Solo se crean por la profe vía `upsertAsistencia` / `batchUpsertAsistencias`. RLS de INSERT/UPDATE exige `dentro_de_ventana_edicion(fecha) AND (es_admin(centro_de_nino) OR es_profe_de_nino)`. DELETE bloqueado.
- **`ausencias`**:
  - SELECT: admin del centro, profe del aula actual, o tutor con `puede_ver_agenda=true`.
  - INSERT: admin/profe sin restricción temporal; tutor con `puede_reportar_ausencias=true` solo si `fecha_inicio >= hoy_madrid()`.
  - UPDATE: admin sin restricción; tutor con permiso solo si `fecha_inicio >= hoy_madrid()`; profe solo si `reportada_por = auth.uid()` (su propia ausencia) — el server action enforza que el único cambio aceptable en ese caso es la cancelación con prefijo `[cancelada] `.
  - DELETE: bloqueado a todos.

Auto-link familia → profe (sin pre-creación de filas): la query `getPaseDeListaAula(aulaId, fecha)` hace LEFT JOIN con `ausencias` activas para la fecha. Si existe una y no hay asistencia previa, el cliente pinta la fila con `initial='ausente'` + badge "Ausencia reportada por familia". La profe puede sobrescribir; queda como ausencia avisada-pero-no-cumplida sin flag específico.

## Realtime y RLS

Las 5 tablas de la agenda (`agendas_diarias`, `comidas`, `biberones`, `suenos`, `deposiciones`) y las 2 de F4 (`asistencias`, `ausencias`) están publicadas en `supabase_realtime`. **Las políticas RLS de `SELECT` se aplican también a las notificaciones Realtime**: Supabase descarta los eventos sobre filas que el rol del cliente no podría leer vía `SELECT`. El filtrado client-side por `aula_id` (vista profe) o `nino_id` (vista familia) es **cosmético**, no de seguridad. Manipular ese filtro desde devtools no expone notificaciones de aulas/niños no autorizados.

## Tests RLS obligatorios

Por cada tabla nueva verificar que:

1. Un alumno de aula A no puede ver datos del aula B.
2. Un tutor solo ve datos de sus hijos.
3. Un autorizado no puede ver la agenda (solo recogida).
4. Audit log no es modificable por nadie (ni admin).

Tests Fases 1–4 en `src/test/rls/`:

- `usuarios.rls.test.ts`, `roles.rls.test.ts`, `invitaciones.rls.test.ts` (Fase 1).
- `centros.rls.test.ts`, `aulas.rls.test.ts`, `vinculos.rls.test.ts`, `info-medica.rls.test.ts`, `audit-log.rls.test.ts`, `cifrado.test.ts` (Fase 2).
- `datos-pedagogicos.rls.test.ts` (Fase 2.6).
- `agenda-diaria.rls.test.ts` + `dentro-de-ventana-edicion.test.ts` (Fase 3).
- `asistencia.rls.test.ts`, `ausencia.rls.test.ts` (Fase 4).
- `dias-centro.rls.test.ts` + `tipo-de-dia.test.ts` (Fase 4.5a).
- `menus.rls.test.ts` + `menu-helpers.test.ts` (Fase 4.5b).
- `messaging.rls.test.ts` + `messaging-helpers.test.ts` (Fase 5).
- `push.rls.test.ts` (Fase 5.5).
- `src/test/audit/audit.test.ts` + `agenda-audit.test.ts` + `asistencia-audit.test.ts` + `dias-centro-audit.test.ts` + `menus-audit.test.ts` verifican triggers (INSERT, UPDATE, soft delete, agenda, asistencia, calendario, plantillas y menu_dia + trigger BEFORE validar_fecha).
- `src/test/audit/grupo1-audit.test.ts`: las 8 tablas del Grupo 1, las columnas excluidas y que la purga redacta el nombre en las filas de `usuarios`.
- `src/test/audit/grupo1b-audit.test.ts`: la purga de usuario no deja su nombre ni su parentesco en `audit_log`, `invitaciones` sin `token` y redactada por las dos purgas, y `actor_sistema`.
- `src/test/audit/purga-rgpd-nino.test.ts`: las dos purgas del niño borran la ficha completa de la tabla y no dejan en `audit_log` ninguna columna personal (lista `_claves_pii_nino`, `20261011140000`); la retroactiva redacta a los niños que ya no existen y no toca a los vivos.
- `src/test/audit/purga-lista-espera.test.ts`: la purga del niño borra su prospecto de `lista_espera` y la del tutor limpia su teléfono y su email, en la tabla y en `audit_log` (también el INSERT); la purga de esqueletos conserva el prospecto, y los de otro niño o centro no se tocan (`20261012140000`).
- `src/test/audit/purga-cierre.test.ts`: el cierre de la purga (`20261015120000`): `idioma_principal` a `'zz'` y su CHECK, `_redactar_jsonb` con null, el perfil de `familia_tutores` y su auditoría, foto, preferencias, lecturas, cambios pendientes y comentarios de cita; el manifiesto de adjuntos (DNI por ruta exacta), `promover_a_titular` y la anonimización de Auth contra el GoTrue real.

## Calendario laboral (Fase 4.5a)

- **`dias_centro`**: persiste solo overrides; el helper `public.tipo_de_dia(centro, fecha)` resuelve con fallback ISODOW (lun-vie=`lectivo`, sáb-dom=`cerrado`). Ver [ADR-0019](../decisions/ADR-0019-calendario-laboral-default-excepciones.md).
  - SELECT: cualquier miembro del centro (`pertenece_a_centro`).
  - INSERT, UPDATE: solo admin del centro.
  - **DELETE: solo admin del centro** — excepción explícita al patrón habitual del proyecto. La "ausencia de fila" tiene significado semántico (vuelta al default); no procede "anular con prefijo". Trazabilidad preservada en `audit_log` (trigger captura `valores_antes`).
- **Sin ventana de edición**: a diferencia de F3/F4, `dias_centro` no usa `dentro_de_ventana_edicion`. El admin edita cualquier fecha pasada/presente/futura — es planificación administrativa, no un hecho operativo.

## Menús mensuales (Fase 4.5b)

- **`plantillas_menu_mensual`** y **`menu_dia`**: planificación de menús del centro. Ver [ADR-0020](../decisions/ADR-0020-plantilla-menu-mensual.md).
  - SELECT: cualquier miembro del centro (`pertenece_a_centro`).
  - INSERT, UPDATE: solo admin del centro.
  - DELETE: bloqueado a todos (default DENY). Las plantillas se archivan con UPDATE `estado='archivada'`.
- **Trigger BD `menu_dia_validar_fecha_en_plantilla`**: BEFORE INSERT/UPDATE comprueba que `EXTRACT(MONTH/YEAR FROM fecha)` coincide con el `mes`/`anio` de la plantilla padre. RAISE EXCEPTION con SQLSTATE `23514` (check_violation) si no. Es la red de seguridad a nivel BD; el server action valida también con Zod para mensaje UX claro.
- **`comidas` (extensión F4.5b)**: las políticas RLS existentes de F3 NO se tocan. Las 2 columnas nuevas (`tipo_plato`, `menu_dia_id`) forman parte del row; RLS sigue filtrando por row con el mismo criterio (ventana, profe del aula, admin). El batch del pase de lista heredá la ventana de edición de F3 — se aplica como cualquier otro UPSERT en `comidas`.

## Mensajería (Fase 5)

5 tablas — `conversaciones`, `mensajes`, `lectura_conversacion`, `anuncios`, `lectura_anuncio` — y el ENUM `ambito_anuncio`. Ver [ADR-0023](../decisions/ADR-0023-modelo-mensajeria-cinco-tablas.md), [ADR-0024](../decisions/ADR-0024-participantes-dinamicos-vs-persistidos.md), [ADR-0025](../decisions/ADR-0025-push-notifications-fuera-de-f5.md).

- **`conversaciones`**: 1 fila por niño (`UNIQUE(nino_id)`). `centro_id` se rellena por trigger BEFORE INSERT vía `centro_de_nino`. `last_message_at` lo actualiza el trigger AFTER INSERT de `mensajes` (SECURITY DEFINER que bypassa RLS).
  - SELECT: `es_admin(centro_id) OR es_profe_de_nino(nino_id) OR tiene_permiso_sobre(nino_id, 'puede_recibir_mensajes')`.
  - INSERT: cualquier participante (auto-creación lazy desde el primer mensaje del server action).
  - UPDATE: SIN policy → default DENY. Solo el trigger interno modifica `last_message_at`.
  - DELETE: SIN policy → default DENY.

- **`mensajes`**: hijos de `conversaciones` con ON DELETE CASCADE. `contenido` ≤ 2010 chars (límite Zod 2000 + 10 chars del prefijo `[anulado] `).
  - SELECT: `puede_participar_conversacion(conversacion_id)`.
  - INSERT: `puede_participar_conversacion(conversacion_id) AND autor_id = auth.uid()` (anti-suplantación).
  - UPDATE: solo el autor (`autor_id = auth.uid()`). El server action `marcarMensajeErroneo` enforza que la única mutación válida es `erroneo=true` + prefijo en `contenido`.
  - DELETE: SIN policy → default DENY.

- **`lectura_conversacion`** y **`lectura_anuncio`**: read-receipts. Cada usuario gestiona solo sus filas (`usuario_id = auth.uid()`). UNIQUE `(usuario_id, conversacion_id)` y `(usuario_id, anuncio_id)`. DELETE bloqueado. NO se auditan (telemetría de usuario, no contenido).

- **`anuncios`**: broadcasts unidireccionales. CHECK estructural `(ambito='aula' AND aula_id IS NOT NULL) OR (ambito='centro' AND aula_id IS NULL)`. `titulo` ≤ 210 chars (límite 200 + 10 del prefijo); `contenido` ≤ 4000.
  - SELECT: `usuario_es_audiencia_anuncio_row(centro_id, autor_id, ambito, aula_id)`. **Row-aware** para evitar el gotcha MVCC en `INSERT…RETURNING` (ver sección arriba).
  - INSERT: `autor_id = auth.uid() AND (es_admin(centro_id) OR (ambito='aula' AND es_profe_de_aula(aula_id) AND centro_de_aula(aula_id)=centro_id))`. Profes solo ámbito aula sobre su aula activa.
  - UPDATE: solo el autor. El server action `marcarAnuncioErroneo` limita la mutación al prefijo en `titulo` + flag.
  - DELETE: SIN policy → default DENY.

- **Multicentro**: la RLS deja leer las conversaciones y los anuncios de todos los centros del usuario. Las consultas de lista y el badge de no leídos (`countNoLeidos`, `getAnunciosDelUsuario`, `getConversacionesDelUsuario`) los acotan al centro de la página, y el detalle de una conversación o de un anuncio (`getConversacionDetalle`, `getAdminFamiliaDetalle`, `getAnuncioDetalle`) devuelve `null` si es de otro centro. Las notificaciones llevan el centro del registro (`?centro=`) y, si es otro de los del usuario, la página pide confirmar el cambio (ADR-0057).

- **Flag global `puede_recibir_mensajes`**: actúa como switch del canal digital entrante. Tutor con flag a `false` no recibe **ni conversaciones ni anuncios** (ni ámbito aula ni ámbito centro). El helper `usuario_es_audiencia_anuncio_row` incluye esta condición; las RLS de `conversaciones`/`mensajes` la heredan vía `tiene_permiso_sobre(nino_id, 'puede_recibir_mensajes')`. Profes y admin siempre reciben anuncios de su ámbito y actúan como puente humano para tutores excluidos.

- **Realtime publication**: solo `mensajes` y `anuncios`. Las `lectura_*` no se publican; el cliente recalcula localmente. Las policies SELECT filtran las notificaciones Realtime — un cliente sin permiso no recibe eventos.

- **Audit log**: triggers en `conversaciones`, `mensajes`, `anuncios`. `centro_id` se deriva: directo en `conversaciones`/`anuncios`, vía `centro_de_conversacion` en `mensajes`. `lectura_*` NO se auditan.

- ~~**Sin ventana de edición**: a diferencia de F3/F4/F4.5b, mensajería es continua. Un mensaje enviado ayer sigue siendo anulable hoy.~~ **Derogado por F5.6-B ([ADR-0031](../decisions/ADR-0031-ventana-anulacion-5min.md))**: el autor solo puede marcar erróneo dentro de los **primeros 5 minutos** desde `created_at`. Aplica a `mensajes` (ambos tipos de conversación) y a `anuncios`. Implementado inline en las policies UPDATE (`created_at > now() - interval '5 minutes'` en `USING` + `WITH CHECK`). Sin moderación admin: cada autor anula lo suyo, nadie más (la app es comunicación adulto↔adulto, no canal hacia menores).

## Mensajería admin↔familia (Fase 5.6-A)

Extensión de F5: la dirección del centro (admin) puede iniciar una conversación 1-a-1 con un tutor sobre temas que no son por niño (cuotas, citaciones, etc.). Ver [ADR-0029](../decisions/ADR-0029-admin-familia-per-par.md), [ADR-0030](../decisions/ADR-0030-admin-familia-timer-trigger.md).

- **ENUM `tipo_conversacion`**: `'profe_familia' | 'admin_familia'`. Las filas F5 quedan en `profe_familia` (DEFAULT).
- **Columnas nuevas en `conversaciones`**: `admin_id`, `tutor_id`, `tipo_conversacion`, `expires_at`. `nino_id` pasa a NULLABLE.
- **CHECK estructural** `conversaciones_tipo_coherencia`:
  - `profe_familia`: `nino_id NOT NULL`, `admin_id/tutor_id/expires_at NULL`.
  - `admin_familia`: `admin_id NOT NULL`, `tutor_id NOT NULL`, `expires_at NOT NULL`, `nino_id NULL`.
- **Índice único parcial** `idx_conv_admin_familia_unique (admin_id, tutor_id) WHERE tipo='admin_familia'` — un solo hilo por par (no por niño). Desde `20261022120000` es `idx_conv_admin_familia_centro_unique (admin_id, tutor_id, centro_id)`: un hilo por centro (ADR-0059).
- **Helpers SQL nuevos**:
  - `es_tutor_en_centro(tutor_id, centro_id)` → boolean
  - `conversacion_activa(conv_id)` → boolean (TRUE si `tipo='profe_familia'` o `expires_at > now()`)
  - `puede_participar_conversacion(conv_id)` extendido: ahora también devuelve TRUE para `admin_id`/`tutor_id` en hilos `admin_familia`.
- **Policies reescritas**:
  - `conversaciones_select`: amplía para incluir `admin_id = auth.uid()` o `tutor_id = auth.uid()` en hilos `admin_familia`.
  - `conversaciones_insert`: F5 + permite que un admin del centro inserte filas `admin_familia` con `admin_id = auth.uid()`.
  - **`conversaciones_update_admin_familia` (nueva)**: solo el `admin_id` puede cambiar `expires_at` (reapertura). El resto sigue DENY UPDATE (default).
  - `mensajes_insert` extendida con `conversacion_activa(conversacion_id)`: ningún rol puede mandar a hilos caducados; el RLS rechaza antes de que el cliente llegue siquiera al action.
- **Trigger `mensajes_reset_admin_familia_timer_trg`** (AFTER INSERT en `mensajes`, `SECURITY DEFINER`): renueva `expires_at = now() + 3 days` si el hilo es `admin_familia`. Atómico con el INSERT (ver ADR-0030). El tutor puede renovar sin necesitar `UPDATE` propio en `conversaciones`.

## "USING falso → 0 filas, sin error" (gotcha de UPDATE bajo RLS)

> **Aprendizaje crítico de F5.6-B.** Complementa el gotcha MVCC de F5 documentado arriba (que cubre `INSERT…RETURNING`); este cubre `UPDATE` bajo RLS condicional.

### Síntoma

Una server action hace `client.from('tabla').update(...).eq('id', X)` sobre una fila cuya policy `USING` la rechaza (p.ej. `created_at` fuera de ventana). El cliente recibe **`data: null, error: null`** — operación OK, 0 filas afectadas. La action puede creer erróneamente que el UPDATE pasó si no inspecciona el número de filas afectadas.

### Causa

PostgreSQL evalúa `USING` antes del UPDATE. Si ninguna fila pasa, simplemente no se actualiza nada y el statement termina con éxito. No es un error de permisos (`42501`) — es "no había nada que tocar". Para que devuelva `42501` la fila debe pasar `USING` pero fallar `WITH CHECK` después de aplicar el cambio (caso raro).

### Patrón anti-bug

Hacer el UPDATE con `.select('id').maybeSingle()` y comprobar `data === null` como señal de RLS USING rechazó:

```ts
const { data: updated, error } = await supabase
  .from('mensajes')
  .update({ erroneo: true, contenido: nuevoContenido })
  .eq('id', id)
  .select('id')
  .maybeSingle()

if (error) {
  if (error.code === '42501') return fail('messages.errors.ventana_anulacion_expirada')
  return fail('messages.errors.envio_fallo')
}
if (!updated) {
  // RLS USING rechazó. Típicamente: la ventana caducó entre el SELECT
  // de pre-chequeo y el commit del UPDATE.
  return fail('messages.errors.ventana_anulacion_expirada')
}
```

### Cuándo aplica

Cualquier UPDATE bajo una policy con condición temporal o de estado (ventana de tiempo, flag `closed`, etc.). En F5.6-B aplicamos esto en `marcarMensajeErroneo` y `marcarAnuncioErroneo`. En F6 (recordatorios) volverá a aplicar para "marcar como completado solo si no estaba ya completo".

### USING + WITH CHECK simétricos

La policy de F5.6-B mantiene la condición en `USING` (filtra qué filas son visibles) y en `WITH CHECK` (valida el resultado tras aplicar el patch). Sin `WITH CHECK`, una mutación que NO cambia las columnas referenciadas en `USING` aún podría pasar aunque la condición temporal falle en commit. Pareja simétrica = defensa simétrica.

## Push notifications (Fase 5.5)

1 tabla nueva — `push_subscriptions` — y 4 políticas con aislamiento estricto por usuario. Ver [ADR-0027](../decisions/ADR-0027-push-notifications-arquitectura.md) y [ADR-0028](../decisions/ADR-0028-manifest-minimo-f5-5-vs-pwa-f11.md).

- **`push_subscriptions`**: una fila por (`usuario_id`, `endpoint del navegador`). UNIQUE evita duplicados al reintentar la suscripción. ON DELETE CASCADE desde `usuarios`.
  - SELECT: `usuario_id = auth.uid()`.
  - INSERT: WITH CHECK `usuario_id = auth.uid()` (anti-suplantación).
  - UPDATE: USING + WITH CHECK `usuario_id = auth.uid()` (refresh de `last_active_at`, `p256dh`/`auth` rotados).
  - DELETE: `usuario_id = auth.uid()` (desuscripción manual desde cliente).
- **Sin helpers**: la condición es trivial y sin lookups cross-tabla. No hay riesgo de recursión (ADR-0007) ni del gotcha MVCC (la SELECT policy no mira otras tablas).
- **No se audita**: telemetría operativa, no contenido (igual que `lectura_*` en F5). Si en F6+ aparece compliance por entrega de notificaciones, se añadiría una tabla aparte (`notificaciones_push`) con su propio trigger.
- **No se publica en Realtime**: los clientes no observan suscripciones; cada navegador conoce la suya por `pushManager.getSubscription()`.
- **En el idioma de quien la recibe** ([ADR-0060](../decisions/ADR-0060-push-en-el-idioma-del-destinatario.md)): los envíos pasan por `enviarPushPorIdioma`, que agrupa a los destinatarios por `usuarios.idioma_preferido` (lectura con service role, `idiomasDeUsuarios`) y llama al motor una vez por idioma con el título, el texto y el enlace de ese idioma.
- **Service role bypass en el motor de envío**: `enviarPushANotificarUsuarios` lee suscripciones cross-user vía `createServiceRoleClient()` (`src/lib/supabase/admin.ts`; hasta F11-D era el `createServiceClient` cookie-bound, que con sesión actuaba como el usuario y entregaba a nadie). La auth del autor ya se verificó en la server action que lo invoca; el helper solo computa destinatarios y envía. Esto es coherente con el resto del proyecto: service role nunca se expone al cliente y se usa solo en helpers server-side claramente etiquetados.

## Recordatorios (Fase 6-C — modelo granular)

> **Supera al modelo F6-A.** Ver [ADR-0037](../decisions/ADR-0037-modelo-granular-destinatarios-recordatorios.md) (supera a [ADR-0035](../decisions/ADR-0035-modelo-recordatorios-bidireccionales.md)); [ADR-0036](../decisions/ADR-0036-completar-recordatorio-idempotente.md) sigue vigente. Spec: `docs/specs/reminders-c.md`. Migración `20260601120000_phase6c_reminders_remodel.sql` (destructiva, D1).

ENUM `recordatorio_destinatario` con **6 valores**: `familia_individual` · `familias_aula` · `familias_centro` · `profe_individual` · `profes_centro` · `personal`. **admin/profe son los únicos emisores; tutor/autorizado solo reciben** (revierte el hotfix #44: vuelven a leer `/reminders`, sin botón crear ni capacidad de INSERT en RLS).

- **2 helpers SQL nuevos** (`STABLE SECURITY DEFINER`, usan `auth.uid()`): `es_tutor_en_aula(p_aula_id)` (¿soy tutor de un niño activo del aula?) y `es_profe_en_centro(p_centro_id)` (¿tengo rol profe en el centro?). Se reutiliza `es_tutor_en_centro(p_tutor_id, p_centro_id)` (F5.6-A) invocándolo con `auth.uid()` explícito como 1.er argumento. Reutilizados además: `es_admin`, `es_profe_de_nino`, `es_profe_de_aula`, `tiene_permiso_sobre`, `pertenece_a_centro`, `centro_de_nino`, `centro_de_aula`.
- **El gotcha MVCC NO aplica**: `recordatorios_select` lee columnas del propio row (`centro_id`, `nino_id`, `aula_id`, `usuario_destinatario_id`, `creado_por`, `destinatario`) y delega los lookups a helpers que consultan **otras** tablas (`ninos`/`aulas`/`matriculas`/`vinculos_familiares`/`roles_usuario`). Nunca re-lee `recordatorios`. Test explícito de `.insert().select()` en los 6 destinos lo confirma. Sin helper row-aware.
- **`recordatorios_select`** — visibilidad por destino:
  - `familia_individual`: `es_admin(centro_id) OR es_profe_de_nino(nino_id) OR tiene_permiso_sobre(nino_id, 'puede_recibir_mensajes')`.
  - `familias_aula`: `es_admin(centro_id) OR es_profe_de_aula(aula_id) OR es_tutor_en_aula(aula_id)`.
  - `familias_centro`: `es_admin(centro_id) OR es_tutor_en_centro(auth.uid(), centro_id)`.
  - `profe_individual`: `es_admin(centro_id) OR usuario_destinatario_id = auth.uid()`.
  - `profes_centro`: `es_admin(centro_id) OR es_profe_en_centro(centro_id)`.
  - `personal`: `usuario_destinatario_id = auth.uid()`.
- **`recordatorios_insert`** — `creado_por = auth.uid()` (anti-suplantación) + matriz D9: `familia_individual`/`familias_aula` → admin del centro o profe del niño/aula (con `centro_de_*` = `centro_id`); `familias_centro`/`profe_individual`/`profes_centro` → solo `es_admin`; `personal` → `usuario_destinatario_id = auth.uid()` + ser admin o profe del centro (`es_admin OR es_profe_en_centro`). **Ningún destino es creable por tutor/autorizado** — `personal` se restringió a staff en la migración `20260601130000_phase6c_fix_personal_insert.sql` (la matriz D9 prevalece sobre el SQL laxo de la spec §3.3).
- **`recordatorios_update`** — mismo predicado de visibilidad que SELECT en `USING` y `WITH CHECK` (defensa simétrica). Cubre **completar** (cualquiera que lo vea, sin límite temporal) y **anular** (solo emisor). La restricción de columnas y la **ventana de 5 min** las enforza el server action (ADR-0036, riesgo aceptado): el UPDATE multiplexa ambas y no se separan por tiempo en una policy. Idempotencia: `UPDATE … WHERE completado_en IS NULL` + `.select().maybeSingle()` (gotcha "USING falso → 0 filas").
- **Badge (RPC `contar_recordatorios_pendientes(p_centro_id)`)** — `SECURITY DEFINER STABLE`, usa `auth.uid()`. Solo cuenta los del centro que recibe, el de la página (`20261021120000`; antes, sin centro, sumaba los de todos los centros del usuario). Cuenta pendientes donde el usuario es **destinatario directo** (no mera visibilidad RLS): `personal`/`profe_individual` self; `profes_centro` `es_profe_en_centro`; `familia_individual`/`familias_aula`/`familias_centro` con `creado_por <> auth.uid()` + el helper de pertenencia. Resuelve el caso admin (ve todo del centro pero no es destinatario de lo que crea).
- **DELETE**: SIN policy → default DENY. Sin `deleted_at`; el error se corrige con `erroneo=true` + prefijo `[anulado] ` en `titulo`.
- **Audit log**: trigger `audit_recordatorios` con `centro_id` directo (rama de `audit_trigger_function` sin cambios respecto a F6-A).
- **Realtime**: `recordatorios` publicada para el badge en vivo; la RLS de SELECT filtra los eventos.
- **`puede_recibir_mensajes`**: switch del canal para los broadcasts. La **visibilidad** in-app de `familias_aula`/`familias_centro` sigue la **pertenencia** (sin chequear el flag por niño, intratable en RLS multi-hijo); la **entrega push** (`expandirDestinatariosRecordatorio`) **sí** respeta el flag por niño. Trade-off documentado en ADR-0037.

## Agenda — citas con invitados nominales y RSVP (Fase 7b)

3 tablas — `citas`, `cita_invitados`, `preferencias_usuario` — y 3 ENUMs (`tipo_cita`, `cita_estado`, `rsvp_estado`). Ver [ADR-0039](../decisions/ADR-0039-modelo-agenda-citas-invitados-rsvp.md) y `docs/specs/agenda-citas.md`. Modelo de **invitación nominal** (separado de `eventos`, que es difusión).

- **Helpers nuevos** (`STABLE SECURITY DEFINER SET search_path = public`):
  - `centro_de_cita(p_cita_id)` → uuid; `organizador_de_cita(p_cita_id)` → uuid (leen `citas`).
  - `usuario_es_invitado_cita(p_cita_id)` → boolean (lee `cita_invitados` con `auth.uid()`).
  - **`usuario_es_audiencia_cita_row(p_centro_id, p_organizador_id, p_cita_id)`** → boolean. **Row-aware**: recibe los campos de `citas`, **NO re-lee `citas`** (evita el gotcha MVCC en `INSERT…RETURNING`). Devuelve `es_admin(p_centro_id) OR p_organizador_id = auth.uid() OR usuario_es_invitado_cita(p_cita_id)`. El helper interno consulta `cita_invitados` (tabla **distinta**) → MVCC no aplica.
  - Reutilizados: `es_admin`, `es_profe_de_nino`, `es_profe_de_aula`, `centro_de_nino`, `centro_de_aula`.

- **`citas`**:
  - SELECT: `usuario_es_audiencia_cita_row(centro_id, organizador_id, id)` (admin del centro, organizador, o invitado).
  - INSERT: `organizador_id = auth.uid() AND (es_admin(centro_id) OR (tipo='reunion_familia' AND es_profe_de_nino(nino_id) AND centro_de_nino(nino_id)=centro_id) OR (tipo='reunion_clase' AND es_profe_de_aula(aula_id) AND centro_de_aula(aula_id)=centro_id))`. Claustro/visita → solo admin. **tutor/autorizado no organizan** (sin rama). Espejo de la matriz AG-tipos.
  - UPDATE: `USING + WITH CHECK` simétricos `organizador_id = auth.uid() OR es_admin(centro_id)`. El server action limita columnas (editar/cancelar). Cancelar = UPDATE `estado='cancelada'` con `.select().maybeSingle()` (gotcha "USING falso → 0 filas").
  - DELETE: SIN policy → default DENY.

- **`cita_invitados`** (roster privado, AG-12):
  - SELECT: `usuario_id = auth.uid() OR organizador_de_cita(cita_id) = auth.uid() OR es_admin(centro_id)`. Un invitado solo ve **su** fila; la lista completa es solo para organizador/admin.
  - INSERT: `(organizador_de_cita(cita_id) = auth.uid() OR es_admin(centro_id)) AND centro_id = centro_de_cita(cita_id)`. Solo organizador/admin pueblan invitados (alta y "añadir"); el action expande grupos a personas (snapshot).
  - UPDATE: `USING + WITH CHECK` `usuario_id = auth.uid()` (el invitado responde su fila) `OR organizador_de_cita(cita_id) = auth.uid() OR es_admin(centro_id)` (el organizador marca al externo). El action separa los dos casos, limita columnas y enforza la ventana (hasta `hora_inicio`, AG-11). Idempotencia: `.select().maybeSingle()`.
  - DELETE: `organizador_de_cita(cita_id) = auth.uid() OR es_admin(centro_id)`. **Excepción explícita** al patrón "DELETE bloqueado" (análoga a `dias_centro`): quitar un invitado es gestión de lista; traza en `audit_log`. El invitado **no** puede auto-eliminarse (responde `rechazado`).

- **`preferencias_usuario`**: todas las operaciones con `usuario_id = auth.uid()` (aislamiento estricto, sin helpers; patrón `push_subscriptions`). NO se audita.

- **Audit log**: triggers en `citas` y `cita_invitados` (`centro_id` directo). Registro **administrativo** del RSVP (quién/cuándo), NO autorización legal (≠ F8). `preferencias_usuario` NO se audita.

- **Sin Realtime** en el core (el roster refresca al navegar).

- **Badge (RPC `contar_invitaciones_pendientes(p_centro_id)`, AG-14)**: solo las del centro que recibe (`20261021120000`). `SECURITY DEFINER STABLE`, usa `auth.uid()`. Cuenta `cita_invitados` `pendiente` del usuario JOIN `citas` `programada` y **aún no comenzada** (`(fecha + hora_inicio) AT TIME ZONE 'Europe/Madrid' > now()`), con `organizador_id <> auth.uid()` (el organizador no cuenta sus citas). Bypassa RLS pero solo cuenta filas del propio usuario → sin fuga (igual que la RPC de F6-C). **Sin push ni Realtime**. Test gateado: dos usuarios → cada uno su recuento; el organizador no cuenta las suyas; al aceptar deja de contar.

- **Gotcha MVCC**: `usuario_es_audiencia_cita_row` es row-aware (recibe `centro_id`/`organizador_id` por parámetro) y su lookup interno consulta `cita_invitados` (otra tabla). Igual `cita_invitados`, cuyo helper lee `citas`. Tests `.insert().select()` en ambas tablas como bloqueo de regresión.

## Autorizaciones y firma digital (Fase 8)

3 tablas — `autorizaciones`, `firmas_autorizacion`, `administraciones_medicacion` — y 5 ENUMs. Ver [ADR-0041](../decisions/ADR-0041-modelo-autorizaciones-firma-digital.md) y spec de arranque `docs/specs/autorizaciones-firma.md`. **Documentos legales: las 3 tablas SÍ se auditan** (a diferencia de los RSVP de F7b, que son registro administrativo). Sin Realtime.

> ⚖️ **Aviso legal**: F8 implementa un **mecanismo técnico auditable** (firma electrónica simple), **NO** certifica validez jurídica. Las afirmaciones de validez van marcadas ⚖️ y requieren abogado (eIDAS/LOPDGDD/normativa educativa). Ver ADR-0041 §legal.

### Helpers nuevos (`STABLE SECURITY DEFINER SET search_path = public`, GRANT `authenticated`)

- `centro_de_evento(p_evento_id)` → uuid; `es_profe_de_evento(p_evento_id)` → boolean (profe del aula del evento de ámbito `aula`).
- **`usuario_es_audiencia_autorizacion_row(p_centro_id, p_tipo, p_es_plantilla, p_ambito, p_evento_id, p_nino_id, p_aula_id)`** → boolean. **Row-aware** (recibe los campos por parámetro, **NO re-lee `autorizaciones`** → evita el gotcha MVCC en `INSERT…RETURNING`). admin ⇒ TRUE; plantilla del catálogo ⇒ `pertenece_a_centro`; `salida` ⇒ audiencia del evento; ámbito `nino` ⇒ `es_profe_de_nino OR es_tutor_de`; ámbito `aula` ⇒ `es_profe_de_aula OR es_tutor_en_aula`; ámbito `centro` ⇒ `pertenece_a_centro`; legacy (nino_id seteado) ⇒ `es_profe_de_nino OR es_tutor_de` (rama inalcanzable desde `20261016120000`: el CHECK ya no admite esa forma). (Sustituye a la versión de 5 args de F8-0.)
- `autorizacion_aplica_a_nino(p_autorizacion_id, p_nino_id)` → boolean. Lee `autorizaciones` (tabla distinta de la que se inserta —`firmas`—, sin MVCC): plantilla ⇒ FALSE; `salida` ⇒ `evento_aplica_a_nino`; ámbito `aula` ⇒ matrícula activa; ámbito `centro` ⇒ niño del centro; resto ⇒ `nino_id = p_nino_id`.
- `autorizacion_firmable(p_autorizacion_id)` → boolean: `es_plantilla=false AND estado='publicada' AND texto_definitivo AND` dentro de vigencia (`hoy_madrid()`). Enforza el guard de texto PENDIENTE (no se firma un borrador).
- `autorizacion_plantilla_valida(p_plantilla_id, p_centro_id, p_tipo)` → boolean: existe plantilla `es_plantilla=true`, mismo centro+tipo, `publicada` + `texto_definitivo`. Gate del INSERT del tutor (B2).
- `medicacion_administrable_hoy(p_autorizacion_id)` → boolean (F8-3b): espejo SQL de `estado-firma.ts`. Calcula la política efectiva (`ninos.requiere_ambos_firmantes` ⇒ `todos_los_principales`), exige que la **última** decisión (`DISTINCT ON (firmante_id) … ORDER BY firmado_at DESC`) de los tutores principales sea `firmado`, y que `hoy_madrid()` esté dentro de la vigencia del tratamiento (que viaja en `firmas.datos.medicacion.fecha_inicio/fecha_fin`).
- **`archivar_autorizacion(p_autorizacion_id)`** → boolean — **RPC** `SECURITY DEFINER`, GRANT `authenticated`. Solo `tipo='medicacion'` no-plantilla; autoriza **`es_admin OR es_profe_de_nino`** (la familia NO); **idempotente**; setea `archivada_at=now()`, `archivada_por=auth.uid()`. Se hace por RPC **deliberadamente** para no ampliar la policy `autorizaciones_update` (autor|admin) a la profe (eso le abriría publicar/anular/editar el texto); el RPC toca solo las columnas de archivado.

### RLS `autorizaciones`

- **SELECT** `autorizaciones_select`: `usuario_es_audiencia_autorizacion_row(centro_id, tipo, es_plantilla, ambito, evento_id, nino_id, aula_id)` (row-aware).
- **INSERT** `autorizaciones_insert`: `creado_por = auth.uid()` AND ( `es_admin(centro_id)` | profe de salida `tipo='salida' AND es_profe_de_evento(evento_id) AND centro_de_evento(evento_id)=centro_id` | **tutor B2**: `es_plantilla=false AND tipo ∈ {recogida,medicacion} AND ambito='nino' AND nino_id NOT NULL AND plantilla_id NOT NULL AND es_tutor_de(nino_id) AND autorizacion_plantilla_valida(plantilla_id, centro_id, tipo)` ).
- **UPDATE** `autorizaciones_update`: `USING + WITH CHECK` simétricos `creado_por = auth.uid() OR es_admin(centro_id)`; las plantillas de las normas internas y del consentimiento de imagen, solo `privado.es_responsable` (`20261030130000`). El server action acota columnas; el trigger `bloquea_texto_tras_firma` congela el alcance consentido una vez hay firmas, y desde `20261030130000` `autorizaciones_identidad_inmutable_trg` congela la identidad del documento para todos y siempre: tipo, plantilla o instancia, ámbito, centro, niño, evento, aula, plantilla de la que sale y autor (23514). Archivar medicación NO pasa por aquí (RPC `SECURITY DEFINER`).
- **DELETE**: sin policy → **default DENY**. Retirar = `estado='anulada'` (conserva firmas). Archivar (`archivada_at`) ≠ anular.

### RLS `firmas_autorizacion` (append-only, inmutable)

- **SELECT** `firmas_select`: `firmante_id = auth.uid() OR es_tutor_de(nino_id) OR es_profe_de_nino(nino_id) OR es_admin(centro_de_nino(nino_id))`.
- **INSERT** `firmas_insert`: `es_tutor_de(nino_id) AND firmante_id = auth.uid() AND autorizacion_aplica_a_nino(autorizacion_id, nino_id) AND autorizacion_firmable(autorizacion_id)`. Solo el tutor del niño; un borrador/PENDIENTE no es firmable; el trazo (`firma_imagen`) es obligatorio al firmar (CHECK).
- **UPDATE / DELETE**: sin policy → **default DENY**. La firma es inmutable: **revocar o re-firmar = fila nueva** (`decision='revocado'`/`'firmado'`); el estado vigente es la última fila por (autorización, niño, firmante) ordenada por `firmado_at`. El **hash compuesto** (`texto_hash` = SHA-256 del texto exacto versionado + `datos` firmados) detecta cualquier alteración del documento.

### RLS `administraciones_medicacion` (doble confirmación)

- **SELECT** `adm_med_select`: `es_admin(centro_id) OR es_profe_de_nino(nino_id) OR es_tutor_de(nino_id)` (staff + familia, transparencia).
- **INSERT** `adm_med_insert`: `administrado_por = auth.uid() AND confirmado_por IS NULL AND (es_admin OR es_profe_de_nino) AND centro_de_nino(nino_id)=centro_id AND autorizacion_aplica_a_nino(...) AND medicacion_administrable_hoy(autorizacion_id)`. La familia NO registra; quien registra no se autoconfirma.
- **UPDATE** `adm_med_update_confirmar`: `USING (confirmado_por IS NULL AND administrado_por <> auth.uid() AND (es_admin OR es_profe_de_nino))` + `WITH CHECK (confirmado_por = auth.uid() AND administrado_por <> auth.uid() AND (es_admin OR es_profe_de_nino))`. El **segundo** staff (distinto del que administró) confirma nombrándose a sí mismo. La USING filtra solo pendientes → idempotencia por el patrón **"USING falso → 0 filas"** (`.select().maybeSingle()` en el action). El trigger `solo_confirmar` impide cualquier otra mutación y sella `confirmado_at` server-side.
- **DELETE**: sin policy → **default DENY**.

### Gotcha MVCC (Fase 8)

Todas las SELECT policies de F8 son seguras frente a `INSERT…RETURNING`: `autorizaciones_select` usa el helper **row-aware** de 7 args (no re-lee `autorizaciones`); las de `firmas_autorizacion` y `administraciones_medicacion` delegan en helpers que leen **otras** tablas (`autorizaciones`, `ninos`, `vinculos_familiares`, `eventos`) ya commiteadas. Resuelve el aviso de "Implicaciones para fases siguientes" de la sección MVCC de F5.

## Informes de evolución (Fase 9, F9-0)

2 tablas — `plantillas_informe`, `informes_evolucion` — y 4 ENUMs. Ver [ADR-0042](../decisions/ADR-0042-modelo-informes-evolucion.md) y spec `docs/specs/informes-evolucion.md`. **Ambas se auditan** (centro_id directo). Sin Realtime. Migración `20260609130000_phase9_0_informes_evolucion.sql`.

### Helpers nuevos (`STABLE SECURITY DEFINER SET search_path = public`, GRANT `authenticated`)

- `es_redactor_de_nino(p_nino_id)` → boolean. Profe del aula del niño con `tipo_personal_aula IN ('coordinadora','profesora')` (corte de autoría Q5/ADR-0032). Espejo de `es_profe_de_nino` + filtro de tipo: `tecnico`/`apoyo` **no** son redactores.
- `es_tutor_legal_de(p_nino_id)` → boolean. Vínculo `tutor_legal_principal`/`tutor_legal_secundario` (excluye `autorizado`). Para "tutor legal ve siempre" (Q7).
- **`usuario_es_audiencia_informe_row(p_centro_id, p_nino_id, p_estado)`** → boolean. **Row-aware**: recibe los campos del row por parámetro y **NO re-lee `informes_evolucion`** (evita el gotcha MVCC en `INSERT…RETURNING`, igual que F8). Sus lookups internos van a **otras** tablas (`roles_usuario`, `matriculas`, `profes_aulas`, `vinculos_familiares`). admin del centro o profe del niño (cualquier tipo) ⇒ TRUE (cualquier estado); familia ⇒ solo `publicado` y `es_tutor_legal_de OR tiene_permiso_sobre('puede_ver_datos_pedagogicos')`.
- Reutiliza: `es_admin`, `es_profe_de_nino`, `es_profe_en_centro`, `centro_de_nino`, `tiene_permiso_sobre`, `set_updated_at`.

### RLS `plantillas_informe`

- **SELECT** `plantillas_informe_select`: `es_admin(centro_id) OR es_profe_en_centro(centro_id)`. STAFF del centro (la profe necesita leer la plantilla para crear el informe). **La familia NO accede**: deliberadamente NO se usa `pertenece_a_centro`, que incluiría a los tutores (tienen fila en `roles_usuario`).
- **INSERT** `plantillas_informe_insert`: `es_admin(centro_id) AND creado_por = auth.uid()`.
- **UPDATE** `plantillas_informe_update`: `USING + WITH CHECK` `es_admin(centro_id)`. Archivar (`estado='archivada'` + `archivada_at/por`) pasa por aquí (solo admin).
- **DELETE**: sin policy → **default DENY**. Se archiva, no se borra.

### RLS `informes_evolucion`

- **SELECT** `informes_evolucion_select`: `usuario_es_audiencia_informe_row(centro_id, nino_id, estado)` (row-aware). Staff del aula (admin/profe del niño, incluido `tecnico`/`apoyo`) ve cualquier estado; familia ve **solo publicados** (tutor legal siempre; autorizado con `puede_ver_datos_pedagogicos` — Q7). Nunca borradores para la familia.
- **INSERT** `informes_evolucion_insert`: `creado_por = auth.uid() AND (es_admin(centro_id) OR (es_redactor_de_nino(nino_id) AND centro_de_nino(nino_id)=centro_id))`. `tecnico`/`apoyo` **no** crean (el helper los excluye).
- **UPDATE** `informes_evolucion_update`: `USING + WITH CHECK` `es_admin(centro_id) OR es_redactor_de_nino(nino_id)`. Cubre editar/publicar/despublicar. La regla de publicación (todos los ítems valorados, Q9) y el sellado de `notificado_at` (Q8, no re-aviso) los enforza el **server action** en F9-2, no la BD. **Sin ventana temporal** (Q6): se corrigen informes de períodos/cursos pasados (NO sigue ADR-0016).
- **DELETE**: sin policy → **default DENY**. Corrección = despublicar/editar.

### Gotcha MVCC (Fase 9)

`informes_evolucion_select` invoca `usuario_es_audiencia_informe_row`, que es **row-aware** y nunca re-lee `informes_evolucion` (sus lookups van a otras tablas ya commiteadas) → `.insert().select()` por la coordinadora funciona. Test explícito como bloqueo de regresión. `plantillas_informe_select` no usa helper que re-lea la propia tabla.

## Campaña de informes (Fase 9-5)

1 tabla — `campanas_informe` — y 1 ENUM (`estado_campana_informe`). Ver [ADR-0044](../decisions/ADR-0044-modelo-campana-informes.md) y spec `docs/specs/campana-informes.md`. **Capa de coordinación, NO una puerta**: no toca ni bloquea `informes_evolucion` (vínculo lógico por (centro, curso, período), sin FK — Q6). Se audita (`centro_id` directo). Sin Realtime.

- **`campanas_informe`** — plazo de entrega de informes por (centro, curso activo, período). Reusa los helpers existentes; **no crea helpers nuevos**.
  - **SELECT** `campanas_informe_select`: `es_admin(centro_id) OR es_profe_en_centro(centro_id)`. STAFF del centro (las profes necesitan leer la campaña y su fecha para el aviso de pendientes y el botón de publicar en lote). **La familia NO accede** (deliberadamente NO se usa `pertenece_a_centro`, que incluiría a los tutores — mismo criterio que `plantillas_informe` en F9).
  - **INSERT** `campanas_informe_insert`: `es_admin(centro_id) AND created_by = auth.uid()`. Solo la dirección abre campañas.
  - **UPDATE** `campanas_informe_update`: `USING + WITH CHECK` `es_admin(centro_id)`. Cubre cerrar, **reabrir** y **editar `fecha_limite`** (Q4). Solo admin.
  - **DELETE**: sin policy → **default DENY**. Cerrar (`estado='cerrada'`, reversible) sustituye al borrado; sin `deleted_at`.

- **Gotcha MVCC (Fase 9-5): no aplica.** `campanas_informe_select` usa `es_admin`/`es_profe_en_centro`, que leen `roles_usuario`/`profes_aulas` (otras tablas), **nunca** `campanas_informe`. Por eso **no** hace falta un helper row-aware nuevo (a diferencia de `informes_evolucion`, cuya audiencia depende de columnas del propio row). Test `.insert().select()` por el admin como bloqueo de regresión.

- **Pendientes derivados (sin RLS propia):** "informes pendientes de la campaña" no es una tabla; se computa en la app (niños con matrícula activa sin informe publicado de la terna) reusando la RLS de `informes_evolucion` y el patrón de avisos de INICIO de #64. La publicación en lote reusa `informes_evolucion_update` (Fase 9) — no añade policy nueva.

## Fotos y publicaciones — blog del aula + Storage (Fase 10)

3 tablas — `publicaciones`, `media`, `media_etiquetas` — + la columna `ninos.puede_aparecer_en_fotos` + **4 buckets de Storage**. Ver [ADR-0045](../decisions/ADR-0045-storage-buckets-y-blog-aula.md) y spec `docs/specs/fotos-publicaciones.md`. **Las 3 tablas se auditan** (`centro_id` directo). **Primer uso de Supabase Storage**: el acceso a los **objetos** se gobierna con políticas sobre `storage.objects`, no solo con la RLS de las tablas.

### Helpers nuevos (`STABLE SECURITY DEFINER SET search_path = public`, GRANT `authenticated`)

- `es_redactor_de_aula(p_aula_id)` → boolean. Profe del aula con `tipo_personal_aula IN ('coordinadora','profesora')` activa (corte de autoría P5/ADR-0032; espejo de `es_redactor_de_nino` por aula). tecnico/apoyo → false.
- `familia_ve_aula(p_aula_id)` → boolean. ¿Soy familia con `puede_ver_fotos` de algún niño matriculado activo en el aula? Aquí se **conecta a RLS real** el permiso `puede_ver_fotos` (inerte hasta F10) vía `tiene_permiso_sobre(nino, 'puede_ver_fotos')`.
- `nino_puede_aparecer(p_nino_id)` → boolean. Lee `ninos.puede_aparecer_en_fotos` (gate de etiquetado, P2).
- `publicacion_tiene_nino_sin_permiso(p_publicacion_id)` → boolean. ¿La publicación etiqueta a algún niño sin permiso? (para ocultarla a la familia al **revocar** — P2). Lee `media`/`media_etiquetas`/`ninos` (NO `publicaciones`).
- **`publicacion_etiqueta_hijo_de(p_publicacion_id)` → boolean (F10-2, histórico).** ¿La publicación etiqueta a un hijo del tutor actual **con** `puede_ver_fotos`? `EXISTS` sobre `media`/`media_etiquetas` con `es_tutor_de(nino) AND tiene_permiso_sobre(nino, 'puede_ver_fotos')`. **Row-aware**: lee `media`/`media_etiquetas`/`vinculos`/`ninos` (NO `publicaciones`). Migración `20260612120000_phase10_2_fotos_familia_historico`.
- Lookups: `aula_de_publicacion`, `centro_de_publicacion`, `autor_de_publicacion` (leen `publicaciones`), `publicacion_de_media` (lee `media`).
- **`usuario_ve_publicacion_row(p_centro_id, p_aula_id, p_publicacion_id)`** → boolean. **Row-aware** (recibe los campos por parámetro, **NO re-lee `publicaciones`** → evita el gotcha MVCC en `INSERT…RETURNING`). **`CREATE OR REPLACE` en F10-2** para añadir la vía histórica: `es_admin(centro) OR es_profe_de_aula(aula) OR (familia_ve_aula(aula) AND NOT publicacion_tiene_nino_sin_permiso(pub)) OR (publicacion_etiqueta_hijo_de(pub) AND NOT publicacion_tiene_nino_sin_permiso(pub))`. La 3.ª vía = "blog del aula activo" (matrícula activa); la 4.ª = **histórico** ("mi hijo sale etiquetado" aunque ya no tenga matrícula activa en esa aula → conserva lo pasado, no ve lo nuevo del aula). P2 + P-histórico. La 4.ª vía pasa por `es_tutor_de`, así que solo vale con el **vínculo vivo**: cubre el cambio de aula, **no la baja** (ver «Qué conserva la familia de cursos pasados»).
- Reutiliza: `es_admin`, `es_profe_de_aula`, `es_profe_de_nino`, `es_profe_en_centro`, `es_tutor_de`, `tiene_permiso_sobre`, `centro_de_aula`.

### RLS de las tablas

- **`publicaciones`**:
  - SELECT `publicaciones_select`: `usuario_ve_publicacion_row(centro_id, aula_id, id)` (row-aware). Staff del aula ve todo; familia con `puede_ver_fotos` ve **todo el blog del aula** (P2) salvo publicaciones que etiqueten a un niño sin permiso (ocultas).
  - INSERT `publicaciones_insert`: `autor_id = auth.uid() AND (es_admin(centro_id) OR es_redactor_de_aula(aula_id))` (P5). `centro_id` lo deriva el trigger del aula.
  - UPDATE `publicaciones_update`: `USING + WITH CHECK` `es_admin(centro_id) OR autor_id = auth.uid()` (editar; P-edición).
  - DELETE `publicaciones_delete`: `es_admin(centro_id) OR autor_id = auth.uid()` (**borrado real**, el objeto en Storage lo borra el server; P-borrado).
- **`media`** (SELECT hereda la visibilidad de su publicación vía lookups): INSERT/DELETE = autor de la publicación o admin. Sin UPDATE (default DENY; el procesado del pipeline F10-1 va por service role).
- **`media_etiquetas`**: SELECT vía la publicación de la media; INSERT = (autor o admin) **AND** `nino_puede_aparecer(nino_id)` (gate P2 — el aviso a la profe es UI F10-2); DELETE = autor o admin.
- **Gotcha MVCC (Fase 10):** `usuario_ve_publicacion_row` es row-aware y nunca re-lee `publicaciones`; sus lookups van a otras tablas. `media`/`media_etiquetas` resuelven la publicación con helpers que leen `publicaciones`/`media` (tablas distintas de la que se inserta) → `.insert().select()` seguro. Test explícito como bloqueo de regresión.

### Políticas de Storage (`storage.objects`)

Las rutas codifican el ámbito (`(storage.foldername(name))[n]`): `[1]=centroId` siempre; en `aula-fotos`, `[2]=aulaId`, `[3]=publicacionId`. Buckets **privados** (acceso solo por URL firmada ~1 h que genera el server tras autorizar) salvo el logo, **público**.

- **`aula-fotos`** (blog): SELECT = `usuario_ve_publicacion_row(centroId, aulaId, publicacionId)`; INSERT = `es_admin(centroId) OR es_redactor_de_aula(aulaId)` (P5); DELETE = `es_admin(centroId) OR autor_de_publicacion(publicacionId)=auth.uid()`.
- **`ninos-fotos`** (foto de la ficha, `ninos.foto_url`). Ruta `{centroId}/{ninoId}/…`. SELECT = `es_admin(centroId) OR es_profe_de_nino(ninoId) OR es_tutor_de(ninoId)`. Escribir/borrar = `es_admin(centroId)` (F10-0) **OR `es_tutor_de(ninoId)`** (F10-3, `[2]=ninoId`): el tutor sube/sustituye la foto de **su** hijo, dirección la de cualquiera. El `UPDATE` de `ninos.foto_url` (que el tutor no puede por la RLS de `ninos`) lo hace el server con **service role tras autorizar**.
- **`recogida-adjuntos`** (foto DNI de F8, `firmas.datos.adjuntos`). Ruta `{centroId}/{ninoId}/…` (el `{firmaId}` no existe al subir-antes-de-firmar). SELECT/INSERT **baseline** staff del centro (`es_admin OR es_profe_en_centro`, `[1]=centroId`) **+ F10-3** `es_tutor_de(ninoId)` (`[2]=ninoId`): el tutor sube/relee el DNI de **su** recogida; DELETE = `es_admin`. La referencia se ata a la firma por el hash (`datos.adjuntos`). Sensible (DNIs de terceros) → RAT/retención en F11.
- **`centro-assets`** (logo, **público** — ADR-0010): SELECT público; escribir/actualizar/borrar = `es_admin(centroId)` (F10-0; el tutor NO escribe — verificado por test). En F10-3 dirección sube el logo aquí y repunta `centros.logo_url`.
- **Desde `20261027120000`** (PR 3 de la Fase 4), las policies de los buckets con niño, familia o aula en la ruta exigen además `ruta_coherente(bucket_id, name)`, y las de escritura de `centro-assets`, que la ruta tenga carpeta. Ver «Storage: las rutas no cruzan de centro».

### Políticas de Storage del tutor (F10-3)

Migración `20260613100000_phase10_3_adjuntos_storage_policies` (aditiva, solo `CREATE POLICY`; **no** toca las de F10-0). Suma al **tutor** (RLS de `storage.objects` es permisiva → OR entre políticas): `ninos_fotos_insert_tutor`/`ninos_fotos_delete_tutor` y `recogida_adjuntos_insert_tutor`/`recogida_adjuntos_select_tutor`, todas con `es_tutor_de(((storage.foldername(name))[2])::uuid)`. **Aislamiento entre familias** verificado por `adjuntos-storage.rls.test.ts`: un tutor no escribe bajo el `{ninoId}` de otra familia; el logo solo lo escribe dirección.

## Postura de seguridad (octubre de 2026)

Viene de la auditoría F11-D de octubre y de la limpieza de RPCs para anon. La decisión y sus
alternativas están en [ADR-0053](../decisions/ADR-0053-postura-seguridad-bd.md). Aquí va lo que
hay que saber al escribir una policy, una función o una migración.

### Privilegios por defecto de Supabase y `anon`

Supabase concede por defecto `EXECUTE` a `PUBLIC` y a `anon` en cada función nueva, y todos los
privilegios en cada tabla. La anon key es pública porque va en el bundle, así que eso equivale a
abrir la función o la tabla a cualquiera por PostgREST.

- **Funciones:** toda función nueva lleva `REVOKE ALL ON FUNCTION … FROM PUBLIC, anon`. A quién se
  concede:
  - `authenticated`, solo si la app la llama con sesión;
  - ni siquiera a `authenticated` si solo la usan el servidor o el cron (`service_role`). Ejemplos:
    `purgar_sujeto_db`, `olvido_pendientes` y las de esqueletos.
  - las claves de Vault (`_get_medical_key`, `_get_sepa_key`) solo las ejecuta su dueño.

  Migraciones: `20261002140000` (10 RPCs críticas, #293), `20261002150000` (35 del grupo B, #295),
  `20261002160000` (20 helpers de RLS, #297) y `20261010130000` (las 46 funciones auxiliares que
  quedaban: `centro_de_*`, `hoy_madrid`, `menu_del_dia`…). Desde esta última, anon no puede
  ejecutar ninguna función de `public` salvo las de trigger, que no se pueden llamar por RPC.
  Desde `20261026120000`, 11 de esas 46 solo las ejecuta `service_role` y otras 7 comprueban el
  centro de quien llama (ver «Funciones auxiliares: solo contestan a su centro»). Y desde
  `20261028120000`, 24 viven en el esquema `privado`, fuera de la API (ver «Funciones auxiliares
  fuera de la API»).

- **Tablas:** anon no tiene ningún privilegio de tabla en `public` (ni `SELECT`), y
  `authenticated` no tiene `TRUNCATE` ni `MAINTAIN`, que no pasan por RLS
  (`20261010140000_fix_privilegios_tabla_anon`; antes solo `audit_log`, #283). Con la anon key,
  cualquier tabla da 42501 «permission denied for table». `authenticated` conserva `SELECT`,
  `INSERT`, `UPDATE` y `DELETE`, que acota la RLS.
- **Default privileges (la causa raíz):** desde `20261010140000`, lo que crea `postgres` en
  `public` ya no nace abierto a anon: ni tablas, ni funciones, ni secuencias. Las tablas nuevas no
  dan `TRUNCATE`/`MAINTAIN` a `authenticated`, y las funciones nuevas de `postgres` no dan
  `EXECUTE` a `PUBLIC` (default global de Postgres, quitado sin `IN SCHEMA`). Las funciones nuevas
  siguen recibiendo `EXECUTE` para `authenticated` y `service_role`: si solo las usa el servidor,
  hay que quitárselo a `authenticated` a mano.
- **Policies:** todas las del esquema `public` son `TO authenticated`. Eran 156 `TO public` y se
  pasaron con `20261002160000`, sin cambiar `USING` ni `WITH CHECK`; una guarda en la migración
  impide que quede ninguna.
  - anon ya no las evalúa: sin llamar a ningún helper. Desde `20261010140000` ni siquiera llega a
    ellas: no tiene privilegio de tabla y recibe 42501 antes de la RLS.
  - La única excepción deliberada es `storage.objects · centro_assets_select`, el logo del bucket
    público (ADR-0010).
- **El orden importa.** Primero las policies a `TO authenticated` y después el REVOKE de los
  helpers. Al revés, las lecturas de anon pasarían de «0 filas» a «permission denied for function»,
  que además revela que la tabla existe y está protegida.

### «Sin uid» en funciones `SECURITY DEFINER`

Una función que acepte `auth.uid()` NULL solo deja pasar a:

- `auth.role() = 'service_role'`;
- una sesión directa sin JWT: `session_user <> 'authenticator'` y sin `request.jwt.claims`.

PostgREST entra siempre como `authenticator`, así que una petición anónima nunca cuenta como sesión
directa. El resto recibe 42501. Aplicado en las RPCs de olvido, consentimientos e imagen
(`20261001130000`, #284; `20261002140000`, #293). En `otorgar_consentimiento_imagen`, quien no es
admin ya no puede atribuir el consentimiento a otro tutor: `p_tutor := auth.uid()`.

### Actor humano en `audit_log`

`audit_trigger_function` graba `usuario_id = auth.uid()`. **Una escritura con service role graba
NULL** en `usuario_id`; desde `20261011130000` deja en `actor_sistema` qué operación fue (`system:purgar_sujeto_db`, `system:purgar_esqueleto_huerfano_nino` o `system:service_role`). La etiqueta solo se lee sin humano: nunca tapa a una sesión. Por eso las escrituras en tablas auditadas van con la sesión del usuario:

- **Si la RLS de filas basta,** con el cliente de sesión. Ejemplos: `ninos_admin_all` y
  `familia_tutores_*` al aprobar cambios pendientes, o `media_delete`.
- **Si hace falta escribir columnas concretas** que una policy no puede acotar, con una RPC
  `SECURITY DEFINER` que la app llama con sesión. Dentro, `auth.uid()` sigue siendo el `sub` del
  JWT. Son `actualizar_familia_nino`, `fijar_libro_familia_nino` y `quitar_foto_perfil_nino`
  (`20261005120000`, #307; reparada en producción con `20261005140000`, #308).
  - Autorización: `es_admin(centro del niño)` o `es_tutor_legal_de`.
  - Con el alta ya validada, el tutor recibe 42501 y su cambio va a `cambios_pendientes`; lo
    comprueba el helper interno `alta_validada_de_nino`.
- **El service role** queda para Storage y para el censo de escrituras justificadas que recoge #307.

### Rutas e identificadores del cliente: se validan en la BD contra la fila

Si la app va a usar después una ruta o un identificador con service role (borrar en Storage,
escribirla en otra tabla), la BD la valida contra la fila, no contra el valor de entrada:

- **`cambios_pendientes`:** CHECK `cambios_pendientes_ruta_documento_del_nino` (`20261003120000`,
  #300). En `ninos_libro_familia` y `datos_tutor_dni`, `payload->>'path'` tiene que ser
  `{centro_id}/{nino_id}/<nombre>.pdf`, con un solo segmento final `[A-Za-z0-9_-]`. `centro_id` lo
  fija el trigger BEFORE.
- **`media`:** trigger `media_validar_ruta_trg`, que llama a `media_validar_ruta` (`20261003140000`,
  #302).
  - `path` y `path_miniatura` tienen que ser `{centro}/{aula}/{publicacion}/<nombre>.jpg`, con el
    prefijo sacado de la publicación de la fila. Si no, da 23514.
  - Es un trigger porque `media` no tiene `aula_id` y un CHECK no puede consultar `publicaciones`.
- **`familia_tutores.dni_documento_path` y `mandatos_sepa.documento_path`** (`20261024130000`,
  PR 0b de la Fase 4): triggers `familia_tutores_validar_ruta_dni_trg` y
  `mandatos_sepa_validar_ruta_trg`. El export las firma con service role, y un tutor podía
  apuntar la suya al DNI o al mandato de otra familia, también del mismo centro.
  - DNI: `{centro}/{niño de esa familia}/<nombre>.pdf`. Mandato: lo mismo, o
    `{centro}/familia/{esa familia}/<nombre>.pdf`. `{centro}` es el de la familia. Si no, 23514.
  - NULL (y `''` en el mandato presencial) siguen valiendo, y solo se mira la ruta cuando cambia.
  - Test: `rutas-guardadas-export.rls.test.ts`.
- **La app comprueba lo mismo antes de borrar**, como segunda capa: `rutaDocumentoDelNino` y
  `rutaDeLaPublicacion`.

### Multicentro: coherencia de centro en la BD

Un trigger BEFORE INSERT OR UPDATE se aplica a todos, también a service role y al dueño con
BYPASSRLS. Así no pueden existir filas que crucen de centro y las lecturas nunca filtran
(`20261004120000`, #304):

- **`invitaciones_validar_centro_trg`:** el niño y el aula de la invitación son de su centro.
- **`anuncios_validar_aula_centro_trg`:** el aula del anuncio es de su centro.
- **Además:**
  - la rama admin de `anuncios_insert` exige `aula_id IS NULL OR centro_de_aula(aula_id) = centro_id`;
  - la rama `aula` de `usuario_es_audiencia_anuncio(_row)` comprueba el centro;
  - en la app, `destinatariosPushDeAnuncio` filtra por centro.

Las guardas de equivalencia de esa migración comparan la lógica normalizada (#305; regla en
`CLAUDE.md`).

### Invitaciones: la sesión no ve ni escribe el token (PR 0a, Fase 4)

Migración `20261024120000_fix_invitaciones_token_y_cuenta_operativa`. El enlace de una
invitación completa el alta a medias de su email y le fija la contraseña, y el token es lo único
que lo protege. La directora podía conseguirlo por tres vías: leerlo con su sesión, crear una
invitación con el token que ella eligiera, o cambiar el email de una invitación cuyo token ya
conocía. Y «sin roles vivos» incluía al superusuario (ADR-0061) y a quien perdió su rol.

- `authenticated` no tiene INSERT ni UPDATE en `invitaciones`, ni SELECT de `token`. Lee las
  otras 14 columnas y conserva el DELETE. La app escribe las invitaciones con service role.
  **Cada columna nueva de `invitaciones` necesita su `GRANT SELECT (columna)` explícito.**
- `cuenta_ha_operado(usuario)` (solo `service_role`): TRUE si tuvo alguna vez un rol, vivo o
  retirado, o es superusuario. La aceptación (`acceptInvitationCore`) y la página de la
  invitación no completan como alta nueva una cuenta así: va por B8 y entra con su contraseña.
- Test: `invitacion-toma-de-cuenta.rls.test.ts`, contra el GoTrue real.

### Entre centros no se vincula a nadie sin que acepte (PR 1, Fase 4)

Migración `20261025120000_fix_vinculacion_entre_centros` y el código del alta. Cierra D4 (el
oráculo del email, ADR-0053 apartado 9) y los cuatro huecos de vinculación. **La regla:** una
cuenta solo entra en un centro cuando ella misma acepta la invitación. El 2.º hijo de una familia
que ya es de ese centro sigue entrando directamente.

- **`crear_o_anadir_a_familia`** solo acepta un `p_usuario_id` que ya tenga perfil en
  `familia_tutores`, en una familia de `p_centro_id`, o una cuenta que no ha operado nunca (sin
  roles, ni superusuario, ni perfil): la recién creada de «Completar en Dirección». Lo demás da
  **42501**. La guarda previa exige el cuerpo de `20261002130000` (md5 normalizado).
- **`lista_espera.tutor_usuario_id`**: trigger `lista_espera_validar_tutor_trg` (BEFORE INSERT o
  UPDATE de la columna o del centro), con la misma exigencia, para cualquiera, también service
  role: **23514**. Solo mira la columna cuando cambia.
- **La app:** la detección por email (`resolverTutorPorEmail`) solo mira este centro. Una cuenta
  de otro centro se ve como «familia nueva» y, al promover (`tutorDeEsteCentro`), se invita: la
  RPC crea su perfil sin cuenta. A una cuenta que ya existe no le llega el correo de GoTrue
  (`email_exists`): le llega un aviso por Resend (`enviarAvisoInvitacion`) que la lleva a
  `/profile/invitations`, y quien invita ve lo mismo que con un email sin cuenta.
- **Aceptar desde el perfil** (`acceptPendingInvitationCore`) enlaza `familia_tutores.usuario_id`
  y el nombre de la cuenta antes de crear el rol y el vínculo. Sin perfil pendiente, no sigue.
- «Completar en Dirección» con una cuenta que ya operó (de otro centro, el superusuario) no le
  crea cuenta ni le toca la contraseña: crea el alta y la invita. `crearTutorDirecto` tampoco
  reutiliza como «alta a medias» una cuenta que ya operó (`cuenta_ha_operado`).
- El parentesco del 2.º hijo solo se hereda de vínculos con niños de este centro.
- Si el correo de la invitación no sale, el alta queda creada, el prospecto sale de la cola y la
  directora lo lee (`alta_creada_sin_correo`). Nunca sigue en silencio.
- Test: `vinculacion-entre-centros.rls.test.ts`, contra el GoTrue real.

### Funciones auxiliares: solo contestan a su centro (PR 2a, Fase 4)

Migración `20261026120000_fix_funciones_auxiliares_centro`. `20261010130000` cerró a anon las 46
funciones auxiliares, pero con sesión seguían contestando a cualquiera, fuera cual fuera su centro:
son consultas por el id recibido. Censo en producción del 2026-10-20, por quién las usa:

- **11 sin ningún uso con sesión** (ni policies, ni CHECK, ni la app, ni funciones de invocador;
  solo las llaman funciones `SECURITY DEFINER`): sin `EXECUTE` para `authenticated`. Son
  `centro_abierto`, `centro_de_conversacion`, `centro_de_curso`, `centro_de_remesa`,
  `familia_de_nino`, `nino_de_conversacion`, `nino_de_recibo`,
  `publicacion_tiene_nino_sin_permiso`, `recibo_en_remesa`, `tiene_consentimiento_imagen` y
  `tiene_consentimiento`. Esta última, el consentimiento de cualquier usuario, la usa solo
  `marcar_matricula_lista`; cerrada del todo no se puede sondear. Si algún día la app la
  necesita, se abre con la comprobación de «solo el propio».
- **5 que la app llama y ninguna policy usa:** `menu_del_dia`, `tipo_de_dia`, `mes_cerrado`,
  `existe_consentimiento_imagen` y `nino_toma_comida_solida`. Si quien llama no es del centro
  (del niño, en las dos últimas), **42501**. Pasan de `sql` a `plpgsql` para poder abortar.
  Sin menú, `menu_del_dia` contesta lo mismo que antes: por PostgREST, una fila con todo a NULL
  (`getMenuDelDia` mira `row.id`).
- **`curso_activo_de_centro` y `es_tutor_en_centro`** también los llama la app, pero además los
  usan policies (`matriculas_profe_select`, `conversaciones_insert`, `recordatorios_*`) y, por
  dentro, `es_profe_de_aula` y `es_redactor_de_aula`. Esas se evalúan fila a fila, también sobre
  filas de otros centros: un RAISE rompería la consulta entera. Por eso a quien no es del centro
  no le contestan nada (NULL y FALSE), igual que si no hubiera curso o vínculo.
  `es_tutor_en_centro` solo contesta de uno mismo o a la directora de ese centro.
- «Del centro» es `pertenece_a_centro` (un rol vivo en él) o `es_admin`, que incluye al
  superusuario. A `es_admin` nunca se le pasa NULL: daría TRUE a cualquier admin. Sin sesión, solo
  el servicio («Sin uid» nunca es el servicio).
- Quedan 24 que usan policies o triggers de invocador, más 4 de reloj y puras. A esas **no** se
  les puede añadir la comprobación dentro: un `centro_de_*` que devolviera NULL a quien es de fuera
  dejaría pasar a todas las admins en las policies `es_admin(centro_de_X(...))`. Desde el PR 2b
  viven en un esquema que la API no expone (ver «Funciones auxiliares fuera de la API»).
- Test: `funciones-auxiliares-centro.rls.test.ts`.

### Storage: las rutas no cruzan de centro (PR 3, Fase 4)

Migración `20261027120000_fix_storage_ruta_coherente`. Las policies de `storage.objects` leían el
centro de la ruta (`[1]`) y, aparte, el niño, la familia o el aula (`[2]`, `[3]`), sin comprobar
que lo segundo fuera del primero. Cada rama miraba solo uno de los dos: el tutor de un niño de B
subía un PDF a `A/niñoB/` y la directora de A lo veía. Y en la raíz del bucket, sin carpeta, `[1]`
es NULL y `es_admin(NULL)` es TRUE para cualquier admin.

- **`ruta_coherente(bucket, name)`** (`SECURITY DEFINER`, `EXECUTE` para `authenticated` y
  `service_role`): TRUE solo si la ruta tiene centro y su `[2]` es un niño de ese centro; en el
  mandato por familia, `{centro}/familia/{familia}/` con la familia de ese centro; en
  `aula-fotos`, el aula del centro y la publicación de esa aula. Compara como texto y valida cada
  segmento antes de convertirlo a uuid (`'familia'::uuid` rompería el mandato por familia). Sin
  carpeta, FALSE.
- **28 policies** de `aula-fotos`, `dni-tutores`, `libro-familia`, `mandato-sepa`, `ninos-fotos`
  y `recogida-adjuntos` la añaden con AND, sin tocar el resto de su condición.
- **3 de escritura de `centro-assets`** (el logo, `{centro}/logo.png`) exigen carpeta. Su lectura
  sigue pública (ADR-0010).
- `usuarios-fotos` no entra: su `[1]` es el usuario, y sin carpeta sus helpers dan FALSE.
- `ruta_coherente` solo combina `centro_de_*`. Desde el PR 2b vive con ellos en `privado`.
- Test: `storage-ruta-coherente.rls.test.ts`.

### Funciones auxiliares fuera de la API (PR 2b, Fase 4)

Migración `20261028120000_fix_funciones_esquema_privado`. 25 funciones de `public` traducían un id
en otro sin mirar quién preguntaba (`centro_de_nino`, `centro_de_familia`, `autor_de_publicacion`,
`organizador_de_cita`, `ruta_coherente`…), y PostgREST las publicaba: con sesión, cualquiera sabía a
qué centro pertenecía un niño, una familia o un aula de otro centro. No se les puede poner la
comprobación dentro: un `centro_de_*` que devolviera NULL a quien es de fuera abriría las policies
`es_admin(centro_de_X(...))`, porque `es_admin(NULL)` es TRUE para cualquier admin.

- **Viven en el esquema `privado`**, que PostgREST no expone (solo `public` y `graphql_public`, en
  `config.toml` y en producción; en producción no hay pg_graphql). Por RPC no las encuentra nadie
  (PGRST202), y pedir el esquema da PGRST106. Precedente: `vigia`.
- **La nocturna lo vigila:** la huella del job vigía compara también `privado` entre producción y
  la efímera, y su paso d pide el esquema a la API con la anon key: si no contesta PGRST106, la
  nocturna da rojo y abre el issue.
- **`privado` no se añade nunca a los esquemas expuestos de la API.** Esa es la protección:
  `authenticated` conserva USAGE en el esquema y EXECUTE en las funciones, porque las policies se
  evalúan con su rol y tres triggers son de invocador (`anuncios_validar_aula_centro`,
  `invitaciones_validar_centro`, `media_validar_ruta`). `anon` no tiene USAGE.
- **Las 97 policies que las usan no se tocan:** siguen a la función por su oid. En `pg_policies`
  aparecen ahora como `privado.centro_de_nino(...)`.
- **Los 42 cuerpos que las llaman por su nombre se recrearon** con `privado.`: triggers que derivan
  el `centro_id`, la auditoría y RPCs `SECURITY DEFINER`. Una función nueva que use una de las 25
  la llama como `privado.X(...)`.
- Se quedan en `public` las 4 de reloj y puras: `hoy_madrid`, `dentro_de_ventana_edicion`,
  `_redactar_jsonb` e `idiomas_iso_2letras`. No leen ninguna tabla.
- Test: `funciones-esquema-privado.rls.test.ts`.

### Lo exclusivo de la admin — `es_responsable` (PR 1 del modelo de roles)

Migración `20261029120000_fix_roles_es_responsable`. El modelo de roles tiene tres niveles:
superusuario, admin (una por centro) y directora (una o varias). `es_admin` pasará a significar
«Dirección» (admin o directora) cuando exista el rol (PR 2). Antes, este PR separa lo que es solo de
la admin.

- **`privado.es_responsable(p_centro_id)`**: la admin viva del centro, o el superusuario si el
  centro existe. El cuerpo de `es_admin` sin DEFAULT y con una diferencia: **con NULL da FALSE**.
  Vive en `privado`: la usan policies y funciones del servidor, y la API no la publica.
- **Usan `es_responsable` (28 policies y 7 funciones):**
  - el centro: escribir `centros` (datos, logo y datos de acreedor SEPA), las 3 de escritura de
    `centro-assets` y `set_datos_acreedor`;
  - las cuotas: escribir `conceptos_cobro`, `tarifa_concepto_anio` y `tipos_beca`;
  - el curso: ponerlo en `cerrado`, o tocar uno cerrado, en `cursos_academicos`, y `cerrar_curso`;
  - las plantillas de las normas internas y del consentimiento de imagen (`autorizaciones` con
    `es_plantilla`). Enviarlas a un aula o al centro sigue siendo de Dirección;
  - los derechos RGPD: la rama de Dirección de `export_datos_sujeto`, `solicitar_olvido_nino`,
    `solicitar_olvido_usuario`, `olvido_pendientes` y `purgar_sujeto_db`, y leer `export_log`,
    `olvido_solicitudes` y `retencion_ejecuciones`;
  - el registro de auditoría (`audit_admin_select`);
  - los roles: escribir filas de `roles_usuario` e `invitaciones` con rol `admin`. Las de los
    demás roles siguen en `es_admin`.
- **Se quedan en `es_admin`**, porque Dirección los necesita: leer el centro, las cuotas y los cursos
  (la facturación), `get_datos_acreedor` (el XML de la remesa) y crear o activar un curso. Con el
  índice «un curso activo por centro», quien no es la admin solo activa si no hay ninguno activo: el
  paso de curso va por `cerrar_curso`.
- Las 4 policies `ALL` de `centros`, `cursos_academicos`, `roles_usuario` e `invitaciones` se
  partieron por orden (`*_admin_select`, `*_insert`, `*_update`, `*_delete`).
- **Sin cambio de comportamiento, salvo uno.** Todos los `centro_id` que se le pasan son NOT NULL,
  y con un centro no NULL las dos funciones dan lo mismo. La excepción es `audit_log`, cuyas filas
  de `usuarios` no tienen centro: antes las leía cualquier admin, ahora solo `service_role`.
  Además, `set_datos_acreedor(NULL, …)` da «No autorizado» en vez de no hacer nada.
- Test: `roles-es-responsable.rls.test.ts`. Lo que la directora no puede hacer se prueba cuando
  exista el rol.

### La directora — `es_admin` es Dirección (PR 2 del modelo de roles)

Migraciones `20261030120000_feat_rol_directora_enum` (el valor `directora` en `user_role`, sola
porque un valor nuevo de un enum no se puede usar en la transacción que lo añade) y
`20261030130000_fix_roles_directora`, que se aplica después.

- **`es_admin(centro)` es Dirección:** la admin o una directora del centro, o el superusuario. Todo
  el día a día que pasaba por `es_admin` le llega a la directora; lo exclusivo de la admin va por
  `privado.es_responsable` (ver arriba). `es_admin(NULL)` sigue dando TRUE para cualquier persona
  de Dirección de cualquier centro: nunca se le pasa NULL.
- **Anti-escalada:** en `roles_usuario` e `invitaciones`, crear, cambiar o quitar una fila de rol
  `admin` o `directora` exige `es_responsable`. Una directora no nombra a otra, no toca a la admin
  ni a otra directora, y no se toca a sí misma. Los demás roles siguen siendo de Dirección.
  Las únicas funciones que escriben roles de Dirección son `traspasar_admin` y
  `baja_de_direccion` (PR 4); el resto solo escribe `tutor_legal`, o los retira.
- **Una admin viva por centro:** índice único parcial `idx_roles_usuario_una_admin_viva`. El
  relevo de la admin es `traspasar_admin` (PR 4), que retira a la saliente antes de dar de alta a
  la entrante, en la misma transacción.
- **`firma_imagen_sync`** cuenta la firma presencial de la admin o de una directora del centro del
  niño. Antes miraba `rol = 'admin'`: la de una directora entraba por la policy y el
  consentimiento no se registraba.
- **Los roles se comparan como texto** (`rol::text IN ('admin', 'directora')`), para no usar el
  valor nuevo como literal en la migración que lo necesita.
- **Autorizaciones:** la identidad del documento no cambia (trigger
  `autorizaciones_identidad_inmutable_trg`, 23514), y las plantillas de las normas internas y del
  consentimiento de imagen las edita solo la admin. Quien creaba una autorización (la directora, la
  profe de su salida o la familia de su recogida) podía cambiarle el tipo, el alcance o el centro
  mientras nadie la firmara: una familia convertía su recogida en las normas del centro para todo
  el centro o se la llevaba a otro centro, y una profe convertía su salida en la plantilla de las
  normas.
- **La app** reconoce el rol desde el PR 3 (ver la sección siguiente).
- Tests: `roles-directora.rls.test.ts` (hace el día a día, no hace lo exclusivo, no puede escalar,
  una admin viva por centro) y `autorizaciones-identidad.rls.test.ts`.

### La directora en la app (PR 3 del modelo de roles)

Sin migración. La BD ya autoriza (PR 1 y PR 2); la app deja entrar a la directora, no le enseña lo
que no es suyo y no escribe en su nombre lo que la BD no le dejaría escribir a ella.

- **En la app, `admin` es Dirección.** `resolver.ts` lee la fila `directora` de `roles_usuario`
  como rol `admin` (`rolDeLaApp`), y es el único sitio que la traduce: cada `rol === 'admin'` de la
  app es Dirección, como `es_admin` en la BD. `rolesDeAutores` también la devuelve como `admin`
  (la etiqueta «Dirección» del mensaje).
- **Lo exclusivo de la admin va por `esResponsable`:** la admin viva del centro o el superusuario,
  como `privado.es_responsable`. Está en `CentroDelUsuario` y en `ContextoCentro`, y en los helpers
  `esResponsableEn(supabase, usuario, centro)` y `usuarioResponsableEn(supabase, centro)`.
- **El proxy** deja pasar `admin` y `directora` en `/admin` y en `/teacher` (`proxy-roles.ts`):
  ve la fila tal cual, antes de que haya contexto de centro.
- **Guardas de las acciones exclusivas** (`usuarioResponsableEn`, antes de escribir): los datos y
  el logo del centro, los datos de acreedor, los conceptos de cobro y sus tarifas por año, los
  tipos de beca, confirmar el paso de curso (`cerrar_curso`), crear las plantillas legales y
  activar un curso cuando ya hay otro activo (lo cerraría). Una directora recibe «no autorizado»
  sin que la app escriba ni llame a la RPC. Sin la guarda, varias daban «guardado» sin guardar: un
  UPDATE sin RETURNING que la RLS deja en 0 filas no da error.
- **`sendInvitation`** escribe la invitación con service role, que se salta la anti-escalada de la
  RLS. Invitar a una directora exige `esResponsableEn` (desde el PR 4 no se invita a una admin).
  Sin esa guarda, reconocer a la directora como Dirección le habría dejado nombrar a otra.
- **Menús y pantallas:** Centro y Auditoría no salen en el menú de una directora, y sus páginas la
  mandan a `/forbidden` (`buildSidebarItems` exige `esResponsable`, para que ningún layout se lo
  deje). En las páginas mixtas ve la página sin el botón exclusivo: el catálogo de conceptos, los
  tipos de beca y los datos de acreedor en Cuotas; la confirmación en Pasar de curso; crear,
  editar, publicar y anular las plantillas legales en Autorizaciones; los exports RGPD en la ficha
  del niño. En Cursos, con un curso activo, en lugar de «Marcar como activo» se le dice que eso lo
  hace la admin.
- **Invitación aceptada:** quien acepta una invitación de `directora` llega a `/admin`.
- Tests: `src/test/roles/directora-acciones.test.ts` (las guardas: hace el día a día, no hace lo
  exclusivo, no puede escalar; cada «no» con su ancla y la premisa de que la app la reconoce como
  Dirección), `roles-directora-app.rls.test.ts` (la lectura con su sesión contra la BD) y
  `sidebar-items.test.tsx` (el menú).

### Quién dirige el centro: directoras y traspaso (PR 4 del modelo de roles)

Migraciones `20261031120000_feat_motivos_baja_direccion` (dos valores de `motivo_borrado`, sola por
la misma razón que la del enum del PR 2) y `20261031130000_feat_traspaso_y_baja_direccion`.

- **`traspasar_admin(centro, nueva_admin)`** (`SECURITY DEFINER`, solo `authenticated`): la admin
  del centro traspasa la administración a una **directora viva del centro**, en una transacción.
  Retira la fila `admin` de la saliente y la `directora` de la entrante (`traspaso_admin`), da
  `admin` a la entrante y `directora` a la saliente: **la saliente queda como directora**. Solo
  quien tiene la fila `admin` viva (el superusuario no traspasa); a una profe, a alguien de otro
  centro o a sí misma, no (23514, 22023). Quien es de fuera se invita antes como directora.
- **`baja_de_direccion(centro, usuario)`**: una directora deja la dirección (`baja_direccion`). La
  da de baja la admin (o el superusuario), o se da de baja ella: la RLS no le deja tocar su propia
  fila. **La admin no se da de baja** (55000): primero traspasa, y la app le explica por qué.
- Dar otra vez un rol que la persona tuvo reactiva su fila retirada por `baja_direccion` o
  `traspaso_admin`. Desde `20261102120000` lo decide la tabla de motivos (ver «Lo que hace una
  invitación con una fila retirada»), también en las dos RPC.
- **No se invita a una admin** (`userRoleSchema` sin `admin`): aceptarla chocaba con el índice y
  la persona entraba sin rol. Se invita como directora y se le traspasa.
- **En la app:** «Dirección del centro» (`/admin/direccion`), solo para la admin (menú y página):
  quién dirige el centro, invitar, dar de baja, traspasar y las invitaciones pendientes. «Dejar la
  dirección» también en el perfil, por centro. En el resto de la app, admin y directora son
  «Dirección» (`auth.select_role.roles`); en esta pantalla se dice quién administra.
- Tests: `direccion-traspaso.rls.test.ts` (las dos RPC contra la BD, cada «no» con el estado
  intacto, la vuelta del traspaso y la invitación de quien dejó la dirección) y
  `gestionar-direccion.test.ts` (las acciones de la pantalla).

### El personal que se va no entra: baja temporal y salida del centro

Migraciones `20261101120000_feat_motivos_baja_personal` (dos valores de `motivo_borrado`, sola por
la misma razón que la del enum del PR 2) y `20261101130000_feat_baja_temporal_y_salida_profe`.
Hasta ahora, sacar a una profe del centro era cerrar su aula (`terminar-asignacion`): su fila
`profe` seguía viva, seguía entrando y leía lo del centro (calendario, menús, eventos, los DNI de
las recogidas). **Decisión del responsable: quien no trabaja en el centro no entra y no ve nada.**
Son dos estados:

- **`baja_temporal`** (enfermedad, maternidad, excedencia): no entra y no ve nada. Al volver,
  Dirección la reactiva desde Personal, **sin invitación** (`reactivar_profe`).
- **`salida_centro`** (despido o se va): definitivo. Si vuelve, es un alta nueva con invitación;
  `reactivar_profe` contesta 55000.
- **`dar_de_baja_profe(centro, usuario, motivo)`** (`SECURITY DEFINER`, solo `authenticated`):
  Dirección (`es_admin`), en una transacción, retira la fila `profe` con el motivo y cierra todas
  sus asignaciones abiertas en el centro (`fecha_fin` = hoy, o su `fecha_inicio` si empieza en el
  futuro). Cerrar el aula libera el puesto de coordinadora para la sustituta. Otro motivo, 22023;
  quien no es personal activo del centro, P0002. Devuelve las asignaciones cerradas.
- **La garantía, en un solo sitio:** `es_profe_de_aula`, `es_profe_de_nino`,
  `es_redactor_de_aula`, `es_redactor_de_nino` y la rama de centro de
  `usuario_es_audiencia_anuncio(_row)` exigen, además de la asignación, un rol `profe` vivo en el
  centro (`es_profe_en_centro`). Sin rol, nada, aunque un camino deje una asignación abierta. **Un
  helper nuevo que dé acceso por `profes_aulas` lleva la misma condición.**
- `recogida-adjuntos` se queda como está (cualquier profe del centro lee los DNI: puede estar
  cubriendo la recogida de otra aula). La puerta se cierra por el otro lado: quien se va pierde el
  rol.
- **La aceptación de una invitación ya no entra en silencio sin rol.** Antes de tocar nada mira si
  la fila retirada de ese rol vuelve (`motivoQueImpideElRol`): la baja temporal da «tu acceso está
  en pausa», sin marcar la invitación. Qué hace con cada motivo lo decide desde `20261102120000`
  la tabla de motivos (ver la sección siguiente).
- **En la app:** `/admin/personal` lista al personal por su rol, no por sus aulas (antes, quien
  tenía el rol y ningún aula no salía), con «Baja temporal» y «Salida del centro», y aparte quien
  está de baja temporal, con «Reactivar».
- Tests: `baja-personal.rls.test.ts` (cada «no ve nada» con su control positivo delante, la
  garantía con el aula reabierta, reactivar, la salida y la aceptación) y
  `baja-personal.test.ts` (las acciones).

### Lo que hace una invitación con una fila retirada

Migración `20261102120000_feat_invitaciones_reactivan_o_crean`. `UNIQUE (usuario_id, centro_id,
rol)` de `roles_usuario` y `UNIQUE (nino_id, usuario_id)` de `vinculos_familiares` contaban
también las filas retiradas: con una, el INSERT daba 23505 y, según el sitio, la persona entraba
sin rol, **sin vínculo y sin aviso** (el upsert con `ignoreDuplicates` de `crearVinculoAutomatico`),
o el alta reventaba. Decisión del responsable:

- **La unicidad cuenta solo las filas vivas** (`roles_usuario_viva_key`,
  `vinculos_familiares_vivo_key`, índices únicos `WHERE deleted_at IS NULL`). Un `ON CONFLICT` o un
  `upsert` de supabase-js sobre esas claves no casa con un índice parcial: no se usan.
- **Qué se hace con la última fila retirada lo decide su motivo, en un solo sitio**
  (`privado.decision_ante_retirada`), para roles y vínculos:

  | Motivo                                                                                       | Qué pasa                               |
  | -------------------------------------------------------------------------------------------- | -------------------------------------- |
  | `revocacion_familia`, `baja_direccion`, `traspaso_admin`, `paso_a_superusuario`, `baja_nino` | Se reactiva la fila, tal cual          |
  | `purga_rgpd`, `salida_centro`                                                                | Fila nueva; la vieja queda intacta     |
  | `solicitud_olvido`, `baja_temporal`                                                          | Falla con 55000 y el motivo en el HINT |

  Sin `ELSE`: un motivo nuevo sin clasificar falla, la guarda posterior de la migración lo caza
  contra el catálogo y el mapa del test es un `Record` sobre el enum (no compila sin decidirlo).

- **`privado.dar_rol` y `privado.dar_vinculo`** aplican la tabla y son las únicas funciones que
  insertan en esas dos tablas (guarda posterior). Con una fila viva no hacen nada; con
  `p_solo_comprobar` no escriben y dicen lo que harían, o fallan igual. Sin `EXECUTE` para nadie:
  las llaman funciones `SECURITY DEFINER`.
- **Quién pasa por ella:** `traspasar_admin`, `crear_o_anadir_a_familia` (también el alta de un
  hermano: una cuenta con el olvido en curso no vuelve por ahí), la aceptación de una invitación
  (`dar_rol_de_invitacion` y `dar_vinculos_de_invitacion`, solo `service_role`) y el vínculo que
  crea Dirección (`crear_vinculo`, `es_admin` del centro del niño; un vínculo vivo sigue siendo
  23505).
- **Las reactivaciones propias** (`desarchivar_nino`, la familia revocada de
  `crear_o_anadir_a_familia`, `reactivar_profe`) miran solo la última fila retirada y se la saltan
  si ya hay una viva.
- **En la app:** la aceptación lo comprueba todo antes de tocar nada (rol y vínculos, sin
  escribir): la baja temporal da «tu acceso está en pausa» y el olvido «hay en curso una petición
  de borrado de tus datos», sin marcar la invitación. Al invitar a una profe de baja temporal,
  Dirección lee «reactívala desde Personal». El alta en Dirección con una cuenta con el olvido en
  curso da `tutor_olvido`.
- Tests: `invitaciones-motivos.rls.test.ts` (cada motivo del catálogo, en roles y vínculos; manda
  la última retirada; la unicidad de las vivas; las puertas; el alta de hermano, la familia
  revocada y desarchivar con una fila viva al lado).

### Las lecturas filtran por su centro (PR 0 de la Fase 5)

Sin migración. La RLS de una tabla de centro dice **quién** ve una fila, no **de qué centro es la
página**: al superusuario (admin de todos los centros) y a quien tiene rol en dos centros les
devuelve las filas de todos. Una consulta que confiaba en que «la RLS acota al centro» mezclaba
centros en cuanto existiera el segundo, y es el panel de plataforma de la Fase 5 el que lo crea.
`check-centro-activo` no lo veía: vigila `roles_usuario` y la cookie.

- **Censo** (AST de TypeScript, todas las cadenas `.from()`): 19 consultas en 14 sitios se
  acotan ahora al centro de la página o del registro. Entre ellas, el recuento de altas por validar
  y el resumen de asistencia del inicio de Dirección, los cinco avisos del personal en
  `getAvisosInicio`, el catálogo, las instancias y las plantillas enviables de autorizaciones, la
  cola de cambios pendientes y su contador, las plantillas de informe, las aulas de la profe (su
  inicio, informes, pendientes de campaña y recordatorios) y las normas internas del alta, que
  podían salir las de otro centro de la familia. `rolesDeAutores` (la etiqueta de cada mensaje)
  usa los roles del autor en el centro de la conversación.
- **9 consultas que acotaban en JS** o con un filtro añadido después a una variable llevan ahora
  el filtro en la consulta (mensajería, audiencias de anuncios y push, tutores de Dirección).
- **La guarda** `scripts/check-lecturas-por-centro.mjs` (CI y unit): toda cadena
  `.from('<tabla de centro>')` que lee, actualiza o borra filtra (`eq`, `in`, `match`) por
  `centro_id` (también de un embebido, `nino.centro_id`), por `id` o por una FK que no apunte a
  `usuarios`, leídas del catálogo de `src/types/database.ts`. Si cruza centros a propósito, lleva
  encima `// entre-centros: <motivo>`; una marca sobre una consulta que ya filtra es un error. Un
  filtro hecho en JS o añadido después a una variable no cuenta. Las tablas que no son de un centro
  están en `SIN_CENTRO`, cada una con su motivo, y una tabla nueva entra vigilada.
- **Entre centros, a propósito (25):** el módulo de contexto (los centros del usuario, el proxy,
  ¿opera en algún centro?), las invitaciones por token o por email, el export art. 15 del sujeto,
  y el olvido y la retención (trabajos del servidor; el olvido acota al centro de la solicitud si
  no es el último, ADR-0059).
- **Cómo acotar:** `.eq('centro_id', centroId)`; en una tabla sin `centro_id`, por el niño o el
  aula con un embebido `!inner` (`.select('…, nino:ninos!inner(centro_id)').eq('nino.centro_id',
centroId)`). La función que lista recibe el centro de quien la llama (`requireContextoCentro` en
  la página), no lo deduce.
- Tests: `src/test/guards/check-lecturas-por-centro.test.ts` (el árbol real y un árbol de mentira
  donde cada caso se pone rojo), `roles-de-otros.rls.test.ts` y `roles-directora-app.rls.test.ts`
  (la etiqueta del autor en cada centro).

### El panel de plataforma — `platform_metricas` (PR 1 de la Fase 5)

Migración `20261103120000_feat_platform_metricas`. El panel del superusuario (`/plataforma`)
enseña, por cada centro vivo, recuentos y alertas. Solo cifras, ningún nombre: mirar el panel no se
audita (decisión del responsable); entrar en un centro sí (`elegirCentro` →
`registrar_entrada_superusuario`).

- **`platform_metricas()`** (`SECURITY DEFINER`, `STABLE`, `search_path = public`; `EXECUTE` solo
  para `authenticated`). Su **primera sentencia es `is_superadmin()`**: si no, 42501. Nunca
  `es_admin(NULL)`, que da TRUE a cualquier persona de Dirección de cualquier centro. La guarda
  posterior lo comprueba en el cuerpo y que no nombre `es_admin`.
- **Cada recuento con su predicado de «activo», contando personas (o niños, familias, aulas)
  distintas con fila viva, nunca filas** (lección BC-8 de MisterFC: hay filas retiradas por media
  base de datos):
  - niños matriculados: matrícula `activa` sin baja ni borrado, en el curso activo, de un niño vivo;
  - en alta, aparte: matrícula `pendiente` o `lista` en el curso activo, sin matrícula activa;
  - familias vivas con al menos un niño matriculado;
  - personal: rol `profe` vivo; de baja temporal, aparte: sin rol vivo y con la última fila retirada
    en `baja_temporal` (las que `reactivar_profe` devolvería);
  - Dirección: rol `admin` o `directora` vivo;
  - aulas vivas configuradas en el curso activo;
  - invitaciones sin aceptar, sin rechazar y sin caducar.
- **Alertas:** sin admin viva; sin curso activo; y, solo sin admin, la última invitación de admin
  sin aceptar ni rechazar (`pendiente` o `caducada`). Los centros borrados no salen.
- **En la app:** `/plataforma`, gateado en el proxy (`esRutaDePlataforma` → `is_superadmin`; un
  fallo cuenta como «no») y otra vez en su layout. «Entrar» es `elegirCentro`, y «Salir del
  centro» lleva al panel.
- Tests: `platform-metricas.rls.test.ts` (una fila en cada estado no activo, recorriendo el
  catálogo de `motivo_borrado` y de `matricula_estado`, con la premisa delante; las alertas; un
  centro borrado; la admin, una directora, una profe y anon reciben 42501),
  `proxy-plataforma.test.ts` y el test del layout.

### Signup público cerrado (D5)

- `[auth] enable_signup = false` en `config.toml`, y en el panel de producción «Allow new users to
  sign up» está desactivado (#310 y #311). Un `POST /auth/v1/signup` da `signup_disabled`.
- Todas las cuentas las crea el servidor con la API de admin, que no mira esa opción.
- `[auth.email] enable_signup` sigue en `true`: en la CLI esa clave enciende el proveedor de email.
- Tests: `signup-cerrado.rls.test.ts`.

### Tests del frente

| Qué prueba                                    | Fichero                                         |
| --------------------------------------------- | ----------------------------------------------- |
| `audit_log` sin escritura por permisos        | `audit-log.rls.test.ts`                         |
| RPCs de consentimiento de imagen              | `consent-imagen-rpc-seguridad.rls.test.ts`      |
| Consentimiento de imagen solo del tutor legal | `consent-imagen-tutor-legal.rls.test.ts`        |
| 10 RPCs críticas cerradas a anon              | `rpc-criticas-anon.rls.test.ts`                 |
| 35 RPCs del grupo B cerradas a anon           | `rpc-grupo-b-anon.rls.test.ts`                  |
| Policies y helpers cerrados a anon            | `rls-helpers-anon.rls.test.ts`                  |
| 46 funciones auxiliares cerradas a anon       | `funciones-auxiliares-anon.rls.test.ts`         |
| Nada para anon en ninguna tabla               | `privilegios-tabla-anon.rls.test.ts`            |
| Rutas de `cambios_pendientes`                 | `cambios-pendientes-ruta.rls.test.ts`           |
| Rutas de `media`                              | `media-ruta.rls.test.ts`                        |
| Rutas de DNI y mandato contra su familia      | `rutas-guardadas-export.rls.test.ts`            |
| Anuncios e invitaciones sin cruzar de centro  | `multicentro-anuncios-invitaciones.rls.test.ts` |
| Actor humano en la auditoría                  | `actor-humano-rpcs.rls.test.ts`                 |
| Signup cerrado                                | `signup-cerrado.rls.test.ts`                    |
| Invitación sin toma de cuenta                 | `invitacion-toma-de-cuenta.rls.test.ts`         |
| Entre centros, nadie entra sin aceptar        | `vinculacion-entre-centros.rls.test.ts`         |
| Funciones auxiliares solo de su centro        | `funciones-auxiliares-centro.rls.test.ts`       |
| Rutas de Storage sin cruzar de centro         | `storage-ruta-coherente.rls.test.ts`            |
| Funciones auxiliares fuera de la API          | `funciones-esquema-privado.rls.test.ts`         |
| Lo exclusivo de la admin (`es_responsable`)   | `roles-es-responsable.rls.test.ts`              |
| La directora: día a día, exclusivo, escalada  | `roles-directora.rls.test.ts`                   |
| La identidad de una autorización no cambia    | `autorizaciones-identidad.rls.test.ts`          |
| La app lee a la directora con su sesión       | `roles-directora-app.rls.test.ts`               |
| Traspaso de la admin y baja de Dirección      | `direccion-traspaso.rls.test.ts`                |
| Baja temporal y salida del personal           | `baja-personal.rls.test.ts`                     |
| La tabla de motivos de invitaciones y altas   | `invitaciones-motivos.rls.test.ts`              |
| Las lecturas filtran por su centro            | `check-lecturas-por-centro.test.ts` (guards)    |
| Métricas del panel: solo lo activo            | `platform-metricas.rls.test.ts`                 |

## `matriculas.motivo_baja` — permiso por COLUMNA (F-8 familia)

Migración `20261009120000_fix_matriculas_motivo_baja_por_columna`. `motivo_baja` puede llevar notas internas del centro y es dato **solo de Dirección**. Una policy RLS filtra filas, no columnas, así que se cierra por privilegio de columna:

- `authenticated`/`anon`/`PUBLIC` **no** tienen `SELECT` de tabla sobre `matriculas`. `authenticated` tiene `SELECT` de **todas las columnas menos `motivo_baja`**. Las policies de filas (`matriculas_admin_all`, `matriculas_profe_select`, `matriculas_tutor_select`) no cambian.
- Con sesión, pedir `motivo_baja` —o `select=*` / el embed `matriculas(*)`— da **42501**, también al admin y a la profe. `service_role` conserva su permiso de tabla.
- Dirección lee el motivo por la RPC **`get_motivos_baja_matriculas(p_nino_ids uuid[])`** (`SECURITY DEFINER`; admin del centro de TODOS los niños pedidos, si no 42501; un niño inexistente también se rechaza porque `es_admin(NULL)` sería TRUE).
- La familia ve su recorrido reducido por **`get_recorrido_nino_familia(p_nino_id)`** (`SECURITY DEFINER`, gate `es_tutor_legal_de`): curso, aula, estado `activa`/`baja` y fechas; nunca el motivo ni los tramos `pendiente`/`lista`. El autorizado recibe 42501.
- Las dos RPC: `REVOKE` de `PUBLIC`/`anon`, `GRANT EXECUTE` a `authenticated`.

> ⚠️ **Cada columna nueva de `matriculas` necesita su `GRANT SELECT (columna) ON public.matriculas TO authenticated` explícito** en la misma migración que la crea. Sin él, nadie con sesión la podrá leer (ni Dirección). Tests: `src/test/rls/matriculas-motivo-baja-columna.rls.test.ts`.

## Idioma de la cuenta en los correos de Auth

Migración `20261010120000_feat_idioma_preferido_en_metadatos_auth`. Las plantillas de correo de Supabase Auth (`supabase/templates/invite.html` y `recovery.html`, y sus asuntos en `config.toml`) solo leen los metadatos del usuario (`.Data` = `auth.users.raw_user_meta_data`). La fuente de verdad del idioma es `public.usuarios.idioma_preferido`:

- Trigger **`usuarios_sincronizar_idioma_auth`** (`AFTER UPDATE OF idioma_preferido`, función `sincronizar_idioma_auth()` `SECURITY DEFINER`, sin `EXECUTE` para nadie): copia el idioma a `raw_user_meta_data.idioma_preferido` (merge, solo esa clave). Cubre el cambio por el propio usuario (`usuarios_self_update`) y el de la app.
- Al insertar no hace falta: `handle_new_user` crea `usuarios` desde los metadatos.
- La invitación pasa `idioma_preferido` en los metadatos (lo elige la Dirección; castellano por defecto). Al reinvitar una cuenta provisional GoTrue reenvía con los metadatos ANTIGUOS, así que `prepararIdiomaInvitacion` los actualiza antes de reenviar.
- Las plantillas usan `{{ $idioma := or .Data.idioma_preferido "es" }}`: sin idioma → castellano, y `eq` nunca compara contra nulo.
- Tests: `src/test/rls/correos-auth-idioma.rls.test.ts` (el trigger; las plantillas, contra el GoTrue real, solo en la BD local efímera, que tiene buzón de pruebas).

## Export art. 15 — `export_datos_sujeto`

Migración `20261014120000_feat_export_datos_sujeto`. El export (`/export/me` y `/export/[tipo]/[id]`) lee con la sesión de quien lo pide, y la RLS de muchas tablas no deja a la familia leer sus propios datos: `lista_espera`, `rollover_finaliza`, `invitaciones`, `export_log`, `olvido_solicitudes`, `metodo_pago_familia`, `becas`, `asignacion_concepto`, `parte_servicio_diario` y las cuatro `beca_comedor_*` son de Dirección; `consentimientos` solo los ve quien los dio; `preferencias_usuario`, `push_subscriptions` y `lectura_*` solo el propio usuario. El derecho de acceso no es «lo que tu sesión alcanza».

- **`export_datos_sujeto(p_sujeto_tipo text, p_sujeto_id uuid) → jsonb`** (`SECURITY DEFINER`, `STABLE`, `search_path = public`; `REVOKE` de `PUBLIC`/`anon`, `EXECUTE` a `authenticated`). Devuelve lo que el export añade sobre lo que ya lee por sesión. Solo lectura: no escribe ni toca `audit_log`.
- **Control de acceso** (en la función, no en la app):
  - `usuario`: el propio usuario, o el admin de un centro donde el usuario tiene un rol vivo (patrón de `consentimientos_admin_select`). El admin solo recibe las filas de **su** centro; lo del usuario sin centro (preferencias, dispositivos) sale entero.
  - `nino`: un tutor legal (`es_tutor_legal_de`, principal o secundario) o el admin del centro del niño. La profe, el autorizado, otra familia y el admin de otro centro reciben **42501**. Un niño inexistente también (`es_admin(NULL)` sería TRUE para cualquier admin).
- **Qué devuelve:** del niño, su prospecto entero de `lista_espera`, matrículas (sin `motivo_baja`; la familia solo `activa`/`baja`, como `get_recorrido_nino_familia`), consentimientos por sujeto (también el que dio el otro tutor, sin su IP ni su navegador), acuses del alta, cambios solicitados, «no continúa», citas, eventos y confirmaciones, recordatorios dirigidos a su familia, becas, conceptos asignados, sus líneas de recibo, parte de servicio y beca de comedor. Del usuario, su perfil en `familia_tutores` (solo su fila), sus mandatos (del IBAN solo `iban_ultimos4`), los cobros de su familia, el teléfono y el email de sus prospectos (`tutor_usuario_id`), las invitaciones a su email (sin `token`), sus exports y solicitudes de olvido, preferencias, dispositivos (sin `endpoint`, `p256dh` ni `auth`) y lecturas.
- **Fuera, decidido por el responsable:** `auth_attempts`, `audit_log` y el contenido de trabajo del personal (lo que creó o registró: sí su ficha, sus roles y sus mensajes).
- **`motivo_baja`** solo en el export de Dirección (`/export/[tipo]/[id]`), por `get_motivos_baja_matriculas`, que da 42501 a quien no es admin. `/export/me` no lo pide nunca.
- **En la app** (`recolectar.ts`): un 42501 de la función es una ausencia legítima (la profe que exporta a un niño de su aula recibe lo de antes y una nota); cualquier otro error rompe el export, que no puede salir incompleto sin decirlo. El DNI y el mandato firmado salen como enlace firmado. La ruta sigue sin leer datos con `service`.
- Tests: `src/test/rls/export-datos-sujeto.rls.test.ts` (control de acceso, los dos tutores reciben lo mismo, consentimiento por sujeto, telemetría para Dirección, alcance por centro, `motivo_baja`, IBAN) y `src/test/i18n/export-doc-keys.test.ts` (cada etiqueta del render, en es/en/va).

## Familia sin titular — `promover_a_titular`

Migración `20261015120000_fix_purga_rgpd_cierre`. La purga de un usuario da de baja su fila de `familia_tutores` y no asciende al otro tutor: lo decide la directora. Sin titular, el alta de un hermano no se puede cerrar (el paso «tutor 1» escribe el rol `titular`).

- **`promover_a_titular(p_familia_tutor_id uuid)`** (`SECURITY DEFINER`, `search_path = public`; `REVOKE` de `PUBLIC`/`anon`, `EXECUTE` a `authenticated`). Con la sesión de la directora, que queda como actor en `audit_log`. Solo el admin del centro de la familia (fila o centro inexistente: 42501); solo si la familia no tiene titular activo y la fila es un `segundo_tutor` activo (si no, 23514). Pasa la fila a `titular` y sus vínculos con los niños de la familia a `tutor_legal_principal` (mapeo único titular ⇔ principal).
- **El trigger `familia_tutores_proteger_usuario_id`** sigue congelando `usuario_id`, `familia_id` y `rol_familia` fuera de `service_role`, con una única excepción: `segundo_tutor → titular`, sin tocar lo demás, y solo con el marcador local `app.promover_titular` que pone esta función. Un UPDATE directo del rol, ni de la directora, pasa.
- En la app: botón «Pasar a titular» en la ficha de la familia, solo cuando no hay titular, sobre el segundo tutor (`promoverATitular`).

## Qué conserva la familia de cursos pasados

Decisión del responsable, 2026-10-15. **Lo del niño se conserva; lo del aula se queda atrás.** Mientras el niño siga en el centro, el acceso de la familia a lo **personal** del niño depende solo del vínculo vivo (`vinculos_familiares.deleted_at IS NULL`), sin límite de fecha. Lo que es **de aula** depende de la matrícula `activa` en esa aula, y se pierde al cambiar de aula o de curso.

| Se conserva (vínculo vivo, todos los cursos)                                         | Se queda atrás (exige matrícula `activa` en el aula)                           |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Agenda diaria de cualquier fecha y ausencias                                         | Anuncios de aula (`usuario_es_audiencia_anuncio_row`)                          |
| Informes de evolución publicados de todos los cursos                                 | Eventos de aula (`evento_aplica_a_nino`)                                       |
| Mensajes con la profe                                                                | Blog del aula anterior (`familia_ve_aula`), salvo las fotos donde sale su hijo |
| Recorrido (`get_recorrido_nino_familia`, solo tutor legal)                           | Autorizaciones de ámbito aula, también la salida (`es_tutor_en_aula`)          |
| Fotos pasadas donde sale etiquetado (`publicacion_etiqueta_hijo_de`)                 |                                                                                |
| Autorizaciones y firmas del niño; recibos de la familia (por `familia_tutores` vivo) |                                                                                |

Esa línea es la correcta: no es un hueco por cerrar. Cualquier cambio en la visibilidad de la familia tiene que respetarla.

**Con la baja, la familia pierde el acceso.** No es un fallo: la familia que se va no entra el curso siguiente.

- `archivar_nino` (por `baja_nino` o `cerrar_curso`) da de baja los vínculos del niño con `deleted_reason='baja_nino'`. Todo lo de la columna izquierda deja de verse, fotos etiquetadas incluidas. Si queda un hermano activo, la familia sigue entrando por él.
- Si no quedan niños activos, `revocar_acceso_familia` retira además el rol `tutor_legal` y el proxy le cierra `/family`.
- `desarchivar_nino` revive los vínculos y, con ellos, todo lo anterior. La purga RGPD no se revive.
- Qué hacer con las fotos de una familia que se va (borrarlas o entregarlas fuera de la app) lo decide la directora fuera de NIDO.

Esto corrige el «aunque cause baja» del histórico de fotos de ADR-0046, que dejó de ser cierto con `archivar_nino` (F-3-C, ADR-0051). Las dos ADR llevan una nota de 2026-10-15 que dice qué prevalece.
