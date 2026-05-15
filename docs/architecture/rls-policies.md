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

## Cifrado de columnas sensibles

Las funciones `public.set_info_medica_emergencia_cifrada(...)` y `public.get_info_medica_emergencia(...)`:

- Son `SECURITY DEFINER` con `search_path = public, extensions` (pgcrypto vive en `extensions`).
- Leen la clave de Supabase Vault con `name='medical_encryption_key'` vía la función interna `public._get_medical_key()`.
- Incorporan autorización (admin del centro / profe del aula actual / tutor con `puede_ver_info_medica=true`) antes de descifrar.
- Contrato del setter: NULL = preservar campo (no sobrescribe con NULL). Ver ADR-0004.

## Audit log automático

`audit_trigger_function()` SECURITY DEFINER aplicada `AFTER INSERT OR UPDATE OR DELETE` en:

- `centros`, `ninos`, `info_medica_emergencia`, `vinculos_familiares`, `roles_usuario`, `matriculas`.

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

## Ventana de edición agenda diaria (Fase 3, ADR-0013)

> **Cambio respecto a doc previo:** la regla anterior ("hasta 06:00 del día siguiente, admin edita histórico") **queda derogada** por [ADR-0013](../decisions/ADR-0013-ventana-edicion-mismo-dia.md). La nueva regla, vigente desde Fase 3:

- Profe edita solo si `fecha = (now() AT TIME ZONE 'Europe/Madrid')::date` (helper `public.dentro_de_ventana_edicion(fecha)`, ver [ADR-0011](../decisions/ADR-0011-ventana-edicion-timezone-madrid.md)).
- A las 00:00 hora Madrid del día siguiente, **read-only para todos los roles** (incluido admin) por RLS.
- Correcciones de histórico solo vía SQL con `service_role` (queda en `audit_log` igualmente).
- `DELETE` bloqueado a todos por default DENY: eventos erróneos se marcan con `UPDATE observaciones = '[anulado] ' || COALESCE(observaciones, '')`.

Helper (vive en `public.*`, mismo patrón que el resto):

```sql
CREATE OR REPLACE FUNCTION public.dentro_de_ventana_edicion(p_fecha date)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p_fecha = (now() AT TIME ZONE 'Europe/Madrid')::date;
$$;
```

## Realtime y RLS

Las 5 tablas de la agenda (`agendas_diarias`, `comidas`, `biberones`, `suenos`, `deposiciones`) están publicadas en `supabase_realtime`. **Las políticas RLS de `SELECT` se aplican también a las notificaciones Realtime**: Supabase descarta los eventos sobre filas que el rol del cliente no podría leer vía `SELECT`. El filtrado client-side por `aula_id` (vista profe) o `nino_id` (vista familia) es **cosmético**, no de seguridad. Manipular ese filtro desde devtools no expone notificaciones de aulas/niños no autorizados.

## Tests RLS obligatorios

Por cada tabla nueva verificar que:

1. Un alumno de aula A no puede ver datos del aula B.
2. Un tutor solo ve datos de sus hijos.
3. Un autorizado no puede ver la agenda (solo recogida).
4. Audit log no es modificable por nadie (ni admin).

Tests Fases 1–3 en `src/test/rls/` (≈14 archivos, ≈49 tests):

- `usuarios.rls.test.ts`, `roles.rls.test.ts`, `invitaciones.rls.test.ts` (Fase 1).
- `centros.rls.test.ts`, `aulas.rls.test.ts`, `vinculos.rls.test.ts`, `info-medica.rls.test.ts`, `audit-log.rls.test.ts`, `cifrado.test.ts` (Fase 2).
- `datos-pedagogicos.rls.test.ts` (Fase 2.6).
- `agenda-diaria.rls.test.ts` + `dentro-de-ventana-edicion.test.ts` (Fase 3).
- `src/test/audit/audit.test.ts` + `agenda-audit.test.ts` verifican triggers (INSERT, UPDATE, soft delete, agenda).
