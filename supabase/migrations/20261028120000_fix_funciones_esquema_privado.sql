-- =============================================================================
-- FIX — Las funciones auxiliares de las policies, fuera de la API (PR 2b, Fase 4)
-- -----------------------------------------------------------------------------
-- 25 funciones de `public` traducen un id en otro sin mirar quién pregunta: `centro_de_nino`,
-- `centro_de_familia`, `autor_de_publicacion`, `organizador_de_cita`, `ruta_coherente`… Las usan
-- 97 policies (69 de tablas y las 28 de Storage), así que `authenticated` necesita EXECUTE. Y
-- como están en `public`, PostgREST las publica: cualquier usuario con sesión las llama por RPC
-- con ids de otro centro y sabe a qué centro pertenece un niño, una familia o un aula, quién
-- escribió una publicación o si una ruta de Storage es de un centro.
--
-- No se les puede poner la comprobación dentro (como a las del PR 2a, 20261026120000): un
-- `centro_de_*` que devolviera NULL a quien es de fuera abriría en vez de cerrar, porque
-- `es_admin(NULL)` es TRUE para cualquier admin y hay policies `es_admin(centro_de_X(...))`.
--
-- Arreglo: se mueven a un esquema que la API no expone, `privado` (precedente: `vigia`,
-- 20261012120000). PostgREST solo publica `public` y `graphql_public` (config.toml y
-- producción), y en producción no hay pg_graphql.
--   · `ALTER FUNCTION … SET SCHEMA` conserva el oid, los permisos y el dueño: las 97 policies
--     siguen a la función por su oid y no se tocan.
--   · Los cuerpos que las llaman por su nombre sí hay que recrearlos: 40 funciones (triggers que
--     derivan el `centro_id`, la auditoría, RPCs SECURITY DEFINER) y 2 de las 25 que se llaman
--     entre ellas. Son las definiciones vivas de producción con `public.X(` cambiado por
--     `privado.X(` y nada más (64 llamadas).
--   · `authenticated` y `service_role` conservan USAGE en el esquema y EXECUTE en las funciones:
--     las policies se evalúan con el rol de quien consulta, y tres triggers son de invocador
--     (`anuncios_validar_aula_centro`, `invitaciones_validar_centro`, `media_validar_ruta`). La
--     protección es que la API no llega al esquema. `privado` NO se añade nunca a los esquemas
--     expuestos de la API.
--   · Se quedan en `public` las 4 de reloj y puras (`hoy_madrid`, `dentro_de_ventana_edicion`,
--     `_redactar_jsonb`, `idiomas_iso_2letras`): no leen ninguna tabla, no dicen nada de nadie.
--
-- Demostrado contra la BD efímera del CI: `funciones-esquema-privado.rls.test.ts`.
--
-- Estado verificado en producción el 2026-10-20 (read_only): las 25 y los 40 cuerpos que las
-- llaman son los de esta migración (md5 normalizado, guarda previa), no hay más llamadores en
-- ningún esquema, y lo único que depende de las 25 son las 97 policies.
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor. Tras aplicar:
-- registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
-- Firmas como `esquema.nombre(tipos)`, escritas a mano para no depender del search_path.
DO $guarda$
DECLARE
  v_nombres constant text[] := ARRAY['aula_de_publicacion', 'autor_de_publicacion', 'autorizacion_aplica_a_nino', 'autorizacion_firmable', 'autorizacion_plantilla_valida', 'centro_de_agenda', 'centro_de_aula', 'centro_de_cita', 'centro_de_concepto', 'centro_de_evento', 'centro_de_familia', 'centro_de_nino', 'centro_de_plantilla', 'centro_de_publicacion', 'centro_de_recibo', 'conversacion_activa', 'evento_aplica_a_nino', 'familia_de_recibo', 'fecha_de_agenda', 'medicacion_administrable_hoy', 'nino_de_agenda', 'nino_puede_aparecer', 'organizador_de_cita', 'publicacion_de_media', 'ruta_coherente'];
  v_re text;
  v_mueven constant jsonb := '{
    "public.aula_de_publicacion(uuid)": "4646f6a17be297f95d90fb14018b4d7a",
    "public.autor_de_publicacion(uuid)": "9b083eeac15a27525c3568f167ade330",
    "public.autorizacion_aplica_a_nino(uuid,uuid)": "1c5fa34fa22f5edff4508aee091a7da1",
    "public.autorizacion_firmable(uuid)": "e981e072796a0b4fd51ac0ff7d6fde45",
    "public.autorizacion_plantilla_valida(uuid,uuid,tipo_autorizacion)": "8f06d18c112a4d0257548607f6210496",
    "public.centro_de_agenda(uuid)": "7b2f43c954887692a4691255e34d6227",
    "public.centro_de_aula(uuid)": "131b28282d462284256c2a580ca29b61",
    "public.centro_de_cita(uuid)": "6299edf85b9ce158f12de4756e4f1558",
    "public.centro_de_concepto(uuid)": "d27d8fb3535f6783381ab4f747b4ed7e",
    "public.centro_de_evento(uuid)": "a1fc4c2f2d7c385fffd92dab0519fe43",
    "public.centro_de_familia(uuid)": "7ee913ee666cc0c67708d5185a0566a5",
    "public.centro_de_nino(uuid)": "7b5b55363325e117e858ab793b227073",
    "public.centro_de_plantilla(uuid)": "56becb3cc6d009e87b0ba797516e2f4b",
    "public.centro_de_publicacion(uuid)": "46d6505d1bd8dcbfcb2d99487513be60",
    "public.centro_de_recibo(uuid)": "b8429d7bda90b3a4c555df175b645d2d",
    "public.conversacion_activa(uuid)": "9abd60527d2630c7042a62f91ca85f1c",
    "public.evento_aplica_a_nino(uuid,uuid)": "0d54053e777ce21b699457328b06ebee",
    "public.familia_de_recibo(uuid)": "3dd4c22cc24382664aedd72cd20208b1",
    "public.fecha_de_agenda(uuid)": "f16c94fcdb70377cd84e6d5a294bd72c",
    "public.medicacion_administrable_hoy(uuid)": "336d9aa6eb2cc9aea2bce4495e8cd3df",
    "public.nino_de_agenda(uuid)": "5cfb86b6b0f86dfbd60765a419667a32",
    "public.nino_puede_aparecer(uuid)": "79ca48c1b10f05f0b0663d9ffc253ea1",
    "public.organizador_de_cita(uuid)": "05c15cfc403a7dbeaa22aa56acf588ff",
    "public.publicacion_de_media(uuid)": "7b93037f3467d1278f6929f3f2f420a9",
    "public.ruta_coherente(text,text)": "1db95dcc6ddbbbb538c80a0a185a5cfe"
  }'::jsonb;
  v_llaman constant jsonb := '{
    "public.actualizar_foto_nino_tutor(uuid,text)": "6a069cf649926a075d6cc15b84d645ad",
    "public.anuncios_validar_aula_centro()": "ce77401597cac1f6c61a2631860508ac",
    "public.audit_trigger_function()": "b57dbad3181013f3dc39a94e1ee0d244",
    "public.aulas_curso_set_centro_id()": "757a413c0e46ea97fc13bec86e4807dd",
    "public.autorizaciones_set_centro_id()": "bc0f409479e57cfefdd3de9fb8e4222c",
    "public.cita_invitados_set_centro_id()": "55e2df1adb5b0850bc5e259d5fbc5af2",
    "public.citas_set_centro_id()": "ba6fe043237e3a101b45e75e2726872e",
    "public.congelar_si_mes_cerrado()": "bcbed4a9e554ed6a12270f677789f553",
    "public.conversaciones_set_centro_id()": "3206799bfb3eaa340e7c718415da274e",
    "public.crear_recibo_esporadico(uuid,uuid,uuid,integer,integer,text,text,jsonb)": "b1e48644060a4dafab4f401fa46203ec",
    "public.derivar_centro_id_de_familia()": "7a92effadbebfce22fae3f97a4407dbd",
    "public.derivar_centro_id_de_mandato_sepa()": "dacfa0aeaf18bc87ebba4fad9c3b9b76",
    "public.derivar_centro_id_de_nino()": "05eff7b11cee7381f831cf09031838c3",
    "public.derivar_centro_id_de_recibo()": "91c5c8ab0e984022a8ad87d3da2904a1",
    "public.derivar_centro_id_de_recibo_familia()": "e071b53a8e8f0a07a6529469c3ad192d",
    "public.derivar_centro_id_nino_o_familia()": "37a3055079cc48fabe32f76cfe78fafa",
    "public.es_profe_de_aula(uuid)": "3cf84e35cd5c60c9dc3f20b86baead38",
    "public.es_redactor_de_aula(uuid)": "11511ed979180e14a3837e9f11468d21",
    "public.eventos_set_centro_id()": "880fa6e0a7dd6df57b3da713728d0a52",
    "public.existe_consentimiento_imagen(uuid)": "df41ce5d89c8247c77e58056bf9a707d",
    "public.export_datos_sujeto(text,uuid)": "f39ffed99f5d2cbc895d27b09a8ac14e",
    "public.familia_tutores_derivar_centro()": "5f7fe1fbf9661f8b64e2a93c2b8d0f7d",
    "public.firma_imagen_sync()": "f95e602a1f3d00a239a5724817c8f605",
    "public.get_motivos_baja_matriculas(uuid[])": "4dfc8c65ecde0c408254a47b2bcbebf3",
    "public.invitaciones_validar_centro()": "24caec91f1465d1e3e284cb6953ba2e3",
    "public.marcar_matricula_lista(uuid)": "9240db5c6bb243dc6c89ebf09a2a3c53",
    "public.media_etiquetas_set_centro_id()": "4d39ba0b21b55b52410f0b0eb623be7f",
    "public.media_set_centro_id()": "b3f6967b5ec6c58d622e8047cdcf73bf",
    "public.media_validar_ruta()": "5efb2d33a9214143ebcd59391b3821fd",
    "public.nino_toma_comida_solida(uuid)": "5f63c69a9075b13c3ce839869e1cb623",
    "public.otorgar_consentimiento_imagen(uuid,uuid,text,inet,text,firma_metodo)": "3878fc4a788622a55e8b7033b358c1a0",
    "public.promover_a_titular(uuid)": "88daebc95a25454b04c4e71b90e54eda",
    "public.publicaciones_set_centro_id()": "8951363adee148b49c0907b6b72f1063",
    "public.recordatorios_set_centro_id()": "f193fe0d3ea4ab2c2813d16a55c8c145",
    "public.registrar_mandato_sepa(uuid,uuid,text,text,text,text,text,text,text,inet,text,timestamp with time zone,firma_metodo)": "1d9cee233ba929332495edbe4fdd3d3c",
    "public.revocar_consentimiento_imagen(uuid)": "b0f8fd058d486044c43a8fc6431c0e1a",
    "public.set_info_medica_emergencia_cifrada_tutor(uuid,text,text,text,text,text,text,boolean)": "13ec256d9bb73af8026639f1cb07e7c5",
    "public.sustituir_mandato_sepa(uuid,uuid,text,text,text,text,text,text,text,inet,text,timestamp with time zone,firma_metodo)": "16e9538da78117638f2bac660f740e28",
    "public.usuario_es_audiencia_anuncio(uuid)": "385f66a127b691601a25e3197e48cdc7",
    "public.usuario_es_audiencia_anuncio_row(uuid,uuid,ambito_anuncio,uuid)": "4cce97a10c9bce3465de5b573989a0e4"
  }'::jsonb;
  v_mal text;
  v_pol int;
BEGIN
  v_re := '\m(' || array_to_string(v_nombres, '|') || ')\s*\(';

  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'privado') THEN
    RAISE EXCEPTION 'el esquema privado ya existe';
  END IF;

  -- Las 25, una firma cada una, con el cuerpo del repo.
  SELECT string_agg(coalesce(e.key, a.sig) || '=' || coalesce(a.md5, 'falta'), ', ')
    INTO v_mal
    FROM (SELECT 'public.' || p.proname || substr(p.oid::regprocedure::text, strpos(p.oid::regprocedure::text, '(')) AS sig,
                 md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')) AS md5
            FROM pg_proc p
           WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY (v_nombres)) a
    FULL JOIN jsonb_each_text(v_mueven) e ON e.key = a.sig
   WHERE a.md5 IS DISTINCT FROM e.value;
  IF v_mal IS NOT NULL THEN
    RAISE EXCEPTION 'las 25 no son las esperadas: %', v_mal;
  END IF;

  -- Quien las llama por su nombre, en cualquier esquema: exactamente los 40 que se recrean. Uno
  -- más sin recrear se quedaría llamando a una función que ya no está en public.
  SELECT string_agg(coalesce(e.key, a.sig) || '=' || coalesce(a.md5, 'falta'), ', ')
    INTO v_mal
    FROM (SELECT n.nspname || '.' || p.proname || substr(p.oid::regprocedure::text, strpos(p.oid::regprocedure::text, '(')) AS sig,
                 md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')) AS md5
            FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
             AND p.oid NOT IN (SELECT objid FROM pg_depend WHERE deptype = 'e')
             AND NOT (n.nspname = 'public' AND p.proname = ANY (v_nombres))
             AND p.prosrc ~ v_re) a
    FULL JOIN jsonb_each_text(v_llaman) e ON e.key = a.sig
   WHERE a.md5 IS DISTINCT FROM e.value;
  IF v_mal IS NOT NULL THEN
    RAISE EXCEPTION 'los que las llaman no son los 40 esperados: %', v_mal;
  END IF;

  SELECT count(DISTINCT d.objid) INTO v_pol
    FROM pg_depend d JOIN pg_proc p ON p.oid = d.refobjid
   WHERE d.classid = 'pg_policy'::regclass
     AND p.pronamespace = 'public'::regnamespace AND p.proname = ANY (v_nombres);
  RAISE NOTICE 'guarda previa: 25 funciones y 40 llamadores como en el repo; policies que las usan: %', v_pol;
END $guarda$;

-- ---- Foto previa, para la guarda posterior ----
CREATE TEMP TABLE _privado_antes AS
SELECT p.oid, p.proname, (p.proname = ANY (ARRAY['aula_de_publicacion', 'autor_de_publicacion', 'autorizacion_aplica_a_nino', 'autorizacion_firmable', 'autorizacion_plantilla_valida', 'centro_de_agenda', 'centro_de_aula', 'centro_de_cita', 'centro_de_concepto', 'centro_de_evento', 'centro_de_familia', 'centro_de_nino', 'centro_de_plantilla', 'centro_de_publicacion', 'centro_de_recibo', 'conversacion_activa', 'evento_aplica_a_nino', 'familia_de_recibo', 'fecha_de_agenda', 'medicacion_administrable_hoy', 'nino_de_agenda', 'nino_puede_aparecer', 'organizador_de_cita', 'publicacion_de_media', 'ruta_coherente'])) AS mueve,
       p.prosecdef, p.proowner, array_to_string(p.proconfig, ',') AS cfg, array_to_string(p.proacl, ',') AS acl
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND (p.proname = ANY (ARRAY['aula_de_publicacion', 'autor_de_publicacion', 'autorizacion_aplica_a_nino', 'autorizacion_firmable', 'autorizacion_plantilla_valida', 'centro_de_agenda', 'centro_de_aula', 'centro_de_cita', 'centro_de_concepto', 'centro_de_evento', 'centro_de_familia', 'centro_de_nino', 'centro_de_plantilla', 'centro_de_publicacion', 'centro_de_recibo', 'conversacion_activa', 'evento_aplica_a_nino', 'familia_de_recibo', 'fecha_de_agenda', 'medicacion_administrable_hoy', 'nino_de_agenda', 'nino_puede_aparecer', 'organizador_de_cita', 'publicacion_de_media', 'ruta_coherente'])
        OR p.prosrc ~ ('\m(' || array_to_string(ARRAY['aula_de_publicacion', 'autor_de_publicacion', 'autorizacion_aplica_a_nino', 'autorizacion_firmable', 'autorizacion_plantilla_valida', 'centro_de_agenda', 'centro_de_aula', 'centro_de_cita', 'centro_de_concepto', 'centro_de_evento', 'centro_de_familia', 'centro_de_nino', 'centro_de_plantilla', 'centro_de_publicacion', 'centro_de_recibo', 'conversacion_activa', 'evento_aplica_a_nino', 'familia_de_recibo', 'fecha_de_agenda', 'medicacion_administrable_hoy', 'nino_de_agenda', 'nino_puede_aparecer', 'organizador_de_cita', 'publicacion_de_media', 'ruta_coherente'], '|') || ')\s*\('));

CREATE TEMP TABLE _privado_policies_antes AS
SELECT DISTINCT d.objid, d.refobjid
  FROM pg_depend d JOIN _privado_antes a ON a.oid = d.refobjid AND a.mueve
 WHERE d.classid = 'pg_policy'::regclass;

-- ---- El esquema ----
CREATE SCHEMA privado;
REVOKE ALL ON SCHEMA privado FROM PUBLIC;
GRANT USAGE ON SCHEMA privado TO authenticated, service_role;
COMMENT ON SCHEMA privado IS
  'Funciones auxiliares de las policies (PR 2b, Fase 4). La API no expone este esquema: no añadirlo nunca a los esquemas expuestos.';

-- ---- Las 25 ----
ALTER FUNCTION public.aula_de_publicacion(uuid) SET SCHEMA privado;
ALTER FUNCTION public.autor_de_publicacion(uuid) SET SCHEMA privado;
ALTER FUNCTION public.autorizacion_aplica_a_nino(uuid,uuid) SET SCHEMA privado;
ALTER FUNCTION public.autorizacion_firmable(uuid) SET SCHEMA privado;
ALTER FUNCTION public.autorizacion_plantilla_valida(uuid,uuid,tipo_autorizacion) SET SCHEMA privado;
ALTER FUNCTION public.centro_de_agenda(uuid) SET SCHEMA privado;
ALTER FUNCTION public.centro_de_aula(uuid) SET SCHEMA privado;
ALTER FUNCTION public.centro_de_cita(uuid) SET SCHEMA privado;
ALTER FUNCTION public.centro_de_concepto(uuid) SET SCHEMA privado;
ALTER FUNCTION public.centro_de_evento(uuid) SET SCHEMA privado;
ALTER FUNCTION public.centro_de_familia(uuid) SET SCHEMA privado;
ALTER FUNCTION public.centro_de_nino(uuid) SET SCHEMA privado;
ALTER FUNCTION public.centro_de_plantilla(uuid) SET SCHEMA privado;
ALTER FUNCTION public.centro_de_publicacion(uuid) SET SCHEMA privado;
ALTER FUNCTION public.centro_de_recibo(uuid) SET SCHEMA privado;
ALTER FUNCTION public.conversacion_activa(uuid) SET SCHEMA privado;
ALTER FUNCTION public.evento_aplica_a_nino(uuid,uuid) SET SCHEMA privado;
ALTER FUNCTION public.familia_de_recibo(uuid) SET SCHEMA privado;
ALTER FUNCTION public.fecha_de_agenda(uuid) SET SCHEMA privado;
ALTER FUNCTION public.medicacion_administrable_hoy(uuid) SET SCHEMA privado;
ALTER FUNCTION public.nino_de_agenda(uuid) SET SCHEMA privado;
ALTER FUNCTION public.nino_puede_aparecer(uuid) SET SCHEMA privado;
ALTER FUNCTION public.organizador_de_cita(uuid) SET SCHEMA privado;
ALTER FUNCTION public.publicacion_de_media(uuid) SET SCHEMA privado;
ALTER FUNCTION public.ruta_coherente(text,text) SET SCHEMA privado;

-- ---- Los cuerpos que las llaman ----
-- privado.autorizacion_aplica_a_nino(uuid,uuid): 1 llamada
CREATE OR REPLACE FUNCTION privado.autorizacion_aplica_a_nino(p_autorizacion_id uuid, p_nino_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE a public.autorizaciones%ROWTYPE;
BEGIN
  SELECT * INTO a FROM public.autorizaciones WHERE id = p_autorizacion_id;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF a.es_plantilla THEN
    RETURN FALSE;  -- el catálogo no se firma; se firma la instancia (B2)
  END IF;
  IF a.tipo = 'salida' THEN
    RETURN privado.evento_aplica_a_nino(a.evento_id, p_nino_id);
  ELSIF a.ambito = 'aula' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.matriculas m
      WHERE m.nino_id = p_nino_id AND m.aula_id = a.aula_id
        AND m.fecha_baja IS NULL AND m.deleted_at IS NULL AND m.estado = 'activa'
    );
  ELSIF a.ambito = 'centro' THEN
    RETURN EXISTS (
      SELECT 1 FROM public.ninos n
      WHERE n.id = p_nino_id AND n.centro_id = a.centro_id AND n.deleted_at IS NULL
    );
  ELSE  -- ambito='nino' (A/B2) o legacy (ambito NULL, nino_id seteado)
    RETURN a.nino_id = p_nino_id;
  END IF;
END;
$function$;

-- privado.ruta_coherente(text,text): 4 llamadas
CREATE OR REPLACE FUNCTION privado.ruta_coherente(p_bucket text, p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Cada segmento se valida antes de convertirlo: un CASE fija el orden, un AND no.
  WITH r AS (
    SELECT (storage.foldername(p_name)) AS c,
           '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' AS uuid_re
  )
  SELECT CASE
    WHEN c[1] IS NULL OR c[2] IS NULL THEN false
    WHEN p_bucket = 'mandato-sepa' AND c[2] = 'familia' THEN
      CASE WHEN c[3] ~ uuid_re
           THEN coalesce(privado.centro_de_familia(c[3]::uuid)::text = lower(c[1]), false)
           ELSE false END
    WHEN p_bucket = 'aula-fotos' THEN
      CASE WHEN c[2] ~ uuid_re AND c[3] ~ uuid_re
           THEN coalesce(privado.centro_de_aula(c[2]::uuid)::text = lower(c[1])
                         AND privado.aula_de_publicacion(c[3]::uuid)::text = lower(c[2]), false)
           ELSE false END
    ELSE
      CASE WHEN c[2] ~ uuid_re
           THEN coalesce(privado.centro_de_nino(c[2]::uuid)::text = lower(c[1]), false)
           ELSE false END
  END
  FROM r;
$function$;

-- public.actualizar_foto_nino_tutor(uuid,text): 2 llamadas
CREATE OR REPLACE FUNCTION public.actualizar_foto_nino_tutor(p_nino_id uuid, p_foto_path text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_anterior text;
  v_n int;
BEGIN
  IF NOT (public.es_admin(privado.centro_de_nino(p_nino_id))
          OR public.es_tutor_legal_de(p_nino_id)) THEN
    RAISE EXCEPTION 'no autorizado a cambiar la foto de este nino'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- IU-3: gate de consentimiento de imagen POR-NIÑO. Sin consent vigente no hay foto de
  -- perfil (mismo flag derivado que el etiquetado). Va DESPUÉS del authz para no cambiar
  -- el 42501 del no-autorizado; aquí, ya autorizado pero sin consent → check_violation.
  IF NOT privado.nino_puede_aparecer(p_nino_id) THEN
    RAISE EXCEPTION 'el nino no tiene consentimiento de imagen vigente'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT foto_url INTO v_anterior
    FROM public.ninos
   WHERE id = p_nino_id AND deleted_at IS NULL;

  UPDATE public.ninos
     SET foto_url = p_foto_path
   WHERE id = p_nino_id
     AND deleted_at IS NULL
     -- Backstop: el path debe colgar de {centro_id}/{id}/ del propio niño.
     AND p_foto_path LIKE centro_id::text || '/' || id::text || '/%';

  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN
    RAISE EXCEPTION 'foto no actualizada (path o nino invalido)'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN v_anterior;
END;
$function$;

-- public.anuncios_validar_aula_centro(): 1 llamada
CREATE OR REPLACE FUNCTION public.anuncios_validar_aula_centro()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.aula_id IS NOT NULL
     AND privado.centro_de_aula(NEW.aula_id) IS DISTINCT FROM NEW.centro_id THEN
    RAISE EXCEPTION 'anuncios: el aula no pertenece al centro del anuncio'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

-- public.audit_trigger_function(): 6 llamadas
CREATE OR REPLACE FUNCTION public.audit_trigger_function()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_centro_id uuid;
  v_antes jsonb;
  v_despues jsonb;
  v_registro_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'centros' THEN
    v_centro_id := COALESCE((NEW).id, (OLD).id);
  ELSIF TG_TABLE_NAME = 'ninos' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'roles_usuario' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'dias_centro' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'plantillas_menu_mensual' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'menu_dia' THEN
    v_centro_id := privado.centro_de_plantilla(COALESCE((NEW).plantilla_id, (OLD).plantilla_id));
  ELSIF TG_TABLE_NAME = 'conversaciones' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'mensajes' THEN
    v_centro_id := public.centro_de_conversacion(COALESCE((NEW).conversacion_id, (OLD).conversacion_id));
  ELSIF TG_TABLE_NAME = 'anuncios' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'recordatorios' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'eventos' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'citas' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'cita_invitados' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'autorizaciones' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'firmas_autorizacion' THEN
    v_centro_id := privado.centro_de_nino(COALESCE((NEW).nino_id, (OLD).nino_id));
  ELSIF TG_TABLE_NAME = 'administraciones_medicacion' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'plantillas_informe' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'informes_evolucion' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'campanas_informe' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'publicaciones' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'media' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'media_etiquetas' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'aulas_curso' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'lista_espera' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  -- ── F-3-A: rollover_finaliza (centro_id directo) ─────────────────────────
  ELSIF TG_TABLE_NAME = 'rollover_finaliza' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  -- ── F-2a: familias (centro_id directo) ───────────────────────────────────
  ELSIF TG_TABLE_NAME = 'familias' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  -- ── F-2a: familia_tutores (centro derivado de la familia) ────────────────
  ELSIF TG_TABLE_NAME = 'familia_tutores' THEN
    v_centro_id := privado.centro_de_familia(COALESCE((NEW).familia_id, (OLD).familia_id));
  ELSIF TG_TABLE_NAME IN (
    'conceptos_cobro',
    'tipos_beca',
    'asignacion_concepto',
    'becas',
    'metodo_pago_familia',
    'parte_servicio_diario',
    'cierre_mensual',
    'recibos',
    'lineas_recibo',
    'remesas',
    'recibos_remesa',
    -- ── B2: beca comedor v2 (centro_id directo) ────────────────────────────
    'beca_comedor_elegibilidad',
    'beca_comedor_tramo',
    'beca_comedor_desborde',
    'beca_comedor_transferencia'
  ) THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME IN (
    'info_medica_emergencia',
    'vinculos_familiares',
    'matriculas',
    'datos_pedagogicos_nino',
    'asistencias',
    'ausencias'
  ) THEN
    SELECT n.centro_id INTO v_centro_id
    FROM public.ninos n
    WHERE n.id = COALESCE((NEW).nino_id, (OLD).nino_id);
  ELSIF TG_TABLE_NAME = 'agendas_diarias' THEN
    v_centro_id := privado.centro_de_nino(COALESCE((NEW).nino_id, (OLD).nino_id));
  ELSIF TG_TABLE_NAME IN ('comidas', 'biberones', 'suenos', 'deposiciones') THEN
    v_centro_id := privado.centro_de_agenda(COALESCE((NEW).agenda_id, (OLD).agenda_id));
  END IF;

  -- ── Grupo 1 (PR A): tablas auditadas desde 20261011120000 ────────────────
  -- profes_aulas no tiene centro_id: se deriva del aula. Si el aula ya no está (DELETE en
  -- cascada al borrar el aula), del curso. usuarios no es de un centro: centro_id NULL.
  IF TG_TABLE_NAME = 'profes_aulas' THEN
    v_centro_id := COALESCE(
      privado.centro_de_aula(COALESCE((NEW).aula_id, (OLD).aula_id)),
      (SELECT ca.centro_id FROM public.cursos_academicos ca
        WHERE ca.id = COALESCE((NEW).curso_academico_id, (OLD).curso_academico_id)));
  ELSIF TG_TABLE_NAME IN (
    'aulas',
    'cursos_academicos',
    'tarifa_concepto_anio',
    'acuses_alta',
    'cambios_pendientes',
    'mandatos_sepa'
  ) THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  END IF;

  -- ── Grupo 1 (PR B): invitaciones (centro_id directo) ─────────────────────
  IF TG_TABLE_NAME = 'invitaciones' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  END IF;

  v_antes   := CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END;
  v_despues := CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END;
  v_registro_id := COALESCE((NEW).id, (OLD).id);

  -- ── Grupo 1 (PR A): columnas que no entran en audit_log ──────────────────
  -- Nada entra en audit_log que la redacción de la purga RGPD no sepa limpiar.
  --   cambios_pendientes: el contenido del cambio (payload, valor_propuesto) lleva datos del
  --     niño (p. ej. la dirección) y acaba en la tabla real, que ya se audita.
  --   mandatos_sepa: el IBAN cifrado y la firma, y los datos del firmante que la purga no
  --     redacta en esta tabla (titular, nombre tecleado, IP, user agent).
  IF TG_TABLE_NAME = 'cambios_pendientes' THEN
    v_antes   := v_antes   - ARRAY['payload', 'valor_propuesto'];
    v_despues := v_despues - ARRAY['payload', 'valor_propuesto'];
  ELSIF TG_TABLE_NAME = 'mandatos_sepa' THEN
    v_antes   := v_antes   - ARRAY['iban_cifrado', 'firma_imagen', 'titular', 'nombre_tecleado',
                                   'ip_address', 'user_agent'];
    v_despues := v_despues - ARRAY['iban_cifrado', 'firma_imagen', 'titular', 'nombre_tecleado',
                                   'ip_address', 'user_agent'];
  END IF;

  -- ── Grupo 1 (PR B): invitaciones sin token ───────────────────────────────
  IF TG_TABLE_NAME = 'invitaciones' THEN
    v_antes   := v_antes   - 'token';
    v_despues := v_despues - 'token';
  END IF;

  -- ── Grupo 1 (PR B): actor_sistema ────────────────────────────────────────
  -- Solo sin humano (auth.uid() NULL): la etiqueta de app.audit_actor si empieza por
  -- 'system:' (la fijan las purgas con set_config(..., true)); si no la hay y el rol es
  -- service_role, 'system:service_role'. Con sesión humana nunca se rellena.
  INSERT INTO public.audit_log
    (tabla, registro_id, accion, usuario_id, valores_antes, valores_despues, centro_id, actor_sistema)
  VALUES
    (TG_TABLE_NAME, v_registro_id, TG_OP::public.audit_accion, auth.uid(), v_antes, v_despues, v_centro_id,
     CASE WHEN auth.uid() IS NULL THEN
       CASE
         WHEN current_setting('app.audit_actor', true) LIKE 'system:%'
              AND char_length(current_setting('app.audit_actor', true)) <= 100
           THEN current_setting('app.audit_actor', true)
         WHEN auth.role() = 'service_role' THEN 'system:service_role'
       END
     END);

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- public.aulas_curso_set_centro_id(): 1 llamada
CREATE OR REPLACE FUNCTION public.aulas_curso_set_centro_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.centro_id := privado.centro_de_aula(NEW.aula_id);
  RETURN NEW;
END $function$;

-- public.autorizaciones_set_centro_id(): 3 llamadas
CREATE OR REPLACE FUNCTION public.autorizaciones_set_centro_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.centro_id IS NULL AND NEW.nino_id IS NOT NULL THEN
    NEW.centro_id := privado.centro_de_nino(NEW.nino_id);
  END IF;
  IF NEW.centro_id IS NULL AND NEW.evento_id IS NOT NULL THEN
    NEW.centro_id := privado.centro_de_evento(NEW.evento_id);
  END IF;
  IF NEW.centro_id IS NULL AND NEW.aula_id IS NOT NULL THEN
    NEW.centro_id := privado.centro_de_aula(NEW.aula_id);
  END IF;
  IF NEW.centro_id IS NULL THEN
    RAISE EXCEPTION 'autorizaciones: no se pudo derivar centro_id (tipo=% evento_id=% nino_id=%)',
      NEW.tipo, NEW.evento_id, NEW.nino_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$function$;

-- public.cita_invitados_set_centro_id(): 1 llamada
CREATE OR REPLACE FUNCTION public.cita_invitados_set_centro_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.centro_id IS NULL THEN
    NEW.centro_id := privado.centro_de_cita(NEW.cita_id);
  END IF;
  IF NEW.centro_id IS NULL THEN
    RAISE EXCEPTION 'cita_invitados: centro_id no resuelto para cita %', NEW.cita_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$function$;

-- public.citas_set_centro_id(): 2 llamadas
CREATE OR REPLACE FUNCTION public.citas_set_centro_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.centro_id IS NULL AND NEW.nino_id IS NOT NULL THEN
    NEW.centro_id := privado.centro_de_nino(NEW.nino_id);
  END IF;
  IF NEW.centro_id IS NULL AND NEW.aula_id IS NOT NULL THEN
    NEW.centro_id := privado.centro_de_aula(NEW.aula_id);
  END IF;
  IF NEW.centro_id IS NULL THEN
    RAISE EXCEPTION 'citas: centro_id no resuelto (tipo=% aula_id=% nino_id=%) — el action debe pasarlo explícito en claustro/visita',
      NEW.tipo, NEW.aula_id, NEW.nino_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$function$;

-- public.congelar_si_mes_cerrado(): 1 llamada
CREATE OR REPLACE FUNCTION public.congelar_si_mes_cerrado()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_centro uuid;
  v_anio integer;
  v_mes integer;
  r_recibo record;
BEGIN
  -- Exención de service_role (backend de confianza, NUNCA expuesto al cliente): permite la
  -- limpieza/teardown, el CASCADE de borrado de centros y las correcciones server-side. El
  -- congelado protege frente a ediciones de ADMIN (authenticated), no frente al backend. El
  -- motor (SECURITY DEFINER llamado por admin) corre con auth.role()='authenticated' → NO se
  -- exime, pero solo toca borradores. auth.role() lee el claim del JWT (nivel request), no el
  -- rol de ejecución del DEFINER, así que distingue correctamente al llamante.
  IF auth.role() = 'service_role' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_TABLE_NAME = 'parte_servicio_diario' THEN
    -- Congelado POR MES: el parte de un mes cerrado (cierre_mensual) es inmutable.
    v_centro := privado.centro_de_nino(COALESCE(NEW.nino_id, OLD.nino_id));
    v_anio := EXTRACT(YEAR  FROM COALESCE(NEW.fecha, OLD.fecha))::integer;
    v_mes  := EXTRACT(MONTH FROM COALESCE(NEW.fecha, OLD.fecha))::integer;
    IF public.mes_cerrado(v_centro, v_anio, v_mes) THEN
      RAISE EXCEPTION 'mes cerrado: el parte de servicio de % no es editable',
        to_char(COALESCE(NEW.fecha, OLD.fecha), 'YYYY-MM') USING ERRCODE = 'P0001';
    END IF;

  ELSIF TG_TABLE_NAME = 'recibos' THEN
    -- Congelado POR ESTADO. Solo recibos REGULARES (esporádicos y devoluciones fuera).
    IF COALESCE(NEW.es_esporadico, OLD.es_esporadico) = false
       AND COALESCE(NEW.devuelto_de_recibo_id, OLD.devuelto_de_recibo_id) IS NULL THEN
      IF TG_OP = 'DELETE' THEN
        -- Solo se borra un borrador (regeneración). Un confirmado no se borra.
        IF OLD.estado <> 'borrador' THEN
          RAISE EXCEPTION 'recibo confirmado: % no se borra',
            to_char(make_date(OLD.anio, OLD.mes, 1), 'YYYY-MM') USING ERRCODE = 'P0001';
        END IF;
      ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.estado <> 'borrador' THEN
          -- R-5: el retroceso a borrador ("desconfirmar") deja de estar prohibido, pero solo
          -- por la puerta estrecha. Se comprueba AQUÍ, y no solo en la RPC, porque esto es
          -- una invariante del dato: ningún UPDATE directo debe poder reabrir un recibo que
          -- ya viajó al banco, venga de la RPC, de otra action o de un arreglo a mano.
          IF NEW.estado = 'borrador' THEN
            IF OLD.estado <> 'pendiente_procesar' THEN
              RAISE EXCEPTION 'recibo en el circuito de cobro (%): ya no vuelve a borrador',
                OLD.estado USING ERRCODE = 'P0001';
            END IF;
            IF public.recibo_en_remesa(OLD.id) THEN
              RAISE EXCEPTION 'recibo en remesa: no se puede modificar'
                USING ERRCODE = 'P0001';
            END IF;
          END IF;
          IF NOT (
                NEW.total_centimos        IS NOT DISTINCT FROM OLD.total_centimos
            AND NEW.metodo                IS NOT DISTINCT FROM OLD.metodo
            AND NEW.familia_id            IS NOT DISTINCT FROM OLD.familia_id
            AND NEW.nino_id               IS NOT DISTINCT FROM OLD.nino_id
            AND NEW.anio                  IS NOT DISTINCT FROM OLD.anio
            AND NEW.mes                   IS NOT DISTINCT FROM OLD.mes
            AND NEW.es_esporadico         IS NOT DISTINCT FROM OLD.es_esporadico
            AND NEW.concepto_esporadico   IS NOT DISTINCT FROM OLD.concepto_esporadico
            AND NEW.devuelto_de_recibo_id IS NOT DISTINCT FROM OLD.devuelto_de_recibo_id
          ) THEN
            RAISE EXCEPTION 'recibo confirmado: inmutable salvo estado/fecha de cobro'
              USING ERRCODE = 'P0001';
          END IF;
        END IF;
        -- OLD.estado='borrador': edición libre, incluye la transición a pendiente_procesar.
      END IF;
      -- TG_OP='INSERT': permitido (el recibo regular nace en borrador).
    END IF;

  ELSIF TG_TABLE_NAME = 'lineas_recibo' THEN
    -- Congelado POR ESTADO del recibo padre.
    SELECT estado, es_esporadico, devuelto_de_recibo_id, anio, mes
      INTO r_recibo
      FROM public.recibos WHERE id = COALESCE(NEW.recibo_id, OLD.recibo_id);
    IF FOUND
       AND r_recibo.es_esporadico = false
       AND r_recibo.devuelto_de_recibo_id IS NULL
       AND r_recibo.estado <> 'borrador' THEN
      RAISE EXCEPTION 'recibo confirmado: las líneas de % no son editables',
        to_char(make_date(r_recibo.anio, r_recibo.mes, 1), 'YYYY-MM') USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END $function$;

-- public.conversaciones_set_centro_id(): 1 llamada
CREATE OR REPLACE FUNCTION public.conversaciones_set_centro_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.centro_id IS NULL AND NEW.nino_id IS NOT NULL THEN
    NEW.centro_id := privado.centro_de_nino(NEW.nino_id);
  END IF;
  IF NEW.centro_id IS NULL THEN
    RAISE EXCEPTION 'conversaciones: no se pudo derivar centro_id (tipo=% nino_id=% admin_id=% tutor_id=%)',
      NEW.tipo_conversacion, NEW.nino_id, NEW.admin_id, NEW.tutor_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$function$;

-- public.crear_recibo_esporadico(uuid,uuid,uuid,integer,integer,text,text,jsonb): 1 llamada
CREATE OR REPLACE FUNCTION public.crear_recibo_esporadico(p_centro_id uuid, p_familia_id uuid, p_nino_id uuid, p_anio integer, p_mes integer, p_concepto text, p_metodo text, p_lineas jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_recibo_id uuid;
  v_metodo public.metodo_pago;
  r_linea jsonb;
  v_desc text;
  v_cant integer;
  v_unit integer;
  v_linea_nino uuid;
  v_total integer := 0;
BEGIN
  IF NOT public.es_admin(p_centro_id) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_anio < 2024 OR p_anio > 2100 OR p_mes < 1 OR p_mes > 12 THEN
    RAISE EXCEPTION 'periodo invalido' USING ERRCODE = '22023';
  END IF;
  IF privado.centro_de_familia(p_familia_id) IS DISTINCT FROM p_centro_id THEN
    RAISE EXCEPTION 'familia fuera del centro' USING ERRCODE = '42501';
  END IF;
  IF p_nino_id IS NOT NULL AND public.familia_de_nino(p_nino_id) IS DISTINCT FROM p_familia_id THEN
    RAISE EXCEPTION 'nino fuera de la familia' USING ERRCODE = '42501';
  END IF;
  IF p_concepto IS NULL OR char_length(p_concepto) < 1 OR char_length(p_concepto) > 200 THEN
    RAISE EXCEPTION 'concepto invalido' USING ERRCODE = '22023';
  END IF;
  IF p_lineas IS NULL OR jsonb_typeof(p_lineas) <> 'array' OR jsonb_array_length(p_lineas) < 1 THEN
    RAISE EXCEPTION 'sin lineas' USING ERRCODE = '22023';
  END IF;

  v_metodo := CASE WHEN p_metodo IS NULL OR p_metodo = '' THEN NULL ELSE p_metodo::public.metodo_pago END;

  INSERT INTO public.recibos
    (centro_id, familia_id, nino_id, anio, mes, metodo, estado, total_centimos, es_esporadico, concepto_esporadico)
    VALUES (p_centro_id, p_familia_id, p_nino_id, p_anio, p_mes, v_metodo,
            'pendiente_procesar', 0, true, p_concepto)
    RETURNING id INTO v_recibo_id;

  FOR r_linea IN SELECT * FROM jsonb_array_elements(p_lineas)
  LOOP
    v_desc := COALESCE(r_linea->>'descripcion', '');
    v_cant := COALESCE((r_linea->>'cantidad')::integer, 0);
    v_unit := COALESCE((r_linea->>'precio_unitario_centimos')::integer, 0);
    v_linea_nino := COALESCE((r_linea->>'nino_id')::uuid, p_nino_id);
    IF v_linea_nino IS NOT NULL AND public.familia_de_nino(v_linea_nino) IS DISTINCT FROM p_familia_id THEN
      RAISE EXCEPTION 'linea con nino fuera de la familia' USING ERRCODE = '42501';
    END IF;
    IF char_length(v_desc) < 1 OR char_length(v_desc) > 200 THEN
      RAISE EXCEPTION 'descripcion de linea invalida' USING ERRCODE = '22023';
    END IF;
    IF v_cant < 1 THEN
      RAISE EXCEPTION 'cantidad de linea invalida' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.lineas_recibo
      (recibo_id, concepto_id, nino_id, descripcion, cantidad, precio_unitario_centimos, importe_centimos)
      VALUES (v_recibo_id, NULL, v_linea_nino, v_desc, v_cant, v_unit, v_cant * v_unit);
    v_total := v_total + v_cant * v_unit;
  END LOOP;

  UPDATE public.recibos SET total_centimos = v_total WHERE id = v_recibo_id;
  RETURN v_recibo_id;
END $function$;

-- public.derivar_centro_id_de_familia(): 1 llamada
CREATE OR REPLACE FUNCTION public.derivar_centro_id_de_familia()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.centro_id IS NULL THEN
    NEW.centro_id := privado.centro_de_familia(NEW.familia_id);
  END IF;
  RETURN NEW;
END $function$;

-- public.derivar_centro_id_de_mandato_sepa(): 1 llamada
CREATE OR REPLACE FUNCTION public.derivar_centro_id_de_mandato_sepa()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.centro_id := privado.centro_de_familia(NEW.familia_id);
  RETURN NEW;
END $function$;

-- public.derivar_centro_id_de_nino(): 1 llamada
CREATE OR REPLACE FUNCTION public.derivar_centro_id_de_nino()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.centro_id := privado.centro_de_nino(NEW.nino_id);
  RETURN NEW;
END $function$;

-- public.derivar_centro_id_de_recibo(): 1 llamada
CREATE OR REPLACE FUNCTION public.derivar_centro_id_de_recibo()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.centro_id := privado.centro_de_recibo(NEW.recibo_id);
  RETURN NEW;
END $function$;

-- public.derivar_centro_id_de_recibo_familia(): 2 llamadas
CREATE OR REPLACE FUNCTION public.derivar_centro_id_de_recibo_familia()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.centro_id IS NULL THEN
    NEW.centro_id := COALESCE(
      privado.centro_de_familia(NEW.familia_id),
      privado.centro_de_nino(NEW.nino_id)
    );
  END IF;
  RETURN NEW;
END $function$;

-- public.derivar_centro_id_nino_o_familia(): 2 llamadas
CREATE OR REPLACE FUNCTION public.derivar_centro_id_nino_o_familia()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.centro_id IS NULL THEN
    NEW.centro_id := COALESCE(
      privado.centro_de_nino(NEW.nino_id),
      privado.centro_de_familia(NEW.familia_id)
    );
  END IF;
  RETURN NEW;
END $function$;

-- public.es_profe_de_aula(uuid): 1 llamada
CREATE OR REPLACE FUNCTION public.es_profe_de_aula(p_aula_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profes_aulas pa
    WHERE pa.profe_id = auth.uid()
      AND pa.aula_id = p_aula_id
      AND pa.fecha_fin IS NULL AND pa.deleted_at IS NULL
      AND pa.curso_academico_id = public.curso_activo_de_centro(privado.centro_de_aula(p_aula_id))
  );
$function$;

-- public.es_redactor_de_aula(uuid): 1 llamada
CREATE OR REPLACE FUNCTION public.es_redactor_de_aula(p_aula_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profes_aulas pa
    WHERE pa.profe_id = auth.uid()
      AND pa.aula_id = p_aula_id
      AND pa.fecha_fin IS NULL AND pa.deleted_at IS NULL
      AND pa.tipo_personal_aula IN ('coordinadora', 'profesora')
      AND pa.curso_academico_id = public.curso_activo_de_centro(privado.centro_de_aula(p_aula_id))
  );
$function$;

-- public.eventos_set_centro_id(): 2 llamadas
CREATE OR REPLACE FUNCTION public.eventos_set_centro_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.centro_id IS NULL AND NEW.nino_id IS NOT NULL THEN
    NEW.centro_id := privado.centro_de_nino(NEW.nino_id);
  END IF;
  IF NEW.centro_id IS NULL AND NEW.aula_id IS NOT NULL THEN
    NEW.centro_id := privado.centro_de_aula(NEW.aula_id);
  END IF;
  IF NEW.centro_id IS NULL THEN
    RAISE EXCEPTION 'eventos: no se pudo derivar centro_id (ambito=% aula_id=% nino_id=%)',
      NEW.ambito, NEW.aula_id, NEW.nino_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$function$;

-- public.existe_consentimiento_imagen(uuid): 1 llamada
CREATE OR REPLACE FUNCTION public.existe_consentimiento_imagen(p_nino_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_centro uuid := privado.centro_de_nino(p_nino_id);
BEGIN
  -- [PR 2a] Solo quien es del centro del niño.
  IF auth.uid() IS NULL THEN
    IF NOT (COALESCE(auth.role(), '') = 'service_role'
            OR (session_user <> 'authenticator'
                AND nullif(current_setting('request.jwt.claims', true), '') IS NULL
                AND nullif(current_setting('request.jwt.claim.role', true), '') IS NULL)) THEN
      RAISE EXCEPTION 'no autorizado: sin sesión solo el servicio'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF NOT (public.pertenece_a_centro(v_centro)
             OR (v_centro IS NOT NULL AND public.es_admin(v_centro))) THEN
    RAISE EXCEPTION 'no autorizado: no es de este centro'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN COALESCE((
    SELECT true FROM public.consentimientos
    WHERE tipo = 'imagen' AND nino_id = p_nino_id AND revocado_en IS NULL
    LIMIT 1
  ), false);
END;
$function$;

-- public.export_datos_sujeto(text,uuid): 1 llamada
CREATE OR REPLACE FUNCTION public.export_datos_sujeto(p_sujeto_tipo text, p_sujeto_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_self   boolean;
  v_admin  boolean;
  v_centro uuid;
  v_email  text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'no autorizado a exportar este sujeto'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ---------------------------------------------------------------- USUARIO
  IF p_sujeto_tipo = 'usuario' THEN
    v_self := v_uid = p_sujeto_id;
    IF NOT v_self AND NOT EXISTS (
      SELECT 1 FROM public.roles_usuario ru
       WHERE ru.usuario_id = p_sujeto_id
         AND ru.deleted_at IS NULL
         AND public.es_admin(ru.centro_id)
    ) THEN
      RAISE EXCEPTION 'no autorizado a exportar este sujeto'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT u.email INTO v_email FROM auth.users u WHERE u.id = p_sujeto_id;

    -- Cada fila con centro pasa si es el propio usuario o si quien exporta es admin de ese
    -- centro (centro NULL nunca: es_admin(NULL) sería TRUE para cualquier admin).
    RETURN jsonb_build_object(
      'preferencias', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'clave', p.clave, 'valor', p.valor, 'actualizado_en', p.updated_at)
               ORDER BY p.clave)
          FROM public.preferencias_usuario p
         WHERE p.usuario_id = p_sujeto_id), '[]'::jsonb),

      'dispositivos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'navegador', s.user_agent, 'registrado_en', s.created_at,
                 'ultima_actividad', s.last_active_at)
               ORDER BY s.created_at)
          FROM public.push_subscriptions s
         WHERE s.usuario_id = p_sujeto_id), '[]'::jsonb),

      'lecturas_conversaciones', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'conversacion_id', l.conversacion_id, 'leido_hasta', l.last_read_at)
               ORDER BY l.last_read_at)
          FROM public.lectura_conversacion l
          JOIN public.conversaciones c ON c.id = l.conversacion_id
         WHERE l.usuario_id = p_sujeto_id
           AND (v_self OR (c.centro_id IS NOT NULL AND public.es_admin(c.centro_id)))), '[]'::jsonb),

      'lecturas_anuncios', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'anuncio_id', l.anuncio_id, 'anuncio', a.titulo, 'leido_en', l.leido_at)
               ORDER BY l.leido_at)
          FROM public.lectura_anuncio l
          JOIN public.anuncios a ON a.id = l.anuncio_id
         WHERE l.usuario_id = p_sujeto_id
           AND (v_self OR (a.centro_id IS NOT NULL AND public.es_admin(a.centro_id)))), '[]'::jsonb),

      'invitaciones', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'email', i.email, 'nombre_completo', i.nombre_completo,
                 'rol_objetivo', i.rol_objetivo, 'tipo_vinculo', i.tipo_vinculo,
                 'enviada_en', i.created_at, 'expira_en', i.expires_at,
                 'aceptada_en', i.accepted_at, 'rechazada_en', i.rejected_at)
               ORDER BY i.created_at)
          FROM public.invitaciones i
         WHERE v_email IS NOT NULL
           AND lower(i.email) = lower(v_email)
           AND (v_self OR public.es_admin(i.centro_id))), '[]'::jsonb),

      'lista_espera_contacto', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'telefono_tutor', le.telefono_tutor, 'email_tutor', le.email_tutor)
               ORDER BY le.created_at)
          FROM public.lista_espera le
         WHERE le.tutor_usuario_id = p_sujeto_id
           AND (v_self OR public.es_admin(le.centro_id))), '[]'::jsonb),

      'exportaciones', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'exportado_en', e.created_at,
                 'solicitado_por_ti', e.solicitado_por = p_sujeto_id)
               ORDER BY e.created_at)
          FROM public.export_log e
         WHERE e.sujeto_tipo = 'usuario' AND e.sujeto_id = p_sujeto_id
           AND (v_self OR public.es_admin(e.centro_id))), '[]'::jsonb),

      'solicitudes_olvido', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'solicitado_en', o.solicitado_en, 'gracia_hasta', o.gracia_hasta,
                 'inmediato', o.inmediato, 'purgado_en', o.purgado_en)
               ORDER BY o.solicitado_en)
          FROM public.olvido_solicitudes o
         WHERE o.sujeto_tipo = 'usuario' AND o.sujeto_id = p_sujeto_id
           AND (v_self OR public.es_admin(o.centro_id))), '[]'::jsonb),

      -- Su perfil de tutor en cada familia (solo su fila, no la del otro tutor).
      'perfiles_familia', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'familia_id', ft.familia_id, 'rol_familia', ft.rol_familia,
                 'nombre_completo', ft.nombre_completo, 'email', ft.email,
                 'direccion_calle', ft.direccion_calle, 'direccion_numero', ft.direccion_numero,
                 'direccion_cp', ft.direccion_cp, 'direccion_ciudad', ft.direccion_ciudad,
                 'dni_documento_path', ft.dni_documento_path)
               ORDER BY ft.created_at)
          FROM public.familia_tutores ft
          JOIN public.familias f ON f.id = ft.familia_id
         WHERE ft.usuario_id = p_sujeto_id AND ft.deleted_at IS NULL
           AND (v_self OR public.es_admin(f.centro_id))), '[]'::jsonb),

      -- Los mandatos que firmó él. Del IBAN, solo los 4 últimos dígitos.
      'mandatos_sepa', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'identificador_mandato', m.identificador_mandato, 'titular', m.titular,
                 'iban_ultimos4', m.iban_ultimos4, 'estado', m.estado,
                 'metodo_firma', m.metodo_firma, 'fecha_firma', m.fecha_firma,
                 'nombre_tecleado', m.nombre_tecleado, 'firma_imagen', m.firma_imagen,
                 'ip_firma', host(m.ip_address), 'navegador_firma', m.user_agent,
                 'documento_path', m.documento_path)
               ORDER BY m.created_at)
          FROM public.mandatos_sepa m
         WHERE m.usuario_id = p_sujeto_id AND m.deleted_at IS NULL
           AND (v_self OR public.es_admin(m.centro_id))), '[]'::jsonb),

      -- Cobros de cada familia de la que es tutor (los dos tutores reciben lo mismo).
      'cobros_familia', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'familia', f.etiqueta,
                 'recibos', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                            'anio', r.anio, 'mes', r.mes, 'estado', r.estado, 'metodo', r.metodo,
                            'total_centimos', r.total_centimos, 'es_esporadico', r.es_esporadico,
                            'concepto_esporadico', r.concepto_esporadico,
                            'fecha_envio_banco', r.fecha_envio_banco,
                            'fecha_devolucion', r.fecha_devolucion,
                            'lineas', COALESCE((
                              SELECT jsonb_agg(jsonb_build_object(
                                       'descripcion', lr.descripcion, 'cantidad', lr.cantidad,
                                       'precio_unitario_centimos', lr.precio_unitario_centimos,
                                       'importe_centimos', lr.importe_centimos)
                                     ORDER BY lr.created_at, lr.id)
                                FROM public.lineas_recibo lr
                               WHERE lr.recibo_id = r.id), '[]'::jsonb))
                          ORDER BY r.anio, r.mes, r.created_at)
                     FROM public.recibos r
                    WHERE r.familia_id = f.id AND r.deleted_at IS NULL), '[]'::jsonb),
                 'metodos_pago', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                            'anio', mp.anio, 'mes', mp.mes, 'metodo', mp.metodo)
                          ORDER BY mp.anio, mp.mes)
                     FROM public.metodo_pago_familia mp
                    WHERE mp.familia_id = f.id AND mp.deleted_at IS NULL), '[]'::jsonb),
                 'conceptos_asignados', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                            'concepto', cc.nombre, 'cantidad', ac.cantidad_default,
                            'importe_especial_centimos', ac.importe_override_centimos,
                            'vigencia_desde', ac.vigencia_desde,
                            'vigencia_hasta', ac.vigencia_hasta)
                          ORDER BY ac.created_at)
                     FROM public.asignacion_concepto ac
                     JOIN public.conceptos_cobro cc ON cc.id = ac.concepto_id
                    WHERE ac.familia_id = f.id AND ac.deleted_at IS NULL), '[]'::jsonb),
                 'beca_comedor_excesos', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                            'anio', d.anio, 'mes', d.mes,
                            'cuota_total_centimos', d.cuota_total_centimos,
                            'beca_total_centimos', d.beca_total_centimos,
                            'exceso_centimos', d.exceso_centimos,
                            'estado', d.estado, 'via', d.via, 'resuelto_en', d.resuelto_at)
                          ORDER BY d.anio, d.mes)
                     FROM public.beca_comedor_desborde d
                    WHERE d.familia_id = f.id), '[]'::jsonb),
                 'beca_comedor_transferencias', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                            'anio', bt.anio, 'mes', bt.mes,
                            'importe_centimos', bt.importe_centimos,
                            'estado', bt.estado, 'realizada_en', bt.realizada_at)
                          ORDER BY bt.anio, bt.mes)
                     FROM public.beca_comedor_transferencia bt
                    WHERE bt.familia_id = f.id), '[]'::jsonb))
               ORDER BY f.created_at)
          FROM public.familias f
         WHERE f.id IN (SELECT ft.familia_id FROM public.familia_tutores ft
                         WHERE ft.usuario_id = p_sujeto_id AND ft.deleted_at IS NULL)
           AND (v_self OR public.es_admin(f.centro_id))), '[]'::jsonb)
    );
  END IF;

  -- ---------------------------------------------------------------- NIÑO
  IF p_sujeto_tipo = 'nino' THEN
    v_centro := privado.centro_de_nino(p_sujeto_id);
    IF v_centro IS NULL THEN
      RAISE EXCEPTION 'no autorizado a exportar este sujeto'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    v_admin := public.es_admin(v_centro);
    IF NOT v_admin AND NOT public.es_tutor_legal_de(p_sujeto_id) THEN
      RAISE EXCEPTION 'no autorizado a exportar este sujeto'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN jsonb_build_object(
      -- Su prospecto entero.
      'lista_espera', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'nombre_nino', le.nombre_nino, 'apellidos_nino', le.apellidos_nino,
                 'fecha_nacimiento', le.fecha_nacimiento, 'telefono_tutor', le.telefono_tutor,
                 'email_tutor', le.email_tutor, 'nota', le.nota, 'posicion', le.posicion,
                 'estado', le.estado, 'curso', ca.nombre, 'apuntado_en', le.created_at)
               ORDER BY le.created_at)
          FROM public.lista_espera le
          LEFT JOIN public.cursos_academicos ca ON ca.id = le.curso_academico_id
         WHERE le.nino_id = p_sujeto_id), '[]'::jsonb),

      -- Sin motivo_baja. La familia, solo activa/baja (como get_recorrido_nino_familia).
      'matriculas', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'id', m.id, 'aula', a.nombre, 'curso', ca.nombre, 'estado', m.estado,
                 'fecha_alta', m.fecha_alta, 'fecha_baja', m.fecha_baja,
                 'activada_en', m.activada_at)
               ORDER BY ca.fecha_inicio, m.fecha_alta, m.id)
          FROM public.matriculas m
          JOIN public.aulas a ON a.id = m.aula_id
          JOIN public.cursos_academicos ca ON ca.id = m.curso_academico_id
         WHERE m.nino_id = p_sujeto_id AND m.deleted_at IS NULL
           AND (v_admin OR m.estado IN ('activa', 'baja'))), '[]'::jsonb),

      -- Por sujeto, no por quién firmó: sale también el que dio el otro tutor.
      'consentimientos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'tipo', c.tipo, 'version_texto', c.version, 'aceptado_en', c.aceptado_en,
                 'revocado_en', c.revocado_en, 'metodo_firma', c.metodo_firma,
                 'otorgado_por', u.nombre_completo)
               ORDER BY c.aceptado_en)
          FROM public.consentimientos c
          LEFT JOIN public.usuarios u ON u.id = c.usuario_id
         WHERE c.nino_id = p_sujeto_id), '[]'::jsonb),

      'acuses_alta', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'tipo', aa.tipo, 'metodo', aa.metodo, 'aceptado_en', aa.aceptado_en)
               ORDER BY aa.aceptado_en)
          FROM public.acuses_alta aa
         WHERE aa.nino_id = p_sujeto_id), '[]'::jsonb),

      'cambios_solicitados', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'entidad', cp.entidad, 'campo', cp.campo,
                 'valor_propuesto', cp.valor_propuesto, 'detalle', cp.payload,
                 'estado', cp.estado, 'solicitado_en', cp.created_at,
                 'decidido_en', cp.decided_at)
               ORDER BY cp.created_at)
          FROM public.cambios_pendientes cp
         WHERE cp.nino_id = p_sujeto_id), '[]'::jsonb),

      'fin_de_curso', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('curso', ca.nombre, 'registrado_en', rf.created_at)
               ORDER BY rf.created_at)
          FROM public.rollover_finaliza rf
          JOIN public.cursos_academicos ca ON ca.id = rf.curso_academico_id
         WHERE rf.nino_id = p_sujeto_id), '[]'::jsonb),

      'citas', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'titulo', ci.titulo, 'tipo', ci.tipo, 'fecha', ci.fecha,
                 'hora_inicio', ci.hora_inicio, 'hora_fin', ci.hora_fin, 'lugar', ci.lugar,
                 'descripcion', ci.descripcion, 'estado', ci.estado)
               ORDER BY ci.fecha, ci.hora_inicio)
          FROM public.citas ci
         WHERE ci.nino_id = p_sujeto_id), '[]'::jsonb),

      'eventos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'titulo', e.titulo, 'tipo', e.tipo, 'fecha', e.fecha, 'fecha_fin', e.fecha_fin,
                 'hora_inicio', e.hora_inicio, 'hora_fin', e.hora_fin, 'lugar', e.lugar,
                 'descripcion', e.descripcion, 'estado', e.estado)
               ORDER BY e.fecha, e.hora_inicio)
          FROM public.eventos e
         WHERE e.nino_id = p_sujeto_id), '[]'::jsonb),

      'confirmaciones_eventos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'evento', e.titulo, 'fecha_evento', e.fecha, 'estado', ce.estado,
                 'comentario', ce.comentario, 'confirmado_at', ce.confirmado_at)
               ORDER BY e.fecha)
          FROM public.confirmaciones_evento ce
          JOIN public.eventos e ON e.id = ce.evento_id
         WHERE ce.nino_id = p_sujeto_id), '[]'::jsonb),

      -- Los dirigidos a la familia sobre el niño; los del personal son trabajo del centro.
      'recordatorios', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'titulo', r.titulo, 'descripcion', r.descripcion,
                 'vencimiento', r.vencimiento, 'completado_en', r.completado_en)
               ORDER BY r.created_at)
          FROM public.recordatorios r
         WHERE r.nino_id = p_sujeto_id AND r.destinatario = 'familia_individual'), '[]'::jsonb),

      'becas', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'tipo_beca', tb.nombre, 'importe_centimos', b.importe_centimos,
                 'fecha_desde', b.fecha_desde, 'fecha_hasta', b.fecha_hasta)
               ORDER BY b.fecha_desde)
          FROM public.becas b
          JOIN public.tipos_beca tb ON tb.id = b.tipo_beca_id
         WHERE b.nino_id = p_sujeto_id AND b.deleted_at IS NULL), '[]'::jsonb),

      'conceptos_asignados', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'concepto', cc.nombre, 'cantidad', ac.cantidad_default,
                 'importe_especial_centimos', ac.importe_override_centimos,
                 'vigencia_desde', ac.vigencia_desde, 'vigencia_hasta', ac.vigencia_hasta)
               ORDER BY ac.created_at)
          FROM public.asignacion_concepto ac
          JOIN public.conceptos_cobro cc ON cc.id = ac.concepto_id
         WHERE ac.nino_id = p_sujeto_id AND ac.deleted_at IS NULL), '[]'::jsonb),

      'lineas_recibo', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'anio', r.anio, 'mes', r.mes, 'descripcion', lr.descripcion,
                 'cantidad', lr.cantidad, 'importe_centimos', lr.importe_centimos)
               ORDER BY r.anio, r.mes, lr.created_at)
          FROM public.lineas_recibo lr
          JOIN public.recibos r ON r.id = lr.recibo_id
         WHERE lr.nino_id = p_sujeto_id AND r.deleted_at IS NULL), '[]'::jsonb),

      'servicios_diarios', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'fecha', ps.fecha, 'servicio', ps.servicio, 'presente', ps.presente)
               ORDER BY ps.fecha, ps.servicio)
          FROM public.parte_servicio_diario ps
         WHERE ps.nino_id = p_sujeto_id), '[]'::jsonb),

      'beca_comedor_elegibilidad', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'curso', ca.nombre, 'fecha_alta', be.fecha_alta,
                 'fecha_baja', be.fecha_baja, 'activa', be.activa)
               ORDER BY be.fecha_alta)
          FROM public.beca_comedor_elegibilidad be
          JOIN public.cursos_academicos ca ON ca.id = be.curso_academico_id
         WHERE be.nino_id = p_sujeto_id), '[]'::jsonb),

      'beca_comedor_tramos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'anio_correspondiente', bt.anio_correspondiente,
                 'mes_correspondiente', bt.mes_correspondiente,
                 'anio_aplicacion', bt.anio_aplicacion, 'mes_aplicacion', bt.mes_aplicacion,
                 'importe_centimos', bt.importe_centimos, 'estado', bt.estado,
                 'origen', bt.origen)
               ORDER BY bt.anio_correspondiente, bt.mes_correspondiente, bt.created_at)
          FROM public.beca_comedor_tramo bt
         WHERE bt.nino_id = p_sujeto_id), '[]'::jsonb)
    );
  END IF;

  RAISE EXCEPTION 'tipo de sujeto inválido: %', p_sujeto_tipo
    USING ERRCODE = 'invalid_parameter_value';
END
$function$;

-- public.familia_tutores_derivar_centro(): 1 llamada
CREATE OR REPLACE FUNCTION public.familia_tutores_derivar_centro()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_centro uuid := privado.centro_de_familia(NEW.familia_id);
BEGIN
  -- En un UPDATE que no toca centro_id (p. ej. una reasignación de familia), se recalcula.
  IF TG_OP = 'UPDATE' AND NEW.centro_id IS NOT DISTINCT FROM OLD.centro_id THEN
    NEW.centro_id := v_centro;
  ELSIF NEW.centro_id IS NOT NULL AND NEW.centro_id IS DISTINCT FROM v_centro THEN
    RAISE EXCEPTION 'familia_tutores: centro_id no es el de la familia'
      USING ERRCODE = 'check_violation';
  ELSE
    NEW.centro_id := v_centro;
  END IF;
  RETURN NEW;
END $function$;

-- public.firma_imagen_sync(): 1 llamada
CREATE OR REPLACE FUNCTION public.firma_imagen_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a public.autorizaciones%ROWTYPE;
BEGIN
  SELECT * INTO a FROM public.autorizaciones WHERE id = NEW.autorizacion_id;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF a.es_plantilla OR a.tipo <> 'autorizacion_imagenes' THEN RETURN NEW; END IF;

  IF NEW.decision = 'firmado' THEN
    IF NOT (
         EXISTS (SELECT 1 FROM public.vinculos_familiares vf
                  WHERE vf.usuario_id = NEW.firmante_id
                    AND vf.nino_id = NEW.nino_id
                    AND vf.deleted_at IS NULL
                    AND vf.tipo_vinculo IN ('tutor_legal_principal', 'tutor_legal_secundario'))
      OR (NEW.metodo_firma = 'presencial'
          AND EXISTS (SELECT 1 FROM public.roles_usuario ru
                       WHERE ru.usuario_id = NEW.firmante_id
                         AND ru.rol = 'admin'
                         AND ru.deleted_at IS NULL
                         AND ru.centro_id = privado.centro_de_nino(NEW.nino_id)))
    ) THEN
      RETURN NEW;
    END IF;
    UPDATE public.consentimientos
       SET revocado_en = now()
     WHERE tipo = 'imagen' AND usuario_id = NEW.firmante_id
       AND nino_id = NEW.nino_id AND revocado_en IS NULL;
    INSERT INTO public.consentimientos
      (usuario_id, tipo, version, nino_id, ip_address, user_agent)
    VALUES
      (NEW.firmante_id, 'imagen'::public.consentimiento_tipo, a.texto_version,
       NEW.nino_id, NEW.ip_address, NEW.user_agent);
  ELSE
    UPDATE public.consentimientos
       SET revocado_en = now()
     WHERE tipo = 'imagen' AND usuario_id = NEW.firmante_id
       AND nino_id = NEW.nino_id AND revocado_en IS NULL;
  END IF;

  RETURN NEW;
END $function$;

-- public.get_motivos_baja_matriculas(uuid[]): 2 llamadas
CREATE OR REPLACE FUNCTION public.get_motivos_baja_matriculas(p_nino_ids uuid[])
 RETURNS TABLE(matricula_id uuid, motivo_baja text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Admin del centro de CADA niño pedido. `centro_de_nino` NULL (niño inexistente) también
  -- se rechaza: `es_admin(NULL)` sería TRUE para cualquier admin.
  IF auth.uid() IS NULL OR EXISTS (
    SELECT 1
      FROM unnest(p_nino_ids) AS n(id)
     WHERE privado.centro_de_nino(n.id) IS NULL
        OR NOT public.es_admin(privado.centro_de_nino(n.id))
  ) THEN
    RAISE EXCEPTION 'no autorizado a leer el motivo de baja'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN QUERY
  SELECT m.id, m.motivo_baja
    FROM public.matriculas m
   WHERE m.nino_id = ANY (p_nino_ids)
     AND m.deleted_at IS NULL
     AND m.motivo_baja IS NOT NULL;
END
$function$;

-- public.invitaciones_validar_centro(): 2 llamadas
CREATE OR REPLACE FUNCTION public.invitaciones_validar_centro()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.nino_id IS NOT NULL
     AND privado.centro_de_nino(NEW.nino_id) IS DISTINCT FROM NEW.centro_id THEN
    RAISE EXCEPTION 'invitaciones: el niño no pertenece al centro de la invitación'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.aula_id IS NOT NULL
     AND privado.centro_de_aula(NEW.aula_id) IS DISTINCT FROM NEW.centro_id THEN
    RAISE EXCEPTION 'invitaciones: el aula no pertenece al centro de la invitación'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;

-- public.marcar_matricula_lista(uuid): 1 llamada
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
  -- (backstop F11-F, CONSERVADO). auth.uid() = quien finaliza (admin o tutor).
  IF v_pendiente AND NOT public.tiene_consentimiento(auth.uid(), 'datos_medicos') THEN
    RAISE EXCEPTION 'falta el acuse de confidencialidad de datos medicos'
      USING ERRCODE = 'insufficient_privilege';
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

-- public.media_etiquetas_set_centro_id(): 2 llamadas
CREATE OR REPLACE FUNCTION public.media_etiquetas_set_centro_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.centro_id := privado.centro_de_publicacion(privado.publicacion_de_media(NEW.media_id));
  RETURN NEW;
END;
$function$;

-- public.media_set_centro_id(): 1 llamada
CREATE OR REPLACE FUNCTION public.media_set_centro_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.centro_id := privado.centro_de_publicacion(NEW.publicacion_id);
  RETURN NEW;
END;
$function$;

-- public.media_validar_ruta(): 2 llamadas
CREATE OR REPLACE FUNCTION public.media_validar_ruta()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_regex text;
BEGIN
  v_regex := '^' || privado.centro_de_publicacion(NEW.publicacion_id)::text
          || '/' || privado.aula_de_publicacion(NEW.publicacion_id)::text
          || '/' || NEW.publicacion_id::text
          || '/[A-Za-z0-9_-]+\.jpg$';

  IF v_regex IS NULL
     OR NEW.path IS NULL
     OR NOT (NEW.path ~ v_regex)
     OR (NEW.path_miniatura IS NOT NULL AND NOT (NEW.path_miniatura ~ v_regex))
  THEN
    RAISE EXCEPTION 'media: la ruta no pertenece a la publicación'
      USING ERRCODE = 'check_violation',
            HINT = 'Formato: {centro_id}/{aula_id}/{publicacion_id}/<nombre>.jpg';
  END IF;

  RETURN NEW;
END;
$function$;

-- public.nino_toma_comida_solida(uuid): 1 llamada
CREATE OR REPLACE FUNCTION public.nino_toma_comida_solida(p_nino_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_centro uuid := privado.centro_de_nino(p_nino_id);
BEGIN
  -- [PR 2a] Solo quien es del centro del niño.
  IF auth.uid() IS NULL THEN
    IF NOT (COALESCE(auth.role(), '') = 'service_role'
            OR (session_user <> 'authenticator'
                AND nullif(current_setting('request.jwt.claims', true), '') IS NULL
                AND nullif(current_setting('request.jwt.claim.role', true), '') IS NULL)) THEN
      RAISE EXCEPTION 'no autorizado: sin sesión solo el servicio'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF NOT (public.pertenece_a_centro(v_centro)
             OR (v_centro IS NOT NULL AND public.es_admin(v_centro))) THEN
    RAISE EXCEPTION 'no autorizado: no es de este centro'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN COALESCE(
    (
      SELECT lactancia_estado NOT IN (
        'materna'::public.lactancia_estado,
        'biberon'::public.lactancia_estado
      )
      FROM public.datos_pedagogicos_nino
      WHERE nino_id = p_nino_id
    ),
    TRUE
  );
END;
$function$;

-- public.otorgar_consentimiento_imagen(uuid,uuid,text,inet,text,firma_metodo): 1 llamada
CREATE OR REPLACE FUNCTION public.otorgar_consentimiento_imagen(p_nino_id uuid, p_tutor uuid, p_version text DEFAULT 'imagen-v1'::text, p_ip inet DEFAULT NULL::inet, p_user_agent text DEFAULT NULL::text, p_metodo firma_metodo DEFAULT 'digital'::firma_metodo)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_uid uuid := auth.uid();
  v_admin boolean;
BEGIN
  IF v_uid IS NULL THEN
    IF NOT (COALESCE(auth.role(), '') = 'service_role'
            OR (session_user <> 'authenticator'
                AND nullif(current_setting('request.jwt.claims', true), '') IS NULL
                AND nullif(current_setting('request.jwt.claim.role', true), '') IS NULL)) THEN
      RAISE EXCEPTION 'no autorizado a otorgar consentimiento de imagen de este niño'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSE
    -- El superusuario no registra el consentimiento en nombre de un tutor (ADR-0061).
    v_admin := public.es_admin(privado.centro_de_nino(p_nino_id)) AND NOT public.is_superadmin();
    IF NOT v_admin AND NOT public.es_tutor_legal_de(p_nino_id) THEN
      RAISE EXCEPTION 'no autorizado a otorgar consentimiento de imagen de este niño'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    IF NOT v_admin THEN
      p_tutor := v_uid;
    END IF;
  END IF;

  INSERT INTO public.consentimientos
    (usuario_id, tipo, version, nino_id, ip_address, user_agent, metodo_firma)
  VALUES
    (p_tutor, 'imagen', p_version, p_nino_id, p_ip, p_user_agent, p_metodo)
  RETURNING id INTO v_id;

  RETURN v_id;
END $function$;

-- public.promover_a_titular(uuid): 1 llamada
CREATE OR REPLACE FUNCTION public.promover_a_titular(p_familia_tutor_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_fila   public.familia_tutores%ROWTYPE;
  v_centro uuid;
BEGIN
  SELECT * INTO v_fila FROM public.familia_tutores
   WHERE id = p_familia_tutor_id AND deleted_at IS NULL;
  v_centro := privado.centro_de_familia(v_fila.familia_id);
  -- Sin fila o sin centro también es 42501: es_admin(NULL) sería TRUE para cualquier admin.
  IF auth.uid() IS NULL OR v_centro IS NULL OR NOT public.es_admin(v_centro) THEN
    RAISE EXCEPTION 'no autorizado a cambiar el titular de esta familia'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_fila.rol_familia <> 'segundo_tutor' THEN
    RAISE EXCEPTION 'solo un segundo tutor puede pasar a titular'
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM public.familia_tutores
              WHERE familia_id = v_fila.familia_id AND rol_familia = 'titular'
                AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'la familia ya tiene titular'
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM set_config('app.promover_titular', 'on', true);
  UPDATE public.familia_tutores SET rol_familia = 'titular' WHERE id = v_fila.id;
  PERFORM set_config('app.promover_titular', '', true);

  -- Sus vínculos con los niños de la familia: titular ⇔ tutor_legal_principal.
  IF v_fila.usuario_id IS NOT NULL THEN
    UPDATE public.vinculos_familiares vf SET tipo_vinculo = 'tutor_legal_principal'
      FROM public.ninos n
     WHERE vf.nino_id = n.id
       AND n.familia_id = v_fila.familia_id
       AND vf.usuario_id = v_fila.usuario_id
       AND vf.tipo_vinculo = 'tutor_legal_secundario'
       AND vf.deleted_at IS NULL;
  END IF;
END
$function$;

-- public.publicaciones_set_centro_id(): 1 llamada
CREATE OR REPLACE FUNCTION public.publicaciones_set_centro_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.centro_id := privado.centro_de_aula(NEW.aula_id);
  RETURN NEW;
END;
$function$;

-- public.recordatorios_set_centro_id(): 2 llamadas
CREATE OR REPLACE FUNCTION public.recordatorios_set_centro_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.centro_id IS NULL AND NEW.nino_id IS NOT NULL THEN
    NEW.centro_id := privado.centro_de_nino(NEW.nino_id);
  END IF;
  IF NEW.centro_id IS NULL AND NEW.aula_id IS NOT NULL THEN
    NEW.centro_id := privado.centro_de_aula(NEW.aula_id);
  END IF;
  IF NEW.centro_id IS NULL THEN
    RAISE EXCEPTION 'recordatorios: no se pudo derivar centro_id (destinatario=% nino_id=% aula_id=%)',
      NEW.destinatario, NEW.nino_id, NEW.aula_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$function$;

-- public.registrar_mandato_sepa(uuid,uuid,text,text,text,text,text,text,text,inet,text,timestamp with time zone,firma_metodo): 2 llamadas
CREATE OR REPLACE FUNCTION public.registrar_mandato_sepa(p_familia_id uuid, p_nino_id uuid, p_iban text, p_titular text, p_identificador_mandato text, p_documento_path text, p_firma_imagen text, p_nombre_tecleado text, p_texto_hash text, p_ip_address inet, p_user_agent text, p_fecha_firma timestamp with time zone, p_metodo firma_metodo DEFAULT 'digital'::firma_metodo)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_clave       text := public._get_sepa_key();
  v_uid         uuid := auth.uid();
  v_id          uuid;
  v_iban_actual text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  -- Gate por FAMILIA: admin del centro de la familia O tutor de la familia.
  -- El superusuario no registra el mandato en nombre de la familia (ADR-0061).
  IF NOT ((public.es_admin(privado.centro_de_familia(p_familia_id)) AND NOT public.is_superadmin())
          OR public.es_tutor_de_familia(p_familia_id)) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  IF p_iban IS NULL OR char_length(p_iban) < 15 OR char_length(p_iban) > 34 THEN
    RAISE EXCEPTION 'IBAN inválido';
  END IF;

  -- Mandato ACTIVO de la familia (no por nino+usuario). Se descifra su IBAN para
  -- decidir: mismo IBAN = reintento del alta (UPDATE in-place, sin ensuciar histórico);
  -- IBAN distinto = cambio real de cuenta → NO se pisa aquí, se exige sustituir_mandato_sepa
  -- (revoca + inserta, con histórico). NO se compara `iban_cifrado` directamente:
  -- pgp_sym_encrypt no es determinista (mismo IBAN cifra distinto) → hay que descifrar.
  SELECT id, pgp_sym_decrypt(iban_cifrado, v_clave) INTO v_id, v_iban_actual
  FROM public.mandatos_sepa
  WHERE familia_id = p_familia_id AND estado = 'activo' AND deleted_at IS NULL
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    -- Comparación en CLARO normalizada (sin espacios/tabuladores, mayúsculas) por si el
    -- tecleo trae espacios. Distinto → error claro; el cambio de cuenta va por sustituir.
    IF upper(regexp_replace(v_iban_actual, '\s', '', 'g'))
       <> upper(regexp_replace(p_iban, '\s', '', 'g')) THEN
      RAISE EXCEPTION 'mandato_activo_otro_iban'
        USING HINT = 'existe un mandato activo con otro IBAN; usa sustituir_mandato_sepa';
    END IF;
    UPDATE public.mandatos_sepa SET
      nino_id               = p_nino_id,
      usuario_id            = v_uid,
      iban_cifrado          = pgp_sym_encrypt(p_iban, v_clave),
      iban_ultimos4         = right(regexp_replace(p_iban, '\s', '', 'g'), 4),
      titular               = p_titular,
      identificador_mandato = p_identificador_mandato,
      documento_path        = p_documento_path,
      estado                = 'activo',
      firma_imagen          = p_firma_imagen,
      nombre_tecleado       = p_nombre_tecleado,
      texto_hash            = p_texto_hash,
      ip_address            = p_ip_address,
      user_agent            = p_user_agent,
      fecha_firma           = p_fecha_firma,
      metodo_firma          = p_metodo
    WHERE id = v_id;
  ELSE
    INSERT INTO public.mandatos_sepa (
      centro_id, familia_id, nino_id, usuario_id, iban_cifrado, iban_ultimos4, titular,
      identificador_mandato, documento_path, estado, firma_imagen,
      nombre_tecleado, texto_hash, ip_address, user_agent, fecha_firma, metodo_firma
    ) VALUES (
      privado.centro_de_familia(p_familia_id), p_familia_id, p_nino_id, v_uid,
      pgp_sym_encrypt(p_iban, v_clave), right(regexp_replace(p_iban, '\s', '', 'g'), 4), p_titular,
      p_identificador_mandato, p_documento_path, 'activo', p_firma_imagen,
      p_nombre_tecleado, p_texto_hash, p_ip_address, p_user_agent, p_fecha_firma, p_metodo
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$function$;

-- public.revocar_consentimiento_imagen(uuid): 1 llamada
CREATE OR REPLACE FUNCTION public.revocar_consentimiento_imagen(p_nino_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_n integer;
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    IF NOT (COALESCE(auth.role(), '') = 'service_role'
            OR (session_user <> 'authenticator'
                AND nullif(current_setting('request.jwt.claims', true), '') IS NULL
                AND nullif(current_setting('request.jwt.claim.role', true), '') IS NULL)) THEN
      RAISE EXCEPTION 'no autorizado a revocar consentimiento de imagen de este niño'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  ELSIF NOT public.es_admin(privado.centro_de_nino(p_nino_id))
     AND NOT public.es_tutor_legal_de(p_nino_id) THEN
    RAISE EXCEPTION 'no autorizado a revocar consentimiento de imagen de este niño'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  WITH upd AS (
    UPDATE public.consentimientos
       SET revocado_en = now()
     WHERE tipo = 'imagen' AND nino_id = p_nino_id AND revocado_en IS NULL
    RETURNING 1
  )
  SELECT count(*) INTO v_n FROM upd;

  RETURN v_n;
END $function$;

-- public.set_info_medica_emergencia_cifrada_tutor(uuid,text,text,text,text,text,text,boolean): 1 llamada
CREATE OR REPLACE FUNCTION public.set_info_medica_emergencia_cifrada_tutor(p_nino_id uuid, p_alergias_graves text, p_notas_emergencia text, p_medicacion_habitual text, p_alergias_leves text, p_medico_familia text, p_telefono_emergencia text, p_reemplazar boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_clave text;
  v_id uuid;
BEGIN
  -- Gate AMPLIADO: admin del centro del niño O tutor legal (el tutor pasa igual).
  -- F11-F: la info médica es VOLUNTARIA → sin gate de consentimiento; el acuse de
  -- confidencialidad se exige al cerrar el alta (marcar_matricula_lista), no aquí.
  IF NOT (public.es_admin(privado.centro_de_nino(p_nino_id))
          OR public.es_tutor_legal_de(p_nino_id)) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_clave := public._get_medical_key();

  INSERT INTO public.info_medica_emergencia (
    nino_id, alergias_graves, notas_emergencia,
    medicacion_habitual, alergias_leves, medico_familia, telefono_emergencia
  ) VALUES (
    p_nino_id,
    CASE WHEN p_alergias_graves  IS NULL THEN NULL ELSE pgp_sym_encrypt(p_alergias_graves,  v_clave) END,
    CASE WHEN p_notas_emergencia IS NULL THEN NULL ELSE pgp_sym_encrypt(p_notas_emergencia, v_clave) END,
    p_medicacion_habitual, p_alergias_leves, p_medico_familia, p_telefono_emergencia
  )
  ON CONFLICT (nino_id) DO UPDATE SET
    -- MERGE (default): NULL en EXCLUDED.* = "no tocar" → COALESCE preserva.
    -- REPLACE (p_reemplazar): escribe EXCLUDED.* verbatim → NULL LIMPIA.
    alergias_graves     = CASE WHEN p_reemplazar THEN EXCLUDED.alergias_graves
                               ELSE COALESCE(EXCLUDED.alergias_graves,     public.info_medica_emergencia.alergias_graves) END,
    notas_emergencia    = CASE WHEN p_reemplazar THEN EXCLUDED.notas_emergencia
                               ELSE COALESCE(EXCLUDED.notas_emergencia,    public.info_medica_emergencia.notas_emergencia) END,
    medicacion_habitual = CASE WHEN p_reemplazar THEN EXCLUDED.medicacion_habitual
                               ELSE COALESCE(EXCLUDED.medicacion_habitual, public.info_medica_emergencia.medicacion_habitual) END,
    alergias_leves      = CASE WHEN p_reemplazar THEN EXCLUDED.alergias_leves
                               ELSE COALESCE(EXCLUDED.alergias_leves,      public.info_medica_emergencia.alergias_leves) END,
    medico_familia      = CASE WHEN p_reemplazar THEN EXCLUDED.medico_familia
                               ELSE COALESCE(EXCLUDED.medico_familia,      public.info_medica_emergencia.medico_familia) END,
    telefono_emergencia = CASE WHEN p_reemplazar THEN EXCLUDED.telefono_emergencia
                               ELSE COALESCE(EXCLUDED.telefono_emergencia, public.info_medica_emergencia.telefono_emergencia) END,
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

-- public.sustituir_mandato_sepa(uuid,uuid,text,text,text,text,text,text,text,inet,text,timestamp with time zone,firma_metodo): 2 llamadas
CREATE OR REPLACE FUNCTION public.sustituir_mandato_sepa(p_familia_id uuid, p_nino_id uuid, p_iban text, p_titular text, p_identificador_mandato text, p_documento_path text, p_firma_imagen text, p_nombre_tecleado text, p_texto_hash text, p_ip_address inet, p_user_agent text, p_fecha_firma timestamp with time zone, p_metodo firma_metodo DEFAULT 'digital'::firma_metodo)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_clave text := public._get_sepa_key();
  v_uid   uuid := auth.uid();
  v_id    uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  -- El superusuario no registra el mandato en nombre de la familia (ADR-0061).
  IF NOT ((public.es_admin(privado.centro_de_familia(p_familia_id)) AND NOT public.is_superadmin())
          OR public.es_tutor_de_familia(p_familia_id)) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;
  IF p_iban IS NULL OR char_length(p_iban) < 15 OR char_length(p_iban) > 34 THEN
    RAISE EXCEPTION 'IBAN inválido';
  END IF;

  -- Revoca el activo actual de la familia (se conserva la fila: estado='revocado',
  -- deleted_at NULL, con SU iban_ultimos4 intacto). Libera el índice único ANTES
  -- del INSERT del nuevo activo.
  UPDATE public.mandatos_sepa
    SET estado = 'revocado'
    WHERE familia_id = p_familia_id AND estado = 'activo' AND deleted_at IS NULL;

  INSERT INTO public.mandatos_sepa (
    centro_id, familia_id, nino_id, usuario_id, iban_cifrado, iban_ultimos4, titular,
    identificador_mandato, documento_path, estado, firma_imagen,
    nombre_tecleado, texto_hash, ip_address, user_agent, fecha_firma, metodo_firma
  ) VALUES (
    privado.centro_de_familia(p_familia_id), p_familia_id, p_nino_id, v_uid,
    pgp_sym_encrypt(p_iban, v_clave), right(regexp_replace(p_iban, '\s', '', 'g'), 4), p_titular,
    p_identificador_mandato, p_documento_path, 'activo', p_firma_imagen,
    p_nombre_tecleado, p_texto_hash, p_ip_address, p_user_agent, p_fecha_firma, p_metodo
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

-- public.usuario_es_audiencia_anuncio(uuid): 1 llamada
CREATE OR REPLACE FUNCTION public.usuario_es_audiencia_anuncio(p_anuncio_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  a public.anuncios%ROWTYPE;
  v_usuario uuid := auth.uid();
BEGIN
  IF v_usuario IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT * INTO a FROM public.anuncios WHERE id = p_anuncio_id;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF public.es_admin(a.centro_id) THEN
    RETURN TRUE;
  END IF;

  IF a.autor_id = v_usuario THEN
    RETURN TRUE;
  END IF;

  IF a.ambito = 'aula' THEN
    IF privado.centro_de_aula(a.aula_id) IS DISTINCT FROM a.centro_id THEN
      RETURN FALSE;
    END IF;
    IF public.es_profe_de_aula(a.aula_id) THEN
      RETURN TRUE;
    END IF;
    RETURN EXISTS (
      SELECT 1
      FROM public.matriculas m
      JOIN public.vinculos_familiares vf ON vf.nino_id = m.nino_id
      WHERE m.aula_id = a.aula_id
        AND m.fecha_baja IS NULL
        AND m.deleted_at IS NULL
        AND m.estado = 'activa'
        AND vf.usuario_id = v_usuario
        AND vf.deleted_at IS NULL
        AND COALESCE((vf.permisos ->> 'puede_recibir_mensajes')::boolean, false) = true
    );
  END IF;

  IF a.ambito = 'centro' THEN
    IF EXISTS (
      SELECT 1
      FROM public.profes_aulas pa
      JOIN public.aulas au ON au.id = pa.aula_id
      WHERE pa.profe_id = v_usuario
        AND pa.fecha_fin IS NULL
        AND pa.deleted_at IS NULL
        AND au.centro_id = a.centro_id
    ) THEN
      RETURN TRUE;
    END IF;
    RETURN EXISTS (
      SELECT 1
      FROM public.matriculas m
      JOIN public.aulas au ON au.id = m.aula_id
      JOIN public.vinculos_familiares vf ON vf.nino_id = m.nino_id
      WHERE au.centro_id = a.centro_id
        AND m.fecha_baja IS NULL
        AND m.deleted_at IS NULL
        AND m.estado = 'activa'
        AND vf.usuario_id = v_usuario
        AND vf.deleted_at IS NULL
        AND COALESCE((vf.permisos ->> 'puede_recibir_mensajes')::boolean, false) = true
    );
  END IF;

  RETURN FALSE;
END;
$function$;

-- public.usuario_es_audiencia_anuncio_row(uuid,uuid,ambito_anuncio,uuid): 1 llamada
CREATE OR REPLACE FUNCTION public.usuario_es_audiencia_anuncio_row(p_centro_id uuid, p_autor_id uuid, p_ambito ambito_anuncio, p_aula_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_usuario uuid := auth.uid();
BEGIN
  IF v_usuario IS NULL THEN
    RETURN FALSE;
  END IF;

  IF public.es_admin(p_centro_id) THEN
    RETURN TRUE;
  END IF;

  IF p_autor_id = v_usuario THEN
    RETURN TRUE;
  END IF;

  IF p_ambito = 'aula' THEN
    IF privado.centro_de_aula(p_aula_id) IS DISTINCT FROM p_centro_id THEN
      RETURN FALSE;
    END IF;
    IF public.es_profe_de_aula(p_aula_id) THEN
      RETURN TRUE;
    END IF;
    RETURN EXISTS (
      SELECT 1
      FROM public.matriculas m
      JOIN public.vinculos_familiares vf ON vf.nino_id = m.nino_id
      WHERE m.aula_id = p_aula_id
        AND m.fecha_baja IS NULL
        AND m.deleted_at IS NULL
        AND m.estado = 'activa'
        AND vf.usuario_id = v_usuario
        AND vf.deleted_at IS NULL
        AND COALESCE((vf.permisos ->> 'puede_recibir_mensajes')::boolean, false) = true
    );
  END IF;

  IF p_ambito = 'centro' THEN
    IF EXISTS (
      SELECT 1
      FROM public.profes_aulas pa
      JOIN public.aulas au ON au.id = pa.aula_id
      WHERE pa.profe_id = v_usuario
        AND pa.fecha_fin IS NULL
        AND pa.deleted_at IS NULL
        AND au.centro_id = p_centro_id
    ) THEN
      RETURN TRUE;
    END IF;
    RETURN EXISTS (
      SELECT 1
      FROM public.matriculas m
      JOIN public.aulas au ON au.id = m.aula_id
      JOIN public.vinculos_familiares vf ON vf.nino_id = m.nino_id
      WHERE au.centro_id = p_centro_id
        AND m.fecha_baja IS NULL
        AND m.deleted_at IS NULL
        AND m.estado = 'activa'
        AND vf.usuario_id = v_usuario
        AND vf.deleted_at IS NULL
        AND COALESCE((vf.permisos ->> 'puede_recibir_mensajes')::boolean, false) = true
    );
  END IF;

  RETURN FALSE;
END;
$function$;

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_nombres constant text[] := ARRAY['aula_de_publicacion', 'autor_de_publicacion', 'autorizacion_aplica_a_nino', 'autorizacion_firmable', 'autorizacion_plantilla_valida', 'centro_de_agenda', 'centro_de_aula', 'centro_de_cita', 'centro_de_concepto', 'centro_de_evento', 'centro_de_familia', 'centro_de_nino', 'centro_de_plantilla', 'centro_de_publicacion', 'centro_de_recibo', 'conversacion_activa', 'evento_aplica_a_nino', 'familia_de_recibo', 'fecha_de_agenda', 'medicacion_administrable_hoy', 'nino_de_agenda', 'nino_puede_aparecer', 'organizador_de_cita', 'publicacion_de_media', 'ruta_coherente'];
  v_re text;
  v_re_privado text;
  v_despues constant jsonb := '{
    "privado.autorizacion_aplica_a_nino(uuid,uuid)": "c18e57ff17f2e42cc2aa9b2d80987b8f",
    "privado.ruta_coherente(text,text)": "5fce6211e90610931afdcb23481b3ec9",
    "public.actualizar_foto_nino_tutor(uuid,text)": "5aba05f235f10d363073bd544d606b1f",
    "public.anuncios_validar_aula_centro()": "5cf5e02277a6489e3e77ea03bd0eafc6",
    "public.audit_trigger_function()": "4fca0468976a319f6bb5d895af702833",
    "public.aulas_curso_set_centro_id()": "0b64dde39bcee35dd365bad0af5b488e",
    "public.autorizaciones_set_centro_id()": "4df2f1a438312b16c590958bb1ff755d",
    "public.cita_invitados_set_centro_id()": "1cceb7215315bf6e090c330484227f05",
    "public.citas_set_centro_id()": "91e4b1d0f03e195aa3feb6478e173066",
    "public.congelar_si_mes_cerrado()": "2e4c101653c8456a89a04fed2e5245f6",
    "public.conversaciones_set_centro_id()": "0c7e3dcb03bc895148a9b3da2b3c06c1",
    "public.crear_recibo_esporadico(uuid,uuid,uuid,integer,integer,text,text,jsonb)": "b8d86d20e4280e1c2acc7561e4bdfead",
    "public.derivar_centro_id_de_familia()": "9356d0c3ed653456d660f76a74dcb5f3",
    "public.derivar_centro_id_de_mandato_sepa()": "334ceeb9a6e85171cf9d995f18871e4e",
    "public.derivar_centro_id_de_nino()": "689ac64cc631083d0b107b137071784f",
    "public.derivar_centro_id_de_recibo()": "1e9919f97c5d6281597170a439011332",
    "public.derivar_centro_id_de_recibo_familia()": "07913fae9fd9456bf26aa385698ab102",
    "public.derivar_centro_id_nino_o_familia()": "5461ca1dac40487e8e0e24620117d9a9",
    "public.es_profe_de_aula(uuid)": "7bee8bd693af7c9b6cce92a255e58656",
    "public.es_redactor_de_aula(uuid)": "4cf09b6db278794f05f229d3a9d5f228",
    "public.eventos_set_centro_id()": "3a84233519a714a1b6e7d00e853584fd",
    "public.existe_consentimiento_imagen(uuid)": "52155372b5be084cdd590e8c0faa4338",
    "public.export_datos_sujeto(text,uuid)": "245c971e0af4083395a939dc099f813f",
    "public.familia_tutores_derivar_centro()": "24649a37ac452019e13ed6151a08f256",
    "public.firma_imagen_sync()": "bf1f1a278def5c76aa4ffe40aab23dc9",
    "public.get_motivos_baja_matriculas(uuid[])": "ccc0f3dd6e3c06c6be5bf572c282cd05",
    "public.invitaciones_validar_centro()": "8cb40ff94bf7c9795db4979dba526bd4",
    "public.marcar_matricula_lista(uuid)": "dc4e015833762a4958adfb1d9afd4b47",
    "public.media_etiquetas_set_centro_id()": "f52c5e0ffcc54270c10c657375a9944f",
    "public.media_set_centro_id()": "43beb4c14b835ef2f788aca7b66a1fec",
    "public.media_validar_ruta()": "fc8cb59d3477ce70b25858cfdfbdb440",
    "public.nino_toma_comida_solida(uuid)": "9d650b1a704a6f0dc02627935b653def",
    "public.otorgar_consentimiento_imagen(uuid,uuid,text,inet,text,firma_metodo)": "ff7f77888aa80719f08463301a094891",
    "public.promover_a_titular(uuid)": "246ddd1d38ce9900c65529b029d6ccc8",
    "public.publicaciones_set_centro_id()": "2797a414fd19129fa729debbd9fe765b",
    "public.recordatorios_set_centro_id()": "b84777003844408380074720285c2dd2",
    "public.registrar_mandato_sepa(uuid,uuid,text,text,text,text,text,text,text,inet,text,timestamp with time zone,firma_metodo)": "37545206ffc6f0babcc81b2281ad0e84",
    "public.revocar_consentimiento_imagen(uuid)": "1aedf6ae08dec15c8621ecd303445800",
    "public.set_info_medica_emergencia_cifrada_tutor(uuid,text,text,text,text,text,text,boolean)": "fc79dc7e972c48a653ac7f9170b23944",
    "public.sustituir_mandato_sepa(uuid,uuid,text,text,text,text,text,text,text,inet,text,timestamp with time zone,firma_metodo)": "301cad5c7c5579b869e3af3be785bdc5",
    "public.usuario_es_audiencia_anuncio(uuid)": "70028074a4431324ec5a13dc0adafcd8",
    "public.usuario_es_audiencia_anuncio_row(uuid,uuid,ambito_anuncio,uuid)": "b4a29803a90cf53b3cebe630c8ef524f"
  }'::jsonb;
  v_n int;
  v_mal text;
  v_pol int;
BEGIN
  v_re := '\m(' || array_to_string(v_nombres, '|') || ')\s*\(';
  v_re_privado := 'privado\.(' || array_to_string(v_nombres, '|') || ')\s*\(';

  -- 1. Las 25 están en privado y son las mismas (mismo oid); ninguna queda en public.
  SELECT count(*) INTO v_n
    FROM _privado_antes a JOIN pg_proc p ON p.oid = a.oid
   WHERE a.mueve AND p.pronamespace = 'privado'::regnamespace AND p.proname = a.proname;
  IF v_n <> 25 OR EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = ANY (v_nombres)) THEN
    RAISE EXCEPTION 'en privado hay % de las 25 con su oid, o alguna sigue en public', v_n;
  END IF;

  -- 2. Ningún cuerpo, en ningún esquema, llama a una de las 25 sin `privado.` (sin comentarios).
  SELECT string_agg(n.nspname || '.' || p.proname, ', ') INTO v_mal
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
     AND regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), v_re_privado, '', 'g') ~ v_re;
  IF v_mal IS NOT NULL THEN
    RAISE EXCEPTION 'siguen llamando sin privado.: %', v_mal;
  END IF;

  -- 3. Los 42 cuerpos que las llaman son los de esta migración.
  SELECT string_agg(coalesce(e.key, a.sig) || '=' || coalesce(a.md5, 'falta'), ', ')
    INTO v_mal
    FROM (SELECT n.nspname || '.' || p.proname || substr(p.oid::regprocedure::text, strpos(p.oid::regprocedure::text, '(')) AS sig,
                 md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')) AS md5
            FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
             AND p.prosrc ~ v_re_privado) a
    FULL JOIN jsonb_each_text(v_despues) e ON e.key = a.sig
   WHERE a.md5 IS DISTINCT FROM e.value;
  IF v_mal IS NOT NULL THEN
    RAISE EXCEPTION 'los cuerpos recreados no son los esperados: %', v_mal;
  END IF;

  -- 4. Permisos, dueño, SECURITY DEFINER y search_path de las 65: como antes.
  SELECT string_agg(a.proname, ', ') INTO v_mal
    FROM _privado_antes a LEFT JOIN pg_proc p ON p.oid = a.oid
   WHERE p.oid IS NULL
      OR p.prosecdef IS DISTINCT FROM a.prosecdef
      OR p.proowner IS DISTINCT FROM a.proowner
      OR array_to_string(p.proconfig, ',') IS DISTINCT FROM a.cfg
      OR array_to_string(p.proacl, ',') IS DISTINCT FROM a.acl;
  SELECT count(*) INTO v_n FROM _privado_antes;
  IF v_mal IS NOT NULL OR v_n <> 65 THEN
    RAISE EXCEPTION 'de % funciones, cambian permisos o atributos: %', v_n, v_mal;
  END IF;

  -- 5. El esquema: USAGE para authenticated y service_role; ni anon ni PUBLIC; nadie crea.
  IF NOT has_schema_privilege('authenticated', 'privado', 'USAGE')
     OR NOT has_schema_privilege('service_role', 'privado', 'USAGE')
     OR has_schema_privilege('anon', 'privado', 'USAGE')
     OR has_schema_privilege('public', 'privado', 'USAGE')
     OR has_schema_privilege('authenticated', 'privado', 'CREATE')
     OR has_schema_privilege('service_role', 'privado', 'CREATE') THEN
    RAISE EXCEPTION 'privado: permisos de esquema inesperados';
  END IF;

  -- 6. Las policies siguen a las mismas funciones.
  SELECT count(*) INTO v_pol FROM _privado_policies_antes;
  SELECT count(*) INTO v_n
    FROM _privado_policies_antes a
   WHERE EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_policy'::regclass
                    AND d.objid = a.objid AND d.refobjid = a.refobjid);
  IF v_n <> v_pol THEN
    RAISE EXCEPTION 'policies: % de % dependencias siguen en su sitio', v_n, v_pol;
  END IF;

  RAISE NOTICE 'guarda posterior: 25 en privado con su oid; 0 llamadas sin privado.; 42 cuerpos como en el repo; 65 funciones con sus permisos; % dependencias de policies en su sitio',
    v_pol;
END $guarda$;

DROP TABLE _privado_antes;
DROP TABLE _privado_policies_antes;
