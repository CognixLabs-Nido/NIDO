-- =============================================================================
-- FEAT — La tarjeta sanitaria del niño (serie de altas, fase 7, la base; 2026-11-13)
-- -----------------------------------------------------------------------------
-- Spec: docs/specs/altas-serie.md, «Fase 7: la tarjeta sanitaria». Decidido por el responsable:
--   · D7 (2026-10-29): el número es un identificador como el DNI: en claro, en `ninos`, NO en la
--     ficha médica cifrada. D8: la imagen va en su propio bucket, con el criterio de `dni-tutores`.
--   · 2026-11-13: se acepta cualquier tarjeta (otra comunidad, aseguradora, extranjera); la imagen la
--     suben la familia o Dirección después del alta, nunca obligatoria, un PDF; la profe del aula ve
--     el número y no la imagen; el autorizado, nada; lo demás como el DNI del niño (a la cola con el
--     alta validada, export, purga con el niño, no retroactivo). El número es obligatorio para
--     cerrar el alta: eso lo pone la segunda migración (`20270119130000`), no esta.
--
-- Lo que hace:
--   · `ninos.sip` (el número, sin espacios, puntos, guiones ni barras y en mayúsculas; 5 a 30 letras o
--     cifras) y `ninos.sip_documento_path` (la ruta del PDF, en la carpeta del niño). Sin GRANT de
--     SELECT: nacen cerradas para la sesión, como `dni`. Escribe la Dirección con su sesión
--     (`ninos_admin_all`, el UPDATE es de tabla); el tutor, solo por función.
--   · `actualizar_identidad_nino_tutor` recibe `p_sip` (último, con DEFAULT: la app de antes la sigue
--     llamando igual) y lo trata como el DNI: con el alta validada, un cambio → 42501 cola_validacion.
--   · `fijar_sip_documento_nino`: la imagen, del tutor legal o de la Dirección; con el alta validada,
--     el tutor va a la cola (42501 cola_validacion), mandar la misma ruta no es un cambio.
--   · `sip_de_ninos`: lectura. El número, a la Dirección, al tutor legal y a la profe del niño; la
--     ruta de la imagen, solo a los dos primeros (`ve_documento`). El autorizado no recibe filas.
--   · El bucket `sip-ninos` (privado, PDF, 10 MB), con las políticas de `libro-familia`: Dirección o
--     tutor legal, ruta coherente; borrar, solo la Dirección.
--   · La cola: el CHECK de la ruta de `cambios_pendientes` admite la entidad `ninos_sip_documento`.
--   · La purga: `privado.purgar_nino` borra las dos columnas y `_claves_pii_nino` las conoce (la
--     copia en `audit_log`). El objeto del bucket lo borra el manifiesto de adjuntos de la app.
--
-- Generada con un guion desde los cuerpos vivos, con la guarda de md5 normalizado.
-- ORDEN: aplicar ESTA → mergear → desplegar → aplicar `20270119130000`. Con esta aplicada, la app de
-- antes no cambia (la columna nueva no la lee nadie y `p_sip` tiene DEFAULT); la app nueva la
-- necesita. La aplica el responsable por SQL Editor, copiando el fichero de la rama. Tras aplicar:
-- registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
  v_esperado text;
  v_firma text;
  v text;
BEGIN
  FOR v_firma, v_esperado IN VALUES
    ('public.actualizar_identidad_nino_tutor(uuid,text,text,date,public.nino_sexo,text,text,text,text,text,integer,integer,text,text,text)', '705432e2e667c57f0d09bc690eff855f'),
    ('privado.purgar_nino(uuid)', '0e3a8bf6a477d0c236b1ab3c35566cfd'),
    ('public._claves_pii_nino(text)', 'aadd2091d19d599c1e032282b889baeb'),
    ('privado.ninos_validar_rutas()', '3ba3251e17d93887b2d9ab058b172b1c'),
    ('privado.ruta_coherente(text,text)', '5fce6211e90610931afdcb23481b3ec9')
  LOOP
    SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
      INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure(v_firma);
    IF v_md5 IS DISTINCT FROM v_esperado THEN
      RAISE EXCEPTION '% no es la de antes: %', v_firma, coalesce(v_md5, 'falta');
    END IF;
  END LOOP;

  SELECT string_agg(attname, ',' ORDER BY attname) INTO v
    FROM pg_attribute WHERE attrelid = 'public.ninos'::regclass AND attnum > 0 AND NOT attisdropped;
  IF v IS DISTINCT FROM 'apellidos,centro_id,como_nos_conocio,como_nos_conocio_otro,created_at,deleted_at,deleted_reason,direccion_calle,direccion_ciudad,direccion_cp,direccion_numero,direccion_provincia,dni,estado_civil_familia,familia_id,fecha_nacimiento,foto_url,hermanos_lugar,hermanos_total,id,idioma_principal,libro_familia_path,lugar_nacimiento,nacionalidad,nombre,notas_admin,observaciones_familia,primer_apellido,puede_aparecer_en_fotos,purgado_en,requiere_ambos_firmantes,segundo_apellido,sexo,updated_at' THEN
    RAISE EXCEPTION 'ninos no tiene las columnas esperadas: %', v;
  END IF;
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'sip-ninos') THEN
    RAISE EXCEPTION 'el bucket sip-ninos ya existe';
  END IF;
  IF to_regprocedure('public.fijar_sip_documento_nino(uuid,text)') IS NOT NULL
     OR to_regprocedure('public.sip_de_ninos(uuid[])') IS NOT NULL
     OR to_regprocedure('privado.sip_normalizado(text)') IS NOT NULL THEN
    RAISE EXCEPTION 'alguna función nueva ya existe';
  END IF;
  SELECT pg_get_constraintdef(oid) INTO v FROM pg_constraint
   WHERE conrelid = 'public.cambios_pendientes'::regclass AND conname = 'cambios_pendientes_ruta_documento_del_nino';
  IF v IS DISTINCT FROM 'CHECK (((entidad <> ALL (ARRAY[''ninos_libro_familia''::text, ''datos_tutor_dni''::text])) OR (COALESCE((payload ->> ''path''::text), ''''::text) ~ ((((''^''::text || (centro_id)::text) || ''/''::text) || (nino_id)::text) || ''/[A-Za-z0-9_-]+\.pdf$''::text))))' THEN
    RAISE EXCEPTION 'el CHECK de la ruta de la cola no es el esperado: %', coalesce(v, 'falta');
  END IF;
  -- La sesión sigue sin leer `dni`: el mismo cierre que tendrá `sip`.
  IF has_column_privilege('authenticated', 'public.ninos', 'dni', 'SELECT') THEN
    RAISE EXCEPTION 'ninos.dni es legible por la sesión: el molde no es el que se midió';
  END IF;
  RAISE NOTICE 'guarda previa: las 5 funciones son las de antes; ninos, bucket y cola como se midieron';
END;
$guarda$;

-- ---- 1. El número y la imagen, en `ninos` ----
-- Cualquier tarjeta (decidido el 2026-11-13): solo la forma que comparten todas, letras y cifras.
-- La comprobación propia del SIP valenciano no está: su dígito de control no tiene un cálculo
-- publicado (la spec lo apunta). Inventarlo dejaría fuera a una familia con una tarjeta buena.
CREATE FUNCTION privado.sip_normalizado(p_sip text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT NULLIF(upper(regexp_replace(p_sip, '[[:space:]./-]', '', 'g')), '');
$function$;
REVOKE ALL ON FUNCTION privado.sip_normalizado(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION privado.sip_normalizado(text) TO authenticated, service_role;

ALTER TABLE public.ninos
  ADD COLUMN sip text,
  ADD COLUMN sip_documento_path text;
ALTER TABLE public.ninos
  ADD CONSTRAINT ninos_sip_forma CHECK (sip IS NULL OR sip ~ '^[A-Z0-9]{5,30}$');

-- La ruta de la imagen, validada como la del libro (trigger de rutas, ahora también por esta columna).
CREATE OR REPLACE FUNCTION privado.ninos_validar_rutas()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_centro_cambia boolean := TG_OP = 'UPDATE' AND NEW.centro_id IS DISTINCT FROM OLD.centro_id;
BEGIN
  IF NEW.foto_url IS NOT NULL
     AND (TG_OP = 'INSERT' OR v_centro_cambia OR NEW.foto_url IS DISTINCT FROM OLD.foto_url)
     AND NEW.foto_url !~ ('^' || NEW.centro_id || '/' || NEW.id || '/[A-Za-z0-9_-]+\.jpg$') THEN
    RAISE EXCEPTION 'la ruta de la foto no es de este niño'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.libro_familia_path IS NOT NULL
     AND (TG_OP = 'INSERT' OR v_centro_cambia OR NEW.libro_familia_path IS DISTINCT FROM OLD.libro_familia_path)
     AND NEW.libro_familia_path !~ ('^' || NEW.centro_id || '/' || NEW.id || '/[A-Za-z0-9_-]+\.pdf$') THEN
    RAISE EXCEPTION 'la ruta del libro de familia no es de este niño'
      USING ERRCODE = 'check_violation';
  END IF;
  -- Fase 7: la imagen de la tarjeta sanitaria, un PDF en la carpeta del niño, como el libro.
  IF NEW.sip_documento_path IS NOT NULL
     AND (TG_OP = 'INSERT' OR v_centro_cambia OR NEW.sip_documento_path IS DISTINCT FROM OLD.sip_documento_path)
     AND NEW.sip_documento_path !~ ('^' || NEW.centro_id || '/' || NEW.id || '/[A-Za-z0-9_-]+\.pdf$') THEN
    RAISE EXCEPTION 'la ruta de la tarjeta sanitaria no es de este niño'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER ninos_validar_rutas_trg ON public.ninos;
CREATE TRIGGER ninos_validar_rutas_trg BEFORE INSERT OR UPDATE OF foto_url, libro_familia_path, sip_documento_path, centro_id
  ON public.ninos FOR EACH ROW EXECUTE FUNCTION privado.ninos_validar_rutas();

-- ---- 2. El bucket, con las políticas de `libro-familia` ----
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('sip-ninos', 'sip-ninos', false, 10485760, ARRAY['application/pdf']);

CREATE POLICY sip_ninos_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'sip-ninos'
         AND (public.es_admin(((storage.foldername(name))[1])::uuid)
              OR public.es_tutor_legal_de(((storage.foldername(name))[2])::uuid))
         AND privado.ruta_coherente(bucket_id, name));
CREATE POLICY sip_ninos_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'sip-ninos'
              AND (public.es_admin(((storage.foldername(name))[1])::uuid)
                   OR public.es_tutor_legal_de(((storage.foldername(name))[2])::uuid))
              AND privado.ruta_coherente(bucket_id, name));
CREATE POLICY sip_ninos_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'sip-ninos'
         AND (public.es_admin(((storage.foldername(name))[1])::uuid)
              OR public.es_tutor_legal_de(((storage.foldername(name))[2])::uuid))
         AND privado.ruta_coherente(bucket_id, name))
  WITH CHECK (bucket_id = 'sip-ninos'
              AND (public.es_admin(((storage.foldername(name))[1])::uuid)
                   OR public.es_tutor_legal_de(((storage.foldername(name))[2])::uuid))
              AND privado.ruta_coherente(bucket_id, name));
CREATE POLICY sip_ninos_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'sip-ninos'
         AND public.es_admin(((storage.foldername(name))[1])::uuid)
         AND privado.ruta_coherente(bucket_id, name));

-- ---- 3. La escritura del número: la función del tutor, como el DNI ----
-- La firma cambia (un parámetro más, con DEFAULT): se borra la de antes y se crea la nueva con los
-- mismos permisos. Quien la llame con los parámetros de antes (la app de antes) llega a la nueva.
DROP FUNCTION public.actualizar_identidad_nino_tutor(uuid,text,text,date,public.nino_sexo,text,text,text,text,text,integer,integer,text,text,text);
CREATE FUNCTION public.actualizar_identidad_nino_tutor(p_nino_id uuid, p_primer_apellido text, p_segundo_apellido text, p_fecha_nacimiento date, p_sexo nino_sexo, p_nacionalidad text, p_idioma_principal text, p_nombre text DEFAULT NULL::text, p_lugar_nacimiento text DEFAULT NULL::text, p_dni text DEFAULT NULL::text, p_hermanos_total integer DEFAULT NULL::integer, p_hermanos_lugar integer DEFAULT NULL::integer, p_observaciones_familia text DEFAULT NULL::text, p_como_nos_conocio text DEFAULT NULL::text, p_como_nos_conocio_otro text DEFAULT NULL::text, p_sip text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_actual public.ninos%ROWTYPE;
BEGIN
  IF NOT public.es_tutor_legal_de(p_nino_id) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 5a: los apellidos van en pareja. Si llega el primero, llega el segundo con él, y vacío es «no
  -- tiene»: así se puede quitar un segundo apellido. El primero no puede llegar vacío, y el segundo
  -- no llega solo. `apellidos` la deriva la base de los dos.
  IF p_primer_apellido IS NOT NULL AND btrim(p_primer_apellido) = '' THEN
    RAISE EXCEPTION 'falta el primer apellido'
      USING ERRCODE = 'invalid_parameter_value', HINT = 'primer_apellido';
  END IF;
  IF p_primer_apellido IS NULL AND p_segundo_apellido IS NOT NULL THEN
    RAISE EXCEPTION 'el segundo apellido llega con el primero'
      USING ERRCODE = 'invalid_parameter_value', HINT = 'apellidos_en_pareja';
  END IF;
  -- Los hermanos, también en pareja: el total (contando al niño) y el lugar que ocupa (1, el mayor).
  IF (p_hermanos_total IS NULL) <> (p_hermanos_lugar IS NULL) THEN
    RAISE EXCEPTION 'el total de hermanos y el lugar van juntos'
      USING ERRCODE = 'invalid_parameter_value', HINT = 'hermanos';
  END IF;
  IF p_como_nos_conocio IS NULL AND p_como_nos_conocio_otro IS NOT NULL THEN
    RAISE EXCEPTION 'el texto de «otro» llega con la respuesta'
      USING ERRCODE = 'invalid_parameter_value', HINT = 'como_nos_conocio';
  END IF;

  -- La puerta (20270113120000): con el alta validada, los ocho campos que IDENTIFICAN al niño no se
  -- cambian aquí, van a la cola de Dirección (cambios_pendientes, entidad 'ninos_identidad'). Se
  -- compara con lo guardado usando las MISMAS expresiones que el UPDATE de abajo: mandar el mismo
  -- valor no es un cambio, así que guardar el paso sin tocar nada no falla. Los otros seis (idioma,
  -- hermanos, observaciones, cómo nos conoció) siguen directos. Decidido por el responsable el
  -- 2026-11-07: cambiar el nombre o el DNI necesita a Dirección; el número de hermanos, no.
  IF public.alta_validada_de_nino(p_nino_id) THEN
    SELECT n.* INTO v_actual FROM public.ninos n WHERE n.id = p_nino_id;
    IF (p_nombre IS NOT NULL AND p_nombre IS DISTINCT FROM v_actual.nombre)
       OR (p_primer_apellido IS NOT NULL
           AND (btrim(p_primer_apellido) IS DISTINCT FROM v_actual.primer_apellido
                OR NULLIF(btrim(p_segundo_apellido), '') IS DISTINCT FROM v_actual.segundo_apellido))
       OR (p_fecha_nacimiento IS NOT NULL AND p_fecha_nacimiento IS DISTINCT FROM v_actual.fecha_nacimiento)
       OR (p_sexo IS NOT NULL AND p_sexo IS DISTINCT FROM v_actual.sexo)
       OR (p_nacionalidad IS NOT NULL AND p_nacionalidad IS DISTINCT FROM v_actual.nacionalidad)
       OR (p_lugar_nacimiento IS NOT NULL
           AND NULLIF(btrim(p_lugar_nacimiento), '') IS DISTINCT FROM v_actual.lugar_nacimiento)
       OR (p_dni IS NOT NULL
           AND NULLIF(upper(regexp_replace(p_dni, '[[:space:].-]', '', 'g')), '') IS DISTINCT FROM v_actual.dni)
       -- Fase 7: la tarjeta sanitaria identifica al niño como el DNI: con el alta validada, a la cola.
       OR (p_sip IS NOT NULL AND privado.sip_normalizado(p_sip) IS DISTINCT FROM v_actual.sip) THEN
      RAISE EXCEPTION 'alta validada: el cambio de identidad va a la cola de validacion'
        USING ERRCODE = 'insufficient_privilege', HINT = 'cola_validacion';
    END IF;
  END IF;

  -- Los campos nuevos (5a), con el contrato del setter médico: NULL deja lo que hay y vacío lo
  -- borra. El DNI se guarda sin espacios, puntos ni guiones, en mayúsculas; el CHECK mira la letra.
  UPDATE public.ninos SET
    nombre           = COALESCE(p_nombre, nombre),
    primer_apellido  = CASE WHEN p_primer_apellido IS NULL THEN primer_apellido ELSE btrim(p_primer_apellido) END,
    segundo_apellido = CASE WHEN p_primer_apellido IS NULL THEN segundo_apellido
                            ELSE NULLIF(btrim(p_segundo_apellido), '') END,
    fecha_nacimiento = COALESCE(p_fecha_nacimiento, fecha_nacimiento),
    sexo             = COALESCE(p_sexo, sexo),
    nacionalidad     = COALESCE(p_nacionalidad, nacionalidad),
    idioma_principal = COALESCE(p_idioma_principal, idioma_principal),
    lugar_nacimiento = CASE WHEN p_lugar_nacimiento IS NULL THEN lugar_nacimiento
                            ELSE NULLIF(btrim(p_lugar_nacimiento), '') END,
    dni              = CASE WHEN p_dni IS NULL THEN dni
                            ELSE NULLIF(upper(regexp_replace(p_dni, '[[:space:].-]', '', 'g')), '') END,
    sip              = CASE WHEN p_sip IS NULL THEN sip ELSE privado.sip_normalizado(p_sip) END,
    hermanos_total   = COALESCE(p_hermanos_total, hermanos_total),
    hermanos_lugar   = COALESCE(p_hermanos_lugar, hermanos_lugar),
    observaciones_familia = CASE WHEN p_observaciones_familia IS NULL THEN observaciones_familia
                                 ELSE NULLIF(btrim(p_observaciones_familia), '') END,
    como_nos_conocio = CASE WHEN p_como_nos_conocio IS NULL THEN como_nos_conocio
                            ELSE NULLIF(btrim(p_como_nos_conocio), '') END,
    como_nos_conocio_otro = CASE WHEN p_como_nos_conocio IS NULL THEN como_nos_conocio_otro
                                 WHEN btrim(p_como_nos_conocio) = 'otro' THEN NULLIF(btrim(p_como_nos_conocio_otro), '')
                                 ELSE NULL END
  WHERE id = p_nino_id
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.actualizar_identidad_nino_tutor(uuid,text,text,date,public.nino_sexo,text,text,text,text,text,integer,integer,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.actualizar_identidad_nino_tutor(uuid,text,text,date,public.nino_sexo,text,text,text,text,text,integer,integer,text,text,text,text) TO authenticated, service_role;

-- ---- 4. La imagen: del tutor legal o de la Dirección ----
-- Como `fijar_libro_familia_nino`, con el HINT de la cola y «la misma ruta no es un cambio».
-- Devuelve la ruta anterior: la borra quien llama, cuando ya no la usa nadie.
CREATE FUNCTION public.fijar_sip_documento_nino(p_nino_id uuid, p_path text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_centro uuid;
  v_admin boolean;
  v_anterior text;
BEGIN
  SELECT centro_id, sip_documento_path INTO v_centro, v_anterior
    FROM public.ninos
   WHERE id = p_nino_id AND deleted_at IS NULL;
  IF v_centro IS NULL OR auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_admin := public.es_admin(v_centro);
  IF NOT (v_admin OR public.es_tutor_legal_de(p_nino_id)) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF p_path IS NULL
     OR p_path !~ ('^' || v_centro::text || '/' || p_nino_id::text || '/[A-Za-z0-9_-]+\.pdf$') THEN
    RAISE EXCEPTION 'la ruta de la tarjeta sanitaria no es del nino'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_path IS NOT DISTINCT FROM v_anterior THEN
    RETURN v_anterior;
  END IF;

  IF NOT v_admin AND public.alta_validada_de_nino(p_nino_id) THEN
    RAISE EXCEPTION 'alta validada: el cambio va a la cola de validacion'
      USING ERRCODE = 'insufficient_privilege', HINT = 'cola_validacion';
  END IF;

  UPDATE public.ninos
     SET sip_documento_path = p_path
   WHERE id = p_nino_id AND deleted_at IS NULL;

  RETURN v_anterior;
END;
$function$;
REVOKE ALL ON FUNCTION public.fijar_sip_documento_nino(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fijar_sip_documento_nino(uuid, text) TO authenticated, service_role;

-- ---- 5. La lectura ----
-- El número: Dirección del centro, tutor legal y profe del niño (puede ser ella quien lo lleve al
-- centro de salud). La ruta de la imagen, solo a Dirección y tutor legal: a la profe le llega NULL
-- con `ve_documento` false, para que la pantalla no diga «no hay imagen» cuando es «no la ves».
-- Las filas que no le tocan a quien llama no vienen (el autorizado no recibe ninguna).
CREATE FUNCTION public.sip_de_ninos(p_nino_ids uuid[])
 RETURNS TABLE (nino_id uuid, sip text, sip_documento_path text, ve_documento boolean)
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT n.id, n.sip,
         CASE WHEN g.gestiona THEN n.sip_documento_path END,
         g.gestiona
    FROM public.ninos n
   CROSS JOIN LATERAL (SELECT public.es_admin(n.centro_id) OR public.es_tutor_legal_de(n.id) AS gestiona) g
   WHERE n.id = ANY (p_nino_ids)
     AND n.deleted_at IS NULL
     AND auth.uid() IS NOT NULL
     AND (g.gestiona OR public.es_profe_de_nino(n.id));
$function$;
REVOKE ALL ON FUNCTION public.sip_de_ninos(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sip_de_ninos(uuid[]) TO authenticated, service_role;

-- ---- 6. La cola: la imagen pendiente, con su ruta en la carpeta del niño ----
ALTER TABLE public.cambios_pendientes DROP CONSTRAINT cambios_pendientes_ruta_documento_del_nino;
ALTER TABLE public.cambios_pendientes ADD CONSTRAINT cambios_pendientes_ruta_documento_del_nino CHECK (
  entidad <> ALL (ARRAY['ninos_libro_familia', 'datos_tutor_dni', 'ninos_sip_documento'])
  OR COALESCE(payload ->> 'path', '') ~ ('^' || centro_id::text || '/' || nino_id::text || '/[A-Za-z0-9_-]+\.pdf$'));

-- ---- 7. La purga ----
CREATE OR REPLACE FUNCTION privado.purgar_nino(p_nino_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lista uuid[];
BEGIN
  -- D-5: motivo 'purga_rgpd' → desarchivar_nino RAISE (no reincorpora un sujeto purgado).
  UPDATE public.ninos SET
    nombre           = '[borrado]',
    -- 5a: `apellidos` la deriva la base de los dos; se borran los dos.
    primer_apellido  = '[borrado]',
    segundo_apellido = NULL,
    fecha_nacimiento = DATE '1900-01-01',
    sexo             = NULL,
    nacionalidad     = NULL,
    foto_url         = NULL,
    notas_admin      = NULL,
    -- Purga RGPD del niño: el resto de columnas personales de la ficha. idioma_principal
    -- es NOT NULL: 'zz' (no es un idioma, como en idiomas_casa) en vez de inventar 'es'. El
    -- CHECK solo admite 'zz' con deleted_reason = 'purga_rgpd', que pone este mismo UPDATE.
    idioma_principal     = 'zz',
    direccion_calle      = NULL,
    direccion_numero     = NULL,
    direccion_cp         = NULL,
    direccion_ciudad     = NULL,
    libro_familia_path   = NULL,
    estado_civil_familia = NULL,
    -- 5a: los campos nuevos de la ficha.
    lugar_nacimiento      = NULL,
    dni                   = NULL,
    hermanos_total        = NULL,
    hermanos_lugar        = NULL,
    direccion_provincia   = NULL,
    observaciones_familia = NULL,
    como_nos_conocio      = NULL,
    como_nos_conocio_otro = NULL,
    -- Fase 7: la tarjeta sanitaria, el número y la ruta de la imagen. El objeto del bucket
    -- `sip-ninos` lo borra antes el manifiesto de adjuntos, como el libro de familia.
    sip                   = NULL,
    sip_documento_path    = NULL,
    deleted_reason   = 'purga_rgpd',
    deleted_at       = COALESCE(deleted_at, now()),
    -- Retención (PR-7): desde cuándo está bloqueado lo que se conserva.
    purgado_en       = COALESCE(purgado_en, now())
  WHERE id = p_nino_id;

  UPDATE public.info_medica_emergencia SET
    alergias_graves     = NULL,
    notas_emergencia    = NULL,
    medicacion_habitual = NULL,
    alergias_leves      = NULL,
    medico_familia      = NULL,
    telefono_emergencia = NULL
  WHERE nino_id = p_nino_id;

  UPDATE public.datos_pedagogicos_nino SET
    lactancia_observaciones          = NULL,
    control_esfinteres_observaciones = NULL,
    siesta_horario_habitual          = NULL,
    siesta_observaciones             = NULL,
    alimentacion_observaciones       = CASE WHEN tipo_alimentacion = 'otra'
                                            THEN '[borrado]' ELSE NULL END,
    -- Purga RGPD del niño: el CHECK exige de 1 a 8 códigos de 2 letras; 'zz' no es un idioma.
    idiomas_casa                     = ARRAY['zz'],
    deleted_at                       = COALESCE(deleted_at, now())
  WHERE nino_id = p_nino_id;

  -- Purga RGPD del niño: el motivo de baja es texto libre del centro sobre el niño.
  UPDATE public.matriculas SET motivo_baja = NULL
  WHERE nino_id = p_nino_id AND motivo_baja IS NOT NULL;

  -- D-5: motivo 'purga_rgpd' → desarchivar_nino NUNCA revive un vínculo purgado.
  UPDATE public.vinculos_familiares SET
    descripcion_parentesco = NULL,
    deleted_reason         = 'purga_rgpd',
    deleted_at             = COALESCE(deleted_at, now())
  WHERE nino_id = p_nino_id;

  DELETE FROM public.media m
  WHERE EXISTS (
          SELECT 1 FROM public.media_etiquetas e
          WHERE e.media_id = m.id AND e.nino_id = p_nino_id)
    AND NOT EXISTS (
          SELECT 1 FROM public.media_etiquetas e2
          WHERE e2.media_id = m.id AND e2.nino_id <> p_nino_id);
  DELETE FROM public.media_etiquetas WHERE nino_id = p_nino_id;

  -- Cierre de la purga: los cambios pendientes del niño (su dirección, su libro de familia,
  -- los datos de sus tutores) se borran; el payload no entra en audit_log, solo la tabla lo
  -- guarda. Los documentos en Storage los borra antes el manifiesto de adjuntos.
  DELETE FROM public.cambios_pendientes WHERE nino_id = p_nino_id;

  -- Retención (F11-B, punto 6, PR-4): su operativa (agenda, asistencia, mensajes, informes,
  -- citas, recordatorios, respuestas a eventos) se borra, con sus copias en audit_log.
  PERFORM privado.olvido_borrar_operativa_nino(p_nino_id);

  -- Purga RGPD del niño: la copia en audit_log, con la lista de claves personales por tabla
  -- (_claves_pii_nino).
  PERFORM public._redactar_auditoria_nino(p_nino_id);

  -- Purga de lista_espera: el prospecto del niño se borra entero (la plaza no tiene sentido
  -- sin el niño). Su copia en audit_log se redacta por registro_id: así se alcanza también el
  -- INSERT, que nace con nino_id NULL, y el DELETE que acaba de escribir esta purga.
  WITH borrados AS (
    DELETE FROM public.lista_espera WHERE nino_id = p_nino_id RETURNING id
  )
  SELECT array_agg(id) INTO v_lista FROM borrados;
  UPDATE public.audit_log SET
    valores_antes   = public._redactar_jsonb(valores_antes,   public._claves_pii_nino('lista_espera')),
    valores_despues = public._redactar_jsonb(valores_despues, public._claves_pii_nino('lista_espera'))
  WHERE tabla = 'lista_espera' AND registro_id = ANY (v_lista);

END;
$function$;

CREATE OR REPLACE FUNCTION public._claves_pii_nino(p_tabla text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT ARRAY[
    'nombre', 'apellidos', 'fecha_nacimiento', 'sexo', 'nacionalidad', 'foto_url', 'notas_admin',
    'alergias_graves', 'notas_emergencia', 'medicacion_habitual', 'alergias_leves',
    'medico_familia', 'telefono_emergencia',
    'ip_address', 'user_agent', 'descripcion_parentesco', 'nombre_externo', 'observaciones',
    'observaciones_generales', 'contenido', 'nombre_tecleado'
  ]::text[] || CASE p_tabla
    WHEN 'ninos' THEN ARRAY['idioma_principal', 'direccion_calle', 'direccion_numero', 'direccion_cp',
                            'direccion_ciudad', 'libro_familia_path', 'estado_civil_familia',
                            'primer_apellido', 'segundo_apellido', 'lugar_nacimiento', 'dni',
                            'hermanos_total', 'hermanos_lugar', 'direccion_provincia',
                            'observaciones_familia', 'como_nos_conocio', 'como_nos_conocio_otro',
                            'sip', 'sip_documento_path']
    WHEN 'datos_pedagogicos_nino' THEN ARRAY['lactancia_observaciones', 'control_esfinteres_observaciones',
                            'siesta_horario_habitual', 'siesta_observaciones',
                            'alimentacion_observaciones', 'idiomas_casa']
    WHEN 'matriculas' THEN ARRAY['motivo_baja']
    WHEN 'firmas_autorizacion' THEN ARRAY['firma_imagen', 'comentario', 'datos']
    WHEN 'firmas_documentos_centro' THEN ARRAY['firma_imagen']
    WHEN 'autorizaciones' THEN ARRAY['titulo', 'texto', 'datos']
    WHEN 'cita_invitados' THEN ARRAY['comentario']
    WHEN 'lista_espera' THEN ARRAY['nombre_nino', 'apellidos_nino', 'primer_apellido_nino',
                                   'segundo_apellido_nino', 'telefono_tutor', 'email_tutor', 'nota']
    ELSE ARRAY[]::text[]
  END;
$function$;

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_src text;
  v_n int;
BEGIN
  -- Las columnas nuevas, cerradas para la sesión; `dni`, el control, también.
  IF has_column_privilege('authenticated', 'public.ninos', 'sip', 'SELECT')
     OR has_column_privilege('authenticated', 'public.ninos', 'sip_documento_path', 'SELECT') THEN
    RAISE EXCEPTION 'la sesión lee la tarjeta sanitaria de la tabla';
  END IF;
  -- Funciones: SECURITY DEFINER (las de la sesión), nada para anon, la sesión las ejecuta.
  SELECT count(*) INTO v_n FROM pg_proc p
   WHERE p.oid IN ('public.actualizar_identidad_nino_tutor(uuid,text,text,date,public.nino_sexo,text,text,text,text,text,integer,integer,text,text,text,text)'::regprocedure,
                   'public.fijar_sip_documento_nino(uuid,text)'::regprocedure,
                   'public.sip_de_ninos(uuid[])'::regprocedure)
     AND p.prosecdef
     AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
     AND has_function_privilege('authenticated', p.oid, 'EXECUTE');
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'funciones de la tarjeta: % de 3 con la forma esperada', v_n;
  END IF;
  IF to_regprocedure('public.actualizar_identidad_nino_tutor(uuid,text,text,date,public.nino_sexo,text,text,text,text,text,integer,integer,text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'sigue la firma vieja de actualizar_identidad_nino_tutor';
  END IF;
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = 'public.actualizar_identidad_nino_tutor(uuid,text,text,date,public.nino_sexo,text,text,text,text,text,integer,integer,text,text,text,text)'::regprocedure;
  IF v_src NOT LIKE '%OR (p_sip IS NOT NULL AND privado.sip_normalizado(p_sip) IS DISTINCT FROM v_actual.sip) THEN%'
     OR v_src NOT LIKE '%HINT = ''cola_validacion''%' THEN
    RAISE EXCEPTION 'actualizar_identidad_nino_tutor no manda la tarjeta a la cola';
  END IF;
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = 'privado.purgar_nino(uuid)'::regprocedure;
  IF v_src NOT LIKE '%sip                   = NULL,%' OR v_src NOT LIKE '%sip_documento_path    = NULL,%' THEN
    RAISE EXCEPTION 'privado.purgar_nino no borra la tarjeta sanitaria';
  END IF;
  IF NOT (public._claves_pii_nino('ninos') @> ARRAY['sip', 'sip_documento_path', 'dni']) THEN
    RAISE EXCEPTION '_claves_pii_nino no conoce la tarjeta sanitaria';
  END IF;
  SELECT count(*) INTO v_n FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname IN ('sip_ninos_select', 'sip_ninos_insert', 'sip_ninos_update', 'sip_ninos_delete');
  IF v_n <> 4 OR NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'sip-ninos' AND NOT public) THEN
    RAISE EXCEPTION 'el bucket sip-ninos no está como debe (% políticas)', v_n;
  END IF;
  SELECT pg_get_triggerdef(oid) INTO v_src FROM pg_trigger WHERE tgrelid = 'public.ninos'::regclass AND tgname = 'ninos_validar_rutas_trg';
  IF v_src NOT LIKE '%sip_documento_path%' THEN
    RAISE EXCEPTION 'el trigger de rutas no mira la imagen de la tarjeta';
  END IF;
  RAISE NOTICE 'guarda posterior: columnas cerradas, 3 funciones, purga y claves, bucket con 4 políticas, trigger';
END;
$guarda$;
