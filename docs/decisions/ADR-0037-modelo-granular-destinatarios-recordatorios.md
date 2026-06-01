# ADR-0037: Modelo granular de destinatarios de recordatorios

## Estado

`accepted` — **supersedes ADR-0035**

**Fecha:** 2026-06-01
**Autores:** responsable + claude-code
**Fase del proyecto:** Fase 6 — Recordatorios (sub-fase F6-C-1)

## Contexto

F6-A/B entregaron recordatorios con un ENUM de 4 destinos (`familia` / `equipo` /
`direccion` / `personal`) y, tras el hotfix #44, admin/profe solo podían enviar a
"Familia" (todos los tutores de un niño) o "Personal". El piloto real exige
**granularidad fina**: enviar a una familia concreta, a todas las familias de un
aula, a todas las familias del centro, a una profesora concreta o a todas las
profesoras. El modelo de F6-A no lo soporta sin reescribir el ENUM, el CHECK
estructural y la RLS.

Además, la dirección "familia → centro" del modelo F6-A (destino `equipo`) no
encaja con el producto: en el MVP los **tutores no usan el módulo de creación**
(coherente con el hotfix #44). El nombre "bidireccional" de ADR-0035 queda como
legado histórico. F6-C redefine recordatorios como un canal **centro → familia +
interno admin → profe**, donde admin y profe son los únicos emisores y tutor /
autorizado **solo reciben** (push + badge + lista in-app).

## Opciones consideradas

### Opción A: Migrar el modelo F6-A con mapping incremental

Renombrar/mapear `equipo`/`direccion` a los nuevos destinos vía `ALTER TYPE` +
backfill.

**Pros:** preserva datos existentes.
**Contras:** un ENUM no se "renombra" sin recrearlo; `equipo`/`direccion` no
tienen equivalente limpio en la matriz nueva; complejidad alta para datos que son
de prueba (el piloto no ha arrancado).

### Opción B: Drop + recreate destructivo del modelo

`DROP TABLE … CASCADE` + `DROP TYPE`, recrear ENUM de 6 valores, tabla con
`aula_id`, RLS reescrita por la matriz, RPC de badge.

**Pros:** modelo limpio, sin deuda de mapping; `audit_log` (append-only) conserva
el histórico aunque se borre la tabla.
**Contras:** destructivo — si hubiera datos reales se pierden.

### Opción C: No hacer nada (mantener F6-A + hotfix #44)

**Contras:** no cumple los requisitos del piloto (granularidad). Descartada.

## Decisión

**Se elige la Opción B (drop + recreate destructivo) porque** el piloto no ha
arrancado y los datos de F6-A/B son de prueba (volumen ≈0, confirmado por el
responsable antes de aplicar). Mapear los destinos eliminados no aporta valor y un
ENUM requiere recreación de todas formas. El histórico queda preservado en
`audit_log`.

**Modelo nuevo:**

- ENUM `recordatorio_destinatario` con 6 valores: `familia_individual`,
  `familias_aula`, `familias_centro`, `profe_individual`, `profes_centro`,
  `personal`.
- Columna nueva `aula_id` (destino `familias_aula`). `usuario_destinatario_id`
  cubre `profe_individual` y `personal`. `familias_centro`/`profes_centro` no
  necesitan referencia extra (la lleva `centro_id`).
- CHECK estructural `recordatorios_destino_coherencia`: cada destino lleva
  exactamente su referencia y ninguna otra.

**Matriz de emisores (D9):**

| Destino              | admin | profe        | tutor/autorizado |
| -------------------- | ----- | ------------ | ---------------- |
| `familia_individual` | ✅    | ✅ (su niño) | ❌ (solo recibe) |
| `familias_aula`      | ✅    | ✅ (su aula) | ❌               |
| `familias_centro`    | ✅    | ❌           | ❌               |
| `profe_individual`   | ✅    | ❌           | ❌               |
| `profes_centro`      | ✅    | ❌           | ❌               |
| `personal`           | ✅    | ✅ (self)    | ❌               |

**Helpers SQL nuevos:** `es_tutor_en_aula(p_aula_id)` y
`es_profe_en_centro(p_centro_id)` (ambos `STABLE SECURITY DEFINER`, usan
`auth.uid()`). Se reutiliza `es_tutor_en_centro(p_tutor_id, p_centro_id)` de
F5.6-A invocándolo con `auth.uid()` explícito como primer argumento (su firma es
de 2 args; la spec lo describía con 1, reconciliado en implementación).

**Badge (D7):** RPC `contar_recordatorios_pendientes()` (`SECURITY DEFINER
STABLE`) que cuenta los pendientes donde el usuario es **destinatario directo**,
no por mera visibilidad RLS (un admin ve todo el centro pero no es destinatario de
los broadcasts que crea). Replica la matriz en SQL para evitar duplicar el
predicado en JS.

**Flag `puede_recibir_mensajes` en broadcasts:** para `familias_aula` /
`familias_centro` la **visibilidad** in-app (SELECT) sigue la **pertenencia**
(`es_tutor_en_aula`/`es_tutor_en_centro`), sin chequear el flag por niño
(intratable en RLS para multi-hijo). La **entrega push**
(`expandirDestinatariosRecordatorio`) **sí** respeta el flag por niño. Un tutor con
el flag desactivado puede ver un broadcast in-app pero no recibe push. Trade-off
aceptado.

## Consecuencias

### Positivas

- Granularidad completa que el piloto necesita.
- RLS coherente con el resto del proyecto (helpers `SECURITY DEFINER`, sin
  recursión, gotcha MVCC verificado como no-aplicable).
- Tutor recupera el acceso de lectura a `/reminders` (revierte el hotfix #44, que
  redirigía demasiado agresivamente), con badge de pendientes propio.

### Negativas

- Migración destructiva: si por error hubiera datos reales, se pierden. Mitigado
  por confirmación de volumen ≈0.
- Asimetría flag-push vs visibilidad en broadcasts (documentada arriba).
- La restricción de columnas (completar vs anular) y la ventana de 5 min de
  anulación siguen enforzadas en el server action, no en RLS (heredado de
  ADR-0036, sigue vigente).

### Neutras

- La migración se aplica manualmente vía Supabase SQL Editor (CLI con bug SIGILL
  en Penguin), patrón F5B/F6-A.
- `db:types` regenera desde el remoto; hasta aplicar la migración, `database.ts`
  se edita a mano para reflejar el esquema nuevo.

## Plan de implementación

- [x] Migración `20260601120000_phase6c_reminders_remodel.sql` (drop+recreate).
- [x] `database.ts` editado a mano (ENUM 6, `aula_id`, RPC, helpers).
- [x] Schemas, form-helpers, audiencia, action core reescritos.
- [x] Queries nuevas (`get-aulas-para-recordatorios`, `get-profes-para-recordatorios`,
      `contar-pendientes`) + action wrapper del badge.
- [x] `RecordatorioFormDialog` con selects condicionales niño/aula/profe.
- [x] `RecordatoriosBadge` + cableado en los 5 layouts.
- [x] Tutor lee `/reminders` sin botón crear (page + layout + sidebar).
- [x] i18n es/en/va (6 destinos + labels + badge).
- [x] Tests reescritos (unit cores 6 destinos, expandir 6 destinos + regresión
      push, RLS matriz completa, helpers).
- [ ] Aplicar la migración en SQL Editor (responsable, pre-merge).
- [ ] Validación visual + push end-to-end en device real.

## Verificación

- `typecheck` + `lint` + `build` (Regla #45) en verde.
- `test:unit` 378/378 en verde; `test:rls` gateado por
  `RECORDATORIOS_MIGRATION_APPLIED=1` (matriz completa + RPC + MVCC).
- Test de regresión push: `familia_individual` → resolver incluye al tutor con
  flag (nunca vacío).

## Notas

ADR-0036 (idempotencia al completar; ventana de anulación en el server action)
sigue vigente sin cambios. El nombre histórico "recordatorios bidireccionales"
queda como legado de ADR-0035.

## Referencias

- Specs relacionadas: `/docs/specs/reminders-c.md` (fuente de verdad),
  `/docs/specs/reminders.md` (F6-A, legado).
- ADRs relacionados: ADR-0035 (superado), ADR-0036 (vigente), ADR-0007 (recursión
  RLS), ADR-0031 (ventana de anulación 5 min).
