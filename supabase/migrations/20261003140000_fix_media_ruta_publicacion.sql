-- =============================================================================
-- FIX — media: las rutas de Storage deben ser de la propia publicación (R4)
-- -----------------------------------------------------------------------------
-- `media_insert` solo exige `es_admin(centro_id) OR autor_de_publicacion(publicacion_id) =
-- auth.uid()`, y nada validaba `path` / `path_miniatura`. Un redactor (profe autora de una
-- publicación) podía insertar por PostgREST una fila `media` de SU publicación con la ruta de
-- un objeto AJENO (otra publicación, otra aula u otro centro). Al quitar esa foto o borrar su
-- publicación, `eliminarMedia` / `eliminarPublicacion` (fotos/actions/gestionar-publicacion.ts)
-- borraban ese objeto con service role. Lo mismo los barridos service-role de olvido y
-- retención, que borran las rutas que leen de `media`.
--
-- Formato legítimo (route handler `fotos/upload` → `prefijoPublicacion` + `rutasFotoNueva` en
-- fotos/lib/storage.ts):
--   original : {centro_id}/{aula_id}/{publicacion_id}/{uuid}.jpg
--   miniatura: {centro_id}/{aula_id}/{publicacion_id}/{uuid}_thumb.jpg
-- con `centro_id`/`aula_id` de la publicación (el procesado siempre emite JPEG).
--
-- Por qué TRIGGER y no CHECK: `media` no tiene `aula_id`; el prefijo se deriva de la
-- publicación (`centro_de_publicacion` / `aula_de_publicacion`, helpers SECURITY DEFINER ya
-- existentes) y un CHECK no puede consultar otra tabla. El trigger BEFORE INSERT OR UPDATE
-- valida ambas rutas contra el prefijo de la publicación de la FILA (nunca contra el input) y
-- falla con 23514 (check_violation), como un CHECK. Cada ruta debe ser exactamente
-- `{prefijo}/<nombre>.jpg` con un único segmento final de [A-Za-z0-9_-] (sin `/` ni `..`).
-- `path` es NOT NULL; `path_miniatura` puede ser NULL, pero si viene, se valida igual.
--
-- Nombre `media_validar_ruta_trg`: los BEFORE del mismo evento se disparan por orden
-- alfabético → corre DESPUÉS de `media_set_centro_id_trg`. No depende de él: deriva el centro
-- de la publicación por su cuenta.
--
-- La app valida lo mismo antes de borrar en Storage (defensa en profundidad):
-- `rutaDeLaPublicacion` en fotos/lib/storage.ts.
--
-- La tabla está vacía en producción a 2026-10-03 → no hay filas previas que contrastar.
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor (CLI SIGILL
-- en ARM). Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.media_validar_ruta()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_regex text;
BEGIN
  -- NULL si la publicación no existe (concatenar NULL da NULL) → falla abajo.
  v_regex := '^' || public.centro_de_publicacion(NEW.publicacion_id)::text
          || '/' || public.aula_de_publicacion(NEW.publicacion_id)::text
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

-- Función de trigger: nadie la invoca por RPC (el disparo del trigger no comprueba EXECUTE).
REVOKE EXECUTE ON FUNCTION public.media_validar_ruta() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER media_validar_ruta_trg
  BEFORE INSERT OR UPDATE OF path, path_miniatura, publicacion_id ON public.media
  FOR EACH ROW EXECUTE FUNCTION public.media_validar_ruta();
