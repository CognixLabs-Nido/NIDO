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

**Fecha inicio:** 2026-05-13
**Estado:** En curso, pendiente de PR final.

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
