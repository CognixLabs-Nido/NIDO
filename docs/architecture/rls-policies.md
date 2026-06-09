# Políticas RLS — NIDO

## Principios

- **Default DENY ALL** en todas las tablas.
- Service role bypass para Edge Functions (nunca expuesto al cliente).
- Funciones helper `SECURITY DEFINER` con `STABLE` y `search_path` explícito.
- **Antipatrón prohibido**: subqueries inline `(SELECT col FROM otra_tabla WHERE ...)` dentro de `USING (...)` — causa recursión RLS (SQLSTATE 42P17). Ver [ADR-0007](../decisions/ADR-0007-rls-policy-recursion-avoidance.md).

## Funciones helper

> **Nota:** viven en `public.*`, no `auth.*`. Supabase Cloud no permite crear funciones en el schema `auth`. Decisión documentada en [ADR-0002](../decisions/ADR-0002-rls-helpers-in-public-schema.md).

```sql
-- Fase 1
public.usuario_actual()                                  → uuid
public.es_admin(p_centro_id uuid DEFAULT NULL)           → boolean

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

Deriva `centro_id` con un IF/ELSIF por tabla. RLS en `audit_log`:

- SELECT solo para admin del centro del registro.
- INSERT solo desde la función trigger (SECURITY DEFINER bypassa).
- UPDATE/DELETE bloqueados a TODOS los roles (append-only estricto).

## Roles

| Rol           | Descripción                                                        |
| ------------- | ------------------------------------------------------------------ |
| `admin`       | Acceso total al centro                                             |
| `profe`       | Sus aulas asignadas (via `profes_aulas` activos)                   |
| `tutor_legal` | Sus hijos vía `vinculos_familiares`, con permisos JSONB granulares |
| `autorizado`  | Como tutor_legal pero con permisos por defecto a `false`           |
| `service`     | Edge Functions (bypass RLS)                                        |

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
- **Índice único parcial** `idx_conv_admin_familia_unique (admin_id, tutor_id) WHERE tipo='admin_familia'` — un solo hilo por par (no por niño).
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
- **Service role bypass en el motor de envío**: `enviarPushANotificarUsuarios` lee suscripciones cross-user vía `createServiceClient()`. La auth del autor ya se verificó en la server action que lo invoca; el helper solo computa destinatarios y envía. Esto es coherente con el resto del proyecto: service role nunca se expone al cliente y se usa solo en helpers server-side claramente etiquetados.

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
- **Badge (RPC `contar_recordatorios_pendientes()`)** — `SECURITY DEFINER STABLE`, usa `auth.uid()`. Cuenta pendientes donde el usuario es **destinatario directo** (no mera visibilidad RLS): `personal`/`profe_individual` self; `profes_centro` `es_profe_en_centro`; `familia_individual`/`familias_aula`/`familias_centro` con `creado_por <> auth.uid()` + el helper de pertenencia. Resuelve el caso admin (ve todo del centro pero no es destinatario de lo que crea).
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

- **Badge (RPC `contar_invitaciones_pendientes()`, AG-14)**: `SECURITY DEFINER STABLE`, usa `auth.uid()`. Cuenta `cita_invitados` `pendiente` del usuario JOIN `citas` `programada` y **aún no comenzada** (`(fecha + hora_inicio) AT TIME ZONE 'Europe/Madrid' > now()`), con `organizador_id <> auth.uid()` (el organizador no cuenta sus citas). Bypassa RLS pero solo cuenta filas del propio usuario → sin fuga (igual que la RPC de F6-C). **Sin push ni Realtime**. Test gateado: dos usuarios → cada uno su recuento; el organizador no cuenta las suyas; al aceptar deja de contar.

- **Gotcha MVCC**: `usuario_es_audiencia_cita_row` es row-aware (recibe `centro_id`/`organizador_id` por parámetro) y su lookup interno consulta `cita_invitados` (otra tabla). Igual `cita_invitados`, cuyo helper lee `citas`. Tests `.insert().select()` en ambas tablas como bloqueo de regresión.

## Autorizaciones y firma digital (Fase 8)

3 tablas — `autorizaciones`, `firmas_autorizacion`, `administraciones_medicacion` — y 5 ENUMs. Ver [ADR-0041](../decisions/ADR-0041-modelo-autorizaciones-firma-digital.md) y spec de arranque `docs/specs/autorizaciones-firma.md`. **Documentos legales: las 3 tablas SÍ se auditan** (a diferencia de los RSVP de F7b, que son registro administrativo). Sin Realtime.

> ⚖️ **Aviso legal**: F8 implementa un **mecanismo técnico auditable** (firma electrónica simple), **NO** certifica validez jurídica. Las afirmaciones de validez van marcadas ⚖️ y requieren abogado (eIDAS/LOPDGDD/normativa educativa). Ver ADR-0041 §legal.

### Helpers nuevos (`STABLE SECURITY DEFINER SET search_path = public`, GRANT `authenticated`)

- `centro_de_evento(p_evento_id)` → uuid; `es_profe_de_evento(p_evento_id)` → boolean (profe del aula del evento de ámbito `aula`).
- **`usuario_es_audiencia_autorizacion_row(p_centro_id, p_tipo, p_es_plantilla, p_ambito, p_evento_id, p_nino_id, p_aula_id)`** → boolean. **Row-aware** (recibe los campos por parámetro, **NO re-lee `autorizaciones`** → evita el gotcha MVCC en `INSERT…RETURNING`). admin ⇒ TRUE; plantilla del catálogo ⇒ `pertenece_a_centro`; `salida` ⇒ audiencia del evento; ámbito `nino` ⇒ `es_profe_de_nino OR es_tutor_de`; ámbito `aula` ⇒ `es_profe_de_aula OR es_tutor_en_aula`; ámbito `centro` ⇒ `pertenece_a_centro`; legacy (nino_id seteado) ⇒ `es_profe_de_nino OR es_tutor_de`. (Sustituye a la versión de 5 args de F8-0.)
- `autorizacion_aplica_a_nino(p_autorizacion_id, p_nino_id)` → boolean. Lee `autorizaciones` (tabla distinta de la que se inserta —`firmas`—, sin MVCC): plantilla ⇒ FALSE; `salida` ⇒ `evento_aplica_a_nino`; ámbito `aula` ⇒ matrícula activa; ámbito `centro` ⇒ niño del centro; resto ⇒ `nino_id = p_nino_id`.
- `autorizacion_firmable(p_autorizacion_id)` → boolean: `es_plantilla=false AND estado='publicada' AND texto_definitivo AND` dentro de vigencia (`hoy_madrid()`). Enforza el guard de texto PENDIENTE (no se firma un borrador).
- `autorizacion_plantilla_valida(p_plantilla_id, p_centro_id, p_tipo)` → boolean: existe plantilla `es_plantilla=true`, mismo centro+tipo, `publicada` + `texto_definitivo`. Gate del INSERT del tutor (B2).
- `medicacion_administrable_hoy(p_autorizacion_id)` → boolean (F8-3b): espejo SQL de `estado-firma.ts`. Calcula la política efectiva (`ninos.requiere_ambos_firmantes` ⇒ `todos_los_principales`), exige que la **última** decisión (`DISTINCT ON (firmante_id) … ORDER BY firmado_at DESC`) de los tutores principales sea `firmado`, y que `hoy_madrid()` esté dentro de la vigencia del tratamiento (que viaja en `firmas.datos.medicacion.fecha_inicio/fecha_fin`).
- **`archivar_autorizacion(p_autorizacion_id)`** → boolean — **RPC** `SECURITY DEFINER`, GRANT `authenticated`. Solo `tipo='medicacion'` no-plantilla; autoriza **`es_admin OR es_profe_de_nino`** (la familia NO); **idempotente**; setea `archivada_at=now()`, `archivada_por=auth.uid()`. Se hace por RPC **deliberadamente** para no ampliar la policy `autorizaciones_update` (autor|admin) a la profe (eso le abriría publicar/anular/editar el texto); el RPC toca solo las columnas de archivado.

### RLS `autorizaciones`

- **SELECT** `autorizaciones_select`: `usuario_es_audiencia_autorizacion_row(centro_id, tipo, es_plantilla, ambito, evento_id, nino_id, aula_id)` (row-aware).
- **INSERT** `autorizaciones_insert`: `creado_por = auth.uid()` AND ( `es_admin(centro_id)` | profe de salida `tipo='salida' AND es_profe_de_evento(evento_id) AND centro_de_evento(evento_id)=centro_id` | **tutor B2**: `es_plantilla=false AND tipo ∈ {recogida,medicacion} AND ambito='nino' AND nino_id NOT NULL AND plantilla_id NOT NULL AND es_tutor_de(nino_id) AND autorizacion_plantilla_valida(plantilla_id, centro_id, tipo)` ).
- **UPDATE** `autorizaciones_update`: `USING + WITH CHECK` simétricos `creado_por = auth.uid() OR es_admin(centro_id)`. El server action acota columnas; el trigger `bloquea_texto_tras_firma` congela el alcance consentido una vez hay firmas. Archivar medicación NO pasa por aquí (RPC `SECURITY DEFINER`).
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
