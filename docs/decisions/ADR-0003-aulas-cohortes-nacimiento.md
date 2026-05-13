# ADR-0003: Aulas clasificadas por cohorte de nacimiento (array de años)

## Estado

`accepted`

**Fecha:** 2026-05-13
**Autores:** Iker Milla, claude-code
**Fase del proyecto:** Fase 2 — Entidades core

## Contexto

NIDO arranca con la escuela ANAIA, que organiza sus aulas siguiendo cohortes de nacimiento (todos los niños del año X juntos), no rangos de edad fijos. Las 5 aulas iniciales son:

| Aula           | Cohorte de nacimiento |
| -------------- | --------------------- |
| Sea            | {2026, 2027}          |
| Farm big       | {2025}                |
| Farm little    | {2025}                |
| Sabanna big    | {2024}                |
| Sabanna little | {2024}                |

Tenemos que decidir cómo modelar la "edad para entrar en este aula" a nivel de BD. Las opciones obvias son: rango de edad numérico (mín/máx en años o meses), año único, o cohortes como array. Como esta decisión condiciona el resto del modelo (matriculas, validación de admisión, futuras agendas), conviene cerrarla bien.

## Opciones consideradas

### Opción A: `cohorte_anos_nacimiento int[]` (elegida)

Columna `int[]` que lista años de nacimiento permitidos. Por ejemplo `{2025}` o `{2026, 2027}`. CHECK constraint que limita longitud (1–5) y rango razonable (2020–2030).

**Pros:**

- Modela exactamente la realidad de ANAIA: aulas con cohortes mixtas existen (Sea) y aulas con un único año también (Farm/Sabanna).
- Permite que un aula crezca con sus niños sin renombrarla: el aula "Sea" pasa de `{2026, 2027}` a `{2027}` cuando los nacidos en 2026 se mueven al curso siguiente.
- Validación al matricular es trivial: `año_nacimiento ∈ aula.cohorte_anos_nacimiento`.
- Compatible con escuelas que mezclan ciclos: si una escuela futura usa "ciclo 1-2" como "todos los nacidos en 2024 y 2025", el array lo expresa sin remodelar.

**Contras:**

- Las queries de "qué aula corresponde a un niño nacido en X" requieren operador `ANY` o `=`, un poco menos legible que un rango.
- El array_length necesita CHECK constraint para evitar arrays infinitos.

### Opción B: Rango de edad en meses (`edad_min_meses`, `edad_max_meses`)

Cada aula define un rango de edad en meses. La validación compara `today - fecha_nacimiento` con el rango.

**Pros:**

- Modelo continuo, similar a guarderías que clasifican por edad real (lactantes 0-12 meses, caminadores 12-24, etc.).
- Independiente del año natural.

**Contras:**

- No refleja la realidad de ANAIA. Las cohortes están explícitamente atadas al año natural (los niños cambian de aula en septiembre, no al cumplir X meses).
- Genera anomalías: un niño nacido en diciembre y otro en enero del mismo año natural caerían en aulas distintas si la frontera es por meses, aunque conceptualmente sean de la misma cohorte.
- Requiere recalcular la edad continuamente: queries para "qué niños hay en este aula" se vuelven costosas o se denormalizan.

### Opción C: Año único (`anio_cohorte int`)

Cada aula tiene un único año de nacimiento.

**Pros:**

- Simplicidad máxima.
- Queries triviales.

**Contras:**

- No cubre Sea (necesita {2026, 2027}). Habría que crear dos aulas físicas para una única real, perdiendo la identidad de "Sea".
- Limita el modelo: si una escuela tiene un aula multi-cohorte, no se puede expresar.
- Migración futura sería costosa cuando aparezca el primer caso multi-cohorte.

### Opción D: Tabla relacional `aula_cohortes (aula_id, anio)`

Normalizar el array a una tabla M:N.

**Pros:**

- Normalizada (1NF estricto, sin arrays).
- Permite añadir metadatos por cohorte (nº niños esperados, fecha de transición, etc.).

**Contras:**

- Sobrediseño: en Ola 1 no necesitamos metadatos por cohorte.
- Triplica las queries: para listar aulas con sus cohortes hay que hacer JOIN o subquery.
- Postgres tiene buen soporte para `int[]` con índices GIN si llegara a hacer falta; mientras tanto el array es ergonómico.

## Decisión

**Se elige la Opción A: `cohorte_anos_nacimiento int[]`** con CHECK constraints:

```sql
cohorte_anos_nacimiento int[] NOT NULL CHECK (
  array_length(cohorte_anos_nacimiento, 1) BETWEEN 1 AND 5
  AND 2020 <= ALL (cohorte_anos_nacimiento)
  AND 2030 >= ALL (cohorte_anos_nacimiento)
)
```

El rango 2020-2030 cubre Ola 1 con margen (la app vive a partir de 2026; un niño de 3 años nació como muy tarde en 2023, y los más nuevos están naciendo en 2026/2027). Cuando 2030 quede atrás, ampliamos el rango con una migración trivial.

La longitud máxima de 5 años evita arrays patológicos (un aula con 10 cohortes es señal de mala configuración).

## Consecuencias

### Positivas

- El admin escribe en la UI exactamente lo que cuenta a una madre en la matriculación: "este aula es para los nacidos en 2025".
- Validación de matriculación se reduce a una intersección de arrays.
- La transición de aulas curso a curso es solo "edita el array" del aula, no requiere crear nuevas aulas.

### Negativas

- Los devs que vengan con experiencia en sistemas tipo "edad en meses" tienen que cambiar el modelo mental.
- Queries más sofisticadas (e.g. "aulas que cubren al menos un año entre 2024 y 2026") usan operadores de array (`&&`, `@>`) que son menos comunes.

### Neutras

- El helper `fechaEnCohorte(fecha_nacimiento, cohorte[])` se comparte cliente/servidor en `src/features/aulas/schemas/aula.ts`.
- Si en Ola 2 aparece la necesidad de metadatos por cohorte, se puede pasar a la Opción D sin pérdida — el array seguiría siendo la fuente de verdad, y la tabla relacional solo añadiría detalle.

## Plan de implementación

- [x] Columna `int[]` con CHECK constraints en `aulas` (`supabase/migrations/20260513202012_phase2_core_entities.sql`).
- [x] Helper `fechaEnCohorte` compartido cliente/servidor.
- [x] Wizard de creación de niño valida cohorte y pide confirmación explícita si el año no coincide (caso del hermano que entra a mitad de curso).
- [x] Seed de ANAIA con las 5 aulas y sus cohortes correctas.

## Verificación

- Tests Vitest del schema `aulaSchema` cubren cohorte vacía, año fuera de rango, capacidad fuera.
- Test E2E manual: crear aula desde `/admin/aulas` con multi-select de años funciona.
- La fila de ANAIA en la migración crea las 5 aulas con cohortes correctas.

## Notas

Esta decisión es específica de Ola 1 con una sola escuela. Si NIDO atrae escuelas con modelos pedagógicos distintos (Montessori multi-edad, Reggio, etc.), el `int[]` ya cubre el caso "multi-cohorte" sin cambios.

## Referencias

- Spec: `docs/specs/core-entities.md` (B11)
- Migración: `supabase/migrations/20260513202012_phase2_core_entities.sql`
- Helper compartido: `src/features/aulas/schemas/aula.ts`
