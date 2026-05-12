# ADR-XXXX: [Título corto y descriptivo de la decisión]

> Plantilla. Copia este archivo a `/docs/decisions/ADR-XXXX-[slug].md` (numeración correlativa, slug en kebab-case). Rellena las secciones y borra los comentarios en cursiva antes de marcar como `accepted`.

## Estado

`draft` | `proposed` | `accepted` | `deprecated` | `superseded by ADR-YYYY`

**Fecha:** YYYY-MM-DD
**Autores:** [nombre del responsable + claude-code si aplica]
**Fase del proyecto:** Fase X — [nombre fase]

## Contexto

_Describe el problema o la situación que requiere una decisión. ¿Qué fuerzas están en juego? ¿Qué restricciones existen? ¿Por qué hay que decidir ahora? Suficiente contexto para que alguien que llegue al proyecto en 6 meses entienda la situación sin tener que reconstruirla._

## Opciones consideradas

_Enumerar las alternativas evaluadas. Mínimo 2, idealmente 3-4. Una de ellas siempre es "no hacer nada / mantener el statu quo"._

### Opción A: [nombre]

_Descripción breve._

**Pros:**

- ...
- ...

**Contras:**

- ...
- ...

### Opción B: [nombre]

_Descripción breve._

**Pros:**

- ...
- ...

**Contras:**

- ...
- ...

### Opción C: [nombre]

...

## Decisión

_Una frase clara con la opción elegida. Después, 1-3 párrafos justificando por qué se elige sobre las otras. Citar criterios concretos, no opiniones vagas._

**Se elige la Opción [X] porque...**

## Consecuencias

### Positivas

- _Lo que esta decisión nos permite hacer._
- _Beneficios concretos._

### Negativas

- _Lo que dejamos de poder hacer o se vuelve más difícil._
- _Deuda técnica explícita aceptada._
- _Restricciones que aparecen._

### Neutras

- _Cambios de proceso, nuevos comandos a aprender, etc._

## Plan de implementación

_Pasos concretos para aplicar la decisión. Si es código, qué archivos tocar. Si es configuración, qué herramientas. Si es proceso, qué documentar._

- [ ] ...
- [ ] ...
- [ ] ...

## Verificación

_Cómo sabemos que la decisión está bien implementada. Tests, métricas, observaciones._

- ...

## Notas

_Cualquier detalle adicional, contexto histórico, citas a artículos, links a discusiones._

## Referencias

- Specs relacionadas: `/docs/specs/...`
- ADRs relacionados: ADR-YYYY, ADR-ZZZZ
- Issue / discusión: [link]
- Artículos / documentación externa: [link]

---

**Cómo se crea un ADR:**

1. Identificas una decisión arquitectónica que merece registro (no obvia, con tradeoffs, afecta a >1 feature, difícil de revertir).
2. Reservas el siguiente número correlativo libre en `/docs/decisions/`.
3. Copias este template, renombras a `ADR-XXXX-[slug].md`.
4. Rellenas con `status: draft`.
5. Si la decisión la propone Claude Code, lo marca como `proposed` y espera revisión.
6. Una vez aprobada, `status: accepted` con fecha.
7. Si más adelante se sustituye, `status: superseded by ADR-YYYY` y se enlaza ambos.
