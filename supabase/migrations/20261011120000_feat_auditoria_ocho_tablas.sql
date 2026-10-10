-- =============================================================================
-- Auditoría (Grupo 1, PR A) — 8 tablas más en audit_log
-- -----------------------------------------------------------------------------
-- Estado en producción (2026-10-11, solo lectura): 53 tablas con el trigger de auditoría, el
-- mismo conjunto que lista docs/architecture/data-model.md. audit_trigger_function() es
-- byte a byte la de 20260817120000 (md5 normalizado 3762216841189dc6df7d438603d70569).
--
-- Se auditan desde aquí:
--   · profes_aulas — quién está a cargo de qué aula y curso. Sin centro_id: se deriva del
--     aula (centro_de_aula) y, si el aula ya no existe (DELETE en cascada), del curso.
--   · aulas, cursos_academicos, tarifa_concepto_anio, acuses_alta — centro_id directo.
--   · cambios_pendientes — centro_id directo; SIN payload ni valor_propuesto (el contenido
--     del cambio lleva datos del niño y acaba en la tabla real, que ya se audita).
--   · mandatos_sepa — centro_id directo; SIN iban_cifrado, firma_imagen, titular,
--     nombre_tecleado, ip_address ni user_agent.
--   · usuarios — sin centro (centro_id NULL). La tabla no tiene email (vive en auth.users);
--     nombre_completo lo redacta purgar_sujeto_db (registro_id = sujeto).
--
-- Principio: nada entra en audit_log que la redacción de la purga RGPD no sepa limpiar.
-- invitaciones (email) y actor_sistema van en el PR B, junto a la redacción.
--
-- Cambios:
--   1. CREATE OR REPLACE audit_trigger_function(): el cuerpo de 20260817120000 sin tocar, más
--      dos bloques nuevos: el centro de las 7 tablas con centro (tras la cadena de ramas
--      existente) y las exclusiones de columna (antes del INSERT).
--   2. Los 8 triggers AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW.
--   3. Guardas (comparación normalizada en Postgres: sin \r, sin comentarios --, espacios
--      colapsados):
--      · antes: la función viva es la esperada y ninguna de las 8 tablas tiene ya trigger;
--      · después: el prefijo (DECLARE + todas las ramas existentes), el bloque v_antes /
--        v_despues / v_registro_id y el sufijo (INSERT + RETURN) son los de antes; la función
--        sigue SECURITY DEFINER con search_path=public; hay 61 tablas auditadas, las 53 de
--        antes más las 8.
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor (cat del
-- fichero commiteado, md5 verificado). Tras aplicar: registrar en
-- supabase_migrations.schema_migrations.
-- =============================================================================

-- 0. Foto previa y guarda de entrada.
CREATE TEMP TABLE _audit_antes AS
SELECT p.prosrc,
       ARRAY(SELECT c.relname::text
               FROM pg_trigger tg
               JOIN pg_class c ON c.oid = tg.tgrelid
              WHERE tg.tgfoid = p.oid AND NOT tg.tgisinternal
                AND c.relnamespace = 'public'::regnamespace
              ORDER BY 1) AS tablas
  FROM pg_proc p
 WHERE p.oid = 'public.audit_trigger_function()'::regprocedure;

DO $$
DECLARE
  v_md5    text;
  v_tablas text[];
BEGIN
  SELECT md5(regexp_replace(regexp_replace(replace(prosrc, chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g')), tablas INTO v_md5, v_tablas FROM _audit_antes;
  IF v_md5 IS DISTINCT FROM '3762216841189dc6df7d438603d70569' THEN
    RAISE EXCEPTION 'guarda de entrada: audit_trigger_function no es la de 20260817120000 (md5 normalizado %)', v_md5;
  END IF;
  IF cardinality(v_tablas) <> 53 THEN
    RAISE EXCEPTION 'guarda de entrada: se esperaban 53 tablas auditadas y hay %', cardinality(v_tablas);
  END IF;
  IF v_tablas && ARRAY['profes_aulas', 'aulas', 'cursos_academicos', 'tarifa_concepto_anio', 'acuses_alta', 'cambios_pendientes', 'mandatos_sepa', 'usuarios'] THEN
    RAISE EXCEPTION 'guarda de entrada: alguna de las 8 tablas ya tiene trigger de auditoría: %',
      ARRAY(SELECT unnest(v_tablas) INTERSECT SELECT unnest(ARRAY['profes_aulas', 'aulas', 'cursos_academicos', 'tarifa_concepto_anio', 'acuses_alta', 'cambios_pendientes', 'mandatos_sepa', 'usuarios']));
  END IF;
END $$;

-- 1. La función: el cuerpo de 20260817120000 más los dos bloques del Grupo 1.
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
    v_centro_id := public.centro_de_plantilla(COALESCE((NEW).plantilla_id, (OLD).plantilla_id));
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
    v_centro_id := public.centro_de_nino(COALESCE((NEW).nino_id, (OLD).nino_id));
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
    v_centro_id := public.centro_de_familia(COALESCE((NEW).familia_id, (OLD).familia_id));
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
    v_centro_id := public.centro_de_nino(COALESCE((NEW).nino_id, (OLD).nino_id));
  ELSIF TG_TABLE_NAME IN ('comidas', 'biberones', 'suenos', 'deposiciones') THEN
    v_centro_id := public.centro_de_agenda(COALESCE((NEW).agenda_id, (OLD).agenda_id));
  END IF;

  -- ── Grupo 1 (PR A): tablas auditadas desde 20261011120000 ────────────────
  -- profes_aulas no tiene centro_id: se deriva del aula. Si el aula ya no está (DELETE en
  -- cascada al borrar el aula), del curso. usuarios no es de un centro: centro_id NULL.
  IF TG_TABLE_NAME = 'profes_aulas' THEN
    v_centro_id := COALESCE(
      public.centro_de_aula(COALESCE((NEW).aula_id, (OLD).aula_id)),
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

  INSERT INTO public.audit_log
    (tabla, registro_id, accion, usuario_id, valores_antes, valores_despues, centro_id)
  VALUES
    (TG_TABLE_NAME, v_registro_id, TG_OP::public.audit_accion, auth.uid(), v_antes, v_despues, v_centro_id);

  RETURN COALESCE(NEW, OLD);
END;
$function$;

-- 2. Los triggers.
CREATE TRIGGER audit_profes_aulas
  AFTER INSERT OR DELETE OR UPDATE ON public.profes_aulas
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();
CREATE TRIGGER audit_aulas
  AFTER INSERT OR DELETE OR UPDATE ON public.aulas
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();
CREATE TRIGGER audit_cursos_academicos
  AFTER INSERT OR DELETE OR UPDATE ON public.cursos_academicos
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();
CREATE TRIGGER audit_tarifa_concepto_anio
  AFTER INSERT OR DELETE OR UPDATE ON public.tarifa_concepto_anio
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();
CREATE TRIGGER audit_acuses_alta
  AFTER INSERT OR DELETE OR UPDATE ON public.acuses_alta
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();
CREATE TRIGGER audit_cambios_pendientes
  AFTER INSERT OR DELETE OR UPDATE ON public.cambios_pendientes
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();
CREATE TRIGGER audit_mandatos_sepa
  AFTER INSERT OR DELETE OR UPDATE ON public.mandatos_sepa
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();
CREATE TRIGGER audit_usuarios
  AFTER INSERT OR DELETE OR UPDATE ON public.usuarios
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

-- 3. Guarda de salida.
DO $$
DECLARE
  v_old     text;
  v_new     text;
  v_corte   int;
  v_ins     int;
  v_prefijo text;
  v_medio   text;
  v_sufijo  text;
  v_antes   text[];
  v_ahora   text[];
  v_secdef  boolean;
  v_config  text[];
BEGIN
  SELECT regexp_replace(regexp_replace(replace(a.prosrc, chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'), a.tablas INTO v_old, v_antes FROM _audit_antes a;
  SELECT regexp_replace(regexp_replace(replace(p.prosrc, chr(13), ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'), p.prosecdef, p.proconfig
    INTO v_new, v_secdef, v_config
    FROM pg_proc p WHERE p.oid = 'public.audit_trigger_function()'::regprocedure;

  v_corte   := position(' v_antes := CASE' IN v_old);
  v_ins     := position(' INSERT INTO public.audit_log' IN v_old);
  IF v_corte = 0 OR v_ins = 0 THEN
    RAISE EXCEPTION 'guarda de salida: no encuentro los puntos de corte en la función anterior';
  END IF;
  v_prefijo := left(v_old, v_corte - 1);
  v_medio   := substr(v_old, v_corte, v_ins - v_corte);
  v_sufijo  := substr(v_old, v_ins);

  IF left(v_new, length(v_prefijo)) IS DISTINCT FROM v_prefijo THEN
    RAISE EXCEPTION 'guarda de salida: las ramas existentes de audit_trigger_function han cambiado';
  END IF;
  IF position(v_medio IN substr(v_new, length(v_prefijo) + 1)) = 0 THEN
    RAISE EXCEPTION 'guarda de salida: el bloque v_antes/v_despues/v_registro_id ha cambiado';
  END IF;
  IF right(v_new, length(v_sufijo)) IS DISTINCT FROM v_sufijo THEN
    RAISE EXCEPTION 'guarda de salida: el INSERT en audit_log o el RETURN han cambiado';
  END IF;
  IF NOT v_secdef OR v_config IS DISTINCT FROM ARRAY['search_path=public'] THEN
    RAISE EXCEPTION 'guarda de salida: la función ya no es SECURITY DEFINER con search_path=public (% %)',
      v_secdef, v_config;
  END IF;

  SELECT ARRAY(SELECT c.relname::text
                 FROM pg_trigger tg
                 JOIN pg_class c ON c.oid = tg.tgrelid
                WHERE tg.tgfoid = 'public.audit_trigger_function()'::regprocedure
                  AND NOT tg.tgisinternal AND tg.tgenabled = 'O'
                  AND c.relnamespace = 'public'::regnamespace
                ORDER BY 1)
    INTO v_ahora;
  IF v_ahora IS DISTINCT FROM ARRAY(SELECT unnest(v_antes || ARRAY['profes_aulas', 'aulas', 'cursos_academicos', 'tarifa_concepto_anio', 'acuses_alta', 'cambios_pendientes', 'mandatos_sepa', 'usuarios']) ORDER BY 1) THEN
    RAISE EXCEPTION 'guarda de salida: tablas auditadas inesperadas (% en total): %',
      cardinality(v_ahora), v_ahora;
  END IF;
END $$;

DROP TABLE _audit_antes;
