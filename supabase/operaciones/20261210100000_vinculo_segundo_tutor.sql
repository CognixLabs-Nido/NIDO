-- =============================================================================
-- OPERACIÓN 20261210100000 · El vínculo que el alta del hermano no le dio al segundo tutor
--
-- Una sola vez, en producción. NO es una migración: no cambia el esquema y no se registra en
-- supabase_migrations (convención en supabase/operaciones/README.md).
--
-- Contexto: un segundo tutor con cuenta no tiene vínculo con el hermano menor de su familia, y
-- entra en la app sin ver a ese hijo. El hermano se dio de alta antes del #291 (2026-10-02); el
-- flujo de entonces invitaba también a la cuenta que ya existía, la invitación falló (el email
-- ya tenía cuenta) y el vínculo no se creó nunca. Desde el #291, `crear_o_anadir_a_familia`
-- (bloque ALTA-HERMANO C3) da ese vínculo en el alta. Diagnóstico completo:
-- docs/operations/vinculo-segundo-tutor-2026-10.md.
--
-- Qué hace: da al tutor el vínculo que le habría dado el C3, por `privado.dar_vinculo` (la única
-- que inserta vínculos), con su papel en la familia (segundo_tutor → tutor_legal_secundario) y
-- copiando parentesco, descripción y permisos de su vínculo vivo con el otro hijo.
--
-- Qué caso: el que da el predicado del C3 (tutor con cuenta y rol tutor_legal vivo en la familia,
-- con vínculo de tutor vivo con otro hijo y sin vínculo vivo con un hijo vivo), que en el
-- diagnóstico es UNO solo. La identidad va fijada por el md5 de «usuario:niño», no por los ids:
-- el repo es público.
--
-- Todo es UN bloque DO: una sola sentencia, una sola transacción. Cualquier guarda que falle
-- lanza una excepción y no queda NADA hecho.
--
-- ENSAYO: anteponer `SET nido.ensayo = 'on';` al fichero. Corre todo, comprueba todas las
-- guardas y termina en RAISE EXCEPTION con los recuentos de antes y después: no confirma nada.
-- Sin esa línea, el fichero tal cual aplica de verdad.
--
-- No toca: la invitación vencida que dejó aquel alta (caducó el 2026-08-20; no da acceso), la
-- familia, los roles ni ningún otro vínculo.
-- =============================================================================

DO $operacion$
DECLARE
  -- md5(usuario_id || ':' || nino_id) del caso diagnosticado el 2026-10-30.
  c_par_md5      constant text := '2adacf5924d0cd9bd78b4e566300b165';
  c_actor        constant text := 'system:reparar_vinculo_segundo_tutor';

  -- RECUENTOS APROBADOS (diagnóstico del 2026-10-30). Si algo da otro número, rollback total.
  e_casos        constant bigint := 1;  -- casos del predicado del C3, antes
  e_vf_antes     constant bigint := 5;  -- vinculos_familiares, filas (todas vivas)
  e_vf_despues   constant bigint := 6;  -- vinculos_familiares, filas después: UNA más
  e_audit        constant bigint := 1;  -- filas de audit_log de esta transacción: el INSERT

  v_xid          xid;
  v_caso         record;
  v_n            bigint;
  v_casos_antes  bigint;
  v_casos_desp   bigint;
  v_vf_antes     bigint;
  v_vivos_antes  bigint;
  v_vf_desp      bigint;
  v_vivos_desp   bigint;
  v_resto_antes  text;
  v_resto_desp   text;
  v_resultado    text;
  v_nuevo        public.vinculos_familiares%ROWTYPE;
  f              text[] := '{}';
BEGIN
  -- Las filas de auditoría que escriba esta operación llevan este xmin. Sin bloques EXCEPTION
  -- dentro: no hay subtransacciones.
  v_xid := pg_current_xact_id()::xid;
  -- Sin humano, audit_trigger_function firma con esta etiqueta en vez de system:service_role.
  PERFORM set_config('app.audit_actor', c_actor, true);

  -- ── Los casos: lo que el C3 del #291 habría vinculado y no está ────────────────────────
  CREATE TEMP TABLE _casos ON COMMIT DROP AS
  SELECT n.id AS nino_id, ft.usuario_id,
         CASE WHEN ft.rol_familia = 'segundo_tutor'
              THEN 'tutor_legal_secundario'::public.tipo_vinculo
              ELSE 'tutor_legal_principal'::public.tipo_vinculo END AS tipo_vinculo,
         ref.parentesco, ref.descripcion_parentesco, ref.permisos, ref.refs
    FROM public.familia_tutores ft
    JOIN public.familias fa ON fa.id = ft.familia_id AND fa.deleted_at IS NULL
    JOIN public.ninos n ON n.familia_id = ft.familia_id AND n.deleted_at IS NULL
    CROSS JOIN LATERAL (
      SELECT vf.parentesco, vf.descripcion_parentesco, vf.permisos,
             count(*) OVER () AS refs
        FROM public.vinculos_familiares vf
        JOIN public.ninos n2 ON n2.id = vf.nino_id
       WHERE vf.usuario_id = ft.usuario_id
         AND n2.familia_id = ft.familia_id
         AND vf.nino_id <> n.id
         AND vf.deleted_at IS NULL
         AND vf.tipo_vinculo IN ('tutor_legal_principal', 'tutor_legal_secundario')
       ORDER BY vf.created_at DESC
       LIMIT 1
    ) ref
   WHERE ft.deleted_at IS NULL
     AND ft.usuario_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.roles_usuario ru
                  WHERE ru.usuario_id = ft.usuario_id AND ru.centro_id = fa.centro_id
                    AND ru.rol = 'tutor_legal' AND ru.deleted_at IS NULL)
     AND NOT EXISTS (SELECT 1 FROM public.vinculos_familiares vf
                      WHERE vf.usuario_id = ft.usuario_id AND vf.nino_id = n.id
                        AND vf.deleted_at IS NULL);

  -- ── RECUENTO ANTES ─────────────────────────────────────────────────────────────────────
  SELECT count(*) INTO v_casos_antes FROM _casos;
  SELECT count(*), count(*) FILTER (WHERE deleted_at IS NULL) INTO v_vf_antes, v_vivos_antes
    FROM public.vinculos_familiares;
  RAISE NOTICE 'ANTES | casos: % | vinculos_familiares: % filas, % vivas',
    v_casos_antes, v_vf_antes, v_vivos_antes;

  -- ── GUARDA DE ENTRADA ──────────────────────────────────────────────────────────────────
  IF v_casos_antes <> e_casos THEN
    RAISE EXCEPTION 'guarda de entrada: esperaba % caso y hay %; no se toca nada',
      e_casos, v_casos_antes;
  END IF;
  SELECT * INTO v_caso FROM _casos;
  IF md5(v_caso.usuario_id::text || ':' || v_caso.nino_id::text) <> c_par_md5 THEN
    RAISE EXCEPTION 'guarda de entrada: el caso no es el diagnosticado (md5 del par distinto)';
  END IF;
  IF v_caso.refs <> 1 THEN
    RAISE EXCEPTION 'guarda de entrada: esperaba 1 vínculo de referencia del tutor y hay %',
      v_caso.refs;
  END IF;
  -- Ni viva ni retirada: dar_vinculo tiene que CREAR, no reactivar una fila vieja.
  IF EXISTS (SELECT 1 FROM public.vinculos_familiares
              WHERE usuario_id = v_caso.usuario_id AND nino_id = v_caso.nino_id) THEN
    RAISE EXCEPTION 'guarda de entrada: el par ya tiene alguna fila en vinculos_familiares';
  END IF;
  IF v_vf_antes <> e_vf_antes OR v_vivos_antes <> e_vf_antes THEN
    RAISE EXCEPTION 'guarda de entrada: vinculos_familiares tiene % filas (% vivas), esperaba %',
      v_vf_antes, v_vivos_antes, e_vf_antes;
  END IF;
  -- Huella de todas las demás filas, para comprobar al final que no ha cambiado ninguna.
  SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), '')) INTO v_resto_antes
    FROM public.vinculos_familiares t;

  -- ── REPARACIÓN ─────────────────────────────────────────────────────────────────────────
  v_resultado := privado.dar_vinculo(v_caso.nino_id, v_caso.usuario_id, v_caso.tipo_vinculo,
    v_caso.parentesco, v_caso.descripcion_parentesco, v_caso.permisos);

  -- ── RECUENTO DESPUÉS ───────────────────────────────────────────────────────────────────
  SELECT count(*), count(*) FILTER (WHERE deleted_at IS NULL) INTO v_vf_desp, v_vivos_desp
    FROM public.vinculos_familiares;
  SELECT * INTO v_nuevo FROM public.vinculos_familiares
   WHERE usuario_id = v_caso.usuario_id AND nino_id = v_caso.nino_id AND deleted_at IS NULL;
  SELECT md5(coalesce(string_agg(t::text, '|' ORDER BY t.id), '')) INTO v_resto_desp
    FROM public.vinculos_familiares t WHERE t.id IS DISTINCT FROM v_nuevo.id;
  -- El predicado otra vez, sobre el estado nuevo: ya no queda ningún caso.
  SELECT count(*) INTO v_casos_desp
    FROM public.familia_tutores ft
    JOIN public.familias fa ON fa.id = ft.familia_id AND fa.deleted_at IS NULL
    JOIN public.ninos n ON n.familia_id = ft.familia_id AND n.deleted_at IS NULL
   WHERE ft.deleted_at IS NULL
     AND ft.usuario_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.roles_usuario ru
                  WHERE ru.usuario_id = ft.usuario_id AND ru.centro_id = fa.centro_id
                    AND ru.rol = 'tutor_legal' AND ru.deleted_at IS NULL)
     AND EXISTS (SELECT 1 FROM public.vinculos_familiares vf
                  JOIN public.ninos n2 ON n2.id = vf.nino_id
                 WHERE vf.usuario_id = ft.usuario_id AND n2.familia_id = ft.familia_id
                   AND vf.nino_id <> n.id AND vf.deleted_at IS NULL
                   AND vf.tipo_vinculo IN ('tutor_legal_principal', 'tutor_legal_secundario'))
     AND NOT EXISTS (SELECT 1 FROM public.vinculos_familiares vf
                      WHERE vf.usuario_id = ft.usuario_id AND vf.nino_id = n.id
                        AND vf.deleted_at IS NULL);
  RAISE NOTICE 'DESPUÉS | casos: % | vinculos_familiares: % filas, % vivas',
    v_casos_desp, v_vf_desp, v_vivos_desp;

  -- ── GUARDA DE RECUENTO: exactamente una fila, la nueva, y ninguna otra cambiada ────────
  IF v_resultado IS DISTINCT FROM 'creada' THEN
    f := f || format('dar_vinculo devolvió %s (esperado creada)', coalesce(v_resultado, 'NULL'));
  END IF;
  IF v_vf_desp <> e_vf_despues OR v_vivos_desp <> e_vf_despues THEN
    f := f || format('vinculos_familiares: %s filas (%s vivas), esperaba %s',
      v_vf_desp, v_vivos_desp, e_vf_despues);
  END IF;
  IF v_resto_desp IS DISTINCT FROM v_resto_antes THEN
    f := f || 'ha cambiado alguna fila de vinculos_familiares que no es la nueva'::text;
  END IF;
  IF v_nuevo.id IS NULL THEN
    f := f || 'no está el vínculo nuevo'::text;
  ELSIF v_nuevo.tipo_vinculo IS DISTINCT FROM v_caso.tipo_vinculo
     OR v_nuevo.parentesco IS DISTINCT FROM v_caso.parentesco
     OR v_nuevo.descripcion_parentesco IS DISTINCT FROM v_caso.descripcion_parentesco
     OR v_nuevo.permisos IS DISTINCT FROM v_caso.permisos THEN
    f := f || format('el vínculo nuevo no copia el de referencia (tipo %s, parentesco %s)',
      v_nuevo.tipo_vinculo, v_nuevo.parentesco);
  END IF;
  IF v_casos_desp <> 0 THEN
    f := f || format('quedan %s casos tras la reparación', v_casos_desp);
  END IF;
  -- audit_log: solo el INSERT del vínculo nuevo, firmado con la etiqueta de la operación.
  SELECT count(*) INTO v_n FROM public.audit_log WHERE xmin = v_xid;
  IF v_n <> e_audit
     OR NOT EXISTS (SELECT 1 FROM public.audit_log
                     WHERE xmin = v_xid AND tabla = 'vinculos_familiares' AND accion = 'INSERT'
                       AND registro_id = v_nuevo.id AND usuario_id IS NULL
                       AND actor_sistema = c_actor) THEN
    f := f || format('audit_log de esta transacción: %s filas; esperaba %s, el INSERT del vínculo con actor %s',
      v_n, e_audit, c_actor);
  END IF;

  IF cardinality(f) > 0 THEN
    RAISE EXCEPTION 'GUARDA: rollback total | %', array_to_string(f, ' | ');
  END IF;

  IF current_setting('nido.ensayo', true) = 'on' THEN
    RAISE EXCEPTION 'ENSAYO OK, nada confirmado | ANTES casos % · vínculos %/% vivos | dar_vinculo: % (%, %) | DESPUÉS casos % · vínculos %/% vivos | resto sin cambios | audit_log: % (INSERT, %)',
      v_casos_antes, v_vf_antes, v_vivos_antes, v_resultado, v_nuevo.tipo_vinculo,
      v_nuevo.parentesco, v_casos_desp, v_vf_desp, v_vivos_desp, v_n, c_actor;
  END IF;

  RAISE NOTICE 'Vínculo dado | ANTES casos % · vínculos % | DESPUÉS casos % · vínculos % | dar_vinculo: % | audit_log: %',
    v_casos_antes, v_vf_antes, v_casos_desp, v_vf_desp, v_resultado, v_n;
END $operacion$;
