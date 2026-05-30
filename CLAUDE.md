# NIDO

**Agenda escolar (PWA) para escuelas infantiles 0-3 años.** Trilingüe (es/en/va). Construida en abierto.

Una sola escuela inicialmente (ANAIA, Valencia), arquitectura preparada para multi-centro. Roles: admin, profe, tutor legal, autorizado.

## Comandos

| Tarea                     | Comando                               |
| ------------------------- | ------------------------------------- |
| Arrancar dev server       | `npm run dev`                         |
| Build producción          | `npm run build`                       |
| Test unit/integration     | `npm test`                            |
| Test E2E                  | `npm run test:e2e`                    |
| Typecheck                 | `npm run typecheck`                   |
| Lint                      | `npm run lint`                        |
| Format                    | `npm run format`                      |
| Migración Supabase nueva  | `npx supabase migration new <nombre>` |
| Aplicar migraciones local | `npx supabase db reset`               |
| Regenerar tipos TS        | `npm run db:types`                    |

## Stack

Next.js 15 App Router · TypeScript strict · React 19 · Tailwind 4 · shadcn/ui · Supabase (Postgres + Auth + Storage + Realtime) · TanStack Query · React Hook Form + Zod · next-intl · Vitest + Playwright · Sentry.

## Reglas operativas (no negociables)

**1. Spec antes de código.** Antes de implementar cualquier feature, escribes `/docs/specs/[feature].md` siguiendo `/docs/specs/_template.md`. Esperas aprobación del responsable. Solo entonces tocas código.

**2. Branch por feature, PR obligatorio.** Nomenclatura: `feat/`, `fix/`, `chore/`, `docs/`, `refactor/`, `test/`. Conventional Commits. Squash merge a main. Nunca push directo a main.

**3. Tests obligatorios en lógica crítica.** Auth, permisos, RLS, validaciones, audit log. Tests de aislamiento entre aulas y familias. Sin estos tests pasando, la feature no está hecha.

**4. ADR al final de cada fase o decisión arquitectónica importante.** En `/docs/decisions/ADR-XXXX-[slug].md` siguiendo `/docs/decisions/_template.md`.

**5. Una fase a la vez, secuencial.** Ver `/docs/specs/scope-ola-1.md` para las 12 fases. No paralelizar. No avanzar sin que la anterior esté mergeada y desplegada.

**6. Repo público, cero datos privados en código.** Fixtures con nombres ficticios reconocibles ("Niño Demo 1", "Profe Pruebas"). Secrets solo en `.env.local`. Pre-commit hook escanea secretos.

**7. Trilingüe desde día 1.** Todo string visible al usuario está en es/en/va. ESLint bloquea hardcoded strings en JSX.

**8. Stop and ask.** Ante duda en arquitectura, RGPD, modelo de datos o decisiones de producto: pregunta al responsable antes de actuar.

**9. Verificación de cuentas antes de usar herramientas externas.** Antes de cada uso inicial en una sesión de `gh`, `vercel`, `supabase` u otra CLI con autenticación, ejecuta el comando de status (`gh auth status`, `vercel whoami`, etc.) y verifica que apunta a la cuenta correcta (`CognixLabs-Nido` para gh, etc.). Si no, párate y avisa.

**10. Credenciales solo desde `.env.local` o equivalente.** Las credenciales de la app (claves API, tokens) viven exclusivamente en `.env.local` (gitignored) o en variables de entorno de Vercel para producción. Si te falta una variable, pídela al responsable. **Cero hardcoded credentials** en código bajo cualquier circunstancia.

**11. Cuándo pedir intervención del usuario.** Claude Code procede de forma autónoma en operaciones rutinarias del flujo (navegación, lectura, edición de archivos según plan acordado, comandos pre-aprobados en `.claude/settings.json`). Se detiene a pedir confirmación al usuario únicamente en estos momentos:

- **Finalización de un Checkpoint** (A/B/etc.) o de una fase completa, reportando estado.
- **Decisión de producto no cerrada en la spec** (alternativas con trade-offs que el usuario debe evaluar).
- **Error o ambigüedad que requiera contexto** que el agente no tiene (instrucciones contradictorias, dato faltante).
- **Cambio de scope respecto a lo aprobado** en el Checkpoint vigente.
- **Operación destructiva sobre datos productivos** (migraciones SQL, drops, reset de tablas).

Para todo lo demás (`cd`, `git status`, `npm test`, ediciones según plan, etc.), procede sin pedir confirmación. La lista exhaustiva de comandos pre-aprobados está en `.claude/settings.json`.

**Lección de origen**: F5B fatiga de aprobación durante #34-#36, donde cada `cd`, `cat` o `gh pr view` interrumpía el flujo. Formalizada tras conversación con el usuario el 2026-05-30.

## Verificaciones antes de abrir un PR

Tras implementar y antes de abrir el PR, deben pasar en local:

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run build       # next build — obligatorio (ver regla abajo)
```

No basta con "ya lo correrá la CI / Vercel": `npm run build` debe ejecutarse y salir con **exit 0** localmente antes de abrir el PR.

### Regla: `npm run build` obligatorio en PRs que toquen archivos `'use server'`

Para cualquier PR que **añada, modifique o renombre** archivos con la directiva `'use server'` en la primera línea (en este repo: todos los `src/features/**/actions/*.ts`, y cualquier otro archivo que lleve la directiva), **DEBE** ejecutarse `npm run build` en local antes de abrir el PR. Este check es **obligatorio**, no opcional.

**Razón**: Vitest carga los módulos como JS normal y **no** enforza la regla de Next.js 16 _"a 'use server' file can only export async functions"_. El `typecheck` tampoco la captura: el tipo del export puede ser válido pero el bundler lo rechaza en runtime (p. ej. `export const VENTANA_ANULACION_MS = 5 * 60 * 1000` junto a server actions). Solo el bundler de Next.js o el runtime real la detectan.

**Síntoma típico cuando falla**: en los logs de Vercel tras deploy aparece
`Error: A "use server" file can only export async functions, found <tipo>.`

**Cómo verificar**: tras los pre-PR habituales (`npm run typecheck`, `npm test`), correr `npm run build` y confirmar **exit 0**.

> ⚠️ **Matiz de rutas dynamic**: en rutas `ƒ (dynamic)` el chunk no se evalúa durante `Generating static pages`, así que `npm run build` puede pasar en local y el error solo aparecer en `npm run start` o en el primer request de Vercel. Si el PR toca `'use server'` en una ruta dynamic (p. ej. `/messages/*`), además del build haz un smoke con `npm run start` y carga la ruta afectada.

> **Lección [PR #30](https://github.com/CognixLabs-Nido/NIDO/pull/30)** (mergeado 2026-05-29): el bug entró en el PR #25 (F5.6-B) — `export const VENTANA_ANULACION_MS` top-level en `marcar-mensaje-erroneo.ts` y `marcar-anuncio-erroneo.ts` (ambos `'use server'`). Vitest no lo detectó y, al ser `/messages/*` rutas dynamic, el build local tampoco saltó; llegó a producción y rompió la mensajería hasta el hotfix. Ver el body del PR #30 (y `docs/specs/phase-5b-*.md`) para el caso real.

## Convenciones rápidas

- **Archivos**: PascalCase para componentes React (`AgendaForm.tsx`), kebab-case para el resto (`format-date.ts`).
- **Carpetas y rutas**: kebab-case.
- **BD**: tablas plural snake_case, columnas snake_case.
- **Variables y funciones**: camelCase. Constantes: UPPER_SNAKE_CASE.
- **TypeScript**: strict, sin `any`, sin excepciones.
- **Zod schemas como fuente de verdad de tipos**: `type X = z.infer<typeof XSchema>`.
- **Server Components por defecto.** Client Components solo cuando sea imprescindible.
- **Server Actions para mutaciones**, no API routes (salvo webhooks externos).
- **`useEffect` con fetch prohibido.** Server Components o TanStack Query.
- **Patrón Result en Server Actions**: `{ success: true, data } | { success: false, error }`. Nunca `throw` visible al cliente.
- **`console.log` prohibido en producción.** Logger compartido en `src/shared/lib/logger.ts`.
- **Imports ordenados**: external → `@/...` → relative. `eslint-plugin-import` lo enforza.
- **Specs y comentarios en español. Código (nombres, tipos) en inglés.**

Detalle completo en `@./docs/conventions.md`.

## Modelo de datos (35 tablas)

- **Core (10)**: centros, cursos_academicos, aulas, usuarios, roles_usuario, ninos, info_medica_emergencia, matriculas, vinculos_familiares, profes_aulas.
- **Operativas (20)**: agendas_diarias, comidas, biberones, suenos, deposiciones, asistencias, ausencias, dias_centro, plantillas_menu_mensual, menu_dia, conversaciones, mensajes, lectura_conversacion, anuncios, lectura_anuncio, recordatorios, eventos, confirmaciones_evento, autorizaciones, firmas_autorizacion, plantillas_informe, informes_evolucion, publicaciones, media, media_etiquetas.
- **Transversales (5)**: audit_log, notificaciones_push, push_subscriptions, invitaciones, consentimientos.

Reglas obligatorias del modelo:

- UUIDs en todas las PKs.
- Soft delete (`deleted_at`) en entidades sensibles. RLS filtra por defecto.
- `centro_id` redundante en tablas operativas para que RLS sea queries simples.
- Triggers de Postgres para audit log automático en tablas auditadas.
- `audit_log` append-only (RLS bloquea UPDATE/DELETE).
- Timestamps siempre `timestamptz`.
- Cifrado a nivel columna con pgcrypto en `info_medica_emergencia.enfermedades_graves` y `notas_emergencia`.

Detalle completo en `@./docs/architecture/data-model.md`.

## Roles y permisos

5 roles: `admin`, `profe`, `tutor_legal`, `autorizado`, `service`.

Funciones helper Postgres (en schema `public.*`, no `auth.*` — Supabase Cloud lo exige, ver ADR-0002):

- `public.es_admin(centro_id)`, `public.es_profe_de_aula(aula_id)`, `public.es_tutor_de(nino_id)`, `public.tiene_permiso_sobre(nino_id, permiso)`, `public.pertenece_a_centro(centro_id)`.

Default DENY ALL. Service role bypass para Edge Functions, nunca expuesto al cliente.

Ventana de tiempo (Fase 3 y Fase 4, ADR-0013 + ADR-0016 transversal): profe / admin editan **agenda y asistencia** solo durante el **mismo día calendario hora `Europe/Madrid`** (helper `public.dentro_de_ventana_edicion(fecha)`). A las 00:00 hora Madrid del día siguiente, el día anterior queda **read-only para todos** los roles (incluido admin) por RLS. Correcciones de histórico solo vía SQL con `service_role` (queda en `audit_log`). DELETE bloqueado a todos por default DENY — eventos erróneos se marcan con UPDATE `observaciones = '[anulado] '...` (agenda) o `descripcion = '[cancelada] '...` (ausencias). Las ausencias futuras siguen una regla análoga con `public.hoy_madrid()`: tutor solo puede reportar/editar `fecha_inicio >= hoy`. Esta regla **deroga** la anterior ("hasta 06:00 día siguiente, admin edita histórico"). Ver ADR-0011 (huso Madrid), ADR-0013 (mismo día agenda), ADR-0015 (asistencia lazy) y ADR-0016 (día cerrado transversal).

Tests RLS obligatorios por categoría de tabla.

Detalle completo en `@./docs/architecture/rls-policies.md`.

## Plan de implementación

12 fases secuenciales. Cada fase termina con producción actualizada, ADR escrito, y entrada en `/docs/journey/progress.md`.

| #   | Fase                              |
| --- | --------------------------------- |
| 0   | Fundaciones                       |
| 1   | Identidad y acceso                |
| 2   | Entidades core + RLS + audit log  |
| 3   | Agenda diaria + bienestar (B, D)  |
| 4   | Asistencia + ausencias            |
| 5   | Mensajería                        |
| 6   | Recordatorios bidireccionales (E) |
| 7   | Calendario y eventos              |
| 8   | Autorizaciones + firma digital    |
| 9   | Informes de evolución             |
| 10  | Fotos y publicaciones             |
| 11  | Pulido final + producción         |

Detalle completo en `@./docs/specs/scope-ola-1.md`.

## Reglas críticas (RGPD, seguridad)

- **Nunca commitear secretos.** Pre-commit hook escanea patrones comunes.
- **Nunca usar `console.log` o logger en producción con datos personales.**
- **Validación server-side Zod siempre.** Nunca confiar solo en validación cliente.
- **`info_medica_emergencia` con cifrado a nivel columna.** Acceso auditado.
- **Audit log no se puede modificar nunca.** Política RLS lo bloquea.
- **Datos de menores**: consentimiento explícito, retención limitada, derecho al olvido funcional.
- **Tests de aislamiento** entre aulas y familias son bloqueantes para considerar feature terminada.

## Referencias a documentación

@./docs/conventions.md
@./docs/architecture/data-model.md
@./docs/architecture/rls-policies.md
@./docs/specs/scope-ola-1.md
@./docs/decisions/

Cuando trabajes en una feature concreta, lee también:

- `/docs/specs/[feature].md` si existe
- ADRs relacionados en `/docs/decisions/`

## Comprobación antes de cualquier sesión de trabajo

Si arrancas Claude Code en este repo, lo primero que debes hacer:

1. **`gh auth status`** → debe mostrar `CognixLabs-Nido` como cuenta activa.
2. **`direnv status`** → debe mostrar `.envrc` cargado para este directorio.
3. **`echo $PROJECT_NAME`** → debe responder `nido`.
4. **`git status`** → ver en qué branch estás.

Si algo de esto falla, párate y resuelve antes de tocar código. Si no sabes cómo, pregunta al responsable.
