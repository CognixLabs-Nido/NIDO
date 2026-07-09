-- =============================================================================
-- F-2b-3a — RLS de LECTURA/ESCRITURA del TUTOR sobre familia_tutores
-- =============================================================================
-- familia_tutores es hoy admin-only (F-2a). Las escrituras del perfil del tutor
-- (wizard W1, DNI W2 — F-2b-3b/c) las hace el propio TUTOR, y el tutor de una
-- familia puede rellenar la fila del SEGUNDO tutor de SU familia (aún sin cuenta,
-- usuario_id NULL). El perfil es COMPARTIDO por la familia (no por niño).
--
-- ADITIVA / ENDURECEDORA:
--   * +3 policies del tutor (select/insert/update) — PERMISIVAS → OR con las de
--     F-2a, que NO se tocan (admin sigue igual);
--   * +índice único parcial que CAPA a máx. 2 tutores activos por familia
--     (≤1 titular + ≤1 segundo_tutor), declarativo y sin carrera;
--   * AMPLÍA el trigger de congelado de F-2a (CREATE OR REPLACE del cuerpo, MISMO
--     trigger, SIN DROP) para cubrir familia_id y rol_familia además de usuario_id.
-- No relaja ninguna policy ni borra datos. El congelado solo se hace MÁS estricto.
--
-- CAP POR ÍNDICE (no por trigger) — decisión de robustez:
--   rol_familia tiene CHECK IN ('titular','segundo_tutor') → un UNIQUE parcial
--   sobre (familia_id, rol_familia) WHERE deleted_at IS NULL garantiza ≤1 de cada
--   = máx. 2 tutores ACTIVOS por familia. Ventajas sobre un trigger count(*):
--     - sin dependencia de current_user (un trigger SECURITY DEFINER-owner=postgres
--       NO ve 'service_role'; la exención por rol sería frágil) → aplica UNIFORME a
--       todos (service_role, RPC, admin, tutor), que es lo correcto: nadie debe
--       crear un 2.º titular ni un 3.er tutor;
--     - sin carrera: el índice se valida atómico en commit (INSERT concurrente
--       pierde con 23505), sin pg_advisory_xact_lock ni ventana TOCTOU;
--     - invariante MÁS fuerte: prohíbe también 2 titulares (que un count(*)>=2
--       toleraría).
--   Compatible con crear_o_anadir_a_familia (F-2b-1): solo inserta 'titular' en
--   familia NUEVA (0 filas); en 'nino_anadido' no inserta fila de tutor.
--
-- Modelo de amenaza (un adulto escribe la fila de otro adulto de su familia):
--   - el tutor NUNCA escribe usuario_id: INSERT exige NULL; UPDATE lo bloquea el
--     trigger de congelado (current_user<>'service_role') → el enlace de cuenta
--     lo fija SOLO el backfill de accept-invitation (service_role, PostgREST);
--   - el tutor no se mueve de familia (WITH CHECK sobre NEW.familia_id + índice
--     "un adulto = una familia") ni se reetiqueta (rol_familia congelado);
--   - el índice único impide un 3.er tutor.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. SELECT del tutor — necesaria para las lecturas del wizard (F-2b-3e). Se
--    co-ubica aquí para no dejar "escritura sin lectura" (estado a medias).
--    MVCC-safe: es_tutor_de_familia mira la fila del USUARIO ACTUAL (ya commit),
--    NO la fila devuelta por INSERT…RETURNING → sin gotcha, sin helper row-aware.
-- -----------------------------------------------------------------------------
CREATE POLICY familia_tutores_select_tutor ON public.familia_tutores
  FOR SELECT TO authenticated
  USING (public.es_tutor_de_familia(familia_id));

-- -----------------------------------------------------------------------------
-- 2. INSERT del tutor — SOLO la fila del 2.º tutor pendiente de SU familia.
--    usuario_id IS NULL: un tutor jamás inserta una fila que apunte a una cuenta
--    (bloqueo del secuestro del enlace). rol_familia='segundo_tutor': el titular
--    lo crea la RPC de alta, no el tutor. El índice único (§4) garantiza que solo
--    haya un 'segundo_tutor' activo por familia.
-- -----------------------------------------------------------------------------
CREATE POLICY familia_tutores_insert_tutor ON public.familia_tutores
  FOR INSERT TO authenticated
  WITH CHECK (
    public.es_tutor_de_familia(familia_id)
    AND usuario_id IS NULL
    AND rol_familia = 'segundo_tutor'
  );

-- -----------------------------------------------------------------------------
-- 3. UPDATE del tutor — su propia fila y la del 2.º tutor de su familia.
--    deleted_at IS NULL en USING+WITH CHECK: solo filas ACTIVAS y NO puede
--    archivar/desarchivar (el soft-delete es admin, F-2a). El congelado de
--    usuario_id/familia_id/rol_familia lo garantiza el trigger de §5 (capa
--    independiente): aunque la policy permita el UPDATE de OTRAS columnas
--    (email/nombre/dirección/dni), el trigger RAISE si toca los 3 críticos.
-- -----------------------------------------------------------------------------
CREATE POLICY familia_tutores_update_tutor ON public.familia_tutores
  FOR UPDATE TO authenticated
  USING (public.es_tutor_de_familia(familia_id) AND deleted_at IS NULL)
  WITH CHECK (public.es_tutor_de_familia(familia_id) AND deleted_at IS NULL);

-- -----------------------------------------------------------------------------
-- 4. CAP declarativo: máx. 2 tutores ACTIVOS por familia (≤1 titular +
--    ≤1 segundo_tutor). WHERE deleted_at IS NULL → las filas archivadas no
--    cuentan (archivar y re-añadir sigue funcionando). Sustituye a un trigger
--    count(*)+advisory-lock: sin carrera, sin dependencia de current_user, y
--    prohíbe además el estado inválido de "dos titulares".
-- -----------------------------------------------------------------------------
CREATE UNIQUE INDEX ux_familia_tutores_familia_rol
  ON public.familia_tutores (familia_id, rol_familia)
  WHERE deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- 5. Congelado AMPLIADO — extiende el de F-2a EN SU SITIO (CREATE OR REPLACE del
--    cuerpo; el trigger `familia_tutores_proteger_usuario_id` ya apunta a esta
--    función → no se recrea, no se duplica, no hay DROP). Ahora congela
--    usuario_id + familia_id + rol_familia salvo service_role.
--    NOTA ADMIN: el admin (authenticated) TAMPOCO cambia estos 3 por app; hoy
--    ningún flujo lo hace → sin regresión. Reasignaciones futuras → service_role.
--    NOTA F-2b-4: la exención es 'service_role' (PostgREST service-key). Un futuro
--    backfill usuario_id NULL→real DEBE ir por el cliente service_role (como
--    accept-invitation), NO por una RPC SECURITY DEFINER (owner=postgres, que este
--    trigger vería como NO exento y bloquearía).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.familia_tutores_proteger_usuario_id()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF current_user <> 'service_role' AND (
       NEW.usuario_id  IS DISTINCT FROM OLD.usuario_id
    OR NEW.familia_id  IS DISTINCT FROM OLD.familia_id
    OR NEW.rol_familia IS DISTINCT FROM OLD.rol_familia
  ) THEN
    RAISE EXCEPTION
      'familia_tutores: usuario_id/familia_id/rol_familia no son editables por este rol; (des)vinculacion y reasignacion van por service_role (F-2b)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.familia_tutores_proteger_usuario_id() IS
  'F-2b-3a: congela usuario_id + familia_id + rol_familia en UPDATE salvo service_role. Nombre conservado de F-2a por continuidad del trigger; alcance ampliado a 3 columnas.';

COMMIT;
