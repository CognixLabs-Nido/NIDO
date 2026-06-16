-- Fase 11 — Alta tutor-driven, Pieza 2a: ENDURECIMIENTO de "matrícula activa".
--
-- Redefine el predicado de matrícula activa en los 9 helpers RLS que hoy lo
-- expresan como `m.fecha_baja IS NULL AND m.deleted_at IS NULL`, añadiéndole
-- `AND m.estado = 'activa'` (belt + suspenders: si alguna vez se desincronizara
-- estado↔fecha_baja, falla seguro en ambas direcciones).
--
-- NO-OP HOY: la Pieza 1 (20260615150000) puso `estado` con DEFAULT 'activa' y
-- backfill `estado='baja' WHERE fecha_baja IS NOT NULL`, de modo que hoy
-- `fecha_baja IS NULL ⟺ estado='activa'`. Añadir el criterio no cambia ninguna
-- fila existente; solo excluye las futuras matrículas `'pendiente'` (esqueletos
-- de niño que llegan en la Pieza 2b). Esto bloquea la frontera ANTES de que
-- exista ningún esqueleto → regresión-cero verificable en aislado.
--
-- Cada función se reproduce VERBATIM desde su definición viva (pg_get_functiondef);
-- el ÚNICO cambio es la subquery de matrícula. No se toca descifrado, search_path,
-- volatilidad, SECURITY DEFINER ni el resto de la lógica.

-- ─── 1. es_profe_de_nino ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.es_profe_de_nino(p_nino_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.matriculas m
    JOIN public.profes_aulas pa ON pa.aula_id = m.aula_id
    WHERE m.nino_id = p_nino_id
      AND m.fecha_baja IS NULL AND m.deleted_at IS NULL AND m.estado = 'activa'
      AND pa.profe_id = auth.uid()
      AND pa.fecha_fin IS NULL AND pa.deleted_at IS NULL
  );
$function$;

-- ─── 2. es_redactor_de_nino ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.es_redactor_de_nino(p_nino_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.matriculas m
    JOIN public.profes_aulas pa ON pa.aula_id = m.aula_id
    WHERE m.nino_id = p_nino_id
      AND m.fecha_baja IS NULL AND m.deleted_at IS NULL AND m.estado = 'activa'
      AND pa.profe_id = auth.uid()
      AND pa.fecha_fin IS NULL AND pa.deleted_at IS NULL
      AND pa.tipo_personal_aula IN ('coordinadora', 'profesora')
  );
$function$;

-- ─── 3. es_tutor_en_aula ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.es_tutor_en_aula(p_aula_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.matriculas m
    JOIN public.vinculos_familiares v ON v.nino_id = m.nino_id
    WHERE m.aula_id = p_aula_id
      AND m.fecha_baja IS NULL AND m.deleted_at IS NULL AND m.estado = 'activa'
      AND v.usuario_id = auth.uid() AND v.deleted_at IS NULL
  );
$function$;

-- ─── 4. familia_ve_aula ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.familia_ve_aula(p_aula_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.matriculas m
    WHERE m.aula_id = p_aula_id
      AND m.fecha_baja IS NULL AND m.deleted_at IS NULL AND m.estado = 'activa'
      AND public.tiene_permiso_sobre(m.nino_id, 'puede_ver_fotos')
  );
$function$;

-- ─── 5. evento_aplica_a_nino ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.evento_aplica_a_nino(p_evento_id uuid, p_nino_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE e public.eventos%ROWTYPE;
BEGIN
  SELECT * INTO e FROM public.eventos WHERE id = p_evento_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF e.ambito = 'nino' THEN
    RETURN e.nino_id = p_nino_id;
  ELSIF e.ambito = 'aula' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.matriculas m
      WHERE m.nino_id = p_nino_id AND m.aula_id = e.aula_id
        AND m.fecha_baja IS NULL AND m.deleted_at IS NULL AND m.estado = 'activa'
    );
  ELSIF e.ambito = 'centro' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.ninos n
      WHERE n.id = p_nino_id AND n.centro_id = e.centro_id AND n.deleted_at IS NULL
    );
  END IF;
  RETURN FALSE;
END;
$function$;

-- ─── 6. autorizacion_aplica_a_nino ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.autorizacion_aplica_a_nino(p_autorizacion_id uuid, p_nino_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE a public.autorizaciones%ROWTYPE;
BEGIN
  SELECT * INTO a FROM public.autorizaciones WHERE id = p_autorizacion_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF a.es_plantilla THEN
    RETURN FALSE;  -- el catálogo no se firma; se firma la instancia (B2)
  END IF;
  IF a.tipo = 'salida' THEN
    RETURN public.evento_aplica_a_nino(a.evento_id, p_nino_id);
  ELSIF a.ambito = 'aula' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.matriculas m
      WHERE m.nino_id = p_nino_id AND m.aula_id = a.aula_id
        AND m.fecha_baja IS NULL AND m.deleted_at IS NULL AND m.estado = 'activa'
    );
  ELSIF a.ambito = 'centro' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.ninos n
      WHERE n.id = p_nino_id AND n.centro_id = a.centro_id AND n.deleted_at IS NULL
    );
  ELSE  -- ambito='nino' (A/B2) o legacy (ambito NULL, nino_id seteado)
    RETURN a.nino_id = p_nino_id;
  END IF;
END;
$function$;

-- ─── 7. get_info_medica_emergencia (SECURITY DEFINER + pgcrypto) ──────────────
-- Reproducida EXACTA; el único cambio es `AND m.estado = 'activa'` en la rama de
-- autorización profe-vía-matrícula. NO se toca descifrado, search_path ni el resto.
CREATE OR REPLACE FUNCTION public.get_info_medica_emergencia(p_nino_id uuid)
 RETURNS TABLE(alergias_graves text, notas_emergencia text, medicacion_habitual text, alergias_leves text, medico_familia text, telefono_emergencia text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_clave text := public._get_medical_key();
  v_centro_del_nino uuid;
  v_autorizado boolean := false;
BEGIN
  SELECT centro_id INTO v_centro_del_nino FROM public.ninos WHERE id = p_nino_id;
  IF v_centro_del_nino IS NULL THEN
    RAISE EXCEPTION 'Niño no encontrado: %', p_nino_id;
  END IF;

  IF public.es_admin(v_centro_del_nino) THEN
    v_autorizado := true;
  ELSIF EXISTS (
    SELECT 1 FROM public.matriculas m
    WHERE m.nino_id = p_nino_id
      AND m.fecha_baja IS NULL AND m.deleted_at IS NULL AND m.estado = 'activa'
      AND public.es_profe_de_aula(m.aula_id)
  ) THEN
    v_autorizado := true;
  ELSIF public.tiene_permiso_sobre(p_nino_id, 'puede_ver_info_medica') THEN
    v_autorizado := true;
  END IF;

  IF NOT v_autorizado THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  RETURN QUERY
  SELECT
    CASE WHEN ime.alergias_graves  IS NULL THEN NULL ELSE pgp_sym_decrypt(ime.alergias_graves,  v_clave) END,
    CASE WHEN ime.notas_emergencia IS NULL THEN NULL ELSE pgp_sym_decrypt(ime.notas_emergencia, v_clave) END,
    ime.medicacion_habitual,
    ime.alergias_leves,
    ime.medico_familia,
    ime.telefono_emergencia
  FROM public.info_medica_emergencia ime
  WHERE ime.nino_id = p_nino_id;
END;
$function$;

-- ─── 8. usuario_es_audiencia_anuncio (por id) ────────────────────────────────
CREATE OR REPLACE FUNCTION public.usuario_es_audiencia_anuncio(p_anuncio_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a public.anuncios%ROWTYPE;
  v_usuario uuid := auth.uid();
BEGIN
  IF v_usuario IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT * INTO a FROM public.anuncios WHERE id = p_anuncio_id;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Admin del centro: siempre
  IF public.es_admin(a.centro_id) THEN
    RETURN TRUE;
  END IF;

  -- Autor del anuncio: siempre (defensa en profundidad)
  IF a.autor_id = v_usuario THEN
    RETURN TRUE;
  END IF;

  -- Ámbito 'aula'
  IF a.ambito = 'aula' THEN
    -- Profe activo del aula concreta
    IF public.es_profe_de_aula(a.aula_id) THEN
      RETURN TRUE;
    END IF;
    -- Tutor con permiso y niño matriculado activamente en esa aula
    RETURN EXISTS (
      SELECT 1
      FROM public.matriculas m
      JOIN public.vinculos_familiares vf ON vf.nino_id = m.nino_id
      WHERE m.aula_id = a.aula_id
        AND m.fecha_baja IS NULL
        AND m.deleted_at IS NULL
        AND m.estado = 'activa'
        AND vf.usuario_id = v_usuario
        AND vf.deleted_at IS NULL
        AND COALESCE((vf.permisos ->> 'puede_recibir_mensajes')::boolean, false) = true
    );
  END IF;

  -- Ámbito 'centro'
  IF a.ambito = 'centro' THEN
    -- Profe activo en cualquier aula del centro
    IF EXISTS (
      SELECT 1
      FROM public.profes_aulas pa
      JOIN public.aulas au ON au.id = pa.aula_id
      WHERE pa.profe_id = v_usuario
        AND pa.fecha_fin IS NULL
        AND pa.deleted_at IS NULL
        AND au.centro_id = a.centro_id
    ) THEN
      RETURN TRUE;
    END IF;
    -- Tutor con permiso y niño matriculado activamente en cualquier aula del centro
    RETURN EXISTS (
      SELECT 1
      FROM public.matriculas m
      JOIN public.aulas au ON au.id = m.aula_id
      JOIN public.vinculos_familiares vf ON vf.nino_id = m.nino_id
      WHERE au.centro_id = a.centro_id
        AND m.fecha_baja IS NULL
        AND m.deleted_at IS NULL
        AND m.estado = 'activa'
        AND vf.usuario_id = v_usuario
        AND vf.deleted_at IS NULL
        AND COALESCE((vf.permisos ->> 'puede_recibir_mensajes')::boolean, false) = true
    );
  END IF;

  RETURN FALSE;
END;
$function$;

-- ─── 9. usuario_es_audiencia_anuncio_row (row-aware) ─────────────────────────
CREATE OR REPLACE FUNCTION public.usuario_es_audiencia_anuncio_row(p_centro_id uuid, p_autor_id uuid, p_ambito ambito_anuncio, p_aula_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_usuario uuid := auth.uid();
BEGIN
  IF v_usuario IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Admin del centro: siempre
  IF public.es_admin(p_centro_id) THEN
    RETURN TRUE;
  END IF;

  -- Autor del anuncio: siempre (defensa en profundidad)
  IF p_autor_id = v_usuario THEN
    RETURN TRUE;
  END IF;

  -- Ámbito 'aula'
  IF p_ambito = 'aula' THEN
    IF public.es_profe_de_aula(p_aula_id) THEN
      RETURN TRUE;
    END IF;
    RETURN EXISTS (
      SELECT 1
      FROM public.matriculas m
      JOIN public.vinculos_familiares vf ON vf.nino_id = m.nino_id
      WHERE m.aula_id = p_aula_id
        AND m.fecha_baja IS NULL
        AND m.deleted_at IS NULL
        AND m.estado = 'activa'
        AND vf.usuario_id = v_usuario
        AND vf.deleted_at IS NULL
        AND COALESCE((vf.permisos ->> 'puede_recibir_mensajes')::boolean, false) = true
    );
  END IF;

  -- Ámbito 'centro'
  IF p_ambito = 'centro' THEN
    IF EXISTS (
      SELECT 1
      FROM public.profes_aulas pa
      JOIN public.aulas au ON au.id = pa.aula_id
      WHERE pa.profe_id = v_usuario
        AND pa.fecha_fin IS NULL
        AND pa.deleted_at IS NULL
        AND au.centro_id = p_centro_id
    ) THEN
      RETURN TRUE;
    END IF;
    RETURN EXISTS (
      SELECT 1
      FROM public.matriculas m
      JOIN public.aulas au ON au.id = m.aula_id
      JOIN public.vinculos_familiares vf ON vf.nino_id = m.nino_id
      WHERE au.centro_id = p_centro_id
        AND m.fecha_baja IS NULL
        AND m.deleted_at IS NULL
        AND m.estado = 'activa'
        AND vf.usuario_id = v_usuario
        AND vf.deleted_at IS NULL
        AND COALESCE((vf.permisos ->> 'puede_recibir_mensajes')::boolean, false) = true
    );
  END IF;

  RETURN FALSE;
END;
$function$;
