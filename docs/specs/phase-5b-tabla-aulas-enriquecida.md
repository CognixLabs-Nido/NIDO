---
feature: admin-aulas-tabla-enriquecida
wave: 1
status: implemented
priority: high
last_updated: 2026-05-30
related_specs: ['phase-5b-tipo-personal-aula.md', 'phase-5b-nino-agenda-admin-escribir-familia.md']
related_adrs: []
---

# Spec F5B #36 — Tabla `/admin/aulas` enriquecida (B3)

## Resumen ejecutivo

Conecta la query `getAulasConPersonal` (PR #34) a la UI `/admin/aulas`. La
tabla pasa de 4 a **7 columnas** (Nombre · Año nacimiento · Capacidad ·
Nº alumnos · Profesoras · Técnicos · Descripción). Coordinadora se
distingue con `Badge variant="warm"` y `title` (tooltip). Sin migración
SQL, sin cambio de tipos BD, sin tocar `'use server'`.

## Decisiones cerradas

| ID  | Decisión                                                                                                                                       | Aplicada en                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| D1  | Mantener `getAulasPorCurso` para wizard de nuevo niño; solo `/admin/aulas` migra a `getAulasConPersonal`.                                      | [page.tsx](../../src/app/[locale]/admin/aulas/page.tsx)              |
| D2  | Omitir columna **Apoyos**. ANAIA no tiene apoyos hoy.                                                                                          | idem                                                                 |
| D3  | Coordinadora: `Badge variant="warm"` + `title={label_coordinadora}`. Profesoras y técnicos `variant="secondary"`. Orden garantizado por query. | [TablaAulas.tsx](../../src/features/aulas/components/TablaAulas.tsx) |
| D4  | NO tocar `NuevaAulaDialog` — solo crea aulas, no asigna profes.                                                                                | idem                                                                 |
| D5  | Headers plural (`Profesoras`, `Técnicos`).                                                                                                     | i18n                                                                 |
| D6  | Badges verticales (`flex-col gap-1`).                                                                                                          | TablaAulas                                                           |
| D7  | TODOs VA al lado de cada `t('admin.aulas.personal.tipo.*')` en el componente, no en JSON.                                                      | page.tsx                                                             |

## Render por columna

| Col | Header                                                      | Valor                                                                |
| --- | ----------------------------------------------------------- | -------------------------------------------------------------------- |
| 1   | Nombre                                                      | `<Link data-testid="admin-aula-link-${id}">…</Link>`                 |
| 2   | Año nacimiento (key renombrada `cohorte → anio_nacimiento`) | `<Badge variant="warm">{anio}</Badge>` ×N                            |
| 3   | Capacidad máxima                                            | `{capacidad_maxima}`                                                 |
| 4   | Nº alumnos                                                  | `{num_alumnos}` (incluye `0`)                                        |
| 5   | Profesoras                                                  | stack vertical; coordinadora `warm` + tooltip, profesora `secondary` |
| 6   | Técnicos                                                    | stack vertical `secondary`, `—` si vacío                             |
| 7   | Descripción                                                 | `{descripcion ?? '—'}`                                               |

## i18n — cambios concretos

### Rename (3 archivos)

- `admin.aulas.fields.cohorte` → `admin.aulas.fields.anio_nacimiento` (es/en/va).

### Nuevas keys (3 archivos)

- `admin.aulas.fields.num_alumnos`, `profesoras`, `tecnicos`.
- `admin.aulas.personal.tipo.{coordinadora,profesora,tecnico,apoyo}`.
- `admin.aulas.personal.label_coordinadora`.

VA: las traducciones quedan en el JSON; los `TODO(F5B#36): confirmar VA`
viven en el componente (decisión D7 — los JSON puros no admiten
comentarios y el linter los rechazaría).

## Tests

- **Componente** ([**tests**/TablaAulas.test.tsx](../../src/features/aulas/components/__tests__/TablaAulas.test.tsx))
  — 6 casos: 7 columnas en orden, aula sin personal (`—` + `0`),
  coordinadora con warm+tooltip y orden, num_alumnos=0 muestra `0`,
  preserva `data-testid`, multi-aula.
- **i18n consistency** ([**tests**/aulas-keys.test.ts](../../src/test/i18n/aulas-keys.test.ts))
  — verifica rename completo en es/en/va y todas las nuevas keys
  pobladas (no compara textos VA, solo no-vacíos).
- **Playwright E2E** bajo `test.skip` gated por `E2E_REAL_SESSIONS=1`
  — valida headers en orden y `data-testid` preservado en producción.

## Riesgos / gotchas — confirmados sin sorpresas

- **Overflow mobile**: `<div className="overflow-x-auto">` envuelve la tabla.
- **Cache SW**: `public/sw.js` es solo push notifications (F5.5), no cachea
  assets — el rename de i18n no se ve afectado.
- **data-testid**: `admin-aula-link-${id}` preservado literal en celda Nombre.
- **Posible duplicidad cromática warm**: el badge de Coordinadora usa la
  misma variant que los badges de Año nacimiento. El usuario lo valida
  manualmente en preview Vercel (checklist en PR body).

## Verificación

```bash
npm run typecheck
npm test
npm run build
```

Validación visual manual en preview Vercel — checklist en el body del PR.

## Fuera de scope

- UI de asignar profe a aula con `<Select tipo_personal_aula>` (PR futuro).
- `DROP COLUMN es_profe_principal` (PR posterior tras 1 sprint).
- Columna Apoyos (cuando aparezca el primer apoyo en ANAIA).
- Confirmar traducciones VA con usuario.
