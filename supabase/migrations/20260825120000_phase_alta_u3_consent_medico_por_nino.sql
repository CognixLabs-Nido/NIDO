-- =============================================================================
-- Alta unificada · U-3 — el ACUSE MÉDICO pasa a ser POR NIÑO
--
-- Problema que cierra: el gate de completitud (`finalizarAlta`) daba el bloque `medico`
-- por satisfecho con CUALQUIER fila `consentimientos` de tipo `datos_medicos` del tutor
-- (`usuario_id = auth.uid()`, sin `nino_id`). Con el 2.º hijo de una familia existente eso
-- significaba que el acuse firmado por el PRIMER hijo satisfacía el bloque del SEGUNDO: el
-- tutor cerraba el alta del hijo nuevo sin haber acusado nunca la confidencialidad de SUS
-- datos médicos. U-3 lo exige por niño (decisión del responsable: opción A, por-niño limpio).
--
-- La columna `consentimientos.nino_id` YA existe (nullable, IU-0 `20260821120000`) y la usa
-- `otorgar_consentimiento_imagen`. Lo que faltaba es que `registrar_consentimiento` —la RPC
-- del acuse médico— pudiera escribirla: hoy inserta SIN `nino_id`, así que todas las filas
-- `datos_medicos` nacen con NULL y son indistinguibles entre hermanos.
--
-- Alcance: SOLO se añade el parámetro trailing `p_nino_id` y su escritura. `terminos` y
-- `privacidad` (los otros dos tipos que pasan por esta RPC) siguen llamándola SIN el
-- parámetro → `NULL`, que es lo correcto: son consentimientos DE CUENTA, no por niño.
--
-- CRÍTICO (reproducción EXACTA): la def se copia VERBATIM de su migración vigente
-- (`20260703160700`, #180 · 3b2) y el ÚNICO cambio es (a) el parámetro trailing `p_nino_id`
-- y (b) escribir `nino_id = p_nino_id` en el INSERT. Se conservan intactos el gate
-- `auth.uid() IS NOT NULL AND auth.uid() <> p_usuario_id`, la caché denormalizada de
-- `terminos`/`privacidad` y los GRANT originales (authenticated, service_role). Como el
-- parámetro nuevo cambia la firma, se hace DROP de la vieja (6 args) + CREATE de la nueva.
--
-- NO se toca `tiene_consentimiento(usuario, tipo)` ni el backstop de `marcar_matricula_lista`
-- (que lo usa): siguen siendo POR USUARIO a propósito. El gate de la app queda ESTRICTAMENTE
-- MÁS DURO que el backstop de BD, que es la dirección segura — nunca al revés. Endurecer el
-- backstop obligaría a re-acusar a familias con el alta ya cerrada; no procede aquí.
--
-- APLICAR POR SQL EDITOR (rol postgres). NO por CLI (SIGILL). `database.ts` se regenera
-- DESPUÉS con `npm run db:types`.
-- =============================================================================
BEGIN;

DROP FUNCTION IF EXISTS public.registrar_consentimiento(
  uuid, public.consentimiento_tipo, text, inet, text, public.firma_metodo
);

CREATE OR REPLACE FUNCTION public.registrar_consentimiento(
  p_usuario_id uuid,
  p_tipo       public.consentimiento_tipo,
  p_version    text,
  p_ip         inet                DEFAULT NULL,
  p_user_agent text                DEFAULT NULL,
  p_metodo     public.firma_metodo DEFAULT 'digital',
  p_nino_id    uuid                DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id uuid;
BEGIN
  -- Service role (captura en el alta) tiene auth.uid() NULL; un usuario
  -- autenticado solo puede registrar el suyo.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_usuario_id THEN
    RAISE EXCEPTION 'no autorizado a registrar consentimientos de otro usuario'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO public.consentimientos
    (usuario_id, tipo, version, ip_address, user_agent, metodo_firma, nino_id)
  VALUES (p_usuario_id, p_tipo, p_version, p_ip, p_user_agent, p_metodo, p_nino_id)
  RETURNING id INTO v_id;

  -- Caché denormalizada (solo terminos/privacidad tienen columna en usuarios).
  IF p_tipo = 'terminos' THEN
    UPDATE public.usuarios SET consentimiento_terminos_version = p_version WHERE id = p_usuario_id;
  ELSIF p_tipo = 'privacidad' THEN
    UPDATE public.usuarios SET consentimiento_privacidad_version = p_version WHERE id = p_usuario_id;
  END IF;

  RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION public.registrar_consentimiento(
  uuid, public.consentimiento_tipo, text, inet, text, public.firma_metodo, uuid
) TO authenticated, service_role;

-- RLS: sin cambios. `consentimientos` sigue gobernada por sus policies de siempre
-- (self-service por `usuario_id`); `nino_id` no abre ni cierra acceso — es una columna de
-- alcance, igual que ya lo era para `imagen` desde IU-0.

COMMIT;
