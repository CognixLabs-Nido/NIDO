---
feature: informes-evolucion
wave: 1
status: approved
priority: high
last_updated: 2026-06-09
related_adrs: [ADR-0025, ADR-0032, ADR-0011]
related_specs: [scope-ola-1, pedagogical-data, autorizaciones-firma]
---

# Spec — Informes de evolución (F9)

> **Estado: approved.** Las 11 preguntas abiertas quedaron resueltas por el responsable (ver §Resoluciones de diseño Q1–Q11) e incorporadas al cuerpo de la spec. Esta spec es **solo documentación**: no toca código ni migraciones. La implementación arranca en F9-0 tras el merge.

## Resumen ejecutivo

Informes de evolución del niño (boletines de desarrollo): documentos cualitativos, estructurados en **áreas → ítems**, que la profe del aula rellena por niño y período, y que la familia consulta y descarga en PDF cuando están **publicados**. No es el parte diario (eso es la agenda de F3); es la valoración pedagógica periódica del desarrollo del niño.

## Contexto

El centro necesita comunicar a las familias la evolución pedagógica de cada niño de forma periódica (boletín por trimestre + fin de curso), más allá del día a día que ya cubre la agenda diaria (F3). F9 es la fase prevista en el plan (`scope-ola-1.md`, fila 9 «Informes de evolución») y descansa sobre dos tablas del módulo Operativo aún sin implementar: `plantillas_informe` + `informes_evolucion` (`docs/architecture/data-model.md`).

Decisiones ya tomadas en fases anteriores que F9 hereda:

- **ADR-0012** eligió 5 tablas separadas para la agenda «pensando en queries analíticas de Fase 9». **F9 NO usa esas queries automáticas** (ver §Alcance/Fuera): los informes son cualitativos, no agregan datos de la agenda.
- **ADR-0025/ADR-0028** dejaron el canal push (F5.5) listo «para que F9 lo enchufe» en «informes publicados». F9 usa ese canal para el aviso de publicación.
- **ADR-0032** introdujo el ENUM `tipo_personal_aula` (`coordinadora`/`profesora`/`tecnico`/`apoyo`) anticipando explícitamente «Informes (F9): autoría y visibilidad según tipo de personal». F9 concreta ese corte (ver §Roles).
- **ADR-0041 §F9–F11** dejó constancia de que el modelo de F8 condiciona F9; el **acuse de recibo** de la familia, si se quiere, se construiría reusando el mecanismo de firma de F8 y queda **FUERA de F9** (ver §Alcance/Fuera).

## Roles

| Rol                                    | Sobre informes                                                                                                    |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Dirección (admin)**                  | Crea y edita **plantillas** de informe. Puede ver, redactar, publicar y despublicar cualquier informe del centro. |
| **Profe del aula**                     | **Rellena** el informe de cada niño de **su** aula (vía `profes_aulas` activo). Pasa de borrador a publicado.     |
| **Familia (tutor_legal / autorizado)** | **Solo lectura**: ve y descarga en PDF los informes **publicados** de su hijo. No edita, no firma.                |

### Corte por tipo de personal (ADR-0032) — resuelto (Q5)

Respetando la clasificación `tipo_personal_aula`:

- **Redactan y publican** (borrador → publicado, despublicar, corregir, republicar): `coordinadora` y `profesora` del aula.
- **Solo lectura** del informe (dentro del staff del aula): `tecnico` y `apoyo`.
- **Dirección (admin)** puede todo: crear plantillas, redactar, publicar y despublicar cualquier informe del centro.
- **Sin paso de visto bueno separado**: quien redacta publica directamente; no hay una etapa de aprobación intermedia entre profesora y coordinadora/dirección.

## User stories

- **US-01**: Como **dirección**, quiero definir una o varias plantillas de informe (áreas e ítems) para que las profes valoren a los niños con un criterio común.
- **US-02**: Como **dirección**, quiero editar una plantilla cuando cambie el criterio pedagógico, sin que se alteren los informes ya creados a partir de la versión anterior.
- **US-03**: Como **profe del aula**, quiero rellenar el informe de un niño para un período (1.er/2.º/3.er trimestre o fin de curso), eligiendo la plantilla, valorando cada ítem (Conseguido / En proceso / No iniciado) y añadiendo comentarios, guardándolo como borrador hasta que esté listo.
- **US-04**: Como **profe del aula**, quiero publicar el informe cuando esté completo para que la familia pueda verlo, y que la familia reciba un aviso.
- **US-05**: Como **profe/dirección**, quiero corregir un informe ya publicado (despublicar → editar → republicar) cuando detecte un error, sin volver a molestar a la familia con un aviso.
- **US-06**: Como **familia**, quiero ver y descargar en PDF los informes **publicados** de mi hijo, sin poder editarlos.
- **US-07**: Como **familia**, quiero recibir un aviso in-app cuando se publique por primera vez un informe de mi hijo.

## Alcance

**Dentro:**

- Gestión de **plantillas de informe** por la dirección: estructura **áreas → ítems**. Una dirección puede crear **varias plantillas** por centro y nombrarlas libremente (Q1).
- Cada **ítem** se valora con una **escala de 3**: `Conseguido` / `En proceso` / `No iniciado`, más un **comentario libre opcional** por ítem.
- Un campo de **observaciones generales** (opcional) al final del informe.
- Un informe por **niño + curso académico + período**, con **4 períodos por curso**: `1.er trimestre`, `2.º trimestre`, `3.er trimestre`, `fin de curso`.
- Al crear el informe, la profe **elige la plantilla** y el informe **congela la estructura** de esa plantilla en ese momento (snapshot, Q3).
- Ciclo de estados **Borrador → Publicado**, con **despublicar/corregir/republicar** (las republicaciones **no** re-avisan).
- Vista lectora + **descarga en PDF (server-side, en castellano)** para la familia, solo de informes **publicados**.
- **Aviso in-app en la primera publicación** a la familia por el canal existente (ADR-0025).
- **i18n es/en/va** en toda la **interfaz** (el **contenido** de plantillas e informes se escribe en castellano, ver Q10).
- RLS de aislamiento (aula/familia) con tests obligatorios.

**Fuera (no se hace aquí):**

- **Datos automáticos de la agenda diaria** (medias de sueño, comida, biberones, percentiles). F9 es valoración **cualitativa**; no agrega ni inserta cifras de F3. (Las queries analíticas que ADR-0012 anticipaba quedan para una fase posterior si se decide.)
- **Firma / acuse de recibo de la familia.** La familia **no firma**. Un acuse de recibo (confirmación de lectura legalmente trazable) sería un añadido futuro reusando el mecanismo de F8 (ADR-0041) y queda **fuera de F9**.
- **Versionado formal del informe** (historial de revisiones con diffs). En F9 corregir = despublicar/editar/republicar sin guardar versiones anteriores (Q3).
- **Plantillas multilingües.** El contenido de áreas/ítems va en castellano (Q10); no se traduce a en/va.
- **Comparativa entre períodos / gráficas de progreso.** Posible Ola 3.
- **Adjuntos** (fotos, evidencias) en el informe → ligado a `media` de **F10**.
- **App nativa / offline real** → Ola 2.

## Comportamientos detallados

### Comportamiento 1: Dirección define/edita la plantilla

**Pre-condiciones:**

- Usuario con rol `admin` del centro.

**Flujo:**

1. Dirección abre `/admin/informes` y crea/edita una plantilla. Puede tener **varias** plantillas en el centro; las nombra como prefiera (p. ej. «Aula bebés», «1-2 años», «2-3 años»). El **tramo de edad NO se ata en el modelo**: es solo el nombre que le ponga la dirección (Q1).
2. Define una lista ordenada de **áreas** (p. ej. «Autonomía», «Lenguaje», «Psicomotricidad»…). Cada área tiene un título.
3. Dentro de cada área define una lista ordenada de **ítems** (frases evaluables). Cada ítem se valorará con la escala fija de 3. Todo el texto se escribe en **castellano** (Q10).
4. Guarda. La estructura queda asociada al centro.

**Post-condiciones:**

- La plantilla queda disponible para que las profes generen informes a partir de ella.
- Editar la plantilla después **no** altera los informes ya creados a partir de ella (cada informe guarda su snapshot, Q3/Q4): el cambio solo afecta a informes **nuevos**.
- El cambio queda en `audit_log`.

### Comportamiento 2: Profe rellena el informe de un niño

**Pre-condiciones:**

- Usuario `profe` de tipo `coordinadora` o `profesora` (Q5) asignado al aula activa del niño (`profes_aulas`).
- Existe al menos una plantilla en el centro.

**Flujo:**

1. La profe abre `/teacher/informes`, ve la lista de niños de su aula y, por niño, el estado del informe de cada período del curso activo.
2. Selecciona niño + período (p. ej. «2.º trimestre»). Si no existe informe para esa terna (niño, curso, período), **elige una plantilla** y se crea el informe en estado **Borrador**, **congelando la estructura** (áreas/ítems) de la plantilla elegida en ese momento (snapshot, Q3).
3. Para cada ítem, marca una valoración (`Conseguido` / `En proceso` / `No iniciado`) y, opcionalmente, escribe un comentario.
4. Rellena las **observaciones generales** (opcional).
5. Guarda como **Borrador** las veces que necesite; el borrador **puede estar incompleto** (Q9) y **no** es visible para la familia.

**Post-condiciones:**

- Las valoraciones y comentarios quedan persistidos.
- El informe sigue invisible para la familia hasta su publicación.
- Cambios quedan en `audit_log`.

### Comportamiento 3: Publicar / despublicar / corregir

**Pre-condiciones:**

- Informe en estado Borrador (para publicar) o Publicado (para despublicar/corregir).
- Usuario que redacta (`coordinadora`/`profesora` del aula) o dirección.

**Flujo (publicar):**

1. La profe pulsa «Publicar». **Validación previa: todos los ítems tienen valoración** (Q9). Los comentarios por ítem y las observaciones generales son opcionales.
2. El informe pasa a **Publicado**: pasa a ser **visible y descargable en PDF para la familia**, y **solo lectura para la familia**.
3. **Si es la primera publicación de ese informe**, se dispara el **aviso in-app** a los tutores/autorizados con permiso de lectura del niño (canal ADR-0025).

**Flujo (corregir un publicado):**

1. Profe/dirección **despublica** (vuelve a Borrador). Deja de ser visible para la familia.
2. Edita.
3. **Republica** → vuelve a ser visible. **NO se re-avisa** a la familia (Q8): el aviso es solo de la primera publicación.

**Post-condiciones:**

- Estado y `publicado_at`/`publicado_por` reflejan el último cambio; una marca interna recuerda si ya se notificó alguna vez (para no re-avisar).
- **Sin versionado formal** en F9: no se guarda el contenido anterior (Q3).
- Todos los cambios de estado quedan en `audit_log`.

> Resuelto: **publicado = solo lectura para la familia; profe/dirección puede despublicar, corregir y volver a publicar sin re-aviso, sin versionado formal en F9** (Q3 + Q8).

### Comportamiento 4: Familia consulta y descarga PDF

**Pre-condiciones:**

- **Tutor legal** del niño (ve siempre) o **autorizado** con permiso `puede_ver_datos_pedagogicos` (Q7).
- Informe en estado **Publicado**.

**Flujo:**

1. La familia abre la sección de informes de su hijo (`/family/informes`, ver §Pantallas).
2. Ve la lista de informes **publicados** (por curso y período). Los borradores no aparecen.
3. Abre uno en modo lectura y, si quiere, lo **descarga en PDF** (PDF generado en servidor, en castellano — Q10/Q11).

**Post-condiciones:**

- Ningún cambio de datos (solo lectura). Telemetría opcional de apertura/descarga (sin PII).

## Casos edge

- **Sin plantilla definida**: si la dirección no ha creado ninguna plantilla, la profe no puede iniciar informes; la UI muestra estado vacío explicando que falta la plantilla del centro.
- **Sin informes publicados (familia)**: la vista de familia muestra estado vacío («Aún no hay informes publicados»).
- **Informe no iniciado (profe)**: la lista muestra el período como «Sin iniciar» y permite crear el borrador (eligiendo plantilla).
- **Informe de período/curso pasado**: **sin cierre temporal** (Q6). Profe/dirección pueden editar y corregir informes de trimestres pasados o de cursos anteriores. F9 **no** sigue la regla de «día cerrado» de ADR-0016 (los informes no son hechos diarios).
- **Sin permisos**: una profe que no es del aula del niño, una profe `tecnico`/`apoyo` intentando redactar, o una familia que no es tutora del niño, recibe `forbidden` (RLS + guard de ruta).
- **Permisos cambiados a mitad de sesión**: si la profe deja de estar asignada al aula, pierde acceso de edición en la siguiente acción (RLS revalida en cada request).
- **Concurrencia (dos profes del mismo aula editando el mismo informe)**: por defecto **«último guardado gana»** con `updated_at`, sin bloqueo optimista en F9.
- **Editar la plantilla con informes ya creados**: los informes existentes conservan su estructura por snapshot (Q3/Q4); los nuevos usan la plantilla nueva. Un **borrador en curso conserva su snapshot** aunque la plantilla cambie a mitad de trimestre (Q4).
- **Despublicar un informe que la familia ya vio/descargó**: deja de ser visible online; el PDF ya descargado por la familia es una copia que no se puede revocar (limitación inherente, documentarla en el aviso de privacidad si procede).
- **Idiomas**: la **interfaz** va en es/en/va; el **contenido** (textos de áreas/ítems, comentarios, observaciones) se escribe y se muestra en **castellano** (Q10). Las etiquetas de la **escala** y de la UI sí van en i18n. Fechas/períodos formateados por locale.
- **Datos sensibles**: el informe describe el desarrollo de un menor → dato personal. Respeta minimización y el régimen RGPD del proyecto. No se cifra a nivel columna (no es info médica de emergencia), pero sí queda bajo RLS estricta y `audit_log`.
- **Borrado**: sin DELETE para la familia/profe. Corrección de error = despublicar/editar. DELETE bloqueado por default DENY.

## Validaciones (Zod)

```typescript
export const VALORACION_ITEM = ['conseguido', 'en_proceso', 'no_iniciado'] as const

export const PERIODO_INFORME = ['trimestre_1', 'trimestre_2', 'trimestre_3', 'fin_curso'] as const

// Valoración de un ítem dentro de un informe
export const ItemValoracionSchema = z.object({
  itemId: z.string().uuid(), // clave estable del ítem en el snapshot JSONB del informe
  valoracion: z.enum(VALORACION_ITEM, { message: 'informes.validation.valoracion_requerida' }),
  comentario: z.string().max(1000, 'informes.validation.comentario_largo').optional(),
})

// Informe completo que envía la profe al guardar/publicar
export const InformeEvolucionSchema = z.object({
  ninoId: z.string().uuid(),
  cursoAcademicoId: z.string().uuid(),
  periodo: z.enum(PERIODO_INFORME, { message: 'informes.validation.periodo_invalido' }),
  plantillaId: z.string().uuid(), // plantilla elegida al crear (se congela en snapshot)
  valoraciones: z.array(ItemValoracionSchema).min(1, 'informes.validation.sin_items'),
  observacionesGenerales: z
    .string()
    .max(4000, 'informes.validation.observaciones_largas')
    .optional(),
})

export type InformeEvolucion = z.infer<typeof InformeEvolucionSchema>

// Plantilla que define la dirección (estructura áreas → ítems), en castellano
export const ItemPlantillaSchema = z.object({
  texto: z.string().min(1).max(500, 'informes.validation.item_largo'),
})
export const AreaPlantillaSchema = z.object({
  titulo: z.string().min(1).max(200, 'informes.validation.area_larga'),
  items: z.array(ItemPlantillaSchema).min(1, 'informes.validation.area_sin_items'),
})
export const PlantillaInformeSchema = z.object({
  titulo: z.string().min(1).max(200, 'informes.validation.titulo_largo'),
  areas: z.array(AreaPlantillaSchema).min(1, 'informes.validation.sin_areas'),
})
```

> Para **publicar**, una validación adicional (server-side) exige que **toda valoración de ítem esté presente** (Q9). Un **borrador** puede guardarse incompleto.

## Modelo de datos afectado

> Las dos tablas figuran en `docs/architecture/data-model.md` como `⏳ Fase 9`. La estructura áreas→ítems y las valoraciones se guardan **en JSONB dentro de estas 2 tablas, sin tablas hijo** (Q2).

**Tablas nuevas:**

- **`plantillas_informe`** — define la estructura áreas→ítems por centro. **Varias por centro** (Q1: sin índice único, sin columna de edad/aula; el tramo es solo el `titulo`).
  - Columnas: `id uuid PK`, `centro_id uuid FK→centros ON DELETE CASCADE`, `titulo text` (1-200), `estructura jsonb` (áreas→ítems, en castellano — Q2/Q10), `estado` (`activa`/`archivada`; se archiva, no se borra), `creada_por uuid FK→usuarios`, `created_at/updated_at timestamptz`.
  - `centro_id` redundante para RLS simple (patrón del proyecto).
- **`informes_evolucion`** — informe de un niño en un período.
  - Columnas: `id uuid PK`, `centro_id uuid` (redundante RLS), `nino_id uuid FK→ninos ON DELETE RESTRICT`, `curso_academico_id uuid FK→cursos_academicos`, `periodo periodo_informe`, `plantilla_id uuid FK→plantillas_informe` (plantilla elegida al crear), `estructura_snapshot jsonb` (**congela** los textos de áreas/ítems de la plantilla al crear — Q3/Q4), `valoraciones jsonb` (item → `{valoracion, comentario}` — Q2), `observaciones_generales text` (≤ 4000), `estado estado_informe`, `redactado_por uuid`, `publicado_at timestamptz NULL`, `publicado_por uuid NULL`, `notificado_at timestamptz NULL` (sella la primera publicación notificada → no re-avisar, Q8), `created_at/updated_at`.
  - **UNIQUE `(nino_id, curso_academico_id, periodo)`** — un informe por terna.
  - FK `nino_id` ON DELETE RESTRICT (patrón de tablas con histórico sensible); **sin `deleted_at`** y sin ventana de edición temporal (Q6); DELETE bloqueado por default DENY.

**ENUMs nuevos:**

- `periodo_informe` (`trimestre_1` | `trimestre_2` | `trimestre_3` | `fin_curso`).
- `estado_informe` (`borrador` | `publicado`).
- `valoracion_item_informe` (`conseguido` | `en_proceso` | `no_iniciado`).

> **Nota escala**: es un ENUM **nuevo** y distinto del 1-5 de ADR-0022 (ese era para `cantidad_comida`). La escala de F9 es de 3 valores cualitativos.

**Tablas consultadas:** `ninos`, `matriculas`, `profes_aulas`, `aulas`, `cursos_academicos`, `vinculos_familiares`, `usuarios`.

**Migración:** sí (1 migración nueva en `supabase/migrations/`) — **pero NO en esta entrega**: esta spec es solo documentación. La migración se escribirá en F9-0.

## Políticas RLS

> Default DENY ALL. Helpers `SECURITY DEFINER STABLE SET search_path = public` (ADR-0002/0007). **Patrón row-aware obligatorio** donde aplique (gotcha MVCC de F5/F8 en `rls-policies.md`).

**`plantillas_informe`:**

- SELECT: `pertenece_a_centro(centro_id)` (cualquier miembro del centro la ve, para poder elegirla/renderizar informes).
- INSERT/UPDATE: `es_admin(centro_id)`.
- DELETE: sin policy → default DENY (se archiva con `estado='archivada'`, no se borra).

**`informes_evolucion`:**

- SELECT (row-aware): visible para `es_admin(centro_id)`, profe del aula del niño (`es_profe_de_nino(nino_id)`) — incluido borrador —, y familia **solo si `estado='publicado'`** y con permiso de lectura. La condición de familia depende de `estado` y `nino_id` (columnas del propio row) más un lookup a **otras** tablas (`vinculos_familiares`); por eso el helper es **row-aware** `usuario_es_audiencia_informe_row(centro_id, nino_id, estado)` y **no re-lee `informes_evolucion`** (evita el gotcha MVCC en `INSERT…RETURNING`, igual que F8).
- INSERT/UPDATE: `es_admin(centro_id) OR es_profe_de_nino(nino_id)` con `centro_de_nino(nino_id)=centro_id` (anti-suplantación). El server action acota columnas, enforza el corte por `tipo_personal_aula` (Q5 — solo `coordinadora`/`profesora` redactan) y la transición de estados.
- DELETE: sin policy → default DENY.

```sql
-- Helper row-aware para la SELECT de informes_evolucion
CREATE OR REPLACE FUNCTION public.usuario_es_audiencia_informe_row(
  p_centro_id uuid,
  p_nino_id   uuid,
  p_estado    public.estado_informe
) RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- admin del centro o profe del niño: siempre (también borradores)
  IF public.es_admin(p_centro_id) OR public.es_profe_de_nino(p_nino_id) THEN
    RETURN TRUE;
  END IF;
  -- familia: solo informes publicados. Reusa el permiso existente
  -- puede_ver_datos_pedagogicos (Q7): tutor_legal lo tiene por defecto (ve siempre),
  -- autorizado solo si se le concedió.
  IF p_estado = 'publicado'
     AND public.tiene_permiso_sobre(p_nino_id, 'puede_ver_datos_pedagogicos') THEN
    RETURN TRUE;
  END IF;
  RETURN FALSE;
END $$;
```

> **Permiso de lectura de la familia (Q7)**: se **reutiliza** `puede_ver_datos_pedagogicos` (clave ya existente en el JSONB de `vinculos_familiares` desde F2.6). **No se crea permiso nuevo.** Tutor legal lo tiene por defecto → ve siempre; autorizado solo si se le concedió.

## Pantallas y rutas

> Coherente con la estructura actual `src/app/[locale]/{admin,teacher,family}/…` y `features/` kebab-case (feature nueva propuesta: `informes`).

- `/admin/informes` — gestión de plantillas (dirección): listado de plantillas del centro + editor de áreas→ítems. Posible vista de seguimiento global del centro.
- `/teacher/informes` — lista de niños del aula con el estado del informe por período (curso activo).
- `/teacher/informes/[ninoId]/[periodo]` — editor del informe de un niño/período (elegir plantilla al crear; Borrador → Publicar).
- `/family/informes` — lista de informes **publicados** del hijo (o de los hijos), con descarga PDF. (Alternativa: anidar bajo `/family/nino/[id]/informes`, a decidir en diseño.)

## Componentes UI

- `PlantillaInformeEditor.tsx` (Client) — editor de áreas/ítems con react-hook-form (dirección).
- `InformesAulaList.tsx` (Server) — matriz niños × período con estado.
- `InformeEditor.tsx` (Client) — selección de plantilla al crear + formulario de valoración por ítems + observaciones (profe).
- `InformeView.tsx` (Server) — vista de lectura para la familia.
- `InformePdf` — **generación de PDF en servidor, en castellano** (Q10/Q11). Motor concreto a decidir en diseño; no bloquea la spec.

## Eventos y notificaciones

- **Push / aviso in-app**: solo en la **primera publicación** de un informe → notificar a tutores/autorizados con permiso de lectura del niño (canal F5.5, ADR-0025). Las **republicaciones tras corrección NO re-avisan** (Q8); la marca `notificado_at` evita el reenvío.
- **Audit**: INSERT/UPDATE de `plantillas_informe` e `informes_evolucion` (incl. cambios de estado publicar/despublicar) → `audit_log` automático por trigger (`centro_id` directo). Estas dos tablas se **añaden a la lista de tablas auditadas**.
- **Realtime**: no imprescindible en F9 (el contenido no es de baja latencia). Se puede omitir; confirmar en diseño.

## i18n

Namespace nuevo `informes` (es/en/va) para la **interfaz**. El **contenido** que redacta la dirección/profe (áreas, ítems, comentarios, observaciones) se guarda y se muestra **en castellano** (Q10), no se traduce.

```json
{
  "informes": {
    "title": "Informes de evolución",
    "periodos": {
      "trimestre_1": "1.er trimestre",
      "trimestre_2": "2.º trimestre",
      "trimestre_3": "3.er trimestre",
      "fin_curso": "Fin de curso"
    },
    "escala": {
      "conseguido": "Conseguido",
      "en_proceso": "En proceso",
      "no_iniciado": "No iniciado"
    },
    "estado": {
      "borrador": "Borrador",
      "publicado": "Publicado"
    },
    "fields": {
      "observaciones_generales": "Observaciones generales",
      "comentario": "Comentario",
      "plantilla": "Plantilla"
    },
    "actions": {
      "guardar_borrador": "Guardar borrador",
      "publicar": "Publicar",
      "despublicar": "Despublicar",
      "descargar_pdf": "Descargar PDF"
    },
    "empty": {
      "familia": "Aún no hay informes publicados.",
      "sin_plantilla": "El centro todavía no ha definido ninguna plantilla de informes."
    },
    "validation": {
      "valoracion_requerida": "Selecciona una valoración para cada ítem.",
      "periodo_invalido": "Período no válido.",
      "comentario_largo": "El comentario es demasiado largo.",
      "observaciones_largas": "Las observaciones son demasiado largas.",
      "sin_items": "El informe no tiene ítems.",
      "sin_areas": "La plantilla necesita al menos un área.",
      "area_sin_items": "Cada área necesita al menos un ítem.",
      "titulo_largo": "El título es demasiado largo.",
      "area_larga": "El título del área es demasiado largo.",
      "item_largo": "El texto del ítem es demasiado largo."
    }
  }
}
```

## Accesibilidad

- Editor de informe navegable con teclado; los 3 valores de la escala como `radiogroup` por ítem con etiqueta accesible.
- Errores vinculados con `aria-describedby`; botón submit con `aria-busy` durante el guardado.
- PDF legible (texto seleccionable, no imagen) y con jerarquía de encabezados por área.
- Contraste AA en los estados de la escala (no depender solo del color).

## Performance

- Query de la matriz aula × período con índice sobre `(centro_id, curso_academico_id)` y/o `(nino_id, curso_academico_id, periodo)`.
- Render del informe en Server Component; el PDF se genera en servidor bajo demanda (no en cada listado).
- Bundle del editor < límite del proyecto.

## Telemetría

- `informe_guardado` — la profe guarda un borrador (sin PII).
- `informe_publicado` — se publica (sin PII).
- `informe_pdf_descargado` — la familia descarga el PDF (sin PII).

## Tests requeridos

**Vitest (unit/integration):**

- [ ] `InformeEvolucionSchema` / `PlantillaInformeSchema` validan casos correctos e incorrectos.
- [ ] Server Action de guardar borrador retorna `success: true` con datos válidos y `false` con inválidos; permite borrador **incompleto** (Q9).
- [ ] Publicar exige todos los ítems valorados (Q9) y dispara el aviso **solo la primera vez** (Q8).
- [ ] Despublicar/republicar transiciona estados correctamente y **no** re-notifica (Q8).
- [ ] Editar la plantilla **no** altera el snapshot de un informe ya creado (Q3/Q4).
- [ ] Triggers de `audit_log` registran INSERT/UPDATE y cambios de estado.

**Vitest (RLS):**

- [ ] Profe del aula A no puede leer/editar informes de niños del aula B.
- [ ] Familia del niño X no puede ver informes del niño Y.
- [ ] Familia **no** ve informes en estado `borrador` (solo `publicado`).
- [ ] Autorizado **sin** `puede_ver_datos_pedagogicos` no ve los informes; tutor legal sí (Q7).
- [ ] `tecnico`/`apoyo` no pueden redactar; `coordinadora`/`profesora` sí (Q5).
- [ ] `.insert().select()` sobre `informes_evolucion` no falla por gotcha MVCC (helper row-aware).
- [ ] `audit_log` no es modificable por nadie.

**Playwright (E2E):**

- [ ] Dirección crea una plantilla con 2 áreas y varios ítems.
- [ ] Profe elige plantilla, rellena y publica un informe de un niño.
- [ ] Familia ve el informe publicado y descarga el PDF (en castellano).
- [ ] Familia no ve un informe en borrador.

## Criterios de aceptación

- [ ] Todos los tests listados arriba pasan en CI.
- [ ] Lighthouse de las pantallas afectadas > 90 en accesibilidad y performance.
- [ ] axe-core sin violations en las pantallas afectadas.
- [ ] Las 3 lenguas (es/en/va) tienen todas las claves de i18n **de la interfaz** (el contenido es castellano, Q10).
- [ ] Funciona en iOS Safari 16.4+ y Chrome Android.
- [ ] PDF generado en servidor, descargable, legible y en castellano.
- [ ] ADR escrito para las decisiones no obvias del modelo (al menos: estructura áreas→ítems en JSONB; snapshot de plantilla; escala de 3 como ENUM nuevo).
- [ ] `docs/architecture/data-model.md` actualizado (pasar `plantillas_informe`/`informes_evolucion` de `⏳ Fase 9` a implementadas) y `rls-policies.md` con la sección F9.

## Decisiones técnicas relevantes

A formalizar como ADR(s) en F9-0 (no en esta spec):

- **ENUM `valoracion_item_informe` (escala de 3)** — nuevo, distinto del 1-5 de ADR-0022.
- **ENUM `periodo_informe`** (4 períodos por curso).
- **Estructura áreas→ítems y valoraciones en JSONB** dentro de las 2 tablas (Q2) — decisión arquitectónica; matiz frente a la filosofía de ADR-0012 (que prefirió tablas para datos analíticos; aquí el contenido es cualitativo y no se agrega).
- **Snapshot de la estructura de plantilla en el informe** (Q3/Q4) para aislar informes de ediciones posteriores de la plantilla.
- **Corte de autoría por `tipo_personal_aula`** (Q5, ancla en ADR-0032).

## Referencias

- Plan: `docs/specs/scope-ola-1.md` (fila 9 — Informes de evolución).
- Modelo de datos: `docs/architecture/data-model.md` (`plantillas_informe`, `informes_evolucion` — `⏳ Fase 9`).
- ADR-0032 — `tipo_personal_aula` (autoría/visibilidad por tipo de personal en F9).
- ADR-0025 / ADR-0028 — canal push transversal (aviso de publicación).
- ADR-0012 — agenda 5 tablas (contexto: F9 NO usa las queries analíticas automáticas).
- ADR-0041 §F9–F11 — el acuse de recibo reusaría F8 y queda fuera de F9.
- `rls-policies.md` — gotcha MVCC / patrón row-aware (F5, F8).
- F2.6 — permiso `puede_ver_datos_pedagogicos` en `vinculos_familiares` (reusado en F9 para lectura de la familia).

---

## Resoluciones de diseño (Q1–Q11) — cerradas por el responsable

> Decididas el 2026-06-09 e incorporadas al cuerpo de la spec. Se conservan aquí como registro.

- **Q1 — Plantillas por centro**: **varias** plantillas por centro. La profe **elige una** al crear el informe. Dirección crea las que quiera y las nombra como prefiera (p. ej. por tramo de edad), pero **el tramo de edad NO se ata en el modelo** (es solo el nombre). Sin índice único, sin columna de edad/aula.
- **Q2 — Estructura áreas→ítems**: guardada en **JSONB dentro de las 2 tablas** previstas (`plantillas_informe.estructura`, `informes_evolucion.estructura_snapshot`/`valoraciones`). **Sin tablas hijo** extra.
- **Q3 — Snapshot e inmutabilidad**: el informe **congela** la estructura de la plantilla en el momento de crearse. Editar la plantilla después **no** afecta a informes ya creados. Correcciones **sin versionado formal**.
- **Q4 — Borrador en curso vs cambio de plantilla**: un borrador **conserva su snapshot** aunque la plantilla cambie a mitad; el cambio solo afecta a informes **nuevos**.
- **Q5 — Autoría (ADR-0032)**: `coordinadora` y `profesora` **redactan y publican**; `tecnico` y `apoyo` **solo leen**; dirección (admin) **puede todo**. **Sin paso de visto bueno separado.**
- **Q6 — Ventana temporal**: **sin cierre temporal**. Profe/dirección pueden corregir informes de trimestres/cursos pasados. **NO** sigue la regla de «día cerrado» de ADR-0016.
- **Q7 — Permiso de lectura de la familia**: **reusar** `puede_ver_datos_pedagogicos`. Tutor legal **ve siempre**; autorizado ve **si tiene** ese permiso. **No** crear permiso nuevo.
- **Q8 — Re-aviso**: aviso in-app **solo en la primera publicación**; las republicaciones (correcciones) **NO** re-avisan.
- **Q9 — Requisitos para publicar**: **todos los ítems valorados** (obligatorio). Comentarios por ítem y observaciones generales **opcionales**. El **borrador puede estar incompleto**.
- **Q10 — Idioma del contenido**: textos de la plantilla (áreas, ítems) y del informe en **castellano**, un solo idioma. La **interfaz** sigue en es/en/va, pero el **contenido no se traduce**. El **PDF sale en castellano**.
- **Q11 — Generación del PDF**: **en servidor (server-side)**.
