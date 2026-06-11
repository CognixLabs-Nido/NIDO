-- =============================================================================
-- Fase 10-0 — Base de Storage + blog del aula (capa de datos + RLS + buckets)
-- =============================================================================
-- ADITIVA: las tablas `publicaciones`/`media`/`media_etiquetas` NO existen → solo
-- CREATE. NUNCA drop+recreate. Fuente de verdad: docs/specs/fotos-publicaciones.md
-- (approved). ADR de Storage: ADR-0045 (formaliza P3/P4).
--
-- QUÉ ES: el "blog del aula" + la PRIMERA configuración de Supabase Storage. La
-- profe (coordinadora/profesora) o admin suben fotos en publicaciones del aula,
-- etiquetan a los niños que aparecen, y la familia (con `puede_ver_fotos`) ve TODO
-- el blog del aula de su hijo. F10-0 es SOLO capa de datos + Storage (sin UI ni
-- pipeline de subida/sharp — eso es F10-1).
--
-- DECISIONES (spec aprobada, P1..P8):
--  - P1  `ninos.puede_aparecer_en_fotos` boolean DEFAULT false (lo pone dirección).
--  - P2  Etiquetar solo niños con permiso; revocar OCULTA las publicaciones que lo
--        etiquetan (a la familia) y bloquea nuevas etiquetas; familia con
--        `puede_ver_fotos` ve TODO el blog del aula. `puede_ver_fotos` (inerte hasta
--        hoy) pasa a EFECTIVO por RLS.
--  - P3  Buckets por sensibilidad: PRIVADOS (fotos de niños: blog, foto del niño,
--        foto DNI) + PÚBLICO (logo, centro-assets — ADR-0010).
--  - P4  JPG/PNG/HEIC (HEIC→JPG en el pipeline F10-1); ≤ ~15 MB; ~10-20 fotos/pub;
--        enlaces firmados ~1 h (los genera el server). Retención RGPD → F11.
--  - P5  Escriben coordinadora/profesora/admin del aula; técnico/apoyo solo leen.
--  - P-media-reuso  `media` es SOLO del blog. Los adjuntos (foto niño/logo/DNI) usan
--        sus campos propios (`ninos.foto_url`, `centros.logo_url`,
--        `firmas.datos.adjuntos`) → NO entran en `media`.
--  - P-edición  Publicación directa, editable; editar no re-avisa (lógica de app).
--  - P-borrado  Borrado REAL (fila + objeto en Storage, lo hace el server); autor o
--        admin. Sin `deleted_at`.
--  - P-audit  Se auditan las 3 tablas (quién sube/etiqueta/borra).
--
-- HELPERS nuevos (STABLE SECURITY DEFINER): es_redactor_de_aula, familia_ve_aula,
-- aula_de_publicacion, centro_de_publicacion, autor_de_publicacion,
-- publicacion_de_media, nino_puede_aparecer, publicacion_tiene_nino_sin_permiso, y
-- el ROW-AWARE `usuario_ve_publicacion_row(centro,aula,publicacion)` para la SELECT
-- (recibe los campos por parámetro; sus lookups van a OTRAS tablas, nunca a
-- publicaciones → seguro frente al gotcha MVCC en INSERT…RETURNING).
--
-- STORAGE: 4 buckets + políticas sobre storage.objects (acceso a los OBJETOS por
-- rol/permiso, no solo a las filas). Las rutas codifican el ámbito:
--   aula-fotos        : {centroId}/{aulaId}/{publicacionId}/{archivo}
--   ninos-fotos       : {centroId}/{ninoId}/{archivo}
--   recogida-adjuntos : {centroId}/{firmaId}/{archivo}
--   centro-assets     : {centroId}/logo.{ext}   (PÚBLICO)
--
-- audit_trigger_function ampliada con 3 ramas (centro_id directo).
--
-- Operación sobre esquema productivo → se aplica MANUALMENTE por SQL Editor (CLI con
-- bug SIGILL). Incluye buckets y políticas de Storage en el mismo SQL. Tras aplicarla,
-- registrar en supabase_migrations.schema_migrations y regenerar src/types/database.ts.
-- =============================================================================
BEGIN;

-- ─── 1. Columna ninos.puede_aparecer_en_fotos (P1) ───────────────────────────
ALTER TABLE public.ninos
  ADD COLUMN IF NOT EXISTS puede_aparecer_en_fotos boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.ninos.puede_aparecer_en_fotos IS
  'P1/F10: interruptor de consentimiento de imagen. Default FALSE (no aparece hasta que dirección lo marque según el papel firmado). En F11 lo alimentará la autorización firmable autorizacion_imagenes. Gate de etiquetado en media_etiquetas.';

-- ─── 2. Tablas del blog ──────────────────────────────────────────────────────
-- publicaciones: el post del aula. Publica directa (sin estado borrador, P-edición).
-- Sin deleted_at: el borrado es REAL (P-borrado). `centro_id` se deriva del aula.
CREATE TABLE public.publicaciones (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id  uuid NOT NULL REFERENCES public.centros(id)  ON DELETE CASCADE,
  aula_id    uuid NOT NULL REFERENCES public.aulas(id)    ON DELETE CASCADE,
  autor_id   uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  texto      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT publicaciones_texto_len CHECK (texto IS NULL OR char_length(texto) <= 2000)
);
COMMENT ON TABLE public.publicaciones IS
  'Blog del aula (F10): publicación colectiva que cuelga de un aula. Solo fotos (media). Borrado real. Ver docs/specs/fotos-publicaciones.md y ADR-0045.';

-- media: cada foto del blog. SOLO del blog (P-media-reuso): los adjuntos (foto niño/
-- logo/DNI) NO usan esta tabla. `bucket`/`path` referencian el objeto en Storage;
-- `path_miniatura` lo rellena el pipeline (F10-1). mime = salida procesada.
CREATE TABLE public.media (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publicacion_id uuid NOT NULL REFERENCES public.publicaciones(id) ON DELETE CASCADE,
  centro_id      uuid NOT NULL REFERENCES public.centros(id)        ON DELETE CASCADE,
  bucket         text NOT NULL,
  path           text NOT NULL,
  path_miniatura text,
  hash           text,
  mime           text NOT NULL,
  ancho          integer,
  alto           integer,
  bytes          bigint,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT media_path_unico UNIQUE (bucket, path),
  CONSTRAINT media_mime_imagen CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp'))
);
COMMENT ON TABLE public.media IS
  'Foto del blog del aula (F10). SOLO del blog: los adjuntos (foto niño/logo/DNI) usan ninos.foto_url / centros.logo_url / firmas.datos.adjuntos, NO esta tabla (P-media-reuso). mime = salida ya procesada (HEIC→JPG en F10-1).';

-- media_etiquetas: qué niños aparecen en una foto. Solo niños con permiso (gate P2,
-- enforzado en INSERT). UNIQUE evita duplicar la etiqueta.
CREATE TABLE public.media_etiquetas (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id   uuid NOT NULL REFERENCES public.media(id)   ON DELETE CASCADE,
  nino_id    uuid NOT NULL REFERENCES public.ninos(id)   ON DELETE CASCADE,
  centro_id  uuid NOT NULL REFERENCES public.centros(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT media_etiquetas_unica UNIQUE (media_id, nino_id)
);
COMMENT ON TABLE public.media_etiquetas IS
  'Etiqueta media×niño (F10). Solo para niños con ninos.puede_aparecer_en_fotos=true (gate P2). Revocar el permiso OCULTA las publicaciones etiquetadas a la familia y bloquea nuevas etiquetas.';

-- Índices de navegación.
CREATE INDEX idx_publicaciones_aula   ON public.publicaciones (aula_id, created_at DESC);
CREATE INDEX idx_publicaciones_centro ON public.publicaciones (centro_id);
CREATE INDEX idx_media_publicacion    ON public.media (publicacion_id);
CREATE INDEX idx_media_etiquetas_media ON public.media_etiquetas (media_id);
CREATE INDEX idx_media_etiquetas_nino  ON public.media_etiquetas (nino_id);

-- ─── 3. Helpers ──────────────────────────────────────────────────────────────
-- ¿Soy REDACTOR del aula? (coordinadora/profesora activa). Espejo de es_profe_de_aula
-- + filtro de tipo (corte de autoría P5/ADR-0032). tecnico/apoyo → false.
CREATE OR REPLACE FUNCTION public.es_redactor_de_aula(p_aula_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profes_aulas
    WHERE profe_id = auth.uid()
      AND aula_id = p_aula_id
      AND fecha_fin IS NULL AND deleted_at IS NULL
      AND tipo_personal_aula IN ('coordinadora', 'profesora')
  );
$$;
GRANT EXECUTE ON FUNCTION public.es_redactor_de_aula(uuid) TO authenticated;

-- ¿Soy FAMILIA con `puede_ver_fotos` de algún niño matriculado activo en el aula?
-- Aquí se CONECTA a RLS real el permiso `puede_ver_fotos` (hoy inerte) — P2.
CREATE OR REPLACE FUNCTION public.familia_ve_aula(p_aula_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.matriculas m
    WHERE m.aula_id = p_aula_id
      AND m.fecha_baja IS NULL AND m.deleted_at IS NULL
      AND public.tiene_permiso_sobre(m.nino_id, 'puede_ver_fotos')
  );
$$;
GRANT EXECUTE ON FUNCTION public.familia_ve_aula(uuid) TO authenticated;

-- Lookups de publicación (leen `publicaciones`, tabla distinta de `media`).
CREATE OR REPLACE FUNCTION public.aula_de_publicacion(p_publicacion_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT aula_id FROM public.publicaciones WHERE id = p_publicacion_id;
$$;
GRANT EXECUTE ON FUNCTION public.aula_de_publicacion(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.centro_de_publicacion(p_publicacion_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT centro_id FROM public.publicaciones WHERE id = p_publicacion_id;
$$;
GRANT EXECUTE ON FUNCTION public.centro_de_publicacion(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.autor_de_publicacion(p_publicacion_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT autor_id FROM public.publicaciones WHERE id = p_publicacion_id;
$$;
GRANT EXECUTE ON FUNCTION public.autor_de_publicacion(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.publicacion_de_media(p_media_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT publicacion_id FROM public.media WHERE id = p_media_id;
$$;
GRANT EXECUTE ON FUNCTION public.publicacion_de_media(uuid) TO authenticated;

-- ¿El niño tiene permiso de imagen? (gate de etiquetado, P2). Lee `ninos`.
CREATE OR REPLACE FUNCTION public.nino_puede_aparecer(p_nino_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT puede_aparecer_en_fotos FROM public.ninos WHERE id = p_nino_id),
    false
  );
$$;
GRANT EXECUTE ON FUNCTION public.nino_puede_aparecer(uuid) TO authenticated;

-- ¿La publicación etiqueta a ALGÚN niño SIN permiso? (para ocultarla a la familia al
-- revocar — P2). Lee media/media_etiquetas/ninos (NO publicaciones).
CREATE OR REPLACE FUNCTION public.publicacion_tiene_nino_sin_permiso(p_publicacion_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.media md
    JOIN public.media_etiquetas me ON me.media_id = md.id
    JOIN public.ninos n            ON n.id = me.nino_id
    WHERE md.publicacion_id = p_publicacion_id
      AND n.puede_aparecer_en_fotos = false
  );
$$;
GRANT EXECUTE ON FUNCTION public.publicacion_tiene_nino_sin_permiso(uuid) TO authenticated;

-- ROW-AWARE: ¿puede el usuario VER esta publicación? Recibe los campos por parámetro y
-- NO re-lee `publicaciones` → seguro frente al gotcha MVCC (INSERT…RETURNING). Staff
-- del aula ve todo; familia con permiso ve el blog del aula salvo publicaciones que
-- etiqueten a un niño sin permiso (ocultas — P2).
CREATE OR REPLACE FUNCTION public.usuario_ve_publicacion_row(
  p_centro_id uuid, p_aula_id uuid, p_publicacion_id uuid
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    public.es_admin(p_centro_id)
    OR public.es_profe_de_aula(p_aula_id)
    OR (
      public.familia_ve_aula(p_aula_id)
      AND NOT public.publicacion_tiene_nino_sin_permiso(p_publicacion_id)
    );
$$;
GRANT EXECUTE ON FUNCTION public.usuario_ve_publicacion_row(uuid, uuid, uuid) TO authenticated;

-- ─── 4. Triggers (derivar centro_id + updated_at) ────────────────────────────
CREATE OR REPLACE FUNCTION public.publicaciones_set_centro_id()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.centro_id := public.centro_de_aula(NEW.aula_id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER publicaciones_set_centro_id_trg
  BEFORE INSERT ON public.publicaciones
  FOR EACH ROW EXECUTE FUNCTION public.publicaciones_set_centro_id();
CREATE TRIGGER publicaciones_set_updated_at
  BEFORE UPDATE ON public.publicaciones
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.media_set_centro_id()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.centro_id := public.centro_de_publicacion(NEW.publicacion_id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER media_set_centro_id_trg
  BEFORE INSERT ON public.media
  FOR EACH ROW EXECUTE FUNCTION public.media_set_centro_id();

CREATE OR REPLACE FUNCTION public.media_etiquetas_set_centro_id()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.centro_id := public.centro_de_publicacion(public.publicacion_de_media(NEW.media_id));
  RETURN NEW;
END;
$$;
CREATE TRIGGER media_etiquetas_set_centro_id_trg
  BEFORE INSERT ON public.media_etiquetas
  FOR EACH ROW EXECUTE FUNCTION public.media_etiquetas_set_centro_id();

-- ─── 5. RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.publicaciones    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_etiquetas  ENABLE ROW LEVEL SECURITY;

-- publicaciones --------------------------------------------------------------
-- SELECT: staff del aula + familia con permiso (blog colectivo, P2). Row-aware.
CREATE POLICY publicaciones_select ON public.publicaciones
  FOR SELECT USING (
    public.usuario_ve_publicacion_row(centro_id, aula_id, id)
  );
-- INSERT: coordinadora/profesora del aula o admin (P5). autor = auth.uid().
CREATE POLICY publicaciones_insert ON public.publicaciones
  FOR INSERT WITH CHECK (
    autor_id = auth.uid()
    AND (public.es_admin(centro_id) OR public.es_redactor_de_aula(aula_id))
  );
-- UPDATE (editar): autor o admin (P-edición). Defensa simétrica.
CREATE POLICY publicaciones_update ON public.publicaciones
  FOR UPDATE
  USING (public.es_admin(centro_id) OR autor_id = auth.uid())
  WITH CHECK (public.es_admin(centro_id) OR autor_id = auth.uid());
-- DELETE (borrado real): autor o admin (P-borrado). El objeto en Storage lo borra el server.
CREATE POLICY publicaciones_delete ON public.publicaciones
  FOR DELETE USING (public.es_admin(centro_id) OR autor_id = auth.uid());

-- media ----------------------------------------------------------------------
-- SELECT: hereda la visibilidad de su publicación (row-aware vía lookups a publicaciones).
CREATE POLICY media_select ON public.media
  FOR SELECT USING (
    public.usuario_ve_publicacion_row(
      public.centro_de_publicacion(publicacion_id),
      public.aula_de_publicacion(publicacion_id),
      publicacion_id
    )
  );
-- INSERT: el autor de la publicación o admin del centro.
CREATE POLICY media_insert ON public.media
  FOR INSERT WITH CHECK (
    public.es_admin(centro_id)
    OR public.autor_de_publicacion(publicacion_id) = auth.uid()
  );
-- DELETE (quitar foto = borrado real + objeto en Storage): autor o admin.
CREATE POLICY media_delete ON public.media
  FOR DELETE USING (
    public.es_admin(centro_id)
    OR public.autor_de_publicacion(publicacion_id) = auth.uid()
  );
-- UPDATE: sin policy → default DENY (el procesado del pipeline F10-1 va por service role).

-- media_etiquetas ------------------------------------------------------------
-- SELECT: quien puede ver la media (vía su publicación).
CREATE POLICY media_etiquetas_select ON public.media_etiquetas
  FOR SELECT USING (
    public.usuario_ve_publicacion_row(
      public.centro_de_publicacion(public.publicacion_de_media(media_id)),
      public.aula_de_publicacion(public.publicacion_de_media(media_id)),
      public.publicacion_de_media(media_id)
    )
  );
-- INSERT (etiquetar): autor de la publicación o admin, Y el niño debe tener permiso (P2).
CREATE POLICY media_etiquetas_insert ON public.media_etiquetas
  FOR INSERT WITH CHECK (
    (
      public.es_admin(centro_id)
      OR public.autor_de_publicacion(public.publicacion_de_media(media_id)) = auth.uid()
    )
    AND public.nino_puede_aparecer(nino_id)
  );
-- DELETE (quitar etiqueta): autor o admin.
CREATE POLICY media_etiquetas_delete ON public.media_etiquetas
  FOR DELETE USING (
    public.es_admin(centro_id)
    OR public.autor_de_publicacion(public.publicacion_de_media(media_id)) = auth.uid()
  );

-- ─── 6. audit_trigger_function ampliada (+ 3 ramas) ──────────────────────────
-- CREATE OR REPLACE preserva todas las ramas previas (Fases 2..9-5). Se añaden 3 ramas
-- con centro_id directo. Se auditan las 3 tablas (P-audit: quién sube/etiqueta/borra).
CREATE OR REPLACE FUNCTION public.audit_trigger_function()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_centro_id uuid;
  v_antes jsonb;
  v_despues jsonb;
  v_registro_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'centros' THEN
    v_centro_id := COALESCE((NEW).id, (OLD).id);
  ELSIF TG_TABLE_NAME = 'ninos' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'roles_usuario' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'dias_centro' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'plantillas_menu_mensual' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'menu_dia' THEN
    v_centro_id := public.centro_de_plantilla(COALESCE((NEW).plantilla_id, (OLD).plantilla_id));
  ELSIF TG_TABLE_NAME = 'conversaciones' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'mensajes' THEN
    v_centro_id := public.centro_de_conversacion(COALESCE((NEW).conversacion_id, (OLD).conversacion_id));
  ELSIF TG_TABLE_NAME = 'anuncios' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'recordatorios' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'eventos' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'citas' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'cita_invitados' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'autorizaciones' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'firmas_autorizacion' THEN
    v_centro_id := public.centro_de_nino(COALESCE((NEW).nino_id, (OLD).nino_id));
  ELSIF TG_TABLE_NAME = 'administraciones_medicacion' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'plantillas_informe' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'informes_evolucion' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'campanas_informe' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'publicaciones' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'media' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'media_etiquetas' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME IN (
    'info_medica_emergencia',
    'vinculos_familiares',
    'matriculas',
    'datos_pedagogicos_nino',
    'asistencias',
    'ausencias'
  ) THEN
    SELECT n.centro_id INTO v_centro_id
    FROM public.ninos n
    WHERE n.id = COALESCE((NEW).nino_id, (OLD).nino_id);
  ELSIF TG_TABLE_NAME = 'agendas_diarias' THEN
    v_centro_id := public.centro_de_nino(COALESCE((NEW).nino_id, (OLD).nino_id));
  ELSIF TG_TABLE_NAME IN ('comidas', 'biberones', 'suenos', 'deposiciones') THEN
    v_centro_id := public.centro_de_agenda(COALESCE((NEW).agenda_id, (OLD).agenda_id));
  END IF;

  v_antes   := CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END;
  v_despues := CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END;
  v_registro_id := COALESCE((NEW).id, (OLD).id);

  INSERT INTO public.audit_log
    (tabla, registro_id, accion, usuario_id, valores_antes, valores_despues, centro_id)
  VALUES
    (TG_TABLE_NAME, v_registro_id, TG_OP::public.audit_accion, auth.uid(), v_antes, v_despues, v_centro_id);

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER audit_publicaciones
  AFTER INSERT OR UPDATE OR DELETE ON public.publicaciones
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();
CREATE TRIGGER audit_media
  AFTER INSERT OR UPDATE OR DELETE ON public.media
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();
CREATE TRIGGER audit_media_etiquetas
  AFTER INSERT OR UPDATE OR DELETE ON public.media_etiquetas
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

-- ─── 7. Storage: buckets + políticas (P3/P4) ─────────────────────────────────
-- 3 buckets PRIVADOS (fotos de niños) + 1 PÚBLICO (logo). Límites P4: ≤15 MB,
-- JPG/PNG/HEIC (el pipeline F10-1 convierte HEIC→JPG y limpia EXIF). El logo admite
-- también SVG/WebP. Los enlaces firmados (~1 h) los genera el server (service role)
-- tras autorizar; el cliente NO accede al objeto privado directamente.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('aula-fotos',        'aula-fotos',        false, 15728640, ARRAY['image/jpeg','image/png','image/heic','image/heif']),
  ('ninos-fotos',       'ninos-fotos',       false, 15728640, ARRAY['image/jpeg','image/png','image/heic','image/heif']),
  ('recogida-adjuntos', 'recogida-adjuntos', false, 15728640, ARRAY['image/jpeg','image/png','image/heic','image/heif']),
  ('centro-assets',     'centro-assets',     true,   5242880, ARRAY['image/png','image/jpeg','image/svg+xml','image/webp'])
ON CONFLICT (id) DO NOTHING;

-- storage.objects ya tiene RLS habilitada por Supabase. Rutas: el 1.er segmento es
-- siempre {centroId}; en aula-fotos, [2]={aulaId} y [3]={publicacionId}.

-- aula-fotos (blog) ----------------------------------------------------------
-- Leer: misma visibilidad que la publicación (staff del aula + familia con permiso, P2).
CREATE POLICY "aula_fotos_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'aula-fotos'
    AND public.usuario_ve_publicacion_row(
      ((storage.foldername(name))[1])::uuid,
      ((storage.foldername(name))[2])::uuid,
      ((storage.foldername(name))[3])::uuid
    )
  );
-- Subir: solo coordinadora/profesora del aula o admin (P5).
CREATE POLICY "aula_fotos_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'aula-fotos'
    AND (
      public.es_admin(((storage.foldername(name))[1])::uuid)
      OR public.es_redactor_de_aula(((storage.foldername(name))[2])::uuid)
    )
  );
-- Borrar el objeto (al borrar foto/publicación): autor de la publicación o admin.
CREATE POLICY "aula_fotos_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'aula-fotos'
    AND (
      public.es_admin(((storage.foldername(name))[1])::uuid)
      OR public.autor_de_publicacion(((storage.foldername(name))[3])::uuid) = auth.uid()
    )
  );

-- ninos-fotos (foto de la ficha) ---------------------------------------------
-- Ruta: {centroId}/{ninoId}/... Leer: staff del niño + tutores. Escribir/borrar: admin (ficha).
CREATE POLICY "ninos_fotos_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'ninos-fotos'
    AND (
      public.es_admin(((storage.foldername(name))[1])::uuid)
      OR public.es_profe_de_nino(((storage.foldername(name))[2])::uuid)
      OR public.es_tutor_de(((storage.foldername(name))[2])::uuid)
    )
  );
CREATE POLICY "ninos_fotos_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'ninos-fotos'
    AND public.es_admin(((storage.foldername(name))[1])::uuid)
  );
CREATE POLICY "ninos_fotos_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'ninos-fotos'
    AND public.es_admin(((storage.foldername(name))[1])::uuid)
  );

-- recogida-adjuntos (foto DNI de F8) -----------------------------------------
-- Ruta: {centroId}/{firmaId}/... Sensible (DNIs de terceros → RAT/retención F11).
-- BASELINE en F10-0: staff del centro lee/sube; el alcance fino atado a la firma se
-- refina cuando aterrice la UI de adjuntos de F8.
CREATE POLICY "recogida_adjuntos_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'recogida-adjuntos'
    AND (
      public.es_admin(((storage.foldername(name))[1])::uuid)
      OR public.es_profe_en_centro(((storage.foldername(name))[1])::uuid)
    )
  );
CREATE POLICY "recogida_adjuntos_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'recogida-adjuntos'
    AND (
      public.es_admin(((storage.foldername(name))[1])::uuid)
      OR public.es_profe_en_centro(((storage.foldername(name))[1])::uuid)
    )
  );
CREATE POLICY "recogida_adjuntos_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'recogida-adjuntos'
    AND public.es_admin(((storage.foldername(name))[1])::uuid)
  );

-- centro-assets (logo, PÚBLICO) ----------------------------------------------
-- Lectura pública (bucket public). Escribir/borrar: admin del centro (ADR-0010).
CREATE POLICY "centro_assets_select" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'centro-assets');
CREATE POLICY "centro_assets_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'centro-assets'
    AND public.es_admin(((storage.foldername(name))[1])::uuid)
  );
CREATE POLICY "centro_assets_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'centro-assets' AND public.es_admin(((storage.foldername(name))[1])::uuid))
  WITH CHECK (bucket_id = 'centro-assets' AND public.es_admin(((storage.foldername(name))[1])::uuid));
CREATE POLICY "centro_assets_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'centro-assets'
    AND public.es_admin(((storage.foldername(name))[1])::uuid)
  );

COMMIT;
