-- =============================================================================
-- FEAT — El alta exige la tarjeta sanitaria (serie de altas, fase 7, el cierre; 2026-11-13)
-- -----------------------------------------------------------------------------
-- Spec: docs/specs/altas-serie.md, «Fase 7: la tarjeta sanitaria». Decidido por el responsable el
-- 2026-11-13 (corrigiendo lo dicho antes ese mismo día): el NÚMERO es obligatorio para cerrar el
-- alta, y la base también lo exige, no solo la app. Obligatorio es TENERLA, no que sea valenciana:
-- vale la de cualquier comunidad o aseguradora. La imagen no se exige nunca.
--
--   · `marcar_matricula_lista`: el bloque de los datos del niño (HINT `datos_nino_por_completar`,
--     el mismo paso del alta) añade `sip IS NULL`.
--   · No es retroactivo: solo mira al cerrar una matrícula pendiente. Las familias ya matriculadas
--     sin tarjeta las ve la Dirección en su lista para reclamarla.
--
-- Generada con un guion desde el cuerpo vivo (la de la fase 6, mismo md5 normalizado que producción).
-- ORDEN: DESPUÉS de `20270119120000` y DESPUÉS del despliegue de la app que pregunta la tarjeta. Con
-- esta aplicada y la app de antes, ninguna alta se podría cerrar. La aplica el responsable por SQL
-- Editor, copiando el fichero de la rama. Tras aplicar: registrar en
-- supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20270119120000')
     OR NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.ninos'::regclass AND attname = 'sip' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'falta 20270119120000 (aplicada y registrada)';
  END IF;
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure('public.marcar_matricula_lista(uuid)');
  IF v_md5 IS DISTINCT FROM 'e0d85ae437c5e2ce94a9342d82768a98' THEN
    RAISE EXCEPTION 'public.marcar_matricula_lista(uuid) no es la de antes: %', coalesce(v_md5, 'falta');
  END IF;
  RAISE NOTICE 'guarda previa: 20270119120000 aplicada; marcar_matricula_lista es la de antes';
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
  v_sin int;
BEGIN
  SELECT p.prosrc, array_to_string(ARRAY(SELECT a FROM unnest(p.proacl::text[]) a WHERE a NOT LIKE 'postgres=%' ORDER BY a), ',')
    INTO v_src, v_acl FROM pg_proc p WHERE p.oid = 'public.marcar_matricula_lista(uuid)'::regprocedure;
  -- El bloque entero, normalizado: un trozo suelto pasaría con el bloque desactivado.
  IF regexp_replace(regexp_replace(replace(v_src, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g') NOT LIKE
       '%OR NULLIF(btrim(n.nacionalidad), '''') IS NULL OR n.hermanos_total IS NULL OR n.sip IS NULL)) THEN'
       ' RAISE EXCEPTION ''faltan datos del nino por completar'' USING HINT = ''datos_nino_por_completar''; END IF;%' THEN
    RAISE EXCEPTION 'marcar_matricula_lista no exige la tarjeta sanitaria';
  END IF;
  IF v_acl IS DISTINCT FROM 'authenticated=X/postgres,service_role=X/postgres' THEN
    RAISE EXCEPTION 'marcar_matricula_lista tiene la ACL %', coalesce(v_acl, 'ninguna');
  END IF;
  -- Recuentos (no frenan): altas pendientes sin tarjeta (desde ahora no se cierran sin ella) y niños
  -- con matrícula activa sin tarjeta (no es retroactivo: los reclama la Dirección).
  SELECT count(*) INTO v_frenadas
    FROM public.matriculas m JOIN public.ninos n ON n.id = m.nino_id
   WHERE m.estado = 'pendiente' AND m.fecha_baja IS NULL AND m.deleted_at IS NULL AND n.sip IS NULL;
  SELECT count(DISTINCT n.id) INTO v_sin
    FROM public.matriculas m JOIN public.ninos n ON n.id = m.nino_id
   WHERE m.estado = 'activa' AND m.fecha_baja IS NULL AND m.deleted_at IS NULL AND n.deleted_at IS NULL AND n.sip IS NULL;
  RAISE NOTICE 'guarda posterior: exige la tarjeta, ACL %; altas pendientes sin tarjeta: %; niños activos sin tarjeta: %', v_acl, v_frenadas, v_sin;
END;
$guarda$;
