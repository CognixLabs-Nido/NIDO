-- =============================================================================
-- Fase 11-C-0 — Onboarding de profesor · Fundación (capa de datos + Storage)
-- =============================================================================
-- ADITIVA: solo ADD COLUMN / ADD CONSTRAINT / CREATE bucket + policies. NUNCA
-- drop+recreate. Fuente de verdad: docs/specs/onboarding-profe.md (approved, A–F).
--
-- QUÉ ES: sienta las bases para que la directora invite a un profe (nombre + email +
-- aula + rol en el aula) reusando la infra de invitación/accept de tutores (D6), y
-- para el avatar de usuario. NO incluye acciones ni UI (eso es F11-C-1/2/3).
--
-- DECISIONES (spec aprobada, A–F):
--  - A  El "rol" del form = tipo_personal_aula (coordinadora/profesora/tecnico/apoyo);
--       user_role siempre 'profe'.
--  - B  Bucket nuevo PRIVADO usuarios-fotos (ruta {centroId}/{usuarioId}/...), espejo
--       de ninos-fotos.
--  - C  La directora fija nombre_completo en la invitación; el profe lo edita al aceptar.
--  - D  Foto OPCIONAL en el accept → usuarios.foto_url NULLABLE.
--
-- CAMBIOS:
--  1. invitaciones.nombre_completo text NULL (+ CHECK longitud 2-120).
--  2. invitaciones.tipo_personal_aula tipo_personal_aula NULL (+ CHECK de coherencia:
--     solo para rol_objetivo='profe', análogo a invitaciones_tipo_vinculo_coherente).
--  3. usuarios.foto_url text NULL (patrón ninos.foto_url; ruta en usuarios-fotos).
--  4. Bucket usuarios-fotos + 4 políticas sobre storage.objects:
--       leer: staff del centro (admin/profe) o el propio usuario;
--       escribir/actualizar/borrar: admin del centro o el propio usuario.
--
-- SIN policies nuevas en tablas: las columnas viajan en el row y heredan las policies
-- existentes (invitaciones_admin, usuarios_self_*/usuarios_admin_select). El auto-vínculo
-- de profes_aulas en el accept (F11-C-2) irá por service-role; profes_aulas_admin_all ya
-- existe → no hace falta nada aquí.
--
-- Operación sobre esquema productivo → se aplica MANUALMENTE por SQL Editor (CLI con bug
-- SIGILL). Tras aplicarla, registrar la versión en supabase_migrations.schema_migrations y
-- regenerar src/types/database.ts (`npm run db:types`).
-- =============================================================================
BEGIN;

-- ─── 1. invitaciones.nombre_completo (C) ─────────────────────────────────────
ALTER TABLE public.invitaciones
  ADD COLUMN nombre_completo text NULL;

ALTER TABLE public.invitaciones
  ADD CONSTRAINT invitaciones_nombre_completo_longitud CHECK (
    nombre_completo IS NULL OR char_length(nombre_completo) BETWEEN 2 AND 120
  );

COMMENT ON COLUMN public.invitaciones.nombre_completo IS
  'F11-C: nombre que fija la directora al invitar (sobre todo personal/profe). Editable por el invitado al aceptar (prefill editable). NULL en invitaciones legacy/familia que no lo llevan.';

-- ─── 2. invitaciones.tipo_personal_aula (A) ──────────────────────────────────
ALTER TABLE public.invitaciones
  ADD COLUMN tipo_personal_aula public.tipo_personal_aula NULL;

-- CHECK permisivo con NULL (no rompe filas existentes): el tipo de personal de aula solo
-- viaja en invitaciones de profe; el resto (admin/tutor/autorizado) lo deja NULL.
ALTER TABLE public.invitaciones
  ADD CONSTRAINT invitaciones_tipo_personal_aula_coherente CHECK (
    tipo_personal_aula IS NULL OR rol_objetivo = 'profe'
  );

COMMENT ON COLUMN public.invitaciones.tipo_personal_aula IS
  'F11-C: el "rol" en el aula (coordinadora/profesora/tecnico/apoyo) que viaja en la invitación de profe; al aceptar se inserta en profes_aulas. NULL salvo rol_objetivo=profe (CHECK).';

-- ─── 3. usuarios.foto_url (B/D) ──────────────────────────────────────────────
ALTER TABLE public.usuarios
  ADD COLUMN foto_url text NULL;

COMMENT ON COLUMN public.usuarios.foto_url IS
  'F11-C: ruta del avatar en el bucket privado usuarios-fotos ({centroId}/{usuarioId}/...). Se firma para mostrar. Opcional (NULL = sin foto). Patrón ninos.foto_url.';

-- ─── 4. Bucket usuarios-fotos + políticas de Storage (B) ─────────────────────
-- PRIVADO, ≤15 MB, JPG/PNG/HEIC (el pipeline convierte/limpia y rechaza HEIC en la app —
-- ADR-0046). Enlaces firmados (~1 h) los genera el server tras autorizar.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('usuarios-fotos', 'usuarios-fotos', false, 15728640,
   ARRAY['image/jpeg', 'image/png', 'image/heic', 'image/heif'])
ON CONFLICT (id) DO NOTHING;

-- Ruta: {centroId}/{usuarioId}/...  → [1]=centroId, [2]=usuarioId.
-- Leer: staff del centro (admin/profe) o el propio usuario.
CREATE POLICY "usuarios_fotos_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'usuarios-fotos'
    AND (
      public.es_admin(((storage.foldername(name))[1])::uuid)
      OR public.es_profe_en_centro(((storage.foldername(name))[1])::uuid)
      OR ((storage.foldername(name))[2])::uuid = auth.uid()
    )
  );
-- Escribir: admin del centro o el propio usuario.
CREATE POLICY "usuarios_fotos_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'usuarios-fotos'
    AND (
      public.es_admin(((storage.foldername(name))[1])::uuid)
      OR ((storage.foldername(name))[2])::uuid = auth.uid()
    )
  );
-- Actualizar (overwrite/upsert): admin del centro o el propio usuario.
CREATE POLICY "usuarios_fotos_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'usuarios-fotos'
    AND (
      public.es_admin(((storage.foldername(name))[1])::uuid)
      OR ((storage.foldername(name))[2])::uuid = auth.uid()
    )
  )
  WITH CHECK (
    bucket_id = 'usuarios-fotos'
    AND (
      public.es_admin(((storage.foldername(name))[1])::uuid)
      OR ((storage.foldername(name))[2])::uuid = auth.uid()
    )
  );
-- Borrar: admin del centro o el propio usuario.
CREATE POLICY "usuarios_fotos_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'usuarios-fotos'
    AND (
      public.es_admin(((storage.foldername(name))[1])::uuid)
      OR ((storage.foldername(name))[2])::uuid = auth.uid()
    )
  );

COMMIT;
