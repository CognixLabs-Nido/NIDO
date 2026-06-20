---
feature: messaging-nino-agenda-admin-escribir-familia
wave: 1
status: implemented
priority: high
last_updated: 2026-05-29
related_specs:
  [messaging.md, phase-5-6-admin-family-messaging.md, phase-5b-admin-direccion-split-view.md]
related_adrs: [ADR-0029]
---

# Spec F5B #33 — Admin tutor picker en NinoAgendaCard

## Resumen ejecutivo

El botón "Escribir a la familia" del componente cliente `NinoAgendaCard` (vista de aula) seguía el flujo F5 profe→familia (`/messages/nino/<id>` → `/messages?nino=<id>`). El admin reusa la página `/teacher/aula/[id]` para supervisar y allí ese flujo cae en tab Anuncios (mismo síntoma del Item 1 del PR #32). Aplicamos **Opción B**: para admin, el botón redirige al SplitView del PR #32 (`/messages?tab=mensajeria&tutor=<usuarioId>`) con preselección del tutor; si el niño tiene varios tutores activos, abre un Dialog picker para que el admin elija. Para profe se mantiene el flujo actual bit-a-bit, sin regresión.

## Decisiones cerradas

| ID                        | Decisión                                                                                                                          | Aplicada en                                                                                                |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| D1 — Tipos en el picker   | Los tres: `tutor_legal_principal`, `tutor_legal_secundario`, `autorizado`. Coherente con `getTutoresParaAdminDireccion` (PR #32). | [get-vinculos-tutores-aula.ts](../../src/features/messaging/queries/get-vinculos-tutores-aula.ts)          |
| D2 — Priorización / orden | `pesoTipoVinculo`: principal=0, secundario=1, autorizado=2; dentro de cada grupo, alfabético por `nombre_completo`. Sort estable. | [EscribirAFamiliaAdminPicker.tsx](../../src/features/messaging/components/EscribirAFamiliaAdminPicker.tsx) |
| D3 — UI primitive         | `Dialog` (ya en uso). NO instalar Popover.                                                                                        | idem                                                                                                       |
| D4 — Nombre componente    | `EscribirAFamiliaAdminPicker`.                                                                                                    | idem                                                                                                       |
| D5 — Caso 0 tutores       | `<span role="link" aria-disabled="true" tabIndex={-1}>` con texto sr-only `picker_sin_tutores`. No oculto.                        | idem                                                                                                       |
| D6 — `ninoId` como prop   | Se conserva por simetría con el flujo profe + telemetría futura, no se transmite a la URL final.                                  | idem                                                                                                       |
| D7 — Ubicación query      | `src/features/messaging/queries/get-vinculos-tutores-aula.ts`.                                                                    | query nueva                                                                                                |
| D8 — i18n namespace       | Flat: `messages.admin_direccion.picker_*` extendiendo el del PR #32.                                                              | [messages/{es,en,va}.json](../../messages/es.json)                                                         |

## Comportamiento por número de tutores

| Caso                    | Render                                                                                                                                                                                                                                                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vinculos.length === 0` | `<span>` con `aria-disabled="true"`, sin `href`, `tabIndex={-1}`, clase visual idéntica al Link normal pero con `opacity-60` + `cursor-not-allowed`. Texto sr-only "Sin tutores con vínculo activo en este niño". `data-testid="escribir-familia-button"`.                                                       |
| `vinculos.length === 1` | `<Link>` directo a `/messages?tab=mensajeria&tutor=<usuario_id>`. Misma apariencia visual que el Link profe. `data-testid="escribir-familia-button"`.                                                                                                                                                            |
| `vinculos.length >= 2`  | `<Dialog>` con `<DialogTrigger render={<button>...</button>}>`. `DialogContent` contiene `<ul>` con cada tutor como `<button>` (`data-testid="picker-tutor-item-<id>"`) que ejecuta `router.push` y cierra el dialog. Badge con `tipo_vinculo`. `data-testid` del trigger es el mismo `escribir-familia-button`. |

## Datos disponibles vs por cargar

- `NinoAgendaResumen` NO se modifica.
- Query nueva `getVinculosTutoresAula(aulaId): Promise<Map<string, VinculoTutorMin[]>>` (server-only) con `*Core` testeable. Vive en `src/features/messaging/queries/get-vinculos-tutores-aula.ts`.
- `AulaListItem` recibe una columna nueva `centro_id: string` (sin ripple — no hay consumidores externos del tipo, solo inferencia). Permite al SSR llamar a `getRolEnCentro(aula.centro_id)` sin un segundo round-trip al servidor.
- La query solo se ejecuta para `rol === 'admin'`. Para profe, `Promise.resolve(undefined)` evita el IO.

## Integración

- `TeacherAulaPage` (SSR) determina `rol` con `getRolEnCentro(aula.centro_id)`. Paraleliza con `Promise.all` (Nota A del checkpoint B): `getAgendasAulaDelDia` y `getVinculosTutoresAula` (solo admin).
- `AgendaAulaCliente` recibe `rol` y `vinculosPorNino?: Map<string, VinculoTutorMin[]>` como props nuevas; las propaga a cada `NinoAgendaCard` (mapeando el id del niño).
- `NinoAgendaCard` recibe `rol` y `vinculos?: VinculoTutorMin[]`. Branch interno: `rol === 'admin'` → `<EscribirAFamiliaAdminPicker>`. Otros → `<Link>` legacy bit-a-bit (Nota D del checkpoint B).

## Tests

- **Vitest unit** ([**tests**/get-vinculos-tutores-aula.test.ts](../../src/features/messaging/queries/__tests__/get-vinculos-tutores-aula.test.ts)) — 6 casos del `*Core`: agrupación por `nino_id`, aula vacía, 3 tipos coexistiendo, errores en matriculas/vinculos → Map vacío, `nombre_completo` NULL fallback.
- **Vitest unit del componente** ([**tests**/EscribirAFamiliaAdminPicker.test.tsx](../../src/features/messaging/components/__tests__/EscribirAFamiliaAdminPicker.test.tsx)) — 6 casos: 0 tutores (aria-disabled + sr-only), 1 tutor (Link directo), 1 autorizado (también Link), ≥2 (Dialog abre + orden), navegación `router.push`, orden alfabético con mismo tipo.
- **Playwright E2E** bajo `test.skip` (gated por `E2E_REAL_SESSIONS=1`): admin abre `/teacher/aula/<E2E_AULA_ID>`, click en el primer "Escribir a la familia", verifica URL `?tab=mensajeria&tutor=<id>` y que el item del SplitView queda seleccionado. TODO sobre el seed multi-tutor para validar el caso Dialog.

## Riesgos / gotchas — confirmados sin sorpresas

- `vinculos.deleted_at != NULL` → filtrado con `.is('deleted_at', null)`.
- Niño sin tutores activos → caso 0 manejado.
- 30+ cards en el aula → 1 query agregada extra solo admin (~50-80ms). Sin N+1.
- iOS Safari + Dialog → el primitive `@base-ui/react/dialog` ya se usa en `MarcarErroneoButton`, validado en producción.
- `data-testid="escribir-familia-button"` se conserva en los tres casos (admin) y en el branch profe → tests E2E existentes no se rompen.

## Verificación

```bash
npm run typecheck
npm test
npm run build
```

Validación visual manual en preview Vercel — checklist en el body del PR.

## Follow-ups

- Helper `e2e/helpers/seed-aulas-multitutor.ts` para activar el caso Dialog del E2E.
- Activar los E2E reales de los PR #31, #32 y este #33 una vez exista el harness de seed.
- Si en el futuro se quiere un acceso directo desde el header de `/admin/ninos/[id]` (Opción B del Item 1 del PR #32), reusar el mismo `EscribirAFamiliaAdminPicker` con vínculos cargados en esa página.
