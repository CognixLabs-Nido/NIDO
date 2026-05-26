# ADR-0026: Mensajería UI tipo WhatsApp con split-view por rol

## Estado

`accepted`

**Fecha:** 2026-05-26
**Autores:** jovimib + claude-code
**Fase del proyecto:** Hotfix post-Fase 5 (`fix/phase-5-ui-and-admin-perms`)

## Contexto

Tras mergear la Fase 5 (#16) y el hotfix Realtime (#17) llegaron a producción cinco bugs serios en la capa de UI que impedían el uso real del módulo de mensajería:

- **Bug 1 — Form del tutor no enviaba mensaje:** el botón de envío no disparaba la petición desde la ficha del niño. Causa raíz ambigua entre `<Button>` sin `type` explícito (interpretado como submit silencioso dentro de un form ancestro) y handler colgado de `onClick` en lugar de `<form onSubmit>`.
- **Bug 2 — Sin botón "Escribir a la familia" en la vista profe:** la ficha del niño existía solo en `/admin/ninos/[id]` y `/family/nino/[id]`. La profe veía la lista de niños del aula desde `/teacher/aula/[id]` pero sin ningún botón para abrir conversación.
- **Bug 3 — `/messages` infrauso:** la primera versión renderizaba dos pestañas (Conversaciones / Anuncios) como listas planas. Para una profe con 15-25 niños, abrir una conversación significaba ir a `/messages`, scroll, click, y luego volver para abrir otra. Sin sensación de "bandeja activa".
- **Bug 4 — `Select.Root` mostraba UUID al cerrar:** regresión del patrón ya documentado en F2/F4 (ADR-0007). El composer de anuncio no pasaba prop `items` al Select de aula.
- **Bug 5 — Admin no podía publicar anuncios en aulas del centro:** el usuario reportaba "No tienes acceso". Investigación mostró que la policy de BD ya cubría a admin (`es_admin(centro_id) OR ...`), pero `getRolEnCentro()` devolvía un rol arbitrario para usuarios con doble rol (admin + profe), lo que confundía a la UI y al composer.

El responsable definió el modelo de UI definitivo a aplicar: **estilo WhatsApp con split-view por rol** y dropdowns con `items` obligatorio. Esta ADR formaliza la decisión.

## Opciones consideradas

### Opción A: Mantener el listado plano de F5 y arreglar solo los 5 bugs

Reescribir el form del tutor, añadir botón en la ficha del niño, parchear `Select.Root`, mejorar permisos. La pestaña Conversaciones seguiría siendo una lista de "conversaciones existentes".

**Pros:**

- Cambio mínimo. Diff acotado.
- Compatible con la query `getConversacionesDelUsuario()` ya existente.

**Contras:**

- No resuelve la usabilidad: una profe con 20 niños tiene que ir y volver de la lista.
- "Iniciar conversación" sigue requiriendo navegar a la ficha del niño. La barrera de entrada hace que las conversaciones nuevas casi nunca arranquen.
- La lista de conversaciones existentes oculta los niños SIN conversación: la profe no ve a quién aún no ha escrito.

### Opción B: Split-view WhatsApp-style por rol (decisión elegida)

`/messages` rediseñado:

- **Admin:** solo pestaña Anuncios (decisión F5 — admin no participa en conversaciones).
- **Profe / Tutor:** dos pestañas. La de Conversaciones es un split-view con la lista de niños accesibles a la izquierda y el panel de conversación a la derecha. Si el niño no tiene conversación todavía, el panel derecho muestra empty state + composer en modo "iniciar".

URL semántica: `/messages?nino=<id>` selecciona un niño. Deep-link compartible.

**Pros:**

- Coincide con el patrón mental que las familias y profes ya tienen (WhatsApp).
- Niños sin conversación se ven a primer vistazo → más fácil arrancar.
- Composer siempre disponible. La conversación se crea on-demand al enviar el primer mensaje (mismo patrón lazy que ya tenía la BD).
- Mobile: una vista a la vez con botón "← volver", sin perder funcionalidad.
- Permite poner el badge "no leídos" por niño en la lista, no solo por conversación.

**Contras:**

- Más código nuevo (`MessagesView`, `ConversacionesSplitView`, query `getNinosMensajeriaParaUsuario`).
- Requiere reescribir la página principal `/messages/page.tsx`.
- La página antigua `/messages/conversacion/[id]` queda como deep-link de respaldo.

### Opción C: Conversación inline en la ficha del niño

Eliminar `/messages` para profe/tutor y poner la conversación dentro de la ficha del niño (admin / family / teacher).

**Pros:**

- Aún más contextual: estás viendo al niño y, en la misma página, puedes escribir.

**Contras:**

- Multiplica el contenido de la ficha del niño (agenda + ausencias + médico + pedagógico + mensajes + ...).
- Mensajes deja de ser un canal "primero", se vuelve secundario.
- No hay un único sitio con "todas mis conversaciones". El badge global pierde sentido.

## Decisión

**Se elige la Opción B** porque resuelve los tres problemas reales:

1. Visibilidad de niños sin conversación (= barrera de entrada baja).
2. Sensación de "bandeja activa" (= se siente como WhatsApp).
3. Mobile-first compatible (= NIDO es PWA en móvil principalmente).

La Opción A no aborda la usabilidad. La Opción C dispersa el módulo de mensajería y rompe el badge global.

Decisiones secundarias incluidas en esta ADR:

- **`getRolEnCentro` prioriza admin > profe > tutor_legal > autorizado** cuando un usuario tiene varios roles activos. El `limit(1)` anterior daba resultados arbitrarios y enmascaraba la causa real de Bug 5 (la policy de BD nunca rechazaba al admin, era la UI la que mostraba opciones equivocadas).
- **`Select.Root` con prop `items` se eleva a regla NO negociable** en `docs/dev-setup.md`. Tercera regresión del mismo patrón en tres fases distintas → bloqueante en PR review.
- **Composer de mensaje siempre dentro de `<form onSubmit>`** con botón `type="submit"` explícito, sin excepciones. Test unitario obligatorio para cada composer nuevo.

## Consecuencias

### Positivas

- UX coherente con WhatsApp/Telegram: cero curva de aprendizaje para familias.
- Niños sin conversación visibles en la lista → arranque de conversaciones más natural.
- Deep-link por `?nino=<id>` compartible y compatible con el botón "Escribir a la familia" desde la ficha del niño.
- Badge global de no leídos se mantiene en su sitio (sidebar).
- Componentes cliente con form `<form onSubmit>` + `type="submit"` evitan toda una clase de bugs de submit silencioso para futuras features.

### Negativas

- Una capa más de componentes: `MessagesView` (rol-aware) + `ConversacionesSplitView` (split-view) + `MensajeComposer` (composer). El árbol de imports se alarga.
- La query `getNinosMensajeriaParaUsuario` hace varios roundtrips (vínculos / matrículas / mensajes / lecturas). Para ANAIA (<50 niños activos) sobra; en multi-centro habrá que moverla a una RPC SQL.
- La página `/messages/conversacion/[id]` y `/messages/nino/[ninoId]` quedan como deep-links de respaldo (la segunda redirige a `?nino=<id>`). Más rutas a mantener.

### Neutras

- Las traducciones se enriquecen con un sub-namespace `messages.split.*` en `es`/`en`/`va`.
- La página antigua `MessagesListView.tsx` se borra. Cualquier referencia externa habría sido detectada por typecheck.

## Plan de implementación

- [x] Nueva query `getNinosMensajeriaParaUsuario(centroId, rol)`.
- [x] Componente cliente `ConversacionesSplitView` con sidebar + panel + Realtime + auto-marca-leído.
- [x] Componente cliente `MessagesView` orquesta tabs + admin-only-anuncios.
- [x] Reescribir `/messages/page.tsx` para SSR del niño seleccionado (`?nino=<id>`).
- [x] `/messages/nino/[ninoId]` redirige a `/messages?nino=<id>`.
- [x] `MensajeComposer`: `<form onSubmit>` + `type="submit"` + test unitario de regresión.
- [x] `AnuncioComposer`: prop `items` en los 2 selects (ámbito + aula).
- [x] `NinoAgendaCard` (vista profe): botón "Escribir a la familia" por fila.
- [x] `getRolEnCentro` prioriza el rol más alto.
- [x] Tests RLS adicionales: admin sin asignación, admin con doble rol, cross-centro, tutor sin permiso.
- [x] `docs/dev-setup.md` actualizado con bloque "Componentes cliente con formularios" y `Select.Root` reforzado.

## Verificación

- `npm run typecheck`: 0 errores.
- `npm run lint`: 0 errores (warnings preexistentes de React Compiler con RHF `form.watch()` no introducidos por el hotfix).
- `npm test` (155 tests unit): verde, incluye 5 nuevos de `MensajeComposer`.
- Tests RLS de mensajería: 24 (t01–t24) — t21–t24 cubren los escenarios admin del Bug 5.
- Smoke manual (Checkpoint A) con dev server, 3 navegadores (admin / profe / tutor):
  - Tutor envía mensaje desde `/messages?nino=<id>` → llega al profe sin recargar.
  - Profe ve el botón "Escribir a la familia" en la lista de su aula.
  - Profe ve `/messages` con lista de TODOS los niños, marca conversación, escribe.
  - Admin abre form de anuncio → dropdown de aula muestra nombre, no UUID.
  - Admin publica anuncio ámbito=`aula` en cualquier aula → success.

## Notas

- Push notifications quedan fuera del hotfix; siguen en F5.5 (ADR-0025). Cuando se implementen, el split-view ya provee los anchors visuales necesarios (selector por niño + badge por fila).
- Si en una futura iteración se decide que admin sí participe en conversaciones, basta con quitar el early-return en `MessagesView` y poblar `ninos` para admin (la query ya lo soporta).

## Referencias

- Specs relacionadas: `/docs/specs/messaging.md`
- ADRs relacionados: ADR-0007 (recursión RLS y Select.Root items), ADR-0023 (modelo 5 tablas), ADR-0024 (participantes dinámicos), ADR-0025 (push diferido a F5.5)
- Hotfix branch: `fix/phase-5-ui-and-admin-perms`
- Hotfix previo: `fix/messaging-badge-realtime-order` (#17)
