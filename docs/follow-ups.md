# Follow-ups acumulados — NIDO

Backlog vivo de deudas técnicas, hardening y decisiones diferidas que **no** bloquean la fase en curso pero deben atenderse en su momento. Cada entrada indica origen (PR/sprint) y condición de disparo.

> Consolidado por primera vez en el **sprint pre-F6** (2026-05-31, PR #42) recogiendo lo apuntado durante F5.6, F5B y el propio sprint. Actualiza esta lista al cerrar cada follow-up (mover a "Resueltos" o borrar) y al abrir nuevos.

> **Olas (modelo nuevo):** 1️⃣ producto web completo · 2️⃣ app nativa · 3️⃣ mejoras/diferenciación. Plan **scope-driven**, sin deadline externo. Cada entrada se etiqueta con la ola a la que pertenece.

## Bloqueantes pre-piloto — Ola 1

- [ ] **UI de alta de profesor + invitación al centro** (admin de usuarios). Hoy el admin del centro depende del **SQL Editor** para dar de alta personal. Sin esta UI el piloto no es autónomo. PR aparte post-sprint. _(Ola 1)_
- [ ] **Confirmar traducciones VA con usuario nativo.** Quedan TODOs de valenciano en el código de los PRs **#35, #36, #40** (strings marcados en componente, no en JSON). Revisar con hablante nativo antes del piloto. _(Ola 1)_

## Hardening — post 1 sprint en producción (Ola 1)

- [ ] **Drop de `es_profe_principal` en `profes_aulas`** (deprecated desde PR #34, reemplazado por ENUM `tipo_personal_aula`). ~10 min de SQL una vez confirmado que nada lo lee en producción tras un sprint.
- [ ] **Reactivar los 6 tests `skip` de `profes-aulas.rls.test.ts`** (gate `F5B34_MIGRATION_APPLIED`). La migración ya está aplicada en remoto → el gate puede pasar a `1` por defecto / eliminarse.

## Hardening de datos / auditoría — Ola 1 (parte del paquete RGPD bloqueante)

- [ ] **Trigger `audit_log` para `profes_aulas`** + sweep de otras tablas sin auditar. Es una decisión RGPD: revisar qué tablas con datos sensibles aún no tienen trigger de audit y decidir cobertura. _(Ola 1 — RGPD)_
- [ ] **Cleanup de tests RLS que dejan residuos en la BD remota.** Hay centros basura acumulados en remoto (p.ej. `Centro Menus A` ×4, `Centro Profes A/B`…). Investigar qué suite no limpia tras de sí y añadir teardown. _(Ola 1)_

## Reactivos / condicionales (solo cuando se cumpla la condición)

- [ ] **Columna "Apoyos" en `/admin/aulas`** — añadir cuando aparezca el primer `apoyo` real en ANAIA (omitida hoy por YAGNI, ver ADR-0033). _(Ola 1)_
- [ ] **Telemetría de `getTutoresParaAdminDireccion`** — solo si hay reporte de lentitud o un centro supera ~100 tutores. _(Ola 1)_
- [ ] **Refinar `autorizado` vs `tutor_legal` en la sidebar** — hoy comparten la lista de items de familia. Decisión de producto, a resolver pre-piloto (detectado en auditoría del item 6 del sprint pre-F6). _(Ola 1)_

## Post-F6 — Ola 1

- [ ] **Seeds E2E:** _(Ola 1)_
  - `seed-mensajes.ts` — ≥50 mensajes para el test de scroll tipo WhatsApp (PR #31).
  - `seed-aulas-multitutor.ts` — para los tests de pickers (PRs #31, #32, #33).
- [ ] **Investigar el patrón `Select` de base-ui en jsdom** — exploración técnica (el componente no renderiza igual bajo jsdom; varios tests lo esquivan). _(Ola 1)_

## F11 — pulido final (Ola 1)

- [ ] **Recalibrar `h-[calc(100dvh-3rem)]`** en `ConversacionView` y `ConversacionAdminFamiliaView` — detectado ~1rem de infra-descuento. _(Ola 1)_
- [ ] **Implementación de ADR-0028** — `theme_color` provisional del manifest PWA, Service Worker versionado. _(Ola 1, F11)_
- [ ] **Derecho al olvido funcional** — redactar/anonimizar `valores_antes` en `audit_log` al ejercer borrado. _(Ola 1 — RGPD bloqueante, antes del primer dato real)_
- [ ] **`process-logos.mjs` multi-fuente** — soportar varias fuentes de logo. _(Ola 1)_

## Resueltos

- [x] **Índice del README de `docs/decisions/`** — actualizado hasta **ADR-0037** (con 0035 `superseded` por 0037 y 0036 `accepted`) en el sprint de sincronización de docs de planificación. _(cerrado en el PR de docs/sync-planificacion-olas)_
