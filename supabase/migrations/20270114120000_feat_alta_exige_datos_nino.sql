-- =============================================================================
-- FEAT — El alta exige los datos del niño (serie de altas, fase 5b; 2026-11-11)
-- -----------------------------------------------------------------------------
-- Spec: docs/specs/altas-serie.md, «Fase 5b». Decidido por el responsable (2026-11-10): para cerrar el
-- alta son obligatorios el lugar de nacimiento, la nacionalidad y los hermanos (total y lugar); el resto
-- de campos de la fase 5 son opcionales. La app los pide en el paso del menor y `finalizarAlta` frena
-- antes; esto es el respaldo en la base.
--
--   · `marcar_matricula_lista` frena con HINT `datos_nino_por_completar` si la matrícula está pendiente
--     y falta alguno de los tres, o los apellidos o la fecha de nacimiento, que hasta hoy frenaban EN
--     SILENCIO: el UPDATE tocaba 0 filas, la función devolvía NULL y la app lo trataba como un cierre
--     ya hecho.
--   · No es retroactivo: solo mira al cerrar una matrícula pendiente. Una reactivación (desarchivar,
--     familia archivada) crea una pendiente y pasa por el asistente: también le pide los tres.
--   · Lo demás de la función no cambia (gate, acuse médico, documentos por firmar, el UPDATE).
--
-- Generada con un guion desde el cuerpo vivo (20270109120000, mismo md5 normalizado que producción).
-- ORDEN: mergear, esperar el despliegue, aplicar. Con la migración aplicada y la app de antes, que no
-- pregunta lugar ni hermanos, nadie podría cerrar un alta. La aplica el responsable por SQL Editor,
-- copiando el fichero de la rama. Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
BEGIN
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')) INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.marcar_matricula_lista(uuid)');
  IF v_md5 IS DISTINCT FROM 'd31f85614ac5f7025136ffe32c6867ab' THEN
    RAISE EXCEPTION 'public.marcar_matricula_lista(uuid) no es la de antes: %', coalesce(v_md5, 'falta');
  END IF;
  RAISE NOTICE 'guarda previa: marcar_matricula_lista es la de antes';
END;
$guarda$;

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
               OR n.hermanos_total IS NULL)) THEN
    RAISE EXCEPTION 'faltan datos del nino por completar'
      USING HINT = 'datos_nino_por_completar';
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

-- La firma no cambia (CREATE OR REPLACE): los permisos se conservan; la guarda posterior los mira.

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_src text;
  v_acl text;
  v_frenadas int;
BEGIN
  SELECT p.prosrc, array_to_string(ARRAY(SELECT a FROM unnest(p.proacl::text[]) a WHERE a NOT LIKE 'postgres=%' ORDER BY a), ',')
    INTO v_src, v_acl FROM pg_proc p WHERE p.oid = 'public.marcar_matricula_lista(uuid)'::regprocedure;
  -- El bloque entero, normalizado como el md5 (sin comentarios ni CR, espacios colapsados): un trozo
  -- suelto pasaría con el bloque desactivado (`IF false AND …`).
  IF regexp_replace(regexp_replace(replace(v_src, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g') NOT LIKE
       '%IF v_pendiente AND EXISTS ( SELECT 1 FROM public.ninos n WHERE n.id = p_nino_id AND (n.apellidos IS NULL'
       ' OR n.fecha_nacimiento IS NULL OR NULLIF(btrim(n.lugar_nacimiento), '''') IS NULL'
       ' OR NULLIF(btrim(n.nacionalidad), '''') IS NULL OR n.hermanos_total IS NULL)) THEN'
       ' RAISE EXCEPTION ''faltan datos del nino por completar'' USING HINT = ''datos_nino_por_completar''; END IF;'
       ' UPDATE public.matriculas SET estado = ''lista''%' THEN
    RAISE EXCEPTION 'marcar_matricula_lista no exige los datos del niño';
  END IF;
  IF v_acl IS DISTINCT FROM 'authenticated=X/postgres,service_role=X/postgres' THEN
    RAISE EXCEPTION 'marcar_matricula_lista tiene la ACL %', coalesce(v_acl, 'ninguna');
  END IF;
  -- Recuento (no frena): las altas pendientes que desde ahora no se cierran hasta completar los datos.
  SELECT count(*) INTO v_frenadas
    FROM public.matriculas m JOIN public.ninos n ON n.id = m.nino_id
   WHERE m.estado = 'pendiente' AND m.fecha_baja IS NULL AND m.deleted_at IS NULL
     AND (n.apellidos IS NULL OR n.fecha_nacimiento IS NULL OR NULLIF(btrim(n.lugar_nacimiento), '') IS NULL
          OR NULLIF(btrim(n.nacionalidad), '') IS NULL OR n.hermanos_total IS NULL);
  RAISE NOTICE 'guarda posterior: exige los datos del niño, ACL %; altas pendientes a las que les falta algún dato: %', v_acl, v_frenadas;
END;
$guarda$;
