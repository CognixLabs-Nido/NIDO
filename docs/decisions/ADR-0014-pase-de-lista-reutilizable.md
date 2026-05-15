# ADR-0014: Componente "Pase de Lista" reutilizable

## Estado

`accepted`

**Fecha:** 2026-05-15
**Autores:** jovimib + claude-code
**Fase del proyecto:** Fase 4 — Asistencia y ausencias

## Contexto

Fase 4 implementa el "pase de lista" diario: la profe ve a todos los niños matriculados activos en su aula y marca su estado (`presente`/`ausente`/`llegada_tarde`/`salida_temprana`) en una tabla. La interacción tiene un patrón muy concreto:

- Una fila por entidad (niño matriculado activo).
- Varias columnas con inputs heterogéneos: radio para el estado, time para llegada/salida, text para observaciones.
- Visibilidad condicional por columna (la hora de salida solo aparece si el estado es `salida_temprana`).
- Quick actions a nivel tabla ("Todos presentes" pre-marca a todos los pendientes).
- Submit batch: solo se envían las filas tocadas, no todo el aula.
- Tracking visual por fila (pendiente / sin guardar / guardando / guardado / error).

Mirando el roadmap de Ola 1, este mismo patrón aparece **al menos dos veces más**:

- **Fase 4.5 (menús)**: la profe registra qué comió cada niño (`todo`/`mayoría`/`mitad`/`poco`/`nada`) en una tabla idéntica.
- **Fase 7 (eventos)**: el admin confirma asistencia a un evento (excursión, jornada de puertas abiertas) con un radio `confirma`/`rechaza`/`no_responde` por niño.

Las tres pantallas tienen la misma estructura. Implementarlas como tres componentes separados duplicaría el state local (Map de rowId → RowState, dirty tracking, errores Zod por celda, batch submit) y nos dejaría con tres divergencias inevitables a la hora de aplicar mejoras (accesibilidad, atajos de teclado, virtualización si crece el aula).

Las decisiones cerradas que afectan a este ADR:

- F4 marca asistencia con upsert batch (no creación lazy de filas por adelantado, ver ADR-0015).
- La validación cliente vive en Zod por columna, no en cada componente input.
- Las quick actions solo aplican a filas "limpias" por defecto (no pisan trabajo ya editado).

## Opciones consideradas

### Opción A: Tres componentes separados sin abstracción

Cada feature (`asistencia`, `comida`, `confirmaciones-evento`) construye su propia tabla con state local ad-hoc.

**Pros:**

- Cero acoplamiento. Cada equipo evoluciona su pantalla sin coordinar.
- Menos código upfront (no hay que diseñar una abstracción).

**Contras:**

- 3× el código de tracking de state, dirty, errores, batch submit.
- 3× las pruebas de "no se envían filas no tocadas", "errores Zod se pintan en la celda", etc.
- Inevitable divergencia: una pantalla acaba con atajos de teclado, otra con virtualización, otra ni con loading state.
- Mejoras transversales (accesibilidad ARIA roles, focus management) hay que hacerlas tres veces.

### Opción B: Hook compartido + tres componentes de UI

Extraer solo el state (`usePaseDeListaForm`) y dejar el render a cada feature.

**Pros:**

- Menos riesgo de "abstracción equivocada": la lógica es la parte estable, el render puede divergir.
- Cada feature puede pintar la tabla a su gusto (mobile cards vs desktop table).

**Contras:**

- Las tres pantallas terminan pareciéndose muchísimo en HTML/CSS y se vuelve un copy-paste.
- Las pruebas E2E ven tres data-testid diferentes para los mismos conceptos (cell, submit, status).
- El usuario no percibe consistencia: la "experiencia pase de lista" varía entre tabs.

### Opción C: Componente reutilizable `<PaseDeListaTable />` + hook interno

Un componente genérico parametrizado por `TItem` (entidad de la fila) y `TValue` (objeto con valores de columnas). API:

```tsx
<PaseDeListaTable
  items={[{ id, item, initial, badges? }]}
  renderItem={(item) => <span>...</span>}
  columns={[{ id, label, type: 'radio'|'time'|'text-short'|'select'|'enum-badges', options?, zod?, visibleWhen?, width? }]}
  quickActions={[{ id, label, apply: (current) => patch, onlyClean? }]}
  onBatchSubmit={async (rows) => ({ success, error? })}
  readOnly={diaCerrado}
  submitLabel={t('guardar')}
  i18n={{ pending, dirty, saved, errorRow }}
  renderRowExtra?={(item, value) => ReactNode}
/>
```

El hook `usePaseDeListaForm` vive **dentro** del componente, no es API pública. El componente owns el grid CSS, las celdas, los badges de status, el botón submit.

**Pros:**

- Una implementación, un set de tests unitarios, una experiencia consistente entre F4/F4.5/F7.
- Mejoras (a11y, virtualización, atajos) se aplican una sola vez.
- La API es estrecha — basta con definir `columns` y `onBatchSubmit` para tener una pantalla funcional.
- Genericidad por TypeScript (TItem, TValue), no por casting o `any`.

**Contras:**

- Riesgo de "abstracción prematura": F4 es el único caso real hoy, F4.5 y F7 no están implementadas todavía y la API podría no encajar al 100%.
- La superficie genérica añade ~250 líneas de tipos + render. Esfuerzo upfront.
- Cada nuevo tipo de input (e.g. `enum-badges` para F4.5) requiere ampliar el discriminated union, no es plug-and-play.

## Decisión

**Se elige la Opción C** porque las tres pantallas que tenemos previstas son **estructuralmente idénticas** y la diferencia es solo en las columnas y el shape del valor. La superficie genérica que añadimos (`PaseDeListaColumn` con `type`/`options`/`zod`/`visibleWhen`, `PaseDeListaQuickAction` con `apply`/`onlyClean`) es justo lo mínimo para cubrir F4 sin condicionales internos por feature.

El riesgo de "abstracción prematura" se mitiga así:

- Los tipos de columna (`radio`, `time`, `text-short`, `select`, `enum-badges`) son un union cerrado: si F4.5 necesita uno nuevo, se amplía conscientemente.
- El componente no asume nada sobre el shape de `TValue` más allá de "objeto plano" — cada feature inyecta su Zod.
- `renderItem` permite cada feature pintar su entidad (niño con avatar, niño con badges médicos, evento con fecha) sin meter esa lógica en el genérico.

## Consecuencias

### Positivas

- 1 sola implementación para 3 features previstas.
- Cualquier mejora (accesibilidad, atajos teclado, virtualización para aulas grandes, mejor renderizado mobile) se aplica una vez.
- E2E tests usan los mismos data-testid (`pase-cell-*`, `pase-submit`, `pase-status-*`) en todas las pantallas.

### Negativas

- 250+ líneas de tipos + render genérico ahora, antes de tener confirmados los casos F4.5/F7.
- Si la abstracción se queda corta para F4.5 (ej. necesitamos columnas multi-celda), habrá que ampliarla con cuidado para no romper F4.
- Genericidad TypeScript exige `TValue extends Record<string, unknown>` — las llamadas en cada feature usan intersección con `Record<string, unknown>` para encajar.

### Neutras

- Nuevo directorio `src/shared/components/pase-de-lista/` con `types.ts`, `usePaseDeListaForm.ts`, `PaseDeListaTable.tsx`, `__tests__/PaseDeListaTable.test.tsx`.
- 10 tests unitarios en el componente cubren render + interacción + submit + saved + readOnly + visibleWhen + badges. Refactors futuros tocan estos tests, no los de cada feature.

## Plan de implementación

- [x] `src/shared/components/pase-de-lista/types.ts` con `PaseDeListaColumn<TValue>`, `PaseDeListaQuickAction<TValue>`, `PaseDeListaItem<TItem, TValue>`, `PaseDeListaTableProps<TItem, TValue>`, `RowState<TValue>`, `RowStatus`.
- [x] `usePaseDeListaForm.ts`: Map<rowId, RowState> con O(1) mutaciones; `setValue`, `applyQuickAction`, `validate` (solo filas dirty), `collectDirty`, `markStatus`, `setRowError`, `reset`.
- [x] `PaseDeListaTable.tsx`: grid CSS dinámico, 5 tipos de input, badges de status, readOnly, submit batch.
- [x] 10 tests unitarios.
- [x] Primera adopción en `src/features/asistencia/components/PaseDeListaCliente.tsx`.
- [ ] Adoptar en F4.5 (menú) — futura.
- [ ] Adoptar en F7 (confirmaciones evento) — futura.

## Verificación

- Tests unitarios verdes en `src/shared/components/pase-de-lista/__tests__/PaseDeListaTable.test.tsx`.
- F4 lo usa en `/teacher/aula/[id]/asistencia`. Auto-link de ausencias funciona vía `initial`+`badges`.
- API estrecha: nuevo caso de uso debería poder integrarse sin tocar el componente, solo `columns` + `onBatchSubmit`.

## Notas

La decisión de **NO** exponer `usePaseDeListaForm` como API pública es intencional: queremos que la pantalla "pase de lista" se vea igual en todas las features. Si una feature necesita un render radicalmente distinto (mobile cards en vez de tabla), eso se discute primero — quizá basta con un breakpoint Tailwind, quizá hay que extraer un `<PaseDeListaCards />` que comparta el hook. Pero esa decisión la tomamos cuando llegue.

## Referencias

- Specs: `/docs/specs/attendance.md`
- ADRs relacionados: ADR-0008 (design system), ADR-0015 (asistencia lazy)
