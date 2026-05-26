-- =============================================================================
-- Fase 5 — Fix: helper de audiencia row-aware para INSERT...RETURNING
-- =============================================================================
-- Bug detectado tras aplicar 20260525154228_phase5_messaging.sql:
--
-- La policy `anuncios_select` usa `usuario_es_audiencia_anuncio(id)`, helper
-- que internamente hace `SELECT * INTO a FROM anuncios WHERE id = p_anuncio_id`.
-- Cuando un admin/profe hace `INSERT INTO anuncios ... RETURNING *` (que es
-- lo que produce `supabase.from('anuncios').insert(...).select()` en JS),
-- PostgreSQL evalúa la policy de SELECT contra la fila recién insertada en
-- la cláusula RETURNING. El helper es `STABLE`, lo que por contrato MVCC
-- significa que NO ve cambios hechos por la misma sentencia que lo invoca.
-- Resultado: el lookup interno no encuentra la fila → helper devuelve FALSE
-- → policy de SELECT rechaza → cliente recibe `42501 row violates RLS`.
--
-- El INSERT en sí pasa la policy WITH CHECK correctamente; lo que falla es
-- el SELECT del RETURNING. Tests t12/t13 lo evidencian.
--
-- Fix: introducir una variante "row-aware" del helper que reciba los
-- campos relevantes por parámetro (no necesita lookup), y usarla en la
-- policy de SELECT. La versión clásica `usuario_es_audiencia_anuncio(uuid)`
-- se mantiene porque sigue siendo correcta para `lectura_anuncio_insert`
-- (ahí el anuncio existe de una sentencia previa, MVCC sí lo ve).
--
-- Mismas reglas de audiencia que antes:
--   - admin del centro                         → TRUE
--   - autor del anuncio                        → TRUE
--   - ámbito 'aula':
--       * profe activo del aula                → TRUE
--       * tutor con permiso de niño en el aula → TRUE
--   - ámbito 'centro':
--       * profe activo en cualquier aula del centro                   → TRUE
--       * tutor con permiso de niño matriculado en cualquier aula del → TRUE
--         centro
--   - resto                                    → FALSE
-- `puede_recibir_mensajes=false` sigue bloqueando ambos ámbitos.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.usuario_es_audiencia_anuncio_row(
  p_centro_id uuid,
  p_autor_id  uuid,
  p_ambito    public.ambito_anuncio,
  p_aula_id   uuid
)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
        AND vf.usuario_id = v_usuario
        AND vf.deleted_at IS NULL
        AND COALESCE((vf.permisos ->> 'puede_recibir_mensajes')::boolean, false) = true
    );
  END IF;

  RETURN FALSE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.usuario_es_audiencia_anuncio_row(
  uuid, uuid, public.ambito_anuncio, uuid
) TO authenticated;

-- Reemplazar la policy de SELECT para que NO haga lookup interno de la
-- propia tabla. Pasa los campos del row (`centro_id`, `autor_id`, `ambito`,
-- `aula_id`) al helper row-aware. Compatible con `INSERT...RETURNING`
-- porque ya no hay re-lookup STABLE de la fila recién insertada.
DROP POLICY IF EXISTS anuncios_select ON public.anuncios;
CREATE POLICY anuncios_select ON public.anuncios
  FOR SELECT
  USING (public.usuario_es_audiencia_anuncio_row(centro_id, autor_id, ambito, aula_id));
