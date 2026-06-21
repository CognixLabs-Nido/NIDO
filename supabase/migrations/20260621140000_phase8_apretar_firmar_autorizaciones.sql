-- F8 hardening — apretar el WRITE de autorizaciones/firmas de es_tutor_de →
-- tiene_permiso_sobre(nino_id,'puede_firmar_autorizaciones') (enfoque B).
--
-- Origen: follow-up de F11-E (que apretó el alta a es_tutor_legal_de pero dejó F8
-- fuera explícitamente). El gate actual `es_tutor_de` solo comprueba "existe
-- vínculo vivo" → IGNORA tanto el tipo de vínculo como el permiso granular que F8
-- fue diseñado para respetar (`puede_firmar_autorizaciones`, ADR-0006: default
-- true tutor_legal / false autorizado). Resultado: hoy un 'autorizado' (default
-- false) PUEDE firmar e instanciar B2. Enfoque B (en vez de es_tutor_legal_de):
-- gatear por el PERMISO real vía el helper existente `tiene_permiso_sobre`.
--   • Por defecto es tan estricto como es_tutor_legal_de (autorizado=false).
--   • Preserva la delegación que la dirección conceda (autorizado con permiso=true).
--   • Honra la revocación a un tutor_legal (permiso=false).
--
-- Las policies se RECREAN con DROP + CREATE (no CREATE OR REPLACE — no aplica a
-- policies). Las ramas admin (es_admin) y profe (es_profe_de_evento) de
-- autorizaciones_insert se reproducen VERBATIM; el ÚNICO cambio es el predicado de
-- la rama tutor B2. firmas_insert conserva firmante_id=auth.uid(),
-- autorizacion_aplica_a_nino y autorizacion_firmable; solo cambia el gate de vínculo.

-- =============================================================================
-- 0) Saneo del permiso (fail-closed seguro, pero no queremos bloquear a un tutor
--    legal legítimo). `puede_firmar_autorizaciones` se setea en la app vía
--    permisosDefault al crear el vínculo; NUNCA hubo backfill SQL → la mayoría de
--    los vínculos vivos no tienen la clave y, con COALESCE(...,false), quedarían
--    denegados. Rellenamos SOLO las filas SIN la clave, con el default por tipo
--    (tutor_legal_* → true, autorizado → false). Las filas que YA tienen un valor
--    explícito (p. ej. una delegación/revocación de la dirección) NO se tocan.
-- =============================================================================
UPDATE public.vinculos_familiares
SET permisos = permisos || jsonb_build_object(
  'puede_firmar_autorizaciones',
  tipo_vinculo IN ('tutor_legal_principal', 'tutor_legal_secundario')
)
WHERE NOT (permisos ? 'puede_firmar_autorizaciones');

-- =============================================================================
-- 1) firmas_autorizacion — INSERT gateado por el permiso (resto verbatim)
-- =============================================================================
DROP POLICY IF EXISTS firmas_insert ON public.firmas_autorizacion;

-- INSERT: SOLO quien tiene `puede_firmar_autorizaciones` sobre el niño, sobre una
-- autorización que lo incluye y que es FIRMABLE (publicada + texto_definitivo +
-- vigencia). firmante_id = auth.uid(). ⇒ texto PENDIENTE = no firmable.
CREATE POLICY firmas_insert ON public.firmas_autorizacion
  FOR INSERT WITH CHECK (
    public.tiene_permiso_sobre(nino_id, 'puede_firmar_autorizaciones')
    AND firmante_id = auth.uid()
    AND public.autorizacion_aplica_a_nino(autorizacion_id, nino_id)
    AND public.autorizacion_firmable(autorizacion_id)
  );

-- =============================================================================
-- 2) autorizaciones — INSERT: rama tutor B2 gateada por el permiso; admin/profe
--    VERBATIM (F8-RW-0). Crear la instancia B2 es el preludio de firmarla → mismo
--    permiso que firmar (create + sign alineados).
-- =============================================================================
DROP POLICY IF EXISTS autorizaciones_insert ON public.autorizaciones;
CREATE POLICY autorizaciones_insert ON public.autorizaciones
  FOR INSERT WITH CHECK (
    creado_por = auth.uid()
    AND (
      -- admin: catálogo (plantillas) y Enviar (instancias A) — cualquier forma del centro
      public.es_admin(centro_id)
      -- profe: salida de un evento de su aula (como F8-0)
      OR (tipo = 'salida'
          AND public.es_profe_de_evento(evento_id)
          AND public.centro_de_evento(evento_id) = centro_id)
      -- tutor: instancia B2 de recogida/medicación/imagen de su propio hijo desde la
      -- plantilla. Base = F11 P3b-1 (20260616180000, incluye 'autorizacion_imagenes').
      -- F8 hardening: es_tutor_de → tiene_permiso_sobre(..,'puede_firmar_autorizaciones').
      OR (es_plantilla = false
          AND tipo = ANY (ARRAY['recogida', 'medicacion', 'autorizacion_imagenes']::tipo_autorizacion[])
          AND ambito = 'nino'
          AND nino_id IS NOT NULL
          AND plantilla_id IS NOT NULL
          AND public.tiene_permiso_sobre(nino_id, 'puede_firmar_autorizaciones')
          AND public.autorizacion_plantilla_valida(plantilla_id, centro_id, tipo))
    )
  );
