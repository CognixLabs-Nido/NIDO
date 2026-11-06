-- =============================================================================
-- FIX — Las rutas que firma el export se validan contra su dueño (2026-11-06)
-- -----------------------------------------------------------------------------
-- El export (`recolectarUsuario`, `recolectarNino`) firma con SERVICE ROLE las rutas guardadas, y
-- service role no pasa por las policies de Storage: quien escribe una ruta ajena se lleva el
-- fichero. `20261024130000` (#380) lo cerró para el DNI del tutor y el mandato con un trigger que ata
-- la ruta a su dueño. Quedaban tres, medidas en producción el 2026-11-06 en un ensayo terminado en
-- RAISE (`~/nido-logs/rutas/out.txt`):
--
-- - **`usuarios.foto_url`**: cada usuario actualiza su fila (`usuarios_self_update`, sin CHECK) y
--   la apuntaba a la carpeta de otro (1 fila; el control, la fila de otro, 0).
-- - **`ninos.foto_url` y `ninos.libro_familia_path`**: la Dirección escribe la ficha directamente
--   (`ninos_admin_all`) y las apuntaba a la carpeta de otro niño o a un objeto fuera de todo centro.
--   Las funciones del tutor (`fijar_libro_familia_nino`, `actualizar_foto_nino_tutor`) ya la
--   miraban; la tabla no.
-- - **`firmas_autorizacion.datos.adjuntos[].path`** (el DNI de quien recoge): `firmas_insert` no
--   mira `datos`. Hoy no hay ninguna plantilla de autorización en producción y por eso no se puede
--   firmar una recogida; con una publicada, el tutor creó la suya y la firmó con el adjunto en la
--   carpeta de otro niño. Se trata como abierta.
--
-- Mismo mecanismo que #380 (copiado, no reinventado): un trigger BEFORE que valida la ruta contra
-- la FILA, para todos (sesión, service role y las funciones; no `postgres`, que conserva su llave,
-- `docs/architecture/rls-policies.md`, «La llave de `postgres`»). Solo mira la ruta cuando cambia
-- (o al insertar): una fila vieja no impide tocar otras columnas. NULL pasa (las purgas la anulan).
-- Rutas válidas, las que dejan las rutas de subida de la app:
--
--   - foto del usuario: `{ese usuario}/<nombre>.jpg`                    (usuarios/[id]/avatar)
--   - foto del niño:    `{su centro}/{ese niño}/<nombre>.jpg`            (ninos/[id]/foto)
--   - libro de familia: `{su centro}/{ese niño}/<nombre>.pdf`            (alta/[ninoId]/libro-familia;
--                                                                         la regex de fijar_libro_familia_nino)
--   - DNI de recogida:  bucket `recogida-adjuntos`, `{centro del niño}/{el niño de la firma}/<nombre>.jpg`
--                                                                        (recogida/dni)
--   con `<nombre>` de un solo segmento `[A-Za-z0-9_-]`.
--
-- Estado en producción el 2026-11-06 (lectura): 0 fotos de usuario, 3 fotos y 3 libros de niño, 0
-- firmas con adjuntos; 0 fuera de su dueño. La guarda previa lo cuenta, lo imprime y para si hay
-- alguna: esa ruta ya se habría podido firmar y hay que mirarla a mano.
--
-- Sin orden con el despliegue: la app ya escribe estas rutas así. La aplica el responsable por SQL
-- Editor, copiando el fichero. Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_usuario int;
  v_foto int;
  v_libro int;
  v_adjuntos int;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc
     WHERE pronamespace = 'privado'::regnamespace
       AND proname IN ('usuarios_validar_ruta_foto', 'ninos_validar_rutas', 'firmas_validar_adjuntos')
  ) THEN
    RAISE EXCEPTION 'ya aplicada: existen las funciones de validación de rutas';
  END IF;

  SELECT count(*) INTO v_usuario FROM public.usuarios u
   WHERE u.foto_url IS NOT NULL AND u.foto_url !~ ('^' || u.id || '/[A-Za-z0-9_-]+\.jpg$');
  SELECT count(*) INTO v_foto FROM public.ninos n
   WHERE n.foto_url IS NOT NULL AND n.foto_url !~ ('^' || n.centro_id || '/' || n.id || '/[A-Za-z0-9_-]+\.jpg$');
  SELECT count(*) INTO v_libro FROM public.ninos n
   WHERE n.libro_familia_path IS NOT NULL
     AND n.libro_familia_path !~ ('^' || n.centro_id || '/' || n.id || '/[A-Za-z0-9_-]+\.pdf$');
  SELECT count(*) INTO v_adjuntos FROM public.firmas_autorizacion f
   WHERE f.datos ? 'adjuntos'
     AND (jsonb_typeof(f.datos->'adjuntos') <> 'array'
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements(f.datos->'adjuntos') a
             WHERE a->>'bucket' IS DISTINCT FROM 'recogida-adjuntos'
                OR coalesce(a->>'path', '') !~ ('^' || privado.centro_de_nino(f.nino_id) || '/' || f.nino_id || '/[A-Za-z0-9_-]+\.jpg$')));

  RAISE NOTICE 'rutas fuera de su dueño antes de cerrar: % fotos de usuario, % fotos de niño, % libros, % firmas con adjuntos (de %, %, %, %)',
    v_usuario, v_foto, v_libro, v_adjuntos,
    (SELECT count(*) FROM public.usuarios WHERE foto_url IS NOT NULL),
    (SELECT count(*) FROM public.ninos WHERE foto_url IS NOT NULL),
    (SELECT count(*) FROM public.ninos WHERE libro_familia_path IS NOT NULL),
    (SELECT count(*) FROM public.firmas_autorizacion WHERE datos ? 'adjuntos');
  IF v_usuario + v_foto + v_libro + v_adjuntos > 0 THEN
    RAISE EXCEPTION 'hay rutas fuera de su dueño (% usuario, % foto, % libro, % adjuntos): revisarlas antes de aplicar',
      v_usuario, v_foto, v_libro, v_adjuntos;
  END IF;
END
$guarda$;

-- ---- 1. La foto del usuario ----
CREATE FUNCTION privado.usuarios_validar_ruta_foto()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.foto_url IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.foto_url IS NOT DISTINCT FROM OLD.foto_url THEN
    RETURN NEW;
  END IF;
  IF NEW.foto_url !~ ('^' || NEW.id || '/[A-Za-z0-9_-]+\.jpg$') THEN
    RAISE EXCEPTION 'la ruta de la foto no es de este usuario'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION privado.usuarios_validar_ruta_foto() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER usuarios_validar_ruta_foto_trg
  BEFORE INSERT OR UPDATE OF foto_url ON public.usuarios
  FOR EACH ROW EXECUTE FUNCTION privado.usuarios_validar_ruta_foto();

-- ---- 2. La foto y el libro de familia del niño ----
-- También si cambia el centro del niño: las dos rutas llevan el centro.
CREATE FUNCTION privado.ninos_validar_rutas()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_centro_cambia boolean := TG_OP = 'UPDATE' AND NEW.centro_id IS DISTINCT FROM OLD.centro_id;
BEGIN
  IF NEW.foto_url IS NOT NULL
     AND (TG_OP = 'INSERT' OR v_centro_cambia OR NEW.foto_url IS DISTINCT FROM OLD.foto_url)
     AND NEW.foto_url !~ ('^' || NEW.centro_id || '/' || NEW.id || '/[A-Za-z0-9_-]+\.jpg$') THEN
    RAISE EXCEPTION 'la ruta de la foto no es de este niño'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.libro_familia_path IS NOT NULL
     AND (TG_OP = 'INSERT' OR v_centro_cambia OR NEW.libro_familia_path IS DISTINCT FROM OLD.libro_familia_path)
     AND NEW.libro_familia_path !~ ('^' || NEW.centro_id || '/' || NEW.id || '/[A-Za-z0-9_-]+\.pdf$') THEN
    RAISE EXCEPTION 'la ruta del libro de familia no es de este niño'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION privado.ninos_validar_rutas() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER ninos_validar_rutas_trg
  BEFORE INSERT OR UPDATE OF foto_url, libro_familia_path, centro_id ON public.ninos
  FOR EACH ROW EXECUTE FUNCTION privado.ninos_validar_rutas();

-- ---- 3. El DNI de quien recoge, en la firma ----
-- La firma no cambia nunca (sin UPDATE para nadie con sesión); el trigger mira también el UPDATE de
-- `datos` por si un camino del servidor lo hiciera.
CREATE FUNCTION privado.firmas_validar_adjuntos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_centro uuid;
BEGIN
  IF NEW.datos IS NULL OR NOT (NEW.datos ? 'adjuntos') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.datos->'adjuntos' IS NOT DISTINCT FROM OLD.datos->'adjuntos'
     AND NEW.nino_id IS NOT DISTINCT FROM OLD.nino_id THEN
    RETURN NEW;
  END IF;
  IF jsonb_typeof(NEW.datos->'adjuntos') <> 'array' THEN
    RAISE EXCEPTION 'los adjuntos de la firma no son una lista'
      USING ERRCODE = 'check_violation';
  END IF;
  v_centro := privado.centro_de_nino(NEW.nino_id);
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(NEW.datos->'adjuntos') a
     WHERE v_centro IS NULL
        OR jsonb_typeof(a) <> 'object'
        OR a->>'bucket' IS DISTINCT FROM 'recogida-adjuntos'
        OR coalesce(a->>'path', '') !~ ('^' || v_centro || '/' || NEW.nino_id || '/[A-Za-z0-9_-]+\.jpg$')
  ) THEN
    RAISE EXCEPTION 'un adjunto de la firma no es de este niño'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION privado.firmas_validar_adjuntos() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER firmas_validar_adjuntos_trg
  BEFORE INSERT OR UPDATE OF datos, nino_id ON public.firmas_autorizacion
  FOR EACH ROW EXECUTE FUNCTION privado.firmas_validar_adjuntos();

-- ---- Guarda posterior ----
DO $comprueba$
DECLARE
  v_triggers int;
BEGIN
  SELECT count(*) INTO v_triggers
    FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
   WHERE NOT t.tgisinternal
     AND t.tgenabled <> 'D'
     AND p.prosecdef
     AND ((t.tgrelid = 'public.usuarios'::regclass AND t.tgname = 'usuarios_validar_ruta_foto_trg'
           AND p.oid = 'privado.usuarios_validar_ruta_foto()'::regprocedure)
       OR (t.tgrelid = 'public.ninos'::regclass AND t.tgname = 'ninos_validar_rutas_trg'
           AND p.oid = 'privado.ninos_validar_rutas()'::regprocedure)
       OR (t.tgrelid = 'public.firmas_autorizacion'::regclass AND t.tgname = 'firmas_validar_adjuntos_trg'
           AND p.oid = 'privado.firmas_validar_adjuntos()'::regprocedure));
  IF v_triggers <> 3 THEN
    RAISE EXCEPTION 'se esperaban 3 triggers de validación de rutas activos; hay %', v_triggers;
  END IF;
  IF has_function_privilege('authenticated', 'privado.ninos_validar_rutas()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'privado.usuarios_validar_ruta_foto()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'privado.firmas_validar_adjuntos()', 'EXECUTE') THEN
    RAISE EXCEPTION 'una función de validación de rutas tiene EXECUTE para authenticated';
  END IF;
  RAISE NOTICE 'rutas que firma el export: % triggers de validación activos (foto del usuario, rutas del niño, adjuntos de la firma)',
    v_triggers;
END
$comprueba$;
