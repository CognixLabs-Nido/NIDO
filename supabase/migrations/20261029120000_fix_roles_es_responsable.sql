-- =============================================================================
-- FIX — `es_responsable`: lo que solo hace la admin del centro (PR 1 del modelo de roles)
-- -----------------------------------------------------------------------------
-- El modelo de roles decidido tiene tres niveles: superusuario, admin (una por centro) y
-- directora (una o varias). `es_admin(centro)` pasará a significar «Dirección» (admin o
-- directora) en el PR 2, que añade el rol. Antes, este PR separa lo que es SOLO de la admin:
--   · `privado.es_responsable(centro)`: la admin viva del centro, o el superusuario si el centro
--     existe. El mismo cuerpo que `es_admin`, sin DEFAULT y con un cambio: con NULL da FALSE.
--     `es_admin(NULL)` es TRUE para cualquier admin de cualquier centro.
--   · Pasan a `es_responsable` las 28 policies y las 7 funciones de lo exclusivo de la admin:
--       - el centro: escribir `centros` (datos, logo y los datos de acreedor SEPA, que viven
--         ahí), las 3 de escritura del logo en Storage y `set_datos_acreedor`;
--       - las cuotas: escribir `conceptos_cobro`, `tarifa_concepto_anio` y `tipos_beca`;
--       - el curso: ponerlo en `cerrado`, o tocar uno cerrado, en `cursos_academicos`, y
--         `cerrar_curso`;
--       - las plantillas de las normas internas y del consentimiento de imagen
--         (`autorizaciones` con `es_plantilla`). Enviarlas a un aula o al centro sigue siendo
--         de Dirección;
--       - los derechos RGPD: `export_datos_sujeto` (la rama de Dirección; la del propio
--         usuario y la del tutor no cambian), `solicitar_olvido_nino`, `solicitar_olvido_usuario`,
--         `olvido_pendientes` y `purgar_sujeto_db`, y leer `export_log`, `olvido_solicitudes` y
--         `retencion_ejecuciones`;
--       - el registro de auditoría (`audit_admin_select`);
--       - los roles: escribir filas de `roles_usuario` e `invitaciones` con rol `admin`. Las de
--         los demás roles siguen siendo de Dirección.
--   · Lo que se queda en `es_admin`, porque Dirección lo necesita: leer el centro, las cuotas y
--     los cursos (la facturación del mes), `get_datos_acreedor` (el XML de la remesa) y crear o
--     activar un curso. Con el índice «un curso activo por centro», quien no es la admin solo
--     activa si no hay ninguno activo: el paso de curso va por `cerrar_curso`.
--
-- SIN CAMBIO DE COMPORTAMIENTO, salvo uno, declarado. Todos los `centro_id` que se pasan a
-- `es_responsable` son NOT NULL (la guarda previa lo comprueba), y con un centro no NULL las dos
-- funciones dan lo mismo. Hoy nadie es Dirección sin ser admin, así que lo exclusivo y lo de
-- Dirección coinciden. Las excepciones:
--   · EL CAMBIO DECLARADO: `audit_log.centro_id` admite NULL, y las filas de `usuarios` lo llevan
--     (no son de un centro). `audit_admin_select` era `es_admin(centro_id)`: cualquier admin de
--     cualquier centro leía el nombre y la foto de todos los usuarios. Con `es_responsable` no
--     las lee nadie con sesión, solo `service_role`, que es lo que decía la documentación.
--   · `set_datos_acreedor(NULL, …)` daba por bueno a cualquier admin y no actualizaba nada; ahora
--     da «No autorizado».
--
-- El índice «una admin viva por centro» NO va aquí: 6 ficheros de tests dan dos admins al mismo
-- centro, y la segunda pasa a ser directora cuando exista el rol (PR 2).
--
-- `es_responsable` vive en `privado` (20261028120000): la usan policies y funciones del
-- servidor, y la API no la publica. `es_admin` se queda en `public` porque la app la llama.
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor. Tras aplicar:
-- registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
  v_n int;
  v_esperados jsonb := '{
    "public.cerrar_curso(p_curso_destino_id uuid)": "405f9d66956f84dd14f1db14b42ab30b",
    "public.export_datos_sujeto(p_sujeto_tipo text, p_sujeto_id uuid)": "245c971e0af4083395a939dc099f813f",
    "public.olvido_pendientes()": "8e8da6a86f96ba99d181a4e48b198769",
    "public.purgar_sujeto_db(p_solicitud_id uuid)": "8849112609a08a927b5fe467e7b057c6",
    "public.set_datos_acreedor(p_centro_id uuid, p_identificador_acreedor text, p_bic_acreedor text, p_iban text)": "b54a371d35f6b3c763a39e748fdc941e",
    "public.solicitar_olvido_nino(p_nino_id uuid, p_inmediato boolean)": "09c9c0848aa699a7f6c5ddb315e639e4",
    "public.solicitar_olvido_usuario(p_usuario_id uuid, p_centro_id uuid, p_inmediato boolean)": "4cb235ff2ab99a76e36e05d4779015da"
  }'::jsonb;
  v_k text;
  v_nulos text;
  v_audit_nulos int;
BEGIN
  -- Las 28 policies de las tablas que se tocan (todas, también las que no cambian: una de más
  -- cambiaría lo que deja pasar cada orden) tienen que ser las del repo.
  SELECT md5(string_agg(md5(schemaname || '.' || tablename || '.' || policyname || '|' || cmd || '|'
                            || permissive || '|' || roles::text || '|' || coalesce(qual, '') || '|'
                            || coalesce(with_check, '')), ',' ORDER BY schemaname, tablename, policyname)),
         count(*)
    INTO v_md5, v_n
    FROM pg_policies
   WHERE (schemaname = 'public'
          AND tablename IN ('audit_log', 'autorizaciones', 'centros', 'conceptos_cobro',
                            'cursos_academicos', 'export_log', 'invitaciones', 'olvido_solicitudes',
                            'retencion_ejecuciones', 'roles_usuario', 'tarifa_concepto_anio', 'tipos_beca'))
      OR (schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'centro_assets_%');
  IF v_n <> 28 OR v_md5 IS DISTINCT FROM 'e5fca6ce1e13d7ca7959d1c0720d530e' THEN
    RAISE EXCEPTION 'las policies no son las esperadas (% policies, md5 %)', v_n, v_md5;
  END IF;

  -- Las 7 funciones, y es_admin, cuyo cuerpo copia es_responsable.
  v_esperados := v_esperados || jsonb_build_object('public.es_admin(p_centro_id uuid)', '33083a5ff24e8fd5ebaa03cb251e8ec8');
  FOR v_k IN SELECT jsonb_object_keys(v_esperados) LOOP
    SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
      INTO v_md5
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' = v_k;
    IF v_md5 IS DISTINCT FROM v_esperados ->> v_k THEN
      RAISE EXCEPTION 'el cuerpo de % no es el esperado (md5 %)', v_k, v_md5;
    END IF;
  END LOOP;

  IF to_regprocedure('privado.es_responsable(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'privado.es_responsable ya existe';
  END IF;

  -- La premisa de la equivalencia: con centro no NULL, es_responsable da lo mismo que es_admin.
  SELECT string_agg(c.table_name, ', ' ORDER BY c.table_name)
    INTO v_nulos
    FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.column_name = 'centro_id' AND c.is_nullable = 'YES'
     AND c.table_name IN ('conceptos_cobro', 'cursos_academicos', 'export_log', 'familias',
                          'invitaciones', 'lista_espera', 'mandatos_sepa', 'olvido_solicitudes',
                          'retencion_ejecuciones', 'roles_usuario', 'tarifa_concepto_anio',
                          'tipos_beca', 'autorizaciones');
  IF v_nulos IS NOT NULL THEN
    RAISE EXCEPTION 'centro_id admite NULL en: % (es_responsable ya no daría lo mismo que es_admin)', v_nulos;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'centros' AND column_name = 'id' AND is_nullable = 'YES') THEN
    RAISE EXCEPTION 'centros.id admite NULL';
  END IF;

  -- El cambio declarado: las filas que dejan de leerse con sesión. Solo se imprime: la BD vacía
  -- del CI da otro número.
  SELECT count(*) INTO v_audit_nulos FROM public.audit_log WHERE centro_id IS NULL;
  RAISE NOTICE 'guarda previa: 28 policies y 8 cuerpos como en el repo, 13 centro_id NOT NULL; filas de audit_log sin centro, que deja de leer cualquier admin: %',
    v_audit_nulos;
END
$guarda$;

-- -----------------------------------------------------------------------------
-- La función
-- -----------------------------------------------------------------------------
CREATE FUNCTION privado.es_responsable(p_centro_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- El cuerpo de es_admin con el centro obligatorio: con NULL, FALSE.
  SELECT p_centro_id IS NOT NULL
     AND (EXISTS (
            SELECT 1 FROM public.roles_usuario
            WHERE usuario_id = auth.uid()
              AND rol = 'admin'
              AND deleted_at IS NULL
              AND centro_id = p_centro_id
          )
          OR (public.is_superadmin()
              AND EXISTS (SELECT 1 FROM public.centros c WHERE c.id = p_centro_id)));
$function$;

REVOKE ALL ON FUNCTION privado.es_responsable(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION privado.es_responsable(uuid) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Las 4 policies ALL se parten por orden: leer sigue en es_admin, escribir lo exclusivo pasa a
-- es_responsable. Cada condición nueva es la vieja con «AND (no es exclusivo OR es_responsable)».
-- -----------------------------------------------------------------------------
DROP POLICY centros_admin_all ON public.centros;
CREATE POLICY centros_admin_select ON public.centros
  FOR SELECT TO authenticated USING (es_admin(id));
CREATE POLICY centros_responsable_insert ON public.centros
  FOR INSERT TO authenticated WITH CHECK (privado.es_responsable(id));
CREATE POLICY centros_responsable_update ON public.centros
  FOR UPDATE TO authenticated USING (privado.es_responsable(id)) WITH CHECK (privado.es_responsable(id));
CREATE POLICY centros_responsable_delete ON public.centros
  FOR DELETE TO authenticated USING (privado.es_responsable(id));

DROP POLICY cursos_admin_all ON public.cursos_academicos;
CREATE POLICY cursos_admin_select ON public.cursos_academicos
  FOR SELECT TO authenticated USING (es_admin(centro_id));
CREATE POLICY cursos_admin_insert ON public.cursos_academicos
  FOR INSERT TO authenticated
  WITH CHECK (es_admin(centro_id) AND (estado <> 'cerrado'::curso_estado OR privado.es_responsable(centro_id)));
CREATE POLICY cursos_admin_update ON public.cursos_academicos
  FOR UPDATE TO authenticated
  USING (es_admin(centro_id) AND (estado <> 'cerrado'::curso_estado OR privado.es_responsable(centro_id)))
  WITH CHECK (es_admin(centro_id) AND (estado <> 'cerrado'::curso_estado OR privado.es_responsable(centro_id)));
CREATE POLICY cursos_admin_delete ON public.cursos_academicos
  FOR DELETE TO authenticated
  USING (es_admin(centro_id) AND (estado <> 'cerrado'::curso_estado OR privado.es_responsable(centro_id)));

DROP POLICY roles_admin_all ON public.roles_usuario;
CREATE POLICY roles_admin_select ON public.roles_usuario
  FOR SELECT TO authenticated USING (es_admin(centro_id));
CREATE POLICY roles_admin_insert ON public.roles_usuario
  FOR INSERT TO authenticated
  WITH CHECK (es_admin(centro_id) AND (rol <> 'admin'::user_role OR privado.es_responsable(centro_id)));
CREATE POLICY roles_admin_update ON public.roles_usuario
  FOR UPDATE TO authenticated
  USING (es_admin(centro_id) AND (rol <> 'admin'::user_role OR privado.es_responsable(centro_id)))
  WITH CHECK (es_admin(centro_id) AND (rol <> 'admin'::user_role OR privado.es_responsable(centro_id)));
CREATE POLICY roles_admin_delete ON public.roles_usuario
  FOR DELETE TO authenticated
  USING (es_admin(centro_id) AND (rol <> 'admin'::user_role OR privado.es_responsable(centro_id)));

DROP POLICY invitaciones_admin ON public.invitaciones;
CREATE POLICY invitaciones_admin_select ON public.invitaciones
  FOR SELECT TO authenticated USING (es_admin(centro_id));
CREATE POLICY invitaciones_admin_insert ON public.invitaciones
  FOR INSERT TO authenticated
  WITH CHECK (es_admin(centro_id) AND (rol_objetivo <> 'admin'::user_role OR privado.es_responsable(centro_id)));
CREATE POLICY invitaciones_admin_update ON public.invitaciones
  FOR UPDATE TO authenticated
  USING (es_admin(centro_id) AND (rol_objetivo <> 'admin'::user_role OR privado.es_responsable(centro_id)))
  WITH CHECK (es_admin(centro_id) AND (rol_objetivo <> 'admin'::user_role OR privado.es_responsable(centro_id)));
CREATE POLICY invitaciones_admin_delete ON public.invitaciones
  FOR DELETE TO authenticated
  USING (es_admin(centro_id) AND (rol_objetivo <> 'admin'::user_role OR privado.es_responsable(centro_id)));

-- -----------------------------------------------------------------------------
-- Las cuotas: escribir, solo la admin. Leer sigue en es_admin (la facturación del mes).
-- -----------------------------------------------------------------------------
ALTER POLICY conceptos_cobro_insert ON public.conceptos_cobro
  WITH CHECK (privado.es_responsable(centro_id));
ALTER POLICY conceptos_cobro_update ON public.conceptos_cobro
  USING (privado.es_responsable(centro_id)) WITH CHECK (privado.es_responsable(centro_id));

ALTER POLICY tipos_beca_insert ON public.tipos_beca
  WITH CHECK (privado.es_responsable(centro_id));
ALTER POLICY tipos_beca_update ON public.tipos_beca
  USING (privado.es_responsable(centro_id)) WITH CHECK (privado.es_responsable(centro_id));

ALTER POLICY tarifa_concepto_anio_insert ON public.tarifa_concepto_anio
  WITH CHECK (privado.es_responsable(centro_id) AND (centro_id = privado.centro_de_concepto(concepto_id)));
ALTER POLICY tarifa_concepto_anio_update ON public.tarifa_concepto_anio
  USING (privado.es_responsable(centro_id))
  WITH CHECK (privado.es_responsable(centro_id) AND (centro_id = privado.centro_de_concepto(concepto_id)));
ALTER POLICY tarifa_concepto_anio_delete ON public.tarifa_concepto_anio
  USING (privado.es_responsable(centro_id));

-- -----------------------------------------------------------------------------
-- Las plantillas de las normas internas y del consentimiento de imagen: solo la admin. La rama
-- de Dirección sigue para todo lo demás (enviarlas, salidas, recogida, medicación). Las ramas de
-- la profe, la familia y quien creó la fila no cambian.
-- -----------------------------------------------------------------------------
ALTER POLICY autorizaciones_insert ON public.autorizaciones
  WITH CHECK ((creado_por = auth.uid()) AND (privado.es_responsable(centro_id) OR (es_admin(centro_id) AND NOT (es_plantilla AND (tipo = ANY (ARRAY['reglas_regimen_interno'::tipo_autorizacion, 'autorizacion_imagenes'::tipo_autorizacion])))) OR ((tipo = 'salida'::tipo_autorizacion) AND es_profe_de_evento(evento_id) AND (privado.centro_de_evento(evento_id) = centro_id)) OR ((es_plantilla = false) AND (tipo = ANY (ARRAY['recogida'::tipo_autorizacion, 'medicacion'::tipo_autorizacion, 'autorizacion_imagenes'::tipo_autorizacion])) AND (ambito = 'nino'::autorizacion_ambito) AND (nino_id IS NOT NULL) AND (plantilla_id IS NOT NULL) AND tiene_permiso_sobre(nino_id, 'puede_firmar_autorizaciones'::text) AND privado.autorizacion_plantilla_valida(plantilla_id, centro_id, tipo))));
ALTER POLICY autorizaciones_update ON public.autorizaciones
  USING ((creado_por = auth.uid()) OR privado.es_responsable(centro_id) OR (es_admin(centro_id) AND NOT (es_plantilla AND (tipo = ANY (ARRAY['reglas_regimen_interno'::tipo_autorizacion, 'autorizacion_imagenes'::tipo_autorizacion])))))
  WITH CHECK ((creado_por = auth.uid()) OR privado.es_responsable(centro_id) OR (es_admin(centro_id) AND NOT (es_plantilla AND (tipo = ANY (ARRAY['reglas_regimen_interno'::tipo_autorizacion, 'autorizacion_imagenes'::tipo_autorizacion])))));

-- -----------------------------------------------------------------------------
-- Auditoría y RGPD: leer, solo la admin. audit_admin_select es el cambio declarado.
-- -----------------------------------------------------------------------------
ALTER POLICY audit_admin_select ON public.audit_log USING (privado.es_responsable(centro_id));
ALTER POLICY export_log_admin_select ON public.export_log USING (privado.es_responsable(centro_id));
ALTER POLICY olvido_solicitudes_admin_select ON public.olvido_solicitudes USING (privado.es_responsable(centro_id));
ALTER POLICY retencion_ejecuciones_admin_select ON public.retencion_ejecuciones USING (privado.es_responsable(centro_id));

-- -----------------------------------------------------------------------------
-- El logo: las 3 de escritura de `centro-assets`. La lectura es pública (ADR-0010).
-- -----------------------------------------------------------------------------
ALTER POLICY centro_assets_delete ON storage.objects
  USING ((bucket_id = 'centro-assets'::text) AND privado.es_responsable(((storage.foldername(name))[1])::uuid) AND ((storage.foldername(name))[1] IS NOT NULL));
ALTER POLICY centro_assets_insert ON storage.objects
  WITH CHECK ((bucket_id = 'centro-assets'::text) AND privado.es_responsable(((storage.foldername(name))[1])::uuid) AND ((storage.foldername(name))[1] IS NOT NULL));
ALTER POLICY centro_assets_update ON storage.objects
  USING ((bucket_id = 'centro-assets'::text) AND privado.es_responsable(((storage.foldername(name))[1])::uuid) AND ((storage.foldername(name))[1] IS NOT NULL))
  WITH CHECK ((bucket_id = 'centro-assets'::text) AND privado.es_responsable(((storage.foldername(name))[1])::uuid) AND ((storage.foldername(name))[1] IS NOT NULL));

-- -----------------------------------------------------------------------------
-- Las 7 funciones: la definición viva de producción con `public.es_admin(` cambiado por
-- `privado.es_responsable(` (17 llamadas) y los 3 comentarios que lo nombraban. Nada más.
-- `CREATE OR REPLACE` conserva el dueño y los permisos.
-- -----------------------------------------------------------------------------
-- public.cerrar_curso(p_curso_destino_id uuid): 1 llamada
CREATE OR REPLACE FUNCTION public.cerrar_curso(p_curso_destino_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_centro_id            uuid;
  v_destino_estado       public.curso_estado;
  v_saliente_id          uuid;
  v_saliente_fin         date;
  v_fecha_baja           date;
  v_finalizados          integer := 0;
  v_familias_revocadas   integer := 0;
  v_matriculas_cerradas  integer := 0;
  v_profes_cerrados      integer := 0;
  r_fin                  record;
BEGIN
  -- 0. Existencia + centro + estado del curso destino.
  SELECT centro_id, estado
    INTO v_centro_id, v_destino_estado
    FROM public.cursos_academicos
    WHERE id = p_curso_destino_id AND deleted_at IS NULL;
  IF v_centro_id IS NULL THEN
    RAISE EXCEPTION 'curso destino % no existe', p_curso_destino_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- 1. AUTORIZACIÓN (primera sentencia con efecto; definer bypassa RLS → el gate
  --    ES la autorización real). Camino admin: privado.es_responsable(v_centro_id) sobre auth.uid().
  IF NOT (privado.es_responsable(v_centro_id) OR (SELECT auth.role()) = 'service_role') THEN
    RAISE EXCEPTION 'no autorizado a cerrar el curso de este centro';
  END IF;

  -- 2. IDEMPOTENCIA: destino ya activo → el cierre ya se hizo, no-op limpio.
  IF v_destino_estado = 'activo' THEN
    RETURN jsonb_build_object(
      'curso_destino_id', p_curso_destino_id, 'cerrado', false,
      'ya_activo', true, 'motivo', 'ya_activo'
    );
  END IF;
  IF v_destino_estado <> 'planificado' THEN
    RAISE EXCEPTION 'curso destino % no está planificado (estado=%)',
      p_curso_destino_id, v_destino_estado USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- 3. Curso SALIENTE = el ACTIVO del centro (de donde salen los niños). Puede no
  --    existir (primera activación del centro): entonces no hay finalizadores ni
  --    matrículas viejas que cerrar; solo se activa el destino.
  SELECT id, fecha_fin
    INTO v_saliente_id, v_saliente_fin
    FROM public.cursos_academicos
    WHERE centro_id = v_centro_id AND estado = 'activo' AND deleted_at IS NULL;

  v_fecha_baja := COALESCE(v_saliente_fin, public.hoy_madrid());

  -- 4. FINALIZAN: archivar TODOS los finalizadores del destino. Se hace ANTES de
  --    revocar (paso 5) para que el guard de revocar vea el estado final.
  FOR r_fin IN
    SELECT rf.nino_id
      FROM public.rollover_finaliza rf
     WHERE rf.curso_academico_id = p_curso_destino_id
  LOOP
    PERFORM public.archivar_nino(r_fin.nino_id, 'fin de etapa (no continúa)', v_fecha_baja);
    v_finalizados := v_finalizados + 1;
  END LOOP;

  -- 5. Revocar acceso de las familias afectadas (dedupe por familia). El guard
  --    interno solo revoca si la familia quedó SIN niños activos: un hermano que
  --    continúa (nunca archivado, vínculos vivos) la protege.
  FOR r_fin IN
    SELECT DISTINCT n.familia_id
      FROM public.rollover_finaliza rf
      JOIN public.ninos n ON n.id = rf.nino_id
     WHERE rf.curso_academico_id = p_curso_destino_id
       AND n.familia_id IS NOT NULL
  LOOP
    IF (public.revocar_acceso_familia(r_fin.familia_id) ->> 'revocado')::boolean THEN
      v_familias_revocadas := v_familias_revocadas + 1;
    END IF;
  END LOOP;

  -- 6. Borrar las filas rollover_finaliza consumidas (el soft-delete del niño NO
  --    las cascadea → borrado explícito).
  DELETE FROM public.rollover_finaliza WHERE curso_academico_id = p_curso_destino_id;

  -- 7. CONTINÚAN: flip pendiente → activa en el destino.
  UPDATE public.matriculas
     SET estado = 'activa'
   WHERE curso_academico_id = p_curso_destino_id
     AND estado = 'pendiente'
     AND deleted_at IS NULL;

  -- 8+9. Cierre de matrículas viejas y profes_aulas del saliente (si hay saliente).
  IF v_saliente_id IS NOT NULL THEN
    -- 8. Matrícula VIEJA de los que continúan (los finalizadores ya están 'baja').
    --    Acotada por curso_academico_id = saliente → NUNCA la nueva del destino.
    WITH cerradas AS (
      UPDATE public.matriculas
         SET estado = 'baja', fecha_baja = v_saliente_fin, motivo_baja = 'pasa de curso'
       WHERE curso_academico_id = v_saliente_id
         AND estado = 'activa'
         AND fecha_baja IS NULL
         AND deleted_at IS NULL
      RETURNING 1
    )
    SELECT count(*) INTO v_matriculas_cerradas FROM cerradas;

    -- 9. profes_aulas VIEJAS del saliente → fecha_fin = fin de curso.
    WITH profes AS (
      UPDATE public.profes_aulas
         SET fecha_fin = v_saliente_fin
       WHERE curso_academico_id = v_saliente_id
         AND fecha_fin IS NULL
         AND deleted_at IS NULL
      RETURNING 1
    )
    SELECT count(*) INTO v_profes_cerrados FROM profes;

    -- 10a. Cerrar el curso saliente.
    UPDATE public.cursos_academicos SET estado = 'cerrado' WHERE id = v_saliente_id;
  END IF;

  -- 10b. Activar el curso destino.
  UPDATE public.cursos_academicos SET estado = 'activo' WHERE id = p_curso_destino_id;

  RETURN jsonb_build_object(
    'curso_destino_id', p_curso_destino_id,
    'curso_saliente_id', v_saliente_id,
    'cerrado', true,
    'ya_activo', false,
    'fecha_fin', v_saliente_fin,
    'finalizados', v_finalizados,
    'familias_revocadas', v_familias_revocadas,
    'matriculas_continuan_cerradas', v_matriculas_cerradas,
    'profes_aulas_cerrados', v_profes_cerrados
  );
END $function$;

-- public.export_datos_sujeto(p_sujeto_tipo text, p_sujeto_id uuid): 11 llamadas
CREATE OR REPLACE FUNCTION public.export_datos_sujeto(p_sujeto_tipo text, p_sujeto_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_self   boolean;
  v_admin  boolean;
  v_centro uuid;
  v_email  text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'no autorizado a exportar este sujeto'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ---------------------------------------------------------------- USUARIO
  IF p_sujeto_tipo = 'usuario' THEN
    v_self := v_uid = p_sujeto_id;
    IF NOT v_self AND NOT EXISTS (
      SELECT 1 FROM public.roles_usuario ru
       WHERE ru.usuario_id = p_sujeto_id
         AND ru.deleted_at IS NULL
         AND privado.es_responsable(ru.centro_id)
    ) THEN
      RAISE EXCEPTION 'no autorizado a exportar este sujeto'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT u.email INTO v_email FROM auth.users u WHERE u.id = p_sujeto_id;

    -- Cada fila con centro pasa si es el propio usuario o si quien exporta es admin de ese
    -- centro (centro NULL nunca: es_responsable(NULL) es FALSE).
    RETURN jsonb_build_object(
      'preferencias', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'clave', p.clave, 'valor', p.valor, 'actualizado_en', p.updated_at)
               ORDER BY p.clave)
          FROM public.preferencias_usuario p
         WHERE p.usuario_id = p_sujeto_id), '[]'::jsonb),

      'dispositivos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'navegador', s.user_agent, 'registrado_en', s.created_at,
                 'ultima_actividad', s.last_active_at)
               ORDER BY s.created_at)
          FROM public.push_subscriptions s
         WHERE s.usuario_id = p_sujeto_id), '[]'::jsonb),

      'lecturas_conversaciones', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'conversacion_id', l.conversacion_id, 'leido_hasta', l.last_read_at)
               ORDER BY l.last_read_at)
          FROM public.lectura_conversacion l
          JOIN public.conversaciones c ON c.id = l.conversacion_id
         WHERE l.usuario_id = p_sujeto_id
           AND (v_self OR (c.centro_id IS NOT NULL AND privado.es_responsable(c.centro_id)))), '[]'::jsonb),

      'lecturas_anuncios', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'anuncio_id', l.anuncio_id, 'anuncio', a.titulo, 'leido_en', l.leido_at)
               ORDER BY l.leido_at)
          FROM public.lectura_anuncio l
          JOIN public.anuncios a ON a.id = l.anuncio_id
         WHERE l.usuario_id = p_sujeto_id
           AND (v_self OR (a.centro_id IS NOT NULL AND privado.es_responsable(a.centro_id)))), '[]'::jsonb),

      'invitaciones', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'email', i.email, 'nombre_completo', i.nombre_completo,
                 'rol_objetivo', i.rol_objetivo, 'tipo_vinculo', i.tipo_vinculo,
                 'enviada_en', i.created_at, 'expira_en', i.expires_at,
                 'aceptada_en', i.accepted_at, 'rechazada_en', i.rejected_at)
               ORDER BY i.created_at)
          FROM public.invitaciones i
         WHERE v_email IS NOT NULL
           AND lower(i.email) = lower(v_email)
           AND (v_self OR privado.es_responsable(i.centro_id))), '[]'::jsonb),

      'lista_espera_contacto', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'telefono_tutor', le.telefono_tutor, 'email_tutor', le.email_tutor)
               ORDER BY le.created_at)
          FROM public.lista_espera le
         WHERE le.tutor_usuario_id = p_sujeto_id
           AND (v_self OR privado.es_responsable(le.centro_id))), '[]'::jsonb),

      'exportaciones', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'exportado_en', e.created_at,
                 'solicitado_por_ti', e.solicitado_por = p_sujeto_id)
               ORDER BY e.created_at)
          FROM public.export_log e
         WHERE e.sujeto_tipo = 'usuario' AND e.sujeto_id = p_sujeto_id
           AND (v_self OR privado.es_responsable(e.centro_id))), '[]'::jsonb),

      'solicitudes_olvido', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'solicitado_en', o.solicitado_en, 'gracia_hasta', o.gracia_hasta,
                 'inmediato', o.inmediato, 'purgado_en', o.purgado_en)
               ORDER BY o.solicitado_en)
          FROM public.olvido_solicitudes o
         WHERE o.sujeto_tipo = 'usuario' AND o.sujeto_id = p_sujeto_id
           AND (v_self OR privado.es_responsable(o.centro_id))), '[]'::jsonb),

      -- Su perfil de tutor en cada familia (solo su fila, no la del otro tutor).
      'perfiles_familia', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'familia_id', ft.familia_id, 'rol_familia', ft.rol_familia,
                 'nombre_completo', ft.nombre_completo, 'email', ft.email,
                 'direccion_calle', ft.direccion_calle, 'direccion_numero', ft.direccion_numero,
                 'direccion_cp', ft.direccion_cp, 'direccion_ciudad', ft.direccion_ciudad,
                 'dni_documento_path', ft.dni_documento_path)
               ORDER BY ft.created_at)
          FROM public.familia_tutores ft
          JOIN public.familias f ON f.id = ft.familia_id
         WHERE ft.usuario_id = p_sujeto_id AND ft.deleted_at IS NULL
           AND (v_self OR privado.es_responsable(f.centro_id))), '[]'::jsonb),

      -- Los mandatos que firmó él. Del IBAN, solo los 4 últimos dígitos.
      'mandatos_sepa', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'identificador_mandato', m.identificador_mandato, 'titular', m.titular,
                 'iban_ultimos4', m.iban_ultimos4, 'estado', m.estado,
                 'metodo_firma', m.metodo_firma, 'fecha_firma', m.fecha_firma,
                 'nombre_tecleado', m.nombre_tecleado, 'firma_imagen', m.firma_imagen,
                 'ip_firma', host(m.ip_address), 'navegador_firma', m.user_agent,
                 'documento_path', m.documento_path)
               ORDER BY m.created_at)
          FROM public.mandatos_sepa m
         WHERE m.usuario_id = p_sujeto_id AND m.deleted_at IS NULL
           AND (v_self OR privado.es_responsable(m.centro_id))), '[]'::jsonb),

      -- Cobros de cada familia de la que es tutor (los dos tutores reciben lo mismo).
      'cobros_familia', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'familia', f.etiqueta,
                 'recibos', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                            'anio', r.anio, 'mes', r.mes, 'estado', r.estado, 'metodo', r.metodo,
                            'total_centimos', r.total_centimos, 'es_esporadico', r.es_esporadico,
                            'concepto_esporadico', r.concepto_esporadico,
                            'fecha_envio_banco', r.fecha_envio_banco,
                            'fecha_devolucion', r.fecha_devolucion,
                            'lineas', COALESCE((
                              SELECT jsonb_agg(jsonb_build_object(
                                       'descripcion', lr.descripcion, 'cantidad', lr.cantidad,
                                       'precio_unitario_centimos', lr.precio_unitario_centimos,
                                       'importe_centimos', lr.importe_centimos)
                                     ORDER BY lr.created_at, lr.id)
                                FROM public.lineas_recibo lr
                               WHERE lr.recibo_id = r.id), '[]'::jsonb))
                          ORDER BY r.anio, r.mes, r.created_at)
                     FROM public.recibos r
                    WHERE r.familia_id = f.id AND r.deleted_at IS NULL), '[]'::jsonb),
                 'metodos_pago', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                            'anio', mp.anio, 'mes', mp.mes, 'metodo', mp.metodo)
                          ORDER BY mp.anio, mp.mes)
                     FROM public.metodo_pago_familia mp
                    WHERE mp.familia_id = f.id AND mp.deleted_at IS NULL), '[]'::jsonb),
                 'conceptos_asignados', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                            'concepto', cc.nombre, 'cantidad', ac.cantidad_default,
                            'importe_especial_centimos', ac.importe_override_centimos,
                            'vigencia_desde', ac.vigencia_desde,
                            'vigencia_hasta', ac.vigencia_hasta)
                          ORDER BY ac.created_at)
                     FROM public.asignacion_concepto ac
                     JOIN public.conceptos_cobro cc ON cc.id = ac.concepto_id
                    WHERE ac.familia_id = f.id AND ac.deleted_at IS NULL), '[]'::jsonb),
                 'beca_comedor_excesos', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                            'anio', d.anio, 'mes', d.mes,
                            'cuota_total_centimos', d.cuota_total_centimos,
                            'beca_total_centimos', d.beca_total_centimos,
                            'exceso_centimos', d.exceso_centimos,
                            'estado', d.estado, 'via', d.via, 'resuelto_en', d.resuelto_at)
                          ORDER BY d.anio, d.mes)
                     FROM public.beca_comedor_desborde d
                    WHERE d.familia_id = f.id), '[]'::jsonb),
                 'beca_comedor_transferencias', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                            'anio', bt.anio, 'mes', bt.mes,
                            'importe_centimos', bt.importe_centimos,
                            'estado', bt.estado, 'realizada_en', bt.realizada_at)
                          ORDER BY bt.anio, bt.mes)
                     FROM public.beca_comedor_transferencia bt
                    WHERE bt.familia_id = f.id), '[]'::jsonb))
               ORDER BY f.created_at)
          FROM public.familias f
         WHERE f.id IN (SELECT ft.familia_id FROM public.familia_tutores ft
                         WHERE ft.usuario_id = p_sujeto_id AND ft.deleted_at IS NULL)
           AND (v_self OR privado.es_responsable(f.centro_id))), '[]'::jsonb)
    );
  END IF;

  -- ---------------------------------------------------------------- NIÑO
  IF p_sujeto_tipo = 'nino' THEN
    v_centro := privado.centro_de_nino(p_sujeto_id);
    IF v_centro IS NULL THEN
      RAISE EXCEPTION 'no autorizado a exportar este sujeto'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    v_admin := privado.es_responsable(v_centro);
    IF NOT v_admin AND NOT public.es_tutor_legal_de(p_sujeto_id) THEN
      RAISE EXCEPTION 'no autorizado a exportar este sujeto'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN jsonb_build_object(
      -- Su prospecto entero.
      'lista_espera', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'nombre_nino', le.nombre_nino, 'apellidos_nino', le.apellidos_nino,
                 'fecha_nacimiento', le.fecha_nacimiento, 'telefono_tutor', le.telefono_tutor,
                 'email_tutor', le.email_tutor, 'nota', le.nota, 'posicion', le.posicion,
                 'estado', le.estado, 'curso', ca.nombre, 'apuntado_en', le.created_at)
               ORDER BY le.created_at)
          FROM public.lista_espera le
          LEFT JOIN public.cursos_academicos ca ON ca.id = le.curso_academico_id
         WHERE le.nino_id = p_sujeto_id), '[]'::jsonb),

      -- Sin motivo_baja. La familia, solo activa/baja (como get_recorrido_nino_familia).
      'matriculas', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'id', m.id, 'aula', a.nombre, 'curso', ca.nombre, 'estado', m.estado,
                 'fecha_alta', m.fecha_alta, 'fecha_baja', m.fecha_baja,
                 'activada_en', m.activada_at)
               ORDER BY ca.fecha_inicio, m.fecha_alta, m.id)
          FROM public.matriculas m
          JOIN public.aulas a ON a.id = m.aula_id
          JOIN public.cursos_academicos ca ON ca.id = m.curso_academico_id
         WHERE m.nino_id = p_sujeto_id AND m.deleted_at IS NULL
           AND (v_admin OR m.estado IN ('activa', 'baja'))), '[]'::jsonb),

      -- Por sujeto, no por quién firmó: sale también el que dio el otro tutor.
      'consentimientos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'tipo', c.tipo, 'version_texto', c.version, 'aceptado_en', c.aceptado_en,
                 'revocado_en', c.revocado_en, 'metodo_firma', c.metodo_firma,
                 'otorgado_por', u.nombre_completo)
               ORDER BY c.aceptado_en)
          FROM public.consentimientos c
          LEFT JOIN public.usuarios u ON u.id = c.usuario_id
         WHERE c.nino_id = p_sujeto_id), '[]'::jsonb),

      'acuses_alta', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'tipo', aa.tipo, 'metodo', aa.metodo, 'aceptado_en', aa.aceptado_en)
               ORDER BY aa.aceptado_en)
          FROM public.acuses_alta aa
         WHERE aa.nino_id = p_sujeto_id), '[]'::jsonb),

      'cambios_solicitados', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'entidad', cp.entidad, 'campo', cp.campo,
                 'valor_propuesto', cp.valor_propuesto, 'detalle', cp.payload,
                 'estado', cp.estado, 'solicitado_en', cp.created_at,
                 'decidido_en', cp.decided_at)
               ORDER BY cp.created_at)
          FROM public.cambios_pendientes cp
         WHERE cp.nino_id = p_sujeto_id), '[]'::jsonb),

      'fin_de_curso', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('curso', ca.nombre, 'registrado_en', rf.created_at)
               ORDER BY rf.created_at)
          FROM public.rollover_finaliza rf
          JOIN public.cursos_academicos ca ON ca.id = rf.curso_academico_id
         WHERE rf.nino_id = p_sujeto_id), '[]'::jsonb),

      'citas', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'titulo', ci.titulo, 'tipo', ci.tipo, 'fecha', ci.fecha,
                 'hora_inicio', ci.hora_inicio, 'hora_fin', ci.hora_fin, 'lugar', ci.lugar,
                 'descripcion', ci.descripcion, 'estado', ci.estado)
               ORDER BY ci.fecha, ci.hora_inicio)
          FROM public.citas ci
         WHERE ci.nino_id = p_sujeto_id), '[]'::jsonb),

      'eventos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'titulo', e.titulo, 'tipo', e.tipo, 'fecha', e.fecha, 'fecha_fin', e.fecha_fin,
                 'hora_inicio', e.hora_inicio, 'hora_fin', e.hora_fin, 'lugar', e.lugar,
                 'descripcion', e.descripcion, 'estado', e.estado)
               ORDER BY e.fecha, e.hora_inicio)
          FROM public.eventos e
         WHERE e.nino_id = p_sujeto_id), '[]'::jsonb),

      'confirmaciones_eventos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'evento', e.titulo, 'fecha_evento', e.fecha, 'estado', ce.estado,
                 'comentario', ce.comentario, 'confirmado_at', ce.confirmado_at)
               ORDER BY e.fecha)
          FROM public.confirmaciones_evento ce
          JOIN public.eventos e ON e.id = ce.evento_id
         WHERE ce.nino_id = p_sujeto_id), '[]'::jsonb),

      -- Los dirigidos a la familia sobre el niño; los del personal son trabajo del centro.
      'recordatorios', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'titulo', r.titulo, 'descripcion', r.descripcion,
                 'vencimiento', r.vencimiento, 'completado_en', r.completado_en)
               ORDER BY r.created_at)
          FROM public.recordatorios r
         WHERE r.nino_id = p_sujeto_id AND r.destinatario = 'familia_individual'), '[]'::jsonb),

      'becas', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'tipo_beca', tb.nombre, 'importe_centimos', b.importe_centimos,
                 'fecha_desde', b.fecha_desde, 'fecha_hasta', b.fecha_hasta)
               ORDER BY b.fecha_desde)
          FROM public.becas b
          JOIN public.tipos_beca tb ON tb.id = b.tipo_beca_id
         WHERE b.nino_id = p_sujeto_id AND b.deleted_at IS NULL), '[]'::jsonb),

      'conceptos_asignados', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'concepto', cc.nombre, 'cantidad', ac.cantidad_default,
                 'importe_especial_centimos', ac.importe_override_centimos,
                 'vigencia_desde', ac.vigencia_desde, 'vigencia_hasta', ac.vigencia_hasta)
               ORDER BY ac.created_at)
          FROM public.asignacion_concepto ac
          JOIN public.conceptos_cobro cc ON cc.id = ac.concepto_id
         WHERE ac.nino_id = p_sujeto_id AND ac.deleted_at IS NULL), '[]'::jsonb),

      'lineas_recibo', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'anio', r.anio, 'mes', r.mes, 'descripcion', lr.descripcion,
                 'cantidad', lr.cantidad, 'importe_centimos', lr.importe_centimos)
               ORDER BY r.anio, r.mes, lr.created_at)
          FROM public.lineas_recibo lr
          JOIN public.recibos r ON r.id = lr.recibo_id
         WHERE lr.nino_id = p_sujeto_id AND r.deleted_at IS NULL), '[]'::jsonb),

      'servicios_diarios', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'fecha', ps.fecha, 'servicio', ps.servicio, 'presente', ps.presente)
               ORDER BY ps.fecha, ps.servicio)
          FROM public.parte_servicio_diario ps
         WHERE ps.nino_id = p_sujeto_id), '[]'::jsonb),

      'beca_comedor_elegibilidad', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'curso', ca.nombre, 'fecha_alta', be.fecha_alta,
                 'fecha_baja', be.fecha_baja, 'activa', be.activa)
               ORDER BY be.fecha_alta)
          FROM public.beca_comedor_elegibilidad be
          JOIN public.cursos_academicos ca ON ca.id = be.curso_academico_id
         WHERE be.nino_id = p_sujeto_id), '[]'::jsonb),

      'beca_comedor_tramos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'anio_correspondiente', bt.anio_correspondiente,
                 'mes_correspondiente', bt.mes_correspondiente,
                 'anio_aplicacion', bt.anio_aplicacion, 'mes_aplicacion', bt.mes_aplicacion,
                 'importe_centimos', bt.importe_centimos, 'estado', bt.estado,
                 'origen', bt.origen)
               ORDER BY bt.anio_correspondiente, bt.mes_correspondiente, bt.created_at)
          FROM public.beca_comedor_tramo bt
         WHERE bt.nino_id = p_sujeto_id), '[]'::jsonb)
    );
  END IF;

  RAISE EXCEPTION 'tipo de sujeto inválido: %', p_sujeto_tipo
    USING ERRCODE = 'invalid_parameter_value';
END
$function$;

-- public.olvido_pendientes(): 1 llamada
CREATE OR REPLACE FUNCTION public.olvido_pendientes()
 RETURNS TABLE(solicitud_id uuid, sujeto_tipo olvido_sujeto_tipo, sujeto_id uuid, centro_id uuid, gracia_hasta timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT s.id, s.sujeto_tipo, s.sujeto_id, s.centro_id, s.gracia_hasta
  FROM public.olvido_solicitudes s
  WHERE s.purgado_en IS NULL
    AND s.gracia_hasta <= now()
    AND ((auth.uid() IS NULL
          AND (COALESCE(auth.role(), '') = 'service_role'
               OR (session_user <> 'authenticator'
                   AND nullif(current_setting('request.jwt.claims', true), '') IS NULL
                   AND nullif(current_setting('request.jwt.claim.role', true), '') IS NULL)))
         OR privado.es_responsable(s.centro_id))
  ORDER BY s.gracia_hasta;
$function$;

-- public.purgar_sujeto_db(p_solicitud_id uuid): 1 llamada
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

  -- Grupo 1 (PR B): las filas de auditoría que escribe la purga llevan su etiqueta.
  PERFORM set_config('app.audit_actor', 'system:purgar_sujeto_db', true);

  IF s.sujeto_tipo = 'nino' THEN
    -- D-5: motivo 'purga_rgpd' → desarchivar_nino RAISE (no reincorpora un sujeto purgado).
    UPDATE public.ninos SET
      nombre           = '[borrado]',
      apellidos        = '[borrado]',
      fecha_nacimiento = DATE '1900-01-01',
      sexo             = NULL,
      nacionalidad     = NULL,
      foto_url         = NULL,
      notas_admin      = NULL,
      -- Purga RGPD del niño: el resto de columnas personales de la ficha. idioma_principal
      -- es NOT NULL: 'zz' (no es un idioma, como en idiomas_casa) en vez de inventar 'es'. El
      -- CHECK solo admite 'zz' con deleted_reason = 'purga_rgpd', que pone este mismo UPDATE.
      idioma_principal     = 'zz',
      direccion_calle      = NULL,
      direccion_numero     = NULL,
      direccion_cp         = NULL,
      direccion_ciudad     = NULL,
      libro_familia_path   = NULL,
      estado_civil_familia = NULL,
      deleted_reason   = 'purga_rgpd',
      deleted_at       = COALESCE(deleted_at, now())
    WHERE id = s.sujeto_id;

    UPDATE public.info_medica_emergencia SET
      alergias_graves     = NULL,
      notas_emergencia    = NULL,
      medicacion_habitual = NULL,
      alergias_leves      = NULL,
      medico_familia      = NULL,
      telefono_emergencia = NULL
    WHERE nino_id = s.sujeto_id;

    UPDATE public.datos_pedagogicos_nino SET
      lactancia_observaciones          = NULL,
      control_esfinteres_observaciones = NULL,
      siesta_horario_habitual          = NULL,
      siesta_observaciones             = NULL,
      alimentacion_observaciones       = CASE WHEN tipo_alimentacion = 'otra'
                                              THEN '[borrado]' ELSE NULL END,
      -- Purga RGPD del niño: el CHECK exige de 1 a 8 códigos de 2 letras; 'zz' no es un idioma.
      idiomas_casa                     = ARRAY['zz'],
      deleted_at                       = COALESCE(deleted_at, now())
    WHERE nino_id = s.sujeto_id;

    -- Purga RGPD del niño: el motivo de baja es texto libre del centro sobre el niño.
    UPDATE public.matriculas SET motivo_baja = NULL
    WHERE nino_id = s.sujeto_id AND motivo_baja IS NOT NULL;

    -- D-5: motivo 'purga_rgpd' → desarchivar_nino NUNCA revive un vínculo purgado.
    UPDATE public.vinculos_familiares SET
      descripcion_parentesco = NULL,
      deleted_reason         = 'purga_rgpd',
      deleted_at             = COALESCE(deleted_at, now())
    WHERE nino_id = s.sujeto_id;

    DELETE FROM public.media m
    WHERE EXISTS (
            SELECT 1 FROM public.media_etiquetas e
            WHERE e.media_id = m.id AND e.nino_id = s.sujeto_id)
      AND NOT EXISTS (
            SELECT 1 FROM public.media_etiquetas e2
            WHERE e2.media_id = m.id AND e2.nino_id <> s.sujeto_id);
    DELETE FROM public.media_etiquetas WHERE nino_id = s.sujeto_id;

    -- Cierre de la purga: los cambios pendientes del niño (su dirección, su libro de familia,
    -- los datos de sus tutores) se borran; el payload no entra en audit_log, solo la tabla lo
    -- guarda. Los documentos en Storage los borra antes el manifiesto de adjuntos.
    DELETE FROM public.cambios_pendientes WHERE nino_id = s.sujeto_id;

    -- Purga RGPD del niño: la copia en audit_log, con la lista de claves por tabla que
    -- comparte con purgar_esqueleto_huerfano_nino (_claves_pii_nino).
    PERFORM public._redactar_auditoria_nino(s.sujeto_id);

    -- Purga de lista_espera: el prospecto del niño se borra entero (la plaza no tiene sentido
    -- sin el niño). Su copia en audit_log se redacta por registro_id: así se alcanza también el
    -- INSERT, que nace con nino_id NULL, y el DELETE que acaba de escribir esta purga.
    WITH borrados AS (
      DELETE FROM public.lista_espera WHERE nino_id = s.sujeto_id RETURNING id
    )
    SELECT array_agg(id) INTO v_lista FROM borrados;
    UPDATE public.audit_log SET
      valores_antes   = public._redactar_jsonb(valores_antes,   public._claves_pii_nino('lista_espera')),
      valores_despues = public._redactar_jsonb(valores_despues, public._claves_pii_nino('lista_espera'))
    WHERE tabla = 'lista_espera' AND registro_id = ANY (v_lista);

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

-- public.set_datos_acreedor(p_centro_id uuid, p_identificador_acreedor text, p_bic_acreedor text, p_iban text): 1 llamada
CREATE OR REPLACE FUNCTION public.set_datos_acreedor(p_centro_id uuid, p_identificador_acreedor text, p_bic_acreedor text, p_iban text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_clave text;
  v_iban  text := btrim(coalesce(p_iban, ''));
BEGIN
  IF NOT privado.es_responsable(p_centro_id) THEN
    RAISE EXCEPTION 'No autorizado';
  END IF;

  UPDATE public.centros SET
    identificador_acreedor = nullif(btrim(coalesce(p_identificador_acreedor, '')), ''),
    bic_acreedor           = nullif(btrim(coalesce(p_bic_acreedor, '')), '')
  WHERE id = p_centro_id;

  IF v_iban <> '' THEN
    IF char_length(v_iban) < 15 OR char_length(v_iban) > 34 THEN
      RAISE EXCEPTION 'IBAN inválido';
    END IF;
    v_clave := public._get_sepa_key();
    UPDATE public.centros
      SET iban_acreedor_cifrado = pgp_sym_encrypt(v_iban, v_clave)
      WHERE id = p_centro_id;
  END IF;
END;
$function$;

-- public.solicitar_olvido_nino(p_nino_id uuid, p_inmediato boolean): 1 llamada
CREATE OR REPLACE FUNCTION public.solicitar_olvido_nino(p_nino_id uuid, p_inmediato boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_centro uuid;
  v_gracia timestamptz;
  v_id     uuid;
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
  SELECT centro_id INTO v_centro FROM public.ninos WHERE id = p_nino_id;
  IF v_centro IS NULL THEN
    RAISE EXCEPTION 'niño no encontrado: %', p_nino_id USING ERRCODE = 'no_data_found';
  END IF;
  IF auth.uid() IS NOT NULL AND NOT privado.es_responsable(v_centro) THEN
    RAISE EXCEPTION 'no autorizado a ejercer el olvido en este centro'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_gracia := CASE WHEN p_inmediato THEN now() ELSE now() + interval '30 days' END;

  -- D-5: estampa el motivo del soft-delete (respeta el CHECK). Preserva 'purga_rgpd'
  -- si el niño ya estaba purgado; en el resto de casos marca 'solicitud_olvido'.
  -- Cast EXPLÍCITO de cada rama al ENUM: un CASE de literales `unknown` resuelve a `text`
  -- y `text`→`motivo_borrado` no tiene cast implícito (42804). Ver cabecera.
  UPDATE public.ninos
     SET deleted_at = COALESCE(deleted_at, now()),
         deleted_reason = CASE WHEN deleted_reason = 'purga_rgpd'
                               THEN 'purga_rgpd'::public.motivo_borrado
                               ELSE 'solicitud_olvido'::public.motivo_borrado END
   WHERE id = p_nino_id;

  INSERT INTO public.olvido_solicitudes
    (sujeto_tipo, sujeto_id, centro_id, solicitado_por, gracia_hasta, inmediato)
  VALUES ('nino', p_nino_id, v_centro, auth.uid(), v_gracia, p_inmediato)
  ON CONFLICT (sujeto_tipo, sujeto_id, centro_id) WHERE purgado_en IS NULL
  DO UPDATE SET
    gracia_hasta = LEAST(public.olvido_solicitudes.gracia_hasta, EXCLUDED.gracia_hasta),
    inmediato    = public.olvido_solicitudes.inmediato OR EXCLUDED.inmediato
  RETURNING id INTO v_id;

  RETURN v_id;
END $function$;

-- public.solicitar_olvido_usuario(p_usuario_id uuid, p_centro_id uuid, p_inmediato boolean): 1 llamada
CREATE OR REPLACE FUNCTION public.solicitar_olvido_usuario(p_usuario_id uuid, p_centro_id uuid, p_inmediato boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_gracia timestamptz;
  v_id     uuid;
BEGIN
  IF auth.uid() IS NULL
     AND NOT (COALESCE(auth.role(), '') = 'service_role'
              OR (session_user <> 'authenticator'
                  AND nullif(current_setting('request.jwt.claims', true), '') IS NULL
                  AND nullif(current_setting('request.jwt.claim.role', true), '') IS NULL)) THEN
    RAISE EXCEPTION 'no autorizado: sin sesión solo el servicio'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.usuarios WHERE id = p_usuario_id) THEN
    RAISE EXCEPTION 'usuario no encontrado: %', p_usuario_id USING ERRCODE = 'no_data_found';
  END IF;
  -- Multicentro: el centro lo dice quien pide (la directora, desde su centro activo), no se
  -- deduce del rol más antiguo. Un centro inexistente se rechaza antes de mirar quién pide.
  IF NOT EXISTS (SELECT 1 FROM public.centros WHERE id = p_centro_id) THEN
    RAISE EXCEPTION 'centro no encontrado: %', p_centro_id USING ERRCODE = 'no_data_found';
  END IF;
  IF auth.uid() IS NOT NULL AND NOT privado.es_responsable(p_centro_id) THEN
    RAISE EXCEPTION 'no autorizado a ejercer el olvido en este centro'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- El usuario está o estuvo en el centro: un rol (vivo o retirado) o un perfil de tutor.
  IF NOT EXISTS (SELECT 1 FROM public.roles_usuario
                  WHERE usuario_id = p_usuario_id AND centro_id = p_centro_id)
     AND NOT EXISTS (SELECT 1 FROM public.familia_tutores
                      WHERE usuario_id = p_usuario_id AND centro_id = p_centro_id) THEN
    RAISE EXCEPTION 'el usuario no está en este centro' USING ERRCODE = 'no_data_found';
  END IF;

  v_gracia := CASE WHEN p_inmediato THEN now() ELSE now() + interval '30 days' END;

  -- Se retiran sus roles en ESTE centro. La purga los pasa después a 'purga_rgpd'.
  UPDATE public.roles_usuario
     SET deleted_at = now(), deleted_reason = 'solicitud_olvido'
   WHERE usuario_id = p_usuario_id AND centro_id = p_centro_id AND deleted_at IS NULL;

  -- La cuenta se bloquea solo si no le queda ningún otro centro.
  IF NOT EXISTS (SELECT 1 FROM public.roles_usuario
                  WHERE usuario_id = p_usuario_id AND deleted_at IS NULL
                    AND centro_id <> p_centro_id) THEN
    UPDATE public.usuarios SET deleted_at = COALESCE(deleted_at, now()) WHERE id = p_usuario_id;
  END IF;

  INSERT INTO public.olvido_solicitudes
    (sujeto_tipo, sujeto_id, centro_id, solicitado_por, gracia_hasta, inmediato)
  VALUES ('usuario', p_usuario_id, p_centro_id, auth.uid(), v_gracia, p_inmediato)
  ON CONFLICT (sujeto_tipo, sujeto_id, centro_id) WHERE purgado_en IS NULL
  DO UPDATE SET
    gracia_hasta = LEAST(public.olvido_solicitudes.gracia_hasta, EXCLUDED.gracia_hasta),
    inmediato    = public.olvido_solicitudes.inmediato OR EXCLUDED.inmediato
  RETURNING id INTO v_id;

  RETURN v_id;
END $function$;

-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_esperados jsonb := '{
    "public.cerrar_curso(p_curso_destino_id uuid)": "79113e303a81b057703eb085616781f1",
    "public.export_datos_sujeto(p_sujeto_tipo text, p_sujeto_id uuid)": "85dad02f189ac803f0ec3ee62d30fc93",
    "public.olvido_pendientes()": "1cc1766abade58760c1e31cb27286d4b",
    "public.purgar_sujeto_db(p_solicitud_id uuid)": "aa27de309e12342106bd5551ef3cf166",
    "public.set_datos_acreedor(p_centro_id uuid, p_identificador_acreedor text, p_bic_acreedor text, p_iban text)": "3b84120b469ad62120fb43a7bd98f2c2",
    "public.solicitar_olvido_nino(p_nino_id uuid, p_inmediato boolean)": "65d0ed9dc1236a4b06d48d8bb43d3911",
    "public.solicitar_olvido_usuario(p_usuario_id uuid, p_centro_id uuid, p_inmediato boolean)": "fdaefbed5a28a92e491656713236915d"
  }'::jsonb;
  v_k text;
  v_md5 text;
  v_n int;
  v_con text[];
  v_md5_pol text;
BEGIN
  -- La función: su cuerpo, sus permisos y sus atributos.
  SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
    INTO v_md5 FROM pg_proc p WHERE p.oid = 'privado.es_responsable(uuid)'::regprocedure
       AND p.prosecdef AND p.provolatile = 's' AND p.proconfig = ARRAY['search_path=public'];
  IF v_md5 IS DISTINCT FROM 'dc038a356022c35f8ca840ff5a2b2344' THEN
    RAISE EXCEPTION 'es_responsable no es la esperada (md5 %)', v_md5;
  END IF;
  IF has_function_privilege('anon', 'privado.es_responsable(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'privado.es_responsable(uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'privado.es_responsable(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'es_responsable: permisos inesperados';
  END IF;

  -- Las 7 funciones, ya sin es_admin.
  FOR v_k IN SELECT jsonb_object_keys(v_esperados) LOOP
    SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
      INTO v_md5
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' = v_k;
    IF v_md5 IS DISTINCT FROM v_esperados ->> v_k THEN
      RAISE EXCEPTION 'el cuerpo de % no es el esperado (md5 %)', v_k, v_md5;
    END IF;
  END LOOP;

  -- Qué policies usan es_responsable, en TODA la base: exactamente estas 28.
  SELECT array_agg(nombre ORDER BY nombre COLLATE "C"), count(*)
    INTO v_con, v_n
    FROM (SELECT schemaname || '.' || tablename || '.' || policyname AS nombre
            FROM pg_policies
           WHERE coalesce(qual, '') || coalesce(with_check, '') LIKE '%es_responsable(%') p;
  IF v_con IS DISTINCT FROM ARRAY[
       'public.audit_log.audit_admin_select',
       'public.autorizaciones.autorizaciones_insert',
       'public.autorizaciones.autorizaciones_update',
       'public.centros.centros_responsable_delete',
       'public.centros.centros_responsable_insert',
       'public.centros.centros_responsable_update',
       'public.conceptos_cobro.conceptos_cobro_insert',
       'public.conceptos_cobro.conceptos_cobro_update',
       'public.cursos_academicos.cursos_admin_delete',
       'public.cursos_academicos.cursos_admin_insert',
       'public.cursos_academicos.cursos_admin_update',
       'public.export_log.export_log_admin_select',
       'public.invitaciones.invitaciones_admin_delete',
       'public.invitaciones.invitaciones_admin_insert',
       'public.invitaciones.invitaciones_admin_update',
       'public.olvido_solicitudes.olvido_solicitudes_admin_select',
       'public.retencion_ejecuciones.retencion_ejecuciones_admin_select',
       'public.roles_usuario.roles_admin_delete',
       'public.roles_usuario.roles_admin_insert',
       'public.roles_usuario.roles_admin_update',
       'public.tarifa_concepto_anio.tarifa_concepto_anio_delete',
       'public.tarifa_concepto_anio.tarifa_concepto_anio_insert',
       'public.tarifa_concepto_anio.tarifa_concepto_anio_update',
       'public.tipos_beca.tipos_beca_insert',
       'public.tipos_beca.tipos_beca_update',
       'storage.objects.centro_assets_delete',
       'storage.objects.centro_assets_insert',
       'storage.objects.centro_assets_update'
     ] THEN
    RAISE EXCEPTION 'policies con es_responsable inesperadas (%): %', v_n, v_con;
  END IF;

  -- Y el resto de las tablas tocadas: 40 policies, con su md5 impreso.
  SELECT md5(string_agg(md5(schemaname || '.' || tablename || '.' || policyname || '|' || cmd || '|'
                            || permissive || '|' || roles::text || '|' || coalesce(qual, '') || '|'
                            || coalesce(with_check, '')), ',' ORDER BY schemaname, tablename, policyname)),
         count(*)
    INTO v_md5_pol, v_n
    FROM pg_policies
   WHERE (schemaname = 'public'
          AND tablename IN ('audit_log', 'autorizaciones', 'centros', 'conceptos_cobro',
                            'cursos_academicos', 'export_log', 'invitaciones', 'olvido_solicitudes',
                            'retencion_ejecuciones', 'roles_usuario', 'tarifa_concepto_anio', 'tipos_beca'))
      OR (schemaname = 'storage' AND tablename = 'objects' AND policyname LIKE 'centro_assets_%');
  IF v_n <> 40 THEN
    RAISE EXCEPTION 'se esperaban 40 policies en las tablas tocadas, hay %', v_n;
  END IF;

  RAISE NOTICE 'guarda posterior: es_responsable creada, 28 policies y 7 funciones la usan, 40 policies en las tablas tocadas (md5 %)', v_md5_pol;
END
$guarda$;
