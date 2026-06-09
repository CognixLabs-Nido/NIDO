---
feature: informes-evolucion
wave: 1
status: draft
priority: high
last_updated: 2026-06-09
related_adrs: [ADR-0025, ADR-0032, ADR-0011]
related_specs: [scope-ola-1, pedagogical-data, autorizaciones-firma]
---

# Spec — Informes de evolución (F9)

> **Estado: borrador para revisión del responsable.** Contiene **preguntas abiertas** sin resolver al final (§Preguntas abiertas). No se implementa nada hasta que el responsable las cierre y apruebe la spec (`draft → review → approved`). Esta spec es **solo documentación**: no toca código ni migraciones.

## Resumen ejecutivo

Informes de evolución del niño (boletines de desarrollo): documentos cualitativos, estructurados en **áreas → ítems**, que la profe del aula rellena por niño y período, y que la familia consulta y descarga en PDF cuando están **finalizados/publicados**. No es el parte diario (eso es la agenda de F3); es la valoración pedagógica periódica del desarrollo del niño.

## Contexto

El centro necesita comunicar a las familias la evolución pedagógica de cada niño de forma periódica (boletín por trimestre + fin de curso), más allá del día a día que ya cubre la agenda diaria (F3). F9 es la fase prevista en el plan (`scope-ola-1.md`, fila 9 «Informes de evolución») y descansa sobre dos tablas del módulo Operativo aún sin implementar: `plantillas_informe` + `informes_evolucion` (`docs/architecture/data-model.md`).

Decisiones ya tomadas en fases anteriores que F9 hereda:

- **ADR-0012** eligió 5 tablas separadas para la agenda «pensando en queries analíticas de Fase 9». **F9 NO usa esas queries automáticas** (ver §Alcance/Fuera): los informes son cualitativos, no agregan datos de la agenda.
- **ADR-0025/ADR-0028** dejaron el canal push (F5.5) listo «para que F9 lo enchufe» en «informes publicados». F9 usa ese canal para el aviso de publicación.
- **ADR-0032** introdujo el ENUM `tipo_personal_aula` (`coordinadora`/`profesora`/`tecnico`/`apoyo`) anticipando explícitamente «Informes (F9): autoría y visibilidad según tipo de personal». F9 precisa ese corte (ver §Roles).
- **ADR-0041 §F9–F11** dejó constancia de que el modelo de F8 condiciona F9; el **acuse de recibo** de la familia, si se quiere, se construiría reusando el mecanismo de firma de F8 y queda **FUERA de F9** (ver §Alcance/Fuera).

## Roles

| Rol                                    | Sobre informes                                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Dirección (admin)**                  | Crea y edita **plantillas** de informe. Puede ver todos los informes del centro. Puede publicar/despublicar.  |
| **Profe del aula**                     | **Rellena** el informe de cada niño de **su** aula (vía `profes_aulas` activo). Pasa de borrador a publicado. |
| **Familia (tutor_legal / autorizado)** | **Solo lectura**: ve y descarga en PDF los informes **publicados** de su hijo. No edita, no firma.            |

### Corte por tipo de personal (ADR-0032) — propuesta, ver §Preguntas abiertas Q5

Respetando la clasificación `tipo_personal_aula`:

- **Redactan** (borrador → publicar): `coordinadora` y `profesora` del aula.
- **Solo lectura** del informe (dentro del staff del aula): `tecnico` y `apoyo`.
- **Dirección** redacta plantillas y tiene lectura total; no es quien rellena el contenido por niño salvo que además sea profe del aula.

> El corte exacto (¿solo coordinadora? ¿coordinadora + profesora?) es una decisión de producto: queda como **Q5** en §Preguntas abiertas. Lo aquí escrito es la propuesta por defecto.

## User stories

- **US-01**: Como **dirección**, quiero definir una plantilla de informe (áreas e ítems) para que todas las profes valoren a los niños con el mismo criterio.
- **US-02**: Como **dirección**, quiero editar la plantilla cuando cambie el criterio pedagógico, sin que se alteren los informes ya redactados/publicados.
- **US-03**: Como **profe del aula**, quiero rellenar el informe de un niño para un período (1.er/2.º/3.er trimestre o fin de curso), valorando cada ítem (Conseguido / En proceso / No iniciado) y añadiendo comentarios, guardándolo como borrador hasta que esté listo.
- **US-04**: Como **profe del aula**, quiero publicar el informe cuando esté completo para que la familia pueda verlo, y que la familia reciba un aviso.
- **US-05**: Como **profe/dirección**, quiero corregir un informe ya publicado (despublicar → editar → republicar) cuando detecte un error.
- **US-06**: Como **familia**, quiero ver y descargar en PDF los informes **publicados** de mi hijo, en mi idioma, sin poder editarlos.
- **US-07**: Como **familia**, quiero recibir un aviso in-app cuando se publique un nuevo informe de mi hijo.

## Alcance

**Dentro:**

- Gestión de **plantillas de informe** por la dirección: estructura **áreas → ítems**.
- Cada **ítem** se valora con una **escala de 3**: `Conseguido` / `En proceso` / `No iniciado`, más un **comentario libre opcional** por ítem.
- Un campo de **observaciones generales** al final del informe.
- Un informe por **niño + curso académico + período**, con **4 períodos por curso**: `1.er trimestre`, `2.º trimestre`, `3.er trimestre`, `fin de curso`.
- Ciclo de estados **Borrador → Publicado**, con **despublicar/corregir/republicar** (ver §Comportamiento 3 y Q3/Q4).
- Vista lectora + **descarga en PDF** para la familia, solo de informes **publicados**.
- **Aviso in-app de publicación** a la familia por el canal existente (ADR-0025).
- **i18n es/en/va** en toda la UI.
- RLS de aislamiento (aula/familia) con tests obligatorios.

**Fuera (no se hace aquí):**

- **Datos automáticos de la agenda diaria** (medias de sueño, comida, biberones, percentiles). F9 es valoración **cualitativa**; no agrega ni inserta cifras de F3. (Las queries analíticas que ADR-0012 anticipaba quedan para una fase posterior si se decide.)
- **Firma / acuse de recibo de la familia.** La familia **no firma**. Un acuse de recibo (confirmación de lectura legalmente trazable) sería un añadido futuro reusando el mecanismo de F8 (ADR-0041) y queda **fuera de F9**.
- **Versionado formal del informe** (historial de revisiones con diffs). En F9 corregir = despublicar/editar/republicar sin guardar versiones anteriores (ver Q3).
- **Comparativa entre períodos / gráficas de progreso.** Posible Ola 3.
- **Adjuntos** (fotos, evidencias) en el informe → ligado a `media` de **F10**.
- **App nativa / offline real** → Ola 2.

## Comportamientos detallados

### Comportamiento 1: Dirección define/edita la plantilla

**Pre-condiciones:**

- Usuario con rol `admin` del centro.

**Flujo:**

1. Dirección abre `/admin/informes` y crea/edita una plantilla.
2. Define una lista ordenada de **áreas** (p. ej. «Autonomía», «Lenguaje», «Psicomotricidad»…). Cada área tiene un título.
3. Dentro de cada área define una lista ordenada de **ítems** (frases evaluables). Cada ítem se valorará con la escala fija de 3.
4. Guarda. La estructura queda asociada al centro.

**Post-condiciones:**

- La plantilla queda disponible para que las profes generen informes a partir de ella.
- Cambios posteriores a la plantilla **no** alteran informes ya creados (snapshot, ver Q3/Q4).
- El cambio queda en `audit_log`.

> **Cuántas plantillas por centro** (única activa / una por cohorte de edad / una por aula) → **Q1**.
> **Cómo se almacena la estructura áreas→ítems** (JSONB en `plantillas_informe` vs tablas hijo) → **Q2**.

### Comportamiento 2: Profe rellena el informe de un niño

**Pre-condiciones:**

- Usuario `profe` (tipo `coordinadora`/`profesora`, ver §Roles) asignado al aula activa del niño.
- Existe una plantilla aplicable al niño.

**Flujo:**

1. La profe abre `/teacher/informes`, ve la lista de niños de su aula y, por niño, el estado del informe de cada período del curso activo.
2. Selecciona niño + período (p. ej. «2.º trimestre»). Si no existe informe para esa terna (niño, curso, período), se crea en estado **Borrador** a partir de la plantilla vigente (snapshot de su estructura).
3. Para cada ítem, marca una valoración (`Conseguido` / `En proceso` / `No iniciado`) y, opcionalmente, escribe un comentario.
4. Rellena las **observaciones generales** (opcional u obligatorio según Q9).
5. Guarda como **Borrador** las veces que necesite. El borrador **no** es visible para la familia.

**Post-condiciones:**

- Las valoraciones y comentarios quedan persistidos.
- El informe sigue invisible para la familia hasta su publicación.
- Cambios quedan en `audit_log`.

### Comportamiento 3: Publicar / despublicar / corregir

**Pre-condiciones:**

- Informe en estado Borrador (para publicar) o Publicado (para despublicar/corregir).
- Usuario que redacta (profe del aula) o dirección.

**Flujo (publicar):**

1. La profe pulsa «Publicar». Validación previa: todos los ítems tienen valoración (ver Q9).
2. El informe pasa a **Publicado**: pasa a ser **visible y descargable en PDF para la familia**, y **solo lectura para la familia**.
3. Se dispara el **aviso in-app de publicación** a los tutores/autorizados con permiso de lectura (canal ADR-0025).

**Flujo (corregir un publicado):**

1. Profe/dirección **despublica** (vuelve a Borrador). Deja de ser visible para la familia.
2. Edita.
3. **Republica** → vuelve a ser visible y **re-dispara** el aviso (ver Q8 sobre re-aviso).

**Post-condiciones:**

- Estado y `publicado_at/publicado_por` reflejan el último cambio.
- **Sin versionado formal** en F9: no se guarda el contenido anterior (ver Q3).
- Todos los cambios de estado quedan en `audit_log`.

> Propuesta a validar: **publicado = solo lectura para la familia; profe/dirección puede despublicar, corregir y volver a publicar (re-avisa), sin versionado formal en F9.** Confirmar en Q3/Q8.

### Comportamiento 4: Familia consulta y descarga PDF

**Pre-condiciones:**

- Tutor legal / autorizado con permiso de lectura sobre el niño (ver §RLS y Q7 sobre el flag de permiso).
- Informe en estado **Publicado**.

**Flujo:**

1. La familia abre la sección de informes de su hijo (`/family/informes`, ver §Pantallas).
2. Ve la lista de informes **publicados** (por curso y período). Los borradores no aparecen.
3. Abre uno en modo lectura y, si quiere, lo **descarga en PDF** en su idioma.

**Post-condiciones:**

- Ningún cambio de datos (solo lectura). Telemetría opcional de apertura/descarga (sin PII).

## Casos edge

- **Sin plantilla definida**: si la dirección no ha creado plantilla, la profe no puede iniciar informes; la UI muestra estado vacío explicando que falta la plantilla del centro.
- **Sin informes publicados (familia)**: la vista de familia muestra estado vacío («Aún no hay informes publicados»).
- **Informe no iniciado (profe)**: la lista muestra el período como «Sin iniciar» y permite crear el borrador.
- **Período/curso cerrado**: ¿se puede editar el informe de un trimestre pasado o de un curso anterior? → **Q6** (relación con la regla de «día cerrado» de ADR-0016; a priori los informes **no** se rigen por la ventana diaria de F3/F4 porque no son hechos diarios, pero hay que fijar hasta cuándo se puede editar/publicar).
- **Sin permisos**: una profe que no es del aula del niño, o una familia que no es tutora del niño, recibe `forbidden` (RLS + guard de ruta).
- **Permisos cambiados a mitad de sesión**: si la profe deja de estar asignada al aula, pierde acceso de edición en la siguiente acción (RLS revalida en cada request).
- **Concurrencia (dos profes del mismo aula editando el mismo informe)**: política de guardado a confirmar (último escribe gana vs aviso de conflicto) → relacionado con Q5/Q9; por defecto «último guardado gana» con `updated_at`, sin bloqueo optimista en F9.
- **Editar la plantilla con informes ya creados**: los informes existentes conservan su estructura por snapshot (Q3); los nuevos usan la plantilla nueva.
- **Despublicar un informe que la familia ya vio/descargó**: deja de ser visible online; el PDF ya descargado por la familia es una copia que no se puede revocar (limitación inherente, documentarla en el aviso de privacidad si procede).
- **Idiomas**: la **estructura de la plantilla** (textos de áreas/ítems) la escribe la dirección — ¿se traduce a es/en/va o se guarda en un solo idioma? → **Q10**. Las etiquetas de la **escala** y de la **UI** sí van en i18n (es/en/va). Fechas/períodos formateados por locale.
- **Datos sensibles**: el informe describe el desarrollo de un menor → dato personal. Respeta minimización y el régimen RGPD del proyecto. No se cifra a nivel columna (no es info médica de emergencia), pero sí queda bajo RLS estricta y `audit_log`.
- **Borrado**: sin DELETE para la familia/profe. Corrección de error = despublicar/editar o marcar con prefijo según patrón del proyecto (ver Q3). DELETE bloqueado por default DENY.

## Validaciones (Zod)

> Esquemas orientativos; los nombres definitivos dependen de Q1–Q3.

```typescript
export const VALORACION_ITEM = ['conseguido', 'en_proceso', 'no_iniciado'] as const

export const PERIODO_INFORME = [
  'trimestre_1',
  'trimestre_2',
  'trimestre_3',
  'fin_de_curso',
] as const

// Valoración de un ítem dentro de un informe
export const ItemValoracionSchema = z.object({
  itemId: z.string().uuid(), // referencia al ítem de la plantilla (o clave estable si JSONB)
  valoracion: z.enum(VALORACION_ITEM, { message: 'informes.validation.valoracion_requerida' }),
  comentario: z.string().max(1000, 'informes.validation.comentario_largo').optional(),
})

// Informe completo que envía la profe al guardar/publicar
export const InformeEvolucionSchema = z.object({
  ninoId: z.string().uuid(),
  cursoAcademicoId: z.string().uuid(),
  periodo: z.enum(PERIODO_INFORME, { message: 'informes.validation.periodo_invalido' }),
  valoraciones: z.array(ItemValoracionSchema).min(1, 'informes.validation.sin_items'),
  observacionesGenerales: z
    .string()
    .max(4000, 'informes.validation.observaciones_largas')
    .optional(),
})

export type InformeEvolucion = z.infer<typeof InformeEvolucionSchema>

// Plantilla que define la dirección (estructura áreas → ítems)
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

> Para publicar, una validación adicional (server-side) exige que **toda valoración de ítem esté presente** (ver Q9).

## Modelo de datos afectado

> Las dos tablas figuran en `docs/architecture/data-model.md` como `⏳ Fase 9`. La **forma exacta** depende de Q1–Q3; aquí va la propuesta de trabajo.

**Tablas nuevas:**

- **`plantillas_informe`** — define la estructura áreas→ítems por centro.
  - Propuesta de columnas: `id uuid PK`, `centro_id uuid FK→centros ON DELETE CASCADE`, `titulo text`, `estructura jsonb` (áreas→ítems; **ver Q2**: JSONB vs tablas hijo), `estado` (¿`activa`/`archivada`? — ligado a Q1), `creada_por uuid FK→usuarios`, `created_at/updated_at timestamptz`.
  - `centro_id` redundante para RLS simple (patrón del proyecto).
- **`informes_evolucion`** — informe de un niño en un período.
  - Propuesta de columnas: `id uuid PK`, `centro_id uuid` (redundante RLS), `nino_id uuid FK→ninos ON DELETE RESTRICT`, `curso_academico_id uuid FK→cursos_academicos`, `periodo periodo_informe`, `plantilla_id uuid FK→plantillas_informe`, `estructura_snapshot jsonb` (congela los textos de áreas/ítems al crear, **Q3**), `valoraciones jsonb` (item → `{valoracion, comentario}`; **ver Q2** sobre JSONB vs tabla hija), `observaciones_generales text`, `estado estado_informe`, `redactado_por uuid`, `publicado_at timestamptz NULL`, `publicado_por uuid NULL`, `created_at/updated_at`.
  - **UNIQUE `(nino_id, curso_academico_id, periodo)`** — un informe por terna.
  - FK `nino_id` ON DELETE RESTRICT (patrón de tablas con histórico sensible); sin `deleted_at` (corrección por estado/prefijo, Q3).

**ENUMs nuevos (propuestos):**

- `periodo_informe` (`trimestre_1` | `trimestre_2` | `trimestre_3` | `fin_de_curso`).
- `estado_informe` (`borrador` | `publicado`).
- `valoracion_item_informe` (`conseguido` | `en_proceso` | `no_iniciado`).

> **Nota escala**: es un ENUM **nuevo** y distinto del 1-5 de ADR-0022 (ese era para `cantidad_comida`). La escala de F9 es de 3 valores cualitativos.

**Tablas consultadas:** `ninos`, `matriculas`, `profes_aulas`, `aulas`, `cursos_academicos`, `vinculos_familiares`, `usuarios`.

**Migración:** sí (1 migración nueva en `supabase/migrations/`) — **pero NO en esta entrega**: esta spec es solo documentación. La migración se escribirá tras aprobar la spec.

## Políticas RLS

> Default DENY ALL. Helpers `SECURITY DEFINER STABLE SET search_path = public` (ADR-0002/0007). **Patrón row-aware obligatorio** donde aplique (ver gotcha MVCC de F5/F8 en `rls-policies.md`).

**`plantillas_informe`:**

- SELECT: `pertenece_a_centro(centro_id)` (cualquier miembro del centro la ve, para poder renderizar informes).
- INSERT/UPDATE: `es_admin(centro_id)`.
- DELETE: sin policy → default DENY (se archiva, no se borra).

**`informes_evolucion`:**

- SELECT (propuesta, row-aware): visible para `es_admin(centro_id)`, profe del aula del niño (`es_profe_de_nino(nino_id)`), y familia con permiso de lectura **solo si `estado='publicado'`**. Como la condición de familia depende de `estado` y de `nino_id` (columnas del propio row) más un lookup a **otras** tablas (`vinculos_familiares`), conviene un helper **row-aware** `usuario_es_audiencia_informe_row(centro_id, nino_id, estado)` que **no re-lea `informes_evolucion`** (evita el gotcha MVCC en `INSERT…RETURNING`, igual que F8).
- INSERT/UPDATE: `es_admin(centro_id) OR es_profe_de_nino(nino_id)` con `centro_de_nino(nino_id)=centro_id` (anti-suplantación). El server action acota columnas y enforza el corte por `tipo_personal_aula` (Q5) y la transición de estados.
- DELETE: sin policy → default DENY.

```sql
-- Propuesta (pseudo): helper row-aware para la SELECT de informes_evolucion
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
  -- familia: solo informes publicados, y con permiso de lectura (ver Q7)
  IF p_estado = 'publicado' AND public.tiene_permiso_sobre(p_nino_id, /* permiso, ver Q7 */ 'puede_ver_agenda') THEN
    RETURN TRUE;
  END IF;
  RETURN FALSE;
END $$;
```

> El **permiso concreto** del JSONB de `vinculos_familiares` que gobierna la lectura de informes está por decidir (¿`puede_ver_datos_pedagogicos`? ¿una clave nueva `puede_ver_informes`?) → **Q7**.

## Pantallas y rutas

> Coherente con la estructura actual `src/app/[locale]/{admin,teacher,family}/…` y `features/` kebab-case (feature nueva propuesta: `informes`).

- `/admin/informes` — gestión de plantillas (dirección): editor de áreas→ítems. Posible vista de seguimiento global del centro.
- `/teacher/informes` — lista de niños del aula con el estado del informe por período (curso activo).
- `/teacher/informes/[ninoId]/[periodo]` — editor del informe de un niño/período (Borrador → Publicar).
- `/family/informes` — lista de informes **publicados** del hijo (o de los hijos), con descarga PDF. (Alternativa: anidar bajo `/family/nino/[id]/informes`, a decidir en diseño.)

## Componentes UI

- `PlantillaInformeEditor.tsx` (Client) — editor de áreas/ítems con react-hook-form (dirección).
- `InformesAulaList.tsx` (Server) — matriz niños × período con estado.
- `InformeEditor.tsx` (Client) — formulario de valoración por ítems + observaciones (profe).
- `InformeView.tsx` (Server) — vista de lectura para la familia.
- `InformePdf` — generación de PDF en el idioma del usuario (server-side recomendado; motor a decidir en diseño, no bloquea la spec).

## Eventos y notificaciones

- **Push / aviso in-app**: al **publicar** un informe → notificar a tutores/autorizados con permiso de lectura del niño (canal F5.5, ADR-0025). Al **republicar** tras corrección → re-aviso (ver Q8).
- **Audit**: INSERT/UPDATE de `plantillas_informe` e `informes_evolucion` (incl. cambios de estado publicar/despublicar) → `audit_log` automático por trigger (`centro_id` directo). Estas dos tablas se **añaden a la lista de tablas auditadas**.
- **Realtime**: no imprescindible en F9 (el contenido no es de baja latencia). Se puede omitir; confirmar en diseño.

## i18n

Namespace nuevo `informes` (es/en/va). Las **etiquetas de la escala** y de la UI van aquí; los **textos de la plantilla** (áreas/ítems) dependen de Q10.

```json
{
  "informes": {
    "title": "Informes de evolución",
    "periodos": {
      "trimestre_1": "1.er trimestre",
      "trimestre_2": "2.º trimestre",
      "trimestre_3": "3.er trimestre",
      "fin_de_curso": "Fin de curso"
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
      "comentario": "Comentario"
    },
    "actions": {
      "guardar_borrador": "Guardar borrador",
      "publicar": "Publicar",
      "despublicar": "Despublicar",
      "descargar_pdf": "Descargar PDF"
    },
    "empty": {
      "familia": "Aún no hay informes publicados.",
      "sin_plantilla": "El centro todavía no ha definido la plantilla de informes."
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
- Render del informe en Server Component; el PDF se genera bajo demanda (no en cada listado).
- Bundle del editor < límite del proyecto.

## Telemetría

- `informe_guardado` — la profe guarda un borrador (sin PII).
- `informe_publicado` — se publica (sin PII).
- `informe_pdf_descargado` — la familia descarga el PDF (sin PII).

## Tests requeridos

**Vitest (unit/integration):**

- [ ] `InformeEvolucionSchema` / `PlantillaInformeSchema` validan casos correctos e incorrectos.
- [ ] Server Action de guardar borrador retorna `success: true` con datos válidos y `false` con inválidos.
- [ ] Publicar exige todos los ítems valorados (Q9) y dispara el aviso.
- [ ] Despublicar/republicar transiciona estados correctamente.
- [ ] Triggers de `audit_log` registran INSERT/UPDATE y cambios de estado.

**Vitest (RLS):**

- [ ] Profe del aula A no puede leer/editar informes de niños del aula B.
- [ ] Familia del niño X no puede ver informes del niño Y.
- [ ] Familia **no** ve informes en estado `borrador` (solo `publicado`).
- [ ] Tutor sin el permiso de lectura aplicable (Q7) no ve los informes.
- [ ] `tecnico`/`apoyo` no pueden redactar (según corte Q5).
- [ ] `.insert().select()` sobre `informes_evolucion` no falla por gotcha MVCC (helper row-aware).
- [ ] `audit_log` no es modificable por nadie.

**Playwright (E2E):**

- [ ] Dirección crea una plantilla con 2 áreas y varios ítems.
- [ ] Profe rellena y publica un informe de un niño.
- [ ] Familia ve el informe publicado y descarga el PDF.
- [ ] Familia no ve un informe en borrador.

## Criterios de aceptación

- [ ] Todos los tests listados arriba pasan en CI.
- [ ] Lighthouse de las pantallas afectadas > 90 en accesibilidad y performance.
- [ ] axe-core sin violations en las pantallas afectadas.
- [ ] Las 3 lenguas (es/en/va) tienen todas las claves de i18n de la UI.
- [ ] Funciona en iOS Safari 16.4+ y Chrome Android.
- [ ] PDF descargable, legible y en el idioma del usuario.
- [ ] ADR escrito para las decisiones no obvias del modelo (al menos: estructura áreas→ítems JSONB vs tablas; snapshot de plantilla; escala de 3 como ENUM nuevo).
- [ ] `docs/architecture/data-model.md` actualizado (pasar `plantillas_informe`/`informes_evolucion` de `⏳ Fase 9` a implementadas) y `rls-policies.md` con la sección F9.

## Decisiones técnicas relevantes

A formalizar como ADR(s) al implementar (no en esta spec):

- **ENUM `valoracion_item_informe` (escala de 3)** — nuevo, distinto del 1-5 de ADR-0022.
- **ENUM `periodo_informe`** (4 períodos por curso).
- **Estructura áreas→ítems: JSONB vs tablas hijo** (Q2) — decisión arquitectónica (relación con la filosofía de ADR-0012).
- **Snapshot de la estructura de plantilla en el informe** (Q3) para aislar informes de ediciones posteriores de la plantilla.
- **Corte de autoría por `tipo_personal_aula`** (Q5, ancla en ADR-0032).

## Referencias

- Plan: `docs/specs/scope-ola-1.md` (fila 9 — Informes de evolución).
- Modelo de datos: `docs/architecture/data-model.md` (`plantillas_informe`, `informes_evolucion` — `⏳ Fase 9`).
- ADR-0032 — `tipo_personal_aula` (autoría/visibilidad por tipo de personal en F9).
- ADR-0025 / ADR-0028 — canal push transversal (aviso de publicación).
- ADR-0012 — agenda 5 tablas (contexto: F9 NO usa las queries analíticas automáticas).
- ADR-0041 §F9–F11 — el acuse de recibo reusaría F8 y queda fuera de F9.
- `rls-policies.md` — gotcha MVCC / patrón row-aware (F5, F8).

---

## Preguntas abiertas (las resuelve el responsable antes de implementar)

> No las he decidido yo. Cada una bloquea una parte del modelo/UX.

- **Q1 — ¿Cuántas plantillas por centro?** Opciones: (a) **una única plantilla activa por centro** (patrón «1 plantilla activa por centro+tipo» de F8); (b) **una por cohorte de edad** (0-1 / 1-2 / 2-3 evolucionan distinto → ítems distintos); (c) **una por aula**. Esto determina si `plantillas_informe` lleva índice único parcial, columna de cohorte/aula, y cómo elige la profe la plantilla aplicable a cada niño.
- **Q2 — Estructura áreas→ítems y valoraciones: ¿JSONB o tablas hijo?** El `data-model.md` lista **solo 2 tablas** para F9 (`plantillas_informe`, `informes_evolucion`), lo que sugiere **JSONB** dentro de ellas. Pero ADR-0012 prefirió tablas separadas sobre JSONB para la agenda. ¿Mantengo JSONB (coherente con las 2 tablas del data-model) o introduzco tablas hijo (`informe_areas`/`informe_items`/respuestas), ampliando el conteo del data-model? No lo decido yo.
- **Q3 — Snapshot e inmutabilidad al editar la plantilla.** Propongo **congelar la estructura (textos de áreas/ítems) en el informe al crearlo** (`estructura_snapshot`), para que editar la plantilla luego no altere informes ya redactados/publicados. ¿Lo confirmas? ¿Y corregir un informe = despublicar/editar/republicar **sin** guardar versiones anteriores (sin versionado formal en F9)?
- **Q4 — ¿Qué pasa con un borrador en curso si la dirección edita la plantilla a mitad de trimestre?** Ligado a Q3: ¿el borrador conserva su snapshot o se re-sincroniza con la plantilla nueva?
- **Q5 — Corte exacto de autoría por `tipo_personal_aula` (ADR-0032).** Propongo: **redactan `coordinadora` + `profesora`; `tecnico` + `apoyo` solo lectura**. ¿Es correcto, o solo la `coordinadora` redacta/publica y la `profesora` solo edita borrador?
- **Q6 — Ventana de edición temporal.** ¿Hasta cuándo se puede editar/publicar un informe? A priori los informes **no** siguen la regla de «día cerrado» (ADR-0016) porque no son hechos diarios. ¿Se pueden editar informes de trimestres pasados o de cursos anteriores, o se cierran al terminar el período/curso?
- **Q7 — Permiso de lectura de la familia.** ¿Qué clave del JSONB de `vinculos_familiares` gobierna que un tutor/autorizado vea los informes? ¿`puede_ver_datos_pedagogicos` (ya existe, F2.6), `puede_ver_agenda`, o una clave nueva `puede_ver_informes`? Afecta a si los `autorizado` (permisos por defecto `false`) los ven.
- **Q8 — Re-aviso al republicar.** Si se corrige y republica un informe, ¿se vuelve a notificar a la familia (riesgo de spam si hay varias correcciones) o solo se notifica en la **primera** publicación?
- **Q9 — ¿Es obligatorio valorar todos los ítems para publicar?** Propongo: para **publicar** todos los ítems deben tener valoración (comentarios opcionales) y las observaciones generales son opcionales. ¿Confirmas, o las observaciones generales son obligatorias?
- **Q10 — Idioma de los textos de la plantilla.** La UI va en es/en/va, pero los **textos de áreas/ítems** los escribe la dirección. ¿Se guardan en **un solo idioma** (el que escriba la dirección) o la plantilla debe ser **multilingüe** (es/en/va por área/ítem)? Impacta de lleno el modelo de `plantillas_informe` y la generación del PDF por idioma.
- **Q11 — Generación del PDF.** ¿Server-side (recomendado, idioma controlado, sin peso en cliente) o client-side? No bloquea el modelo, pero conviene fijarlo antes de diseñar el componente.
