# Políticas RLS — NIDO

## Principios

- **Default DENY ALL** en todas las tablas.
- Service role bypass para Edge Functions (nunca expuesto al cliente).
- Funciones helper `SECURITY DEFINER` para evitar recursión.

## Funciones helper

> **Nota:** viven en `public.*`, no `auth.*`. Supabase Cloud no permite crear funciones en el schema `auth`. Decisión documentada en [ADR-0002](../decisions/ADR-0002-rls-helpers-in-public-schema.md).

```sql
public.usuario_actual()                            → uuid    -- Fase 1
public.es_admin(p_centro_id uuid DEFAULT NULL)     → boolean -- Fase 1
public.es_profe_de_aula(aula_id uuid)              → boolean -- Fase 2
public.es_tutor_de(nino_id uuid)                   → boolean -- Fase 2
public.tiene_permiso_sobre(nino_id uuid, permiso text) → boolean -- Fase 2
public.pertenece_a_centro(centro_id uuid)          → boolean -- Fase 2
```

## Roles

| Rol           | Descripción                 |
| ------------- | --------------------------- |
| `admin`       | Acceso total al centro      |
| `profe`       | Sus aulas asignadas         |
| `tutor_legal` | Sus hijos y sus datos       |
| `autorizado`  | Solo recogida (sin agenda)  |
| `service`     | Edge Functions (bypass RLS) |

## Ventana de edición agenda diaria

- Profe edita hasta las 06:00 del día siguiente.
- Días anteriores: read-only para profe, editable para admin con audit log forzado.

## Tests RLS obligatorios

Por cada tabla nueva verificar que:

1. Un alumno de aula A no puede ver datos del aula B.
2. Un tutor solo ve datos de sus hijos.
3. Un autorizado no puede ver la agenda (solo recogida).
4. Audit log no es modificable por nadie (ni admin).
