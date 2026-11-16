-- =============================================================================
-- Fase 9b · los gastos de gestión en el alta (2 de 2: DESPUÉS del despliegue)
-- Spec: docs/specs/altas-serie.md, «Fase 9».
--
-- 1. `privado.gastos_del_nino` cuenta solo el curso del ALTA (el primero del niño). La renovación no
--    es de esta fase (Jose, 2026-11-16): al que continúa, Dirección le pasa un cargo puntual. De esa
--    función beben gastos_gestion_nino, gastos_sin_contestar, gastos_curso_del_nino (declarar) y
--    gastos_gestion_pendientes: ninguna lista ya el curso de una renovación.
-- 2. `privado.gastos_sin_contestar` no pide respuesta si el importe es 0.
-- 3. `marcar_matricula_lista` para con HINT `gastos_por_contestar` si al alta le faltan los gastos
--    por contestar. Que estén cobrados no frena (D5).
--
-- Va después del despliegue: con la app de antes, la familia no ve el paso y no podría cerrar el alta.
-- La aplica el responsable por SQL Editor, copiando el fichero commiteado. Sin COMMIT ni BEGIN.
-- Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v record;
  v_md5 text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20270123120000') THEN
    RAISE EXCEPTION 'falta 20270123120000 (los gastos de gestión) en el registro';
  END IF;
  FOR v IN SELECT * FROM (VALUES
      ('privado.gastos_del_nino(uuid)', '2f3be568886a05b3459e4347a654b09c'),
      ('privado.gastos_sin_contestar(uuid)', 'fef910b043088906672390c48fdbbc53'),
      ('public.marcar_matricula_lista(uuid)', 'e06069b04643cea2db38e01c3d616ad4')) AS e(firma, md5) LOOP
    SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
      INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure(v.firma);
    IF v_md5 IS DISTINCT FROM v.md5 THEN
      RAISE EXCEPTION '% no es la de antes: %', v.firma, coalesce(v_md5, 'falta');
    END IF;
  END LOOP;
END $guarda$;

CREATE OR REPLACE FUNCTION privado.gastos_del_nino(p_nino_id uuid)
 RETURNS TABLE(curso_academico_id uuid, curso_nombre text, importe_curso integer, importe integer,
               importe_propio boolean, forma text, justificante_path text, cobrado_at timestamptz,
               cobrado_por uuid, matricula_pendiente boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT k.id, k.nombre::text, gc.importe_centimos,
         COALESCE(g.importe_centimos, gc.importe_centimos), g.importe_centimos IS NOT NULL,
         g.forma, g.justificante_path, g.cobrado_at, g.cobrado_por,
         bool_or(m.estado = 'pendiente')
    FROM public.ninos n
    JOIN public.matriculas m ON m.nino_id = n.id AND m.fecha_baja IS NULL AND m.deleted_at IS NULL
    JOIN public.cursos_academicos k ON k.id = m.curso_academico_id
                                   AND k.estado <> 'cerrado' AND k.deleted_at IS NULL
    JOIN public.gastos_gestion_curso gc ON gc.curso_academico_id = k.id
    LEFT JOIN public.gastos_gestion g ON g.nino_id = n.id AND g.curso_academico_id = k.id
   WHERE n.id = p_nino_id AND n.deleted_at IS NULL
     -- 9b (decidido por Jose el 2026-11-16): solo el curso del ALTA, el primero del niño. Lo que
     -- paga el que continúa lo cobra Dirección con un cargo puntual (anadir_cargo_puntual).
     AND NOT EXISTS (SELECT 1 FROM public.matriculas m0
                       JOIN public.cursos_academicos k0 ON k0.id = m0.curso_academico_id
                      WHERE m0.nino_id = n.id AND m0.deleted_at IS NULL
                        AND k0.fecha_inicio < k.fecha_inicio)
   GROUP BY k.id, k.nombre, k.fecha_inicio, gc.importe_centimos, g.importe_centimos, g.forma,
            g.justificante_path, g.cobrado_at, g.cobrado_por
   ORDER BY k.fecha_inicio, k.nombre, k.id
$function$;

CREATE OR REPLACE FUNCTION privado.gastos_sin_contestar(p_nino_id uuid)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(array_agg(g.curso_academico_id ORDER BY g.curso_academico_id), '{}')
    FROM privado.gastos_del_nino(p_nino_id) g
   WHERE g.forma IS NULL AND g.cobrado_at IS NULL AND g.importe > 0
$function$;

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

  -- Fase 5b (20270114120000): los datos del niño que el alta exige. Apellidos y fecha ya se exigían,
  -- pero en silencio (el UPDATE de abajo tocaba 0 filas y devolvía NULL); ahora frenan con su motivo,
  -- junto con los tres obligatorios de la fase 5 (decididos por el responsable el 2026-11-10): lugar
  -- de nacimiento, nacionalidad y hermanos. Solo al cerrar un alta pendiente: no toca a los niños ya
  -- validados. Dirección, que cierra el alta en papel, los escribe con su sesión antes de llegar aquí.
  IF v_pendiente AND EXISTS (
       SELECT 1 FROM public.ninos n
        WHERE n.id = p_nino_id
          AND (n.apellidos IS NULL
               OR n.fecha_nacimiento IS NULL
               OR NULLIF(btrim(n.lugar_nacimiento), '') IS NULL
               OR NULLIF(btrim(n.nacionalidad), '') IS NULL
               OR n.hermanos_total IS NULL
               -- Fase 7 (decidido por el responsable el 2026-11-13): el número de la tarjeta
               -- sanitaria, de cualquier comunidad o aseguradora. La imagen no se exige nunca.
               OR n.sip IS NULL)) THEN
    RAISE EXCEPTION 'faltan datos del nino por completar'
      USING HINT = 'datos_nino_por_completar';
  END IF;

  -- Fase 6 (20270118120000): los datos de los tutores que el alta exige (decididos por el
  -- responsable el 2026-11-12/13: D12, D14, D15 y el número del DNI; `privado.tutor_completo`). El
  -- titular siempre; el segundo tutor si la familia lo tiene (sin fila = «no hay segundo tutor»). Solo
  -- al cerrar un alta pendiente: no toca a las familias ya validadas.
  IF v_pendiente AND (
       NOT EXISTS (
         SELECT 1 FROM public.ninos n
           JOIN public.familia_tutores t
             ON t.familia_id = n.familia_id AND t.rol_familia = 'titular' AND t.deleted_at IS NULL
          WHERE n.id = p_nino_id AND privado.tutor_completo(t))
    OR EXISTS (
         SELECT 1 FROM public.ninos n
           JOIN public.familia_tutores t
             ON t.familia_id = n.familia_id AND t.rol_familia = 'segundo_tutor' AND t.deleted_at IS NULL
          WHERE n.id = p_nino_id AND NOT privado.tutor_completo(t))) THEN
    RAISE EXCEPTION 'faltan datos de los tutores por completar'
      USING HINT = 'datos_tutor_por_completar';
  END IF;

  -- Fase 8b (20270122130000; decidido por el responsable el 2026-11-14): cada servicio que el centro
  -- ofrece al niño, contestado (no, todos los meses o días sueltos). Un centro sin conceptos de
  -- servicio no pide nada. Solo al cerrar un alta pendiente: no toca a los niños ya validados.
  IF v_pendiente AND cardinality(privado.servicios_sin_contestar(p_nino_id)) > 0 THEN
    RAISE EXCEPTION 'faltan servicios por contestar: %', privado.servicios_sin_contestar(p_nino_id)
      USING HINT = 'servicios_por_contestar';
  END IF;

  -- Fase 9b (20270124120000; decidido por el responsable el 2026-11-16): los gastos de gestión del
  -- curso del alta, contestados (transferencia o efectivo) si el centro les ha puesto importe. Que
  -- estén cobrados no frena (D5). Solo al cerrar un alta pendiente: no toca a los niños validados.
  IF v_pendiente AND cardinality(privado.gastos_sin_contestar(p_nino_id)) > 0 THEN
    RAISE EXCEPTION 'faltan los gastos de gestión por contestar'
      USING HINT = 'gastos_por_contestar';
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

-- ---- Guarda posterior ----
DO $guarda$
BEGIN
  IF position('gastos_por_contestar' IN (SELECT prosrc FROM pg_proc
       WHERE oid = 'public.marcar_matricula_lista(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'marcar_matricula_lista no exige los gastos de gestión';
  END IF;
  IF position('k0.fecha_inicio < k.fecha_inicio' IN (SELECT prosrc FROM pg_proc
       WHERE oid = 'privado.gastos_del_nino(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'gastos_del_nino sigue contando la renovación';
  END IF;
  IF position('g.importe > 0' IN (SELECT prosrc FROM pg_proc
       WHERE oid = 'privado.gastos_sin_contestar(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'gastos_sin_contestar pide respuesta con importe 0';
  END IF;
  IF has_function_privilege('authenticated', 'privado.gastos_del_nino(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'privado.gastos_sin_contestar(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'las funciones privadas quedaron abiertas a la sesión';
  END IF;
END $guarda$;
