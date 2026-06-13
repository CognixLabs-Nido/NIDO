-- =============================================================================
-- Fase 11-A (RGPD) — Least-privilege del admin en mensajería profe↔familia
-- =============================================================================
--
-- Spec: docs/specs/proteccion-datos.md (approved) — Comportamiento 4 + Decisión #11.
-- Origen del agujero: reparación de Mensajería (PR #66). La pestaña "Dirección"
-- (AdminSupervisionSplitView) es supervisión SOLO-LECTURA en la UI, pero la RLS
-- todavía deja al admin POSTEAR en conversaciones profe_familia, porque:
--
--   mensajes_insert.WITH CHECK usa puede_participar_conversacion(conversacion_id),
--   y ese helper devuelve TRUE para es_admin(c.centro_id) en hilos profe_familia
--   (ver 20260528100000_phase5_6_admin_family_messaging.sql, L137-156).
--
-- CAMBIO (aditivo, inmutable respecto a lo ya aplicado):
--   - NUEVO helper public.puede_postear_en_conversacion(conv_id): espejo del de
--     participación, pero SIN la rama es_admin en profe_familia. Se usa SOLO en
--     la policy de INSERT de mensajes.
--   - mensajes_insert pasa a usar el helper de posteo.
--   - mensajes_select NO se toca: sigue con puede_participar_conversacion → el
--     admin CONSERVA el SELECT (supervisión). Tampoco se tocan conversaciones,
--     anuncios ni admin_familia → la escritura legítima del admin se mantiene.
--
-- Resultado: el admin pierde el INSERT en profe_familia (ni siquiera por API),
-- conserva la lectura, y sigue escribiendo en admin_familia y en anuncios.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- Helper de POSTEO. Igual que puede_participar_conversacion EXCEPTO que en
-- profe_familia NO incluye es_admin. El gotcha MVCC no aplica: lee
-- `conversaciones` (tabla distinta de `mensajes`, sobre la que se hace el INSERT).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.puede_postear_en_conversacion(p_conversacion_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversaciones c
    WHERE c.id = p_conversacion_id
      AND (
        -- profe_familia: profe del niño o tutor con permiso. SIN admin (least-privilege).
        (c.tipo_conversacion = 'profe_familia' AND (
          public.es_profe_de_nino(c.nino_id)
          OR public.tiene_permiso_sobre(c.nino_id, 'puede_recibir_mensajes')
        ))
        OR
        -- admin_familia: solo el admin y el tutor del par (sin cambios respecto a participar).
        (c.tipo_conversacion = 'admin_familia' AND (
          c.admin_id = auth.uid()
          OR c.tutor_id = auth.uid()
        ))
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.puede_postear_en_conversacion(uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- mensajes_insert: usa el helper de posteo (no el de participación).
-- conversacion_activa y la anti-suplantación (autor_id = auth.uid()) se conservan.
-- -----------------------------------------------------------------------------
DROP POLICY mensajes_insert ON public.mensajes;

CREATE POLICY mensajes_insert ON public.mensajes
  FOR INSERT
  WITH CHECK (
    public.puede_postear_en_conversacion(conversacion_id)
    AND public.conversacion_activa(conversacion_id)
    AND autor_id = auth.uid()
  );

COMMIT;
