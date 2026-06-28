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

---

## Fase 4.5 — Cambio de planes y revert (PR #12 cerrado, PR #13 mergeado)

**Fecha:** 2026-05-16
**Estado:** ✅ Cerrada (PR #12 descartado sin merge; PR #13 — chore de revert — mergeado a main).

### Resumen

El modelo inicial de F4.5 (plantilla semanal recurrente para menús) se descartó al chocar con la realidad operativa (festivos locales, vacaciones escolares, escuela de verano de pago aparte). PR #12 se cerró sin mergear tras Checkpoint B. La migración `20260516000000_phase4_5_menus.sql` ya había sido aplicada al remoto durante Checkpoint B, dejando drift entre local y remoto. PR #13 limpió el drift (DROP idempotente de las 2 tablas + 3 helpers + 2 ENUMs, restauración de `audit_trigger_function` al estado post-F4, DELETE del registro huérfano en `schema_migrations`). Tras el merge: BD limpia, 138 tests verdes, deploy verde.

### Para reemplazar

F4.5a + F4.5b (rediseño): calendario laboral del centro primero, luego menú mensual + pase de lista comida sobre el calendario.

---

## Fase 4.5a — Calendario laboral del centro

**Fecha:** 2026-05-16
**Estado:** 🚧 En curso (PR draft pendiente de Checkpoint C y merge).

### Completado

- Migración `20260516125631_phase4_5a_school_calendar.sql` aplicada al remoto:
  - 1 ENUM nuevo: `tipo_dia_centro` (7 valores: `lectivo`, `festivo`, `vacaciones`, `escuela_verano`, `escuela_navidad`, `jornada_reducida`, `cerrado`).
  - 1 tabla nueva: `dias_centro` (override por fecha, UNIQUE `(centro_id, fecha)`).
  - 2 helpers SQL: `tipo_de_dia(centro, fecha)` (override-gana-default, fallback ISODOW lun-vie=lectivo, sáb-dom=cerrado), `centro_abierto(centro, fecha)` (boolean conveniencia).
  - RLS por tabla: SELECT a todos los miembros del centro vía `pertenece_a_centro`; INSERT/UPDATE/**DELETE** a admin del centro. **DELETE permitido como excepción al patrón habitual** (ADR-0019).
  - `audit_trigger_function()` ampliada con rama nueva para `dias_centro`.
- Componente compartido `<CalendarioMensual />` agnóstico de dominio en `src/shared/components/calendario/`:
  - Grid 7×6 (42 celdas siempre), navegación ← →, ARIA grid + columnheader + gridcell, `aria-current="date"` en hoy.
  - Click simple → `onClickDia(fecha)`. Shift+click → `onSeleccionRango(desde, hasta)`.
  - Navegación con flechas mueve `diaActivo`, salta de mes en bordes.
  - `rangoSeleccionado` prop opcional para feedback visual de la selección antes de confirmar el tipo.
  - No conoce `dias_centro` — F7 (eventos) lo reusará tal cual.
- Feature `src/features/calendario-centro/`:
  - Server actions `upsertDiaCentro`, `aplicarTipoARango` (span máx 366 días), `eliminarDiaCentro`.
  - Queries `getCalendarioMes(centroId, año, mes)` (overrides del mes con holgura para overflow del grid), `getProximosDiasCerrados(centroId, 30, 5)` (widget, solo festivos/vacaciones/cerrado, horizonte 30 días).
  - Helpers TS `tipoDefaultDeFecha`, `tipoResuelto`, `tipoAbreElCentro` (cliente calcula sin round-trips).
  - Schemas Zod con cross-field rules (rango invertido, span máximo).
- UI:
  - `/admin/calendario` con `CalendarioCentroEditor`: dialog de día (select tipo + textarea + guardar/eliminar/cancelar) y dialog de rango (resumen "Vas a marcar N días como Tipo" + select + textarea + aplicar).
  - `/teacher/calendario` y `/family/calendario` con `CalendarioCentroReadOnly` (navegación entre meses, sin handlers).
  - `<LeyendaTiposDia />` visible siempre debajo del calendario en las 3 rutas (NO un tooltip oculto — accesibilidad).
  - `<ProximosDiasCerradosWidget />` montado en `/family` y `/teacher` con empty state amable.
  - Sidebars admin/teacher/family ganan item "Calendario".
- i18n trilingüe es/en/va (~30 claves por idioma): `calendario.*` + entradas `nav.calendario` por rol.
- Tests Vitest: 175 totales — 37 nuevos: 11 unit `<CalendarioMensual />`, 6 unit helpers TS, 9 unit schemas Zod, 6 RLS `dias_centro`, 4 functions SQL `tipo_de_dia`/`centro_abierto`, 1 audit (DELETE preserva `valores_antes`).
- Playwright `e2e/school-calendar.spec.ts`: 6 smoke (3 rutas protegidas + 3 i18n sin claves sin resolver) + 2 diferenciales condicionales (skip por defecto): admin marca festivo, admin aplica rango.

### Decisiones (ADRs)

- **ADR-0019-calendario-laboral-default-excepciones**: modelo "default + excepciones" (≤80 filas/año/centro vs 365). Helper SQL resuelve override-gana-default. **DELETE permitido en `dias_centro` como excepción documentada** al patrón habitual del proyecto — la ausencia de fila tiene significado (vuelta al default), no procede "anular con prefijo". Trazabilidad preservada vía audit trigger. **Sin ventana de edición**: admin edita cualquier fecha pasada/presente/futura. Festivos manuales (importación automática queda para Ola 2).

### Pendiente

- Validaciones finales Checkpoint C (`npm run typecheck && lint && test && test:e2e && build`) y push como PR draft.
- Smoke en preview Vercel: editar un día, aplicar un rango, ver leyenda visible en las 3 rutas, widget de próximos cerrados.

### Para Fase 4.5b

- `tipo_de_dia(centro, fecha)` y `centro_abierto(centro, fecha)` están listos para que el módulo de menús sepa qué días tienen menú.
- `<CalendarioMensual />` reusable para vistas mensuales de menú o de eventos (F7).

---

## Fase 4.5b — Menús mensuales + pase de lista comida por platos

**Fecha:** 2026-05-16
**Estado:** 🚧 En curso (PR draft pendiente de Checkpoint C y merge).

### Completado

- Migración `20260516183353_phase4_5b_menus.sql` aplicada al remoto:
  - 2 ENUMs nuevos: `estado_plantilla_menu` (borrador/publicada/archivada), `tipo_plato_comida` (primer_plato/segundo_plato/postre/unico).
  - 2 tablas nuevas: `plantillas_menu_mensual` (índice único parcial que garantiza una sola publicada por (centro, mes, anio)) y `menu_dia` (UNIQUE plantilla+fecha).
  - **Trigger BEFORE INSERT/UPDATE** en `menu_dia` que valida fecha dentro del mes/año de la plantilla padre (red de seguridad a nivel BD; el server action también valida con Zod para UX).
  - Extensión de `comidas` (F3): 2 columnas nuevas (`tipo_plato`, `menu_dia_id`) + índice único parcial `WHERE tipo_plato IS NOT NULL` para UPSERT atómico del batch sin chocar con filas legacy F3.
  - 3 helpers SQL: `nino_toma_comida_solida` (excluye lactancia materna/biberon, incluye mixta), `centro_de_plantilla` (auxiliar RLS), `menu_del_dia` (solo plantilla publicada).
  - `audit_trigger_function()` ampliada con 2 ramas; cero regresión en audit de fases anteriores (176/176 tests verdes tras el CREATE OR REPLACE).
- Feature `src/features/menus/`:
  - Types + schemas Zod (12 tests verdes incluyendo cross-field).
  - Server actions: `crearPlantillaMensual` (idempotente con borradores), `guardarMenuMes` (batch UPSERT validando fecha en mes), `publicarPlantilla` (archiva la previa automáticamente), `archivarPlantilla`, `batchRegistrarComidasPlatos` (patrón lookup+split por el predicado `WHERE tipo_plato IS NOT NULL` del índice parcial).
  - Queries: `getPlantillasCentro`, `getPlantillaMes`, `getMenuDelDia`, `getPaseDeListaComida` (discriminated union con 4 estados — centro cerrado / sin plantilla / día sin menú / listo).
  - Helpers TS: `escala 1-5 ↔ enum` con tests; `agruparComidasPorMomento` (7 tests cubriendo legacy puro, nuevo puro, mezcla, vacío, orden, tipo `unico`).
- UI:
  - `/admin/menus` listado de plantillas con badges de estado y `<NuevaPlantillaDialog />` (selector mes+año).
  - `/admin/menus/[id]` editor con `<CalendarioMensual />`: días cerrados atenuados con tooltip "Centro cerrado este día", días abiertos clickables. Panel modal con 6 campos por día. **Estado dirty** marcado visualmente con `ring-warning-400` por celda y contador "N días con cambios sin guardar". Botón "Guardar mes" único con batch atómico. Botón "Publicar" con confirmación que muestra cuántos días tienen menú definido.
  - `/teacher/aula/[id]/comida` con `<PaseDeListaTable />` (reusado, sin tocar API) y selector momento (4 chips). Escala visible 1-5 mapeada al enum `cantidad_comida`. Quick actions "Aplicar X a todos · {columna}" por plato. Empty states discriminados (centro cerrado / sin plantilla / día sin menú / sin niños con sólidos).
  - Widget **"Menú del día"** en `/family/nino/[id]` sección Agenda (server component): pinta menú estándar del centro con 4 secciones (desayuno, media mañana, comida con 3 sub-líneas, merienda) o empty amable si no hay plantilla publicada.
  - **Actualización vista F3 comidas (B57)**: `AgendaFamiliaView` y `SeccionComidas` ahora agrupan por momento y desglosan por `tipo_plato` cuando hay platos. **Compatibilidad total con filas legacy F3 (tipo_plato=NULL): se renderizan como antes** vía el helper `agruparComidasPorMomento`.
  - Link "Pase de lista comida" añadido en `/teacher/aula/[id]` junto al de asistencia.
  - Sidebar admin gana item "Menús".
- **Cambio i18n crítico**: `agenda.cantidad_comida_opciones.mayoria` cambia de "Mayoría"/"Most"/"Majoria" → **"Casi todo"/"Almost all"/"Quasi tot"** (es/en/va). La BD sigue siendo el enum `mayoria`; solo cambia la etiqueta visible. Verificación: no hay strings hardcoded.
- i18n trilingüe completa (es/en/va) namespace `menus.*` (~70 claves por idioma) + `admin.nav.menus`.
- Tests Vitest: 195 totales (+19 nuevos respecto a F4.5a — 12 RLS+functions+audit ya verdes desde Checkpoint B; +22 unit nuevos en este paso 4: 3 escala, 7 agrupar-comidas, 12 schemas).
- Playwright `e2e/menus.spec.ts`: 6 smoke (3 rutas protegidas + 3 i18n sin claves sin resolver) + 2 diferenciales condicionales (admin crea+publica menú; profe pasa lista comida).

### Decisiones (ADRs)

- **ADR-0020 — Plantilla de menú mensual**: descartado el modelo semanal recurrente. Una `plantillas_menu_mensual` por (centro, mes, anio, estado) + N `menu_dia` (1 por día abierto). Una sola publicada garantizada por índice único parcial.
- **ADR-0021 — Extensión de `comidas` con `tipo_plato`**: alternativa rechazada era tabla `comida_platos` 1:N. Decisión: extender `comidas` con `tipo_plato NULL` + índice único parcial. Razones: F3 sigue funcionando sin cambios, agenda muestra todo lo que comió el niño en un solo lugar, audit log unificado. Patrón lookup+split en server action por el predicate del índice parcial (PostgREST no lo expone en `onConflict`).
- **ADR-0022 — Escala 1-5 → enum `cantidad_comida` existente**: no se crea enum nuevo. UI muestra 1-5 (rápido), BD guarda el enum. Cambio asociado: etiqueta `mayoria` → "Casi todo" en es/en/va (afecta a F3 sin romper nada — verificado).

### Pendiente

- Validaciones finales Checkpoint C (`npm run typecheck && lint && test && test:e2e && build`) y push como PR draft.
- Smoke en preview Vercel: admin crea plantilla, rellena 3 días, publica; profe abre pase de lista, marca 5 a todos, guarda; familia ve el widget "Menú del día" en la ficha del niño.

### Para Fase 5 (mensajería)

- F4.5b cierra el módulo de menús de Ola 1. Fase 5 (mensajería profe↔familia) puede arrancar.

---

## Fase 5 — Mensajería profe ↔ familia + anuncios

**Fecha:** 2026-05-25
**Estado:** ✅ Cerrada (pendiente merge a `main` y deploy verde en Vercel).

### Completado

- **Migración inicial** `20260525154228_phase5_messaging.sql` (523 líneas): 5 tablas (`conversaciones`, `mensajes`, `lectura_conversacion`, `anuncios`, `lectura_anuncio`), ENUM `ambito_anuncio`, 4 helpers SECURITY DEFINER, 2 triggers funcionales (centro_id auto, last_message_at), RLS por tabla con default DENY, `audit_trigger_function()` ampliada con 3 ramas, Realtime publication sobre `mensajes` y `anuncios`.
- **Migración correctiva** `20260525201151_phase5_fix_audience_returning.sql`: nuevo helper row-aware `usuario_es_audiencia_anuncio_row(centro_id, autor_id, ambito, aula_id)` y reescritura de `anuncios_select`. Necesario para que `INSERT…RETURNING` sobre `anuncios` no fuera rechazado por la regla MVCC de Postgres (helper STABLE no ve la fila recién insertada de la misma sentencia). Documentado como gotcha transversal en `rls-policies.md`.
- **Server actions**: `enviar-mensaje` (con auto-creación lazy de conversación), `marcar-mensaje-erroneo`, `marcar-conversacion-leida`, `publicar-anuncio`, `marcar-anuncio-erroneo`, `marcar-anuncio-leido`, `get-unread-counts` (wrapper para Client Components).
- **Queries server-side**: `getConversacionesDelUsuario` (con preview + count no leídos), `getAnunciosDelUsuario`, `getConversacionDetalle`, `getAnuncioDetalle` (incluye lectores teóricos si soy autor), `countNoLeidos`, `getAulasParaAnuncio`, `getConversacionByNino`.
- **5 rutas** bajo `/messages` (transversal a roles): `page` (lista con tabs), `conversacion/[id]`, `anuncios/[id]`, `nuevo-anuncio`, `nino/[ninoId]` (entrada lazy desde ficha del niño).
- **MessagingBadge global**: visible en sidebar de TODAS las pantallas logueadas. Suscripción Realtime sobre `mensajes` y `anuncios` durante toda la sesión. RLS de SELECT filtra notificaciones → `puede_recibir_mensajes=false` ⇒ badge siempre 0.
- **Refactor de sidebar**: helper compartido `buildSidebarItems(rol, locale, badge)` consumido por los 4 layouts (admin/teacher/family/messages). `SidebarItem` ahora soporta `trailing?: ReactNode` para el slot del badge.
- **Botón "Escribir a la familia/profe"** en `/admin/ninos/[id]` y `/family/nino/[id]` (este último gated por `permisos.puede_recibir_mensajes`).
- **i18n trilingüe** namespace `messages.*` (~70 claves por idioma) + 3 nuevas claves `*.nav.mensajeria`. JSON validados es/en/va.
- **Patrón "marcar como erróneo"** unificado: componente `<MarcarErroneoButton target="mensaje" | "anuncio">` reutilizable, flag `erroneo boolean` + prefijo `[anulado] ` (10 chars), tachado visual con badge "Anulado".
- **Tests**: 271 totales (+54 sobre baseline 217 — 27 schemas Zod + 20 RLS + 4 helpers + 3 audit). Sin regresión en F2-F4.5b.
- **Playwright** `e2e/messaging.spec.ts`: 8 smoke (5 rutas protegidas + 3 i18n) + 3 E2E reales en `test.skip` (mensaje-realtime, anuncio-aula, leer-baja-badge). Mismo patrón que F3/F4.

### Decisiones (ADRs)

- **ADR-0023 — Modelo de mensajería con 5 tablas separadas**: rechazada la tabla única discriminada. Razón: RLS y Realtime con disjunciones por tipo aumentan superficie de bugs y entregan eventos cruzados. Las dos formas (chat bidireccional vs broadcast) tienen políticas, índices y UI claramente distintas.
- **ADR-0024 — Participantes y audiencia calculados dinámicamente**: rechazadas las tablas de membresía sincronizadas por triggers. La membresía es "estado actual" y cualquier persistencia crea vector de inconsistencia. Cálculo en runtime vía helpers SECURITY DEFINER es coherente y siempre correcto.
- **ADR-0025 — Push notifications fuera de F5 (F5.5 transversal)**: push es transversal a F6+. F5.5 lo construye una vez para todos. F5 cierra con badge in-app vivo vía Realtime.

### Aprendizaje transversal

- **Gotcha MVCC en helpers de policies SELECT con `INSERT…RETURNING`**: descubierto al testear t12/t13 (admin INSERT anuncio). El INSERT pasaba WITH CHECK pero el `RETURNING` lo rechazaba. Causa: helper STABLE invocado en USING de SELECT hacía lookup interno a la tabla; por MVCC, no veía la fila recién insertada de la misma sentencia. Fix: helper row-aware que recibe los campos por parámetro sin lookup. Documentado en `docs/architecture/rls-policies.md` para evitar el mismo bug en F8, F10, etc.

### Pendiente

- Validaciones finales Checkpoint C (`npm run typecheck && lint && test && test:e2e && build`).
- Push branch como PR draft y smoke manual en preview Vercel:
  1. Profe envía mensaje desde ficha admin del niño → tutor lo ve en `/messages` sin recargar; badge sube.
  2. Admin publica anuncio centro → todos los tutores con permiso lo ven aparecer.
  3. Tutor abre conversación con badge=1 → badge baja a 0 sin recargar.
  4. Tutor con `puede_recibir_mensajes=false` ve `/messages` vacío en ambos tabs y badge siempre a 0.

### Para Fase 5.5 (push notifications)

- Tabla `push_subscriptions` + `notificaciones_push`, edge function `notify-on-event` con payload normalizado, registro Service Worker en cliente, UI opt-in con consentimiento. Triggers en `mensajes` y `anuncios` invocan la edge function sin tocar la lógica F5.

---

## Hotfix post-Fase 5 — UI mensajería + permisos admin

**Fecha:** 2026-05-26
**Estado:** ✅ Cerrado (branch `fix/phase-5-ui-and-admin-perms`).
**Hotfix previo:** `fix/messaging-badge-realtime-order` (#17 — orden Realtime `.on()` antes de `.subscribe()`).

### Bugs reportados en producción tras merge de #16

| #   | Bug                                                                                         | Severidad |
| --- | ------------------------------------------------------------------------------------------- | --------- |
| 1   | Tutor escribe mensaje → "Enviar" no dispara petición (Console/Network vacíos).              | Crítico   |
| 2   | Vista profe sin botón "Escribir a la familia" en la ficha del niño (lista del aula).        | Crítico   |
| 3   | `/messages` para profe muestra solo "Nuevo anuncio"; sin UI para iniciar conversación.      | Crítico   |
| 4   | Dropdown de aula en form de anuncio muestra UUID al cerrarse (regresión Select.Root items). | Regresión |
| 5   | Admin selecciona aula → "No tienes acceso" pese a ser admin del centro.                     | Funcional |

### Decisiones de diseño (ADR-0026)

- **`/messages` rediseñado WhatsApp-style por rol:**
  - Admin: solo tab Anuncios (decisión F5 mantenida).
  - Profe / Tutor: tabs Conversaciones (split-view: lista de niños izquierda + panel derecho) + Anuncios.
  - Deep-link via `?nino=<id>` con SSR del detalle.
  - Mobile: una vista a la vez con botón "← volver".
- **Conversación on-demand:** el composer del panel derecho crea la conversación al enviar el primer mensaje (mismo patrón lazy ya en BD).
- **Composer obligatorio en `<form onSubmit>` + `type="submit"`:** regla nueva en `docs/dev-setup.md` para prevenir submit silencioso.
- **`Select.Root` con `items` se eleva a regla NO negociable:** tercera regresión del mismo patrón en tres fases distintas.
- **`getRolEnCentro` prioriza admin > profe > tutor_legal > autorizado:** el `limit(1)` anterior daba resultados arbitrarios para usuarios con doble rol y explica la falsa señal del Bug 5.

### Completado

- `MensajeComposer.tsx` reescrito con `<form onSubmit>` + botón `type="submit"` + manejo robusto de error i18n (fallback a `envio_fallo` si la key específica no existe).
- Nueva query `getNinosMensajeriaParaUsuario(centroId, rol)` con resolución por rol (profe: niños de sus aulas activas; tutor: vínculos con `puede_recibir_mensajes=true`; admin: todos los del centro). Incluye preview del último mensaje, badge de no leídos y conversación on-demand.
- 2 componentes cliente nuevos: `MessagesView` (orquesta tabs por rol) y `ConversacionesSplitView` (sidebar + panel + Realtime + auto-marca-leído).
- `/messages/page.tsx` reescrita: SSR del niño seleccionado, redirect a `/forbidden` si rol inválido.
- `/messages/nino/[ninoId]` se simplifica a redirect → `/messages?nino=<id>`.
- `MessagesListView.tsx` eliminado (reemplazado por la pareja `MessagesView` + `ConversacionesSplitView`).
- `AnuncioComposer.tsx`: prop `items` añadida a los 2 selects (ámbito y aula).
- `NinoAgendaCard.tsx` (vista profe): botón "Escribir a la familia" por fila con icono `MessageCircleIcon`. El `<button>` de toggle ya no envuelve toda la fila para evitar `<button>` anidado.
- `getRolEnCentro()` con priorización por rol más alto cuando hay varios activos.
- i18n: nuevas claves `messages.subtitle_admin`, `messages.split.*` y `messages.ficha_nino.empezar_conversacion` en `es`/`en`/`va`.
- Tests RLS añadidos en `messaging.rls.test.ts`: t21 (admin sin asignación), t22 (admin cross-centro), t23 (admin con doble rol), t24 (tutor sin permiso).
- Test unitario `MensajeComposer.test.tsx` (5 tests) de regresión Bug 1.
- `docs/dev-setup.md`: bloque "Componentes cliente con formularios" + refuerzo `Select.Root regla no negociable`.
- ADR-0026 documenta el modelo de UI definitivo.

### Verificación

- `npm run typecheck` ✓
- `npm run lint` ✓ (0 errores; 2 warnings preexistentes de React Compiler con RHF `form.watch()`).
- `npm test` (155 tests unit) ✓ incluyendo los 5 nuevos del composer.
- Smoke manual pendiente en preview Vercel (Checkpoint A + B).

### Aprendizaje transversal

- **Botón sin `type="button"` dentro de un form ancestro = submit silencioso.** Composers SIEMPRE en `<form>` con `type="submit"` explícito y test unitario por composer.
- **`Select.Root` items para entidades UUID:** mismo patrón regresado en F2, F2.6 y F5. La regla pasa de "documentada" a "checkbox de PR review".
- **`getRolEnCentro` priorizando admin** evita falsos positivos en futuras features que conmuten UI por rol (informes F9, autorizaciones F8, etc.).

---

## Fase 5.5 — Push notifications (transversal)

**Fecha:** 2026-05-27
**Estado:** ✅ Cerrada (PR draft, pendiente review y merge).

### Completado

- **Migración** `20260527090605_phase5_5_push_subscriptions.sql`: tabla `push_subscriptions(id, usuario_id, endpoint, p256dh, auth, user_agent, created_at, updated_at, last_active_at)` con UNIQUE `(usuario_id, endpoint)`, índice `(usuario_id)`, trigger `set_updated_at`, ON DELETE CASCADE desde `usuarios` y 4 políticas RLS de aislamiento (`usuario_id = auth.uid()`).
- **Schema Zod** `schemas/push.ts`: `suscribirPushInputSchema`, `desuscribirPushInputSchema` con claves de error en namespace `push.errors.*`.
- **Server actions**: `suscribir-a-push` (UPSERT idempotente por `(usuario_id, endpoint)`), `desuscribir-push` (DELETE idempotente con count). Errores tipados según `docs/architecture/error-handling.md`.
- **Helper server-side** `enviarPushANotificarUsuarios(usuarioIds, payload)` en `lib/enviar-push.ts`: carga suscripciones cross-user con service role, paraleliza envíos con `Promise.allSettled`, limpia automáticamente las suscripciones que devuelven `410 Gone` o `404 Not Found`. Configuración VAPID lazy con early return + `console.error` si faltan keys (no rompe al caller).
- **Helpers de audiencia** en `lib/audiencia.ts`:
  - `destinatariosDeConversacion(convId, excluyendoUserId)` — profes activos del aula del niño + tutores con `puede_recibir_mensajes`.
  - `destinatariosPushDeAnuncio(anuncio, excluyendoUserId)` — solo tutores con flag (ámbito aula o centro). Profes y admin no reciben push de anuncios (sí los ven in-app).
  - `getAutorPushInfo(userId)` — `nombre_completo` + `idioma_preferido` para construir el payload.
- **Service Worker** `public/sw.js`: handlers `push` (parsea payload JSON y llama `showNotification`) y `notificationclick` (focus + navigate o openWindow). Sin lógica de caching offline — pertenece a F11 (ADR-0028).
- **Manifest mínimo** `public/manifest.json` + meta tags iOS en `src/app/[locale]/layout.tsx` (`apple-touch-icon`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-title`) + 2 iconos PNG (192/512 con `purpose: 'any maskable'`).
- **Hooks de mensajería**: `enviar-mensaje.ts` y `publicar-anuncio.ts` invocan al helper tras INSERT exitoso. Try/catch silencioso con `console.error` — un fallo de push no rompe el mensaje persistido.
- **UI cliente**:
  - `PushSettings.tsx` en `/profile` con 5 estados (`granted`, `denied`, `default`, `unsupported`, `ios_sin_pwa`). Banner explícito para iOS Safari sin PWA-install.
  - `PushBanner.tsx` contextual en `/messages` para tutor y profe (admin no): visible solo en `default`, dismiss con `sessionStorage` vía `useSyncExternalStore` (sin flicker de hidratación). Reaparece al cerrar y reabrir el navegador.
- **i18n trilingüe** namespace `push.*` en `messages/{es,en,va}.json`.
- **Tests** (+31 sobre baseline F5):
  - `push.schema.test.ts` (13 tests) — Zod input validation.
  - `enviar-push.test.ts` (9 tests) — mocks de `web-push` y service client; cobertura de `410/404 → DELETE`, `500 → log sin DELETE`, audiencia vacía, VAPID ausente, mezcla de estados.
  - `push.rls.test.ts` (9 tests) — aislamiento SELECT/INSERT/UPDATE/DELETE entre usuarios, UNIQUE constraint, CASCADE on delete usuario.
- **Documentación**:
  - Spec `/docs/specs/push-notifications.md` cubriendo B35-B40 (activación, recepción mensaje, recepción anuncio, click, desactivación, limpieza expiradas) + casos edge.
  - `docs/operations/vapid-rotation.md` con procedimiento paso a paso.
  - `scripts/test-push.mjs` para smoke local del helper.
- **Workflow nuevo**: smoke directo en producción tras merge (vs. local con `npm run dev`). Tests automatizados como red de seguridad principal.

### Decisiones (ADRs)

- **ADR-0027 — Push notifications con server actions + `web-push`**: rechazada Edge Function de Supabase, SaaS (OneSignal) y diferir a Ola 2. Elegido `web-push` directo desde server actions porque mantiene el plano arquitectónico actual, sin coste recurrente, con privacidad-by-default (suscripciones nunca salen de nuestra infra). El refactor a cola se hará si las audiencias crecen (>1000 destinatarios) — esa parte queda aislada en el helper.
- **ADR-0028 — Manifest mínimo F5.5 vs PWA completa F11**: manifest minimalista para desbloquear iOS PWA-install (requisito Apple para push) sin absorber el scope de F11. El SW de F5.5 solo expone `push` + `notificationclick`; F11 añadirá caching offline + estrategias por ruta + lighthouse PWA 90+. Versionado del SW al llegar F11 incluido como TODO de verificación.

### Aprendizaje transversal

- **`useSyncExternalStore` para state derivado de `sessionStorage`**: evita el lint `react-hooks/set-state-in-effect` (cascading renders) y elimina el flicker de hidratación. El patrón `subscribeFn + getSnapshot + getServerSnapshot` con un `Set<callback>` in-tab cubre el caso "el `storage` event no se emite en la misma pestaña".
- **Service role en helpers server-side claramente etiquetados**: el motor de push lee suscripciones cross-user; la auth del autor ya quedó verificada por la server action que lo invoca. Patrón replicable para F6+ cuando haya lookups que crucen la RLS por flujo legítimo.
- **Catch-all silencioso para efectos best-effort**: el push se `await`ea (la lambda no termina antes) pero los errores quedan en `console.error`. El usuario del action no se entera. Documentado como patrón general para hooks transversales post-INSERT (recordatorios F6 lo aplicará igual).

### Pendiente

- Smoke completo en producción tras merge (responsable):
  1. Profe envía mensaje → tutor con push activado recibe notificación nativa del SO.
  2. Admin publica anuncio centro → todos los tutores con flag reciben push.
  3. Click en notificación abre la URL correcta (`/{idioma}/messages?nino=<id>` o `/.../messages/anuncios/<id>`).
  4. iOS Safari sin PWA → modal explícito; tras "Añadir a pantalla de inicio" + abrir desde icono → push funciona.

---

## Fase 5.6 — Mensajería admin↔familia + ventana anulación 5 min + scroll WhatsApp

**Fecha:** 2026-05-28
**Estado:** ✅ Cerrada (PR draft pendiente de review y merge por el responsable).

Estructurada en sub-bloques A/B/C con checkpoints internos (A → B → C1 → C1.5 → C2 → C3 → C3.5 → C4 → C5).

### F5.6-A — Conversación admin ↔ familia

- **Migración** `20260528100000_phase5_6_admin_family_messaging.sql` (BEGIN/COMMIT, aplicada al remoto vía SQL Editor por el bug `SIGILL` del CLI en este Chromebook):
  - ENUM `tipo_conversacion` (`profe_familia` | `admin_familia`).
  - Columnas en `conversaciones`: `admin_id`, `tutor_id`, `tipo_conversacion`, `expires_at`. `nino_id` pasa a NULLABLE.
  - CHECK estructural `conversaciones_tipo_coherencia` por tipo.
  - Índice único parcial `idx_conv_admin_familia_unique (admin_id, tutor_id) WHERE tipo='admin_familia'`.
  - Helpers SQL: `es_tutor_en_centro`, `conversacion_activa`. Extensión de `puede_participar_conversacion`.
  - Policies reescritas: `conversaciones_select`, `conversaciones_insert`, nueva `conversaciones_update_admin_familia`. `mensajes_insert` extendida con `conversacion_activa`.
  - Trigger `mensajes_reset_admin_familia_timer_trg` AFTER INSERT, `SECURITY DEFINER`: cualquier INSERT en `mensajes` cuyo hilo sea `admin_familia` renueva `expires_at = now() + 3 days`. Atómico con la inserción (ver ADR-0030).

- **Server action** `abrirConversacionAdminFamilia(tutorId)` con su `*Core(supabase, userId, tutorId)` testeable. SELECT-then-INSERT-or-UPDATE con captura `23505` para race de doble-click (el índice parcial impide usar `.upsert()` de supabase-js). Errores tipados: `solo_admin`, `tutor_no_pertenece_centro`, `apertura_fallo`, `no_autorizado`.

- **Schemas/actions extendidos** con discriminador `kind`:
  - `mensajeInputSchema` Zod-union: rama `profe_familia` (kind opcional+default — preserva regresión bit-a-bit de `MensajeComposer.test.tsx` F5) y rama `admin_familia` (kind requerido + `conversacion_id`).
  - `enviarMensaje(input)` dispatcha al sub-flow; la rama `admin_familia` pre-chequea `expires_at` y mapea `42501` a `conversacion_caducada`.

- **UI nueva**: queries `get-admin-familia-detalle.ts` y `get-admin-familia-list.ts`; componentes `ConversacionAdminFamiliaView`, `AdminFamiliaListItem`, `AdminFamiliaSection`, `AbrirConversacionDireccionButton` (en `/admin/ninos/[id]` Vínculos), `ReabrirConversacionButton`. `MensajeComposer` con discriminated-union props. `MessagesView` da al admin 2 tabs (Anuncios + Dirección); al tutor una sección "Dirección" encima del split-view, oculta si 0 hilos. Router `/messages/conversacion/[id]` dispatcha por `tipo_conversacion`.

- **i18n**: `messages.badge.direccion` + `messages.admin_familia.*` (9 claves: tab, sección, lista vacía, reabrir/reabriendo, indicadores activo/cerrada, composer cerrado).

### F5.6-B — Marcar erróneo con ventana de 5 minutos

- **Migración** `20260528200000_phase5_6b_ventana_anulacion.sql` (BEGIN/COMMIT, aplicada por el responsable): DROP+CREATE de `mensajes_update_autor` y `anuncios_update_autor` con `created_at > now() - interval '5 minutes'` en `USING` y `WITH CHECK`.

- **Server actions** `marcarMensajeErroneo` y `marcarAnuncioErroneo` refactorizadas con `*Core(supabase, userId, id)` testeable. Pre-chequeo de edad. `.update().select('id').maybeSingle()` y mapeo de `data === null` a `ventana_anulacion_expirada` para el caso "USING falso → 0 filas, sin error" (hallazgo en ADR-0030). Defensa en profundidad: 42501 también mapeado.

- **UI**: `MarcarErroneoButton` con prop `createdAt` obligatoria, snapshot `Date.now()` con lazy initializer (React 19 `react-hooks/purity`), early-return `null` si fuera de ventana. 4 puntos de montaje (`ConversacionView`, `ConversacionesSplitView`, `AnuncioView` ya existentes; `ConversacionAdminFamiliaView` nuevo). i18n `messages.errors.ventana_anulacion_expirada` trilingüe.

### F5.6-C — Scroll tipo WhatsApp

- **Hook compartido** `useScrollAlFondo(mensajesLength)` → `{ containerRef, mostrarBotonIrAlFondo, irAlFondo }`. Reglas:
  1. Scroll inicial al fondo al montar (instantáneo).
  2. Auto-scroll al recibir mensajes nuevos SOLO si el usuario estaba a `<100px` del fondo. El ref `estabaCercaDelFondoRef` se actualiza por el handler de `scroll`; un mensaje entrante NO perturba la lectura de histórico.
  3. `mostrarBotonIrAlFondo` se sincroniza con el handler de scroll.
  4. `irAlFondo` usa `scrollTo({ behavior: 'smooth' })` — la suavidad es solo del click explícito; el auto-scroll del punto 2 es instantáneo.

- **Componente** `IrAlFondoButton` (circular `absolute right-4 bottom-4`, icono chevron, `aria-label` i18n).

- **Refactor layout** en las 3 vistas: wrapper a `flex h-[calc(100dvh-3rem)] flex-col`, `<ol>` envuelto en `<div ref={containerRef} className="relative flex-1 overflow-y-auto">`, header/composer como flex shrink-0 (sin `sticky`). Funcional intacto.

- **i18n**: `messages.conversacion.ir_al_ultimo` trilingüe.

### C3.5 — Limpieza de deuda heredada de C2

`npm run typecheck` pasaba con 4 errores `TS2322`/`TS2345` tras la migración F5.6-A (que hizo `conversaciones.nino_id` nullable). Resuelto sin tocar lógica de envío de push:

- `get-conversacion-detalle.ts` y `get-conversaciones.ts`: filtro explícito `.eq('tipo_conversacion', 'profe_familia')` (defensa en profundidad y semántica) + guard/type-predicate para cerrar el narrow a `string`.
- `audiencia.ts`: guard `if (!conv.nino_id) return []` tras el SELECT — admin↔familia no tiene cálculo de destinatarios por nino; no-op por ahora (cuando se cablee push para admin_familia será `{admin_id, tutor_id} \ excluyendoUserId`).

### Tests

- **Suite completa 411/411 verde** — 60 → 61 archivos vs F5.5. +50 tests aprox.:
  - F5.6-A: Core de `abrirConversacionAdminFamilia` unit; `enviarMensaje` admin_familia (schema + integración); `messaging.rls.test.ts` t14-t17 (admin_familia: per-par único, RLS UPDATE solo admin, conversación caducada, helper `puede_participar`); componentes (`ConversacionAdminFamiliaView`, `AdminFamiliaListItem`, `MensajeComposer.admin-familia`, `MessagesView` admin 2 tabs).
  - F5.6-B: `MarcarErroneoButton` ventana (4 tests, bordes 4:59 y 5:00); Core de las dos actions (cubren <5min OK, >5min sin tocar UPDATE, 42501 → ventana, 0-row-no-error → ventana, no_autor, ya_anulado); `messaging.rls.test.ts` t32-t35 (mensajes/anuncios <5min OK + >5min silently rejected).
  - F5.6-C: `useScrollAlFondo` (4 tests con instrumentación DOM por `Object.defineProperty`).

- **`npm run typecheck`** pasa con 0 errores tras C3.5.

### Decisiones (ADRs)

- **ADR-0029 — Modelo admin↔familia per-(admin,tutor)**: 1 hilo por par; `expires_at` por hilo; reapertura por SELECT-then-INSERT-or-UPDATE. Justificado frente a "1 por niño" y "1 por centro".
- **ADR-0030 — Timer reseteable vía trigger AFTER INSERT con `SECURITY DEFINER`**: el reset del `expires_at` ocurre como efecto de la inserción del mensaje. Atómico, sin necesidad de `UPDATE` por parte del tutor. Incluye hallazgos transversales sobre **USING+WITH CHECK** y "**USING falso → 0 filas, sin error**" (no 42501).
- **ADR-0031 — Marcar erróneo ventana 5 min en RLS inline**: aplica a mensajes y anuncios. **Sin moderación admin** — la app es comunicación adulto↔adulto, no canal hacia menores. Cada autor anula lo suyo, nadie más.

### Aprendizaje transversal

- **Discriminated union schemas con `z.input` vs `z.output`**: la firma pública usa `z.input`; las llamadas legacy F5 sin `kind` siguen tipando porque el default del schema rellena. Patrón replicable cuando una action gane modos discriminados.
- **Lazy initializer `useState(() => Date.now())` para snapshot temporal**: la regla React 19 `react-hooks/purity` bloquea `Date.now()` en render. Snapshot al montar + "sin countdown, refresh basta" = respuesta limpia.
- **"USING falso → 0 filas, error null" en UPDATE con RLS**: no es 42501. Las server actions con UPDATE bajo RLS condicional deben `.select('id').maybeSingle()` e inspeccionar `data === null`. Pareja simétrica del gotcha MVCC de F5 (INSERT…RETURNING).
- **Filtrar por `tipo_conversacion` en las queries F5 aunque el INNER JOIN ya las excluya**: el filtro explícito documenta la intención y previene que un caller futuro cuele admin_familia. Coste: una línea por query.
- **Hook compartido para scroll WhatsApp**: tres vistas con la misma necesidad y layouts distintos → un hook con `containerRef` que la vista decide dónde montar.

### Pendiente

- Smoke en producción tras merge (responsable):
  1. Admin abre conversación con tutor desde `/admin/ninos/[id]` Vínculos → envía → tutor lo ve en su sección "Dirección".
  2. Forzar `expires_at` por SQL → composer deshabilita en ambos lados; admin pulsa "Reabrir" → vuelve a estar activo, mensaje siguiente reseta el timer 3 días.
  3. Marcar erróneo: dentro de 5 min OK; >5 min, el botón no aparece; si por race se envía la petición, server responde `ventana_anulacion_expirada` (no falso positivo).
  4. Scroll: scroll inicial al fondo; subir → aparece botón "ir al último"; nuevo mensaje vía realtime con el usuario arriba → NO salta.

### Para F6

- Recordatorios bidireccionales E. La arquitectura de mensajería queda estable. El patrón "trigger AFTER INSERT con SECURITY DEFINER" (ADR-0030) es replicable para reseteo de campos derivados sin abrir RLS UPDATE.

## F5B — Cierre de Fase 5: personal de aula, tabla `/admin/aulas` enriquecida + docs

**Fecha:** 2026-05-30
**Estado:** ✅ Cerrada.

Bloque de cierre tras F5.6: completa el **Item 3** (clasificación de personal de aula y vista enriquecida) y formaliza la documentación operativa de Claude Code en el repo.

### PRs cerrados

- **PR #33** — `feat(messaging): admin tutor picker en NinoAgendaCard`. Resuelve el caso "admin desde aula con varios tutores: ¿a quién mensajeo?": un selector de tutor en la tarjeta del niño en lugar de asumir un único destinatario.
- **PR #34** — `feat(aulas): ENUM tipo_personal_aula + backend` (Item 3 B1+B2). Migración SQL `20260529193000_phase5b_tipo_personal_aula.sql` aplicada manualmente vía Supabase SQL Editor (bug `SIGILL` del CLI en este Chromebook). Ver **ADR-0032**.
- **PR #35** — `chore(docs): CLAUDE.md raíz` nuevo con la regla `npm run build` pre-merge para archivos `'use server'` (lección del PR #30: `export const` top-level en módulos `'use server'` rompía el bundler de Next.js 16 y llegó a producción). `Bootstrap/CLAUDE.md` queda **congelado** por su propia regla #44.
- **PR #36** — `feat(admin): tabla /admin/aulas enriquecida con personal y nº alumnos` (Item 3 B3). Nuevo Server Component `TablaAulas.tsx` + query `getAulasConPersonal`. **Cierra F5B Item 3.** Ver **ADR-0033**.
- **PR #37** — `chore(claude-code): permissions allow/deny` en `.claude/settings.json` + regla **11 "Cuándo pedir intervención del usuario"** en `CLAUDE.md`. Reduce la fatiga de aprobaciones (cada `cd`/`cat`/`gh pr view` interrumpía el flujo en #34-#36) y formaliza cuándo el agente debe parar a preguntar.

### Decisiones (ADRs)

- **ADR-0032 — ENUM `tipo_personal_aula`**: 4 valores (`coordinadora`, `profesora`, `tecnico`, `apoyo`) reemplazan al booleano `es_profe_principal` (deprecated 1 sprint + drop posterior). Backfill `true → coordinadora`, `false → profesora`. Índice único parcial "1 coordinadora activa por aula". Elegido frente a texto libre (sin validación) y tabla separada (overkill para 4 valores). Origen PR #34.
- **ADR-0033 — Tabla `/admin/aulas` enriquecida**: +3 columnas (Nº alumnos, Profesoras, Técnicos); coordinadora destacada con `Badge variant="warm"` + tooltip, resto `secondary`; columna Apoyos omitida hasta el primer dato (YAGNI); móvil con `overflow-x-auto`. Elegido frente a panel-por-click (+1 click para info que debe verse de un vistazo en 5 aulas) y columna unificada (diluye la jerarquía). VA con TODOs pendientes. Origen PR #36.

### Cierre

**F5B oficialmente cerrado.** Próximo bloque: **sprint pre-F6 (6 items)**.

## Sprint pre-F6 (entre F5B y F6)

**Fecha:** 2026-05-31
**Estado:** ✅ Cerrado.

Bloque de mantenimiento entre F5B y F6 (Recordatorios): cierre formal de F5B, reducción de flake en CI, una feature de admin (asignar personal a aulas), un cableado de push pendiente de F5.6 con dos hotfixes, y una verificación de UI. 6 items, **4 PRs mergeados (#38–#41)** + 1 item verificado sin PR.

### Items y PRs

| Item    | Descripción                                                                                        | Resultado                                                                               |
| ------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **1+2** | Audit de ADRs (0017/0018 huecos, 0032/0033) + cierre F5B en `progress.md` + ADR-0032/0033          | **PR #38**                                                                              |
| **3**   | Flake recurrente en CI de tests RLS bajo contención — split de proyectos `rls`/`unit` con timeouts | **PR #39**                                                                              |
| **4**   | UI para asignar personal a aulas (4 actions + `GestionarPersonalDialog` + ADR-0034)                | **PR #40**                                                                              |
| **5**   | Cableado push admin↔familia (pendiente desde F5.6) + blindaje por-campo del parser de `sw.js`      | **PR #41**                                                                              |
| **6**   | Menú lateral filtrado por rol (profe no debe ver items admin)                                      | **Sin PR.** Auditoría reveló que el patrón ya es correcto: no era bug real. Verificado. |

### Item 6 — por qué no hubo PR

El brief asumía que la sidebar mostraba todos los items a todos los roles. La auditoría ([`SidebarNav.tsx`](../../src/shared/components/SidebarNav.tsx), [`sidebar-items.tsx`](../../src/shared/lib/sidebar-items.tsx)) mostró que `buildSidebarItems(rol, locale, badge)` ya devuelve **listas disjuntas por rol**: los items admin-only (Centro, Cursos, Aulas, Menús, Niños, Audit) existen **únicamente** en la rama `rol === 'admin'`. Además cada layout de rol-espacio (`/admin`, `/teacher`, `/family`, `/messages`) **guarda la ruta** con redirect a `/forbidden`, y el rol activo se resuelve por prioridad `admin > profe > tutor_legal > autorizado` ([`get-centro-actual.ts`](../../src/features/centros/queries/get-centro-actual.ts), hotfix post-F5). Un profe nunca renderiza items admin. Sin cambio de código. Matiz residual (refinar `autorizado` vs `tutor_legal`) movido a follow-ups.

### Decisiones (ADRs)

- **ADR-0034 — Sustitución atómica de coordinadora** (PR #40): el cambio de coordinadora de un aula se hace en una sola transacción para no violar transitoriamente el índice único parcial "1 coordinadora activa por aula".

### Datos de prueba persistentes

Durante la validación del PR #40 se crearon **3 profes de prueba en ANAIA** que **no deben borrarse** (los reutilizan validaciones futuras). Documentados en [`docs/operations/datos-de-prueba.md`](../operations/datos-de-prueba.md).

### Cierre

**Sprint pre-F6 cerrado.** Follow-ups acumulados consolidados en [`docs/follow-ups.md`](../follow-ups.md). Próxima fase: **F6 — Recordatorios bidireccionales (E)**.

## Fase 6 — Recordatorios bidireccionales (E)

**Fecha:** 2026-05-31 → 2026-06-01
**Estado:** ✅ Cerrada (PRs #43–#47 mergeados).

Sexta fase: recordatorios entre centro y familias (y personales del staff). Arrancó con un modelo simple (F6-A/B) y se **re-modeló a destinatarios granulares** en F6-C tras detectar que el modelo de 4 destinos no cubría los casos reales (recordatorio a un aula entera, a todo el centro, a un profe concreto). Incluye además un fix de push arrastrado de F5.5/F6 (registro eager del Service Worker).

### PRs cerrados

| PR      | Bloque | Descripción                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **#43** | F6-A   | `feat(recordatorios): backend recordatorios bidireccionales`. Tabla `recordatorios`, ENUM `recordatorio_destinatario` (4 valores iniciales), RLS, audit, Realtime. Migración aplicada vía SQL Editor (bug `SIGILL` del CLI). Ver **ADR-0035**, **ADR-0036**.                                                                                                                                                                                                                                               |
| **#44** | F6-B   | `feat(recordatorios): UI + push + i18n`. Formulario, listado `/reminders`, badge de pendientes, cableado de push (`expandirDestinatariosRecordatorio`), i18n es/en/va.                                                                                                                                                                                                                                                                                                                                     |
| **#45** | F6-C-2 | `fix(push): registrar Service Worker eager en layout raíz`. El SW solo se registraba dentro del flujo "Activar" de `/profile`; un usuario que nunca lo completaba no tenía SW vivo y `push_subscriptions` quedaba vacía. Ahora se registra proactivamente en cada carga. Surgió de la **auditoría comparativa MisterFC vs NIDO** del push.                                                                                                                                                                 |
| **#46** | F6-C-1 | `feat(recordatorios): re-modelado granular de destinatarios`. ENUM a **6 valores** (`familia_individual`, `familias_aula`, `familias_centro`, `profe_individual`, `profes_centro`, `personal`), columna `aula_id`, RLS por destino, RPC `contar_recordatorios_pendientes()`. **admin/profe emisores; tutor/autorizado solo reciben** (revierte el botón de crear que #44 dio a tutor). Migración destructiva (D1, sin piloto arrancado) + fix `personal` solo staff. Ver **ADR-0037** (supera a ADR-0035). |
| **#47** | F6-C-3 | `feat(recordatorios): entry points contextuales niño/aula`. Crear recordatorio desde el contexto de un niño o un aula, prerelleno del destino.                                                                                                                                                                                                                                                                                                                                                             |

### Decisiones (ADRs)

- **ADR-0035 — Modelo de recordatorios bidireccionales** (`superseded` por ADR-0037): tabla propia con ENUM de destino de 4 valores. Superado por el modelo granular de F6-C.
- **ADR-0036 — Completar recordatorio idempotente** (vigente): idempotencia y race-safety vía `UPDATE … WHERE completado_en IS NULL` + `.select().maybeSingle()` (gotcha "USING falso → 0 filas"). Sigue aplicando en el modelo granular.
- **ADR-0037 — Modelo granular de destinatarios** (`accepted`, supera a ADR-0035): 6 destinos, RLS por destino, badge por destinatario directo, `puede_recibir_mensajes` respetado en la entrega push pero no en la visibilidad in-app de broadcasts (trade-off documentado).

### Aprendizaje transversal

- **Re-modelar antes del piloto sale barato.** La migración de F6-C fue destructiva (drop+recreate) sin coste real porque no hay datos de producción. La regla de inmutabilidad de migraciones aplica **una vez** que el piloto arranca.
- **El bug del push no era de recordatorios.** La auditoría comparativa con MisterFC reveló que el SW solo se registraba en el flujo de opt-in; el fix (#45) es transversal a todo el push, no solo a F6. La causa raíz operativa (VAPID en Vercel) la diagnostica el responsable aparte.

### Cierre

**F6 oficialmente cerrada.** Push-a-device queda marcado como **bloqueante temprano de Ola 1** (antes/junto a F7). Próxima fase: **F7 — Calendario + eventos + confirmaciones (lean)**; la reserva de tutorías se difiere a Ola 3 (ver `docs/specs/scope-ola-1.md`).

## Fase 7 + 7b — Calendario/eventos + Agenda de citas (nota-puente)

> Estas fases se entregaron y mergearon sin entrada propia en este diario (el equipo fue rápido). Quedan documentadas en sus ADRs y specs; se anotan aquí solo para no romper la cadena.

- **F7 — Calendario + eventos + confirmaciones (lean):** `eventos` + `confirmaciones_evento` con audiencia por ámbito. Ver **ADR-0038** y `docs/specs/f7-calendario.md`.
- **F7b — Agenda de citas con invitados nominales y RSVP:** `citas` + `cita_invitados` + `preferencias_usuario`; badge `contar_invitaciones_pendientes()`. Ver **ADR-0039** y `docs/specs/agenda-citas.md`.
- **AG-15 — Inicio: resumen de la semana:** consolidación del calendario en el home. Ver **ADR-0040**.

## Fase 8 — Autorizaciones + firma digital

Documento legalmente trazable para salida, medicación, recogida, régimen interno e imágenes. Modelo **catálogo de plantillas durables + instancia firmable por-niño** (patrón **A** la directora envía / patrón **B2** la familia inicia), **firma electrónica simple** (nombre tecleado + trazo dibujado + hash SHA-256 compuesto texto+`datos` + IP/UA), **append-only con freeze**, y **doble confirmación** en la administración de medicación.

### PRs cerrados

| PR      | Sub-fase | Resumen                                                                                                                                              |
| ------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **#53** | A (spec) | `docs`: spec de arranque `autorizaciones-firma.md` (D1–D9 + 6 flags ⚖️). Draft de Checkpoint A.                                                      |
| **#54** | F8-0     | Migración + RLS (sin UI): `autorizaciones` + `firmas_autorizacion`, ENUMs, helpers row-aware, freeze, audit.                                         |
| **#55** | F8-1     | Salida + firma digital (vertical slice): firma dibujada + hash + IP/UA.                                                                              |
| **#56** | F8-2b    | Reglas de régimen interno (reúso de F8-1). Deja 1 instancia legacy a migrar.                                                                         |
| **#59** | F8-RW-0  | Rework a **catálogo (plantilla durable) + patrones A/B2** (migración + RLS): `es_plantilla`, `ambito`, `plantilla_id`, CHECK de 5 formas.            |
| **#60** | F8-RW-1  | Catálogo (UI) + Enviar a audiencia + fix 3 bugs UI.                                                                                                  |
| **#61** | F8-RW-2  | Recogida B2 — la familia inicia su recogida.                                                                                                         |
| **#62** | F8-3a    | Medicación B2 — la familia inicia su medicación (vigencia del tratamiento en `firmas.datos`).                                                        |
| **#63** | F8-3b    | Registro de administración de medicación con **doble confirmación** (migración + RLS + tests).                                                       |
| **#64** | accesos  | Accesos profe (`/teacher/autorizaciones`), avisos al panel de Inicio, reestructura de notificaciones, seguimiento admin, excursión inline, archivar. |

### Migraciones

`20260603120000_phase8_autorizaciones` · `20260607120000_phase8_rw0_catalogo` · `20260608120000_phase8_3b_registro_administracion` · `20260609120000_phase8_archivar_medicacion` (aditivas, aplicadas). **Pendiente de aplicar:** `20260608130000_phase8_migrar_reglas_56` (engancha la regla legacy #56; idempotente; salta centros sin plantilla publicada de Régimen interno).

### Decisiones (ADRs)

- **ADR-0041 — Modelo de autorizaciones + firma digital** (`accepted`): A2 firma simple auditable + B2 plantilla/instancia + C2 doble confirmación; append-only/freeze; archivar vía RPC `SECURITY DEFINER`; postura legal ⚖️ y follow-ups fuera de alcance.

### Aprendizaje transversal

- **Re-modelar antes del piloto sigue saliendo barato.** F8-RW-0 reescribió el modelo (plantilla/instancia) con migración aditiva; las filas legacy de #56 quedaron compatibles.
- **Ampliar autorización sin tocar la policy de UPDATE:** RPC `SECURITY DEFINER` acotado (`archivar_autorizacion`) en vez de relajar `autorizaciones_update` — evita filtrar publicar/anular a la profe. Patrón reutilizable.
- **No inventar texto legal.** Las plantillas arrancan en `PENDIENTE`; la migración de datos #56 salta centros sin plantilla en vez de fabricar contenido jurídico.

### Cierre

**F8 cerrada (Checkpoint C):** typecheck + lint + test (suite entera) + build en verde. La **validez jurídica NO está certificada** — 6 flags ⚖️ a abogado (ver ADR-0041 §legal). Follow-ups anotados (textos legales reales, imágenes firmable F11, adjuntos F10, F8-4 DNI condicional, recogida puntual futura, migración legacy #56, aviso del botón "Enviar"). Próxima fase: **F9 — Informes de evolución**.

## Reparación — Mensajería (admin)

> **No es una fase numerada**: reparación del módulo de mensajería (F5/F5.6) sobre el rol admin. **Sin migración** — la RLS de admin (`es_admin(centro_id)` en `conversaciones_select` + `puede_participar_conversacion`) ya daba SELECT sobre las conversaciones profe↔familia del centro; solo faltaba la UI/query. **PR #66** (mergeado).

### Cambios

- **(a) Badge del sidebar.** El contador "Mensajería" del admin ya **no cuenta los mensajes privados profe↔tutor**. `countNoLeidos` es ahora consciente del rol: para admin cuenta solo sus hilos `admin_familia` (donde es interlocutor) + anuncios. Profe/tutor sin cambios (su RLS ya los limita a lo suyo).
- **(b) Rename.** La pestaña admin **"Dirección" → "Mensajería"** (la directora escribe directamente a un tutor; hilos `admin_familia`). Conserva su badge de no-leídos propios.
- **(c) Nueva pestaña "Dirección"** (solo admin) = **supervisión en SOLO LECTURA** de todas las conversaciones profe↔tutor del centro: lista (niño/aula/preview) + historial read-only con etiqueta "Solo lectura". Sin composer, sin acciones, no marca leído, sin badge. Componente `AdminSupervisionSplitView`; selección por `?conv=<id>`; reúsa `getConversacionesDelUsuario` (lista) y `getConversacionDetalle` (hilo).

i18n es/en/va (`messages.tabs.mensajeria`, bloque `messages.supervision.*`). Verificado en local: typecheck + lint + build en verde; `MessagesView.test.tsx` 7/7 (admin pasa a 3 triggers).

### Follow-ups (paquete RGPD de F11)

- ⚖️ **Least-privilege.** La supervisión es solo lectura **en la UI**, pero la RLS todavía permite al admin **postear** en las conversaciones profe↔tutor (`es_admin` → `puede_participar_conversacion` → INSERT). Cerrarlo también a nivel RLS (migración aparte) durante el pase RGPD. Anotado en `scope-ola-1.md` (Paquete RGPD).
- ⚖️ **Transparencia RGPD.** La pestaña "Dirección" expone a la directora **todos** los mensajes privados familia↔profe → debe constar en el aviso de privacidad / Registro de Actividades de Tratamiento (RAT). Anotado en `scope-ola-1.md` (Paquete RGPD).

## Fase 9 — Informes de evolución

Boletines de desarrollo cualitativos por niño y período (1.er/2.º/3.er trimestre + fin de curso), estructurados en **áreas → ítems** con escala de 3 (Conseguido/En proceso/No iniciado). La dirección define **plantillas**; la profe (coordinadora/profesora) crea desde una plantilla con **snapshot congelado**, rellena, publica (todos los ítems valorados) y puede despublicar/corregir/republicar **sin re-avisar**; la familia consulta los **publicados** (solo lectura) y los **descarga en PDF**. Modelo en ADR-0042; PDF en ADR-0043.

### PRs cerrados

| PR      | Sub-fase | Resumen                                                                                                                                          |
| ------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **#68** | spec     | `docs`: spec `informes-evolucion.md` (Q1–Q11 resueltas, `approved`).                                                                             |
| **#69** | F9-0     | Migración + RLS + helpers row-aware + tests (sin UI): `plantillas_informe` + `informes_evolucion`, 4 ENUMs, snapshot, audit. ADR-0042.           |
| **#70** | F9-1     | UI dirección: gestión de plantillas de informe (crear/editar/archivar, editor de áreas→ítems).                                                   |
| **#71** | F9-2     | UI profe: rellenar y publicar el informe del niño (crear→borrador→publicar→despublicar/corregir; sella `notificado_at`).                         |
| **#72** | F9-3     | UI familia: ver informes publicados (solo lectura) + histórico + aviso derivado en INICIO (marcador `informes_vistos`); sombreado verde reusado. |
| **#73** | F9-4     | **Export PDF server-side** (pdf-lib) del informe publicado + botón en familia y profe/admin + tests + cierre de F9. ADR-0043.                    |

### Migraciones

`20260609130000_phase9_0_informes_evolucion` (F9-0, **aplicada**) · `20260610120000_phase9_2_fix_notificado_coherencia` (F9-2: dropea el CHECK `notificado_coherencia` para que `notificado_at` persista tras despublicar y no re-avise al republicar — Q8; **aplicada**). F9-1/F9-3/F9-4 **sin migración**. CLI Supabase con bug SIGILL en este equipo → ambas se aplicaron por SQL Editor.

### Decisiones (ADRs)

- **ADR-0042 — Modelo de informes de evolución** (`accepted`): 2 tablas + estructura áreas→ítems en JSONB; **snapshot congelado** por informe (no plantilla viva); escala de 3; RLS row-aware (familia solo publicados, tutor legal siempre / autorizado con `puede_ver_datos_pedagogicos`); sin ventana temporal (se corrigen períodos pasados).
- **ADR-0043 — PDF del informe server-side con pdf-lib** (`accepted`): JS puro sin headless Chrome (serverless-friendly); contenido siempre en castellano (Q10) desde el snapshot; ruta neutra `/[locale]/informes/[id]/pdf` con autorización por RLS + metadatos (autor) vía service role tras verificar.

### Aprendizaje transversal

- **Aviso in-app sin tabla ni push.** El "informe publicado nuevo" reusa el patrón derivado de #64 (avisos de INICIO): se cuenta contra la RLS de la tabla origen y un marcador `informes_vistos` en `preferencias_usuario`; abrir el detalle lo marca visto. Q8 (no re-avisar) → marcador por **presencia**, no por instante.
- **Service role tras autorizar para datos que la RLS oculta.** El nombre del autor (profe) no es legible por la familia (`usuarios` self/admin); el PDF autoriza primero con el cliente del usuario y solo entonces resuelve metadatos con service role (patrón ADR-0027).
- **Descarga binaria = excepción legítima a "Server Actions, no API routes".** Un route handler con `Content-Disposition: attachment` es el vehículo correcto para el PDF.

### Cierre

**F9 cerrada (Checkpoint):** typecheck + lint + build + suite completa (`--no-file-parallelism`) en verde. Vista profe (crear→publicar→corregir), vista familia (lista + histórico + aviso de inicio + detalle solo lectura) y **descarga PDF** operativas en preview con la migración aplicada. Follow-ups anotados: acuse de recibo de la familia (reusando F8) y versionado formal del informe quedan **fuera de F9** (spec §Fuera de alcance); diseño rico del PDF (logo/colores/tablas) sería Ola 3 (ADR-0043). Próxima fase: **F10 — Fotos y publicaciones del aula**.

## Fase 9-5 — Campaña de informes

Capa de **coordinación de plazos** sobre F9 (NO una puerta: no toca ni bloquea `informes_evolucion`, vínculo lógico por (centro, curso, período) sin FK — Q6). La dirección abre una **campaña** por período del curso activo con **fecha límite**; las profes ven sus **pendientes** en INICIO; la dirección **sigue el avance por aula**; y todos **publican en lote** los informes completos. Pendientes y seguimiento son **derivados** (sin tabla de avisos, patrón #64). Modelo en ADR-0044; spec `docs/specs/campana-informes.md` (`approved`, Q1–Q9).

### PRs cerrados

| PR      | Sub-fase | Resumen                                                                                                                                       |
| ------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| **#74** | spec     | `docs`: spec `campana-informes.md` (Q1–Q9 resueltas, `approved`).                                                                             |
| **#75** | F9-5-0   | Migración base (sin UI): tabla `campanas_informe` + ENUM `estado_campana_informe` + RLS (staff lee, admin escribe) + audit + tests. ADR-0044. |
| **#76** | F9-5-1   | UI dirección: abrir/editar fecha/cerrar/reabrir campaña + **seguimiento por aula** (publicados vs pendientes, derivado).                      |
| **#77** | F9-5-2   | Aviso de **pendientes en el INICIO de la profe** redactora (consolidado Q1, urgencia por fecha más próxima Q9, derivado).                     |
| **#78** | F9-5-3   | **Publicar en lote** (best-effort, solo completos; profe por aula + dirección por aula/centro) + color ámbar de pendientes + cierre de F9-5.  |

### Migraciones

`20260610140000_phase9_5_0_campanas_informe` (F9-5-0, **aplicada** por SQL Editor — CLI SIGILL). F9-5-1/F9-5-2/F9-5-3 **sin migración** (reusan la capa de datos y `informes_evolucion_update` de F9).

### Decisiones (ADRs)

- **ADR-0044 — Modelo de campaña de informes** (`accepted`): tabla mínima de plazo (capa no-puerta), pendientes **derivados** (sin tabla de avisos), vínculo lógico por terna (sin FK), estado `abierta⇄cerrada` reversible. **Publicar en lote** (F9-5-3) reusa `publicarInforme` de F9-2: **best-effort** (publica los completos, deja los incompletos en borrador, no crea ni rellena — Q5/Q8), lo lanzan **profe** (su aula) y **dirección** (aula o centro), con la RLS de `informes_evolucion_update` como autorización (técnico/apoyo no publican).

### Aprendizaje transversal

- **Reusar la acción individual en el lote.** El "Publicar todos" no reimplementa la publicación: itera `publicarInforme` por borrador, heredando la validación de completitud (Q9) y el sellado de `notificado_at` (avisar una sola vez, Q8). El sellado se extrajo a `sellarNotificado(previo, ahora)` (puro, testeado) y se comparte con F9-2.
- **Color como señal de estado, en un solo sitio.** `fondoInforme` pasa a verde=publicado / **ámbar=pendiente** (borrador o sin empezar); el helper único evita duplicar colores entre listas (profe, familia).

### Cierre

**F9-5 cerrada (Checkpoint):** typecheck + lint + build + suite completa (`--no-file-parallelism`) en verde. Campaña (abrir/seguimiento), aviso de INICIO de la profe y **publicar en lote** verificados en preview con la migración aplicada. Sin migración nueva en F9-5-1/2/3. Próxima fase: **F10 — Fotos y publicaciones del aula**.

## Fase 10 — Fotos y publicaciones del aula (CERRADA)

### PRs cerrados

| PR      | Sub-fase | Resumen                                                                                                                                                                      |
| ------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **#80** | F10-0    | Base de Storage + blog del aula (capa de datos, sin UI): 3 tablas + `ninos.puede_aparecer_en_fotos` + **4 buckets** + políticas `storage.objects` + RLS + audit. ADR-0045.   |
| **#81** | F10-1    | UI profe: composer (subir/procesar con `sharp`, etiquetar con consentimiento, publicar). **HEIC rechazado** (ver abajo).                                                     |
| **#82** | F10-2    | Vista familia del blog (solo lectura + descarga) + **histórico** (P-histórico) + aviso de publicación nueva en INICIO (patrón #64). Migración RLS del histórico.             |
| **#83** | F10-3    | Adjuntos sobre Storage: foto del niño (tutor + admin), logo del centro (dirección), foto del DNI de recogida (tutor, atada al hash de F8). Migración de políticas del tutor. |

### F10-1 — UI profe: crear publicación con fotos (PR #81)

Composer de la profe: crear publicación, subir fotos (procesado server-side con `sharp`: EXIF/geo fuera, original optimizado + miniatura JPEG, idempotencia por hash, rollback anti-huérfanos, enlaces firmados ~1 h), etiquetar niños con consentimiento y publicar. Tope 4 MB por foto (cliente + servidor).

**Decisión sobre HEIC (diferida a follow-up):** en F10-1 el HEIC se **rechaza** con mensaje claro ("Convierte la foto a JPG o PNG antes de subirla"); **JPG/PNG funcionan**. Se descartaron 3 vías de decode tras reproducirlas/verificarlas:

- **Cliente con `heic-to` / `heic2any`** → ambas decodifican en un **Web Worker `blob:` que cuelga en silencio** en el navegador (la promesa nunca resuelve ni rechaza → la foto "desaparecía" a ~3 s sin aviso). Reproducido en headless Chromium con un HEIC real de iPhone.
- **Servidor con `heic-decode→sharp`** → el build de **Turbopack (Next 16.2.6) no embarca `libheif.wasm`** en la función serverless: `outputFileTracingIncludes` se ignora (verificado con el page-key correcto) y `require.resolve` del `.wasm` **rompe el build** ("Package libheif-js can't be external").

El soporte HEIC queda como **follow-up con DOS candidatos** (decode server-side con build Webpack — Opción B; o decode en cliente con el **decodificador HEIC nativo del navegador** sin wasm, verificable solo en iPhone real). Ver `docs/follow-ups.md` (sección F11).

**Aprendizaje transversal:** verificar los fixes que dependen del runtime (navegador/worker/wasm, función serverless) **en un entorno representativo antes de integrar/desplegar** — tres intentos por inferencia estática fallaron idénticos en producción; la causa solo se cerró reproduciendo en headless Chromium y comprobando el trace del build.

### F10-2 — Vista familia + histórico + aviso de INICIO (PR #82)

Vista lectora de la familia (miniaturas firmadas → original + descarga; **sin etiquetas**, privacidad) bajo el layout de familia, y **aviso in-app en INICIO** "Hay N publicaciones nuevas" (patrón #64, sin tabla de eventos: cuenta filas visibles por RLS no marcadas como vistas en `preferencias_usuario`; marca-vistas al abrir).

**P-histórico (decisión + migración RLS nueva, Opción 1):** la visibilidad base de F10-0 (`familia_ve_aula`) exige matrícula **activa** → un niño que se va perdería todo el blog pasado, contradiciendo P-histórico. Se añadió una **vía "mi hijo está etiquetado"** a `usuario_ve_publicacion_row` vía el helper **row-aware** `publicacion_etiqueta_hijo_de` (lee `media`/`media_etiquetas` con `es_tutor_de` + `puede_ver_fotos`, no re-lee `publicaciones`). Resultado: la familia **conserva** las publicaciones pasadas donde su hijo sale etiquetado aunque cause baja/cambie de aula, y **deja de ver** lo nuevo del aula. Migración `20260612120000_phase10_2_fotos_familia_historico` (aditiva, `CREATE OR REPLACE`). Tests RLS gateados por `F10_2_MIGRATION_APPLIED` (5/5 contra remoto).

### F10-3 — Adjuntos sobre Storage (PR #83)

Los tres adjuntos que dependían de Storage, reusando buckets de F10-0 y procesado de F10-1 (EXIF fuera, HEIC rechazado). **Ninguno usa `media`** (campos propios — P-media-reuso):

- **Foto del niño** (`ninos.foto_url`, bucket privado `ninos-fotos`): la sube el **tutor** desde la ficha de su hijo (`/family/nino/[id]`) y **dirección** (admin). Subida con el cliente del usuario (RLS de Storage gobierna); `foto_url` con service role tras autorizar. Enlace firmado para mostrar.
- **Foto del DNI de recogida** (`firmas.datos.adjuntos`, bucket privado `recogida-adjuntos`): el tutor la sube **antes de firmar**, 1 opcional por persona; la referencia entra en `datos.adjuntos` y se pliega al `texto_hash` de la firma de F8 (append-only, retrocompatible). Threaded por `crearRecogida` y `firmarAutorizacion`; lectura firmada en `RecogidaLista`.
- **Logo del centro** (`centros.logo_url`, bucket público `centro-assets`, ADR-0010): lo sube dirección desde `admin/centro`; PNG con transparencia; repunta `logo_url` y sustituye el seed hardcodeado. `next.config` con `remotePatterns` del host público.

**Migración nueva** `20260613100000_phase10_3_adjuntos_storage_policies` (aditiva, solo `CREATE POLICY`): el **tutor** escribe bajo `{centroId}/{ninoId}/…` en `ninos-fotos` y `recogida-adjuntos` (`es_tutor_de(ninoId)`). Tests RLS gateados por `F10_3_MIGRATION_APPLIED` (7/7 contra remoto: aislamiento entre familias; el logo solo dirección).

**Aprendizaje transversal (F10-3):** `tsc --noEmit` con **caché incremental** ocultó dos type-errors que CI (en limpio) sí marcó — un `as` a `Json` con tipos nombrados (`PersonaAutorizada`/`AdjuntoFirma`) que no encajan en la firma index. Lección: para el barrido pre-PR, **typecheck en frío** (borrar `*.tsbuildinfo`) o fiarse del build de CI; no del `tsc` local cacheado.

### Migraciones (Fase 10)

- `20260611120000_phase10_0_storage_publicaciones` (F10-0: tablas + buckets + políticas) — **aplicada**.
- `20260612120000_phase10_2_fotos_familia_historico` (F10-2: vía histórico, `CREATE OR REPLACE`) — **aplicada**.
- `20260613100000_phase10_3_adjuntos_storage_policies` (F10-3: escritura del tutor) — **aplicada**.

Todas aplicadas a mano por SQL Editor (CLI SIGILL en el equipo) y registradas en `supabase_migrations.schema_migrations`.

### Decisiones (ADRs)

- **ADR-0045 — Storage en NIDO + modelo del blog** (`accepted`, F10-0): buckets por sensibilidad, políticas sobre `storage.objects` por prefijo de ruta, helpers row-aware, service role tras autorizar.
- **ADR-0046 — Cierre de F10** (`accepted`): consentimiento/visibilidad efectivos por RLS; histórico de familia (vía "mi hijo etiquetado"); adjuntos (foto niño/logo/DNI, DNI atado al hash de F8); **rechazo de HEIC** con las dos vías documentadas para retomarlo.

### Cierre

**F10 cerrada (Checkpoint):** typecheck (en frío) + lint + build + **suite entera con TODOS los flags de F10 activados** (`F10_0/F10_2/F10_3_MIGRATION_APPLIED=1`, `--no-file-parallelism`) en verde contra el remoto con las 3 migraciones aplicadas. Números: **unit 1487/1487 passed** (79 archivos); **RLS 207 passed** (los 105 skipped son de otras fases por sus propios gates — F5/F5.6 mensajería, F5B34 profes-aulas, etc.); los **3 archivos RLS de F10** (`publicaciones`, `publicaciones-familia`, `adjuntos-storage`) corridos con sus flags dan **21/21 passed, 0 skipped** — verde real en lo de F10. Blog del aula (composer profe), vista familia (blog + histórico + aviso de inicio + descarga), y adjuntos (foto niño, DNI de recogida atado al hash, logo) verificados en preview. **HEIC se rechaza** con aviso claro (ADR-0046) — follow-up con dos vías. Próxima fase: **F11 — Pulido final + producción** (incluye el paquete RGPD bloqueante y el backlog consolidado en `docs/follow-ups.md`).

## Fase 11-C — Onboarding de profesor (CERRADA)

Alta de personal (profe) autónoma desde la app, sin SQL Editor. **Reusa la infra de
invitación/accept de tutores (D6)** con una rama propia hacia `profes_aulas` + avatar de
usuario. Decisiones A–F y diseño en ADR-0047; spec `docs/specs/onboarding-profe.md`.

### PRs cerrados

- **#133 (F11-C-0)** — Fundación: migración aditiva (`invitaciones.nombre_completo` +
  `tipo_personal_aula`, `usuarios.foto_url`) + bucket privado `usuarios-fotos` + 4 policies.
- **#134 (F11-C-1)** — Invitar profe: action `invitarProfe` (Core+wrapper, gate `es_admin`
  vía `sendInvitation`), `InvitarProfeDialog`, reenviar/revocar, validación
  coordinadora-única **al invitar** (decisión E); página `admin/personal` + nav.
- **#135 (F11-C-2)** — Accept: rama `profes_aulas` (service-role) en `acceptInvitation`
  (cuenta nueva) y `acceptPendingInvitation` (B8-profe, decisión F); prefill **editable**
  del nombre (decisión C); red del `23505` de coordinadora (mensaje amable, sin romper el
  accept).
- **#136 (F11-C-3)** — Avatar: route handler `usuarios/[id]/avatar` (sharp EXIF-strip→JPEG,
  HEIC rechazado, tope 4 MB, ruta `{centroId}/{usuarioId}`, UPDATE `foto_url` + firma por
  service-role tras el gate de Storage); `AvatarUploader` en perfil; foto **opcional** en el
  accept (decisión D) vía split `acceptInvitationCore`/wrapper sin romper el redirect.
- **F11-C-4** — Cierre: test end-to-end RLS/gated + ADR-0047 + esta entrada + gap tachado.

### Migraciones

- `20260622100000_phase11c_0_onboarding_profe_fundacion` (F11-C-0, aditiva). El resto de
  subfases (C-1…C-4) **no** tocan migraciones.

### Decisiones (ADRs)

- **ADR-0047 — Onboarding de personal**: reuso de D6 con rama profe (vs flujo a medida vs
  SQL Editor) + bucket propio `usuarios-fotos` (vs reusar `ninos-fotos`) + decisiones A–F.

### Aprendizaje transversal

- El avatar fuerza un split `acceptInvitationCore` (sin redirect) + wrapper: el camino sin
  foto conserva el redirect server-side de siempre (no-flash + propagación de cookie); el
  camino con foto crea la cuenta, sube por la route handler (ya hay sesión) y redirige con
  `redirigirAlPanel`. El binario de hasta 4 MB excede el body de las server actions → la
  subida va por route handler multipart (patrón F10-3), no por action.

### Cierre

**F11-C cerrada:** typecheck + lint + build + suite unit en verde en cada PR (última:
**1577/1577**). Tests del flujo: action+schema (17), accept B8-profe + helper + 23505 (9),
procesado de avatar (3), foto opcional no rompe el accept (2). Test **end-to-end RLS gated**
(`F11C0_MIGRATION_APPLIED=1`, `onboarding-profe.rls`): invitación → accept (cuenta nueva y
B8) → `profes_aulas` con tipo correcto → aislamiento entre centros → conflicto coordinadora
(23505) → aislamiento del bucket `usuarios-fotos`. El flujo de las acciones reales (usan
`next/headers` + `auth.admin`) se verifica en preview (no invocable en vitest, igual que
`alta-p1-fundacion.rls`). Gap "UI de alta de profesor" tachado en `docs/follow-ups.md`.

## Fase 11-H — Matrícula multi-curso (CERRADA)

Remodel del acoplamiento aula↔curso para soportar el **ciclo anual completo** de un centro 0-3: salas físicas estables, configuración (tramo de edad + capacidad) por curso, matrícula y personal por curso, "pasar de curso" (rollover) y lista de espera de admisiones. Cinco subfases secuenciales H-0…H-4.

### PRs cerrados

- **H-0 (#143/#144 fundación + capa app)** — migración `20260624130000`: `aulas` pasa a sala física (`ALTER`), nueva `aulas_curso (aula_id, curso, tramo_edad, capacidad)` con `UNIQUE(aula_id, curso)`, `matriculas` recreada con FK **compuesta** a `aulas_curso` + `UNIQUE(nino, curso)` activo, `profes_aulas` con `curso_academico_id`, `lista_espera` (admin-only). Helpers cualificados por curso activo (`es_profe_de_aula`/`es_redactor_de_aula` anclados a `curso_activo_de_centro`; `es_profe_de_nino`/`es_redactor_de_nino` con JOIN curso-exacto sobre matrícula `activa`). Nuevos `curso_activo_de_centro`/`centro_de_curso`.
- **H-1 (#144)** — capa de aplicación migrada al modelo aula/aulas_curso: queries, actions y asignación de personal por curso; `matriculas` ya no anida `aulas` por PostgREST → nombres por id (`getAulaNombresPorIds`). Sync de tipos en #145.
- **H-2 (#146 backend + #147 tabla)** — "pasar de curso": núcleo puro `computarPropuesta` (propuesta por año de nacimiento), tabla de revisión (1 fila por niño, aula propuesta editable, continúa/se gradúa). **Agrupación por aula de origen** cuando hay ≥2 salas candidatas para el mismo tramo (round-robin determinista; mantiene el grupo unido). Aforo **avisa, no bloquea**. Matrículas propuestas se persisten `pendiente` en el curso planificado (invisibles a staff por RLS); confirmar = flip `pendiente→activa` + activar curso.
- **H-3 (#148)** — UI de admisiones (`/admin/admisiones`): lista de espera por curso, alta/edición/baja blanda (`estado='descartado'`), reordenar la cola con **drag-and-drop nativo** (persiste `posicion`), "invitar al alta" (crea esqueleto de niño + `sendInvitation` reusando D6 → `estado='invitado'`).

### H-4 — Consolidación (este PR)

Cierre de F11-H sin lógica nueva:

- **Tests RLS/gated del modelo** (`src/test/rls/multicurso.rls.test.ts`, gate `F11_H0_MIGRATION_APPLIED`, 18 casos): aulas_curso (admin escribe / staff+familia leen / aislamiento entre centros), profes_aulas cualificado (profe del curso pasado NO ve al niño del activo), matriculas (FK compuesta 23503, UNIQUE 23505, políticas admin/profe/tutor), lista_espera (admin-only + aislamiento), aforo (no bloquea), doble matrícula (planificada invisible para staff; admin la ve), "pasar de curso" end-to-end (pendiente→activa + cierre/activación con un único curso activo por centro).
- Flag `F11_H0_MIGRATION_APPLIED='1'` añadido a `ci-pr.yml` y `ci-main.yml`.
- **ADR-0048** (matrícula multi-curso) + esta entrada.

### Decisiones (ADRs)

- **ADR-0048-matricula-multicurso**: aula física + `aulas_curso` + helpers cualificados por curso (Opción B) + agrupación por aula de origen en el rollover + aforo informativo.

### Aprendizaje transversal

- Matiz de visibilidad: la invisibilidad del curso planificado es para **staff** y para el acceso **operativo** (gating por `estado='activa'`). `matriculas_tutor_select` (= `es_tutor_de`) **no** filtra por curso → la familia ve la **fila** de matrícula planificada de su hijo (benigno: no abre datos operativos). Documentado en el ADR y afirmado a la verdad en los tests.

### Cierre

**F11-H cerrada:** verde local (typecheck + lint + unit + build) en cada PR; `multicurso.rls.test.ts` 18/18 contra el remoto. Modelo multi-curso operativo de admisiones a rollover.

## F11-G — Altas con documentos (CERRADA): G-0 a G-4

> Subfases una-por-PR (patrón F11-C). **G-1** (wizard 8 pasos + documentos, PR #150), **G-2**
> (paso 8: IBAN + mandato SEPA firmado, PR #151), **G-2bis** (cifrado IBAN, PR #152), **G-3**
> (validación de cambios + invitación tutor 2 + purga de PDFs, PR #153) y **G-4** (cierre)
> **mergeados**. ADR-0049 consolida la fase.

🔒 **BLOQUEANTE DURO pre-piloto — cifrado del IBAN (F11-G-2bis).** G-2 dejó el IBAN **en claro**
en `mandatos_sepa.iban`. **Ningún IBAN real puede entrar en BD** antes de **mergear + aplicar** la
migración `20260626120000_phase11g_2bis_cifrar_iban` (PR aparte): columna `iban_cifrado bytea`
(pgcrypto, clave `sepa_encryption_key` en **Vault**, separada de la médica), DROP del `iban` en
claro, RPC `registrar_mandato_sepa` SECURITY DEFINER (autoriza `es_tutor_legal_de` + cifra; el
route deja de usar service-role). Descifrado **solo** server-side por el proceso de remesas de
dirección (Fase B, pain.008) — `get_mandatos_remesa` diferido a Fase B. **Prerrequisito de
operador**: crear `sepa_encryption_key` en Vault **antes** de aplicar (si no, la migración
revierte). Registrado en `scope-ola-1.md` §Paquete RGPD, mismo tier. Patrón espejo de
`info_medica_emergencia` (ADR-0004).

**G-3 (PR #153) — validación de cambios + invitación tutor 2 + purga (PDFs).** Decisión J:
con el alta validada (matrícula `activa`), las ediciones de datos/documentos sensibles
(dirección del menor, datos del tutor, libro de familia, DNI) **se encolan** en
`cambios_pendientes` en vez de aplicarse; cola `/admin/pendientes` con aprobar/rechazar +
badge in-app (sin push/email); wizard reabrible con `?editar=1`. Decisión D-a: al activar la
matrícula se invita al tutor 2 con el email del wizard (best-effort, idempotente). Decisión H:
purga semimanual de curso (fin ≥5 años, doble validación, solo alumni) — en G-3 borraba **solo
PDFs + anulaba rutas**. Sin migración (esquema de G-0).

**G-4 (cierre) — completa la purga al DATO ESTRUCTURADO + tests + ADR.** El responsable
detectó el gap RGPD de G-3 (la purga dejaba vivo el dato personal). G-4 amplía `purgarCurso`:
**hard-delete** de filas `datos_tutor` / `mandatos_sepa` (incl. `iban_cifrado`) /
`cambios_pendientes` del alumni + **anulado** de dirección/estado civil del menor en `ninos`
(la ficha del niño NO se borra → olvido general = F11-B). Factible **sin SQL nuevo** (ninguna
de las 3 tablas tiene trigger de protección de DELETE ni FK entrante con RESTRICT; service role
bypassa la RLS default-DENY). **Conserva por ley:** `audit_log` (append-only). **Matiz RGPD
abierto → F11-B:** anular columnas de `ninos` (tabla auditada) copia la dirección a
`audit_log.valores_antes` → redacción pendiente (ver follow-ups; posible abogado). Tests RLS
gated nuevos `f11g-validacion-purga.rls.test.ts` (`F11G_RLS_APPLIED=1`): datos_tutor /
mandatos_sepa (IBAN nunca en claro al cliente) / cambios_pendientes / 3 buckets. Unit del
corte de 5 años (`fechaLimitePurga`). ADR-0049. Verde local typecheck/lint/unit/build.

## F12-B — Cuotas, recibos y remesas SEPA (EN CURSO): B-0 abierto

> Primera fase de funcionalidad de F12. Sucede a F11-G/H y **consume** el mandato SEPA capturado
> en G-2/G-2bis (`mandatos_sepa.iban_cifrado` + `identificador_mandato`). Subfases una-por-PR
> (patrón F11-G): **B-0** fundación (migración) · **B-1** catálogo de conceptos · **B-2** asignación
> modalidad/método/becas · **B-3** parte diario de las profes · **B-4** motor de cierre + recibos ·
> **B-5** RPC `get_mandatos_remesa` + XML pain.008 bajo demanda · **B-6** devoluciones · **B-7** vistas
> admin/familia + notificación in-app · **B-8** cierre (ADR + tests completos). Decisiones A–K
> cerradas por el responsable (2026-06-28).

### B-0 — Fundación (este PR, solo migración, sin UI)

Migración `20260628120000_phase12b_0_cuotas_recibos_remesas_fundacion.sql` (aditiva, **sin aplicar**;
se aplica por SQL Editor — CLI SIGILL). **11 tablas** con `centro_id` redundante, RLS default-DENY,
audit y triggers `set_centro_id`/`set_updated_at`:

- **Catálogo:** `conceptos_cobro` (mensual/diario/esporadico + precio vigente), `tipos_beca` (lista
  estándar por centro). Admin-only.
- **Asignación:** `asignacion_cuota` (modalidad mensual|diario por niño/concepto/mes, sin prorrateo —
  dec. C), `metodo_pago_familia` (sepa|efectivo|cheque_guarderia|transferencia por niño/mes — dec. H),
  `becas` (tipo + importe + periodo; línea **negativa** que resta sobre el total — dec. E). Admin-only.
  Las tres con **soft-delete** (`deleted_at`, sin hard DELETE; índice único parcial WHERE deleted_at
  IS NULL) — valor de auditoría: por qué se cobró/becó/qué método (ajuste post-review).
- **Parte de las profes:** `parte_servicio_diario` (comedor/matinera/vespertina por niño/fecha — dec. B;
  **tabla propia**, NO se reutiliza `comidas`). La profe del niño (o admin) apunta y lee; el tutor NO.
- **Cierre + recibos:** `cierre_mensual` (manual e **INMUTABLE** — dec. F: sin UPDATE/DELETE),
  `recibos` (total puede ser **negativo** = saldo a favor; `es_esporadico`; `devuelto_de_recibo_id`;
  estados pendiente_procesar|enviado_banco+fecha|devuelto|cobrado_manual — dec. I), `lineas_recibo`
  (importe **congelado** — dec. J; admite negativos para becas/saldo). El **tutor ve** sus recibos+líneas.
- **Remesas:** `remesas` (estado borrador|enviada + fecha; **SIN xml_path** — dec. G1, el XML se genera
  bajo demanda y no se almacena; índice de periodo **NO único** → puede haber >1 remesa/mes por re-giros,
  ajuste post-review), `recibos_remesa`. Admin-only.

**6 ENUMs:** `tipo_concepto`, `modalidad_cobro`, `metodo_pago`, `servicio_diario`, `estado_recibo`,
`estado_remesa`. **Helpers nuevos:** `centro_de_recibo`, `nino_de_recibo`, `centro_de_remesa` +
triggers `derivar_centro_id_de_recibo`/`_de_remesa` (reusa `derivar_centro_id_de_nino` de G-0).
`audit_trigger_function` ampliada (+11 ramas, preserva las previas). Tipos en `database.ts` a mano
(patrón H-0, para tipar el test gated antes de aplicar). Test RLS gated
`f12b-cuotas-recibos.rls.test.ts` (`F12B_RLS_APPLIED`). Verde local: typecheck/lint/build + unit
1645✓ + gated 7 skipped. **Sin bucket** (dec. G1). **Dependencia RGPD con F11-B** registrada en
follow-ups (retención de recibos/remesas, IBAN en el XML, RAT). **El usuario mergea; no empezar B-1
hasta mergear B-0.**

🔒 **Dos requisitos obligatorios diferidos (registrados en follow-ups, no opcionales):** (1) **B-4** —
trigger de congelado del mes cerrado (bloquear UPDATE/DELETE de `recibos`/`lineas_recibo`/
`parte_servicio_diario` con `cierre_mensual` del periodo; sin él la decisión F no se cumple, B-0 solo
hace inmutable el marcador `cierre_mensual`). (2) **B-6** — el estado `devuelto` debe **conservar**
`fecha_envio_banco` y añadir `fecha_devolucion` (las R-transactions SEPA referencian el envío original;
hoy el CHECK la anula).

## Fase 12 — Funcionalidad pendiente post-F11 (registrada, sin abrir)

> Registrada durante F11-A (2026-06-13). **F12 sigue siendo Ola 1** — secuencial tras F11,
> no una ola posterior (Ola 1 = 100% de la funcionalidad; ver `scope-ola-1.md` §Modelo de
> olas y §Backlog F12). Recoge funcionalidad core que quede pendiente o aflore al estabilizar
> producción. **El análisis de cierre de F11 poblará F12**; aún no se abre ni se especifica.

**Ítems identificados:**

- **Tutorías — reserva de franjas formal con la profesora.** Hoy ya existe una **vía
  informal** (la familia y la profe acuerdan la tutoría por **mensajería** y/o la cuelgan en
  la **Agenda/Calendario** — citas de F7b `reunion_familia`). F12 añadiría la **capa de
  reserva formal encima** (franjas ofertadas, autoservicio de reserva por la familia,
  confirmación), **reusando** Agenda + mensajería, **no desde cero**. Se reclasificó desde la
  etiqueta previa "Ola 3" (era funcionalidad, no una mejora de IA) → baja a F12 (Ola 1).
- **Selección de idioma en el perfil.** Hoy el perfil **MUESTRA** el idioma pero **no permite
  cambiarlo**. Añadir un selector (`es`/`en`/`va`) que **persista** la preferencia del usuario y
  **aplique** el locale elegido (hoy el cambio de locale solo va por URL). Al implementarlo,
  **verificar si es feature ausente o selector roto**.
