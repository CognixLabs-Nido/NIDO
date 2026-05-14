# ADR-0010: Logo del centro como URL relativa hasta Storage

## Estado

`accepted`

**Fecha:** 2026-05-14
**Autores:** responsable + claude-code
**Fase del proyecto:** Fase 2.6 — Datos pedagógicos del niño + logo del centro

## Contexto

La directora de ANAIA pidió que el logo de su escuela aparezca junto al de NIDO en la sidebar de la app (Fase 2.5 dejó el hueco). En el futuro, cuando entren más centros al producto (Ola 2), cada uno tendrá su propio logo y necesitará una manera de subirlo desde la app sin tocar el repo.

Hoy:

- Supabase Storage **no está configurado** todavía (llega en Fase 10 — fotos y publicaciones).
- Solo hay un centro real (ANAIA) y un par de logos PNG que el responsable ya subió.
- El sidebar fijo (Fase 2.5) tiene un slot natural para el logo del centro.

La decisión: cómo guardar y servir el logo de un centro hoy sin condicionar el flujo definitivo que llegará en Fase 10.

## Opciones consideradas

### Opción A: Esperar a Fase 10 — sin logo de centro hoy

Mantener `centros` sin columna nueva. La directora ve solo el wordmark NIDO.

**Pros:**

- Zero scope creep. Una decisión menos que tomar.

**Contras:**

- La directora ya pidió el logo. Cumplir ahora cuesta poco.
- El sidebar (Fase 2.5) tiene el hueco; dejarlo vacío es ruido visual.

### Opción B: Storage real desde Fase 2.6

Configurar bucket Supabase Storage, política RLS para que admin del centro suba/lea, UI de upload en `/admin/centro`, columna `logo_path` que apunta al fichero.

**Pros:**

- Cierra el flujo definitivo. Cuando llegue Fase 10, ya tenemos Storage funcionando.

**Contras:**

- Storage en Supabase requiere RLS específica, signed URLs, política de tamaños, validación de tipos MIME, manejo de borrados huérfanos. Es un mini-proyecto.
- Hay un solo centro. Sobre-ingeniería para Ola 1.
- Acopla el calendario de Fase 2.6 (lightweight, pre-Fase 3) al de Fase 10 (fotos y media).

### Opción C: URL relativa en `centros.logo_url` apuntando a asset estático (elegida)

Añadir columna `logo_url TEXT NULL` y poblarla con `/brand/anaia-logo-wordmark.png` para ANAIA. El asset vive en `public/brand/`, commiteado en el repo. La UI lee `centros.logo_url` y monta un `next/image` con esa src.

**Pros:**

- Implementación de 1 hora: ALTER TABLE + UPDATE + componente `<CentroLogo />` + integración en `<SidebarNav />`.
- Cuando llegue Fase 10, basta cambiar el campo a una URL firmada de Storage. El resto de la app no se entera.
- Coherente con cómo NIDO ya sirve sus propios assets (`/brand/nido-logo-*.png`).
- Performance excelente: asset estático con cache CDN gratis vía Vercel.

**Contras:**

- No es un flujo de upload "real". Si la directora quiere cambiar el logo, hoy tiene que pedírselo al responsable (que mueve un PNG al repo y commitea).
- Multi-centro requiere o bien un fichero por centro (escalable a docenas, no a miles) o el flujo de Storage cuando llegue.

## Decisión

**Se elige la Opción C.**

Razones:

- Cumple lo pedido por la directora con coste mínimo.
- No bloquea Fase 3 (la real necesidad de avanzar).
- El upgrade a Storage en Fase 10 es trivial: solo cambia el contenido del campo `logo_url`. Cero refactor del frontend.

## Consecuencias

### Positivas

- `<CentroLogo />` es un componente reutilizable. La query `getCentroLogo(centroId)` es server-only + `cache()` por request.
- Mientras estemos en Ola 1 (un solo centro), la solución es suficiente. Si en algún punto llegan 2-3 centros antes de Fase 10, basta commitear más PNGs y poblar `logo_url` por SQL — sigue funcionando.

### Negativas

- Sin self-service para la directora. Asumido: el responsable hace de gatekeeper hasta Storage.
- Si el logo cambia (rebranding del centro), hay que pasar por el repo. Aceptable mientras el equipo sea pequeño.

### Neutras

- `logo_url TEXT NULL` admite cualquier URL (incluida una firmada de Storage). Cuando lleguemos a Fase 10, **no hay migración de schema**: solo poblamos con URLs distintas.
- No se añade `logo_full_url` ni `logo_mark_url` adicionales hoy. Si en el futuro se necesita distinguir variantes (sidebar vs hero vs favicon), se amplía el modelo. La spec de Fase 2.6 lo apunta como out-of-scope explícito.

## Plan de implementación

- [x] Migración añade columna `centros.logo_url TEXT NULL` y `UPDATE` con `/brand/anaia-logo-wordmark.png` para el UUID de ANAIA.
- [x] PNGs de ANAIA commiteados en `public/brand/` (`anaia-logo-wordmark.png` 356×94, `anaia-logo-full.png` 1024×1024).
- [x] Query `src/features/centros/queries/get-centro-logo.ts` cacheada con `React.cache()`.
- [x] Componente `src/shared/components/brand/CentroLogo.tsx`.
- [x] Integración en `<SidebarNav />`: desktop bajo el wordmark NIDO con separador, mobile en el header al lado del LogoMark.
- [x] Test E2E que verifica que el asset `/brand/anaia-logo-wordmark.png` se sirve correctamente.

## Verificación

- `npm run build` produce ruta estática para el asset.
- `curl /brand/anaia-logo-wordmark.png` (en Vercel preview) responde 200 image/png.
- Visual: tras login el sidebar muestra el wordmark de NIDO arriba y el de ANAIA debajo en desktop; en mobile aparecen lado a lado en el header.

## Plan de migración a Storage (Fase 10)

Cuando lleguemos a Fase 10 (fotos y publicaciones, momento en el que Storage se configura):

1. Crear bucket `centro-assets` con RLS: admin del centro puede `UPLOAD` / `UPDATE` / `DELETE` archivos bajo el prefijo `{centroId}/`. Todos los usuarios autenticados del centro pueden `SELECT`.
2. Mover los PNGs actuales a `centro-assets/33c79b50-13b5-4962-b849-d88dd6a21366/logo.png`.
3. UI en `/admin/centro` para subir/sustituir el logo.
4. Server action `actualizarLogoCentro(centroId, file)` que sube a Storage, obtiene la URL firmada o pública (según política de privacidad), actualiza `centros.logo_url`.
5. Migración: `UPDATE centros SET logo_url = '<nueva URL Storage>' WHERE id = ...`.

No hace falta ALTER TABLE ni cambio de tipo en `centros.logo_url`: sigue siendo `TEXT`.

## Referencias

- Spec: `/docs/specs/pedagogical-data.md`
- ADR-0008 (sistema de diseño): el slot del logo del centro está pensado desde Fase 2.5.
- `docs/roadmap.md`: entrada "Upload real de logo a Supabase Storage" con el disparador de Fase 10.
