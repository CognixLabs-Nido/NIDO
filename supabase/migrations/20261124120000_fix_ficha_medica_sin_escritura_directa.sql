-- =============================================================================
-- FIX — La ficha médica solo se escribe por sus funciones
-- -----------------------------------------------------------------------------
-- `ime_admin_all` era `FOR ALL`: con su sesión, Dirección podía hacer INSERT/UPDATE/DELETE en
-- `info_medica_emergencia` directamente (PostgREST), saltándose los dos setters, y guardar
-- texto sin cifrar en las seis columnas bytea (PostgREST convierte la cadena en sus bytes). La
-- app no lo hace (solo SELECT de la tabla; las escrituras van por RPC), pero la base lo permitía.
--
-- Todas las escrituras legítimas van por funciones SECURITY DEFINER de postgres, que no dependen
-- ni de la política ni de los permisos de `authenticated` (leídas en producción, 2026-10-26):
--   set_info_medica_emergencia_cifrada(_tutor), borrar_info_medica_nino_tutor,
--   purgar_sujeto_db, purgar_esqueleto_huerfano_nino.
--
-- Dos cerrojos, cada uno basta por sí solo:
--   · La política de Dirección pasa a solo lectura (`ime_admin_select`, misma condición). Las
--     listas del aula y la exportación siguen leyendo la tabla con la sesión.
--   · `authenticated` (y anon/PUBLIC) pierden INSERT, UPDATE, DELETE y TRUNCATE sobre la tabla:
--     una política de escritura añadida por error tampoco abriría la puerta.
-- service_role y postgres conservan la escritura (credenciales de servidor, no de usuario).
--
-- La aplica el responsable por SQL Editor, DESPUÉS de `20261123120000`. Tras aplicar:
-- registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_n integer;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policy
              WHERE polrelid = 'public.info_medica_emergencia'::regclass
                AND polname = 'ime_admin_select') THEN
    RAISE EXCEPTION 'ya aplicada: existe ime_admin_select';
  END IF;
  -- La política que se sustituye tiene que ser la leída en producción.
  SELECT count(*) INTO v_n FROM pg_policy
   WHERE polrelid = 'public.info_medica_emergencia'::regclass
     AND polname = 'ime_admin_all' AND polcmd = '*'
     AND pg_get_expr(polqual, polrelid) LIKE '%es_admin(privado.centro_de_nino(nino_id))'
     AND polwithcheck IS NULL;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'ime_admin_all no es la leída en producción';
  END IF;
  -- La única ficha médica cifrada tiene que serlo ya (20261123120000).
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'info_medica_emergencia'
     AND column_name IN ('alergias_graves', 'notas_emergencia', 'medicacion_habitual',
                         'alergias_leves', 'medico_familia', 'telefono_emergencia')
     AND data_type = 'bytea';
  IF v_n <> 6 THEN
    RAISE EXCEPTION 'falta 20261123120000: % de 6 columnas en bytea', v_n;
  END IF;
  RAISE NOTICE 'guarda previa: ime_admin_all (FOR ALL) presente; authenticated puede escribir: %',
    has_table_privilege('authenticated', 'public.info_medica_emergencia', 'INSERT,UPDATE,DELETE');
END
$guarda$;
