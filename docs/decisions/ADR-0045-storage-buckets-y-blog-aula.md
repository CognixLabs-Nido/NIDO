# ADR-0045: Storage en NIDO (buckets, políticas, procesado) y modelo del blog del aula

## Estado

`accepted`

**Fecha:** 2026-06-11
**Autores:** responsable + claude-code
**Fase del proyecto:** Fase 10 — Fotos y publicaciones del aula (F10-0: capa de datos + Storage)

## Contexto

F10 introduce el **"blog del aula"** y, con él, el **primer uso de Supabase Storage** en NIDO. Hasta ahora ninguna fase había necesitado guardar binarios: las fotos de niños, el logo del centro (ADR-0010, hoy una URL relativa a un asset del repo) y los adjuntos de F8 (foto del DNI de recogida, aplazados a F10 vía `firmas.datos.adjuntos`) esperaban a que Storage existiera. Hay que **configurarlo bien una vez** (buckets, políticas a nivel de objeto, procesado de imagen) para no repetir trabajo en F11+.

Restricciones y fuerzas:

- **Datos de menores** → privacidad por defecto: nada de fotos accesibles por URL pública adivinable; metadatos de geolocalización (EXIF) fuera; enlaces que caduquen.
- **RLS ya es el modelo mental** del proyecto (default DENY, helpers row-aware, gotcha MVCC). Storage debe encajar: el acceso a los **objetos** se gobierna con políticas sobre `storage.objects`, no solo con la RLS de las tablas.
- **Consentimiento de imagen** por niño lo pone dirección en F10 (interruptor) y se hará firmable en F11 (`autorizacion_imagenes`).
- `sharp` ya es dependencia (`^0.34.5`, precedente `scripts/process-logos.mjs`).

Esta ADR cubre **F10-0** (capa de datos + configuración de Storage). El **pipeline de subida/procesado** (HEIC→JPG, EXIF, miniaturas) y la **UI** son F10-1+. Decisiones de producto cerradas en `docs/specs/fotos-publicaciones.md` (approved, P1–P8).

## Opciones consideradas

### Opción A: Buckets separados por sensibilidad + políticas sobre `storage.objects` con helpers SQL (elegida)

Varios buckets privados (fotos de niños) + uno público (logo); las políticas de `storage.objects` derivan el ámbito del **prefijo de la ruta** (`{centroId}/{aulaId}/{publicacionId}/…`) y reusan los helpers de RLS (`es_admin`, `es_redactor_de_aula`, `usuario_ve_publicacion_row`, …). El cliente nunca lee el objeto privado directamente: el server genera **URLs firmadas (~1 h)** tras autorizar.

**Pros:**

- **Aislamiento por sensibilidad**: el logo (no sensible) puede ser público; las fotos de niños nunca lo son. Límites de tamaño/tipo por bucket.
- Reusa el aparato de RLS y el patrón "service role tras autorizar" (ADR-0027). Coherente con el resto del proyecto.
- La ruta codifica el ámbito → políticas legibles y sin tablas extra.

**Contras:**

- Más de un bucket que mantener; la política depende de que el server escriba rutas bien formadas (lo controla él).

### Opción B: Un único bucket privado para todo

**Contras:** mezcla logo (público) con fotos de menores; políticas más enrevesadas (distinguir tipo por prefijo dentro del mismo bucket); no se puede marcar el logo como público sin abrir el resto.

### Opción C: Bucket público + ofuscación por nombre (URL "secreta")

**Contras:** seguridad por oscuridad sobre **datos de menores** — inaceptable (RGPD). Una URL filtrada da acceso permanente. Rechazada.

## Decisión

**Opción A.** Migración `20260611120000_phase10_0_storage_publicaciones.sql` (aditiva, manual por SQL Editor — CLI SIGILL). Incluye **buckets + políticas de Storage en el mismo SQL** que las tablas.

### Buckets (P3/P4)

| Bucket              | Público | Ruta                                    | Uso                             | Límite | MIME (entrada)        |
| ------------------- | ------- | --------------------------------------- | ------------------------------- | ------ | --------------------- |
| `aula-fotos`        | no      | `{centroId}/{aulaId}/{publicacionId}/…` | fotos del blog (`media`)        | 15 MB  | jpeg/png/heic/heif    |
| `ninos-fotos`       | no      | `{centroId}/{ninoId}/…`                 | `ninos.foto_url`                | 15 MB  | jpeg/png/heic/heif    |
| `recogida-adjuntos` | no      | `{centroId}/{firmaId}/…`                | foto DNI (F8, `datos.adjuntos`) | 15 MB  | jpeg/png/heic/heif    |
| `centro-assets`     | **sí**  | `{centroId}/logo.{ext}`                 | logo (ADR-0010)                 | 5 MB   | png/jpeg/svg+xml/webp |

- **Enlaces firmados ~1 h** para los privados (los genera el server). **HEIC→JPG + limpieza de EXIF + miniaturas** las hace el pipeline `sharp` en **F10-1**; `media.mime` guarda la **salida** (jpeg/png/webp).
- **Retención formal RGPD** (borrado por plazo, derecho al olvido sobre Storage; DNIs de terceros) → **F11**.

### Políticas de `storage.objects`

- `aula-fotos`: **SELECT** = `usuario_ve_publicacion_row(centro, aula, publicacion)` (staff del aula + familia con `puede_ver_fotos`, P2); **INSERT** = `es_admin` o `es_redactor_de_aula` (P5); **DELETE** = autor de la publicación o admin.
- `ninos-fotos`: SELECT = staff del niño + tutores; escribir/borrar = admin (ficha).
- `recogida-adjuntos`: **baseline** staff del centro lee/sube (el alcance fino atado a la firma se refina cuando aterrice la UI de adjuntos de F8). Sensible → RAT/retención en F11.
- `centro-assets`: lectura **pública**; escribir/borrar = admin del centro.

### Modelo del blog (3 tablas)

- **`publicaciones`** (cuelga de un aula; publica directa, editable; **borrado real**, sin `deleted_at`).
- **`media`** (cada foto; **solo del blog** — los adjuntos usan campos propios, P-media-reuso).
- **`media_etiquetas`** (media×niño; solo niños con `ninos.puede_aparecer_en_fotos`).
- Nueva columna **`ninos.puede_aparecer_en_fotos boolean DEFAULT false`** (P1). Las 3 tablas se **auditan** (P-audit).

### RLS (patrón F8/F9, row-aware)

- Helper **`usuario_ve_publicacion_row(centro, aula, publicacion)`**: recibe los campos por parámetro y **no re-lee `publicaciones`** → seguro frente al gotcha MVCC en `INSERT…RETURNING`. Sus lookups (`es_profe_de_aula`, `familia_ve_aula`, `publicacion_tiene_nino_sin_permiso`) leen **otras** tablas.
- **`puede_ver_fotos`** (clave JSONB de `vinculos_familiares`, inerte hasta hoy) pasa a **efectivo** vía `familia_ve_aula` → `tiene_permiso_sobre(nino, 'puede_ver_fotos')` (P2).
- **Gate de etiquetado**: `media_etiquetas_insert` exige `nino_puede_aparecer(nino_id)`; **revocar** el permiso oculta la publicación a la familia (`publicacion_tiene_nino_sin_permiso`). El **aviso a la profe** al intentar etiquetar a un niño sin permiso es **UI (F10-2)**.
- Escritura solo **coordinadora/profesora/admin** del aula (`es_redactor_de_aula`, espejo de `es_redactor_de_nino`); técnico/apoyo solo leen (P5).

## Consecuencias

- **Positivas:** Storage queda configurado y reutilizable (logo, foto niño, DNI) sin rework; privacidad por defecto (privados + firmados + EXIF fuera); el blog encaja en el modelo RLS existente; `puede_ver_fotos` deja de ser un flag muerto.
- **Negativas / límites:** varias políticas de `storage.objects` que mantener; la regla "ocultar publicación si etiqueta a un niño sin permiso" oculta el post **entero** a las familias (consecuencia aceptada de P2); el acceso a `recogida-adjuntos` es **baseline** (staff del centro) hasta que F8-adjuntos lo afine; retención RGPD pendiente de F11.
- **Siguiente:** F10-1 (pipeline `sharp` + endpoints de subida/firma + UI de blog), F10-2 (etiquetado con aviso a la profe + aviso de INICIO #64), y el aterrizaje de logo/foto-niño/DNI sobre estos buckets.

## Referencias

- Spec: `docs/specs/fotos-publicaciones.md` (approved; P1–P8).
- ADR-0006 — `puede_ver_fotos` (permiso inerte hasta F10).
- ADR-0010 — logo del centro → bucket `centro-assets`.
- ADR-0041 / `autorizaciones-firma.md` — adjuntos F8 (`datos.adjuntos`), `autorizacion_imagenes` (F11).
- ADR-0032 — `tipo_personal_aula` (corte coordinadora/profesora).
- ADR-0007 + sección gotcha MVCC de `rls-policies.md` — helpers row-aware.
- ADR-0027 — service role tras autorizar; route handler para binario.
- `scripts/process-logos.mjs` — precedente de `sharp`.
