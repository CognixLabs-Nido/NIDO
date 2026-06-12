-- F10-2 · Vista de familia del blog del aula — P-histórico
--
-- La RLS de F10-0 (`usuario_ve_publicacion_row`) da a la familia el blog del aula
-- SOLO mientras su hijo tiene **matrícula activa** ahí (`familia_ve_aula` exige
-- `fecha_baja IS NULL`). Eso cumple P2 pero NO P-histórico: cuando el niño se va o
-- cambia de aula, la familia perdía TODO el blog de esa aula, incluidas las
-- publicaciones pasadas donde salía su hijo.
--
-- Esta migración añade la vía "mi hijo aparece etiquetado": la familia conserva las
-- publicaciones (de cualquier aula) donde un hijo suyo —con `puede_ver_fotos`— está
-- etiquetado, sin exigir matrícula activa. Resultado:
--   · niño en el aula  → ve todo el blog del aula (P2, vía `familia_ve_aula`),
--   · niño que se fue   → conserva las publicaciones pasadas donde está etiquetado
--                         y deja de ver las nuevas del aula (P-histórico).
--
-- Se respeta lo demás: revocar `puede_aparecer_en_fotos` sigue ocultando la
-- publicación (`NOT publicacion_tiene_nino_sin_permiso`), y el aislamiento entre
-- aulas/centros se mantiene (la nueva vía exige `es_tutor_de` + `puede_ver_fotos`).
--
-- NO edita la migración de F10-0 (inmutable): solo CREATE OR REPLACE de los objetos.

BEGIN;

-- Helper ROW-AWARE NUEVO: ¿la publicación etiqueta a un hijo del tutor actual con
-- `puede_ver_fotos`? Lee `media`/`media_etiquetas`/`vinculos_familiares`/`ninos`
-- (NO `publicaciones`) → seguro frente al gotcha MVCC en `INSERT…RETURNING` de
-- `publicaciones`, igual que `publicacion_tiene_nino_sin_permiso`.
CREATE OR REPLACE FUNCTION public.publicacion_etiqueta_hijo_de(p_publicacion_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.media md
    JOIN public.media_etiquetas me ON me.media_id = md.id
    WHERE md.publicacion_id = p_publicacion_id
      AND public.es_tutor_de(me.nino_id)
      AND public.tiene_permiso_sobre(me.nino_id, 'puede_ver_fotos')
  );
$$;
GRANT EXECUTE ON FUNCTION public.publicacion_etiqueta_hijo_de(uuid) TO authenticated;

-- Extiende la audiencia: añade la rama de histórico (mi hijo etiquetado), respetando
-- la ocultación por permiso de imagen revocado. Las policies SELECT de `publicaciones`,
-- `media` y `media_etiquetas` ya delegan en este helper → se actualizan todas a la vez.
CREATE OR REPLACE FUNCTION public.usuario_ve_publicacion_row(
  p_centro_id uuid, p_aula_id uuid, p_publicacion_id uuid
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    public.es_admin(p_centro_id)
    OR public.es_profe_de_aula(p_aula_id)
    -- Blog del aula actual (P2): familia con un hijo matriculado activo + permiso.
    OR (
      public.familia_ve_aula(p_aula_id)
      AND NOT public.publicacion_tiene_nino_sin_permiso(p_publicacion_id)
    )
    -- Histórico (P-histórico): publicaciones donde un hijo del tutor está etiquetado,
    -- aunque ya no tenga matrícula activa en el aula. Revocar el permiso de imagen las
    -- oculta igual (NOT publicacion_tiene_nino_sin_permiso).
    OR (
      public.publicacion_etiqueta_hijo_de(p_publicacion_id)
      AND NOT public.publicacion_tiene_nino_sin_permiso(p_publicacion_id)
    );
$$;
GRANT EXECUTE ON FUNCTION public.usuario_ve_publicacion_row(uuid, uuid, uuid) TO authenticated;

COMMIT;
