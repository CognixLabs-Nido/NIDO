-- =============================================================================
-- FEAT — El alta se cierra con los documentos del centro firmados (fase 4, 4b-2; 2026-11-06)
-- -----------------------------------------------------------------------------
-- Spec: docs/specs/altas-serie.md, «Fase 4» y «Decisiones (2026-11-06)». El sitio donde se firma
-- está desplegado desde el #510 (4b-1); esto es la puerta.
--
-- 1. **La puerta en la base** (`marcar_matricula_lista`): con la matrícula pendiente, un documento
--    del centro OBLIGATORIO que el niño tiene `por_firmar` impide cerrar el alta. El estado es el de
--    `privado.documentos_del_nino`, la misma función que lee la pantalla del alta y el gate de la app
--    (`finalizarAlta`), así que las tres dicen lo mismo. Uno que el centro todavía no ha subido
--    (`falta_documento`) NO frena (P-6): la familia lo firma cuando exista. Uno opcional, tampoco.
--    Hasta que el centro suba sus normas, el alta se cierra sin normas: es el único momento de la
--    historia del producto en que pasa (decisión 1 del 2026-11-06).
--    Lo demás del cuerpo es el de 20270103120000, sin cambios (la guarda previa lo comprueba).
-- 2. **La casilla de las normas, cerrada en la base** (`acuses_alta_insert`, fuera): la casilla era
--    el otro camino para cumplir las normas, y ya no lo es. Dos cerrojos, y cada uno basta solo (el
--    ensayo los quita de uno en uno), como en los consentimientos (`20270104120000`): sin la política
--    de INSERT, y sin el privilegio de INSERT para `authenticated`. `service_role` lo conserva: ningún
--    código de la app escribe ahí, y los tests montan con él el histórico que leen la exportación y la
--    retención. La tabla y sus filas se quedan: son lo que
--    esas familias aceptaron, y lo leen la exportación, la retención y `anular_alta`. «No mantengas
--    la casilla con una condición: un camino viejo que sobrevive "solo mientras" no se quita nunca.»
--    Medido en producción el 2026-11-06: 4 filas (3 de normas, 1 de imagen), todas de matrículas
--    activas; ninguna del alta pendiente. La de imagen ya no se escribe desde IU-2 (va por el
--    consentimiento).
--
-- ORDEN: mergear, esperar el despliegue, aplicar. Esta migración cierra la casilla, que la app de
-- antes del 4b-2 todavía enseña: aplicada antes, esa casilla daría error al marcarla. La aplica el
-- responsable por SQL Editor, copiando el fichero. Tras aplicar: registrar en
-- supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
BEGIN
  -- Lo que se reescribe es lo que hay, tal como quedó en 20270103120000.
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.marcar_matricula_lista(uuid)');
  IF v_md5 IS DISTINCT FROM '39fed06b93033fdc1ac7a2837ab4a09e' THEN
    RAISE EXCEPTION 'public.marcar_matricula_lista(uuid) no es la de 20270103120000: %', coalesce(v_md5, 'falta');
  END IF;
  IF to_regprocedure('privado.documentos_del_nino(uuid)') IS NULL THEN
    RAISE EXCEPTION 'falta 20270103120000 (privado.documentos_del_nino): esta va detrás';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'acuses_alta'
                    AND policyname = 'acuses_alta_insert') THEN
    RAISE EXCEPTION 'ya aplicada o cambiada: no está acuses_alta_insert';
  END IF;

  -- Lo que la puerta frena desde el momento en que se aplique: las altas pendientes con algún
  -- documento obligatorio por firmar. Se imprime siempre, también cuando es 0.
  RAISE NOTICE 'guarda previa: % matrículas pendientes, % con documentos obligatorios por firmar (las frena la puerta); % documentos, % versiones; acuses_alta: % filas (% de normas)',
    (SELECT count(*) FROM public.matriculas WHERE estado = 'pendiente' AND fecha_baja IS NULL AND deleted_at IS NULL),
    (SELECT count(DISTINCT m.nino_id) FROM public.matriculas m
      CROSS JOIN LATERAL privado.documentos_del_nino(m.nino_id) d
      WHERE m.estado = 'pendiente' AND m.fecha_baja IS NULL AND m.deleted_at IS NULL
        AND d.obligatorio AND d.estado = 'por_firmar'),
    (SELECT count(*) FROM public.documentos_centro),
    (SELECT count(*) FROM public.documentos_centro_versiones),
    (SELECT count(*) FROM public.acuses_alta),
    (SELECT count(*) FROM public.acuses_alta WHERE tipo = 'normas');
END
$guarda$;

-- ---- 1. La puerta en la base ----
CREATE OR REPLACE FUNCTION public.marcar_matricula_lista(p_nino_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_pendiente boolean;
BEGIN
  -- Gate AMPLIADO: admin del centro del niño O tutor legal (el tutor pasa igual).
  IF NOT (public.es_admin(privado.centro_de_nino(p_nino_id))
          OR public.es_tutor_legal_de(p_nino_id)) THEN
    RAISE EXCEPTION 'no autorizado a finalizar el alta de este nino'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.matriculas
     WHERE nino_id = p_nino_id
       AND estado = 'pendiente'
       AND fecha_baja IS NULL
       AND deleted_at IS NULL
  ) INTO v_pendiente;

  -- Acuse de confidencialidad de datos médicos obligatorio para cerrar el alta
  -- (backstop F11-F, CONSERVADO). auth.uid() = quien finaliza (admin o tutor), y el acuse es de
  -- ESTE niño (U-3, corregido en la base en 20270103120000).
  IF v_pendiente AND NOT EXISTS (
       SELECT 1 FROM public.consentimientos c
        WHERE c.usuario_id = auth.uid()
          AND c.tipo = 'datos_medicos'
          AND c.nino_id = p_nino_id
          AND c.revocado_en IS NULL) THEN
    RAISE EXCEPTION 'falta el acuse de confidencialidad de datos medicos'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Fase 4 (4b-2): los documentos del centro obligatorios que el niño tiene por firmar. El que el
  -- centro todavía no ha subido (`falta_documento`) no frena (P-6), ni el opcional.
  IF v_pendiente AND EXISTS (
       SELECT 1 FROM privado.documentos_del_nino(p_nino_id) d
        WHERE d.obligatorio AND d.estado = 'por_firmar') THEN
    RAISE EXCEPTION 'faltan documentos del centro por firmar'
      USING HINT = 'documentos_por_firmar';
  END IF;

  UPDATE public.matriculas
     SET estado = 'lista'
   WHERE nino_id = p_nino_id
     AND estado = 'pendiente'
     AND fecha_baja IS NULL
     AND deleted_at IS NULL
     AND EXISTS (
       SELECT 1 FROM public.ninos n
        WHERE n.id = p_nino_id
          AND n.apellidos IS NOT NULL
          AND n.fecha_nacimiento IS NOT NULL
     )
   RETURNING id INTO v_id;

  RETURN v_id;
END $function$;

-- ---- 2. La casilla de las normas, cerrada en la base ----
DROP POLICY acuses_alta_insert ON public.acuses_alta;
REVOKE INSERT ON public.acuses_alta FROM authenticated;

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_f constant text := 'public.marcar_matricula_lista(uuid)';
  v_def text;
BEGIN
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_f::regprocedure)
     OR NOT has_function_privilege('authenticated', v_f, 'EXECUTE')
     OR has_function_privilege('anon', v_f, 'EXECUTE') THEN
    RAISE EXCEPTION '% no es SECURITY DEFINER para authenticated y cerrada a anon', v_f;
  END IF;
  v_def := pg_get_functiondef(v_f::regprocedure);
  IF position('documentos_por_firmar' IN v_def) = 0
     OR position('d.obligatorio AND d.estado = ''por_firmar''' IN v_def) = 0 THEN
    RAISE EXCEPTION 'marcar_matricula_lista no tiene la puerta de los documentos';
  END IF;
  IF position('c.nino_id = p_nino_id' IN v_def) = 0 THEN
    RAISE EXCEPTION 'marcar_matricula_lista perdió el acuse médico por niño';
  END IF;
  -- Nadie con sesión escribe acuses: ni una política permisiva de INSERT o ALL.
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'acuses_alta'
                AND permissive = 'PERMISSIVE' AND cmd IN ('INSERT', 'ALL')) THEN
    RAISE EXCEPTION 'acuses_alta sigue teniendo una política que deja escribir';
  END IF;
  IF has_table_privilege('authenticated', 'public.acuses_alta', 'INSERT')
     OR has_table_privilege('anon', 'public.acuses_alta', 'INSERT') THEN
    RAISE EXCEPTION 'acuses_alta sigue dando INSERT a la sesión';
  END IF;
  RAISE NOTICE 'guarda posterior: la puerta de los documentos en el cierre, el acuse médico por niño, y acuses_alta sin política ni privilegio de escritura (% políticas quedan: %)',
    (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'acuses_alta'),
    (SELECT string_agg(policyname || ' ' || cmd, ', ' ORDER BY policyname) FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'acuses_alta');
END
$guarda$;
