-- =============================================================================
-- Fase 8b · la petición de servicios del alta (2 de 2: DESPUÉS del despliegue)
-- Spec: docs/specs/altas-serie.md, «8b».
--
-- Contestar cada servicio es obligatorio para cerrar el alta, y lo exige también la base (decidido
-- por el responsable el 2026-11-14): `marcar_matricula_lista` para con HINT `servicios_por_contestar`
-- si a la petición le falta algún servicio de los que el centro ofrece al niño. Solo al cerrar un
-- alta pendiente: las validadas y las ya terminadas no cambian (no es retroactiva).
--
-- Va después del despliegue: con la app de antes, la familia no ve el paso de servicios y no podría
-- cerrar el alta. La aplica el responsable por SQL Editor, copiando el fichero de la rama. Sin COMMIT
-- ni BEGIN. Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20270122120000') THEN
    RAISE EXCEPTION 'falta 20270122120000 (la petición de servicios) en el registro';
  END IF;
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.marcar_matricula_lista(uuid)');
  IF v_md5 IS DISTINCT FROM '0398c7e925c656d11b97ff16d15b5a9a' THEN
    RAISE EXCEPTION 'marcar_matricula_lista no es la de antes: %', coalesce(v_md5, 'falta');
  END IF;
END $guarda$;

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
  IF position('servicios_por_contestar' IN (SELECT prosrc FROM pg_proc
       WHERE oid = 'public.marcar_matricula_lista(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'marcar_matricula_lista no exige los servicios';
  END IF;
END $guarda$;
