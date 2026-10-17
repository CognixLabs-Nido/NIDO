-- =============================================================================
-- Multicentro · Fase A — ANAIA pasa a ser «CEI Ejemplo», sin logo.
--
-- El único centro que existe hoy se queda como centro de ejemplo, con sus datos (niños,
-- familias, aulas). ANAIA se creará de nuevo más adelante, desde el panel del superusuario.
-- Decisión del responsable (2026-10-16).
--
-- El UUID NO cambia: es lo que protege al centro en la limpieza de los tests RLS
-- (src/test/rls/setup.ts y global-setup.ts) y lo que referencian todas sus filas.
--
-- logo_url = NULL: la interfaz ya contempla un centro sin logo (getCentroLogo devuelve null y
-- ningún layout lo pinta; el PDF del recibo lo omite). El fichero public/brand/anaia-logo-*
-- se borra en el mismo PR, así que esta migración va a producción ANTES del merge: con el
-- código nuevo y logo_url todavía apuntando al PNG, la barra lateral enseñaría una imagen rota.
--
-- La migración de normas 20260703160600 busca el centro por nombre ('ANAIA'). Ya está
-- aplicada, y en una base nueva corre antes que esta, así que el renombrado no la afecta.
--
-- Auditoría: el trigger audit_centros guarda la fila antes/después. Es la fila del centro
-- (nombre, contacto de relleno, sin IBAN de acreedor), sin datos de ningún niño ni familia:
-- la purga RGPD no tiene nada que redactar ahí. Se etiqueta el actor para que la fila diga
-- quién la escribió.
--
-- La fila la siembra 20260513202012 en toda base (CI y local incluidas), así que lo normal es
-- 1 fila. Si no estuviera, no aborta: avisa con su recuento.
-- =============================================================================

DO $cei$
DECLARE
  v_centro constant uuid := '33c79b50-13b5-4962-b849-d88dd6a21366';
  v_antes  text;
  v_filas  int;
BEGIN
  SELECT nombre || ' / logo ' || coalesce(logo_url, 'NULL') INTO v_antes
    FROM public.centros WHERE id = v_centro;
  RAISE NOTICE 'antes: %', coalesce(v_antes, '(no existe el centro)');

  PERFORM set_config('app.audit_actor', 'system:migracion_cei_ejemplo', true);

  UPDATE public.centros
     SET nombre = 'CEI Ejemplo',
         logo_url = NULL
   WHERE id = v_centro;
  GET DIAGNOSTICS v_filas = ROW_COUNT;

  PERFORM set_config('app.audit_actor', '', true);

  IF v_filas = 1 THEN
    RAISE NOTICE 'centro renombrado a CEI Ejemplo y sin logo: % fila', v_filas;
  ELSE
    RAISE NOTICE 'AVISO: % filas actualizadas (se esperaba 1): el centro % no existe en esta base',
      v_filas, v_centro;
  END IF;
END
$cei$;
