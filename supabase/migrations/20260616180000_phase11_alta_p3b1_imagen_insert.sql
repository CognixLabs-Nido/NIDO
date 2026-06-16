-- F11 P3b-1 — habilita el B2 del tutor para autorizacion_imagenes (instanciación
-- lazy del consentimiento de imagen en el wizard). Añade 'autorizacion_imagenes'
-- al array de la rama tutor de autorizaciones_insert; mismo predicado que
-- recogida/medicacion (ambito='nino' + plantilla publicada + es_tutor_de). El CHECK
-- autorizaciones_tipo_coherencia ya admite esta forma (3.ª rama) → no se toca.

DROP POLICY IF EXISTS autorizaciones_insert ON public.autorizaciones;

CREATE POLICY autorizaciones_insert ON public.autorizaciones
  FOR INSERT
  WITH CHECK (
    (creado_por = auth.uid())
    AND (
      es_admin(centro_id)
      OR (
        tipo = 'salida'::tipo_autorizacion
        AND es_profe_de_evento(evento_id)
        AND centro_de_evento(evento_id) = centro_id
      )
      OR (
        es_plantilla = false
        AND tipo = ANY (
          ARRAY['recogida', 'medicacion', 'autorizacion_imagenes']::tipo_autorizacion[]
        )
        AND ambito = 'nino'::autorizacion_ambito
        AND nino_id IS NOT NULL
        AND plantilla_id IS NOT NULL
        AND es_tutor_de(nino_id)
        AND autorizacion_plantilla_valida(plantilla_id, centro_id, tipo)
      )
    )
  );
