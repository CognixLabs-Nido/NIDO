-- SONDA: controles negativos del paso 2 (NO se mergea). Rompe cada defensa a la vez.
-- M1
CREATE OR REPLACE FUNCTION privado.familia_alta_validada(p_familia_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$ SELECT false $f$;
-- M2
CREATE OR REPLACE FUNCTION privado.gestiona_tutor(p_familia_id uuid, p_usuario_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT public.es_admin(privado.centro_de_familia(p_familia_id)) OR public.es_tutor_de_familia(p_familia_id) $f$;
-- M3
CREATE OR REPLACE FUNCTION privado.puede_ver_dni_tutor(p_name text, p_owner_id text) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
  SELECT public.es_tutor_legal_de(((storage.foldername(p_name))[2])::uuid) $f$;
-- M4
CREATE POLICY familia_tutores_update_tutor ON public.familia_tutores FOR UPDATE TO authenticated
  USING (es_tutor_de_familia(familia_id) AND deleted_at IS NULL)
  WITH CHECK (es_tutor_de_familia(familia_id) AND deleted_at IS NULL);
-- M5
GRANT SELECT (telefono) ON public.familia_tutores TO authenticated;
-- M6 (marcar_matricula_lista viva de antes)
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
-- M7 (purgar_sujeto_db viva de antes)
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
  v_bloqueos jsonb;
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

  -- Retención (PR-8): el sujeto retenido por un procedimiento abierto espera, también con la
  -- petición ya confirmada (olvido_pendientes ya no la lista; esto cubre cualquier otro camino).
  IF privado.retenido(s.centro_id, s.sujeto_tipo::text, s.sujeto_id) THEN
    RAISE EXCEPTION 'el sujeto está retenido por un procedimiento abierto'
      USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'retenido';
  END IF;

  -- Retención (PR-8, pieza 2): la petición por plazo vuelve a mirar que la cuenta siga purgable
  -- (todos sus hijos de baja y ningún otro rol vivo): entre abrirla y purgarla le pudieron dar un
  -- rol, o un hijo pudo volver. Sin la fecha: el plazo, una vez cumplido, no deja de estarlo.
  IF s.por_plazo AND NOT privado.cuenta_purgable(s.sujeto_id, s.centro_id) THEN
    RAISE EXCEPTION 'la cuenta ya no se purga por plazo'
      USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'plazo';
  END IF;

  -- Retención (PR-7): ningún tutor se olvida con un hijo matriculado. Lo que impide confirmar
  -- impide purgar (olvido_pendientes ya no la lista; esto cubre cualquier otro camino).
  -- Retención (PR-8, pieza 3): la petición por plazo no mira cualquier recibo sin cerrar, sino el
  -- dinero vivo de sus familias (privado.bloqueos_por_plazo): un borrador sin deuda dentro no frena.
  IF s.sujeto_tipo = 'usuario' THEN
    v_bloqueos := CASE WHEN s.por_plazo
                       THEN privado.bloqueos_por_plazo(s.sujeto_id, s.centro_id)
                       ELSE privado.olvido_bloqueos(s.sujeto_tipo, s.sujeto_id, s.centro_id) -> 'bloqueos'
                  END;
    IF jsonb_array_length(v_bloqueos) > 0 THEN
      RAISE EXCEPTION 'todavía falta algo para purgar'
        USING ERRCODE = 'object_not_in_prerequisite_state', HINT = 'hay_bloqueos',
              DETAIL = v_bloqueos::text;
    END IF;
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
