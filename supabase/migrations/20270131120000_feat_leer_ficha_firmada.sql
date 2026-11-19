-- Fase 10 · 10c: leer la ficha firmada (2026-11-19). Spec: docs/specs/altas-serie.md, «10c: el
-- encargo, lo medido abierto y la condición de la (C)».
--
-- El responsable, 2026-11-19: «Leer la ficha firmada va por una FUNCIÓN, abierta al tutor legal y a
-- Dirección. El autorizado no, la profe tampoco. Cada lectura deja su fila en lecturas_ficha_medica
-- con un origen nuevo, y respeta el bloqueo tras el curso de la baja. NADA DE URL PÚBLICA.» El PDF lo
-- compone el servidor con la plantilla de la versión que guarda la firma (`src/features/alta/lib/
-- ficha-pdf/`): esta migración solo entrega la foto descifrada a quien puede leerla.
--
-- Medido ABIERTO en producción el 2026-11-19 (ensayo terminado en RAISE): con una firma de verdad, ni
-- el tutor legal ni Dirección pueden leer la foto (42501 en `contenido_cifrado`), ninguna función la
-- devuelve, y el CHECK de `lecturas_ficha_medica` no admite un origen nuevo.
--
--   1. `lecturas_ficha_medica`: el origen `ficha_firmada`.
--   2. `public.leer_ficha_firmada(firma)`: la foto descifrada y lo que el PDF necesita de la firma.
--      Las puertas, las de `ficha_para_firmar`: Dirección del centro (sin el superusuario) o el tutor
--      legal que puede ver la ficha médica (`privado.puerta_firma_tutor`); a cualquier otro, 42501.
--      Respeta los dos bloqueos: el de la ficha médica tras el curso de la baja y el de la firma (el
--      tutor olvidado). Comprueba que la foto da su sello antes de devolverla. Deja su lectura.
--
-- ORDEN: aplicar ANTES de mergear y del despliegue. Solo añade: la app de antes no llama a esto. Sin
-- COMMIT ni BEGIN: el SQL Editor la envuelve en su transacción.

-- ─────────────────────────────────────────────────────────────── guarda previa
DO $guarda$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20270130120000') THEN
    RAISE EXCEPTION 'falta la 20270130120000 en el registro: aplica antes la 10b-3';
  END IF;
  IF to_regprocedure('public.leer_ficha_firmada(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'leer_ficha_firmada ya existe: esta migración ya se aplicó';
  END IF;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'lecturas_ficha_medica_origen_check')
     IS DISTINCT FROM 'CHECK ((origen = ANY (ARRAY[''ficha''::text, ''alta''::text, ''export''::text, ''datos_bloqueados''::text])))' THEN
    RAISE EXCEPTION 'lecturas_ficha_medica_origen_check no es el leído en producción el 2026-11-19';
  END IF;
  -- Las que la lectura usa sin tocarlas, con el cuerpo leído en producción (md5 de la lógica normalizada).
  IF md5(btrim(regexp_replace(regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('privado.puerta_firma_tutor(uuid)')), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]+', ' ', 'g')))
     IS DISTINCT FROM 'ff23cfcb9c2d6cee2e2c60f60c92e6d8' THEN
    RAISE EXCEPTION 'privado.puerta_firma_tutor(uuid) no es la leída en producción el 2026-11-19';
  END IF;
  IF md5(btrim(regexp_replace(regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('privado.firma_ficha_bloqueada(uuid,uuid,uuid)')), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]+', ' ', 'g')))
     IS DISTINCT FROM '266724525db5737a85d4638661678d56' THEN
    RAISE EXCEPTION 'privado.firma_ficha_bloqueada(uuid,uuid,uuid) no es la leída en producción el 2026-11-19';
  END IF;
  IF md5(btrim(regexp_replace(regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('privado.ficha_medica_bloqueada_desde(uuid)')), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]+', ' ', 'g')))
     IS DISTINCT FROM 'a63149f3e4fcafc77a69f9d745395279' THEN
    RAISE EXCEPTION 'privado.ficha_medica_bloqueada_desde(uuid) no es la leída en producción el 2026-11-19';
  END IF;
  IF md5(btrim(regexp_replace(regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('privado.ficha_hash(jsonb)')), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]+', ' ', 'g')))
     IS DISTINCT FROM '74c0745bfea7278a37e38b5481438381' THEN
    RAISE EXCEPTION 'privado.ficha_hash(jsonb) no es la leída en producción el 2026-11-19';
  END IF;
  -- La versión de la plantilla con la que se firma: la 1, la que compone `ficha-pdf/v1.ts`.
  IF privado.ficha_plantilla_pdf_version() IS DISTINCT FROM 1::smallint THEN
    RAISE EXCEPTION 'privado.ficha_plantilla_pdf_version() no es la 1: falta su plantilla';
  END IF;
END
$guarda$;

-- ─────────────────────────────────────────────────────────────── el origen nuevo
ALTER TABLE public.lecturas_ficha_medica DROP CONSTRAINT lecturas_ficha_medica_origen_check;
ALTER TABLE public.lecturas_ficha_medica ADD CONSTRAINT lecturas_ficha_medica_origen_check
  CHECK (origen IN ('ficha', 'alta', 'export', 'datos_bloqueados', 'ficha_firmada'));

-- ─────────────────────────────────────────────────────────────── leer la copia firmada
-- La foto de lo que se firmó, descifrada, y lo de la firma que el PDF enseña (quién, cuándo, cómo, el
-- trazo, las versiones y el sello). No la IP ni el navegador. Una firma que no existe o que no se
-- puede leer da el mismo 42501: no se dice si un id es de una firma.
CREATE FUNCTION public.leer_ficha_firmada(p_firma_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $f$
DECLARE
  f public.firmas_ficha%ROWTYPE;
  v_centro uuid;
  v_rol text;
  v_bloqueada date;
  v_ficha jsonb;
BEGIN
  SELECT * INTO f FROM public.firmas_ficha WHERE id = p_firma_id;
  IF NOT FOUND OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;
  v_centro := privado.centro_de_nino(f.nino_id);

  -- Las puertas de `ficha_para_firmar`: Dirección del centro, sin el superusuario (ADR-0061); si no,
  -- el tutor legal que puede ver la ficha médica. El autorizado y la profe, 42501.
  IF public.es_admin(v_centro) AND NOT public.is_superadmin() THEN
    SELECT CASE WHEN bool_or(r.rol::text = 'admin') THEN 'admin' ELSE 'directora' END INTO v_rol
      FROM public.roles_usuario r
     WHERE r.usuario_id = auth.uid() AND r.centro_id = v_centro AND r.deleted_at IS NULL
       AND r.rol::text IN ('admin', 'directora');
  ELSE
    PERFORM privado.puerta_firma_tutor(f.nino_id);
    v_rol := 'tutor_legal';
  END IF;

  -- El bloqueo de la firma: la del tutor olvidado no se enseña (la misma regla que la tabla).
  IF privado.firma_ficha_bloqueada(f.nino_id, f.firmante_id, f.tutor_id) THEN
    RAISE EXCEPTION 'firma bloqueada por la retención'
      USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'firma_bloqueada';
  END IF;
  -- El bloqueo de la ficha médica tras el curso de la baja (y desde la purga), como `ficha_para_firmar`.
  v_bloqueada := privado.ficha_medica_bloqueada_desde(f.nino_id);
  IF v_bloqueada IS NOT NULL THEN
    RAISE EXCEPTION 'ficha médica bloqueada desde %', v_bloqueada
      USING ERRCODE = 'object_not_in_prerequisite_state', DETAIL = v_bloqueada::text, HINT = 'ficha_bloqueada';
  END IF;

  v_ficha := pgp_sym_decrypt(f.contenido_cifrado, public._get_medical_key())::jsonb;
  -- La copia es la firmada solo si da su sello: si no, no hay copia que dar.
  IF privado.ficha_hash(v_ficha) IS DISTINCT FROM f.contenido_sha256 THEN
    RAISE EXCEPTION 'la copia de la ficha no da el sello de su firma'
      USING ERRCODE = 'data_corrupted', HINT = 'sello_distinto';
  END IF;

  INSERT INTO public.lecturas_ficha_medica (nino_id, centro_id, lector_id, rol_lector, origen, campos)
  SELECT f.nino_id, v_centro, auth.uid(), v_rol, 'ficha_firmada',
         COALESCE(ARRAY(SELECT k FROM jsonb_each_text(CASE WHEN jsonb_typeof(v_ficha->'medico') = 'object' THEN v_ficha->'medico' ELSE '{}'::jsonb END) e(k, v)
                         WHERE v IS NOT NULL ORDER BY k), '{}');

  RETURN jsonb_build_object(
    'firma_id', f.id, 'nino_id', f.nino_id, 'firmado_at', f.firmado_at,
    'metodo_firma', f.metodo_firma, 'rol_firmante', f.rol_firmante,
    'nombre_tecleado', f.nombre_tecleado, 'firma_imagen', f.firma_imagen,
    'ficha_version', f.ficha_version, 'plantilla_pdf_version', f.plantilla_pdf_version,
    'contenido_sha256', f.contenido_sha256, 'ficha', v_ficha);
END $f$;
REVOKE ALL ON FUNCTION public.leer_ficha_firmada(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.leer_ficha_firmada(uuid) TO authenticated;
COMMENT ON FUNCTION public.leer_ficha_firmada(uuid) IS
  'Fase 10c: la copia firmada de la ficha (la foto descifrada y lo de su firma), para el tutor legal con el '
  'permiso de la ficha médica y Dirección del centro. Respeta los dos bloqueos, comprueba el sello y deja su '
  'fila en lecturas_ficha_medica (origen ficha_firmada). El PDF lo compone el servidor; no se guarda.';

-- ─────────────────────────────────────────────────────────────── guarda posterior
DO $guarda$
BEGIN
  IF to_regprocedure('public.leer_ficha_firmada(uuid)') IS NULL
     OR has_function_privilege('anon', 'public.leer_ficha_firmada(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.leer_ficha_firmada(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'leer_ficha_firmada no quedó como debía';
  END IF;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'lecturas_ficha_medica_origen_check') NOT LIKE '%ficha_firmada%' THEN
    RAISE EXCEPTION 'el origen ficha_firmada no entró';
  END IF;
END
$guarda$;
