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

- `centros`, `ninos`, `info_medica_emergencia`, `vinculos_familiares`, `roles_usuario`, `matriculas`, `datos_pedagogicos_nino`, `agendas_diarias`, `comidas`, `biberones`, `suenos`, `deposiciones`, `asistencias`, `ausencias`, `dias_centro`, `plantillas_menu_mensual`, `menu_dia`.

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

- **Sin ventana de edición**: a diferencia de F3/F4/F4.5b, mensajería es continua. Un mensaje enviado ayer sigue siendo anulable hoy. La inmutabilidad se da por el flag `erroneo` + prefijo, no por barrera temporal.
