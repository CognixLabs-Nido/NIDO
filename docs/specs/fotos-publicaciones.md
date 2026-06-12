---
feature: fotos-publicaciones
wave: 1
status: implemented
priority: high
last_updated: 2026-06-12
related_adrs:
  [
    ADR-0045-storage-buckets-y-blog-aula,
    ADR-0046-cierre-f10-fotos-consentimiento-adjuntos-heic,
    ADR-0006-permisos-granulares-vinculos,
    ADR-0010-logo-centro-url-relativa,
    ADR-0032-enum-tipo-personal-aula,
    ADR-0041-modelo-autorizaciones-firma-digital,
    ADR-0007-rls-policy-recursion-avoidance,
  ]
related_specs: [scope-ola-1, autorizaciones-firma]
---

> **Estado de implementación (cierre F10 — F10-0…F10-3, 2026-06-12).** La fase está **implementada y desplegada** (PRs #80/#81/#82/#83). Dos desviaciones respecto al texto original de esta spec, decididas durante la construcción (ver **ADR-0046**):
>
> 1. **HEIC NO se convierte: se RECHAZA** con aviso claro ("Convierte la foto a JPG o PNG antes de subirla"). El texto de abajo dice "HEIC→JPG en servidor"; resultó **inviable** en F10 (decode en cliente cuelga en un Web Worker; decode en servidor no embarca `libheif.wasm` con Turbopack). JPG/PNG funcionan en todas las subidas. Dos vías de retorno documentadas en ADR-0046 y `docs/follow-ups.md`.
> 2. **Tope efectivo 4 MB/foto** (no 10–15 MB): margen bajo el body de 4,5 MB de una función Vercel. La subida directa a Storage para archivos mayores queda como follow-up.
>
> El resto (blog del aula, gate de consentimiento por RLS, vista de familia con histórico, avisos de INICIO, adjuntos foto-niño/logo/DNI sobre Storage) está **construido como se describe**. La foto del niño la sube el **tutor** desde su ficha (`/family/nino/[id]`) y dirección como alternativa — **no** hay wizard de onboarding F2.6 (queda como follow-up opcional).

# Spec — Fotos y publicaciones del aula (F10)

## Resumen ejecutivo

El **"blog del aula"**: la profe sube **fotos** en **publicaciones** colectivas, **etiqueta** a los niños que aparecen, y las familias ven (con permiso) las publicaciones del aula de su hijo. Es el **primer uso de Supabase Storage** en NIDO, así que F10 también **configura Storage** (buckets separados por sensibilidad, enlaces firmados, miniaturas, limpieza de EXIF) y aterriza los **adjuntos** que dependían de Storage: foto del niño, logo real del centro y foto del DNI de recogida (F8).

## Contexto

Las tres tablas del **módulo Multimedia** (`publicaciones`, `media`, `media_etiquetas`) estaban marcadas como **⏳ Fase 10** en `data-model.md` sin modelar. Varias piezas previas dejaron "huecos reservados" que esperan a que Storage exista:

- **`puede_ver_fotos`** es una clave del JSONB de `vinculos_familiares` (ADR-0006) hoy **inerte**: definida, con default `true` para tutor / `false` para autorizado, pero **sin RLS que la haga efectiva** ("RLS Fase 10").
- **`ninos.foto_url`** existe desde Fase 2, **sin uso**.
- **`centros.logo_url`** (ADR-0010) apunta a un asset estático del repo; el plan era subir el logo a `centro-assets/{centroId}/logo.{ext}` "cuando Storage esté configurado (Fase 10)".
- **F8** aplazó los adjuntos (foto del DNI de recogida, informe médico) a **F10** vía `firmas.datos.adjuntos: [{ bucket, path, hash, metadata }]` (forma ya reservada, sin tabla nueva).
- El **consentimiento de imagen firmable** (`autorizacion_imagenes`, valor ya reservado en el ENUM `tipo_autorizacion`) se construye en **F11**, NO aquí; en F10 el gate de "aparecer en fotos" lo pone **dirección** según el consentimiento en papel firmado al matricular.

F10 es además el momento de **construir bien Storage una vez** (buckets, políticas, procesado de imagen con `sharp` —ya dependencia—) para no repetir trabajo en F11 y siguientes.

## User stories

- **US-01:** Como **profe** (coordinadora/profesora) o **admin**, quiero **crear una publicación** en mi aula con una o varias **fotos** para compartir el día a día con las familias.
- **US-02:** Como **profe/admin**, quiero **etiquetar** en cada foto a los niños que aparecen, **solo entre los que tienen permiso de imagen**, para respetar el consentimiento.
- **US-03:** Como **familia** (tutor/autorizado con `puede_ver_fotos`), quiero **ver las publicaciones del aula de mi hijo** para seguir su día a día.
- **US-04:** Como **familia**, quiero **descargar** las fotos para guardarlas.
- **US-05:** Como **dirección**, quiero **fijar por niño si puede aparecer en fotos** (según el consentimiento en papel) para que la profe solo pueda etiquetar a los autorizados.
- **US-06:** Como **dirección**, quiero **subir el logo real del centro** a Storage para que sustituya la URL hardcodeada (ADR-0010).
- **US-07:** Como **dirección/profe**, quiero **adjuntar la foto del DNI** en una recogida (F8) y la **foto del niño** en su ficha, reutilizando el Storage de F10.
- **US-08:** Como **cualquier usuario**, quiero que las fotos de niños viajen por **enlaces firmados que caducan** y **sin metadatos de geolocalización**, para proteger la privacidad de los menores.

## Alcance

**Dentro:**

- Configuración de **Supabase Storage**: **buckets separados por sensibilidad** (privados para fotos de niños; público para el logo), políticas de acceso a objetos, **enlaces firmados** (~1 h) para los privados.
- **Procesado server-side con `sharp`**: limpieza de **EXIF/geolocalización**, generación de **miniaturas**, normalización de formato (**HEIC→JPG**), límites de tamaño/tipo.
- Tablas **`publicaciones`**, **`media`**, **`media_etiquetas`** (modelo abajo).
- **Solo fotos** (imágenes). Sin vídeo.
- Interruptor **`ninos.puede_aparecer_en_fotos`** (default `FALSE`) que pone **dirección** y limita el **etiquetado**.
- Activar a **RLS real** el permiso `puede_ver_fotos` de `vinculos_familiares` (hoy inerte).
- Vista de **familia**: ver y **descargar** las publicaciones del aula de su hijo.
- **Aviso in-app en INICIO** (patrón #64, sin push) a las familias con permiso cuando hay publicación nueva.
- **Adjuntos sobre Storage (todos en F10):** `ninos.foto_url` (foto del niño), **logo real** del centro (`centro-assets/{centroId}/logo.{ext}`, bucket **público**, sustituye la URL hardcodeada — ADR-0010) y **foto del DNI** de recogida de F8 (`firmas.datos.adjuntos`, bucket **privado**). Estos adjuntos **no** usan la tabla `media` (campos propios).

**Fuera (no se hace aquí):**

- **Vídeo** (cualquier formato). → Ola 2/3.
- **Consentimiento de imagen firmable** (`autorizacion_imagenes`): se **construye en F11** reusando F8 y alimentará el mismo interruptor `puede_aparecer_en_fotos`; aquí solo lo pone dirección a mano. El ENUM ya reserva el valor.
- **Detección de caras / auto-etiquetado** (la profe es responsable de no subir fotos con niños sin permiso).
- **Retención formal RGPD** (políticas de borrado por plazo, derecho al olvido sobre Storage) → **F11** (paquete RGPD).
- **Comentarios/reacciones** de la familia (blog **unidireccional**), **álbumes/exportación masiva**, **edición destructiva de imagen**. → fuera.
- **Push** de publicación nueva (solo aviso in-app). → eventual Ola posterior.

## Decisiones cerradas (resoluciones del responsable — no reabrir)

1. **Aparecer en fotos = `ninos.puede_aparecer_en_fotos`** (columna en `ninos`, **default `FALSE`**: no aparece hasta que dirección marque el consentimiento en papel). La profe **solo puede etiquetar** a niños con el permiso. En **F11**, `autorizacion_imagenes` (firmable) alimentará este mismo interruptor — **no se construye aquí**.
2. **`puede_ver_fotos`** (JSONB de `vinculos_familiares`, ADR-0006) pasa de **inerte** a **efectivo por RLS**: la familia ve fotos **solo** si lo tiene.
3. **Forma = blog COLECTIVO del aula** con etiquetado de qué niños aparecen. La **publicación cuelga de un aula**; **`media` etiqueta niños** (vía `media_etiquetas`). **Visibilidad (P2):** la familia con `puede_ver_fotos` ve **TODAS** las publicaciones del aula de su hijo (es un blog colectivo, no un álbum por-niño).
4. **Solo fotos** (sin vídeo en F10).
5. La **familia** puede **ver y descargar** las fotos.
6. **Privacidad:** fotos de niños en **buckets privados** + **enlaces firmados** (~1 h) + **quitar EXIF/geolocalización** + **miniaturas** + **límites de tamaño y tipo**. Procesado con **`sharp`** (precedente `scripts/process-logos.mjs`).
7. **Adjuntos que reaprovechan Storage, todos en F10:** foto del niño (`ninos.foto_url`), **logo real** del centro (bucket **público** `centro-assets/{centroId}/logo.{ext}`, ADR-0010) y **foto del DNI** de recogida de F8 (`firmas.datos.adjuntos`, bucket privado). **No** usan la tabla `media`.

### Resoluciones de detalle (cerradas)

- **P2 — Gate de aparecer.** _Etiquetar:_ solo niños con permiso; etiquetar a uno sin permiso **se bloquea con aviso a la profe**. La profe es **responsable** de no subir fotos donde salga un niño sin permiso (sin detección de caras en F10). _Revocar el permiso:_ **oculta** las publicaciones donde el niño está etiquetado **y** no deja crear nuevas etiquetas. _Visibilidad de familia:_ con `puede_ver_fotos`, ve **todas** las publicaciones del aula de su hijo.
- **P3 — Buckets por sensibilidad.** **Privados** (enlaces firmados) para fotos de niños: `media` del blog, foto del niño, foto del DNI. **Público** para el logo del centro (no es dato sensible).
- **P4 — Límites.** Tipos **JPG/PNG/HEIC** (HEIC→JPG en servidor); **~10–15 MB** por foto; **~10–20 fotos** por publicación; enlaces firmados **~1 h**. Retención formal RGPD → **F11**.
- **P5 — Quién publica/etiqueta.** **Coordinadora + profesora + admin**. **Técnico y apoyo solo leen** (mismo corte de autoría que F9, ADR-0032).
- **P-media-reuso.** La tabla **`media` es SOLO del blog**. Los adjuntos (foto niño, logo, DNI) usan sus **campos propios** (`ninos.foto_url`, `centros.logo_url`, `firmas.datos.adjuntos`) apuntando a Storage, **no** `media`.
- **P-edición.** **Publicación directa** (componer → publicar), **editable después**; **editar NO vuelve a avisar**.
- **P-borrado.** **Borrado real**: quita la fila **y** el objeto de Storage (sin huérfanos). Borra **quien publicó o admin**.
- **P-histórico.** Niño que se va / cambia de aula: la familia **conserva** las publicaciones pasadas donde salía su hijo; **deja de ver** las nuevas del aula.
- **P-audit.** Se **auditan** `publicaciones`, `media` y `media_etiquetas` (quién sube/etiqueta/borra).
- **P8 — Aviso de publicación nueva.** Al publicar, **aviso in-app en INICIO** (patrón #64) a las familias con permiso (`puede_ver_fotos` + hijo en el aula); **sin push**.

## Comportamientos detallados

### Comportamiento 1: La profe crea una publicación con fotos

**Pre-condiciones:**

- El usuario es **coordinadora/profesora del aula** o **admin del centro** (técnico/apoyo no publican — P5).
- El aula pertenece al centro actual.

**Flujo:**

1. La profe abre el composer de su aula, escribe **texto** (descripción del día) y añade **1..N fotos** (JPG/PNG/HEIC, ≤ ~10–15 MB, ~10–20 por publicación).
2. Cada foto se sube al endpoint server-side, que con **`sharp`**: valida tipo/tamaño real del binario, **convierte HEIC→JPG**, **elimina EXIF/geolocalización**, normaliza y genera **original optimizado + miniatura**; sube ambos al **bucket privado** bajo el prefijo del centro/aula/publicación; registra una fila en **`media`** (bucket, path, path_miniatura, hash, mime, dimensiones, bytes).
3. La profe **etiqueta** en cada foto a los niños que aparecen. El selector **solo ofrece** niños **matriculados activos** del aula **con `puede_aparecer_en_fotos = true`**.
4. Al publicar, se crea la fila **`publicaciones`** (aula, autor, texto) y las **`media_etiquetas`** (media × niño). La publicación es **directa** (sin borrador).
5. Se dispara el **aviso in-app de INICIO** (#64) a las familias del aula con `puede_ver_fotos`.

**Post-condiciones:**

- La publicación es visible para el **staff del aula** y para las **familias con permiso** (Comportamiento 3).
- Queda traza en `audit_log` (P-audit).

### Comportamiento 2: Editar / borrar una publicación

- **Editar** (texto, añadir/quitar fotos o etiquetas): lo hace el **autor o admin**; la publicación se actualiza **sin volver a avisar** (P-edición). Quitar una foto **borra** su objeto y miniatura en Storage (sin huérfanos).
- **Borrar** la publicación: **borrado real** (filas `publicaciones`/`media`/`media_etiquetas` + objetos de Storage), por el **autor o admin** (P-borrado).

### Comportamiento 3: Gate de "aparecer en fotos"

**Flujo:**

1. La profe intenta etiquetar a un niño **sin** `puede_aparecer_en_fotos` → el selector **no lo ofrece** y el server **rechaza** el etiquetado **con aviso a la profe**.
2. **Foto de grupo con un niño sin permiso:** F10 **no** detecta caras; es **responsabilidad de la profe** no subir esa foto. El sistema solo garantiza que **no haya `media_etiquetas`** de niños sin permiso.
3. **Revocar el permiso** a un niño: las publicaciones donde está etiquetado **se ocultan** (a su familia y según RLS) y **no** se pueden crear nuevas etiquetas suyas.

**Post-condiciones:**

- No existe ninguna `media_etiquetas` que apunte a un niño sin `puede_aparecer_en_fotos` (RLS + validación).

### Comportamiento 4: La familia ve y descarga las fotos

**Pre-condiciones:**

- El usuario es **tutor/autorizado** de un niño **con `puede_ver_fotos = true`**.

**Flujo:**

1. La familia abre su vista de fotos. Ve **todas las publicaciones del aula** donde su hijo está **matriculado activo** (blog colectivo, P2), **salvo** las que contengan a un niño con permiso **revocado** que lo oculte.
2. Cada imagen se sirve por **enlace firmado** (~1 h). La familia puede **descargar**.
3. **Histórico:** si el niño cambió de aula o se fue, la familia **conserva** las publicaciones pasadas donde aparecía y **deja de ver** las nuevas del aula (P-histórico).

**Post-condiciones:**

- La familia **no** ve publicaciones de otras aulas ni del periodo posterior a la baja/cambio del niño.

### Comportamiento 5: Logo real del centro (ADR-0010)

1. Dirección sube el logo en `/admin/centro`; se procesa con `sharp` y se sube a `centro-assets/{centroId}/logo.{ext}` (bucket **público**).
2. La server action actualiza `centros.logo_url` con la URL pública.
3. La UI deja de usar la URL hardcodeada del repo.

### Comportamiento 6: Adjuntos de F8 (foto DNI) y foto del niño

1. En la firma de **recogida** (F8), el firmante adjunta la **foto del DNI**; se procesa (EXIF fuera), se sube al **bucket privado** y se referencia en `firmas.datos.adjuntos: [{ bucket, path, hash, metadata }]` (append-only, atado al `texto_hash` de la firma). **Sin fila en `media`**.
2. La **foto del niño** se sube en su ficha (bucket privado) y se referencia en `ninos.foto_url`. **Sin fila en `media`**.

## Casos edge

- **Sin publicaciones**: empty state ("aún no hay fotos") en familia y staff.
- **Sin `puede_ver_fotos`**: la familia no ve el contenido de fotos; la RLS lo bloquea aunque manipule la URL.
- **Niño sin `puede_aparecer_en_fotos`**: no aparece en el selector; intento directo → rechazo con aviso.
- **Permiso revocado a mitad** (dirección quita `puede_aparecer_en_fotos`): en la siguiente carga, las publicaciones que lo etiquetan se ocultan y no admite etiquetas nuevas (RLS evalúa en lectura/escritura).
- **`puede_ver_fotos` revocado a la familia**: deja de ver fotos al instante (RLS en lectura).
- **Enlace firmado caducado**: se re-firma al recargar; un enlace viejo compartido fuera **no** funciona.
- **Archivo inválido** (no imagen, tipo no permitido, supera ~10–15 MB, corrupto): rechazo con error claro; nada se persiste.
- **HEIC**: se convierte a JPG en servidor; si la conversión falla, se rechaza con error.
- **Subida parcial / red lenta**: la publicación no se confirma hasta que los `media` están subidos y procesados; reintento **idempotente por hash** (no duplica).
- **Concurrencia**: dos profes del aula publican a la vez → publicaciones independientes. Editar la misma publicación a la vez → última escritura gana (sin bloqueo formal; volumen bajo).
- **Niño dado de baja / cambia de aula**: conserva histórico, no ve lo nuevo (P-histórico).
- **Borrado**: real, con limpieza del objeto en Storage; un borrado deja `audit_log` con `valores_antes`.
- **Idiomas**: UI en es/en/va; el **texto libre** de la publicación lo escribe la profe (no se traduce).
- **Datos sensibles**: DNIs de terceros en adjuntos → RAT/retención en **F11**; fotos de menores → consentimiento (interruptor F10, firmable F11).

## Validaciones (Zod)

```typescript
// Límites cerrados (P4); el server revalida el binario real antes de sharp.
const MIME_FOTO = ['image/jpeg', 'image/png', 'image/heic', 'image/heif'] as const
const MAX_BYTES = 15 * 1024 * 1024 // ~15 MB
const MAX_FOTOS_PUBLICACION = 20

export const PublicacionSchema = z.object({
  aula_id: z.string().uuid(),
  texto: z.string().trim().max(2000, 'fotos.validation.texto_largo').optional(),
})

export const SubirFotoSchema = z.object({
  publicacion_id: z.string().uuid(),
  mime: z.enum(MIME_FOTO, { message: 'fotos.validation.tipo_no_permitido' }),
  // tamaño y nº de fotos se validan server-side (MAX_BYTES, MAX_FOTOS_PUBLICACION).
})

export const EtiquetarSchema = z.object({
  media_id: z.string().uuid(),
  nino_id: z.string().uuid(), // debe tener puede_aparecer_en_fotos = true (RLS + check)
})
```

- **Siempre** revalidar el tipo/tamaño **real** del binario (no fiarse del MIME declarado) antes de `sharp`.
- Mensajes en i18n (`fotos.validation.*`).

## Modelo de datos afectado

**Tablas nuevas (se concretan en F10-0; forma ya cerrada en lo esencial):**

- **`publicaciones`** — el post del blog. `id`, `centro_id` (redundante para RLS), `aula_id` (FK → `aulas` CASCADE), `autor_id` (FK → `usuarios`), `texto` (nullable, ≤ 2000), timestamps. **Publica directa** (sin estado borrador). **Sin `deleted_at`** (P-borrado = borrado real). **Auditada.**
- **`media`** — cada foto del blog (solo blog — P-media-reuso). `id`, `publicacion_id` (FK CASCADE), `centro_id`, `bucket`, `path`, `path_miniatura`, `hash`, `mime`, `ancho`, `alto`, `bytes`, timestamps. Borrado real + limpieza de objeto. **Auditada.**
- **`media_etiquetas`** — etiqueta `media × nino`. `media_id` (FK CASCADE), `nino_id` (FK), `centro_id`, timestamp. **UNIQUE `(media_id, nino_id)`**. Solo para niños con `puede_aparecer_en_fotos`. **Auditada.**

**Tablas modificadas:**

- **`ninos`**: **nueva columna `puede_aparecer_en_fotos boolean NOT NULL DEFAULT false`** (P1). `foto_url` pasa a usarse (apunta a Storage; sin cambio de esquema).
- **`vinculos_familiares`**: sin cambio de esquema; `puede_ver_fotos` (JSONB) pasa a **efectivo** por RLS.
- **`centros`**: `logo_url` se repunta al bucket público (cambio de valor, no de esquema).

**Tablas consultadas:** `matriculas` (aula activa), `profes_aulas` (autoría/lectura staff), `vinculos_familiares` (permiso familia), `firmas_autorizacion` (`datos.adjuntos`).

**Audit (P-audit):** las 3 tablas del blog se añaden a la lista de auditadas de `data-model.md` y a `audit_trigger_function` (rama por tabla, `centro_id` directo).

## Políticas RLS

Patrón **row-aware** (F8/F9, ADR-0007 + gotcha MVCC): toda policy SELECT evaluada sobre filas recién insertadas (`INSERT … RETURNING`) usa helpers que **no re-leen la propia tabla**.

- **Helper(s) propuestos** (a definir en F10-0), reusando `es_admin`, `es_profe_de_aula`, `es_tutor_de`, `tiene_permiso_sobre(nino_id, 'puede_ver_fotos')`, `centro_de_aula`, `centro_de_nino`, y el corte de autoría coordinadora/profesora (espejo de `es_redactor_de_nino`).
- **`publicaciones`**:
  - SELECT = staff del aula (`es_admin(centro_id) OR es_profe_de_aula(aula_id)`) **OR** familia con un hijo **matriculado activo** en el aula y **`puede_ver_fotos`** (blog colectivo, P2), **excluyendo** las publicaciones que etiqueten a un niño con permiso **revocado** que las oculte.
  - INSERT/UPDATE = **coordinadora/profesora del aula o admin** (P5). DELETE = **autor o admin** (P-borrado).
- **`media`**: hereda la visibilidad de su publicación.
- **`media_etiquetas`**: INSERT solo si el niño tiene `puede_aparecer_en_fotos` (check + RLS); SELECT acotada a quien puede ver la media; las etiquetas de un niño con permiso revocado **dejan de surtir efecto** (ocultan).

**Políticas de Storage (no solo de filas):** el cliente **nunca** accede al objeto privado directamente; el server genera **URLs firmadas** (~1 h) tras autorizar con la RLS de las tablas (patrón "service role tras autorizar", ADR-0027). El bucket del **logo es público** (lectura directa). Estructura de prefijos y políticas exactas del bucket → **ADR de Storage (F10-0)**.

## Storage (configuración — primer uso)

- **Buckets por sensibilidad (P3):**
  - **Privado** — fotos de niños: `media` del blog, `ninos.foto_url`, foto del DNI de recogida. Acceso solo por **URL firmada (~1 h)** generada server-side tras autorizar.
  - **Público** — `centro-assets/{centroId}/logo.{ext}` (logo; no sensible).
- **Procesado con `sharp`** (`^0.34.5`; precedente `scripts/process-logos.mjs`): **HEIC→JPG**, **quitar EXIF/geolocalización**, **miniatura(s)**, recomprimir. Idempotente por hash.
- **Límites (P4):** JPG/PNG/HEIC; ≤ ~15 MB/foto; ~10–20 fotos/publicación; TTL de firma ~1 h.
- **Retención formal RGPD** → **F11**.

## Pantallas y rutas

- `/teacher/aula/[id]/fotos` (o `/teacher/fotos`) — composer + listado de publicaciones del aula (ruta exacta a decidir en diseño).
- `/family/fotos` — vista lectora de las publicaciones del aula del hijo (con permiso).
- `/admin/centro` — **ampliación**: subir/sustituir logo del centro (ADR-0010).
- Ficha del niño (admin) — **ampliación**: subir `foto_url` + interruptor `puede_aparecer_en_fotos`.
- Flujo de **recogida** (F8) — **ampliación**: adjuntar foto del DNI.
- Route handler(s) server-side de **subida** y de **descarga/URL firmada** (binario — excepción legítima a "Server Actions, no API routes", como el PDF de F9-4).

## Componentes UI

- `PublicacionComposer.tsx` (Client) — texto + subida múltiple + etiquetado; `aria-busy` en subida.
- `EtiquetarFotoControl.tsx` (Client) — selector de niños con permiso por foto.
- `PublicacionesAula.tsx` (Server) — listado/edición para staff.
- `FotosFamilia.tsx` (Server) — vista lectora de familia (miniaturas → original firmado bajo demanda).
- `SubirLogoCentro.tsx` (Client) — admin (ADR-0010).
- `SubirFotoNino.tsx` + control de `puede_aparecer_en_fotos` (Client) — admin.

## Eventos y notificaciones

- **Aviso in-app de INICIO** (patrón #64, **sin push**, P8): al publicar, a las familias del aula con `puede_ver_fotos`. Editar **no** re-avisa (P-edición). Derivado/marcador como en #64 (sin tabla de avisos nueva, a confirmar en F10-0).
- **Audit**: INSERT/UPDATE/DELETE de `publicaciones`/`media`/`media_etiquetas` quedan en `audit_log` (trigger, `centro_id` directo).

## i18n

Namespace nuevo `fotos` (es/en/va): `title`, `composer.*`, `etiquetar.*`, `family.*`, `validation.*` (`tipo_no_permitido`, `tamano_max`, `max_fotos`, `texto_largo`), `errors.*`, `aviso.*` (publicación nueva). Texto libre de la publicación lo escribe la profe (no se traduce).

## Accesibilidad

- Imágenes con **`alt`** significativo (derivado del texto de la publicación; vacío decorativo si no aplica).
- Composer y etiquetado **navegables con teclado**; `aria-busy` en subida.
- Contraste AA; estados carga/empty/error anunciados.

## Performance

- **Miniaturas** en listados (no servir originales en la rejilla).
- **Paginación** del blog (p. ej. 20 publicaciones).
- URLs firmadas cacheables hasta su caducidad; evitar N+1 al firmar lotes.
- Subida y `sharp` **server-side**; procesar sin bloquear el render.

## Telemetría

- `publicacion_creada` (sin PII; nº de fotos).
- `fotos_vistas_familia`.
- `foto_descargada`.

## Tests requeridos

**Vitest (unit/integration):**

- [ ] Schemas Zod (publicación, subida, etiquetar) validan correctos e incorrectos.
- [ ] Procesado `sharp`: la salida **no** conserva EXIF/geolocalización; genera miniatura; **HEIC→JPG**; rechaza tipos/tamaños no permitidos.
- [ ] Gate de etiquetado: no se puede etiquetar a un niño sin `puede_aparecer_en_fotos`.

**Vitest (RLS):**

- [ ] Familia con `puede_ver_fotos` ve **todas** las publicaciones del aula de su hijo; **sin** el permiso, NO.
- [ ] Familia de otra aula/centro NO ve (aislamiento).
- [ ] No se puede crear `media_etiquetas` de un niño sin `puede_aparecer_en_fotos`; al **revocar**, las etiquetas dejan de surtir efecto.
- [ ] Coordinadora/profesora/admin publican y etiquetan; **técnico/apoyo NO**; staff de otra aula NO.
- [ ] Borrado real por autor/admin; otro rol NO.
- [ ] `.insert().select()` por el autor funciona (gotcha MVCC row-aware).
- [ ] **Storage**: un objeto privado no es accesible sin URL firmada; la firma caduca; el logo (público) sí es accesible.

**Playwright (E2E):**

- [ ] La profe crea una publicación con 2 fotos y etiqueta a un niño con permiso; la familia (con permiso) la ve y descarga; otra familia no.
- [ ] Editar una publicación no genera un aviso nuevo.

## Criterios de aceptación

- [ ] Todos los tests listados pasan en CI.
- [ ] `puede_ver_fotos` y `puede_aparecer_en_fotos` son **efectivos por RLS**.
- [ ] Las fotos de niños viajan **solo** por URL firmada (~1 h); sus buckets son **privados**; el logo es **público**.
- [ ] El binario subido **no** conserva EXIF/geolocalización; hay miniatura; HEIC se convierte a JPG.
- [ ] El logo del centro se sirve desde Storage (ADR-0010) y la URL hardcodeada desaparece.
- [ ] Los adjuntos de F8 (foto DNI) y `ninos.foto_url` usan Storage **sin** fila en `media`.
- [ ] Borrado real sin huérfanos en Storage; las 3 tablas se **auditan**.
- [ ] Aviso in-app de INICIO a las familias con permiso al publicar (sin push); editar no re-avisa.
- [ ] Las 3 lenguas (es/en/va) tienen todas las claves.
- [ ] axe-core sin violations en las pantallas afectadas.
- [ ] **ADR de Storage escrito** en F10-0 (buckets, políticas, EXIF/HEIC, miniaturas, límites).
- [ ] `data-model.md` y `rls-policies.md` actualizados (3 tablas + `puede_aparecer_en_fotos` + permisos + políticas de Storage + audit).

## Decisiones técnicas relevantes

- **ADR nuevo — Storage en NIDO** (deliverable de **F10-0**): buckets (privados para fotos de niños; público para el logo), políticas de acceso a objetos, **HEIC→JPG + limpieza de EXIF + miniaturas con `sharp`**, **enlaces firmados** (~1 h), **límites** (tipos/tamaño/nº). Su núcleo (estructura de buckets P3, límites P4) **ya está resuelto en esta spec**; el ADR lo formaliza al arrancar F10-0. Retención formal RGPD se difiere a F11.
- Reusa: **ADR-0006** (`puede_ver_fotos`), **ADR-0010** (logo → Storage público), **ADR-0041/F8** (`datos.adjuntos`), **ADR-0032** (corte coordinadora/profesora), **ADR-0007** + gotcha MVCC row-aware, **ADR-0027** (service role tras autorizar; route handler para binario).

## Referencias

- `docs/architecture/data-model.md` — módulo Multimedia (3 tablas, Fase 10), lista de auditadas, `ninos.foto_url`, `centros.logo_url`.
- **ADR-0006** — permisos granulares de `vinculos_familiares` (`puede_ver_fotos`, "RLS Fase 10").
- **ADR-0010** — logo del centro: URL relativa → migración a Storage en F10 (`centro-assets/{centroId}/logo.{ext}`).
- **ADR-0041** / `docs/specs/autorizaciones-firma.md` — adjuntos aplazados a F10 (`firmas.datos.adjuntos`), foto DNI de recogida, `autorizacion_imagenes` reservado para F11.
- **ADR-0032** — `tipo_personal_aula` (corte de autoría coordinadora/profesora).
- **ADR-0007** + sección gotcha MVCC de `rls-policies.md` — helpers row-aware.
- **ADR-0027** — service role tras autorizar; route handler para binario (precedente PDF F9-4).
- `scripts/process-logos.mjs` — precedente de procesado de imagen con `sharp`.
