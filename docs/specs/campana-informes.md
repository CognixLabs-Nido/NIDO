---
feature: campana-informes
wave: 1
status: draft
priority: medium
last_updated: 2026-06-10
related_adrs: [ADR-0042, ADR-0043, ADR-0037, ADR-0025]
related_specs: [informes-evolucion, reminders-c]
---

# Spec — Campaña de informes (F9-5)

## Resumen ejecutivo

La dirección **abre una campaña** de informes para un (curso académico, período) con una **fecha límite**; a las profes les aparece en su **INICIO** un aviso con los informes que les **faltan por completar** (urgente al acercarse/pasar la fecha); la dirección ve un **seguimiento** (hechos vs pendientes por aula/profe); y la profe puede **publicar en lote** los informes completos de su aula. Es una **capa de coordinación** sobre la F9 existente: **no bloquea ni habilita** el flujo de informes, que sigue funcionando por su cuenta.

## Contexto

F9 (informes de evolución) cubre crear → rellenar → publicar (F9-2), vista familia + aviso (F9-3) y PDF (F9-4). Lo que falta es la **gestión de plazos** a nivel de centro: hoy nada le dice a la profe "te quedan 6 informes para el 2.º trimestre y vence el 20", ni le da a la dirección una foto del avance. Esta necesidad estaba anotada como diferida en `docs/roadmap.md` (§F9-5 — Campaña de informes: _"La dirección fija una fecha límite por período/curso y a las profes les aparecen los informes pendientes de completar en su panel de INICIO, reusando el sistema de avisos de inicio (PR #64)"_).

Reusa dos piezas ya construidas:

- **Avisos de INICIO (PR #64)** — feed **derivado** por rol/ámbito (sin tabla de avisos): se cuenta contra la RLS de la tabla origen y, donde aplica, un marcador "visto" en `preferencias_usuario`. F9-3 ya añadió ahí el aviso de "informes publicados nuevos" para la familia.
- **Capa de informes F9** — tablas `plantillas_informe` / `informes_evolucion`, helpers RLS row-aware (`usuario_es_audiencia_informe_row`, `es_redactor_de_nino`, `es_profe_en_centro`, `es_admin`), y la lógica de publicación de F9-2 (`publicarInforme`: exige todos los ítems valorados — Q9 — y sella `notificado_at` en la 1.ª publicación — Q8).

> **Principio rector (no negociable): la campaña es una CAPA, no una PUERTA.** No bloquea ni habilita crear/rellenar/publicar/despublicar informes. Aunque no haya campaña abierta, todo F9 funciona igual. La campaña solo **añade**: fecha límite (informativa), aviso de pendientes, seguimiento para dirección, y publicar en lote.

## User stories

- US-01: Como **directora**, quiero **abrir una campaña** de informes para un período y curso con una **fecha límite**, para coordinar a las profes en la entrega de boletines.
- US-02: Como **directora**, quiero **ver el seguimiento** (publicados vs pendientes por aula y por profe) de la campaña, para saber quién va al día y quién no.
- US-03: Como **directora**, quiero **cerrar** una campaña cuando ya no aplica, para que deje de generar avisos.
- US-04: Como **profe**, quiero ver en mi **INICIO** los informes que me **faltan por completar** para la campaña y su **fecha límite**, con aviso **urgente** al acercarse/pasar, para no olvidarme.
- US-05: Como **profe**, quiero **publicar de una vez** todos los informes **completos** de mi aula para la campaña, y que se me indique **cuáles se quedan en borrador** por estar incompletos, para ahorrar clics sin saltarme la regla de "todos los ítems valorados".

## Alcance

**Dentro:**

- Tabla nueva `campanas_informe` (centro + curso + período + fecha límite + estado).
- Pantalla **dirección**: abrir/cerrar campaña + **vista de seguimiento** (hechos vs pendientes por aula/profe), en la zona de Informes del admin (`/admin/informes`).
- **Aviso derivado en INICIO de la profe**: nº de informes pendientes de la(s) campaña(s) abierta(s) + fecha límite; **urgente (rojo)** al acercarse/pasar la fecha. Mismo patrón derivado de #64 (sin tabla de avisos).
- **Publicar en lote por aula** (acción de la profe): publica todos los informes **completos** de su aula para el (curso, período) de la campaña; los incompletos se quedan en borrador y se listan. Cada publicación reusa la lógica de F9-2 (dispara el aviso a la familia + sella `notificado_at`).
- RLS row-aware sobre `campanas_informe`; i18n es/en/va; ADR nuevo.

**Fuera (no se hace aquí):**

- **No** cambia el flujo individual de informes (crear/rellenar/publicar/despublicar de F9-2 intacto). La campaña no es pre-requisito de nada.
- **No** crea tabla de avisos ni push nuevo: el aviso de pendientes es **derivado** (in-app, patrón #64). _(Si en el futuro se quiere push al abrir campaña, sería trabajo aparte.)_
- **No** modela "informe no aplica a este niño" como entidad propia (ver preguntas abiertas sobre matrículas parciales/bajas).
- **No** añade recordatorios automáticos por email ni escalado temporal (más allá del cambio de color del aviso).
- **No** toca el modelo de `informes_evolucion` (la campaña no añade columnas a esa tabla; el vínculo es por (centro, curso, período), no por FK informe→campaña). _(Ver pregunta abierta si se prefiere FK.)_

## Comportamientos detallados

### Comportamiento 1: Abrir una campaña (dirección)

**Pre-condiciones:**

- Usuario `admin` del centro.
- Existe un curso académico (se usa el **activo** por defecto; ver pregunta abierta sobre campañas de cursos pasados).

**Flujo:**

1. En `/admin/informes`, la directora pulsa "Abrir campaña".
2. Elige **período** (`trimestre_1`/`trimestre_2`/`trimestre_3`/`fin_curso`) y **fecha límite** (date).
3. Se valida que no exista ya una campaña para ese (centro, curso, período) — **único** por esa terna.
4. Se inserta la fila en `campanas_informe` con `estado='abierta'`, `created_by = auth.uid()`.

**Post-condiciones:**

- A partir de ese momento, el INICIO de las profes con niños sin informe publicado de ese (curso, período) muestra el aviso de pendientes.
- La directora ve la campaña en la vista de seguimiento.

### Comportamiento 2: Aviso de pendientes en el INICIO de la profe (derivado)

**Pre-condiciones:**

- Existe ≥1 campaña `abierta` del curso para un período.
- La profe es redactora (`coordinadora`/`profesora`) de ≥1 aula con niños sin informe publicado de ese (curso, período).

**Flujo (cálculo, sin tabla de avisos):**

1. Para cada campaña abierta del centro/curso, se computan los **pendientes de la profe**: niños matriculados (activos) en las aulas donde la profe es **redactora**, que **no** tienen informe `publicado` del (curso, período) de la campaña. Un **borrador cuenta como pendiente** (decisión cerrada 2).
2. El aviso muestra: período + nº de pendientes + **fecha límite**.
3. **Urgencia por fecha:** el aviso pasa a **rojo (urgente)** cuando `hoy >= fecha_limite - UMBRAL` o ya venció (`hoy > fecha_limite`). Antes del umbral, estilo informativo normal. _(UMBRAL concreto en Validaciones; p. ej. 3 días — a confirmar.)_

**Post-condiciones:**

- El aviso **no se "marca como visto"**: es un contador de estado real (como `pendientesConfirmar` en #64), no una novedad. Desaparece **solo** cuando los pendientes llegan a 0 (todos publicados) o se cierra la campaña.

### Comportamiento 3: Seguimiento de la campaña (dirección)

**Pre-condiciones:**

- Usuario `admin` del centro; campaña existente (abierta o cerrada).

**Flujo:**

1. En `/admin/informes`, sección de la campaña, la directora ve una tabla **por aula** (y dentro, por profe redactora) con: nº de informes **publicados** vs **pendientes** para el (curso, período).
2. Totales del centro arriba (X de Y publicados).

**Post-condiciones:** solo lectura; no muta nada.

### Comportamiento 4: Publicar en lote por aula (profe)

**Pre-condiciones:**

- Usuario profe **redactor** (`coordinadora`/`profesora`) del aula.
- Existe campaña `abierta` del (curso, período) — _(o, si se decide permitir lote sin campaña, ver pregunta abierta; por defecto el botón aparece en contexto de campaña)_.

**Flujo:**

1. En la lista de informes de la profe (`/teacher/informes`), botón **"Publicar todos"** del aula para la campaña.
2. El server action recorre los informes de los niños del aula para el (curso, período):
   - Para cada informe **completo** (regla F9-2: `todosValorados` = todos los ítems del snapshot valorados) y en `borrador`: lo **publica** reusando exactamente la lógica de `publicarInforme` (estado → `publicado`, `publicado_at`, y `notificado_at = notificado_at ?? now()` → dispara el aviso a la familia solo la 1.ª vez, Q8).
   - Los **incompletos** se **quedan en borrador** y se devuelven en una lista "no publicados (faltan ítems)".
   - Los ya publicados se ignoran (idempotente).
3. La UI muestra el resultado: "N publicados · M sin publicar (incompletos)", con el detalle de cuáles.

**Post-condiciones:**

- Los informes completos pasan a `publicado` y la familia recibe su aviso (F9-3) por cada uno recién publicado.
- Baja el contador de pendientes del INICIO de la profe.
- Atomicidad: ver pregunta abierta / decisión técnica (¿todo-o-nada vs best-effort por informe?). Recomendación: **best-effort por informe** (publica los que puede; reporta los que no), porque "todo-o-nada" haría que un solo informe incompleto impidiera publicar el resto, contradiciendo la US-05.

### Comportamiento 5: Cerrar una campaña (dirección)

**Pre-condiciones:** usuario `admin`; campaña `abierta`.

**Flujo:** la directora pulsa "Cerrar campaña" → `estado='cerrada'`.

**Post-condiciones:** deja de generar el aviso de pendientes en el INICIO de las profes. **No** toca los informes (los borradores siguen existiendo; se pueden seguir publicando individualmente por F9-2). _(Semántica exacta de "cerrar" → pregunta abierta.)_

## Casos edge

- **Sin campaña abierta**: el INICIO de la profe no muestra aviso de campaña; el flujo F9 individual sigue disponible. La zona admin muestra "No hay campaña abierta para este período".
- **Sin pendientes**: si la profe ya tiene todos publicados, el aviso no aparece (contador 0). El botón "Publicar todos" no publica nada (0 publicados) y lo indica.
- **Fecha límite pasada**: no bloquea; el aviso queda en rojo "vencida hace N días" y se puede seguir publicando (decisión cerrada 3).
- **Varias campañas abiertas a la vez** (p. ej. trimestre_1 y trimestre_2): cómo se agrega el aviso → **pregunta abierta**.
- **Sin permisos**: una profe `tecnico`/`apoyo` (no redactora) no ve el aviso de pendientes ni el botón "Publicar todos" (no es audiencia de creación/publicación en F9). Un tutor nunca ve nada de campaña. Un admin de otro centro no ve la campaña (aislamiento).
- **Niño con matrícula parcial / baja a mitad de período**: ¿cuenta como pendiente? → **pregunta abierta**.
- **Niño sin plantilla/informe creado todavía**: cuenta como pendiente (no hay informe publicado). La profe debe crearlo (F9-2) y publicarlo; "Publicar todos" **no crea** informes, solo publica los existentes y completos. _(¿Debería "Publicar todos" crear los que falten desde una plantilla? → pregunta abierta.)_
- **Concurrencia**: dos profes redactoras de la misma aula pulsan "Publicar todos" a la vez → idempotente por informe (publicar un informe ya publicado no hace nada; patrón "USING falso → 0 filas" + `.select().maybeSingle()`).
- **Campaña duplicada**: el índice único `(centro, curso, período)` rechaza una segunda campaña para la misma terna; la UI lo traduce a un error claro.
- **Idiomas**: fecha límite formateada por locale; el contenido del informe sigue en castellano (F9). Plurales en el aviso ("1 informe pendiente" / "N informes pendientes").
- **Borrado / soft delete**: `campanas_informe` no se borra físicamente; "cerrar" = UPDATE de estado (DELETE bloqueado por default DENY, patrón del proyecto). _(¿`deleted_at`? → ver modelo / pregunta abierta.)_
- **Permisos cambiados a media sesión**: si una profe deja de ser redactora del aula, deja de ver el aviso/botón en la siguiente navegación (RLS recalcula).

## Validaciones (Zod)

```typescript
// Espejo del ENUM existente periodo_informe (F9-0).
export const periodoInformeEnum = z.enum(['trimestre_1', 'trimestre_2', 'trimestre_3', 'fin_curso'])

// Abrir campaña (el curso por defecto = activo; ver pregunta abierta).
export const abrirCampanaSchema = z.object({
  periodo: periodoInformeEnum,
  fecha_limite: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'campana.validation.fecha_invalida'),
  // curso_academico_id se resuelve en el server (curso activo) salvo decisión contraria.
})

// Cerrar campaña.
export const cerrarCampanaSchema = z.object({
  campana_id: z.string().uuid(),
})

// Publicar en lote (por aula, para una campaña).
export const publicarLoteSchema = z.object({
  campana_id: z.string().uuid(),
  aula_id: z.string().uuid(),
})
```

- **UMBRAL de urgencia** del aviso: constante a fijar (propuesta: 3 días naturales antes de `fecha_limite`). _(A confirmar.)_
- La regla de publicación (todos los ítems valorados) **no** se revalida en el schema del lote: se reusa `todosValorados(snapshot, respuestas)` de F9 por cada informe en el server action.

## Modelo de datos afectado

**Tablas nuevas:**

- `campanas_informe`
  - `id uuid PK`
  - `centro_id uuid NOT NULL` → `centros` ON DELETE CASCADE
  - `curso_academico_id uuid NOT NULL` → `cursos_academicos` **RESTRICT** (patrón F9)
  - `periodo periodo_informe NOT NULL` (ENUM existente)
  - `fecha_limite date NOT NULL`
  - `estado` ENUM nuevo `estado_campana_informe` (`abierta`/`cerrada`) NOT NULL DEFAULT `abierta`
  - `created_by uuid NOT NULL` → `usuarios` RESTRICT
  - `created_at`/`updated_at timestamptz`
  - **UNIQUE `(centro_id, curso_academico_id, periodo)`** — una campaña por terna.
  - **Se audita** (`centro_id` directo), patrón del proyecto. **DELETE bloqueado** (cerrar = UPDATE de estado).
  - _(Decidir si lleva `deleted_at` — propuesta: NO; "cerrar" es el estado terminal. Ver pregunta abierta.)_

**Tablas modificadas:** ninguna. _(En particular, `informes_evolucion` **no** gana FK a la campaña: el vínculo es lógico por (centro, curso, período). Ver pregunta abierta sobre añadir `campana_id` por trazabilidad.)_

**Tablas consultadas (derivación de pendientes y seguimiento):** `campanas_informe`, `profes_aulas`, `aulas`, `matriculas`, `ninos`, `informes_evolucion`, `cursos_academicos`.

**ENUM nuevo:** `estado_campana_informe` (`abierta`/`cerrada`).

## Políticas RLS

Patrón row-aware de F8/F9 (helpers `SECURITY DEFINER STABLE`, sin re-leer la propia tabla → evita el gotcha MVCC en `INSERT…RETURNING`). Reusa `es_admin(centro_id)`, `es_profe_en_centro(centro_id)`, `es_redactor_de_nino`, `pertenece_a_centro`.

```sql
-- campanas_informe
-- SELECT: staff del centro (admin lee/gestiona; profe necesita leer la campaña
-- para su aviso/lote). La familia NO accede (igual que plantillas_informe en F9-0).
CREATE POLICY campanas_informe_select ON public.campanas_informe
  FOR SELECT USING (
    public.es_admin(centro_id) OR public.es_profe_en_centro(centro_id)
  );

-- INSERT / UPDATE: solo admin del centro (abrir, cerrar, editar fecha).
CREATE POLICY campanas_informe_insert ON public.campanas_informe
  FOR INSERT WITH CHECK (public.es_admin(centro_id) AND created_by = auth.uid());

CREATE POLICY campanas_informe_update ON public.campanas_informe
  FOR UPDATE USING (public.es_admin(centro_id)) WITH CHECK (public.es_admin(centro_id));

-- DELETE: sin policy → default DENY. Cerrar = UPDATE estado='cerrada'.
```

- **Publicar en lote** no necesita policy nueva: cada publicación individual pasa por `informes_evolucion_update` de F9 (`es_admin OR es_redactor_de_nino`). El server action solo itera y reusa la lógica de F9-2.
- **MVCC**: `campanas_informe_select` no usa helper que re-lea `campanas_informe` (los helpers leen `roles_usuario`/`profes_aulas`), así que `.insert().select()` por el admin funciona. Test explícito como bloqueo de regresión.

## Pantallas y rutas

- `/admin/informes` — se **amplía** (no ruta nueva) con: bloque "Campaña" (abrir/cerrar por período + fecha) y **vista de seguimiento** (tabla por aula/profe, publicados vs pendientes). _(Alternativa: subruta `/admin/informes/campana` — a decidir en diseño.)_
- `/teacher/informes` — la lista de la profe gana el botón **"Publicar todos"** por aula (visible solo si hay campaña abierta del período y la profe es redactora).
- **INICIO de la profe** (`/teacher` / dashboard) — el componente de avisos de INICIO (#64) muestra el aviso derivado de campaña. Sin ruta nueva.

## Componentes UI

- `CampanaAdminPanel.tsx` (Server + acciones) — abrir/cerrar campaña; lee la campaña vigente del período.
- `AbrirCampanaDialog.tsx` (Client) — período + fecha límite (react-hook-form + Zod).
- `SeguimientoCampana.tsx` (Server) — tabla por aula/profe (publicados vs pendientes); reusa el agrupado de `getInformesDeMisAulas` adaptado a "todas las aulas del centro".
- `PublicarLoteButton.tsx` (Client) — botón "Publicar todos" + diálogo de confirmación + toast con el resumen (N publicados / M incompletos con detalle).
- Aviso de INICIO: **extiende** el componente `AvisosInicio` de #64 (nuevo banner para staff con `informesPendientesCampana` + fecha + variante urgente roja), análogo a cómo F9-3 añadió `informesNuevos` para familia.

## Eventos y notificaciones

- **Push / aviso a la familia**: lo dispara **cada publicación individual** dentro del lote, reusando F9-2 (`notificado_at` se sella la 1.ª vez; republicar no re-avisa — Q8). La campaña en sí **no** añade push propio.
- **Aviso a la profe**: **in-app derivado** (patrón #64), sin tabla ni push. Se recalcula en cada carga del INICIO.
- **Audit**: INSERT/UPDATE de `campanas_informe` quedan en `audit_log` (trigger, `centro_id` directo). Abrir/cerrar/editar fecha trazados.

## i18n

Namespace nuevo `campana` (o sub-bloque dentro de `informes` — a decidir). Claves es/en/va:

```json
{
  "campana": {
    "title": "Campaña de informes",
    "abrir": "Abrir campaña",
    "cerrar": "Cerrar campaña",
    "periodo": "Período",
    "fecha_limite": "Fecha límite",
    "estado": { "abierta": "Abierta", "cerrada": "Cerrada" },
    "seguimiento": {
      "titulo": "Seguimiento",
      "publicados": "Publicados",
      "pendientes": "Pendientes",
      "por_aula": "Por aula",
      "total": "{publicados} de {total} publicados"
    },
    "aviso_pendientes": "{n, plural, one {Te queda # informe por completar} other {Te quedan # informes por completar}} · vence el {fecha}",
    "aviso_urgente": "{n, plural, one {# informe pendiente} other {# informes pendientes}} · vence el {fecha}",
    "aviso_vencida": "{n, plural, one {# informe pendiente} other {# informes pendientes}} · venció el {fecha}",
    "publicar_todos": "Publicar todos",
    "publicar_lote_resultado": "{publicados} publicados · {incompletos} sin publicar (faltan ítems)",
    "validation": {
      "fecha_invalida": "Fecha inválida. Formato AAAA-MM-DD.",
      "campana_duplicada": "Ya existe una campaña para este período y curso."
    },
    "errors": {
      "no_autorizado": "No tienes permiso para gestionar campañas de informe.",
      "creacion_fallo": "No se pudo abrir la campaña.",
      "cierre_fallo": "No se pudo cerrar la campaña.",
      "lote_fallo": "No se pudieron publicar los informes."
    }
  }
}
```

## Accesibilidad

- Aviso urgente: el color rojo **no** es el único indicador — texto explícito ("vence el…/venció el…") + icono; contraste AA.
- Diálogos (abrir campaña, confirmar lote) navegables con teclado; `aria-busy` en submit.
- Tabla de seguimiento con cabeceras de fila/columna asociadas (`scope`).

## Performance

- Derivación de pendientes: 1 query de informes publicados del (curso, período) filtrada por niños de las aulas relevantes (agregación en memoria, como `getInformesDeMisAulas`). Índice sugerido: `informes_evolucion (curso_academico_id, periodo, estado)` y/o `(nino_id, curso_academico_id, periodo)` (ya hay UNIQUE en la terna).
- Seguimiento admin: una sola pasada por las aulas del centro; evitar N+1 (batch por `in('nino_id', …)`).
- El aviso de INICIO se computa server-side en la carga del dashboard (sin coste cliente).

## Telemetría

- `campana_abierta` — la dirección abre una campaña (sin PII; período + ¿días hasta fecha límite?).
- `campana_cerrada`.
- `informes_publicados_lote` — nº publicados / nº incompletos (sin PII).

## Tests requeridos

**Vitest (unit/integration):**

- [ ] Schemas Zod (abrir/cerrar/lote) validan correctos e incorrectos.
- [ ] Derivación de pendientes: dado un set de niños/informes, cuenta bien publicados vs pendientes (borrador = pendiente).
- [ ] Publicar en lote: publica solo los completos, deja incompletos en borrador, devuelve el detalle; idempotente sobre ya-publicados.
- [ ] Cálculo de urgencia por fecha (antes de umbral / dentro de umbral / vencida).
- [ ] Trigger de audit_log registra abrir/cerrar.

**Vitest (RLS):**

- [ ] Profe del centro lee la campaña; familia NO; admin de otro centro NO (aislamiento).
- [ ] Solo admin inserta/actualiza `campanas_informe`; profe NO.
- [ ] `.insert().select()` por el admin funciona (regresión del gotcha MVCC).
- [ ] Publicar en lote: una profe `tecnico`/`apoyo` no puede publicar (hereda RLS de `informes_evolucion_update`); profe de otra aula no publica informes ajenos.

**Playwright (E2E):**

- [ ] La directora abre una campaña; la profe ve el aviso de pendientes en INICIO con la fecha.
- [ ] La profe pulsa "Publicar todos"; los completos se publican (la familia los ve) y los incompletos quedan listados.

## Criterios de aceptación

- [ ] Todos los tests listados pasan en CI.
- [ ] La campaña **no** altera el flujo individual de F9 (verificado: con campaña cerrada/sin campaña, crear/rellenar/publicar funciona igual).
- [ ] El aviso de pendientes aparece/desaparece según estado real (0 pendientes → sin aviso) y se pone urgente al acercarse/pasar la fecha.
- [ ] Las 3 lenguas (es/en/va) tienen todas las claves.
- [ ] axe-core sin violations en las pantallas afectadas; el rojo no es el único indicador de urgencia.
- [ ] ADR escrito (modelo de campaña + derivación de pendientes + capa-no-puerta).
- [ ] `docs/architecture/data-model.md` y `rls-policies.md` actualizados (tabla + ENUM + policies).

## Decisiones técnicas relevantes

- **ADR nuevo (propuesto)** — Modelo de campaña de informes: tabla `campanas_informe` (única por centro/curso/período) + **pendientes derivados** (sin tabla de avisos, patrón #64) + **capa no-puerta** (no bloquea F9) + publicar en lote reusando `publicarInforme` de F9-2. Alternativas a discutir: (a) añadir `campana_id` a `informes_evolucion` (trazabilidad fuerte) vs vínculo lógico por terna (elegido por simplicidad); (b) lote todo-o-nada vs best-effort (recomendado best-effort).
- Reusa ADR-0042 (modelo informes), ADR-0037/#64 (avisos derivados + `preferencias_usuario`), ADR-0025 (canal de aviso a la familia en publicación).

## Referencias

- Spec relacionada: `docs/specs/informes-evolucion.md` (F9; Q8 no re-aviso, Q9 todos los ítems valorados).
- `docs/roadmap.md` §F9-5 — Campaña de informes (origen de la necesidad).
- PR #64 — avisos de INICIO (feed derivado + marcador en `preferencias_usuario`).
- ADR-0042 (modelo informes), ADR-0043 (PDF), ADR-0025 (canal aviso familia).

---

## Preguntas abiertas (NO decididas — para el responsable)

1. **Varias campañas abiertas a la vez.** ¿Se permite tener abiertas simultáneamente, p. ej., `trimestre_1` y `trimestre_2`? El índice único es por (centro, curso, período), así que **técnicamente** podrían coexistir. Si se permite: **¿cómo se agrega el aviso de la profe** cuando hay varias? (¿un aviso por campaña? ¿uno consolidado con el total y la fecha más próxima/urgente?). Si NO se permite: ¿restringimos a una campaña abierta por centro a la vez (validación extra)?

2. **¿La directora también puede publicar en lote, o solo la profe?** Decisión cerrada 5 dice "por defecto solo la profe". ¿Habilitamos también a la directora (es_admin) a "Publicar todos" de un aula / de todo el centro? La RLS de `informes_evolucion_update` ya se lo permite; es una decisión de **UX/producto**, no técnica.

3. **Niños que no deberían tener informe** (matrícula a mitad de período, bajas, altas posteriores a la fecha de corte): ¿**cuentan como pendientes**? Si no, **¿cuál es la regla de corte** (fecha de matrícula vs fecha de la campaña, baja activa, etc.)? Hoy la propuesta los contaría a todos los matriculados activos.

4. **Qué hace exactamente "cerrar" una campaña.** Propuesta mínima: `estado='cerrada'` → deja de generar el aviso de pendientes; no toca informes. ¿Debe además **congelar el seguimiento** (foto final), **impedir reabrir**, o permitir reabrir? ¿Se puede **editar la fecha límite** de una campaña abierta?

5. **¿"Publicar todos" debería también CREAR los informes que falten** desde una plantilla (para niños sin informe aún), o solo publicar los que ya existen y están completos? La propuesta actual **solo publica** (no crea); crear sigue siendo F9-2 individual. ¿Suficiente?

6. **Vínculo informe↔campaña.** ¿Basta el vínculo lógico por (centro, curso, período), o quieres una **FK `campana_id` en `informes_evolucion`** para trazar "este informe se publicó en el marco de la campaña X"? Afecta a auditoría/analítica, no al flujo.

7. **Curso de la campaña.** ¿Siempre el **curso activo**, o se permite abrir campañas de **cursos pasados** (para corregir/recopilar histórico)? F9 no tiene ventana temporal (Q6), así que técnicamente cabría.

8. **Atomicidad del lote** (decisión técnica con cara de producto): ¿**best-effort** (recomendado: publica los completos, reporta los incompletos) o **todo-o-nada** (no publica nada si hay algún incompleto)? Recomiendo best-effort por la US-05.

9. **Umbral de urgencia** del aviso rojo: ¿cuántos días antes de `fecha_limite` se pone en rojo? (propuesta: 3 días naturales).
