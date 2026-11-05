-- =============================================================================
-- FEAT — Las firmas de los documentos del centro (serie de altas, paso 1, pieza 1b; 2026-11-05)
-- -----------------------------------------------------------------------------
-- Spec: docs/specs/altas-serie.md, «Paso 1». La familia firma, con trazo (D2), la versión exacta de
-- un documento del centro (1a, 20270101120000). Esta pieza es la tabla y todo lo que la retención
-- ya hace con las firmas de autorizaciones; la pantalla de firmar es el paso 2, que es quien escribe.
--
-- - `firmas_documentos_centro`: una firma por versión y niño (J3: basta un tutor, y se guarda quién
--   firmó). Apunta a la versión con RESTRICT. Lleva copia de lo firmado (título, número, curso con
--   su nombre y sha256), que pone el trigger desde la versión: la firma dice qué se firmó aunque nadie de la
--   familia pueda leer la tabla de versiones. No cambia nunca.
-- - **El primer `ENABLE ALWAYS` del esquema.** Una versión con firmas no se borra nunca (J5). El
--   RESTRICT no basta: `postgres` lo salta con `session_replication_role = replica` (medido el
--   2026-11-05; rls-policies.md, «La llave de postgres»). Un trigger propio en `ENABLE ALWAYS` sí
--   dispara en `replica`. Por eso está ahí, y por eso no se quita al refactorizar.
-- - La retención, la misma que `firmas_autorizacion` (medido en producción el 2026-11-05): la
--   política RESTRICTIVE `bloqueo_retencion`, Datos bloqueados (`datos_bloqueados`,
--   `contenido_bloqueado`), lo que conserva al niño (`queda_conservado_nino`) y la cuenta del firmante
--   (`quedan_firmas_usuario`), la destrucción a los 5 años (`destruir_firmas_nino`), las claves de la
--   redacción (`_claves_pii_nino`) y la auditoría (`audit_trigger_function`). Anular un alta sin
--   terminar se las lleva por la cascada del niño, como las de autorizaciones.
-- - Leen: quien firmó, los tutores del niño y la Dirección del centro. Nadie escribe con sesión
--   todavía (el paso 2 traerá la función de firmar).
--
-- Sin orden con el despliegue: la tabla es nueva y las funciones reescritas devuelven una clave más.
-- La aplica el responsable por SQL Editor, copiando el fichero. Tras aplicar: registrar en
-- supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
  r     record;
BEGIN
  IF to_regclass('public.firmas_documentos_centro') IS NOT NULL THEN
    RAISE EXCEPTION 'ya aplicada: existe public.firmas_documentos_centro';
  END IF;
  IF to_regclass('public.documentos_centro_versiones') IS NULL THEN
    RAISE EXCEPTION 'falta 20270101120000 (los documentos del centro): esta va detrás';
  END IF;

  -- Lo que se reescribe es lo que hay, tal como quedó.
  FOR r IN SELECT * FROM (VALUES
      ('privado.contenido_bloqueado(uuid,text,uuid)', '16de04f69d0cdac20a5ecd54b053ccf8', '20261205120000'),
      ('privado.datos_bloqueados(text,uuid,boolean)', 'fbe2bcb3d5fb6674c70c0fc17260095d', '20261205120000'),
      ('privado.queda_conservado_nino(uuid)', 'f6dcdd04999fda95d9e3eccc71bc8a52', '20261207120000'),
      ('privado.quedan_firmas_usuario(uuid,uuid)', '8215ae2002a8dec80d628ed6f3da3cf4', '20261207120000'),
      ('public._claves_pii_nino(text)', '134c101b177d508759f3d800ebaf2fd8', '20261012140000'),
      ('public.audit_trigger_function()', '50947cd3f092eb30981534901bc3fa3a', '20261202120000'),
      ('public.destruir_firmas_nino(uuid,integer)', 'da902f728136f5b249c3f8c31bafef0d', '20261207120000')
    ) AS t(f, md5, mig)
  LOOP
    SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
      INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f);
    IF v_md5 IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION '% no es la de %: %', r.f, r.mig, coalesce(v_md5, 'falta');
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
               JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname = 'public' AND NOT t.tgisinternal AND t.tgenabled = 'A') THEN
    RAISE EXCEPTION 'ya hay un trigger ENABLE ALWAYS en public: este no es el primero';
  END IF;

  RAISE NOTICE 'guarda previa: % documentos, % versiones, % firmas de autorizaciones, 0 triggers ALWAYS',
    (SELECT count(*) FROM public.documentos_centro),
    (SELECT count(*) FROM public.documentos_centro_versiones),
    (SELECT count(*) FROM public.firmas_autorizacion);
END
$guarda$;

-- ---- 1. La tabla ----
CREATE TABLE public.firmas_documentos_centro (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id         uuid NOT NULL REFERENCES public.documentos_centro_versiones(id) ON DELETE RESTRICT,
  -- La copia de lo firmado, del trigger (3a): no la escribe quien firma.
  documento_id       uuid NOT NULL REFERENCES public.documentos_centro(id) ON DELETE RESTRICT,
  centro_id          uuid NOT NULL REFERENCES public.centros(id),
  curso_academico_id uuid NULL REFERENCES public.cursos_academicos(id) ON DELETE RESTRICT,
  curso_nombre       text NULL CHECK (curso_nombre IS NULL OR char_length(curso_nombre) BETWEEN 1 AND 200),
  titulo             text NOT NULL CHECK (char_length(titulo) BETWEEN 1 AND 200),
  numero             integer NOT NULL CHECK (numero >= 1),
  sha256             text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  -- Quién y por quién. Anular un alta sin terminar borra al niño, y con él sus firmas.
  nino_id            uuid NOT NULL REFERENCES public.ninos(id) ON DELETE CASCADE,
  firmante_id        uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  rol_firmante       public.tipo_vinculo NOT NULL,
  -- La firma (D2: con trazo), como en firmas_autorizacion.
  nombre_tecleado    text NOT NULL CHECK (char_length(nombre_tecleado) BETWEEN 1 AND 200),
  firma_imagen       text NOT NULL CHECK (char_length(firma_imagen) BETWEEN 1 AND 500000),
  ip_address         inet NULL,
  user_agent         text NULL,
  firmado_at         timestamptz NOT NULL DEFAULT now(),
  -- J3: una por versión y niño, no por firmante.
  CONSTRAINT firmas_documentos_centro_una_por_nino UNIQUE (version_id, nino_id)
);
CREATE INDEX idx_firmas_documentos_centro_nino ON public.firmas_documentos_centro (nino_id);
CREATE INDEX idx_firmas_documentos_centro_firmante ON public.firmas_documentos_centro (firmante_id);
CREATE INDEX idx_firmas_documentos_centro_centro ON public.firmas_documentos_centro (centro_id);

-- ---- 2. Quién la lee, y el bloqueo de la retención ----
ALTER TABLE public.firmas_documentos_centro ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.firmas_documentos_centro FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.firmas_documentos_centro TO authenticated;

-- Quien firmó, los tutores del niño y la Dirección del centro. La profe no (es del alta).
CREATE POLICY firmas_documentos_centro_select ON public.firmas_documentos_centro
  FOR SELECT TO authenticated
  USING (firmante_id = auth.uid() OR public.es_tutor_de(nino_id) OR public.es_admin(centro_id));

-- La misma que firmas_autorizacion: lo bloqueado por la retención no se lee con sesión.
CREATE POLICY bloqueo_retencion ON public.firmas_documentos_centro
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT privado.firma_bloqueada(nino_id, firmante_id))
  WITH CHECK (NOT privado.firma_bloqueada(nino_id, firmante_id));

-- ---- 3. Las defensas ----

-- 3a. La firma: la copia de lo firmado sale de la versión, el niño es del centro del documento, y
--     la fila no cambia nunca. Se borra solo por la retención (destruir_firmas_nino) o con el niño.
CREATE OR REPLACE FUNCTION privado.firma_documento_defensa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_ver public.documentos_centro_versiones%ROWTYPE;
  v_doc public.documentos_centro%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'una firma de un documento del centro no cambia nunca'
      USING ERRCODE = 'P0001', HINT = 'firma_inmutable';
  END IF;
  SELECT * INTO v_ver FROM public.documentos_centro_versiones WHERE id = NEW.version_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'la versión no existe' USING ERRCODE = '23503', HINT = 'sin_version';
  END IF;
  SELECT * INTO v_doc FROM public.documentos_centro WHERE id = v_ver.documento_id;
  IF privado.centro_de_nino(NEW.nino_id) IS DISTINCT FROM v_ver.centro_id THEN
    RAISE EXCEPTION 'el niño no es del centro del documento' USING ERRCODE = '23514', HINT = 'centro_ajeno';
  END IF;
  NEW.documento_id       := v_ver.documento_id;
  NEW.centro_id          := v_ver.centro_id;
  NEW.curso_academico_id := v_ver.curso_academico_id;
  NEW.numero             := v_ver.numero;
  NEW.sha256             := v_ver.sha256;
  NEW.titulo             := v_doc.titulo;
  NEW.curso_nombre       := (SELECT c.nombre FROM public.cursos_academicos c WHERE c.id = v_ver.curso_academico_id);
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION privado.firma_documento_defensa() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER firmas_documentos_centro_defensa
  BEFORE INSERT OR UPDATE ON public.firmas_documentos_centro
  FOR EACH ROW EXECUTE FUNCTION privado.firma_documento_defensa();

-- 3b. EL PRIMER `ENABLE ALWAYS` DEL ESQUEMA. Una versión con firmas no se borra nunca (J5).
--     El RESTRICT de la tabla de firmas lo dice, pero no lo sostiene: con
--     `SET LOCAL session_replication_role = replica` (que solo puede poner postgres) no disparan
--     los triggers internos de las claves foráneas, y el borrado pasa. Un trigger propio en
--     `ENABLE ALWAYS` dispara también en `replica`. Este es lo único que sostiene el J5 contra la
--     llave de postgres; no es un adorno, no se quita ni se pasa a ENABLE al refactorizar.
--     TRUNCATE no pasa por los triggers de fila: lo cubre el de sentencia, también ALWAYS.
CREATE OR REPLACE FUNCTION privado.version_documento_firmada()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF TG_OP = 'TRUNCATE' THEN
    IF EXISTS (SELECT 1 FROM public.firmas_documentos_centro) THEN
      RAISE EXCEPTION 'hay versiones firmadas: no se vacía la tabla'
        USING ERRCODE = '23503', HINT = 'version_firmada';
    END IF;
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM public.firmas_documentos_centro WHERE version_id = OLD.id) THEN
    RAISE EXCEPTION 'una versión firmada no se borra nunca'
      USING ERRCODE = '23503', HINT = 'version_firmada';
  END IF;
  RETURN OLD;
END
$function$;
REVOKE ALL ON FUNCTION privado.version_documento_firmada() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER documentos_centro_versiones_firmada
  BEFORE DELETE ON public.documentos_centro_versiones
  FOR EACH ROW EXECUTE FUNCTION privado.version_documento_firmada();
CREATE TRIGGER documentos_centro_versiones_firmada_truncate
  BEFORE TRUNCATE ON public.documentos_centro_versiones
  FOR EACH STATEMENT EXECUTE FUNCTION privado.version_documento_firmada();
ALTER TABLE public.documentos_centro_versiones ENABLE ALWAYS TRIGGER documentos_centro_versiones_firmada;
ALTER TABLE public.documentos_centro_versiones ENABLE ALWAYS TRIGGER documentos_centro_versiones_firmada_truncate;

-- 3c. La auditoría, como firmas_autorizacion (con centro_id directo).
CREATE TRIGGER audit_firmas_documentos_centro
  AFTER INSERT OR UPDATE OR DELETE ON public.firmas_documentos_centro
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

-- ---- 4. La retención: las mismas funciones, con la tabla nueva al lado de las firmas ----
-- Cada una es la definición viva de producción (2026-11-05) con la tabla nueva añadida.


CREATE OR REPLACE FUNCTION privado.queda_conservado_nino(p_nino_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.firmas_autorizacion WHERE nino_id = p_nino_id)
      OR EXISTS (SELECT 1 FROM public.acuses_alta WHERE nino_id = p_nino_id)
      OR EXISTS (SELECT 1 FROM public.firmas_documentos_centro WHERE nino_id = p_nino_id)
      OR EXISTS (SELECT 1 FROM public.consentimientos WHERE nino_id = p_nino_id)
      OR EXISTS (SELECT 1 FROM public.administraciones_medicacion WHERE nino_id = p_nino_id)
      OR EXISTS (SELECT 1 FROM public.autorizaciones WHERE nino_id = p_nino_id)
      OR EXISTS (SELECT 1 FROM public.eventos WHERE ambito = 'nino' AND nino_id = p_nino_id);
$function$;

CREATE OR REPLACE FUNCTION privado.quedan_firmas_usuario(p_centro_id uuid, p_usuario_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.firmas_autorizacion f
                  WHERE f.firmante_id = p_usuario_id AND privado.centro_de_nino(f.nino_id) = p_centro_id)
      OR EXISTS (SELECT 1 FROM public.consentimientos c
                  WHERE c.usuario_id = p_usuario_id AND c.nino_id IS NOT NULL
                    AND privado.centro_de_nino(c.nino_id) = p_centro_id)
      OR EXISTS (SELECT 1 FROM public.acuses_alta aa
                  WHERE aa.firmante_id = p_usuario_id AND aa.centro_id = p_centro_id)
      OR EXISTS (SELECT 1 FROM public.firmas_documentos_centro fd
                  WHERE fd.firmante_id = p_usuario_id AND fd.centro_id = p_centro_id);
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
                            'direccion_ciudad', 'libro_familia_path', 'estado_civil_familia']
    WHEN 'datos_pedagogicos_nino' THEN ARRAY['lactancia_observaciones', 'control_esfinteres_observaciones',
                            'siesta_horario_habitual', 'siesta_observaciones',
                            'alimentacion_observaciones', 'idiomas_casa']
    WHEN 'matriculas' THEN ARRAY['motivo_baja']
    WHEN 'firmas_autorizacion' THEN ARRAY['firma_imagen', 'comentario', 'datos']
    WHEN 'firmas_documentos_centro' THEN ARRAY['firma_imagen']
    WHEN 'autorizaciones' THEN ARRAY['titulo', 'texto', 'datos']
    WHEN 'cita_invitados' THEN ARRAY['comentario']
    WHEN 'lista_espera' THEN ARRAY['nombre_nino', 'apellidos_nino', 'telefono_tutor', 'email_tutor', 'nota']
    ELSE ARRAY[]::text[]
  END;
$function$;

CREATE OR REPLACE FUNCTION privado.contenido_bloqueado(p_centro_id uuid, p_sujeto_tipo text, p_sujeto_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN p_sujeto_tipo = 'nino' THEN jsonb_build_object(
    'firmas', COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.firmado_at)
                          FROM public.firmas_autorizacion f WHERE f.nino_id = p_sujeto_id), '[]'::jsonb),
    'autorizaciones', COALESCE((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at)
                                  FROM public.autorizaciones a WHERE a.nino_id = p_sujeto_id), '[]'::jsonb),
    'consentimientos', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.aceptado_en)
                                   FROM public.consentimientos c WHERE c.nino_id = p_sujeto_id), '[]'::jsonb),
    'acuses_alta', COALESCE((SELECT jsonb_agg(to_jsonb(aa) ORDER BY aa.aceptado_en)
                               FROM public.acuses_alta aa WHERE aa.nino_id = p_sujeto_id), '[]'::jsonb),
    'firmas_documentos', COALESCE((SELECT jsonb_agg(to_jsonb(fd) ORDER BY fd.firmado_at)
                                     FROM public.firmas_documentos_centro fd
                                    WHERE fd.nino_id = p_sujeto_id), '[]'::jsonb),
    'medicacion_administrada', COALESCE((SELECT jsonb_agg(to_jsonb(am) ORDER BY am.administrado_en)
                                           FROM public.administraciones_medicacion am
                                          WHERE am.nino_id = p_sujeto_id), '[]'::jsonb),
    'lecturas_ficha_medica', COALESCE((SELECT jsonb_agg(to_jsonb(l) || jsonb_build_object('lector', u.nombre_completo)
                                                        ORDER BY l.leida_en)
                                         FROM public.lecturas_ficha_medica l
                                         LEFT JOIN public.usuarios u ON u.id = l.lector_id
                                        WHERE l.nino_id = p_sujeto_id), '[]'::jsonb))
  ELSE jsonb_build_object(
    'firmas', COALESCE((SELECT jsonb_agg(to_jsonb(f) ORDER BY f.firmado_at)
                          FROM public.firmas_autorizacion f
                         WHERE f.firmante_id = p_sujeto_id
                           AND privado.centro_de_nino(f.nino_id) = p_centro_id), '[]'::jsonb),
    'consentimientos', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.aceptado_en)
                                   FROM public.consentimientos c
                                  WHERE c.usuario_id = p_sujeto_id AND c.nino_id IS NOT NULL
                                    AND privado.centro_de_nino(c.nino_id) = p_centro_id), '[]'::jsonb),
    'acuses_alta', COALESCE((SELECT jsonb_agg(to_jsonb(aa) ORDER BY aa.aceptado_en)
                               FROM public.acuses_alta aa
                              WHERE aa.firmante_id = p_sujeto_id AND aa.centro_id = p_centro_id), '[]'::jsonb),
    'firmas_documentos', COALESCE((SELECT jsonb_agg(to_jsonb(fd) ORDER BY fd.firmado_at)
                                     FROM public.firmas_documentos_centro fd
                                    WHERE fd.firmante_id = p_sujeto_id
                                      AND fd.centro_id = p_centro_id), '[]'::jsonb))
  END;
$function$;

CREATE OR REPLACE FUNCTION privado.datos_bloqueados(p_sujeto_tipo text, p_sujeto_id uuid, p_todos boolean)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH filas(codigo, desde) AS (
    -- ---- del niño ----
    SELECT 'firmas', LEAST(privado.nino_bloqueado_desde(f.nino_id),
                           privado.usuario_olvidado_desde(f.firmante_id, privado.centro_de_nino(f.nino_id)))
      FROM public.firmas_autorizacion f
     WHERE p_sujeto_tipo = 'nino' AND f.nino_id = p_sujeto_id
       AND privado.firma_bloqueada(f.nino_id, f.firmante_id)
    UNION ALL
    SELECT 'autorizaciones', privado.nino_bloqueado_desde(a.nino_id)
      FROM public.autorizaciones a
     WHERE p_sujeto_tipo = 'nino' AND a.nino_id = p_sujeto_id AND privado.nino_bloqueado(a.nino_id)
    UNION ALL
    SELECT 'consentimientos', LEAST(privado.nino_bloqueado_desde(c.nino_id),
                                    privado.usuario_olvidado_desde(c.usuario_id, privado.centro_de_nino(c.nino_id)))
      FROM public.consentimientos c
     WHERE p_sujeto_tipo = 'nino' AND c.nino_id = p_sujeto_id
       AND privado.consentimiento_bloqueado(c.usuario_id, c.nino_id)
    UNION ALL
    SELECT 'acuses_alta', LEAST(privado.nino_bloqueado_desde(aa.nino_id),
                                privado.usuario_olvidado_desde(aa.firmante_id, aa.centro_id))
      FROM public.acuses_alta aa
     WHERE p_sujeto_tipo = 'nino' AND aa.nino_id = p_sujeto_id
       AND privado.firma_bloqueada(aa.nino_id, aa.firmante_id)
    UNION ALL
    SELECT 'firmas_documentos', LEAST(privado.nino_bloqueado_desde(fd.nino_id),
                                      privado.usuario_olvidado_desde(fd.firmante_id, fd.centro_id))
      FROM public.firmas_documentos_centro fd
     WHERE p_sujeto_tipo = 'nino' AND fd.nino_id = p_sujeto_id
       AND privado.firma_bloqueada(fd.nino_id, fd.firmante_id)
    UNION ALL
    SELECT 'medicacion_administrada', privado.nino_bloqueado_desde(am.nino_id)
      FROM public.administraciones_medicacion am
     WHERE p_sujeto_tipo = 'nino' AND am.nino_id = p_sujeto_id AND privado.nino_bloqueado(am.nino_id)
    UNION ALL
    SELECT 'lecturas_ficha_medica', privado.nino_bloqueado_desde(l.nino_id)
      FROM public.lecturas_ficha_medica l
     WHERE p_sujeto_tipo = 'nino' AND l.nino_id = p_sujeto_id AND privado.nino_bloqueado(l.nino_id)
    -- ---- del usuario ----
    UNION ALL
    SELECT 'firmas', LEAST(privado.nino_bloqueado_desde(f.nino_id),
                           privado.usuario_olvidado_desde(f.firmante_id, privado.centro_de_nino(f.nino_id)))
      FROM public.firmas_autorizacion f
     WHERE p_sujeto_tipo = 'usuario' AND f.firmante_id = p_sujeto_id
       AND privado.firma_bloqueada(f.nino_id, f.firmante_id)
       AND (p_todos OR privado.es_responsable(privado.centro_de_nino(f.nino_id)))
    UNION ALL
    SELECT 'consentimientos', CASE WHEN c.nino_id IS NULL
                                   THEN privado.usuario_olvidado_desde(c.usuario_id, NULL)
                                   ELSE LEAST(privado.nino_bloqueado_desde(c.nino_id),
                                              privado.usuario_olvidado_desde(c.usuario_id,
                                                                             privado.centro_de_nino(c.nino_id))) END
      FROM public.consentimientos c
     WHERE p_sujeto_tipo = 'usuario' AND c.usuario_id = p_sujeto_id
       AND privado.consentimiento_bloqueado(c.usuario_id, c.nino_id)
       AND (p_todos OR (c.nino_id IS NOT NULL AND privado.es_responsable(privado.centro_de_nino(c.nino_id))))
    UNION ALL
    SELECT 'acuses_alta', LEAST(privado.nino_bloqueado_desde(aa.nino_id),
                                privado.usuario_olvidado_desde(aa.firmante_id, aa.centro_id))
      FROM public.acuses_alta aa
     WHERE p_sujeto_tipo = 'usuario' AND aa.firmante_id = p_sujeto_id
       AND privado.firma_bloqueada(aa.nino_id, aa.firmante_id)
       AND (p_todos OR privado.es_responsable(aa.centro_id))
    UNION ALL
    SELECT 'firmas_documentos', LEAST(privado.nino_bloqueado_desde(fd.nino_id),
                                      privado.usuario_olvidado_desde(fd.firmante_id, fd.centro_id))
      FROM public.firmas_documentos_centro fd
     WHERE p_sujeto_tipo = 'usuario' AND fd.firmante_id = p_sujeto_id
       AND privado.firma_bloqueada(fd.nino_id, fd.firmante_id)
       AND (p_todos OR privado.es_responsable(fd.centro_id))
  )
  SELECT jsonb_agg(jsonb_build_object('codigo', codigo, 'n', n, 'desde', desde) ORDER BY codigo)
    FROM (SELECT codigo, count(*) AS n, min(desde) AS desde FROM filas GROUP BY codigo) x;
$function$;

CREATE OR REPLACE FUNCTION public.destruir_firmas_nino(p_nino_id uuid, p_anios integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_centro    uuid;
  v_n         integer;
  v_ids       uuid[];
  v_firmantes uuid[] := '{}';
  r           jsonb := '{}'::jsonb;
BEGIN
  IF p_anios IS NULL OR p_anios < 1 THEN
    RAISE EXCEPTION 'plazo de las firmas no válido' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT centro_id INTO v_centro FROM public.ninos
   WHERE id = p_nino_id AND deleted_reason = 'purga_rgpd' FOR UPDATE;
  IF NOT FOUND OR NOT privado.firmas_nino_vencidas(p_nino_id, p_anios) THEN
    RETURN NULL;
  END IF;

  PERFORM set_config('app.audit_actor', 'system:destruir_firmas_vencidas', true);
  PERFORM set_config('app.borrar_sin_copia', 'on', true);

  -- La medicación administrada primero: apunta a su autorización (RESTRICT).
  DELETE FROM public.administraciones_medicacion WHERE nino_id = p_nino_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  r := r || jsonb_build_object('medicacion_administrada', v_n);

  -- Lo firmado o consentido, salvo lo de un tutor retenido en el centro (Retención, PR-8).
  WITH b AS (
    DELETE FROM public.firmas_autorizacion f
     WHERE f.nino_id = p_nino_id AND NOT privado.retenido(v_centro, 'usuario', f.firmante_id)
    RETURNING f.firmante_id
  )
  SELECT count(*), coalesce(array_agg(DISTINCT firmante_id), '{}') INTO v_n, v_ids FROM b;
  v_firmantes := v_firmantes || v_ids;
  r := r || jsonb_build_object('firmas', v_n);

  -- Los documentos del centro firmados (1b), con la misma regla: la del tutor retenido se queda.
  WITH b AS (
    DELETE FROM public.firmas_documentos_centro fd
     WHERE fd.nino_id = p_nino_id AND NOT privado.retenido(v_centro, 'usuario', fd.firmante_id)
    RETURNING fd.firmante_id
  )
  SELECT count(*), coalesce(array_agg(DISTINCT firmante_id), '{}') INTO v_n, v_ids FROM b;
  v_firmantes := v_firmantes || v_ids;
  r := r || jsonb_build_object('firmas_documentos', v_n);

  WITH b AS (
    DELETE FROM public.acuses_alta aa
     WHERE aa.nino_id = p_nino_id
       AND NOT (aa.firmante_id IS NOT NULL AND privado.retenido(v_centro, 'usuario', aa.firmante_id))
    RETURNING aa.firmante_id
  )
  SELECT count(*), coalesce(array_agg(DISTINCT firmante_id) FILTER (WHERE firmante_id IS NOT NULL), '{}')
    INTO v_n, v_ids FROM b;
  v_firmantes := v_firmantes || v_ids;
  r := r || jsonb_build_object('acuses_alta', v_n);

  WITH b AS (
    DELETE FROM public.consentimientos c
     WHERE c.nino_id = p_nino_id AND NOT privado.retenido(v_centro, 'usuario', c.usuario_id)
    RETURNING c.usuario_id
  )
  SELECT count(*), coalesce(array_agg(DISTINCT usuario_id), '{}') INTO v_n, v_ids FROM b;
  v_firmantes := v_firmantes || v_ids;
  r := r || jsonb_build_object('consentimientos', v_n);

  -- Sus autorizaciones y las de sus eventos, si ya no les cuelga ninguna firma (la de un tutor
  -- retenido las sostiene), ni medicación, ni otra autorización que las use de plantilla.
  DELETE FROM public.autorizaciones a
   WHERE (a.nino_id = p_nino_id
          OR a.evento_id IN (SELECT e.id FROM public.eventos e
                              WHERE e.ambito = 'nino' AND e.nino_id = p_nino_id))
     AND NOT EXISTS (SELECT 1 FROM public.firmas_autorizacion f WHERE f.autorizacion_id = a.id)
     AND NOT EXISTS (SELECT 1 FROM public.administraciones_medicacion am
                      WHERE am.autorizacion_id = a.id)
     AND NOT EXISTS (SELECT 1 FROM public.autorizaciones x WHERE x.plantilla_id = a.id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  r := r || jsonb_build_object('autorizaciones', v_n);

  -- Los eventos de ámbito niño se quedaban por sus firmas (PR-4): se van con ellas.
  DELETE FROM public.eventos e
   WHERE e.ambito = 'nino' AND e.nino_id = p_nino_id
     AND NOT EXISTS (SELECT 1 FROM public.autorizaciones a WHERE a.evento_id = e.id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  r := r || jsonb_build_object('eventos', v_n);

  -- El registro de accesos se va cuando ya no queda nada bloqueado que mirar: del niño (también
  -- las lecturas de su ficha, que tienen su plazo), y de cada firmante en este centro.
  DELETE FROM public.accesos_datos_bloqueados x
   WHERE x.sujeto_tipo = 'nino' AND x.sujeto_id = p_nino_id
     AND privado.accesos_nino_sin_objeto(p_nino_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  r := r || jsonb_build_object('accesos_nino', v_n);

  DELETE FROM public.accesos_datos_bloqueados x
   WHERE x.centro_id = v_centro AND x.sujeto_tipo = 'usuario' AND x.sujeto_id = ANY (v_firmantes)
     AND NOT privado.retenido(v_centro, 'usuario', x.sujeto_id)
     AND NOT privado.quedan_firmas_usuario(v_centro, x.sujeto_id);
  GET DIAGNOSTICS v_n = ROW_COUNT;
  r := r || jsonb_build_object('accesos_usuarios', v_n);

  PERFORM set_config('app.borrar_sin_copia', '', true);
  PERFORM set_config('app.audit_actor', '', true);
  RETURN r;
END;
$function$;

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
    'beca_comedor_transferencia',
    -- ── Serie de altas, 1b: los documentos del centro firmados ──────────────
    'firmas_documentos_centro'
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
                                   'ip_address', 'user_agent', 'titular_documento',
                                   'titular_direccion'];
    v_despues := v_despues - ARRAY['iban_cifrado', 'firma_imagen', 'titular', 'nombre_tecleado',
                                   'ip_address', 'user_agent', 'titular_documento',
                                   'titular_direccion'];
  ELSIF TG_TABLE_NAME = 'recibos' THEN
    -- recibos: la nota del cobro manual es texto libre de la directora, y la purga no redacta
    -- recibos (se conservan). La forma y la fecha del cobro sí entran.
    v_antes   := v_antes   - 'cobro_nota';
    v_despues := v_despues - 'cobro_nota';
  END IF;

  -- ── Grupo 1 (PR B): invitaciones sin token ───────────────────────────────
  IF TG_TABLE_NAME = 'invitaciones' THEN
    v_antes   := v_antes   - 'token';
    v_despues := v_despues - 'token';
  END IF;

  -- ── Retención (F11-B, punto 6): nada vive más en audit_log que en su tabla ──
  -- Un borrado por plazo o por olvido se lleva sus copias en audit_log: las anteriores (alta y
  -- cambios) y la que escribiría este DELETE. Lo pide la purga con
  -- set_config('app.borrar_sin_copia', 'on', true), y solo vale sin humano (auth.uid() NULL):
  -- con sesión, el DELETE se audita siempre. Las cascadas pasan por aquí fila a fila, así que
  -- también se llevan las suyas.
  -- TG_TABLE_NAME es `name`, de collation "C", y `::text` la conserva: comparado así con `tabla`
  -- el índice (tabla, registro_id) solo sirve para registro_id y recorre el índice entero en cada
  -- fila (~7 ms con 370 000 filas). Con COLLATE "default" va por clave exacta (0,05 ms).
  IF TG_OP = 'DELETE' AND auth.uid() IS NULL
     AND current_setting('app.borrar_sin_copia', true) = 'on' THEN
    DELETE FROM public.audit_log
     WHERE tabla = TG_TABLE_NAME::text COLLATE "default" AND registro_id = v_registro_id;
    RETURN OLD;
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

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_t constant regclass := 'public.firmas_documentos_centro';
  v_f text;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = v_t) THEN
    RAISE EXCEPTION 'firmas_documentos_centro sin RLS';
  END IF;
  IF (SELECT count(*) FROM pg_policy WHERE polrelid = v_t) <> 2
     OR NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = v_t AND polname = 'bloqueo_retencion'
                     AND NOT polpermissive) THEN
    RAISE EXCEPTION 'firmas_documentos_centro: no son la de leer y la RESTRICTIVE de la retención';
  END IF;
  IF NOT has_table_privilege('authenticated', v_t, 'SELECT')
     OR has_table_privilege('authenticated', v_t, 'INSERT') OR has_table_privilege('authenticated', v_t, 'UPDATE')
     OR has_table_privilege('authenticated', v_t, 'DELETE') OR has_table_privilege('anon', v_t, 'SELECT')
     OR has_table_privilege('service_role', v_t, 'SELECT') OR has_table_privilege('service_role', v_t, 'INSERT')
     OR has_table_privilege('service_role', v_t, 'UPDATE') OR has_table_privilege('service_role', v_t, 'DELETE') THEN
    RAISE EXCEPTION 'firmas_documentos_centro: privilegios distintos de SELECT para authenticated';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.documentos_centro_versiones'::regclass
        AND tgname IN ('documentos_centro_versiones_firmada', 'documentos_centro_versiones_firmada_truncate')
        AND tgenabled = 'A') <> 2 THEN
    RAISE EXCEPTION 'los triggers de la versión firmada no están en ENABLE ALWAYS';
  END IF;
  IF (SELECT count(*) FROM pg_trigger WHERE tgrelid = v_t
        AND tgname IN ('firmas_documentos_centro_defensa', 'audit_firmas_documentos_centro')
        AND tgenabled = 'O') <> 2 THEN
    RAISE EXCEPTION 'faltan la defensa o la auditoría de las firmas';
  END IF;
  FOREACH v_f IN ARRAY ARRAY[
    'privado.contenido_bloqueado(uuid,text,uuid)', 'privado.datos_bloqueados(text,uuid,boolean)',
    'privado.queda_conservado_nino(uuid)', 'privado.quedan_firmas_usuario(uuid,uuid)',
    'public._claves_pii_nino(text)', 'public.audit_trigger_function()',
    'public.destruir_firmas_nino(uuid,integer)'] LOOP
    IF position('firmas_documentos_centro' IN (SELECT prosrc FROM pg_proc WHERE oid = v_f::regprocedure)) = 0 THEN
      RAISE EXCEPTION '% no mira las firmas de los documentos', v_f;
    END IF;
  END LOOP;
  RAISE NOTICE 'guarda posterior: tabla con 2 políticas y solo SELECT, 2 triggers ALWAYS, 2 de la firma, 7 funciones de la retención';
END
$guarda$;
