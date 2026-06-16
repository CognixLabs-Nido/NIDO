-- F11 Alta tutor-driven · Pieza 3a (fix) — el tutor LEGAL lee lo pedagógico de SU
-- hijo (D7: "lo ve porque lo rellena él, no por permiso"). Sin esto, el RETURNING de
-- upsertDatosPedagogicos falla para el tutor (escribe pero no relee → action en error).
-- Conserva la vía por permiso (autorizado o flag concedido). es_tutor_legal_de excluye
-- 'autorizado'. Migración aparte porque 20260616170000 ya estaba aplicada (inmutable).

DROP POLICY IF EXISTS dp_tutor_select ON public.datos_pedagogicos_nino;

CREATE POLICY dp_tutor_select ON public.datos_pedagogicos_nino
  FOR SELECT TO authenticated
  USING (
    public.es_tutor_legal_de(nino_id)
    OR public.tiene_permiso_sobre(nino_id, 'puede_ver_datos_pedagogicos')
  );
