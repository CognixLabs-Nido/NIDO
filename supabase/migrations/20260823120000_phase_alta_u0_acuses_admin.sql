-- =============================================================================
-- Alta unificada · U-0 — acuse de NORMAS por checkbox también para la Dirección
-- -----------------------------------------------------------------------------
-- En modo Dirección (B1/B2) la directora (admin del centro, SIN vínculo con el
-- niño) completa el alta de forma PRESENCIAL. El gate de completitud exige el
-- acuse de NORMAS de régimen interno; la vía "checkbox" (`acuses_alta`) solo la
-- podía registrar el TUTOR: `acuses_alta_insert` era `es_tutor_de(nino_id)`
-- únicamente → la directora chocaba con 42501 y NO podía cerrar el alta cuando el
-- centro NO publica el documento de normas (con documento, la firma real ya la
-- cubría: `firmas_autorizacion.firmas_insert` acepta admin desde #180).
--
-- Verificado contra el remoto (tx+ROLLBACK, admin de ANAIA sin vínculo): de los
-- write-paths del gate, este era el ÚNICO bloqueado para la directora. El DNI del
-- tutor y los datos del tutor ya funcionaban para admin vía la policy base de
-- `familia_tutores` (`es_admin(centro_de_familia)`) y la de storage `dni-tutores`
-- (`es_admin([1])`); por eso aquí NO se tocan.
--
-- CAMBIO ÚNICO: se AÑADE la rama admin a la WITH CHECK del INSERT:
--   es_tutor_de(nino_id)  →  (es_tutor_de(nino_id) OR es_admin(centro_id))
-- Todo lo demás queda IDÉNTICO: `firmante_id = auth.uid()` (anti-suplantación) y
-- la coherencia `centro_de_nino(nino_id) = centro_id`. Como esa coherencia se
-- mantiene, `es_admin(centro_id)` equivale a `es_admin(centro_de_nino(nino_id))`
-- → la directora solo puede sobre niños de SU centro (nunca cross-centro), mismo
-- criterio que `firmas_insert` (#180) y `marcar_matricula_lista` (+es_admin). El
-- camino del TUTOR queda intacto (se añade con OR, no se sustituye). La SELECT
-- policy ya contemplaba al admin (`es_admin(centro_id)`) → no se toca.
--
-- Sin cambios de esquema → NO hay que regenerar database.ts.
-- Aplicar por SQL Editor / db push (rol postgres).
-- =============================================================================
BEGIN;

DROP POLICY IF EXISTS acuses_alta_insert ON public.acuses_alta;

-- INSERT: el tutor del niño O el admin del centro registran el acuse. Se conserva
-- `firmante_id = auth.uid()` (anti-suplantación) y la coherencia centro↔niño.
CREATE POLICY acuses_alta_insert ON public.acuses_alta
  FOR INSERT WITH CHECK (
    (public.es_tutor_de(nino_id) OR public.es_admin(centro_id))
    AND firmante_id = auth.uid()
    AND public.centro_de_nino(nino_id) = centro_id
  );

COMMIT;
