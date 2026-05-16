---
feature: menus
wave: 1
phase: 4.5b
status: draft
priority: critical
last_updated: 2026-05-16
related_adrs: [ADR-0014, ADR-0019, ADR-0020, ADR-0021, ADR-0022]
related_specs: [school-calendar, daily-agenda, attendance]
---

# Spec — Menús mensuales + pase de lista comida por platos (Fase 4.5b)

> Segunda mitad del módulo de menús. Construye los menús **mensuales** del centro sobre el calendario laboral de F4.5a, y el pase de lista de comida por platos con escala 1-5 que reutiliza `<PaseDeListaTable />` de F4.

## Resumen ejecutivo

Dos tablas nuevas (`plantillas_menu_mensual` + `menu_dia`) que persisten **un menú propio por cada día lectivo**, sin recurrencia semanal. La directora abre `/admin/menus/[id]`, ve el mes en `<CalendarioMensual />`, hace click en cada día abierto y rellena los 6 campos del menú (desayuno, media mañana, 1er plato, 2do plato, postre, merienda). Publica con un click. La profe abre `/teacher/aula/[id]/comida`, selecciona momento (desayuno/media mañana/comida/merienda), y ve el pase de lista con los platos del momento como columnas — escala **1-5** por celda (mapeada al ENUM `cantidad_comida` ya existente). Al guardar, una fila en `comidas` por (niño, plato), con `tipo_plato` y `menu_dia_id` rellenos. La familia ve el menú del día en el widget de la agenda. Reusa `<PaseDeListaTable />` (ADR-0014) y `<CalendarioMensual />` (F4.5a) sin tocar su API.

## Contexto

Fase 4.5 original (plantilla semanal recurrente) se descartó: el calendario real tiene festivos, vacaciones, escuela de verano. F4.5a construyó el calendario laboral (`dias_centro`, helpers `tipo_de_dia` / `centro_abierto`). Esta fase pone encima el menú **mensual**, día a día, sobre los días abiertos del calendario.

La cocina de ANAIA cocina por mes natural (un planning para todo octubre, otro para todo noviembre). No tiene sentido modelar recurrencia semanal — los menús reales varían cada día y cada mes incluye fechas distintas (festivos, viajes de la cocinera, productos de temporada). Un menú = un día. Punto.

El pase de lista por **platos** (no por momento como F3) responde a una petición concreta de las profes de ANAIA: quieren registrar "el primer plato lo comió todo pero el segundo nada" porque la familia lo pregunta. F3 actualmente permite una fila por momento; F4.5b amplía `comidas` con `tipo_plato` para soportar las 3 filas del momento `comida` (primero, segundo, postre) sin romper la compatibilidad con desayuno/merienda (1 plato).

La escala **1-5** que verá la profe se mapea internamente al ENUM `cantidad_comida` que ya existe en F3 (5 valores). Decidimos no crear un enum nuevo (ADR-0022): un día la UI puede mostrar 1-5, otro día se podría mostrar emojis, otro día texto — la verdad de la BD es `nada/poco/mitad/mayoria/todo`. Como parte de esta fase la etiqueta `mayoria` cambia a **"Casi todo"** en es/en/va (afecta también a la agenda de F3, donde la cantidad se muestra como texto — verificado que no rompe nada).

## User stories

- **US-43:** Como **admin del centro**, quiero crear el menú de un mes concreto y rellenarlo día a día sobre un calendario, sin tener que pensar en recurrencias semanales.
- **US-44:** Como **admin**, quiero que los días cerrados (festivos, fines de semana, vacaciones) aparezcan atenuados en el editor para evitar confusión y no rellenar menús que nadie verá.
- **US-45:** Como **admin**, quiero publicar el menú del mes con un click, y que automáticamente se archive la versión publicada anterior si existía.
- **US-46:** Como **admin**, quiero poder modificar un día concreto del menú aunque ya esté publicado (cambios de última hora pasan).
- **US-47:** Como **profe**, quiero abrir el pase de lista de comida del aula, seleccionar el momento (desayuno/media mañana/comida/merienda) y ver una tabla con los platos del menú como columnas y los niños como filas, para marcar 1-5 por celda.
- **US-48:** Como **profe**, quiero que los lactantes (lactancia materna o biberón exclusivo) no aparezcan en el pase de lista de comida sólida — no tiene sentido marcar cuánto puré comieron.
- **US-49:** Como **profe**, quiero poder marcar a todos los niños con la misma cantidad con un click ("Aplicar 5 a todos") y luego ajustar solo las excepciones.
- **US-50:** Como **tutor legal con permiso de agenda**, quiero ver el menú del día del centro en la ficha de mi hijo (no el override individual, el menú estándar) para saber qué comió.
- **US-51:** Como **admin / DPD**, quiero que cada cambio en plantillas y en filas de menú del día quede en `audit_log` con `centro_id`, `usuario_id` y diff antes/después.

## Alcance

**Dentro:**

- 2 tablas nuevas: `plantillas_menu_mensual` (una plantilla por mes/centro/estado) y `menu_dia` (el menú concreto de cada día).
- 2 ENUMs nuevos: `estado_plantilla_menu` (`borrador`, `publicada`, `archivada`), `tipo_plato_comida` (`primer_plato`, `segundo_plato`, `postre`, `unico`).
- Extensión de `comidas` (tabla de F3): 2 columnas nuevas (`tipo_plato`, `menu_dia_id`) + índice único parcial `WHERE tipo_plato IS NOT NULL` para soportar UPSERT atómico del batch del pase de lista.
- 2 helpers SQL: `nino_toma_comida_solida(nino)` (re-creado tras el revert de F4.5) y `menu_del_dia(centro, fecha)`.
- Políticas RLS: SELECT amplio (miembros del centro), INSERT/UPDATE solo admin. **DELETE bloqueado** (plantillas se archivan, no se borran).
- Audit log automático en las 2 tablas nuevas. La extensión de `comidas` no requiere cambio del trigger (`audit_trigger_function` ya graba toda la fila vía `to_jsonb(NEW)`).
- Server actions: `crearPlantillaMensual`, `guardarMenuMes` (batch), `publicarPlantilla`, `archivarPlantilla`, `batchRegistrarComidasPlatos`.
- Queries: `getPlantillasCentro`, `getPlantillaMes`, `getMenuDelDia`, `getPaseDeListaComida`.
- UI admin: `/admin/menus` (listado) y `/admin/menus/[id]` (editor con `<CalendarioMensual />` + panel de día).
- UI profe: `/teacher/aula/[id]/comida` con `ModalidadDayPicker` + selector de momento + `<PaseDeListaTable />` escala 1-5.
- UI familia: widget "Menú del día" en `/family/nino/[id]` (sección Agenda).
- Cambio i18n: `mayoria` se muestra como **"Casi todo"** (es/en/va). Afecta a la agenda de F3 — verificado no rompedor.
- Tests: RLS (≥6), functions SQL (≥4), audit (≥1), unit schemas (≥4), Playwright E2E (≥2).
- ADRs 0020 (plantilla mensual), 0021 (extensión `comidas`), 0022 (escala 1-5 → enum existente).

**Fuera (no se hace aquí):**

- **Recurrencia semanal** — descartada conscientemente (modelo de F4.5 original revertido).
- **Importación de menús desde fichero** (Excel/PDF de la cocina) — Ola 2.
- **Notificaciones push** ("el menú del mes ya está publicado") — Ola 2 / Fase 5.
- **Vista de cocina** (qué comprar esta semana, alérgenos por día) — Ola 2.
- **Asignación de menús por aula** (todas las aulas comparten el menú del centro) — sin granularidad por aula, como el calendario laboral.
- **Versión por edad o por dieta** (menú vegetariano, sin gluten) — Ola 2. El override por niño en el pase de lista (caso tupper) cubre el 80% del caso real hoy.
- **Cálculo nutricional, kcal, alérgenos por plato** — Ola 2/3.

## Comportamientos detallados

### B49 — Admin crea la plantilla del mes

**Pre-condiciones:**

- Rol `admin` en el centro.

**Flujo:**

1. Admin abre `/admin/menus` → lista de plantillas mensuales del centro ordenadas por (anio DESC, mes DESC), con estado (borrador / publicada / archivada).
2. Pulsa "Crear menú del mes" → modal con selector de mes + año (default: mes actual o mes siguiente, según sea principio o fin de mes).
3. Server action `crearPlantillaMensual({centro_id, mes, anio})`:
   - Valida con Zod.
   - INSERT en `plantillas_menu_mensual` con `estado='borrador'`, `creada_por = auth.uid()`.
   - Si ya existe una plantilla en estado `borrador` para ese (centro, mes, anio) → devuelve la existente (idempotente).
   - Si existe `publicada` o `archivada` → permite crear un nuevo `borrador` (caso real: corregir el menú de un mes ya publicado → editar borrador → publicar → archiva la anterior).
4. UI redirige a `/admin/menus/[id]`.

**Post-condiciones:**

- Plantilla en borrador, vacía (sin `menu_dia`).

### B50 — Admin edita el menú del mes en el calendario

**Pre-condiciones:**

- Plantilla creada (B49).
- Admin abre `/admin/menus/[id]`.

**Flujo:**

1. Server query `getPlantillaMes(plantillaId)` devuelve la plantilla + sus `menu_dia` ya cargados + el calendario laboral del mes (overrides de `dias_centro` para colorear días cerrados).
2. UI renderiza `<CalendarioMensual mes={X} anio={Y} />` con:
   - Días cerrados (festivo / vacaciones / sáb-dom por default / cerrado): atenuados (`opacity-40`), NO clickables, label "Cerrado" en la celda.
   - Días abiertos (`lectivo`, `escuela_verano`, `escuela_navidad`, `jornada_reducida`): clickables. Si ya tienen `menu_dia`, mostrar resumen compacto (el primer plato).
   - Botón "Guardar mes" arriba (deshabilitado hasta que haya cambios dirty).
3. Admin hace click en un día abierto → panel/dialog lateral con los 6 campos:
   - Desayuno (textarea, ≤300 chars)
   - Media mañana (textarea, ≤300)
   - 1er plato (textarea, ≤300)
   - 2do plato (textarea, ≤300)
   - Postre (textarea, ≤300)
   - Merienda (textarea, ≤300)
4. Admin escribe, pulsa "Hecho" del día → cambios quedan en estado dirty en cliente (NO se guardan aún).
5. Admin sigue rellenando otros días.
6. Admin pulsa "Guardar mes" → server action `guardarMenuMes(plantillaId, menusModificados)`:
   - Para cada fila modificada: UPSERT en `menu_dia` con ON CONFLICT (plantilla_id, fecha) DO UPDATE.
   - Validación server-side: cada `fecha` debe estar dentro del mes/año de la plantilla padre. La integridad estructural la hace una validación en server action (CHECK SQL podría hacerla pero requeriría JOIN; preferimos validación explícita en el action para errores claros).
7. Toast "Menú del mes guardado · N días actualizados".

**Post-condiciones:**

- Filas `menu_dia` persistidas.
- Plantilla sigue en `borrador` hasta que admin pulse "Publicar".

### B51 — Admin publica la plantilla

**Pre-condiciones:**

- Plantilla en `borrador` con al menos un día relleno (caveat: dejar publicar plantilla "vacía" no daña nada, pero la UI muestra confirmación con conteo "Vas a publicar un menú con N días definidos. ¿Continuar?").

**Flujo:**

1. Admin pulsa "Publicar" en `/admin/menus/[id]`.
2. Dialog de confirmación con conteo de días rellenos.
3. Server action `publicarPlantilla(plantillaId)`:
   - Verifica que la plantilla esté en `borrador` y sea del centro del admin.
   - Si existe otra plantilla `publicada` para el mismo `(centro_id, mes, anio)` → la pone a `archivada`.
   - Pone la actual a `publicada`.
   - Todo en una sola transacción server-side (vía supabase-js: dos UPDATEs secuenciales en el mismo cliente).
4. UI actualiza el badge a "Publicada", deshabilita el botón.

**Post-condiciones:**

- Solo una `publicada` por `(centro_id, mes, anio)` — garantizado por **índice único parcial** `WHERE estado = 'publicada' AND deleted_at IS NULL`.

### B52 — Profe abre el pase de lista de comida

**Pre-condiciones:**

- Rol `profe` con `profes_aulas` activo sobre el aula.
- Curso activo.

**Flujo:**

1. Ruta `/teacher/aula/[id]/comida?fecha=YYYY-MM-DD&momento=comida`. Defaults: `fecha=hoy Madrid`, `momento=desayuno`.
2. Selector de momento (4 chips: desayuno / media mañana / comida / merienda).
3. `ModalidadDayPicker` (compartido) decide qué modo aplica:
   - `hoy` → edición permitida.
   - `historico` → read-only (mismo principio que F3/F4: ADR-0016).
   - `futuro` → solo preview del menú (sin tabla del pase de lista).
4. Server query `getPaseDeListaComida(aulaId, fecha, momento)` devuelve:
   - `centroAbierto(centro, fecha)`: si `false`, devuelve `{ empty: 'centro_cerrado' }` y el motivo (`tipo_de_dia` resuelto: festivo / vacaciones / cerrado / fin de semana).
   - `menuDelDia(centro, fecha)`: si no hay plantilla publicada para el mes → `{ empty: 'sin_menu_publicado' }`. Si hay plantilla pero no hay `menu_dia` para esa fecha → `{ empty: 'dia_sin_menu' }`.
   - Si hay menú → listado de niños del aula (matrícula activa) que cumplen `nino_toma_comida_solida(nino_id) = TRUE`, sus comidas ya registradas para `(agenda_id, momento, tipo_plato)` (vía LEFT JOIN), y los platos del momento extraídos del `menu_dia`.
5. UI:
   - Cabecera muestra el menú (los platos del momento como cards informativas).
   - `<PaseDeListaTable />` con:
     - `items`: niños del aula que toman sólidos.
     - `columns`: 1 columna por plato (1 si desayuno/media mañana/merienda; 3 si comida). Cada columna usa `type: 'enum-badges'` con 5 opciones (las 5 del enum), pero la UI muestra **número 1-5** como label visible.
     - `quickActions`: por cada plato, "Aplicar X a todos" (1-5). Default visible.
   - `readOnly` cuando `modo !== 'hoy'`.

**Post-condiciones:**

- Profe ve la tabla con datos pre-cargados o vacíos según el caso.
- Empty states claros si no aplica (centro cerrado / sin menú publicado / día sin menú definido).

### B53 — Profe marca 1-5 y guarda batch

**Pre-condiciones:**

- B52 con menú visible.
- `dentro_de_ventana_edicion(fecha) = TRUE`.

**Flujo:**

1. Profe hace click en un botón 1-5 de una celda → `value` en cliente como `'nada' | 'poco' | 'mitad' | 'mayoria' | 'todo'`. Fila marcada como dirty.
2. Profe usa quick action "Aplicar 5 a todos" → todas las filas del plato cogen `value='todo'`.
3. Profe pulsa "Guardar pase de lista" → server action `batchRegistrarComidasPlatos({ aulaId, fecha, momento, filas })`:
   - Para cada fila dirty (niño + plato + cantidad):
     - Asegurar `agendas_diarias(nino_id, fecha)` (idempotente — la lib de agenda ya tiene `asegurarAgenda`).
     - UPSERT en `comidas` con `ON CONFLICT (agenda_id, momento, tipo_plato) WHERE tipo_plato IS NOT NULL DO UPDATE` — el índice único parcial lo permite.
     - Setear `descripcion = override_del_niño || menu_dia[campo_correspondiente]`, `tipo_plato = primer_plato | segundo_plato | postre | unico`, `menu_dia_id = id`.
   - Devuelve resultado con conteo de filas guardadas.
4. RLS: las políticas de `comidas` (F3) siguen aplicando — ventana de edición, profe del aula, etc.
5. Trigger audit graba INSERT/UPDATE por fila.
6. Toast "Pase de lista guardado · N filas".

**Errores:**

- Si ventana se cierra a media edición → toast "Día cerrado" + refresh a read-only (mismo patrón F4).
- Si RLS rechaza (`code='42501'`) → `{success:false, error:'pase_de_lista.errors.fuera_de_ventana'}`.

### B54 — Exclusión por lactancia

El helper SQL `nino_toma_comida_solida(nino_id uuid) RETURNS boolean`:

- Devuelve `FALSE` si existe fila en `datos_pedagogicos_nino` con `lactancia_estado IN ('materna', 'biberon')`.
- Devuelve `TRUE` en cualquier otro caso (`mixta`, `finalizada`, `no_aplica`, o sin fila — `COALESCE` a TRUE).

La query `getPaseDeListaComida` filtra los niños del aula con este helper. Los lactantes exclusivos no aparecen en la tabla — la profe no tiene que marcar "comida 1-5" para ellos. Sí aparecen en el pase de lista de F4 (asistencia) y en su agenda diaria normal.

> **Matiz importante (heredado del prompt de F4.5 descartado):** `mixta` SÍ entra. Los niños en lactancia mixta están comiendo purés y sólidos parciales que la profe quiere registrar; excluirlos sería tirar información.

### B55 — Override de descripción por niño (caso tupper)

Casos reales:

- "Marcos es alérgico al gluten — su madre le mete tupper de macarrones sin gluten en vez del primer plato del menú".
- "Lola vino con su comida en la fiambrera porque tenía cita médica antes".

UX: en una fila del pase de lista, la profe pulsa un icono junto al plato (lápiz pequeño) → input inline donde puede sobrescribir la `descripcion` para ese niño/plato. La fila marca un mini badge "Personalizado". Si no se toca, hereda la descripción del menú.

Server-side: el campo `comidas.descripcion` recibe el override (si vino) o la `descripcion` del `menu_dia[campo]` (si no). `menu_dia_id` siempre se setea (sirve para joins futuros con menús archivados). `tipo_plato` también.

### B56 — Familia ve menú del día (widget)

**Pre-condiciones:**

- Tutor con `puede_ver_agenda = true`.

**Flujo:**

1. Tutor abre `/family/nino/[id]` (ficha del niño).
2. Sección "Agenda" muestra los datos del día como en F3.
3. Widget nuevo **"Menú del día"** debajo del header de Agenda (server component): si hay menú del día → 4 cards (desayuno, media mañana, comida con 3 sub-líneas, merienda); si centro cerrado → empty state coherente con F4.5a; si no hay plantilla publicada → empty state amable "Aún no hay menú publicado".
4. Muestra los platos **del menú estándar** (no los overrides individuales de B55). Razón: la familia espera ver el menú "del centro", no el detalle de qué comió su hijo (eso ya está en la agenda con las cantidades del pase de lista). El override de tupper es información operativa para la profe.

### B57 — Vista de comidas en la agenda del niño (actualización de F3)

**Contexto:** F3 muestra las comidas en `/family/nino/[id]` (sección Agenda) y en `/teacher/aula/[id]` (vista profe del aula) como una fila por `momento` con su `cantidad`+`descripcion`+`observaciones`. Tras F4.5b, el momento `comida` puede tener hasta 3 filas (primer_plato/segundo_plato/postre); los momentos `desayuno`/`media_manana`/`merienda` siguen siendo 1 fila (con `tipo_plato='unico'` o `tipo_plato=NULL` legacy).

Sin actualizar la UI de F3, el desglose por platos solo se vería en `audit_log` — invisible para la familia. Por eso F4.5b **modifica** la vista de comidas existente (sin romper compatibilidad con filas pre-F4.5b de `tipo_plato=NULL`).

**Cambio de UI (familia, `/family/nino/[id]` sección Agenda):**

1. La sección "Comidas" agrupa por `momento` (orden cronológico: desayuno, media mañana, comida, merienda).
2. Para cada momento, calcula cuántas filas hay:
   - **1 fila** (caso clásico F3 con `tipo_plato=NULL` O caso F4.5b con `tipo_plato='unico'`): se muestra como F3 — `hora`, `cantidad` (badge con texto: "Todo", "Casi todo", "La mitad"…), `descripcion`, `observaciones`.
   - **N filas con `tipo_plato` no nulo** (caso F4.5b en momento `comida`): se desglosa visualmente. Una mini-cabecera con el momento (ej. "Comida"); debajo, una lista de los platos en orden fijo (`primer_plato`, `segundo_plato`, `postre`), cada uno con su `descripcion` y badge de `cantidad`. `observaciones` (si existe) se muestra una vez al final del momento.
   - **Mezcla legacy + nuevo** (existe en histórico migrado): hay 1 fila con `tipo_plato=NULL` y otras con `tipo_plato` no-NULL en el mismo `momento`. Decisión: renderizar **todas** las filas como están — la primera como "fila genérica" y las demás como "platos". Caso raro (solo aparecería si se mezclaran inserts de F3 viejos y pase de lista nuevo el mismo día); preserva la información.
3. El widget "Menú del día" (B56) sigue mostrando el menú **estándar** del centro. La sección "Comidas" muestra lo **registrado para este niño**. Las dos coexisten en la misma vista.

**Cambio de UI (profe, vista del aula expandida):**

Mismo patrón: cuando se expande la card de un niño en `/teacher/aula/[id]`, las comidas se agrupan por momento; si el momento `comida` tiene `tipo_plato` no nulo, se desglosa.

**Compatibilidad con F3:**

- Los datos pre-F4.5b en `comidas` tienen `tipo_plato=NULL` y `menu_dia_id=NULL`. La lógica de agrupación los trata como "fila única del momento" (caso `unico` semántico), por tanto se renderizan exactamente igual que en F3.
- Los componentes existentes de F3 (`<AgendaFamiliaView>`, `<AgendaAulaCliente>`) reciben las comidas ya agrupadas/ordenadas desde el server query — no se cambia su contrato externo, solo su renderer interno.
- Cero migración de datos: las filas viejas siguen funcionando.

**Tests asociados (en la sección Tests requeridos):**

- Unit del componente o renderer que asegure: (a) 1 fila con `tipo_plato=NULL` → vista clásica F3; (b) 3 filas con `tipo_plato` no nulo y mismo `momento='comida'` → desglose por platos; (c) mezcla → todas visibles.

### B58 — Cambio de etiqueta `mayoria` → "Casi todo"

Hasta F3 la cantidad `mayoria` se mostraba como "Mayoría" / "Most" / "Majoria". A partir de F4.5b se muestra como **"Casi todo" / "Almost all" / "Quasi tot"** en toda la app. Razón: la palabra "mayoría" no encaja con el contexto de comida en español natural ("la mayoría de la comida" suena raro). "Casi todo" es la traducción natural.

Cambio:

- Modificar las 3 claves `agenda.cantidad_opciones.mayoria` en `messages/{es,en,va}.json`.
- Verificar que no hay copias hardcodeadas. Buscar con `grep -r "Mayoría" src/` antes y después.
- La BD no cambia: el ENUM sigue siendo `mayoria`. Solo la etiqueta visible.

## Casos edge

- **Plantilla en `borrador` + cambios externos en el calendario laboral**: si la directora marca un día como festivo después de haber rellenado el menú de ese día, la fila `menu_dia` sigue en BD pero el editor la oculta (porque el día pasa a "cerrado"). La fila no se borra — si la directora vuelve a abrir el día (revierte el festivo), el menú reaparece. Documentado en spec.
- **Plantilla publicada para un mes con días nuevos abiertos**: si tras publicar, la directora ABRE un día antes cerrado (cambia "vacaciones" → "lectivo"), ese día no tendrá `menu_dia` y aparecerá vacío en el calendario y en `/teacher/.../comida`. Para corregir: editar la plantilla publicada (B46) → añadir el día → guardar.
- **Solo una `publicada` por mes/centro**: garantizado por índice único parcial. Intentar publicar una segunda viola el constraint a nivel BD; la action lo gestiona archivando la anterior antes.
- **Niño con `lactancia_estado=null` (sin `datos_pedagogicos_nino`)**: el helper devuelve TRUE (incluido). Caso real: niño recién matriculado sin datos pedagógicos rellenos aún.
- **Niño con `lactancia_estado='mixta'`**: SÍ entra al pase de lista.
- **Niño cambia de `biberon` a `mixta` a media mañana**: el pase de lista lo recoge en la siguiente recarga (server-side, no Realtime para pedagógicos).
- **Plantilla con `menu_dia.fecha` fuera del mes**: validado en server action; rechazado con error específico. No hay CHECK SQL porque requeriría JOIN con la plantilla (la fecha es DATE y el mes/anio están en la fila padre); la validación cliente + server es suficiente.
- **Día con plantilla publicada pero sin `menu_dia` definido**: pase de lista muestra empty "Día sin menú definido en la plantilla del mes" (no es lo mismo que "no hay plantilla publicada").
- **Profe abre comida del momento `desayuno` un día que solo tiene `comida` rellenada**: muestra empty del momento concreto (no se puede pasar lista a desayuno si no hay desayuno definido).
- **Realtime no aplica**: las plantillas y menus son planificación, los cambios son del orden de días. `comidas` ya está en Realtime de F3, así que cuando la profe guarda el batch, las familias con la agenda abierta ven las cantidades aparecer al instante.
- **Niño matriculado a media mañana**: si entra en `getPaseDeListaComida` tras el guardado batch, su fila aparece sin valores en la siguiente recarga. La profe puede registrar su comida individual editando.

## Validaciones (Zod)

`src/features/menus/schemas/menu.ts`:

```typescript
import { z } from 'zod'

const fechaSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'menus.validation.fecha_invalida')

const campoMenuSchema = z.string().max(300, 'menus.validation.campo_largo').nullable()

export const estadoPlantillaEnum = z.enum(['borrador', 'publicada', 'archivada'])
export type EstadoPlantilla = z.infer<typeof estadoPlantillaEnum>

export const momentoComidaEnum = z.enum(['desayuno', 'media_manana', 'comida', 'merienda'])
export type MomentoComida = z.infer<typeof momentoComidaEnum>

export const tipoPlatoEnum = z.enum(['primer_plato', 'segundo_plato', 'postre', 'unico'])
export type TipoPlato = z.infer<typeof tipoPlatoEnum>

export const cantidadComidaEnum = z.enum(['nada', 'poco', 'mitad', 'mayoria', 'todo'])
export type CantidadComida = z.infer<typeof cantidadComidaEnum>

export const crearPlantillaMensualSchema = z.object({
  centro_id: z.string().uuid(),
  mes: z.number().int().min(1).max(12),
  anio: z.number().int().min(2024).max(2100),
})

export const menuDiaSchema = z.object({
  fecha: fechaSchema,
  desayuno: campoMenuSchema,
  media_manana: campoMenuSchema,
  comida_primero: campoMenuSchema,
  comida_segundo: campoMenuSchema,
  comida_postre: campoMenuSchema,
  merienda: campoMenuSchema,
})

export const guardarMenuMesSchema = z.object({
  plantilla_id: z.string().uuid(),
  menus: z.array(menuDiaSchema).min(0).max(40),
})

export const filaPaseDeListaComidaSchema = z.object({
  nino_id: z.string().uuid(),
  tipo_plato: tipoPlatoEnum,
  cantidad: cantidadComidaEnum,
  descripcion: z.string().max(500).nullable(),
})

export const batchRegistrarComidasPlatosSchema = z.object({
  aula_id: z.string().uuid(),
  fecha: fechaSchema,
  momento: momentoComidaEnum,
  menu_dia_id: z.string().uuid(),
  filas: z.array(filaPaseDeListaComidaSchema).min(1).max(100),
})

export type CrearPlantillaMensualInput = z.infer<typeof crearPlantillaMensualSchema>
export type MenuDiaInput = z.infer<typeof menuDiaSchema>
export type GuardarMenuMesInput = z.infer<typeof guardarMenuMesSchema>
export type BatchRegistrarComidasPlatosInput = z.infer<typeof batchRegistrarComidasPlatosSchema>
```

## Modelo de datos afectado

**Tablas nuevas:**

### `plantillas_menu_mensual`

| Columna      | Tipo                             | Notas                                  |
| ------------ | -------------------------------- | -------------------------------------- |
| `id`         | `uuid PK`                        | `DEFAULT gen_random_uuid()`            |
| `centro_id`  | `uuid NOT NULL`                  | FK a `centros(id)` ON DELETE CASCADE   |
| `mes`        | `smallint NOT NULL`              | CHECK `mes BETWEEN 1 AND 12`           |
| `anio`       | `smallint NOT NULL`              | CHECK `anio BETWEEN 2024 AND 2100`     |
| `estado`     | `estado_plantilla_menu NOT NULL` | DEFAULT `'borrador'`                   |
| `creada_por` | `uuid NULL`                      | FK a `usuarios(id)` ON DELETE SET NULL |
| `created_at` | `timestamptz NOT NULL`           | DEFAULT `now()`                        |
| `updated_at` | `timestamptz NOT NULL`           | DEFAULT `now()`, mantenido por trigger |
| `deleted_at` | `timestamptz NULL`               | Soft delete (futuro)                   |

Índices:

- Índice único parcial `(centro_id, mes, anio) WHERE estado='publicada' AND deleted_at IS NULL`.
- Índice (centro_id, anio DESC, mes DESC) para el listado en `/admin/menus`.

### `menu_dia`

| Columna          | Tipo                   | Notas                                                |
| ---------------- | ---------------------- | ---------------------------------------------------- |
| `id`             | `uuid PK`              | `DEFAULT gen_random_uuid()`                          |
| `plantilla_id`   | `uuid NOT NULL`        | FK a `plantillas_menu_mensual(id)` ON DELETE CASCADE |
| `fecha`          | `date NOT NULL`        |                                                      |
| `desayuno`       | `text NULL`            | CHECK `length(desayuno) <= 300`                      |
| `media_manana`   | `text NULL`            | CHECK `length(media_manana) <= 300`                  |
| `comida_primero` | `text NULL`            | CHECK `length(comida_primero) <= 300`                |
| `comida_segundo` | `text NULL`            | CHECK `length(comida_segundo) <= 300`                |
| `comida_postre`  | `text NULL`            | CHECK `length(comida_postre) <= 300`                 |
| `merienda`       | `text NULL`            | CHECK `length(merienda) <= 300`                      |
| `created_at`     | `timestamptz NOT NULL` | DEFAULT `now()`                                      |
| `updated_at`     | `timestamptz NOT NULL` | DEFAULT `now()`                                      |

UNIQUE (`plantilla_id`, `fecha`).

**Validación de "fecha dentro del mes/año de la plantilla padre" en dos capas:**

1. **Server action (`guardarMenuMes`)**: valida con Zod + comprobación explícita comparando `fecha` con `(plantilla.mes, plantilla.anio)`. Si la fecha no encaja, devuelve error i18n claro al cliente (`menus.validation.fecha_fuera_del_mes`). Esta capa da la UX legible.
2. **Trigger BEFORE INSERT OR UPDATE en `menu_dia`** (red de seguridad a nivel BD): hace JOIN con `plantillas_menu_mensual` y lanza `RAISE EXCEPTION` si `EXTRACT(MONTH FROM NEW.fecha) <> p.mes OR EXTRACT(YEAR FROM NEW.fecha) <> p.anio`. Protege contra INSERT por SQL directo, errores de código o bugs futuros que esquiven el server action.

La razón de NO usar CHECK simple es que requeriría JOIN entre la fila de `menu_dia` y la plantilla padre — eso solo se puede hacer dentro de un trigger PL/pgSQL, no en un CHECK constraint declarativo.

**Tablas modificadas: `comidas` (de F3)**

Añadir dos columnas + un índice:

```sql
ALTER TABLE public.comidas
  ADD COLUMN tipo_plato public.tipo_plato_comida NULL,
  ADD COLUMN menu_dia_id uuid NULL REFERENCES public.menu_dia(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX comidas_agenda_momento_tipo_plato_idx
  ON public.comidas (agenda_id, momento, tipo_plato)
  WHERE tipo_plato IS NOT NULL;
```

- `tipo_plato` NULL para todas las filas existentes de F3 (sin contradicciones).
- `menu_dia_id` NULL para registros individuales (sin batch).
- El índice único parcial `WHERE tipo_plato IS NOT NULL` permite el UPSERT atómico del batch sin romper compatibilidad con F3 (donde múltiples filas con tipo_plato=NULL coexisten).
- ON DELETE SET NULL en `menu_dia_id`: si un día se borrara `menu_dia` (CASCADE desde plantilla, aunque la UI no permite borrar plantillas), las filas en `comidas` quedan con la cantidad/descripción inmutable, perdiendo solo el link al menú original.

**ENUMs nuevos:**

```sql
CREATE TYPE public.estado_plantilla_menu AS ENUM ('borrador', 'publicada', 'archivada');
CREATE TYPE public.tipo_plato_comida AS ENUM ('primer_plato', 'segundo_plato', 'postre', 'unico');
```

## Helpers SQL

### `nino_toma_comida_solida`

Re-creado tras el revert de F4.5. Espejo del que existió y se eliminó.

```sql
CREATE OR REPLACE FUNCTION public.nino_toma_comida_solida(p_nino_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (
      SELECT lactancia_estado NOT IN ('materna'::public.lactancia_estado, 'biberon'::public.lactancia_estado)
      FROM public.datos_pedagogicos_nino
      WHERE nino_id = p_nino_id
    ),
    TRUE
  );
$$;
GRANT EXECUTE ON FUNCTION public.nino_toma_comida_solida(uuid) TO authenticated;
```

### `menu_del_dia`

Devuelve la fila `menu_dia` aplicable a una fecha, mirando la plantilla publicada del mes/año correspondiente.

```sql
CREATE OR REPLACE FUNCTION public.menu_del_dia(p_centro_id uuid, p_fecha date)
RETURNS public.menu_dia
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT md.*
  FROM public.menu_dia md
  JOIN public.plantillas_menu_mensual p ON p.id = md.plantilla_id
  WHERE p.centro_id = p_centro_id
    AND p.estado = 'publicada'::public.estado_plantilla_menu
    AND p.deleted_at IS NULL
    AND p.mes = EXTRACT(MONTH FROM p_fecha)::smallint
    AND p.anio = EXTRACT(YEAR FROM p_fecha)::smallint
    AND md.fecha = p_fecha
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.menu_del_dia(uuid, date) TO authenticated;
```

## Políticas RLS

### `plantillas_menu_mensual`

```sql
ALTER TABLE public.plantillas_menu_mensual ENABLE ROW LEVEL SECURITY;

CREATE POLICY plantillas_menu_select ON public.plantillas_menu_mensual
  FOR SELECT USING (public.pertenece_a_centro(centro_id));

CREATE POLICY plantillas_menu_insert ON public.plantillas_menu_mensual
  FOR INSERT WITH CHECK (public.es_admin(centro_id));

CREATE POLICY plantillas_menu_update ON public.plantillas_menu_mensual
  FOR UPDATE
  USING (public.es_admin(centro_id))
  WITH CHECK (public.es_admin(centro_id));

-- DELETE: ninguna policy → default DENY (las plantillas se archivan).
```

### `menu_dia`

`menu_dia` no tiene `centro_id` directo — se deriva vía `plantilla_id → centro_id`. Helper auxiliar:

```sql
CREATE OR REPLACE FUNCTION public.centro_de_plantilla(p_plantilla_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT centro_id FROM public.plantillas_menu_mensual WHERE id = p_plantilla_id;
$$;
GRANT EXECUTE ON FUNCTION public.centro_de_plantilla(uuid) TO authenticated;
```

Y políticas:

```sql
ALTER TABLE public.menu_dia ENABLE ROW LEVEL SECURITY;

CREATE POLICY menu_dia_select ON public.menu_dia
  FOR SELECT USING (public.pertenece_a_centro(public.centro_de_plantilla(plantilla_id)));

CREATE POLICY menu_dia_insert ON public.menu_dia
  FOR INSERT WITH CHECK (public.es_admin(public.centro_de_plantilla(plantilla_id)));

CREATE POLICY menu_dia_update ON public.menu_dia
  FOR UPDATE
  USING (public.es_admin(public.centro_de_plantilla(plantilla_id)))
  WITH CHECK (public.es_admin(public.centro_de_plantilla(plantilla_id)));

-- DELETE: ninguna policy → default DENY.
```

### `comidas` (sin cambios respecto a F3)

Las políticas existentes de F3 (`comida_select`, `comida_insert`, `comida_update`) **siguen vigentes sin modificar**. El batch del pase de lista usa las mismas:

- INSERT/UPDATE: profe del aula del niño + admin del centro + ventana abierta.
- SELECT: igual que F3.

Las nuevas columnas (`tipo_plato`, `menu_dia_id`) no requieren cambio de policy: forman parte del row, y RLS filtra por row.

## Audit log

Triggers en las 2 tablas nuevas:

```sql
CREATE TRIGGER audit_plantillas_menu_mensual
  AFTER INSERT OR UPDATE OR DELETE ON public.plantillas_menu_mensual
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

CREATE TRIGGER audit_menu_dia
  AFTER INSERT OR UPDATE OR DELETE ON public.menu_dia
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();
```

Y dos ramas nuevas en `audit_trigger_function`:

```sql
ELSIF TG_TABLE_NAME = 'plantillas_menu_mensual' THEN
  v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
ELSIF TG_TABLE_NAME = 'menu_dia' THEN
  v_centro_id := public.centro_de_plantilla(COALESCE((NEW).plantilla_id, (OLD).plantilla_id));
```

`comidas` ya tiene trigger de F3 — no se toca.

## Componente reuse

### `<PaseDeListaTable />` (ADR-0014)

Se usa sin tocar su API. Configuración del pase de lista de comida:

```tsx
<PaseDeListaTable<NinoSimulado, ValorPaseComida>
  items={resumenes}
  renderItem={(nino) => <NinoCellComida nino={nino} alertas={...} />}
  columns={[
    {
      id: 'cantidad_primero',
      label: t('platos.primer_plato'),
      type: 'enum-badges',
      options: ESCALA_1_5_OPTIONS, // value=enum, label='1'..'5'
      visibleWhen: () => momento === 'comida',
    },
    {
      id: 'cantidad_segundo',
      label: t('platos.segundo_plato'),
      type: 'enum-badges',
      options: ESCALA_1_5_OPTIONS,
      visibleWhen: () => momento === 'comida',
    },
    {
      id: 'cantidad_postre',
      label: t('platos.postre'),
      type: 'enum-badges',
      options: ESCALA_1_5_OPTIONS,
      visibleWhen: () => momento === 'comida',
    },
    {
      id: 'cantidad_unica',
      label: t('platos.unico'),
      type: 'enum-badges',
      options: ESCALA_1_5_OPTIONS,
      visibleWhen: () => momento !== 'comida',
    },
  ]}
  quickActions={[
    { id: 'todo', label: t('quick.todo'), apply: () => ({ /* todas las columnas visibles a 'todo' */ }) },
    // ...
  ]}
  onBatchSubmit={async (rows) => {
    const r = await batchRegistrarComidasPlatos({ ... })
    return r.success ? { success: true } : { success: false, error: r.error }
  }}
  readOnly={modo !== 'hoy'}
  submitLabel={t('guardar')}
  i18n={{ pending, dirty, saved, errorRow }}
/>
```

`ESCALA_1_5_OPTIONS` viene de un helper en `src/features/menus/lib/escala.ts`:

```typescript
export const ESCALA_1_5_OPTIONS = [
  { value: 'nada' as const, label: '1' },
  { value: 'poco' as const, label: '2' },
  { value: 'mitad' as const, label: '3' },
  { value: 'mayoria' as const, label: '4' },
  { value: 'todo' as const, label: '5' },
] as const

/** Mapeo inverso para mostrar texto cuando se necesite (informes, agenda). */
export const ESCALA_1_5_TEXTO: Record<CantidadComida, string> = {
  nada: '1',
  poco: '2',
  mitad: '3',
  mayoria: '4',
  todo: '5',
}
```

> El componente `<PaseDeListaTable />` no requiere modificaciones — `type: 'enum-badges'` ya existe en su tipo `PaseDeListaColumn`.

### `<CalendarioMensual />` (F4.5a)

Se usa sin tocar su API en `/admin/menus/[id]`. `renderDia` decide qué pintar:

- Si día cerrado → atenuar, sin hover, label "Cerrado".
- Si día abierto sin `menu_dia` → "Sin definir" + icono.
- Si día abierto con `menu_dia` → resumen del primer plato (o desayuno si no es momento `comida`).

`onClickDia` abre el panel de edición del día. No usamos `onSeleccionRango` aquí — el editor de menú es uno-a-uno por día, no por rango.

## Pantallas y rutas

- **Admin**: `/admin/menus` (listado), `/admin/menus/[id]` (editor). Item nuevo en sidebar admin.
- **Profe**: `/teacher/aula/[id]/comida` con `?fecha=YYYY-MM-DD&momento=MOMENTO`. Link desde `/teacher/aula/[id]` (debajo de asistencia).
- **Familia**: widget "Menú del día" en `/family/nino/[id]` sección Agenda. Sin ruta nueva.

## Componentes UI

`src/features/menus/components/`:

- `PlantillasListaCliente.tsx` (Server-render con Client interactions): lista de plantillas + dialog "Nueva plantilla".
- `EditorMenuMensual.tsx` (Client): orquesta calendario + panel de día + botones publicar/guardar.
- `PanelEdicionMenuDia.tsx` (Client): los 6 inputs del día seleccionado, controlled por el editor padre.
- `PaseDeListaComidaCliente.tsx` (Client): wrapper del pase de lista con selector de momento + DayPicker + tabla.
- `MenuDelDiaWidget.tsx` (Server): widget del menú del día para la familia.
- `MenuEmptyState.tsx` (Server): estados vacíos (centro cerrado, sin plantilla, día sin menú).

## Eventos y notificaciones

- **Push**: NO en F4.5b.
- **Audit log**: automático.
- **Realtime**: NO en plantillas/menu_dia (cardinalidad baja, planificación). `comidas` ya está en Realtime de F3 — el batch del pase de lista se propaga a familias con la agenda abierta.
- **Telemetría**: `menu_plantilla_creada`, `menu_plantilla_publicada {mes,anio}`, `menu_dia_editado {plantilla_id}`, `comida_pase_de_lista_guardado {aula_id, momento, count}`. Sin PII; no se loguea descripción de menús ni nombres de niños.

## i18n

Namespace nuevo: `menus.*`. Estructura (extracto):

```json
{
  "menus": {
    "title": "Menús del centro",
    "lista": {
      "title": "Plantillas mensuales",
      "nueva": "Crear menú del mes",
      "vacio": "Aún no hay menús creados."
    },
    "estado": { "borrador": "Borrador", "publicada": "Publicada", "archivada": "Archivada" },
    "editor": {
      "title": "Menú de {mes} {anio}",
      "guardar_mes": "Guardar mes",
      "publicar": "Publicar",
      "confirmar_publicar": {
        "title": "Publicar menú del mes",
        "descripcion": "Vas a publicar el menú del mes con {dias} días definidos. La versión publicada anterior (si existía) quedará archivada.",
        "si": "Publicar",
        "no": "Cancelar"
      },
      "panel_dia": {
        "title": "Menú del {fecha}",
        "desayuno": "Desayuno",
        "media_manana": "Media mañana",
        "comida_primero": "1er plato (comida)",
        "comida_segundo": "2do plato (comida)",
        "comida_postre": "Postre",
        "merienda": "Merienda",
        "hecho": "Hecho",
        "cancelar": "Cancelar"
      },
      "celda_sin_menu": "Sin definir",
      "celda_dia_cerrado": "Cerrado"
    },
    "pase_de_lista": {
      "title": "Pase de lista comida",
      "selector_momento_label": "Momento",
      "momentos": {
        "desayuno": "Desayuno",
        "media_manana": "Media mañana",
        "comida": "Comida",
        "merienda": "Merienda"
      },
      "platos": {
        "primer_plato": "1er plato",
        "segundo_plato": "2do plato",
        "postre": "Postre",
        "unico": "Plato"
      },
      "quick": { "aplicar_a_todos": "Aplicar {valor} a todos" },
      "guardar": "Guardar pase de lista",
      "guardado": "Pase de lista guardado · {count} filas",
      "personalizado": "Personalizado",
      "override_plato": "Personalizar para este niño"
    },
    "widget_familia": {
      "title": "Menú del día",
      "campos": {
        "desayuno": "Desayuno",
        "media_manana": "Media mañana",
        "comida": "Comida",
        "merienda": "Merienda"
      }
    },
    "empty": {
      "centro_cerrado": {
        "title": "Centro cerrado",
        "descripcion": "Este día el centro está cerrado ({tipo}). No hay menú ni pase de lista."
      },
      "sin_plantilla_publicada": {
        "title": "Aún no hay menú publicado",
        "descripcion": "El admin del centro aún no ha publicado el menú de este mes."
      },
      "dia_sin_menu": {
        "title": "Día sin menú definido",
        "descripcion": "La plantilla del mes está publicada pero este día no tiene menú."
      },
      "sin_ninos_solidos": "Ningún niño del aula come comida sólida en este momento."
    },
    "validation": {
      "campo_largo": "Máximo 300 caracteres.",
      "fecha_invalida": "Fecha inválida.",
      "fecha_fuera_del_mes": "La fecha está fuera del mes de la plantilla."
    },
    "toasts": {
      "plantilla_creada": "Plantilla creada",
      "guardado_mes": "{count} días actualizados",
      "publicado": "Plantilla publicada",
      "error_guardar": "No se pudo guardar. Inténtalo de nuevo.",
      "error_publicar": "No se pudo publicar. Inténtalo de nuevo."
    }
  },
  "admin": { "nav": { "menus": "Menús" } },
  "agenda": {
    "cantidad_opciones": {
      "mayoria": "Casi todo"
    }
  }
}
```

(Solo se muestra `mayoria`; los otros 4 valores del enum siguen como estaban en F3. La idea es REEMPLAZAR `mayoria='Mayoría'` → `mayoria='Casi todo'`, no crear claves nuevas.)

Trilingüe completo (es/en/va).

## Accesibilidad

- Editor de menú: panel de día con focus trap (Dialog), ESC cierra.
- Pase de lista: botones 1-5 con `aria-label` que incluye número Y texto ("1, Nada"). El número visible es el atajo visual; el screen reader anuncia ambos.
- Empty states con `role="status"` y mensaje descriptivo.
- Targets táctiles ≥ 44 CSS px en mobile (botones 1-5, quick actions).
- Contraste WCAG AA en colores de los chips de estado (borrador/publicada/archivada).
- axe-core sin violations en `/admin/menus`, `/admin/menus/[id]`, `/teacher/aula/[id]/comida`, `/family/nino/[id]` (sección Agenda con widget).

## Performance

- Query `getPaseDeListaComida`: 1 query con LEFT JOIN a comidas + JOIN a menu_dia + filtros vía `nino_toma_comida_solida`. <100ms p50 para aulas ≤20 niños.
- Batch UPSERT de pase de lista: una transacción de N rows. Para 15 niños × 3 platos = 45 rows, <150ms p50.
- Editor de menú: 1 query inicial con todos los `menu_dia` del mes (≤31 filas). Editor mantiene cambios en cliente; "Guardar mes" es 1 query batch.
- Bundle `/teacher/aula/[id]/comida`: Client (RHF + estado batch). <230 KB JS.
- Lighthouse > 90 en performance y accesibilidad en las 4 rutas afectadas.

## Telemetría

- `menu_plantilla_creada { mes, anio }`
- `menu_plantilla_publicada { mes, anio, dias_definidos }`
- `menu_dia_editado { fecha }`
- `comida_pase_de_lista_abierto { aula_id, momento }`
- `comida_pase_de_lista_guardado { aula_id, momento, count }`
- `comida_quick_action_aplicada { aula_id, plato }`

Sin PII (no se loguea descripción de menús ni nombres).

## Tests requeridos

**Vitest (unit/integration):**

- [ ] `menu.schema.test.ts`: schemas Zod (crear plantilla, guardar mes con N días, batch pase de lista, validación de campo ≤300).
- [ ] `escala.test.ts`: mapeo escala 1-5 ↔ enum `cantidad_comida` bidireccional.

**Vitest (RLS) — `src/test/rls/menus.rls.test.ts` (≥6):**

- [ ] Aislamiento centros: admin centro A no ve plantillas centro B.
- [ ] Profe del centro puede SELECT plantillas y menu_dia, NO INSERT/UPDATE.
- [ ] Tutor del centro puede SELECT plantillas y menu_dia, NO INSERT/UPDATE.
- [ ] Admin del centro puede INSERT/UPDATE plantilla y menu_dia.
- [ ] DELETE rechazado a todos (plantilla y menu_dia).
- [ ] Comidas con `tipo_plato` y `menu_dia_id` siguen respetando RLS de F3 (ventana, profe del aula).

**Vitest (functions) — `src/test/rls/menu-helpers.test.ts` (≥4):**

- [ ] `nino_toma_comida_solida` devuelve FALSE para lactancia `materna`.
- [ ] `nino_toma_comida_solida` devuelve FALSE para lactancia `biberon`.
- [ ] `nino_toma_comida_solida` devuelve TRUE para `mixta` (matiz importante).
- [ ] `nino_toma_comida_solida` devuelve TRUE si no hay fila en `datos_pedagogicos_nino`.
- [ ] `menu_del_dia` devuelve el menú correcto cuando hay plantilla publicada con `menu_dia` para esa fecha.
- [ ] `menu_del_dia` devuelve NULL si no hay plantilla publicada para el mes.

**Vitest (audit) — `src/test/audit/menus-audit.test.ts`:**

- [ ] INSERT en `plantillas_menu_mensual` genera audit_log con `centro_id`.
- [ ] UPDATE en `menu_dia` captura antes/después con `centro_id` correcto (derivado via `centro_de_plantilla`).

**Playwright (E2E) — `e2e/menus.spec.ts`:**

- [ ] Smoke: rutas protegidas + i18n sin claves sin resolver en es/en/va.
- [ ] **admin-crea-y-publica-menu** (skip por defecto): admin crea plantilla del mes, rellena 3 días, publica. Recarga y ve la plantilla en estado `publicada`.
- [ ] **profe-pasa-lista-comida** (skip por defecto): profe abre `/teacher/aula/[id]/comida`, selecciona momento `comida`, aplica "5 a todos" en primer plato, guarda. Recarga y ve los valores persistidos.

## Criterios de aceptación

- [ ] `npm run typecheck && npm run lint && npm test && npm run test:e2e && npm run build` todo verde.
- [ ] Tests RLS (≥6), functions (≥4-6), audit (≥1-2), unit (≥2-4), E2E (≥2 + smoke) pasan.
- [ ] Lighthouse > 90 en performance y accesibilidad en las 4 rutas afectadas.
- [ ] axe-core sin violations en las 4 rutas.
- [ ] 100% claves i18n en es/en/va; lint i18n verde.
- [ ] Cambio de etiqueta `mayoria='Casi todo'` aplicado en es/en/va sin descuadrar la agenda de F3.
- [ ] Audit log captura INSERT/UPDATE en plantillas y menu_dia.
- [ ] Componentes `<PaseDeListaTable />` y `<CalendarioMensual />` reusados SIN tocar su API.
- [ ] ADR-0020 (plantilla mensual), ADR-0021 (extensión `comidas`), ADR-0022 (escala 1-5 → enum existente) escritos.
- [ ] `docs/architecture/data-model.md` actualizado.
- [ ] `docs/architecture/rls-policies.md` con sección F4.5b.
- [ ] Entrada en `docs/journey/progress.md`.
- [ ] `docs/specs/scope-ola-1.md` registra F4.5b cerrada.

## Decisiones técnicas relevantes

- **ADR-0020 — Plantilla de menú mensual (un día = un menú propio)**: descartado el modelo semanal recurrente porque no encaja con festivos, vacaciones y servicios especiales (escuela de verano). Modelo: una `plantillas_menu_mensual` por (centro, mes, año, estado) + N `menu_dia` (uno por día abierto). Trade-off: más filas (~22 menu_dia/mes vs 7 weekly slots), a cambio de fidelidad total al calendario real.

- **ADR-0021 — Extensión de `comidas` con `tipo_plato` vs tabla separada**: alternativa rechazada era crear `comida_platos` 1:N a `comidas`. Decisión: extender `comidas` con `tipo_plato NULL` + índice único parcial. Razones: (1) las F3 queries siguen funcionando sin cambios; (2) la agenda del niño muestra "comida" de forma unificada (con o sin platos); (3) el batch del pase de lista hace UPSERT atómico vía el índice parcial. Coste: una tabla con shape ligeramente bicéfalo (filas pre-F4.5b con tipo_plato=NULL, filas post con NOT NULL).

- **ADR-0022 — Escala 1-5 en UI mapeada al enum `cantidad_comida` existente**: no se crea enum nuevo. Razón: la BD ya tiene 5 valores semánticamente correctos. Cambiar el enum a `1`/`2`/`3`/`4`/`5` rompería F3 y los informes futuros. La UI muestra números (más rápido, menos cognición); las traducciones humanizan a "Casi todo" / "Nada" / etc. para la agenda y los informes.

## Limitaciones conocidas

- **Sin importación de menús**: la cocina entrega el menú en PDF/Excel; el admin lo transcribe a mano cada mes. Importación automática queda fuera de Ola 1.
- **Sin granularidad por aula**: el menú es del centro entero. Si en el futuro las aulas pequeñas (lactantes) tuvieran menús distintos, se añadiría una columna `aula_id NULL` a `menu_dia` o una tabla intermedia. No hay caso real en ANAIA.
- **Sin alérgenos por plato**: el menú actual no estructura alérgenos. La profe sigue mirando `info_medica_emergencia.alergias_graves` aparte. Ola 2 podría añadir `alergenos jsonb` a `menu_dia`.
- **Override de tupper no llega a la familia**: por diseño (B56), el widget familia muestra el menú estándar. Si la familia mandó tupper, la propia familia lo sabe; la profe lo ve. No es información que valga la pena mostrar a la familia en la UI del menú (sí en la cantidad guardada para esa fila).

## Referencias

- ADR-0011 — Timezone Europe/Madrid (helpers de fecha).
- ADR-0013 / ADR-0016 — Ventana de edición transversal (el pase de lista de comida hereda).
- ADR-0014 — `<PaseDeListaTable />` reusable (caso de uso #2: comida).
- ADR-0015 — Asistencia lazy (mismo principio para `comidas` del pase de lista).
- ADR-0019 — Calendario laboral default + excepciones (base para "qué días tienen menú").
- Spec `school-calendar.md` — F4.5a.
- Spec `daily-agenda.md` — F3: tabla `comidas` original.
- Spec `attendance.md` — F4: patrón `<PaseDeListaTable />`.

---

**Workflow:**

1. Spec `draft`.
2. Responsable revisa y aprueba (→ `approved`).
3. Migración + RLS + helpers + tests (Checkpoint B). **Mostrar la migración antes de aplicar — toca `comidas`.**
4. Feature + UI admin + UI profe + UI familia + i18n + E2E + ADRs (Checkpoint C).
5. Merge + deploy (→ `done`).
