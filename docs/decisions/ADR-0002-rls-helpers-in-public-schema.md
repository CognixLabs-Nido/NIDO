# ADR-0002: Funciones helper de RLS en `public.*` en lugar de `auth.*`

## Estado

`accepted`

**Fecha:** 2026-05-13
**Autores:** Iker Milla, claude-code
**Fase del proyecto:** Fase 1 — Identidad y acceso

## Contexto

El plan inicial de NIDO (ver `CLAUDE.md` y `docs/architecture/rls-policies.md`) describía las funciones helper de RLS como pertenecientes al schema `auth` (`auth.es_admin()`, `auth.usuario_actual()`, etc.). Este es el patrón clásico que aparece en muchos tutoriales antiguos de Supabase.

Al aplicar la primera migración (`20260513114319_phase1_auth.sql`) contra el proyecto Supabase Cloud de NIDO (`ttroedkdgomfmohgojvg`), la operación `CREATE FUNCTION auth.usuario_actual(...)` falló con:

```
ERROR: permission denied for schema auth (SQLSTATE 42501)
```

Supabase Cloud (la versión managed, no la self-hosted) **no concede permiso al rol de migraciones para crear objetos dentro del schema `auth`**. Ese schema queda reservado para los managed services de Supabase (sesiones, usuarios, OAuth, MFA, etc.). El rol con el que se aplican las migraciones (`supabase_admin` vía `db push`) tiene grants suficientes para `public` y schemas custom, pero no para `auth`.

Hay que decidir dónde viven las funciones helper de RLS.

## Opciones consideradas

### Opción A: Helpers en `public.*`

Crear `public.usuario_actual()`, `public.es_admin(centro_id)`, etc. Llamar `auth.uid()` desde dentro (eso sí está permitido para todos los roles).

**Pros:**

- Funciona con Supabase Cloud sin cambios de plan ni gestión de superusuarios.
- Equivalente funcional al patrón `auth.*`: las políticas RLS llaman `public.es_admin()` y el resultado es idéntico.
- No hay riesgo de colisionar con futuras funciones que Supabase añada a `auth.*` en upgrades del servicio.
- Las helpers quedan documentadas en el dump de schema y son visibles por los devs.

**Contras:**

- Pequeña inconsistencia con tutoriales y referencias antiguas que asumen helpers en `auth.*`.
- Convención propia del proyecto: hay que recordar que están en `public` (mitigado con doc).

### Opción B: Pedir a Supabase support que conceda permisos sobre `auth`

Abrir ticket pidiendo `GRANT CREATE ON SCHEMA auth TO supabase_admin`.

**Pros:**

- Permite seguir la convención `auth.*` por defecto.

**Contras:**

- Supabase no acepta esta solicitud para Cloud — el schema `auth` es intencionalmente intocable para que upgrades del servicio no rompan migraciones del usuario.
- Aunque se concediera, las funciones podrían sobrescribirse en futuras versiones de Supabase Auth.
- Bloquea el desarrollo durante días por una decisión de plataforma.
- No es replicable: en local con `supabase start` sí se podría, pero en Cloud no.

### Opción C: Pasar a Supabase self-hosted

**Pros:**

- Control total del schema `auth`.

**Contras:**

- Mucho más esfuerzo operativo (backups, escalado, OS patches).
- Resta tiempo de Fase 1 a una infraestructura que ya estaba decidida.
- Inconsistente con el plan: la fase de fundaciones eligió Cloud por ser gratis y suficiente.

## Decisión

**Se elige la Opción A:** funciones helper de RLS en `public.*`.

Concretamente, esta fase crea `public.usuario_actual()` y `public.es_admin(p_centro_id uuid DEFAULT NULL)`. Las políticas RLS las invocan con ese qualifier (`USING (public.es_admin(centro_id))`). Las próximas fases mantendrán esta convención para las helpers que vayan apareciendo (`public.es_profe_de_aula`, `public.es_tutor_de`, etc.).

La función `auth.uid()` —que es la base sobre la que se construyen estas helpers— **sí** se sigue usando desde dentro, porque es una función read-only que Supabase expone públicamente.

## Consecuencias

### Positivas

- La migración se aplica sin fricción contra Supabase Cloud.
- El modelo de seguridad es idéntico al previsto: una RLS policy `USING (public.es_admin(centro_id))` se evalúa exactamente igual que `auth.es_admin(centro_id)`.
- No hay dependencia de comportamientos managed que puedan cambiar.

### Negativas

- Inconsistencia menor con tutoriales antiguos de Supabase. Mitigada con esta ADR, con la actualización de `docs/architecture/rls-policies.md` y `CLAUDE.md`, y con comentarios en la propia migración.
- Cualquier dev nuevo verá una helper `public.es_admin` que no parece pertenecer al dominio público: queda documentado que viven ahí por restricción de plataforma.

### Neutras

- Se actualizan los documentos de arquitectura para reflejar el qualifier real (`public.*`).

## Plan de implementación

- [x] Mover las helpers de `auth.*` a `public.*` en `supabase/migrations/20260513114319_phase1_auth.sql`.
- [x] Actualizar las políticas RLS de la misma migración para llamar `public.es_admin(...)`.
- [ ] Actualizar `docs/architecture/rls-policies.md` para usar el qualifier real `public.*`.
- [ ] Actualizar `CLAUDE.md` para reflejar que las helpers están en `public.*`.
- [ ] Cuando aparezcan nuevas helpers (`public.es_profe_de_aula`, etc.) en Fase 2, mantener el mismo schema.

## Verificación

- La migración aplica correctamente con `npx supabase db push` contra el proyecto Cloud.
- El test RLS `src/test/rls/usuarios.rls.test.ts` pasa, lo que confirma que las políticas que llaman a `public.es_admin` operan como se espera.

## Notas

Esta es una decisión _forzada por la plataforma_, no una preferencia. Si en algún momento Supabase Cloud abriera permisos sobre `auth.*`, no hay razón para mover las helpers — funcionan igual y mover crea churn sin beneficio.

## Referencias

- `supabase/migrations/20260513114319_phase1_auth.sql`
- `docs/specs/auth.md`
- ADR-0001-auth-by-invitation-only
