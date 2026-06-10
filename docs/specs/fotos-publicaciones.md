---
feature: fotos-publicaciones
wave: 1
status: draft
priority: high
last_updated: 2026-06-11
related_adrs:
  [
    ADR-0006-permisos-granulares-vinculos,
    ADR-0010-logo-centro-url-relativa,
    ADR-0032-enum-tipo-personal-aula,
    ADR-0041-modelo-autorizaciones-firma-digital,
    ADR-0007-rls-policy-recursion-avoidance,
  ]
related_specs: [scope-ola-1, autorizaciones-firma]
---

# Spec — Fotos y publicaciones del aula (F10)

## Resumen ejecutivo

El **"blog del aula"**: la profe sube **fotos** en **publicaciones** colectivas, **etiqueta** a los niños que aparecen, y las familias ven (con permiso) las publicaciones de su aula donde aparece su hijo. Es el **primer uso de Supabase Storage** en NIDO, así que F10 también **configura Storage** (buckets privados, enlaces firmados, miniaturas, limpieza de EXIF) y, de paso, aterriza los **adjuntos** que dependían de Storage: foto del niño, logo real del centro y foto del DNI de recogida (F8).

## Contexto

Las tres tablas del **módulo Multimedia** (`publicaciones`, `media`, `media_etiquetas`) estaban marcadas como **⏳ Fase 10** en `data-model.md` sin modelar. Varias piezas previas dejaron "huecos reservados" que esperan a que Storage exista:

- **`puede_ver_fotos`** es una clave del JSONB de `vinculos_familiares` (ADR-0006) hoy **inerte**: definida, con default `true` para tutor / `false` para autorizado, pero **sin RLS que la haga efectiva** ("RLS Fase 10").
- **`ninos.foto_url`** existe desde Fase 2, **sin uso**.
- **`centros.logo_url`** (ADR-0010) apunta a un asset estático del repo; el plan era subir el logo a `centro-assets/{centroId}/logo.{ext}` "cuando Storage esté configurado (Fase 10)".
- **F8** aplazó los adjuntos (foto del DNI de recogida, informe médico) a **F10** vía `firmas.datos.adjuntos: [{ bucket, path, hash, metadata }]` (forma ya reservada, sin tabla nueva).
- El **consentimiento de imagen firmable** (`autorizacion_imagenes`, valor ya reservado en el ENUM `tipo_autorizacion`) se construye en **F11**, NO aquí; en F10 el gate de "aparecer en fotos" lo pone **dirección** según el consentimiento en papel firmado al matricular.

F10 es además el momento de **construir bien Storage una vez** (buckets, políticas, procesado de imagen con `sharp` —ya dependencia—) para no repetir trabajo en F11 y siguientes.

## User stories

- **US-01:** Como **profe**, quiero **crear una publicación** en mi aula con una o varias **fotos** para compartir el día a día con las familias.
- **US-02:** Como **profe**, quiero **etiquetar** en cada foto a los niños que aparecen, **solo entre los que tienen permiso de imagen**, para respetar el consentimiento.
- **US-03:** Como **familia** (tutor/autorizado con `puede_ver_fotos`), quiero **ver las publicaciones del aula de mi hijo donde mi hijo aparece** para seguir su evolución.
- **US-04:** Como **familia**, quiero **descargar** las fotos en las que aparece mi hijo para guardarlas.
- **US-05:** Como **dirección**, quiero **fijar por niño si puede aparecer en fotos** (según el consentimiento en papel) para que la profe solo pueda etiquetar/mostrar a los autorizados.
- **US-06:** Como **dirección**, quiero **subir el logo real del centro** a Storage para que sustituya la URL hardcodeada (ADR-0010).
- **US-07:** Como **dirección/profe**, quiero **adjuntar la foto del DNI** en una recogida (F8) y la **foto del niño** en su ficha, reutilizando el Storage de F10.
- **US-08:** Como **cualquier usuario**, quiero que las fotos viajen por **enlaces firmados que caducan** y **sin metadatos de geolocalización**, para proteger la privacidad de los menores.

## Alcance

**Dentro:**

- Configuración de **Supabase Storage**: bucket(s) **privados**, políticas de acceso a objetos por rol/permiso, **enlaces firmados** con caducidad.
- **Procesado server-side con `sharp`**: limpieza de **EXIF/geolocalización**, generación de **miniaturas**, normalización de formato, límites de tamaño/tipo.
- Tablas **`publicaciones`**, **`media`**, **`media_etiquetas`** (modelo propuesto abajo; detalles abiertos en §Preguntas abiertas).
- **Solo fotos** (imágenes). Sin vídeo.
- Gate **"aparecer en fotos"** por niño (interruptor que pone dirección) que limita el **etiquetado**.
- Activar a **RLS real** el permiso `puede_ver_fotos` de `vinculos_familiares` (hoy inerte).
- Vista de **familia**: ver y **descargar** fotos de su propio hijo.
- **Adjuntos sobre Storage (todos en F10):** `ninos.foto_url` (foto del niño), **logo real** del centro (`centro-assets/{centroId}/logo.{ext}`, sustituye la URL hardcodeada — ADR-0010) y **foto del DNI** de recogida de F8 (`firmas.datos.adjuntos`).

**Fuera (no se hace aquí):**

- **Vídeo** (cualquier formato). → Ola 2/3.
- **Consentimiento de imagen firmable** (`autorizacion_imagenes`): se **construye en F11** reusando F8; aquí solo el interruptor por niño que pone dirección. El ENUM ya reserva el valor.
- **Comentarios/reacciones/"me gusta"** de la familia sobre las publicaciones (el blog es **unidireccional**). → Ola 3 si se pide.
- **Álbumes/galerías** descargables en lote, exportación masiva, impresión. → fuera.
- **Reconocimiento facial / auto-etiquetado**. → fuera (RGPD).
- **Edición destructiva de imagen** (recortes, filtros) más allá del procesado técnico (EXIF/miniatura/normalización).

## Decisiones cerradas (ancla — no reabrir en diseño)

1. **Aparecer en fotos = interruptor por NIÑO** que pone **dirección** según el consentimiento en papel firmado al matricular. La profe **solo puede etiquetar/mostrar** a niños con ese permiso. En **F11**, `autorizacion_imagenes` (firmable) alimentará ese mismo interruptor — **no se construye aquí**.
2. **`puede_ver_fotos`** (clave JSONB de `vinculos_familiares`, ADR-0006) pasa de **inerte** a **efectivo por RLS** en F10: la familia ve fotos **solo** si lo tiene.
3. **Forma = blog COLECTIVO del aula** con etiquetado de qué niños aparecen. La **publicación cuelga de un aula**; **`media` etiqueta niños** (vía `media_etiquetas`). La familia ve las publicaciones del **aula de su hijo** donde **su hijo está etiquetado**, si tiene `puede_ver_fotos`.
4. **Solo fotos** (sin vídeo en F10).
5. La **familia** puede **ver y descargar** las fotos **de su propio hijo**.
6. **Privacidad:** buckets **privados** + **enlaces firmados que caducan** + **quitar EXIF/geolocalización** al subir + **miniaturas** + **límites de tamaño y tipo**. Procesado en servidor con **`sharp`** (precedente: `scripts/process-logos.mjs`).
7. **Adjuntos que reaprovechan Storage, todos en F10:** foto del niño (`ninos.foto_url`, ya reservada), **logo real** del centro (sustituye la URL hardcodeada; sigue ADR-0010, bucket `centro-assets/{centroId}/logo.{ext}`) y **foto del DNI** de recogida de F8 (vía `firmas.datos.adjuntos`, forma ya reservada).

## Comportamientos detallados

### Comportamiento 1: La profe crea una publicación con fotos

**Pre-condiciones:**

- El usuario es **profe del aula** (o admin del centro). _(¿Solo coordinadora/profesora, como la autoría de informes en F9, o cualquier `tipo_personal_aula`? → §Preguntas abiertas, P5.)_
- El aula pertenece al centro actual.

**Flujo:**

1. La profe abre el composer de publicación de su aula y añade **texto** (descripción del día) y **1..N fotos**.
2. Cada foto se sube al endpoint server-side, que con **`sharp`**: valida tipo/tamaño, **elimina EXIF/geolocalización**, normaliza formato y genera **original optimizado + miniatura**; sube ambos al **bucket privado** bajo un prefijo del centro/aula/publicación; registra una fila en **`media`** (bucket, path, hash, dimensiones, etc.).
3. La profe **etiqueta** en cada foto a los niños que aparecen. El selector **solo ofrece** niños **matriculados activos** del aula **con `puede_aparecer_en_fotos = true`**.
4. Al publicar, se crea la fila **`publicaciones`** (aula, autor, texto, estado) y las **`media_etiquetas`** (media × niño).

**Post-condiciones:**

- La publicación es visible para el **staff del aula** y para las **familias** según las reglas de visibilidad (Comportamiento 3).
- _(¿Se avisa a las familias de una publicación nueva (aviso de INICIO #64 / push)? → §Preguntas abiertas, P8.)_

### Comportamiento 2: Gate de "aparecer en fotos"

**Pre-condiciones:**

- Dirección ha fijado por niño `puede_aparecer_en_fotos` (default propuesto: **`false`** hasta consentimiento — pero ⚠️ ver P2/P1).

**Flujo:**

1. La profe intenta etiquetar a un niño **sin** permiso → el selector **no lo ofrece** / el server **rechaza** el etiquetado.
2. _(Niño sin permiso que **sale incidentalmente** en una foto de grupo: ⚠️ **no resuelto** — ¿se bloquea la foto entera, se exige recorte/ocultar, o basta con no etiquetarlo? → §Preguntas abiertas, P2.)_

**Post-condiciones:**

- No existe ninguna `media_etiquetas` que apunte a un niño sin `puede_aparecer_en_fotos` (enforzado por RLS/validación).

### Comportamiento 3: La familia ve las fotos de su hijo

**Pre-condiciones:**

- El usuario es **tutor/autorizado** de un niño **con `puede_ver_fotos = true`**.

**Flujo:**

1. La familia abre su vista de fotos. Ve las **publicaciones del aula** donde su hijo está **matriculado activo** y en las que **su hijo está etiquetado** en al menos una foto.
2. Cada imagen se sirve por **enlace firmado** (caduca). _(¿Ve la familia **solo las fotos donde su hijo está etiquetado**, o **todas** las fotos de la publicación? → §Preguntas abiertas, P2/visibilidad.)_
3. La familia puede **descargar** las fotos a las que tiene acceso.

**Post-condiciones:**

- La familia **no** ve publicaciones de otras aulas ni fotos donde su hijo no aparece (según la resolución de P2).

### Comportamiento 4: Logo real del centro (ADR-0010)

**Flujo:**

1. Dirección sube el logo en `/admin/centro`; se procesa con `sharp` y se sube a `centro-assets/{centroId}/logo.{ext}`.
2. La server action actualiza `centros.logo_url` con la nueva referencia (firmada o pública según política de ese bucket — ⚠️ ver P3).
3. La UI deja de usar la URL hardcodeada del repo.

### Comportamiento 5: Adjuntos de F8 (foto del DNI de recogida) y foto del niño

**Flujo:**

1. En la firma de **recogida** (F8), el firmante puede adjuntar la **foto del DNI**; se procesa (EXIF fuera), se sube al bucket privado y se referencia en `firmas.datos.adjuntos: [{ bucket, path, hash, metadata }]` (forma ya reservada; **append-only** atado al `texto_hash` de la firma).
2. La **foto del niño** se sube en su ficha y se referencia en `ninos.foto_url`.
3. _(Las **cuotas/retención** de estos adjuntos sensibles —DNIs de terceros, RAT F11— → §Preguntas abiertas, P4 + nota RGPD.)_

## Casos edge

- **Sin publicaciones**: la vista de familia y la del aula muestran un empty state ("aún no hay fotos").
- **Sin `puede_ver_fotos`**: la familia no ve la pestaña/contenido de fotos (o la ve vacía con explicación); la RLS lo bloquea aunque manipule la URL.
- **Niño sin `puede_aparecer_en_fotos`**: no aparece en el selector de etiquetado; intento directo de etiquetar → rechazo. Caso incidental en grupo: ⚠️ **P2**.
- **Permiso revocado a mitad** (dirección quita `puede_aparecer_en_fotos`, o familia pierde `puede_ver_fotos`): las etiquetas/visibilidad existentes deben **dejar de surtir efecto** en la siguiente carga (RLS evalúa en lectura). ⚠️ ¿Se **retiran** etiquetas pasadas o solo se ocultan? → P2.
- **Enlace firmado caducado**: la imagen se vuelve a firmar al recargar; un enlace viejo compartido fuera **no** funciona (es lo deseable).
- **Archivo inválido** (no imagen, tipo no permitido, supera tamaño, corrupto, EXIF malicioso): rechazo con error claro; nada se persiste.
- **Subida parcial / red lenta**: la publicación no se crea hasta que el/los `media` están subidos y procesados; reintento idempotente por hash (no duplica).
- **Concurrencia**: dos profes del mismo aula publicando a la vez → publicaciones independientes (sin colisión). Editar la misma publicación a la vez → ⚠️ depende del modelo de edición (P-edición).
- **Borrado / soft delete**: ⚠️ ¿`publicaciones`/`media` con `deleted_at` (patrón sensible) o borrado real + limpieza del objeto en Storage? ¿Quién borra (autor/admin)? → P-borrado.
- **Niño dado de baja / cambia de aula**: las publicaciones pasadas del aula anterior — ¿sigue viéndolas la familia? ⚠️ → P-histórico.
- **Idiomas**: textos de UI en es/en/va; el **texto libre** de la publicación lo escribe la profe (no se traduce).
- **Datos sensibles**: DNIs de terceros en adjuntos de recogida → RAT F11; fotos de menores → consentimiento (interruptor F10, firmable F11).

## Validaciones (Zod)

_Propuestas; los **límites concretos** (tamaño, tipos, nº de fotos) son **abiertos** (P4)._

```typescript
// Propuesta — sujeta a P4 (límites concretos)
export const PublicacionSchema = z.object({
  aula_id: z.string().uuid(),
  texto: z.string().trim().max(/* TBD P4 */ 2000, 'fotos.validation.texto_largo').optional(),
})

export const SubirFotoSchema = z.object({
  publicacion_id: z.string().uuid(),
  // Tipo/tamaño se validan también server-side antes de procesar con sharp.
  mime: z.enum(['image/jpeg', 'image/png', 'image/webp' /* TBD P4 */]),
})

export const EtiquetarSchema = z.object({
  media_id: z.string().uuid(),
  nino_id: z.string().uuid(), // debe tener puede_aparecer_en_fotos = true (RLS + check)
})
```

- Server-side: **siempre** revalidar tipo/tamaño real del binario (no fiarse del MIME declarado) antes de pasar a `sharp`.
- Mensajes de error en i18n (`fotos.validation.*`).

## Modelo de datos afectado

**Tablas nuevas (propuesta; forma exacta abierta — ver §Preguntas abiertas):**

- **`publicaciones`** — el post del blog del aula. Propuesto: `id`, `centro_id` (redundante para RLS), `aula_id` (FK), `autor_id` (FK `usuarios`), `texto` (nullable), `estado` _(¿borrador/publicada? o publica directa? → P-edición)_, timestamps. Sin `deleted_at` o con él → **P-borrado**.
- **`media`** — cada foto. Propuesto: `id`, `publicacion_id` (FK CASCADE), `centro_id`, `bucket`, `path`, `path_miniatura`, `hash`, `mime`, `ancho`, `alto`, `bytes`, timestamps. _(¿Reutilizable para adjuntos de F8/logo/foto-niño, o `media` es solo del blog y los adjuntos viven en `datos.adjuntos`/`foto_url`/`logo_url` sin fila en `media`? → P-media-reuso.)_
- **`media_etiquetas`** — etiqueta `media × nino`. Propuesto: `id` (o PK compuesta), `media_id` (FK CASCADE), `nino_id` (FK), `centro_id`, timestamp. UNIQUE `(media_id, nino_id)`.

**Tablas modificadas:**

- **`ninos`**: nuevo interruptor **`puede_aparecer_en_fotos`** _(⚠️ ubicación exacta abierta — P1: columna en `ninos` u otro sitio)_. `foto_url` pasa a usarse (sin cambio de esquema).
- **`vinculos_familiares`**: sin cambio de esquema; `puede_ver_fotos` (JSONB) pasa a **efectivo** por RLS.
- **`centros`**: `logo_url` se repunta a Storage (cambio de valor, no de esquema).

**Tablas consultadas:** `matriculas` (aula activa del niño), `profes_aulas` (autoría/lectura del staff), `vinculos_familiares` (permiso familia), `firmas_autorizacion` (`datos.adjuntos`).

**Audit:** ⚠️ ¿se auditan `publicaciones`/`media`/`media_etiquetas`? (No están en la lista de `data-model.md`.) → P-audit.

## Políticas RLS

Patrón **row-aware** (F8/F9, ADR-0007 + gotcha MVCC): cualquier policy SELECT que se evalúe sobre filas recién insertadas (`INSERT … RETURNING`) usa helpers que **no re-leen la propia tabla**.

- **Helper(s) propuestos** (a definir en F10-0): p. ej. `usuario_es_audiencia_publicacion_row(p_centro_id, p_aula_id, …)` y/o `familia_ve_media(p_media_id)` apoyado en `media_etiquetas` + `puede_ver_fotos`. Reusa `es_profe_de_aula`, `es_admin`, `es_tutor_de`, `tiene_permiso_sobre(nino_id, 'puede_ver_fotos')`, `centro_de_aula`, `centro_de_nino`.
- **`publicaciones`**: SELECT = staff del aula (`es_admin(centro_id) OR es_profe_de_aula(aula_id)`) **OR** familia con hijo etiquetado en alguna media de la publicación y `puede_ver_fotos` _(la parte familia depende de P2)_. INSERT/UPDATE = staff del aula (qué tipos → P5). DELETE → P-borrado.
- **`media`**: hereda visibilidad de su publicación + el gate de etiquetado/visibilidad por niño (P2).
- **`media_etiquetas`**: INSERT solo para niños con `puede_aparecer_en_fotos` (check + RLS); SELECT acotada a quien puede ver la media.

**Políticas de Storage (no solo de filas):** el acceso a los **objetos** del bucket se controla por **políticas de Storage** (no basta con la RLS de las tablas). Propuesta: el cliente **nunca** accede al objeto directamente; el server genera **URLs firmadas** tras autorizar con la RLS de las tablas (patrón "service role tras autorizar" de ADR-0027). La estructura de prefijos y las políticas exactas del bucket → **P3 + ADR de Storage**.

## Storage (configuración — primer uso)

- **Buckets privados.** Estructura **abierta** (uno general vs por tipo: blog / `centro-assets` / adjuntos sensibles) → **P3**.
- **Enlaces firmados** con **caducidad** (TTL concreto → P4). El binario se sirve solo vía URL firmada generada server-side tras autorizar.
- **Procesado con `sharp`** (ya dependencia, `^0.34.5`; precedente `scripts/process-logos.mjs`): **quitar EXIF/geolocalización**, generar **miniatura(s)**, normalizar formato, recomprimir. Idempotente por hash.
- **Límites** (tamaño máx., tipos permitidos, nº de fotos por publicación) y **retención** → **P4**.

## Pantallas y rutas

- `/teacher/aula/[id]/fotos` (o `/teacher/fotos`) — composer + listado de publicaciones del aula. _(ruta exacta a decidir en diseño)._
- `/family/fotos` — vista lectora de las publicaciones del aula del hijo (con permiso).
- `/admin/centro` — **ampliación**: subir/sustituir logo del centro (ADR-0010).
- Ficha del niño (admin) — **ampliación**: subir `foto_url` + interruptor `puede_aparecer_en_fotos`.
- Flujo de **recogida** (F8) — **ampliación**: adjuntar foto del DNI.
- Endpoint(s) server-side de **subida/descarga firmada** (route handler para binario — excepción legítima a "Server Actions, no API routes", como el PDF de F9-4).

## Componentes UI

- `PublicacionComposer.tsx` (Client) — texto + subida múltiple + etiquetado.
- `EtiquetarFotoControl.tsx` (Client) — selector de niños con permiso por foto.
- `PublicacionesAula.tsx` (Server) — listado para staff.
- `FotosFamilia.tsx` (Server) — vista lectora de familia.
- `SubirLogoCentro.tsx` (Client) — admin (ADR-0010).
- `SubirFotoNino.tsx` / control de `puede_aparecer_en_fotos` (Client) — admin.
- Imagen servida con `next/image` + URL firmada; miniatura en listados, original bajo demanda.

## Eventos y notificaciones

- **Push / aviso de INICIO** de "nueva publicación" a las familias del aula → ⚠️ **P8** (no decidido). Si se hace, reusar el patrón derivado de #64 (sin tabla de avisos) y/o push (F5.5).
- **Audit**: ⚠️ depende de P-audit.

## i18n

Namespace nuevo `fotos` (es/en/va), con `title`, `composer.*`, `etiquetar.*`, `family.*`, `validation.*`, `errors.*`. Sin claves decididas aún (se concretan en F10-0). Texto libre de la publicación lo escribe la profe (no se traduce).

## Accesibilidad

- Imágenes con **`alt`** significativo (¿derivado del texto de la publicación o de las etiquetas? — a definir).
- Composer y etiquetado **navegables con teclado**; `aria-busy` en subida.
- Contraste AA; estados de carga/empty/errores anunciados.

## Performance

- **Miniaturas** en listados (no servir originales en la rejilla).
- **Paginación** del blog (p. ej. 20 publicaciones).
- URLs firmadas cacheables hasta su caducidad; evitar N+1 al firmar lotes.
- Subida y `sharp` **server-side** (no bloquear el render); procesar fuera del request si hace falta.

## Telemetría

- `publicacion_creada` (sin PII; nº de fotos).
- `fotos_vistas_familia`.
- `foto_descargada`.

## Tests requeridos

**Vitest (unit/integration):**

- [ ] Schemas Zod (publicación, subida, etiquetar) validan correctos e incorrectos.
- [ ] Procesado `sharp`: el binario de salida **no** conserva EXIF/geolocalización; se genera miniatura; se rechazan tipos/tamaños no permitidos.
- [ ] Gate de etiquetado: no se puede etiquetar a un niño sin `puede_aparecer_en_fotos`.

**Vitest (RLS):**

- [ ] Familia con `puede_ver_fotos` ve las publicaciones del aula de su hijo donde su hijo está etiquetado; **sin** el permiso, NO.
- [ ] Familia de otro aula/centro NO ve (aislamiento).
- [ ] No se puede crear `media_etiquetas` de un niño sin `puede_aparecer_en_fotos`.
- [ ] Staff del aula publica/etiqueta; staff de otra aula NO. _(qué tipos de personal → P5)._
- [ ] `.insert().select()` por el autor funciona (gotcha MVCC row-aware).
- [ ] **Políticas de Storage**: un objeto no es accesible sin URL firmada; la URL firmada caduca.

**Playwright (E2E):**

- [ ] La profe crea una publicación con 2 fotos y etiqueta a un niño con permiso.
- [ ] La familia (con permiso) ve y descarga la foto de su hijo; otra familia no la ve.

## Criterios de aceptación

- [ ] Todos los tests listados pasan en CI.
- [ ] `puede_ver_fotos` y `puede_aparecer_en_fotos` son **efectivos por RLS** (no flags inertes).
- [ ] Las fotos viajan **solo** por URL firmada con caducidad; los buckets son **privados**.
- [ ] El binario subido **no** conserva EXIF/geolocalización; hay miniatura.
- [ ] El logo del centro se sirve desde Storage (ADR-0010) y la URL hardcodeada desaparece.
- [ ] Los adjuntos de F8 (foto DNI) y `ninos.foto_url` usan el Storage de F10.
- [ ] Las 3 lenguas (es/en/va) tienen todas las claves.
- [ ] axe-core sin violations en las pantallas afectadas.
- [ ] **ADR de Storage escrito** (buckets, políticas, EXIF, miniaturas, cuotas/límites).
- [ ] `data-model.md` y `rls-policies.md` actualizados (3 tablas + interruptor + permisos + políticas de Storage).

## Decisiones técnicas relevantes

- **ADR nuevo — Storage en NIDO** (a escribir en **F10-0**, una vez resueltas P3/P4): buckets (privados; estructura), políticas de acceso a objetos por rol/permiso, **limpieza de EXIF + miniaturas con `sharp`**, **enlaces firmados** y caducidad, **cuotas/límites** y retención. No existe ningún ADR de Storage todavía. _(Se redacta al arrancar F10-0 porque su contenido central —estructura de buckets y límites— son **preguntas abiertas** que el responsable debe cerrar; redactarlo ahora obligaría a decidirlas.)_
- Reusa: **ADR-0006** (`puede_ver_fotos`), **ADR-0010** (logo → Storage), **ADR-0041/F8** (`datos.adjuntos`), **ADR-0007** (anti-recursión RLS) + gotcha MVCC row-aware, **ADR-0027** (service role tras autorizar; route handler para binario).

## Preguntas abiertas (para el responsable — NO decididas en esta spec)

- **P1 — Ubicación de `puede_aparecer_en_fotos`.** ¿Columna en `ninos` (lo más simple) u otro sitio (p. ej. una tabla de consentimientos, dado que en F11 lo alimentará `autorizacion_imagenes`)? ¿Default `false` (conservador) o `true`?
- **P2 — Alcance del gate de "aparecer".** ¿El permiso **solo** bloquea **etiquetar** a un niño sin permiso, o también la **visibilidad**? ¿La familia ve **solo las fotos donde su hijo está etiquetado** o **todas** las de la publicación? ¿Cómo se maneja un **niño sin permiso que sale incidentalmente** en una foto de grupo (bloquear la foto entera, exigir recorte/difuminado, o basta con no etiquetarlo)? ¿Al **revocar** el permiso se retiran etiquetas pasadas o solo se ocultan?
- **P3 — Estructura de buckets.** ¿Un bucket general vs por tipo (blog del aula / `centro-assets` del logo / adjuntos sensibles como DNIs)? ¿Todos privados, o `centro-assets` (logo) público? Política de prefijos y de objetos.
- **P4 — Límites y retención.** Tamaño máx. por foto, **tipos** permitidos (jpeg/png/webp/…), **nº máx. de fotos** por publicación, **TTL** de los enlaces firmados, y **retención/borrado** (incl. adjuntos sensibles: DNIs de terceros → RAT F11).
- **P5 — Quién publica/etiqueta.** ¿Cualquier `tipo_personal_aula` (incl. `tecnico`/`apoyo`) o solo redactores (`coordinadora`/`profesora`), como el corte de autoría de F9 (ADR-0032)? ¿Admin también?
- **P-media-reuso — ¿`media` es solo del blog?** ¿O también modela los adjuntos (foto niño, logo, DNI), o esos viven en `ninos.foto_url` / `centros.logo_url` / `firmas.datos.adjuntos` **sin** fila en `media`?
- **P-edición — Estado de la publicación.** ¿Borrador→publicada (como informes) o publica directa? ¿Se puede editar texto/añadir-quitar fotos tras publicar?
- **P-borrado — Soft delete vs borrado real.** ¿`publicaciones`/`media` con `deleted_at` (patrón sensible) o borrado real + limpieza del objeto en Storage? ¿Quién borra (autor/admin)?
- **P-histórico — Niño que se va o cambia de aula.** ¿La familia sigue viendo las publicaciones pasadas del aula anterior donde aparece su hijo?
- **P-audit — ¿Se auditan?** `publicaciones`/`media`/`media_etiquetas` no están en la lista de tablas auditadas; decidir si entran (por pattern, contenido con relevancia legal sí).
- **P8 — Aviso de publicación nueva.** ¿Se avisa a las familias (aviso de INICIO #64 y/o push F5.5) cuando hay una publicación nueva, o el blog es de consulta pasiva?

## Referencias

- `docs/architecture/data-model.md` — módulo Multimedia (3 tablas, Fase 10), lista de auditadas, `ninos.foto_url`, `centros.logo_url`.
- **ADR-0006** — permisos granulares de `vinculos_familiares` (`puede_ver_fotos`, "RLS Fase 10").
- **ADR-0010** — logo del centro: URL relativa → plan de migración a Storage en F10 (`centro-assets/{centroId}/logo.{ext}`).
- **ADR-0041** / `docs/specs/autorizaciones-firma.md` — adjuntos aplazados a F10 (`firmas.datos.adjuntos`), foto DNI de recogida, `autorizacion_imagenes` reservado para F11.
- **ADR-0032** — `tipo_personal_aula` (corte de autoría coordinadora/profesora).
- **ADR-0007** + sección gotcha MVCC de `rls-policies.md` — helpers row-aware.
- **ADR-0027** — service role tras autorizar; route handler para binario (precedente PDF F9-4).
- `scripts/process-logos.mjs` — precedente de procesado de imagen con `sharp`.
