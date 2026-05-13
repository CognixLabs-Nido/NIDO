# Diario de progreso — NIDO

## Fase 0 — Fundaciones

**Fecha:** 2026-05-12 → 2026-05-13
**Estado:** ✅ Cerrada (merge en main, deploy verde en Vercel).

### Completado

- Next.js 16 + TypeScript strict + Tailwind 4
- Supabase Cloud (proyecto `ttroedkdgomfmohgojvg`) + clientes browser/SSR
- next-intl trilingüe (es/en/va) con routing `[locale]`
- shadcn/ui base instalado
- Husky + lint-staged + commitlint + Prettier + ESLint
- Vitest + Playwright
- Vercel Analytics; CI workflows (ci-pr, ci-main); README; docs base

### Decisiones

- Sentry descartado por no tener plan gratuito suficiente — error tracking en Fase 11 (highlight.io o GlitchTip).
- Next.js 16 (no 15): `create-next-app` instaló 16.2.6. Cambio de nombre `middleware.ts` → `proxy.ts` y `typedRoutes` deshabilitado por fricción innecesaria.

---

## Fase 1 — Identidad y acceso

**Fecha:** 2026-05-13
**Estado:** ✅ Cerrada (PR #1 mergeado, deploy verde en Vercel).

### Completado

- Spec completa en `docs/specs/auth.md` (status: draft, con los 3 ajustes del review: doble confirmación email existente, separación cookie de rol activo vs RLS, pantalla expired uniforme).
- Migración `20260513114319_phase1_auth.sql` aplicada al proyecto Supabase remoto.
- 4 tablas creadas: `usuarios`, `roles_usuario`, `invitaciones`, `auth_attempts`.
- Helpers RLS `public.usuario_actual()` y `public.es_admin()` (en `public` por restricción de Supabase Cloud — ADR-0002).
- Trigger `handle_new_user` en `auth.users`.
- Políticas RLS (default DENY ALL) para las 4 tablas con tests RLS pasando.
- Server Actions: `sign-in`, `sign-out`, `request-password-reset`, `reset-password`, `send-invitation`, `accept-invitation`, `acceptPendingInvitation`, `rejectPendingInvitation`, `notifyExistingAccountInvitation`. Todas con patrón Result.
- Schemas Zod compartidos cliente/servidor (password, sign-in, invitation, reset-password).
- Logger compartido en `src/shared/lib/logger.ts`.
- Middleware `src/proxy.ts` reescrito: i18n + protección por rol.
- 14 páginas auth: login, forgot-password, reset-password, invitation/[token], invitation/expired, select-role, profile, profile/invitations, admin, teacher, family, forbidden, privacy, terms.
- i18n trilingüe completo (es/en/va) con namespace `auth.*` y `legal.*`.
- 19 tests Vitest (unit + RLS) — 6 ficheros, 100 % verde.
- 7 tests Playwright (login, invitation, forbidden) — 100 % verde.

### Decisiones (ADRs)

- **ADR-0001-auth-by-invitation-only**: registro solo por invitación, email + password, sin OAuth ni magic link. Requisitos de contraseña 12 chars + complejidad. Supabase Auth built-in (migración a Resend en Ola 2).
- **ADR-0002-rls-helpers-in-public-schema**: helpers RLS en `public.*` y no `auth.*` porque Supabase Cloud no permite crear funciones en `auth`. Decisión forzada por plataforma.

### Pendiente

- Verificación final (typecheck + lint + tests + build) antes del push y PR.
- Crear el primer admin manualmente en Supabase Dashboard tras merge — documentar el procedimiento en `docs/dev-setup.md` cuando llegue el momento.

### Para Fase 2

- Crear tablas `centros`, `cursos_academicos`, `aulas`, `ninos`, `info_medica_emergencia`, `matriculas`, `vinculos_familiares`, `profes_aulas`.
- Añadir FK constraints diferidas en `invitaciones.nino_id`, `invitaciones.aula_id`, `invitaciones.centro_id`, `roles_usuario.centro_id` cuando existan esas tablas.
- Helpers RLS adicionales: `public.es_profe_de_aula`, `public.es_tutor_de`, `public.tiene_permiso_sobre`, `public.pertenece_a_centro`.
- Tabla `audit_log` con triggers en tablas auditadas (incluyendo retroactivamente las de Fase 1).

---

## Fase 2 — Entidades core + RLS + audit log

**Fecha:** 2026-05-13 → 2026-05-14
**Estado:** En curso, pendiente de PR final.

### Completado

- Spec completa en `docs/specs/core-entities.md` con 2 ajustes pre-aprobación (info_medica_emergencia.nino_id ON DELETE RESTRICT en lugar de CASCADE; `centros` añadida a tablas auditadas).
- 3 migraciones aplicadas al proyecto Supabase remoto:
  - `20260513202012_phase2_core_entities.sql` — 10 tablas nuevas (centros, cursos_academicos, aulas, ninos, info_medica_emergencia, matriculas, vinculos_familiares, profes_aulas, audit_log, consentimientos), 6 ENUMs, 4 helpers RLS nuevos, 22 policies, audit_trigger_function + 6 triggers, funciones de cifrado, seed ANAIA + curso 2026-27 + 5 aulas. Bloque DO al final verifica `medical_encryption_key` en Supabase Vault y aborta si no existe.
  - `20260513213550_phase2_fix_rls_recursion.sql` — correctivo: añade helpers `centro_de_nino`, `centro_de_aula`, `es_profe_de_nino` para evitar recursión RLS detectada en políticas con subqueries inline (SQLSTATE 42P17).
  - `20260513214411_phase2_fix_pgcrypto_search_path.sql` — correctivo: amplía `search_path` de las funciones de cifrado para incluir el schema `extensions` donde Supabase instala pgcrypto.
- FKs diferidos de Fase 1 conectados: `roles_usuario.centro_id` → `centros.id`, `invitaciones.{centro,nino,aula}_id`.
- Cifrado pgcrypto a nivel columna en `info_medica_emergencia.alergias_graves` y `notas_emergencia`. Clave en Supabase Vault (`name=medical_encryption_key`). Setter respeta contrato "NULL = preservar campo".
- 7 features con schemas Zod + server actions + queries: centros, cursos, aulas, ninos, matriculas, vinculos, profes-aulas. Todas con patrón Result y logger compartido.
- UI funcional admin: dashboard con counts, /centro (editar), /cursos (lista + crear + activar), /aulas (lista + crear con multi-select cohortes), /ninos (lista + wizard 3 pasos + detalle con tabs), /audit (lista paginada con badges). Layout admin con nav + gating por rol.
- UI mínima teacher (dashboard + aula detalle filtrada por RLS) y family (dashboard + ficha del niño con info médica gated por permiso `puede_ver_info_medica`).
- i18n trilingüe (es/en/va) para los namespaces `admin.*`, `teacher.*`, `family.*`, `centro.*`, `curso.*`, `aula.*`, `nino.*`, `matricula.*`, `vinculo.*`, `profeAula.*`, `medico.*`.
- shadcn components añadidos: `table`, `dialog`, `tabs`, `badge`.
- 36 tests Vitest (RLS aislamiento + audit log append-only + cifrado roundtrip + NULL preserva + tests de Fase 1 actualizados para FK a centros) — 100% verde contra el remoto.
- 40 tests Playwright (smoke tests de las rutas nuevas + i18n check + invitation + login + forbidden) — 100% verde.
- Documentación: `docs/dev-setup.md` (nuevo) con patrones obligatorios de migraciones; `docs/decisions/ADR-0003` a `ADR-0007`.

### Decisiones (ADRs)

- **ADR-0003-aulas-cohortes-nacimiento**: aulas con `cohorte_anos_nacimiento int[]` en lugar de rango de edad. Encaja con la realidad de ANAIA y permite transiciones limpias de curso a curso.
- **ADR-0004-cifrado-datos-medicos-pgcrypto**: cifrado pgp_sym_encrypt en `alergias_graves` y `notas_emergencia`, con clave en Supabase Vault. Incluye plan de rotación.
- **ADR-0005-matriculas-historicas**: tabla histórica con índice parcial único (`nino_id, curso_academico_id WHERE fecha_baja IS NULL`) en lugar de FK directa. Permite cambios de aula auditables y reportes pedagógicos.
- **ADR-0006-permisos-granulares-vinculos**: permisos JSONB con keys fijas y defaults por tipo de vínculo desde Ola 1. UI completa de toggles queda para Ola 2, pero la estructura RLS ya filtra correctamente.
- **ADR-0007-rls-policy-recursion-avoidance**: las políticas RLS con subqueries inline cruzadas causan recursión infinita (SQLSTATE 42P17). Patrón obligatorio: encapsular lookups en helpers SECURITY DEFINER (`centro_de_nino`, `es_profe_de_nino`).

### Pendiente

- Verificación final (typecheck + lint + tests + build) antes del push y PR.
- Crear primeros profe/tutor mediante invitación desde `/admin/ninos/[id]` (cuando se mergee).

### Para Fase 3

- Tablas operativas: `agendas_diarias`, `comidas`, `biberones`, `suenos`, `deposiciones` con audit log automático.
- Ventana de edición agenda diaria: profe edita hasta 06:00 del día siguiente; admin con audit log forzado para excepciones.
- Helper RLS `public.dentro_de_ventana_edicion(fecha date)`.
- UI por aula con vista por niño + form rápido de check-in / check-out / comidas / siesta.
