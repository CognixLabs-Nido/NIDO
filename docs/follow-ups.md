# Follow-ups acumulados — NIDO

Backlog vivo de deudas técnicas, hardening y decisiones diferidas que **no** bloquean la fase en curso pero deben atenderse en su momento. Cada entrada indica origen (PR/sprint) y condición de disparo.

> Consolidado por primera vez en el **sprint pre-F6** (2026-05-31, PR #42) recogiendo lo apuntado durante F5.6, F5B y el propio sprint. Actualiza esta lista al cerrar cada follow-up (mover a "Resueltos" o borrar) y al abrir nuevos.

## Bloqueantes pre-piloto (antes de septiembre 2026)

- [ ] **UI de alta de profesor + invitación al centro** (admin de usuarios). Hoy el admin del centro depende del **SQL Editor** para dar de alta personal. Sin esta UI el piloto no es autónomo. PR aparte post-sprint.
- [ ] **Confirmar traducciones VA con usuario nativo.** Quedan TODOs de valenciano en el código de los PRs **#35, #36, #40** (strings marcados en componente, no en JSON). Revisar con hablante nativo antes del piloto.

## Hardening — post 1 sprint en producción

- [ ] **Drop de `es_profe_principal` en `profes_aulas`** (deprecated desde PR #34, reemplazado por ENUM `tipo_personal_aula`). ~10 min de SQL una vez confirmado que nada lo lee en producción tras un sprint.
- [ ] **Reactivar los 6 tests `skip` de `profes-aulas.rls.test.ts`** (gate `F5B34_MIGRATION_APPLIED`). La migración ya está aplicada en remoto → el gate puede pasar a `1` por defecto / eliminarse.

## Hardening de datos / auditoría

- [ ] **Trigger `audit_log` para `profes_aulas`** + sweep de otras tablas sin auditar. Es una decisión RGPD: revisar qué tablas con datos sensibles aún no tienen trigger de audit y decidir cobertura.
- [ ] **Cleanup de tests RLS que dejan residuos en la BD remota.** Hay centros basura acumulados en remoto (p.ej. `Centro Menus A` ×4, `Centro Profes A/B`…). Investigar qué suite no limpia tras de sí y añadir teardown.
- [ ] **Índice del README de `docs/decisions/` está stale** — debe llegar hasta **ADR-0034** tras este sprint. Actualizar la tabla "Índice rápido".

## Reactivos / condicionales (solo cuando se cumpla la condición)

- [ ] **Columna "Apoyos" en `/admin/aulas`** — añadir cuando aparezca el primer `apoyo` real en ANAIA (omitida hoy por YAGNI, ver ADR-0033).
- [ ] **Telemetría de `getTutoresParaAdminDireccion`** — solo si hay reporte de lentitud o un centro supera ~100 tutores.
- [ ] **Refinar `autorizado` vs `tutor_legal` en la sidebar** — hoy comparten la lista de items de familia. Decisión de producto, a resolver pre-piloto (detectado en auditoría del item 6 del sprint pre-F6).

## Post-F6

- [ ] **Seeds E2E:**
  - `seed-mensajes.ts` — ≥50 mensajes para el test de scroll tipo WhatsApp (PR #31).
  - `seed-aulas-multitutor.ts` — para los tests de pickers (PRs #31, #32, #33).
- [ ] **Investigar el patrón `Select` de base-ui en jsdom** — exploración técnica (el componente no renderiza igual bajo jsdom; varios tests lo esquivan).

## F11 — pulido final

- [ ] **Recalibrar `h-[calc(100dvh-3rem)]`** en `ConversacionView` y `ConversacionAdminFamiliaView` — detectado ~1rem de infra-descuento.
- [ ] **Implementación de ADR-0028** — `theme_color` provisional del manifest PWA, Service Worker versionado.
- [ ] **Derecho al olvido funcional** — redactar/anonimizar `valores_antes` en `audit_log` al ejercer borrado.
- [ ] **`process-logos.mjs` multi-fuente** — soportar varias fuentes de logo.

## Resueltos

_(vacío — mover aquí los follow-ups completados con su PR de cierre)_
