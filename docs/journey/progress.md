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

---

## Fase 2.5 — Sistema de diseño visual

**Fecha:** 2026-05-14
**Estado:** En curso (Checkpoint B aprobado, pendiente Checkpoint C y PR final).

### Completado

- Spec `docs/specs/design-system.md` con paleta (primary/accent-warm/accent-yellow/success/coral/info/neutral), tipografía, radios, sombras y plan de pantalla por pantalla. Criterio explícito para `destructive` soft vs `destructive-strong`.
- Tokens NIDO en HSL en `src/app/globals.css`, mapeados a los semánticos de shadcn via `@theme inline`. `--primary` semántico = `primary-600` para WCAG AA en botones/links.
- Plus Jakarta Sans (400-800, `display: swap`) cargada via `next/font/google` reemplazando Geist.
- Logo procesado con `scripts/process-logos.mjs` (sharp, idempotente). Outputs commiteados: `nido-logo-full|wordmark|mark.png`, `icon-{192,512}.png`, `src/app/icon.png`, `src/app/apple-icon.png`. Favicon default eliminado.
- Componentes shadcn adaptados: Button (con `destructive-strong`), Card (rounded-2xl + shadow-md), Badge (variantes success/warning/info/warm), Dialog (rounded-2xl + shadow-xl), Tabs, Table (header `neutral-100`, hover `neutral-50`), Sonner.
- Componentes nuevos en `src/shared/components/`: `Logo`, `LogoWordmark`, `LogoMark`, `EmptyState`, `LoadingSkeleton`, `BrandedLoading`, `SidebarNav`, `AuthShell`, `LegalShell`.
- Layouts admin/teacher/family con sidebar fija (md+) + header sticky mobile, item activo con barra warm a la izquierda, footer con avatar + rol localizado.
- Pantallas rediseñadas:
  - Auth: login (Logo hero + gradiente diagonal + a11y contrast), forgot-password, reset-password, invitation/[token] (new + existing-account flows), invitation/expired (clock badge warm), forbidden (lock badge coral).
  - Legal: privacy, terms con LegalShell.
  - Admin dashboard: saludo con `nombre_completo` + 4 cards de stats con icon tile codificado por color.
  - Teacher dashboard: cards de aulas con cohortes en Badge warm + EmptyState para sin aulas.
  - Family dashboard: cards de niños con avatar primary + EmptyState para sin niños.
  - Admin listas (centro, cursos, aulas, ninos, audit): tablas envueltas en Card overflow-hidden, EmptyState con iconos por rol, variantes semánticas de Badge para curso estado y audit accion.
  - Wizard `/admin/ninos/nuevo`: barra de progreso de 3 segmentos en el CardHeader y back link.
  - Detalle `/admin/ninos/[id]`: header con avatar + nombre + Badge aula actual + Tabs (Datos / Médica / Vínculos / Matrículas) con icono Lucide en cada trigger; Row pattern unificado.
  - Teacher `/aula/[id]` y Family `/nino/[id]` con back link, header card y EmptyState para estados vacíos.
- i18n trilingüe (es/en/va) extendido con `teacher.nav`, `family.nav`, `admin.dashboard.greeting/subtitle`, `wizard.progress`, descripciones de empty states.

### Decisiones (ADRs)

- **ADR-0008-design-system**: sistema completo (paleta, tipografía, radios, sombras, componentes) aplicado a todas las pantallas existentes antes de seguir con features funcionales, para que Fase 3+ se construyan ya con la cara final. `destructive` en dos variantes (soft / strong). Logo procesado con sharp, idempotente, plan de sustitución por SVG vectorial cuando llegue.

### Pendiente

- Validaciones finales (typecheck + lint + tests Vitest + Playwright + build) y merge del PR.

### Para Fase 3

- Sin cambios respecto a lo planeado en Fase 2: tablas operativas (agendas_diarias, comidas, biberones, suenos, deposiciones), helper `dentro_de_ventana_edicion`, UI por aula. Ahora con el sistema de diseño ya aterrizado.

---

## Fase 2.6 — Datos pedagógicos del niño + logo del centro

**Fecha:** 2026-05-14
**Estado:** En curso (implementación cerrada, pendiente Checkpoint B y PR final).

### Completado

- Spec `docs/specs/pedagogical-data.md` con 5 ajustes pre-aprobación incorporados (permiso JSONB dedicado, BOOLEAN de hermanos con apunte en roadmap, idiomas ISO 639-1 length-2 con placeholder, carpeta `datos-pedagogicos/`, logo del centro tanto en sidebar desktop como en header mobile).
- `docs/roadmap.md` (nuevo) con notas vivas de items diferidos: tabla `hermanos_nino`, Storage upload de logo, UI de permisos por toggle, paso pedagógico en wizard, datos administrativos del tutor, flujo verificado-por-tutor.
- 2 logos de ANAIA commiteados en `public/brand/` (`anaia-logo-wordmark.png` 356×94 y `anaia-logo-full.png` 1024×1024).
- Migración `20260514142245_phase2_6_pedagogical_data.sql` aplicada al proyecto Supabase remoto. Contenido:
  - `centros.logo_url TEXT NULL` + seed para ANAIA.
  - Tabla `datos_pedagogicos_nino` (1:1 con `ninos`, ON DELETE RESTRICT). 3 ENUMs (`lactancia_estado`, `control_esfinteres`, `tipo_alimentacion`). CHECKs sobre `siesta_numero_diario`, `idiomas_casa` (via función IMMUTABLE `idiomas_iso_2letras` porque Postgres rechaza subqueries en CHECK) y la regla cruzada `otra ⇒ observaciones`.
  - 3 policies RLS reusando helpers existentes (`es_admin(centro_de_nino(nino_id))`, `es_profe_de_nino(nino_id)`, `tiene_permiso_sobre(nino_id, 'puede_ver_datos_pedagogicos')`).
  - `audit_trigger_function()` extendida con la nueva tabla; trigger AFTER aplicado.
  - Backfill JSONB: cada vínculo existente recibe `puede_ver_datos_pedagogicos` heredando el valor de `puede_ver_info_medica` para preservar visibilidades.
- Tipos TS regenerados con `npm run db:types`.
- Feature `src/features/datos-pedagogicos/` con: schema Zod (9 tests pasando), query `getDatosPedagogicos`, server action `upsertDatosPedagogicos` con patrón Result + revalidatePath, 3 componentes (Form RHF+Zod, Tab con EmptyState + CTA, ReadOnly server).
- Query `src/features/centros/queries/get-centro-logo.ts` cacheada con `React.cache()`.
- Componente `src/shared/components/brand/CentroLogo.tsx` + integración en `SidebarNav` (debajo del wordmark NIDO en desktop, al lado del LogoMark en mobile).
- Layouts admin/teacher/family pasan `centroLogo` al SidebarNav.
- Tab "Pedagógico" entre "Médica" y "Vínculos" en `/admin/ninos/[id]` con icono BookOpen.
- Sección read-only en `/family/nino/[id]` debajo de "Datos básicos", gated por `puede_ver_datos_pedagogicos`.
- i18n trilingüe (es/en/va) para todo el namespace `pedagogico` + `admin.ninos.tabs.pedagogico` + `family.nino.pedagogico`.
- Tests: 9 unit (schema Zod) + 5 RLS (admin cross-centro, profe aula vs profe otra aula, tutor con/sin permiso). Total acumulado de la suite: 60 tests.
- 1 spec Playwright E2E (`pedagogical-data.spec.ts`) que verifica asset del logo + protección de ruta detalle + ausencia de claves i18n sin resolver en los 3 idiomas.

### Decisiones (ADRs)

- **ADR-0009-datos-pedagogicos-tabla-separada**: tabla separada `datos_pedagogicos_nino` 1:1 con `ninos` (mismo patrón que `info_medica_emergencia`) + permiso JSONB dedicado `puede_ver_datos_pedagogicos` (no se reusa `puede_ver_info_medica`). Backfill preserva visibilidades existentes.
- **ADR-0010-logo-centro-url-relativa**: `centros.logo_url TEXT NULL` con URL relativa a `public/brand/...` hasta que Fase 10 configure Storage. Plan de migración a Storage documentado en el propio ADR.

### Pendiente

- Validaciones finales (`npm run typecheck && lint && test && test:e2e && build`) y merge del PR.
- Smoke en producción tras merge: logo de ANAIA visible en sidebar, tab "Pedagógico" presente en detalle de niño.

### Para Fase 3

- Sin cambios respecto a lo planeado: tablas operativas (`agendas_diarias`, `comidas`, `biberones`, `suenos`, `deposiciones`), helper `dentro_de_ventana_edicion`, UI por aula. Los datos pedagógicos ya cargados permiten a la agenda mostrar contexto (lactancia, dieta, idiomas) sin tener que preguntar a la familia.

---

## Fase 3 — Agenda diaria + bienestar

**Fecha:** 2026-05-15
**Estado:** En curso (implementación cerrada, pendiente Checkpoint C y PR final).

### Completado

- Spec `docs/specs/daily-agenda.md` con 3 ajustes pre-aprobación incorporados: nota explícita en ADR-0013 sobre derogación de la regla previa de ventana, flujo "Marcar como erróneo" (UPDATE con prefijo `[anulado] `) en lugar de DELETE, y aclaración de seguridad sobre el filtrado client-side de Realtime (cosmético — la seguridad la enforza RLS).
- Migración `20260515153711_phase3_daily_agenda.sql` aplicada al proyecto Supabase remoto:
  - 9 ENUMs nuevos (`estado_general_agenda`, `humor_agenda`, `momento_comida`, `cantidad_comida`, `tipo_biberon`, `calidad_sueno`, `tipo_deposicion`, `consistencia_deposicion`, `cantidad_deposicion`).
  - 5 tablas (`agendas_diarias` padre con UNIQUE(nino_id, fecha) y ON DELETE RESTRICT; `comidas`, `biberones`, `suenos`, `deposiciones` con ON DELETE CASCADE). CHECKs por campo (length ≤ 500, cantidad_ml ∈ [0,500], `hora_fin > hora_inicio`, `tipo='pipi' ⇒ consistencia IS NULL`).
  - Helper `public.dentro_de_ventana_edicion(fecha)` con `Europe/Madrid` hardcoded (ADR-0011).
  - Helpers de lookup `centro_de_agenda`, `nino_de_agenda`, `fecha_de_agenda` SECURITY DEFINER STABLE (patrón ADR-0007 para evitar recursión RLS).
  - 15 políticas RLS (SELECT/INSERT/UPDATE por tabla; DELETE bloqueado a todos por default DENY). INSERT/UPDATE exigen `dentro_de_ventana_edicion(fecha)`.
  - `audit_trigger_function()` extendida (CREATE OR REPLACE preserva ramas previas y añade `agendas_diarias` + 4 hijas).
  - `ALTER PUBLICATION supabase_realtime ADD TABLE` para las 5 tablas.
  - Backfill JSONB: `vinculos_familiares.permisos` recibe `puede_ver_agenda` con default `true` para tutor*legal*\*, `false` para autorizado. Idempotente.
- Tipos TS regenerados sin regresión.
- Feature `src/features/agenda-diaria/` completa:
  - 5 schemas Zod (cabecera + 4 eventos) con cross-field rules (`hora_fin > hora_inicio`, `consistencia` solo si caca) y `coerce.number()` en `cantidad_ml`. Helper `esAnulado()`.
  - 3 queries server-side (`get-agenda-del-dia`, `get-agendas-aula-del-dia` con counts y badges de alerta médica, `get-permiso-agenda` cacheada con React.cache).
  - 6 server actions (`upsert-agenda-cabecera` + `asegurarAgenda` helper interno; 4 upserts de evento; `marcar-evento-erroneo` con prefijo idempotente; `fetch-agenda-del-dia` wrapper para cargar lazy desde cliente).
  - Hook `useAgendaRealtime` que suscribe a las 5 tablas con `router.refresh()` + callback `onChange`; comentario explícito sobre que el filtrado client-side es cosmético.
  - Helpers de fecha `lib/fecha.ts` (`hoyMadrid`, `offsetDias`, `esHoy`, `formatearFechaHumano` con `Intl.DateTimeFormat` por locale).
  - UI profe (`/teacher/aula/[id]`) reescrita: server carga aula + resúmenes del día; cliente `AgendaAulaCliente` con DayPicker, lista de niños como tarjetas colapsables, panel expandible con 5 sub-secciones (General/Comidas/Biberones/Sueños/Deposiciones), Realtime + bump de refreshKey, día cerrado deshabilita inputs.
  - UI familia (`/family/nino/[id]`) con sección Agenda añadida después de pedagógico: `AgendaFamiliaView` (read-only, Realtime activo solo si fecha == hoy) o `AgendaFamiliaSinPermiso` empty state.
  - Componente compartido `BotonMarcarErroneo` con Dialog de confirmación; visual de evento anulado con `opacity-50` + `line-through` + badge "Anulado" (mismo render en profe y familia).
- i18n trilingüe completa (es/en/va) para namespace `agenda` (~80 claves por idioma) + `family.nino.tabs.agenda` + `family.nino.agenda.{sin_permiso,historico_vacio}`.
- Tests Vitest acumulados: ≈ 86 tests / 22 ficheros:
  - 13 nuevos antes del Checkpoint B (8 RLS agenda, 3 ventana helper, 2 audit agenda).
  - 13 schema tests Zod (5 schemas + helper esAnulado).
  - 60 previos (Fases 1, 2, 2.6, incluido audit_trigger_function regresión-verde).
- 1 spec Playwright `e2e/daily-agenda.spec.ts` con 5 smoke tests (rutas protegidas, i18n sin claves sin resolver en es/en/va) + 1 test condicional skip de Realtime con dos contextos en paralelo (profe + familia) activable con `E2E_REAL_SESSIONS=1` cuando haya credenciales E2E*PROFE*_ / E2E*TUTOR*_ / E2E_AULA_ID / E2E_NINO_ID.

### Decisiones (ADRs)

- **ADR-0011-ventana-edicion-timezone-madrid**: helper `dentro_de_ventana_edicion(fecha)` con `Europe/Madrid` hardcoded. NIDO arranca single-tenant en Valencia; cuando se incorpore un centro fuera de CET, añadir `centros.timezone TEXT NOT NULL DEFAULT 'Europe/Madrid'` y reescribir helper.
- **ADR-0012-agenda-cinco-tablas-vs-jsonb**: 5 tablas separadas (1 padre + 4 hijo) en lugar de JSONB en una sola tabla. Razones: ENUMs Postgres, audit log per-evento, Realtime granular, tipos TS ricos, queries analíticas Fase 9, concurrencia robusta. Coste: 9 ENUMs + 15 políticas RLS + 4 server actions + 4 secciones UI.
- **ADR-0013-ventana-edicion-mismo-dia**: ventana = mismo día calendario hora Madrid, sin excepciones desde UI ni para admin. **Deroga la regla previa** ("hasta 06:00 día siguiente, admin edita histórico") de `CLAUDE.md` y `docs/architecture/rls-policies.md`. Razones: simplificar modelo mental, una sola ventana, menos errores. Trade-off: profe que olvida algo a las 23:55 pierde la ventana. Correcciones de histórico solo vía SQL con `service_role` (queda en `audit_log`).

### Pendiente

- Validaciones finales (`npm run typecheck && lint && test && test:e2e && build`) y push de la branch como PR draft.
- Checkpoint C: verificación visual del Realtime en preview de Vercel con tutor de prueba creado manualmente (`jovimib+tutor@gmail.com`, vínculo `tutor_legal_principal` al niño "Test Prueba" en aula Farm little).
- Smoke en producción tras merge: agenda visible en `/teacher/aula/{id}` con Realtime; tab "Agenda" en `/family/nino/{id}` con gating.

### Para Fase 4

- Modelo de asistencia y ausencias (check-in entrada/salida, ausencias justificadas). El patrón de RLS, audit log y Realtime queda probado y reusable.
- Si Iker confirma que la decisión de "mismo día" funciona en el día a día, no hay revisión pendiente. Si la profe pide la ventana hasta 06:00 del día siguiente más adelante, se reabre con un nuevo ADR que supersedaría 0013.

---

## Fase 4 — Asistencia + ausencias

**Fecha:** 2026-05-15
**Estado:** Implementación cerrada, pendiente Checkpoint C y PR final.

### Completado

- Spec `docs/specs/attendance.md` aprobada con 3 ajustes pre-implementación: día cerrado documentado como regla transversal (ADR-0016), permiso `puede_reportar_ausencias` separado de `puede_ver_agenda` en JSONB (ADR-0006), profe puede UPDATE solo sobre ausencias propias y solo para cancelación.
- Migración `20260515203407_phase4_attendance.sql` aplicada al proyecto Supabase remoto:
  - 2 ENUMs (`estado_asistencia`, `motivo_ausencia`).
  - Tabla `asistencias` con UNIQUE(nino_id, fecha), ON DELETE RESTRICT, CHECKs (length observaciones ≤ 500, `hora_salida > hora_llegada` cuando ambas). Asistencia lazy (ADR-0015): nadie crea filas por adelantado.
  - Tabla `ausencias` con FK ON DELETE RESTRICT, CHECK `fecha_fin >= fecha_inicio`, CHECK length descripción ≤ 500. Cancelación con prefijo `[cancelada] ` (no DELETE).
  - Helper `public.hoy_madrid()` SECURITY DEFINER STABLE (gemelo de `dentro_de_ventana_edicion`) usado en RLS de ausencias para "solo futuras" en tutor.
  - 12 políticas RLS: `asistencias` (SELECT admin/profe; INSERT/UPDATE con `dentro_de_ventana_edicion`); `ausencias` (SELECT admin/profe/tutor con `puede_ver_agenda`; INSERT con `puede_reportar_ausencias` AND `fecha_inicio >= hoy_madrid()` para tutor; UPDATE admin sin restricción, tutor con permiso si fecha futura, profe solo si `reportada_por = auth.uid()`). DELETE bloqueado a todos.
  - `audit_trigger_function()` ampliada con ramas para `asistencias` y `ausencias` (derivan `centro_id` vía `centro_de_nino`).
  - `ALTER PUBLICATION supabase_realtime ADD TABLE` para `asistencias` y `ausencias`.
  - Backfill JSONB: `vinculos_familiares.permisos` recibe `puede_reportar_ausencias` con default `true` para tutor*legal*\*, `false` para autorizado. Idempotente.
- Tipos TS regenerados sin regresión.
- Componente compartido `src/shared/components/pase-de-lista/` (ADR-0014):
  - `types.ts` con `PaseDeListaColumn<TValue>`, `PaseDeListaQuickAction<TValue>`, `PaseDeListaItem<TItem, TValue>`, `PaseDeListaTableProps<TItem, TValue>`, `RowState<TValue>`, `RowStatus`.
  - `usePaseDeListaForm.ts` (hook interno): Map<rowId, RowState> con O(1) mutaciones; `setValue`, `applyQuickAction`, `validate` (solo filas dirty), `collectDirty`, `markStatus`, `setRowError`, `reset`.
  - `PaseDeListaTable.tsx`: grid CSS dinámico, 5 tipos de input (radio/time/text-short/select/enum-badges), badges de status, readOnly, submit batch.
  - 10 tests unitarios verdes.
- Feature `src/features/asistencia/`:
  - Schema Zod con cross-field validation (`requiere_hora_llegada`, `salida_anterior_llegada`); schema batch.
  - Server actions `upsertAsistencia` y `batchUpsertAsistencias` con patrón Result.
  - Queries `getPaseDeListaAula` (auto-link con ausencias activas) y `getResumenAsistenciaCentro` (counts por aula).
  - Cliente `PaseDeListaCliente` que monta `<PaseDeListaTable />` con auto-link visual: si hay ausencia activa, fila pre-marcada `estado='ausente'` + badge "Ausencia reportada por familia".
  - Hook `useAsistenciaRealtime` (suscripción a `asistencias` y `ausencias`, mismo patrón que F3).
- Feature `src/features/ausencias/`:
  - Schema con superRefine (fecha_fin >= fecha_inicio); helper `esCancelada` + constante `PREFIX_CANCELADA`.
  - Server actions `crearAusencia`, `actualizarAusencia`, `cancelarAusencia` (cancelación = UPDATE con prefijo).
  - Query `getAusenciasNino` (ordenadas por fecha_inicio desc).
  - Componente `AusenciasFamiliaSection` (Card + Dialog) con permission gating (`puede_reportar_ausencias` controla el botón Reportar y la acción Cancelar).
- UI:
  - Nueva ruta `/teacher/aula/[id]/asistencia` con DayPicker reusado de F3 y `<PaseDeListaTable />` en modo `readOnly` si día cerrado.
  - Link "Ver pase de lista" añadido en `/teacher/aula/[id]` debajo de la cabecera del aula.
  - Sección "Ausencias" añadida en `/family/nino/[id]` con auto-link de `puede_ver_agenda` (lectura) y `puede_reportar_ausencias` (escritura).
  - Card "Asistencia hoy" añadida al dashboard admin `/admin` con counts presentes/ausentes/total por aula.
- i18n trilingüe completa (es/en/va) para namespaces `asistencia.*` y `ausencia.*` (~60 claves por idioma).
- Tests Vitest acumulados: 129 tests / 26 ficheros (43 nuevos):
  - 10 unitarios del componente `<PaseDeListaTable />`.
  - 7 schema asistencia (cross-field) + 5 schema ausencia + 3 esCancelada.
  - 8 RLS asistencia + 8 RLS ausencia.
  - 2 audit asistencia.
- 1 spec Playwright `e2e/attendance.spec.ts`: 4 smoke (rutas protegidas, i18n sin claves sin resolver en es/en/va) + test diferencial condicional "auto-link familia → profe" (skip por defecto) + test día cerrado read-only (skip por defecto).

### Decisiones (ADRs)

- **ADR-0014-pase-de-lista-reutilizable**: componente genérico `<PaseDeListaTable />` para F4 (asistencia), F4.5 (menús) y F7 (confirmaciones de evento). Tipos paramétricos `TItem` / `TValue`, 5 tipos de input, validación Zod por columna, quick actions con `onlyClean`, submit batch. Trade-off: ~250 líneas de abstracción upfront a cambio de 1 implementación para 3 features previstas.
- **ADR-0015-asistencia-lazy**: las filas en `asistencias` nacen al primer upsert humano, no se pre-crean. ENUM cerrado y exhaustivo (4 valores reales), audit log limpio, ningún job nocturno. La query `getPaseDeListaAula` hace LEFT JOIN con matrículas + ausencias para componer el pase de lista. Auto-link familia→profe sintetizado en cliente desde la ausencia activa.
- **ADR-0016-dia-cerrado-transversal**: ADR-0013 (ventana de edición = mismo día Madrid) se promueve a regla transversal del producto. Aplica a `asistencias` con `dentro_de_ventana_edicion(fecha)`. Ausencias siguen regla análoga con `hoy_madrid()`: tutor solo reporta/edita ausencias futuras. Helpers gemelos coexisten con propósitos distintos.
- **ADR-0006 (actualizado)**: matriz de permisos JSONB ampliada con `puede_reportar_ausencias`. Distinción intencional entre lectura (`puede_ver_agenda`) y reporte (`puede_reportar_ausencias`) para custodias compartidas. Backfill en migración.

### Pendiente

- Validaciones finales (`npm run typecheck && lint && test && test:e2e && build`) y push de la branch como PR draft.
- Checkpoint C: verificación visual del auto-link en preview de Vercel (familia reporta ausencia → profe abre pase de lista → ve niño con badge y estado `ausente`).
- Smoke en producción tras merge: `/teacher/aula/{id}/asistencia` con DayPicker; sección "Ausencias" en `/family/nino/{id}`; card "Asistencia hoy" en `/admin`.

### Para Fase 4.5

- El patrón "pase de lista" queda listo para reusar con menús: items = niños matriculados, columnas = `cantidad` (radio enum), `observaciones` (text-short), quick action "Comieron todos bien". Sin nuevo componente, solo nuevas migraciones (`plantillas_menu`) y schemas.
