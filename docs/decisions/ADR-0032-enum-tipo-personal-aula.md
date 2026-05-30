# ADR-0032: ENUM `tipo_personal_aula` para clasificar el personal de aula

## Estado

`accepted`

**Fecha:** 2026-05-30
**Autores:** Jovi Mibimbi + claude-code (Opus 4.8)
**Fase del proyecto:** F5B — Cierre de Fase 5 (Item 3: personal de aula)

## Contexto

Hasta F5B, `profes_aulas` usaba el booleano `es_profe_principal` que solo distinguía **coordinadora** (`true`) de **profesora** (`false`). No había forma de diferenciar **técnicos** ni **personal de apoyo**: ambos caían bajo "profesora" o quedaban fuera del modelo.

El piloto de ANAIA requiere clasificar el tipo de personal de cada aula. Esa clasificación es transversal a tres áreas que llegan en fases siguientes:

- **Mensajería**: a quién se dirige un mensaje según su rol en el aula.
- **Informes** (F9): autoría y visibilidad según tipo de personal.
- **Permisos futuros**: granularidad por tipo de personal sin re-modelar.

Hay que decidir ahora porque el cambio toca el esquema de `profes_aulas` (una tabla Core) y el resto del Item 3 (tabla `/admin/aulas` enriquecida, ADR-0033) depende de poder leer el tipo de cada miembro del personal.

## Opciones consideradas

### Opción A: ENUM Postgres `tipo_personal_aula` (4 valores)

Introducir `CREATE TYPE tipo_personal_aula AS ENUM ('coordinadora', 'profesora', 'tecnico', 'apoyo')` y una columna del mismo nombre en `profes_aulas`. Backfill desde el booleano: `es_profe_principal = true → 'coordinadora'`, `false → 'profesora'`. El booleano `es_profe_principal` queda **deprecated** un sprint y se elimina en un PR posterior.

**Pros:**

- Validación a nivel BD: solo los 4 valores son insertables. Sin strings libres mal escritos.
- Queries agregadas triviales (`GROUP BY tipo_personal_aula`, filtros por tipo).
- Coherente con el patrón ENUM ya establecido en el proyecto para columnas de valores fijos (ver lista de ENUMs en `data-model.md`).
- Extensible sin migración mayor: `ALTER TYPE ... ADD VALUE` añade un valor nuevo.
- Permite el índice único parcial "1 coordinadora activa por aula" de forma legible (`WHERE tipo_personal_aula='coordinadora' AND fecha_fin IS NULL`).

**Contras:**

- `ALTER TYPE ADD VALUE` no se puede ejecutar dentro de un bloque transacción en algunas versiones; añadir/renombrar valores tiene fricción. Aceptable: los 4 valores son estables.
- Migración manual obligada por el bug `SIGILL` del CLI de Supabase en este Chromebook (workaround vía SQL Editor, igual que el resto de F5).

### Opción B: Mantener el booleano + columna de texto libre

Conservar `es_profe_principal` y añadir una columna `texto` descriptiva del rol.

**Pros:**

- Cambio mínimo de esquema.

**Contras:**

- Sin validación: "tecnico", "Técnico", "técnico " conviven y rompen agregaciones.
- Queries por tipo se vuelven frágiles (normalización en cada consulta).
- No expresa la jerarquía ni habilita el índice único de coordinadora limpio.

### Opción C: Tabla separada `tipos_personal` referenciada por FK

Normalizar los tipos en su propia tabla y referenciarlos con una FK desde `profes_aulas`.

**Pros:**

- Permitiría metadatos por tipo (descripción, orden, permisos por defecto).

**Contras:**

- Overkill para 4 valores estables y sin metadatos asociados hoy.
- Añade un JOIN a cada lectura del personal de aula sin contraprestación.

### Opción D: Statu quo (mantener solo `es_profe_principal`)

No cambiar nada.

**Contras:**

- No cubre el requisito del piloto: técnicos y apoyo quedan sin representar.

## Decisión

**Se elige la Opción A: ENUM `tipo_personal_aula` con 4 valores (`coordinadora`, `profesora`, `tecnico`, `apoyo`).**

La validación a nivel BD, las queries agregadas simples y la coherencia con el patrón ENUM ya usado en el proyecto pesan más que la fricción de `ALTER TYPE`. La tabla separada (C) es overkill para 4 valores sin metadatos, y el texto libre (B) renuncia a la validación que es justamente el motivo del cambio.

Backfill determinista desde el booleano: `es_profe_principal = true → 'coordinadora'`, `false → 'profesora'`. El booleano queda **deprecated en BD** un sprint (para no romper lecturas en vuelo) y se elimina en un PR posterior tras un sprint en producción. Índice único parcial garantiza **una sola coordinadora activa por aula** (`(aula_id) WHERE tipo_personal_aula='coordinadora' AND fecha_fin IS NULL`).

Migración aplicada manualmente vía Supabase SQL Editor (bug `SIGILL` del CLI en este Chromebook, mismo workaround que F5).

## Consecuencias

### Positivas

- Modelo de personal expresivo (coordinadora/profesora/técnico/apoyo) que habilita mensajería, informes y permisos futuros sin re-modelar.
- Índice único parcial de coordinadora legible y enforced en BD.
- `ALTER TYPE ADD VALUE` permite crecer (p.ej. "voluntario") sin migración mayor.

### Negativas

- Cambio de esquema en una tabla Core (`profes_aulas`): migración manual, regeneración de `src/types/database.ts`, ajuste de la action `asignarProfeAula` y de las queries que leen el personal.
- Deuda técnica explícita y temporal: `es_profe_principal` queda en BD como columna muerta hasta el PR de drop (un sprint).

### Neutras

- Nuevo valor de ENUM en la lista de `data-model.md`. Las lecturas del personal pasan a usar `tipo_personal_aula`.

## Referencias

- Origen: PR #34 — `feat(aulas): tipo_personal_aula ENUM + backend (Item 3 B1+B2)`.
- Migración: [supabase/migrations/20260529193000_phase5b_tipo_personal_aula.sql](../../supabase/migrations/20260529193000_phase5b_tipo_personal_aula.sql)
- Action: [src/features/profes-aulas/actions/asignar-profe-aula.ts](../../src/features/profes-aulas/actions/asignar-profe-aula.ts)
- Consumidor de la clasificación: ADR-0033 (tabla `/admin/aulas` enriquecida).
- Modelo de datos: [docs/architecture/data-model.md](../architecture/data-model.md) (constraint "1 coordinadora activa por aula").
