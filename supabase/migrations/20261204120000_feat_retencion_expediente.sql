-- =============================================================================
-- FEAT — El expediente por tiempo: la purga del niño a los 5 años de la baja (F11-B, punto 6, PR-6)
-- -----------------------------------------------------------------------------
-- Spec: docs/specs/retencion-plazos.md (`RETENCION_EXPEDIENTE_ANIOS`, provisional). El expediente
-- del niño se guardaba para siempre tras la baja. Ahora:
--
--   · Hasta 5 años después de la baja, Dirección lo sigue viendo, salvo la ficha médica: terminado
--     el curso de la baja queda BLOQUEADA (art. 32 LOPDGDD). Nadie la lee ni la escribe, tampoco
--     Dirección ni la familia; de ella no sale ni el aviso de alergia del aula.
--   · A los 5 años, la purga del niño, la misma que la del olvido.
--
-- «La baja»: la fecha más tardía entre el archivado (`ninos.deleted_at`) y la `fecha_baja` de sus
-- matrículas, así nada vence antes de tiempo. Solo los niños de baja (`deleted_reason =
-- 'baja_nino'`): al reincorporarlo (`desarchivar_nino`) deja de estarlo, y la ficha se desbloquea.
-- «Terminado el curso de la baja»: el predicado del PR-5 (`privado.curso_vencido`, con 0 años).
-- Si el centro aún no tiene un curso que termine después de la baja, no se bloquea.
--
-- Ahora:
--
--   · `privado.fecha_baja_nino(niño)` y `privado.ficha_medica_bloqueada_desde(niño)`: el día
--     siguiente al final del curso de la baja, o NULL si no está bloqueada.
--   · `privado.purgar_nino(niño)`: la rama del niño de `purgar_sujeto_db`, literal salvo el
--     parámetro. `purgar_sujeto_db` la llama; el resto, literal de 20261201120000.
--   · `get_info_medica_emergencia`, `set_info_medica_emergencia_cifrada`,
--     `set_info_medica_emergencia_cifrada_tutor` y `borrar_info_medica_nino_tutor`, tras su
--     autorización: si está bloqueada, error 55000 con la fecha en DETAIL. La lectura bloqueada
--     no se registra. `alertas_medicas` deja fuera las bloqueadas. El resto, literal.
--   · `expedientes_vencidos(años)` y `purgar_expediente_nino(niño, años)`, para el cron: la
--     lista, y la purga de uno, que vuelve a mirar que siga vencido. El cron borra antes sus
--     ficheros de Storage, con el manifiesto del olvido.
--
-- La aplica el responsable por SQL Editor. Sin orden obligado con el despliegue: no revoca nada y
-- no cambia ninguna firma; hasta que llegue el código nuevo, una ficha bloqueada se vería en la
-- app como una sin datos (hoy no hay ningún niño de baja). Tras aplicar: registrar en
-- supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
  r     record;
BEGIN
  IF to_regprocedure('privado.purgar_nino(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'ya aplicada: existe privado.purgar_nino';
  END IF;

  -- Lo que se reescribe es lo que hay, tal como quedó.
  FOR r IN SELECT * FROM (VALUES
      ('public.purgar_sujeto_db(uuid)', 'b514a8e6f22acd30fd1e5b622c20d7fc', '20261201120000'),
      ('public.get_info_medica_emergencia(uuid,text)', '80e0b889b8b5c074c9d6bbc6ce8f4feb', '20261128120000'),
      ('public.alertas_medicas(uuid[])', '27688863f225b01a8a10ee2b8e5a4840', '20261128120000'),
      ('public.set_info_medica_emergencia_cifrada(uuid,text,text,text,text,text,text)',
       'cd9c990bd9e26b3d10a749fb1647df47', '20261123120000'),
      ('public.set_info_medica_emergencia_cifrada_tutor(uuid,text,text,text,text,text,text,boolean)',
       '8c967584875287a753765939d7442fa2', '20261123120000'),
      ('public.borrar_info_medica_nino_tutor(uuid)', '9b47c9a0a87d206760693f8c78c6e3b9', '20260620140000'),
      -- El predicado del curso, de 20261203120000; y el borrado sin copia de la operativa del niño
      -- depende del trigger de 20261202120000.
      ('privado.curso_vencido(uuid,date,integer)', 'bf295802894cacc6863b4caa2ea8e3fd', '20261203120000'),
      ('public.audit_trigger_function()', '22b915a1879ea8f203062cbed913e17e', '20261202120000')
    ) AS t(f, md5, mig)
  LOOP
    SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
      INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure(r.f);
    IF v_md5 IS DISTINCT FROM r.md5 THEN
      RAISE EXCEPTION '% no es la de %: %', r.f, r.mig, coalesce(v_md5, 'falta');
    END IF;
  END LOOP;

  RAISE NOTICE 'guarda previa: % niños de baja, % con ficha médica',
    (SELECT count(*) FROM public.ninos WHERE deleted_reason = 'baja_nino'),
    (SELECT count(*) FROM public.ninos n JOIN public.info_medica_emergencia i ON i.nino_id = n.id
      WHERE n.deleted_reason = 'baja_nino');
END
$guarda$;

-- ---- 1. La baja del niño ----
-- La más tardía de sus fechas: el archivado y la que puso Dirección en la matrícula. NULL si el
-- niño no está de baja.
CREATE FUNCTION privado.fecha_baja_nino(p_nino_id uuid)
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT (n.deleted_at AT TIME ZONE 'Europe/Madrid')::date
    FROM public.ninos n
   WHERE n.id = p_nino_id AND n.deleted_reason = 'baja_nino';
$function$;
REVOKE ALL ON FUNCTION privado.fecha_baja_nino(uuid) FROM PUBLIC, anon, authenticated;

-- ---- 2. La ficha médica, bloqueada al terminar el curso de la baja ----
-- El día siguiente al final del primer curso del centro que termina en la baja o después, si ya
-- ha llegado (hora de Madrid, como `curso_vencido`). NULL si no está bloqueada.
CREATE FUNCTION privado.ficha_medica_bloqueada_desde(p_nino_id uuid)
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT (SELECT min(c.fecha_fin) FROM public.cursos_academicos c
           WHERE c.centro_id = n.centro_id AND c.deleted_at IS NULL AND c.fecha_fin >= b.fecha) + 1
    FROM public.ninos n
   CROSS JOIN LATERAL (SELECT privado.fecha_baja_nino(n.id) AS fecha) b
   WHERE n.id = p_nino_id
     AND b.fecha IS NOT NULL
     AND privado.curso_vencido(n.centro_id, b.fecha, 0);
$function$;
REVOKE ALL ON FUNCTION privado.ficha_medica_bloqueada_desde(uuid) FROM PUBLIC, anon, authenticated;

-- ---- 3. La purga del niño, en un solo sitio ----
CREATE FUNCTION privado.purgar_nino(p_nino_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_lista uuid[];
BEGIN
  -- D-5: motivo 'purga_rgpd' → desarchivar_nino RAISE (no reincorpora un sujeto purgado).
  UPDATE public.ninos SET
    nombre           = '[borrado]',
    apellidos        = '[borrado]',
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
    deleted_reason   = 'purga_rgpd',
    deleted_at       = COALESCE(deleted_at, now())
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

  -- Purga RGPD del niño: la copia en audit_log, con la lista de claves por tabla que
  -- comparte con purgar_esqueleto_huerfano_nino (_claves_pii_nino).
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
REVOKE ALL ON FUNCTION privado.purgar_nino(uuid) FROM PUBLIC, anon, authenticated;

-- ---- 4. El olvido la llama ----
CREATE OR REPLACE FUNCTION public.purgar_sujeto_db(p_solicitud_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  s        public.olvido_solicitudes%ROWTYPE;
  v_nombre text;
  v_lista  uuid[];
  v_ft     uuid[];
  k_nino  text[] := ARRAY['nombre','apellidos','fecha_nacimiento','sexo','nacionalidad',
                          'foto_url','notas_admin'];
  k_med   text[] := ARRAY['alergias_graves','notas_emergencia','medicacion_habitual',
                          'alergias_leves','medico_familia','telefono_emergencia'];
  k_user  text[] := ARRAY['nombre_completo','foto_url'];
  k_ft    text[] := ARRAY['nombre_completo','email','direccion_calle','direccion_numero',
                          'direccion_cp','direccion_ciudad','dni_documento_path'];
  k_extra text[] := ARRAY['ip_address','user_agent','descripcion_parentesco',
                          'nombre_externo','observaciones','observaciones_generales',
                          'contenido','nombre_tecleado','comentario'];
BEGIN
  -- [CRIT-ANON] Sin uid solo entra el servicio: service_role o sesión directa sin JWT
  -- (SQL Editor / psql). anon, o un JWT sin sub, ya no se cuela por la rama "uid NULL". Patrón #284.
  IF auth.uid() IS NULL
     AND NOT (COALESCE(auth.role(), '') = 'service_role'
              OR (session_user <> 'authenticator'
                  AND nullif(current_setting('request.jwt.claims', true), '') IS NULL
                  AND nullif(current_setting('request.jwt.claim.role', true), '') IS NULL)) THEN
    RAISE EXCEPTION 'no autorizado: sin sesión solo el servicio'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- [/CRIT-ANON]
  SELECT * INTO s FROM public.olvido_solicitudes WHERE id = p_solicitud_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'solicitud de olvido no encontrada: %', p_solicitud_id
      USING ERRCODE = 'no_data_found';
  END IF;
  IF auth.uid() IS NOT NULL AND NOT privado.es_responsable(s.centro_id) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF s.purgado_en IS NOT NULL THEN
    RETURN;
  END IF;

  -- Grupo 1 (PR B): las filas de auditoría que escribe la purga llevan su etiqueta.
  PERFORM set_config('app.audit_actor', 'system:purgar_sujeto_db', true);

  IF s.sujeto_tipo = 'nino' THEN
    -- Retención (F11-B, punto 6, PR-6): la purga del niño, la misma para el olvido y para el
    -- plazo del expediente (20261204120000).
    PERFORM privado.purgar_nino(s.sujeto_id);

  ELSE  -- usuario
    SELECT nombre_completo INTO v_nombre FROM public.usuarios WHERE id = s.sujeto_id;

    IF public.olvido_es_ultimo_centro(s.id) THEN
      -- Último centro: la cuenta entera y todo lo que quede, también lo de los centros sin
      -- solicitud. Es literal la rama del usuario de 20261019120000.
      IF v_nombre IS NOT NULL AND length(trim(v_nombre)) > 0 THEN
        UPDATE public.mensajes
          SET contenido = replace(contenido, v_nombre, '[borrado]')
          WHERE contenido LIKE '%' || v_nombre || '%';

        -- Grupo 1 (PR B): el nombre tampoco se queda en la auditoría de los mensajes: ni en la
        -- fila que acaba de escribir el UPDATE de arriba ni en las anteriores, de cualquier autor.
        UPDATE public.audit_log SET
          valores_antes = CASE WHEN strpos(valores_antes->>'contenido', v_nombre) > 0
            THEN jsonb_set(valores_antes, '{contenido}',
                           to_jsonb(replace(valores_antes->>'contenido', v_nombre, '[borrado]')))
            ELSE valores_antes END,
          valores_despues = CASE WHEN strpos(valores_despues->>'contenido', v_nombre) > 0
            THEN jsonb_set(valores_despues, '{contenido}',
                           to_jsonb(replace(valores_despues->>'contenido', v_nombre, '[borrado]')))
            ELSE valores_despues END
        WHERE tabla = 'mensajes'
          AND (strpos(valores_antes->>'contenido', v_nombre) > 0
               OR strpos(valores_despues->>'contenido', v_nombre) > 0);
      END IF;

      -- Cierre de la purga: también la foto de perfil (el objeto lo borra antes el manifiesto).
      UPDATE public.usuarios SET
        nombre_completo = '[borrado]',
        foto_url        = NULL,
        deleted_at      = COALESCE(deleted_at, now())
      WHERE id = s.sujeto_id;

      UPDATE public.consentimientos SET ip_address = NULL, user_agent = NULL
        WHERE usuario_id = s.sujeto_id;
      DELETE FROM public.push_subscriptions WHERE usuario_id = s.sujeto_id;
      -- Cierre de la purga: preferencias y lecturas, igual que los dispositivos.
      DELETE FROM public.preferencias_usuario WHERE usuario_id = s.sujeto_id;
      DELETE FROM public.lectura_conversacion WHERE usuario_id = s.sujeto_id;
      DELETE FROM public.lectura_anuncio      WHERE usuario_id = s.sujeto_id;

      -- Cierre de la purga: su perfil de tutor en familia_tutores. Se anonimiza y se da de baja;
      -- usuario_id, familia_id y rol_familia se quedan (seudónimos; el trigger los congela). No se
      -- asciende al otro tutor: lo decide la directora (promover_a_titular). Su copia en
      -- audit_log se redacta por registro_id, que alcanza también las filas de antes de tener
      -- cuenta. El DNI en Storage lo borra antes el manifiesto, por su ruta exacta.
      WITH anonimizados AS (
        UPDATE public.familia_tutores SET
          nombre_completo    = NULL,
          email              = NULL,
          direccion_calle    = NULL,
          direccion_numero   = NULL,
          direccion_cp       = NULL,
          direccion_ciudad   = NULL,
          dni_documento_path = NULL,
          deleted_at         = COALESCE(deleted_at, now())
        WHERE usuario_id = s.sujeto_id RETURNING id
      )
      SELECT array_agg(id) INTO v_ft FROM anonimizados;
      UPDATE public.audit_log SET
        valores_antes   = public._redactar_jsonb(valores_antes,   k_ft),
        valores_despues = public._redactar_jsonb(valores_despues, k_ft)
      WHERE tabla = 'familia_tutores' AND registro_id = ANY (v_ft);

      -- Cierre de la purga: los cambios que pidió sobre sus propios datos de tutor (email,
      -- dirección, ruta de su DNI en el payload). Los que pidió sobre el niño son del niño.
      DELETE FROM public.cambios_pendientes
       WHERE solicitado_por = s.sujeto_id AND entidad IN ('datos_tutor', 'datos_tutor_dni');

      -- Cierre de la purga: su texto al responder a una cita (la auditoría la redacta k_extra).
      UPDATE public.cita_invitados SET comentario = NULL
       WHERE usuario_id = s.sujeto_id AND comentario IS NOT NULL;

      -- Purga de lista_espera: el teléfono y el email que el tutor dejó en sus prospectos. El
      -- prospecto es del niño y se queda; su copia en audit_log pierde esas dos claves.
      WITH limpiados AS (
        UPDATE public.lista_espera SET telefono_tutor = NULL, email_tutor = NULL
        WHERE tutor_usuario_id = s.sujeto_id RETURNING id
      )
      SELECT array_agg(id) INTO v_lista FROM limpiados;
      UPDATE public.audit_log SET
        valores_antes   = public._redactar_jsonb(valores_antes,   ARRAY['telefono_tutor', 'email_tutor']),
        valores_despues = public._redactar_jsonb(valores_despues, ARRAY['telefono_tutor', 'email_tutor'])
      WHERE tabla = 'lista_espera' AND registro_id = ANY (v_lista);

      -- D-5: motivo 'purga_rgpd' → la reactivación de familia NUNCA revive estas filas.
      UPDATE public.roles_usuario SET
        deleted_reason = 'purga_rgpd',
        deleted_at     = COALESCE(deleted_at, now())
        WHERE usuario_id = s.sujeto_id;
      UPDATE public.vinculos_familiares SET
        descripcion_parentesco = NULL,
        deleted_reason         = 'purga_rgpd',
        deleted_at             = COALESCE(deleted_at, now())
      WHERE usuario_id = s.sujeto_id;

      UPDATE public.audit_log SET
        valores_antes   = public._redactar_jsonb(valores_antes,   k_user || k_extra),
        valores_despues = public._redactar_jsonb(valores_despues, k_user || k_extra)
      WHERE registro_id = s.sujeto_id OR usuario_id = s.sujeto_id
         -- Grupo 1 (PR B): también las filas que LLEVAN al sujeto (vínculos, roles…), como su
         -- vínculo con descripcion_parentesco, escritas por otros o por esta misma purga.
         OR valores_antes->>'usuario_id'   = s.sujeto_id::text
         OR valores_despues->>'usuario_id' = s.sujeto_id::text;

      -- Grupo 1 (PR B): invitaciones. El paso 4 de la purga (purgar-vencidos.ts) ya marcó con
      -- '[borrado]' el email y el nombre de sus invitaciones; aquí se redactan sus copias en
      -- audit_log (la fila de ese UPDATE y las anteriores). Idempotente.
      UPDATE public.audit_log SET
        valores_antes   = public._redactar_jsonb(valores_antes,   ARRAY['email', 'nombre_completo']),
        valores_despues = public._redactar_jsonb(valores_despues, ARRAY['email', 'nombre_completo'])
      WHERE tabla = 'invitaciones'
        AND registro_id IN (SELECT i.id FROM public.invitaciones i WHERE i.email = '[borrado]');
    ELSE
      -- Multicentro (Fase 2 · PR B): le queda otro centro. Cada sentencia es la de la rama de
      -- arriba acotada a ESTE centro (s.centro_id). No se tocan usuarios, push, preferencias ni
      -- los consentimientos sin niño: son de la cuenta y se van con el último centro.

      -- Su nombre en los mensajes de las conversaciones de este centro, y en su auditoría.
      IF v_nombre IS NOT NULL AND length(trim(v_nombre)) > 0 THEN
        UPDATE public.mensajes
          SET contenido = replace(contenido, v_nombre, '[borrado]')
          WHERE contenido LIKE '%' || v_nombre || '%'
            AND conversacion_id IN (SELECT c.id FROM public.conversaciones c
                                     WHERE c.centro_id = s.centro_id);

        UPDATE public.audit_log SET
          valores_antes = CASE WHEN strpos(valores_antes->>'contenido', v_nombre) > 0
            THEN jsonb_set(valores_antes, '{contenido}',
                           to_jsonb(replace(valores_antes->>'contenido', v_nombre, '[borrado]')))
            ELSE valores_antes END,
          valores_despues = CASE WHEN strpos(valores_despues->>'contenido', v_nombre) > 0
            THEN jsonb_set(valores_despues, '{contenido}',
                           to_jsonb(replace(valores_despues->>'contenido', v_nombre, '[borrado]')))
            ELSE valores_despues END
        WHERE tabla = 'mensajes' AND centro_id = s.centro_id
          AND (strpos(valores_antes->>'contenido', v_nombre) > 0
               OR strpos(valores_despues->>'contenido', v_nombre) > 0);
      END IF;

      -- Los consentimientos ligados a un niño de este centro.
      UPDATE public.consentimientos SET ip_address = NULL, user_agent = NULL
        WHERE usuario_id = s.sujeto_id
          AND nino_id IN (SELECT n.id FROM public.ninos n WHERE n.centro_id = s.centro_id);
      -- Las lecturas de conversaciones y anuncios de este centro.
      DELETE FROM public.lectura_conversacion
        WHERE usuario_id = s.sujeto_id
          AND conversacion_id IN (SELECT c.id FROM public.conversaciones c
                                   WHERE c.centro_id = s.centro_id);
      DELETE FROM public.lectura_anuncio
        WHERE usuario_id = s.sujeto_id
          AND anuncio_id IN (SELECT a.id FROM public.anuncios a WHERE a.centro_id = s.centro_id);

      -- Su perfil de tutor en la familia de este centro (el DNI de esa familia lo borra antes el
      -- manifiesto, solo el de este centro).
      WITH anonimizados AS (
        UPDATE public.familia_tutores SET
          nombre_completo    = NULL,
          email              = NULL,
          direccion_calle    = NULL,
          direccion_numero   = NULL,
          direccion_cp       = NULL,
          direccion_ciudad   = NULL,
          dni_documento_path = NULL,
          deleted_at         = COALESCE(deleted_at, now())
        WHERE usuario_id = s.sujeto_id AND centro_id = s.centro_id RETURNING id
      )
      SELECT array_agg(id) INTO v_ft FROM anonimizados;
      UPDATE public.audit_log SET
        valores_antes   = public._redactar_jsonb(valores_antes,   k_ft),
        valores_despues = public._redactar_jsonb(valores_despues, k_ft)
      WHERE tabla = 'familia_tutores' AND registro_id = ANY (v_ft);

      -- Los cambios que pidió sobre sus datos de tutor en este centro.
      DELETE FROM public.cambios_pendientes
       WHERE solicitado_por = s.sujeto_id AND entidad IN ('datos_tutor', 'datos_tutor_dni')
         AND centro_id = s.centro_id;

      -- Su texto al responder a las citas de este centro.
      UPDATE public.cita_invitados SET comentario = NULL
       WHERE usuario_id = s.sujeto_id AND comentario IS NOT NULL AND centro_id = s.centro_id;

      -- El teléfono y el email de sus prospectos de este centro.
      WITH limpiados AS (
        UPDATE public.lista_espera SET telefono_tutor = NULL, email_tutor = NULL
        WHERE tutor_usuario_id = s.sujeto_id AND centro_id = s.centro_id RETURNING id
      )
      SELECT array_agg(id) INTO v_lista FROM limpiados;
      UPDATE public.audit_log SET
        valores_antes   = public._redactar_jsonb(valores_antes,   ARRAY['telefono_tutor', 'email_tutor']),
        valores_despues = public._redactar_jsonb(valores_despues, ARRAY['telefono_tutor', 'email_tutor'])
      WHERE tabla = 'lista_espera' AND registro_id = ANY (v_lista);

      -- Sus roles en este centro y sus vínculos con niños de este centro.
      UPDATE public.roles_usuario SET
        deleted_reason = 'purga_rgpd',
        deleted_at     = COALESCE(deleted_at, now())
        WHERE usuario_id = s.sujeto_id AND centro_id = s.centro_id;
      UPDATE public.vinculos_familiares SET
        descripcion_parentesco = NULL,
        deleted_reason         = 'purga_rgpd',
        deleted_at             = COALESCE(deleted_at, now())
      WHERE usuario_id = s.sujeto_id
        AND nino_id IN (SELECT n.id FROM public.ninos n WHERE n.centro_id = s.centro_id);

      -- Su auditoría en este centro. Las filas sin centro (las de usuarios) son de la cuenta.
      UPDATE public.audit_log SET
        valores_antes   = public._redactar_jsonb(valores_antes,   k_user || k_extra),
        valores_despues = public._redactar_jsonb(valores_despues, k_user || k_extra)
      WHERE centro_id = s.centro_id
        AND (registro_id = s.sujeto_id OR usuario_id = s.sujeto_id
             OR valores_antes->>'usuario_id'   = s.sujeto_id::text
             OR valores_despues->>'usuario_id' = s.sujeto_id::text);

      -- Sus invitaciones de este centro (purgar-vencidos.ts las marca antes, solo las de este
      -- centro), y su auditoría.
      UPDATE public.audit_log SET
        valores_antes   = public._redactar_jsonb(valores_antes,   ARRAY['email', 'nombre_completo']),
        valores_despues = public._redactar_jsonb(valores_despues, ARRAY['email', 'nombre_completo'])
      WHERE tabla = 'invitaciones' AND centro_id = s.centro_id
        AND registro_id IN (SELECT i.id FROM public.invitaciones i
                             WHERE i.email = '[borrado]' AND i.centro_id = s.centro_id);
    END IF;
  END IF;

  UPDATE public.olvido_solicitudes SET purgado_en = now() WHERE id = p_solicitud_id;
  PERFORM set_config('app.audit_actor', '', true);
END $function$;

-- ---- 5. La ficha médica bloqueada: ni se lee ni se escribe ----
CREATE OR REPLACE FUNCTION public.get_info_medica_emergencia(p_nino_id uuid, p_origen text DEFAULT 'ficha')
 RETURNS TABLE(alergias_graves text, notas_emergencia text, medicacion_habitual text, alergias_leves text, medico_familia text, telefono_emergencia text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_clave text := public._get_medical_key();
  v_centro_del_nino uuid;
  v_autorizado boolean := false;
  v_uid uuid := auth.uid();
  v_rol text;
  v_ime public.info_medica_emergencia%ROWTYPE;
  v_campos text[] := '{}';
  v_bloqueada date;
BEGIN
  IF p_origen IS NULL OR p_origen NOT IN ('ficha', 'alta', 'export') THEN
    RAISE EXCEPTION 'origen de la lectura no válido: %', coalesce(p_origen, 'NULL')
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT centro_id INTO v_centro_del_nino FROM public.ninos WHERE id = p_nino_id;
  IF v_centro_del_nino IS NULL THEN
    RAISE EXCEPTION 'Niño no encontrado: %', p_nino_id;
  END IF;

  -- Por qué puede leer, en el mismo orden que autoriza: es lo que se registra.
  IF public.es_admin(v_centro_del_nino) THEN
    v_autorizado := true;
    SELECT CASE WHEN bool_or(r.rol::text = 'admin') THEN 'admin'
                WHEN bool_or(r.rol::text = 'directora') THEN 'directora' END
      INTO v_rol
      FROM public.roles_usuario r
     WHERE r.usuario_id = v_uid AND r.centro_id = v_centro_del_nino AND r.deleted_at IS NULL
       AND r.rol::text IN ('admin', 'directora');
    v_rol := coalesce(v_rol, 'superusuario');
  ELSIF EXISTS (
    SELECT 1 FROM public.matriculas m
    WHERE m.nino_id = p_nino_id
      AND m.fecha_baja IS NULL AND m.deleted_at IS NULL AND m.estado = 'activa'
      AND public.es_profe_de_aula(m.aula_id)
  ) THEN
    v_autorizado := true;
    v_rol := 'profe';
  ELSIF public.tiene_permiso_sobre(p_nino_id, 'puede_ver_info_medica') THEN
    v_autorizado := true;
    v_rol := CASE WHEN public.es_tutor_legal_de(p_nino_id) THEN 'tutor_legal' ELSE 'autorizado' END;
  END IF;

  IF NOT v_autorizado THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  -- Retención (F11-B, punto 6, PR-6): terminado el curso de la baja, la ficha queda bloqueada
  -- (art. 32 LOPDGDD) para todos: no se entrega ni se registra la lectura. 55000 y la fecha
  -- en DETAIL: la app dice «bloqueada desde».
  v_bloqueada := privado.ficha_medica_bloqueada_desde(p_nino_id);
  IF false AND v_bloqueada IS NOT NULL THEN
    RAISE EXCEPTION 'ficha médica bloqueada desde %', v_bloqueada
      USING ERRCODE = 'object_not_in_prerequisite_state', DETAIL = v_bloqueada::text;
  END IF;

  -- La lectura queda registrada con los campos que se entregan (los que tienen contenido), en la
  -- misma transacción que descifra (20261128120000).
  SELECT * INTO v_ime FROM public.info_medica_emergencia WHERE nino_id = p_nino_id;
  IF FOUND THEN
    v_campos := array_remove(ARRAY[
      CASE WHEN v_ime.alergias_graves     IS NOT NULL THEN 'alergias_graves' END,
      CASE WHEN v_ime.notas_emergencia    IS NOT NULL THEN 'notas_emergencia' END,
      CASE WHEN v_ime.medicacion_habitual IS NOT NULL THEN 'medicacion_habitual' END,
      CASE WHEN v_ime.alergias_leves      IS NOT NULL THEN 'alergias_leves' END,
      CASE WHEN v_ime.medico_familia      IS NOT NULL THEN 'medico_familia' END,
      CASE WHEN v_ime.telefono_emergencia IS NOT NULL THEN 'telefono_emergencia' END], NULL);
  END IF;
  INSERT INTO public.lecturas_ficha_medica (nino_id, centro_id, lector_id, rol_lector, origen, campos)
  VALUES (p_nino_id, v_centro_del_nino, v_uid, v_rol, p_origen, v_campos);

  RETURN QUERY
  SELECT
    CASE WHEN ime.alergias_graves     IS NULL THEN NULL ELSE pgp_sym_decrypt(ime.alergias_graves,     v_clave) END,
    CASE WHEN ime.notas_emergencia    IS NULL THEN NULL ELSE pgp_sym_decrypt(ime.notas_emergencia,    v_clave) END,
    CASE WHEN ime.medicacion_habitual IS NULL THEN NULL ELSE pgp_sym_decrypt(ime.medicacion_habitual, v_clave) END,
    CASE WHEN ime.alergias_leves      IS NULL THEN NULL ELSE pgp_sym_decrypt(ime.alergias_leves,      v_clave) END,
    CASE WHEN ime.medico_familia      IS NULL THEN NULL ELSE pgp_sym_decrypt(ime.medico_familia,      v_clave) END,
    CASE WHEN ime.telefono_emergencia IS NULL THEN NULL ELSE pgp_sym_decrypt(ime.telefono_emergencia, v_clave) END
  FROM public.info_medica_emergencia ime
  WHERE ime.nino_id = p_nino_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_info_medica_emergencia_cifrada(p_nino_id uuid, p_alergias_graves text, p_notas_emergencia text, p_medicacion_habitual text, p_alergias_leves text, p_medico_familia text, p_telefono_emergencia text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_clave text := public._get_medical_key();
  v_centro_del_nino uuid;
  v_id uuid;
  v_bloqueada date;
BEGIN
  SELECT centro_id INTO v_centro_del_nino FROM public.ninos WHERE id = p_nino_id;
  IF v_centro_del_nino IS NULL THEN
    RAISE EXCEPTION 'Niño no encontrado: %', p_nino_id;
  END IF;
  IF NOT public.es_admin(v_centro_del_nino) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  -- Retención (F11-B, punto 6, PR-6): terminado el curso de la baja, la ficha queda bloqueada
  -- (art. 32 LOPDGDD) para todos. 55000 y la fecha en DETAIL: la app dice «bloqueada desde».
  v_bloqueada := privado.ficha_medica_bloqueada_desde(p_nino_id);
  IF v_bloqueada IS NOT NULL THEN
    RAISE EXCEPTION 'ficha médica bloqueada desde %', v_bloqueada
      USING ERRCODE = 'object_not_in_prerequisite_state', DETAIL = v_bloqueada::text;
  END IF;

  -- Los seis cifrados. Vacío (o solo espacios) = NULL: las listas del aula pintan el aviso si
  -- la columna no es NULL.
  INSERT INTO public.info_medica_emergencia (
    nino_id, alergias_graves, notas_emergencia,
    medicacion_habitual, alergias_leves, medico_familia, telefono_emergencia
  ) VALUES (
    p_nino_id,
    CASE WHEN p_alergias_graves     IS NULL OR btrim(p_alergias_graves)     = '' THEN NULL ELSE pgp_sym_encrypt(p_alergias_graves,     v_clave) END,
    CASE WHEN p_notas_emergencia    IS NULL OR btrim(p_notas_emergencia)    = '' THEN NULL ELSE pgp_sym_encrypt(p_notas_emergencia,    v_clave) END,
    CASE WHEN p_medicacion_habitual IS NULL OR btrim(p_medicacion_habitual) = '' THEN NULL ELSE pgp_sym_encrypt(p_medicacion_habitual, v_clave) END,
    CASE WHEN p_alergias_leves      IS NULL OR btrim(p_alergias_leves)      = '' THEN NULL ELSE pgp_sym_encrypt(p_alergias_leves,      v_clave) END,
    CASE WHEN p_medico_familia      IS NULL OR btrim(p_medico_familia)      = '' THEN NULL ELSE pgp_sym_encrypt(p_medico_familia,      v_clave) END,
    CASE WHEN p_telefono_emergencia IS NULL OR btrim(p_telefono_emergencia) = '' THEN NULL ELSE pgp_sym_encrypt(p_telefono_emergencia, v_clave) END
  )
  ON CONFLICT (nino_id) DO UPDATE SET
    -- Parámetro NULL = "no tocar" → se preserva el valor existente. '' vacía el campo (NULL).
    alergias_graves      = CASE WHEN p_alergias_graves     IS NULL THEN public.info_medica_emergencia.alergias_graves     ELSE EXCLUDED.alergias_graves     END,
    notas_emergencia     = CASE WHEN p_notas_emergencia    IS NULL THEN public.info_medica_emergencia.notas_emergencia    ELSE EXCLUDED.notas_emergencia    END,
    medicacion_habitual  = CASE WHEN p_medicacion_habitual IS NULL THEN public.info_medica_emergencia.medicacion_habitual ELSE EXCLUDED.medicacion_habitual END,
    alergias_leves       = CASE WHEN p_alergias_leves      IS NULL THEN public.info_medica_emergencia.alergias_leves      ELSE EXCLUDED.alergias_leves      END,
    medico_familia       = CASE WHEN p_medico_familia      IS NULL THEN public.info_medica_emergencia.medico_familia      ELSE EXCLUDED.medico_familia      END,
    telefono_emergencia  = CASE WHEN p_telefono_emergencia IS NULL THEN public.info_medica_emergencia.telefono_emergencia ELSE EXCLUDED.telefono_emergencia END,
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_info_medica_emergencia_cifrada_tutor(p_nino_id uuid, p_alergias_graves text, p_notas_emergencia text, p_medicacion_habitual text, p_alergias_leves text, p_medico_familia text, p_telefono_emergencia text, p_reemplazar boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_clave text;
  v_id uuid;
  v_bloqueada date;
BEGIN
  -- Gate AMPLIADO: admin del centro del niño O tutor legal (el tutor pasa igual).
  -- F11-F: la info médica es VOLUNTARIA → sin gate de consentimiento; el acuse de
  -- confidencialidad se exige al cerrar el alta (marcar_matricula_lista), no aquí.
  IF NOT (public.es_admin(privado.centro_de_nino(p_nino_id))
          OR public.es_tutor_legal_de(p_nino_id)) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Retención (F11-B, punto 6, PR-6): terminado el curso de la baja, la ficha queda bloqueada
  -- (art. 32 LOPDGDD) para todos. 55000 y la fecha en DETAIL: la app dice «bloqueada desde».
  v_bloqueada := privado.ficha_medica_bloqueada_desde(p_nino_id);
  IF v_bloqueada IS NOT NULL THEN
    RAISE EXCEPTION 'ficha médica bloqueada desde %', v_bloqueada
      USING ERRCODE = 'object_not_in_prerequisite_state', DETAIL = v_bloqueada::text;
  END IF;

  v_clave := public._get_medical_key();

  -- Los seis cifrados. Vacío (o solo espacios) = NULL: las listas del aula pintan el aviso si
  -- la columna no es NULL.
  INSERT INTO public.info_medica_emergencia (
    nino_id, alergias_graves, notas_emergencia,
    medicacion_habitual, alergias_leves, medico_familia, telefono_emergencia
  ) VALUES (
    p_nino_id,
    CASE WHEN p_alergias_graves     IS NULL OR btrim(p_alergias_graves)     = '' THEN NULL ELSE pgp_sym_encrypt(p_alergias_graves,     v_clave) END,
    CASE WHEN p_notas_emergencia    IS NULL OR btrim(p_notas_emergencia)    = '' THEN NULL ELSE pgp_sym_encrypt(p_notas_emergencia,    v_clave) END,
    CASE WHEN p_medicacion_habitual IS NULL OR btrim(p_medicacion_habitual) = '' THEN NULL ELSE pgp_sym_encrypt(p_medicacion_habitual, v_clave) END,
    CASE WHEN p_alergias_leves      IS NULL OR btrim(p_alergias_leves)      = '' THEN NULL ELSE pgp_sym_encrypt(p_alergias_leves,      v_clave) END,
    CASE WHEN p_medico_familia      IS NULL OR btrim(p_medico_familia)      = '' THEN NULL ELSE pgp_sym_encrypt(p_medico_familia,      v_clave) END,
    CASE WHEN p_telefono_emergencia IS NULL OR btrim(p_telefono_emergencia) = '' THEN NULL ELSE pgp_sym_encrypt(p_telefono_emergencia, v_clave) END
  )
  ON CONFLICT (nino_id) DO UPDATE SET
    -- MERGE (default): parámetro NULL = "no tocar" → se preserva; '' vacía el campo (NULL).
    -- REPLACE (p_reemplazar): escribe EXCLUDED.* verbatim → NULL LIMPIA.
    alergias_graves     = CASE WHEN p_reemplazar OR p_alergias_graves     IS NOT NULL THEN EXCLUDED.alergias_graves
                               ELSE public.info_medica_emergencia.alergias_graves END,
    notas_emergencia    = CASE WHEN p_reemplazar OR p_notas_emergencia    IS NOT NULL THEN EXCLUDED.notas_emergencia
                               ELSE public.info_medica_emergencia.notas_emergencia END,
    medicacion_habitual = CASE WHEN p_reemplazar OR p_medicacion_habitual IS NOT NULL THEN EXCLUDED.medicacion_habitual
                               ELSE public.info_medica_emergencia.medicacion_habitual END,
    alergias_leves      = CASE WHEN p_reemplazar OR p_alergias_leves      IS NOT NULL THEN EXCLUDED.alergias_leves
                               ELSE public.info_medica_emergencia.alergias_leves END,
    medico_familia      = CASE WHEN p_reemplazar OR p_medico_familia      IS NOT NULL THEN EXCLUDED.medico_familia
                               ELSE public.info_medica_emergencia.medico_familia END,
    telefono_emergencia = CASE WHEN p_reemplazar OR p_telefono_emergencia IS NOT NULL THEN EXCLUDED.telefono_emergencia
                               ELSE public.info_medica_emergencia.telefono_emergencia END,
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.borrar_info_medica_nino_tutor(p_nino_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_bloqueada date;
BEGIN
  -- Gate: tutor LEGAL del niño (principal/secundario; excluye 'autorizado').
  -- Sin gate de admin: es dato voluntario de la familia.
  IF NOT public.es_tutor_legal_de(p_nino_id) THEN
    RAISE EXCEPTION 'No autorizado' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Retención (F11-B, punto 6, PR-6): terminado el curso de la baja, la ficha queda bloqueada
  -- (art. 32 LOPDGDD) para todos: tampoco se borra, se conserva hasta la purga del
  -- expediente. 55000 y la fecha en DETAIL: la app dice «bloqueada desde».
  v_bloqueada := privado.ficha_medica_bloqueada_desde(p_nino_id);
  IF v_bloqueada IS NOT NULL THEN
    RAISE EXCEPTION 'ficha médica bloqueada desde %', v_bloqueada
      USING ERRCODE = 'object_not_in_prerequisite_state', DETAIL = v_bloqueada::text;
  END IF;

  -- Borra la fila entera = retirada real del dato compartido. Idempotente:
  -- si no hay fila, DELETE afecta 0 filas y no lanza error.
  DELETE FROM public.info_medica_emergencia
   WHERE nino_id = p_nino_id;
END $function$;

CREATE OR REPLACE FUNCTION public.alertas_medicas(p_nino_ids uuid[])
RETURNS TABLE (nino_id uuid, alergia_grave boolean, medicacion boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT ime.nino_id, ime.alergias_graves IS NOT NULL, ime.medicacion_habitual IS NOT NULL
    FROM public.info_medica_emergencia ime
   WHERE ime.nino_id = ANY (p_nino_ids)
     AND (public.es_admin(privado.centro_de_nino(ime.nino_id))
          OR public.es_profe_de_nino(ime.nino_id)
          OR public.tiene_permiso_sobre(ime.nino_id, 'puede_ver_info_medica'))
     -- Retención (F11-B, punto 6, PR-6): de la ficha bloqueada no sale ni el aviso.
     AND privado.ficha_medica_bloqueada_desde(ime.nino_id) IS NULL;
$function$;

-- ---- 6. El expediente vencido (el plazo, provisional, lo pasa el cron) ----
-- Ha pasado el plazo desde el día siguiente a la baja (hora de Madrid).
CREATE FUNCTION privado.expediente_vencido(p_nino_id uuid, p_anios integer)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $function$
  SELECT COALESCE((privado.fecha_baja_nino(p_nino_id) + 1)::timestamp AT TIME ZONE 'Europe/Madrid'
                  < now() - make_interval(years => p_anios), false);
$function$;
REVOKE ALL ON FUNCTION privado.expediente_vencido(uuid, integer) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.expedientes_vencidos(p_anios integer)
RETURNS TABLE (nino_id uuid, centro_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF p_anios IS NULL OR p_anios < 1 THEN
    RAISE EXCEPTION 'plazo del expediente no válido' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  RETURN QUERY
  SELECT n.id, n.centro_id FROM public.ninos n
   WHERE n.deleted_reason = 'baja_nino' AND privado.expediente_vencido(n.id, p_anios)
   ORDER BY n.deleted_at, n.id;
END;
$function$;
REVOKE ALL ON FUNCTION public.expedientes_vencidos(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expedientes_vencidos(integer) TO service_role;

-- La purga de uno. Vuelve a mirar, con el niño bloqueado, que siga de baja y vencido: entre la
-- lista y la purga lo han podido reincorporar. false si ya no toca.
CREATE FUNCTION public.purgar_expediente_nino(p_nino_id uuid, p_anios integer)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF p_anios IS NULL OR p_anios < 1 THEN
    RAISE EXCEPTION 'plazo del expediente no válido' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  PERFORM 1 FROM public.ninos WHERE id = p_nino_id AND deleted_reason = 'baja_nino' FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  PERFORM set_config('app.audit_actor', 'system:purgar_expediente_vencido', true);
  PERFORM privado.purgar_nino(p_nino_id);
  PERFORM set_config('app.audit_actor', '', true);
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.purgar_expediente_nino(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purgar_expediente_nino(uuid, integer) TO service_role;

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_f   text;
  v_src text;
BEGIN
  FOREACH v_f IN ARRAY ARRAY['public.expedientes_vencidos(integer)',
                             'public.purgar_expediente_nino(uuid,integer)',
                             'privado.fecha_baja_nino(uuid)',
                             'privado.ficha_medica_bloqueada_desde(uuid)',
                             'privado.purgar_nino(uuid)',
                             'privado.expediente_vencido(uuid,integer)'] LOOP
    IF has_function_privilege('authenticated', v_f, 'EXECUTE')
       OR has_function_privilege('anon', v_f, 'EXECUTE') THEN
      RAISE EXCEPTION '% quedó abierta a quien no toca', v_f;
    END IF;
  END LOOP;
  IF NOT (SELECT bool_and(prosecdef) FROM pg_proc
           WHERE oid IN ('public.expedientes_vencidos(integer)'::regprocedure,
                         'public.purgar_expediente_nino(uuid,integer)'::regprocedure)) THEN
    RAISE EXCEPTION 'las funciones del expediente tienen que ser SECURITY DEFINER';
  END IF;

  -- La ficha sigue abierta a quien la usaba, y las cinco miran el bloqueo.
  FOREACH v_f IN ARRAY ARRAY['public.get_info_medica_emergencia(uuid,text)',
                             'public.alertas_medicas(uuid[])',
                             'public.set_info_medica_emergencia_cifrada(uuid,text,text,text,text,text,text)',
                             'public.set_info_medica_emergencia_cifrada_tutor(uuid,text,text,text,text,text,text,boolean)',
                             'public.borrar_info_medica_nino_tutor(uuid)'] LOOP
    IF NOT has_function_privilege('authenticated', v_f, 'EXECUTE') THEN
      RAISE EXCEPTION '% perdió el EXECUTE de authenticated', v_f;
    END IF;
    SELECT prosrc INTO v_src FROM pg_proc WHERE oid = v_f::regprocedure;
    IF strpos(v_src, 'privado.ficha_medica_bloqueada_desde(') = 0 THEN
      RAISE EXCEPTION '% no mira el bloqueo de la ficha', v_f;
    END IF;
  END LOOP;

  IF has_function_privilege('authenticated', 'public.purgar_sujeto_db(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.purgar_sujeto_db(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'purgar_sujeto_db cambió de permisos';
  END IF;
  IF strpos((SELECT prosrc FROM pg_proc WHERE oid = 'public.purgar_sujeto_db(uuid)'::regprocedure),
            'PERFORM privado.purgar_nino(s.sujeto_id);') = 0 THEN
    RAISE EXCEPTION 'purgar_sujeto_db no llama a privado.purgar_nino';
  END IF;

  RAISE NOTICE 'guarda posterior: purgar_sujeto_db %, purgar_nino %; % expedientes vencidos a 5 años, % fichas bloqueadas',
    (SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
       FROM pg_proc p WHERE p.oid = 'public.purgar_sujeto_db(uuid)'::regprocedure),
    (SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
       FROM pg_proc p WHERE p.oid = 'privado.purgar_nino(uuid)'::regprocedure),
    (SELECT count(*) FROM public.expedientes_vencidos(5)),
    (SELECT count(*) FROM public.ninos n WHERE privado.ficha_medica_bloqueada_desde(n.id) IS NOT NULL);
END
$guarda$;
