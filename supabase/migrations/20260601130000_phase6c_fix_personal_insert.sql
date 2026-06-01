-- =============================================================================
-- Fase 6-C-1 (fix) — recordatorios_insert: 'personal' solo para staff
-- =============================================================================
-- Corrige un hueco en la matriz D9: la rama `personal` de la policy de INSERT
-- (migración 20260601120000) exigía solo `usuario_destinatario_id = auth.uid()
-- AND pertenece_a_centro(centro_id)`, lo que dejaba a un TUTOR/AUTORIZADO crear
-- un recordatorio `personal` para sí mismo. La matriz D9 (spec reminders-c.md) y
-- el prompt de F6-C-1 son explícitos: tutor/autorizado SOLO reciben, no crean
-- NINGÚN destino — y la defensa debe estar en RLS ("ni por ruta directa"), no
-- solo en la UI. (La spec §3.3 traía el SQL laxo; prevalece la matriz, Regla #11.)
--
-- Fix: `personal` exige además ser admin o profe del centro. admin/profe siguen
-- creando su nota propia (✅ self en la matriz); tutor/autorizado → 42501.
--
-- Migración NUEVA (no se edita la 20260601120000 ya aplicada). Solo recrea la
-- policy de INSERT; el resto del modelo F6-C queda intacto.
-- =============================================================================
BEGIN;

DROP POLICY IF EXISTS recordatorios_insert ON public.recordatorios;
CREATE POLICY recordatorios_insert ON public.recordatorios
  FOR INSERT WITH CHECK (
    creado_por = auth.uid()
    AND (
      (destinatario = 'familia_individual'
        AND (public.es_admin(centro_id) OR public.es_profe_de_nino(nino_id))
        AND public.centro_de_nino(nino_id) = centro_id)
      OR (destinatario = 'familias_aula'
        AND (public.es_admin(centro_id) OR public.es_profe_de_aula(aula_id))
        AND public.centro_de_aula(aula_id) = centro_id)
      OR (destinatario = 'familias_centro'
        AND public.es_admin(centro_id))
      OR (destinatario = 'profe_individual'
        AND public.es_admin(centro_id))
      OR (destinatario = 'profes_centro'
        AND public.es_admin(centro_id))
      OR (destinatario = 'personal'
        AND usuario_destinatario_id = auth.uid()
        AND (public.es_admin(centro_id) OR public.es_profe_en_centro(centro_id)))
    )
  );

COMMIT;
