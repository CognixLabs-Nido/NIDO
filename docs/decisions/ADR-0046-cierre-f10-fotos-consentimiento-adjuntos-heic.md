# ADR-0046: Cierre de F10 — consentimiento/visibilidad efectivos por RLS, histórico de familia, adjuntos sobre Storage y rechazo de HEIC

## Estado

`accepted`

**Fecha:** 2026-06-12
**Autores:** responsable + claude-code
**Fase del proyecto:** Fase 10 — Fotos y publicaciones del aula (cierre: F10-0 → F10-3)

> Complementa [ADR-0045](./ADR-0045-storage-buckets-y-blog-aula.md) (Storage + capa de datos del blog, F10-0). Aquí se recogen las decisiones de producto/arquitectura tomadas al construir la UI y los adjuntos (F10-1, F10-2, F10-3) y la decisión de **rechazar HEIC** con su límite documentado.

## Contexto

F10-0 (ADR-0045) dejó la base: 3 tablas (`publicaciones`/`media`/`media_etiquetas`), la columna `ninos.puede_aparecer_en_fotos`, 4 buckets de Storage y los helpers RLS. Sobre esa base, F10-1…F10-3 construyeron la UI (composer de la profe, vista de familia, avisos) y aterrizaron los **adjuntos** que dependían de Storage (foto del niño, logo del centro, foto del DNI de recogida de F8). Durante el camino surgieron decisiones que no estaban cerradas en la spec o que se desviaron de ella; este ADR las fija para que el cierre de F10 quede trazado.

Cuatro frentes:

1. **Consentimiento y visibilidad** — activar a RLS real los permisos que estaban inertes (`puede_ver_fotos`) y el gate de etiquetado (`puede_aparecer_en_fotos`).
2. **Histórico de la familia** (F10-2) — qué ve una familia cuando su hijo se va o cambia de aula.
3. **Adjuntos sobre Storage** (F10-3) — quién sube qué, dónde, y cómo se ata a F8.
4. **HEIC** — el formato nativo del iPhone (el dispositivo real de las profes) resultó inviable de decodificar en F10; hubo que decidir el comportamiento de envío y dejar trazada la vía de retorno.

## Decisiones

### 1. Consentimiento de imagen y visibilidad de familia, efectivos por RLS

- **`ninos.puede_aparecer_en_fotos`** (boolean, **default `FALSE`**) es el **gate de etiquetado**: la profe solo puede etiquetar a niños con el interruptor a `true`; lo pone **dirección** según el consentimiento en papel (en F11 lo alimentará `autorizacion_imagenes` firmable). Revocarlo **oculta** las publicaciones donde el niño está etiquetado (RLS, no solo UI).
- **`puede_ver_fotos`** (JSONB de `vinculos_familiares`, ADR-0006) pasa de **inerte** a **efectivo por RLS**: la familia ve el **blog colectivo del aula** de su hijo (todas las publicaciones del aula, P2) **solo** si tiene el permiso. El helper `familia_ve_aula(aula_id)` conecta `tiene_permiso_sobre(nino, 'puede_ver_fotos')` a la policy SELECT de `publicaciones`/`media`.
- La vista de familia es **solo lectura** (ver + descargar), **sin etiquetas** (privacidad): la familia no ve a qué otros niños se etiquetó.

### 2. Histórico de la familia (F10-2)

**Problema:** la visibilidad base de F10-0 (`familia_ve_aula`) exige **matrícula activa**. Un niño que se va o cambia de aula perdería de golpe **todo** el blog pasado donde aparece — contradice P-histórico ("la familia conserva las publicaciones pasadas donde salía su hijo").

**Decisión (Opción 1 — migración RLS nueva, no editar la de F10-0):** se añadió una **vía adicional "mi hijo está etiquetado"** a la visibilidad, vía un helper **row-aware nuevo** `publicacion_etiqueta_hijo_de(p_publicacion_id)` (lee `media`/`media_etiquetas` con `es_tutor_de` + `tiene_permiso_sobre('puede_ver_fotos')`, **no** re-lee `publicaciones` → seguro frente al gotcha MVCC). `usuario_ve_publicacion_row` queda:

```
es_admin(centro) OR es_profe_de_aula(aula)
  OR (familia_ve_aula(aula)             AND NOT publicacion_tiene_nino_sin_permiso(pub))   -- blog del aula activo
  OR (publicacion_etiqueta_hijo_de(pub) AND NOT publicacion_tiene_nino_sin_permiso(pub))   -- histórico: mi hijo sale
```

Resultado: la familia **conserva** las publicaciones pasadas donde su hijo está etiquetado aunque cause baja/cambie de aula, y **deja de ver** las publicaciones nuevas del aula que no le etiquetan. Migración `20260612120000_phase10_2_fotos_familia_historico` (aditiva, `CREATE OR REPLACE`).

### 3. Adjuntos sobre Storage (F10-3)

Los tres adjuntos reusan los buckets de F10-0 y el procesado de F10-1 (`sharp`: EXIF/geo fuera, HEIC rechazado igual que el blog). **Ninguno usa la tabla `media`** (campos propios — P-media-reuso).

- **Foto del niño** (`ninos.foto_url`, bucket privado `ninos-fotos`): la sube el **tutor** desde la **ficha de su hijo** (`/family/nino/[id]`) y, alternativa, **dirección** desde `admin/ninos/[id]`. (El "asistente de onboarding F2.6" no existe como tal; el enganche acordado es la ficha persistente del tutor — sin construir wizard nuevo.) La subida va con el **cliente del usuario** → la RLS de `storage.objects` decide; el `UPDATE` de `foto_url` (que el tutor no puede hacer por la RLS de `ninos`) va con **service role tras autorizar** (ADR-0027). Se muestra por enlace firmado (~1 h).
- **Foto del DNI de recogida** (`firmas.datos.adjuntos`, bucket privado `recogida-adjuntos`): la sube el **tutor**, **1 opcional por persona autorizada**, **ANTES de firmar** la recogida (F8). La referencia `{ bucket, path, hash, metadata.dni }` se incluye en `datos.adjuntos` y se **pliega al `texto_hash`** de la firma → queda **atada a la firma append-only de F8** (retrocompatible: sin adjuntos el hash no cambia, las firmas de F8-1/2b siguen verificando). Se threadea por las **dos** vías de firma (`crearRecogida` y `firmarAutorizacion`) vía el editor compartido. Documento **legible** (se comprime poco; solo EXIF fuera). La dirección **NO** sube DNIs.
- **Logo del centro** (`centros.logo_url`, bucket **público** `centro-assets`, ADR-0010): lo sube **dirección** desde `admin/centro`; PNG conservando transparencia, sin metadatos; repunta `logo_url` a la URL pública (con cache-bust) y **sustituye** el seed hardcodeado `/brand/anaia-logo-wordmark.png`.

**Políticas de Storage del tutor** (migración nueva `20260613100000_phase10_3_adjuntos_storage_policies`, aditiva): las de F10-0 solo dejaban escribir a dirección/staff. F10-3 añade al **tutor** escritura bajo `{centroId}/{ninoId}/…` en `ninos-fotos` (INSERT/DELETE) y `recogida-adjuntos` (INSERT/SELECT), acotada por `es_tutor_de(ninoId)`. **Aislamiento entre familias** verificado por tests RLS (un tutor no escribe bajo el `{ninoId}` de otra familia).

### 4. HEIC — rechazo con aviso claro (decisión y límite)

**Problema:** el iPhone fotografía en **HEIC** por defecto, y decodificarlo en F10 resultó inviable por **dos** caminos independientes, ambos reproducidos/verificados (no por inferencia):

- **Decode en cliente** (`heic-to`, `heic2any`): ambas decodifican en un **Web Worker `blob:` que cuelga en silencio** (la promesa nunca resuelve ni rechaza → la foto "desaparecía" a ~3 s sin error). Reproducido en headless Chromium con un HEIC real de iPhone.
- **Decode en servidor** (`heic-decode`→`sharp`): el build de **Turbopack (Next 16) no embarca `libheif.wasm`** en la función serverless — `outputFileTracingIncludes` se **ignora** (verificado con el page-key correcto) y `require.resolve` del `.wasm` **rompe el build** ("Package libheif-js can't be external").

**Decisión:** F10 se envía **RECHAZANDO HEIC** con mensaje claro (`fotos.validation.heic_no_soportado`: "Convierte la foto a JPG o PNG antes de subirla"). **JPG/PNG funcionan** en todas las subidas (blog, foto del niño, DNI). Es un compromiso consciente: cero "desapariciones" silenciosas a cambio de pedir conversión manual.

**Vías para retomarlo (DOS, no una)** — afecta también a las subidas de familia desde móvil:

- **(a) Decode server-side con build Webpack** (en vez de Turbopack). Webpack + `outputFileTracingIncludes` **sí** embarca el `.wasm`. Coste: cambia el pipeline de build de **toda la app** → más alcance/riesgo. Restaurar `heic-decode`/`libheif-js`, `serverExternalPackages`, `maxDuration` y el pipeline `heic-decode→sharp` (existió en ramas previas de #81).
- **(b) [No explorada, posiblemente más limpia] Decode nativo en el navegador, sin wasm.** `<img>`/`createImageBitmap` del HEIC → `<canvas>` → `toBlob('image/jpeg')`. Safari/iOS decodifica HEIC de forma **nativa** (es su formato), evitando el worker que cuelga, el `.wasm` que no se embarca y el coste de CPU en servidor. **Limitación:** no funciona en navegadores sin HEIC nativo (Chrome/Firefox de escritorio) → **combinar con el rechazo actual como respaldo** (detectar soporte; si no, mostrar el aviso). **Verificar en un iPhone REAL** — el harness headless de Chromium NO sirve (no tiene HEIC nativo).

## Opciones consideradas (resumen de las decisiones con alternativa real)

- **Histórico de familia:** (1) **migración RLS nueva con vía "mi hijo etiquetado"** (elegida) vs (2) relajar `familia_ve_aula` a matrícula histórica (rompía el corte "blog del aula activo" y mostraba lo nuevo del aula a quien ya no está). Se eligió (1) por aislar el cambio sin tocar la policy base de F10-0.
- **DNI de recogida:** (1) **subir-antes-de-firmar, plegado al hash** (elegida, mantiene la inmutabilidad/append-only de F8 y la prueba de integridad) vs (2) anexar después de firmar (rompía el hash y la cadena de F8). 1 foto **opcional** por persona (no obligatoria para firmar).
- **Foto del niño — enganche del tutor:** (1) **ficha persistente `/family/nino/[id]`** (elegida) vs (2) wizard de onboarding post-invitación (no existe; sería pieza nueva de F2.6 — queda como follow-up opcional).
- **HEIC:** (1) **rechazar con aviso** (elegida para enviar F10) vs (2/3) decode cliente/servidor (descartadas tras reproducir los fallos).

## Consecuencias

**Positivas**

- `puede_ver_fotos` y `puede_aparecer_en_fotos` son **efectivos por RLS** (no solo UI); aislamiento entre familias verificado por tests.
- La familia conserva el histórico de su hijo sin ver lo ajeno; el corte se evalúa en lectura **y** escritura.
- Los adjuntos reusan Storage sin tabla nueva; el DNI queda atado criptográficamente a la firma de F8.
- Cero "desapariciones" silenciosas de fotos: el HEIC se rechaza visiblemente.

**Negativas / deuda asumida**

- **HEIC no soportado en subida** → fricción real para profes/familias con iPhone (deben convertir). Follow-up con las dos vías de arriba.
- **Tope de 4 MB por foto** (margen bajo el body de 4,5 MB de una función Vercel): fotos grandes de móvil pueden superarlo → follow-up de **subida directa a Storage**.
- **DNIs de terceros** en `recogida-adjuntos` → entran en el paquete **RGPD/RAT y retención** de F11.
- Validez **jurídica** de la firma con adjunto sigue pendiente de abogado (heredado de F8, ⚖️).

## Seguimiento (follow-ups registrados en `docs/follow-ups.md`)

- HEIC en subida (vías a y b) — afecta también a las subidas de familia desde móvil. F11 o tarea aparte.
- Subida directa a Storage para fotos > ~4,5 MB (hoy tope 4 MB).
- Fijar la versión del CLI de Supabase en el repo (evita el ruido de reformateo al regenerar tipos).
- Retención RGPD de fotos de menores + DNIs de terceros, y `autorizacion_imagenes` **firmable** (reusa F8, alimenta `puede_aparecer_en_fotos`) → F11.
- (Opcional) wizard de onboarding del tutor que empuje a poner la foto del niño en el alta → pieza de F2.6.

## Referencias

- [ADR-0045](./ADR-0045-storage-buckets-y-blog-aula.md) — Storage + capa de datos del blog (F10-0).
- [ADR-0006](./ADR-0006-permisos-granulares-vinculos.md) — `puede_ver_fotos`; [ADR-0010](./ADR-0010-logo-centro-url-relativa.md) — logo → Storage; [ADR-0041](./ADR-0041-modelo-autorizaciones-firma-digital.md) — F8/`datos.adjuntos`; [ADR-0027](./ADR-0027-push-notifications-arquitectura.md) — service role tras autorizar; [ADR-0007](./ADR-0007-rls-policy-recursion-avoidance.md) + gotcha MVCC.
- `docs/specs/fotos-publicaciones.md` — spec de la fase. `docs/journey/progress.md` — Fase 10. `docs/follow-ups.md` — backlog.
