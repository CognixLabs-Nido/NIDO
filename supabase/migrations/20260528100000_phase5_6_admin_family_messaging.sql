-- =============================================================================
-- Fase 5.6 — Conversación admin ↔ familia
-- =============================================================================
-- Extiende el modelo de mensajería F5 con un canal directo y temporal entre un
-- admin concreto y un tutor concreto. Modelo:
--   - 1 hilo por par (admin, tutor) — independiente del niño.
--   - Caducidad 3 días reseteable con cada mensaje (trigger AFTER INSERT).
--   - Tras caducar: read-only para ambos. Solo el admin reabre.
--
-- Cambios:
--   - ENUM nuevo: `tipo_conversacion` (profe_familia | admin_familia).
--   - `conversaciones`: 4 columnas nuevas (tipo, tutor_id, admin_id, expires_at).
--     `nino_id` pasa a NULLABLE (lo seguía siendo a efectos prácticos para
--     profe_familia, pero ahora también es nullable para admin_familia).
--   - CHECK de coherencia que asegura invariantes por tipo.
--   - Índice único parcial para "1 hilo por (admin, tutor)" sin afectar a
--     profe_familia.
--   - 2 helpers SQL nuevos: `es_tutor_en_centro`, `conversacion_activa`.
--   - 1 helper extendido: `puede_participar_conversacion` (admin_familia).
--   - 1 trigger nuevo: `mensajes_reset_admin_familia_timer` (AFTER INSERT).
--   - 1 trigger extendido: `conversaciones_set_centro_id` (tolera nino_id NULL).
--   - RLS reescritas: `conversaciones_select`, `conversaciones_insert`,
--     `conversaciones_update_admin_familia` (nueva), `mensajes_insert`
--     (añade gating de caducidad).
--
-- MVCC: las nuevas policies de SELECT/INSERT sobre `conversaciones` no invocan
-- helpers que lean su propia tabla. Las de `mensajes` ya leen `conversaciones`
-- (tabla distinta) → sin riesgo de RETURNING-fallback. Patrón F5 preservado.
--
-- Spec:  docs/specs/phase-5-6-admin-family-messaging.md
-- ADRs:  pendientes (Checkpoint C): 0029/0030/0031.
-- Notas: el botón "marcar como erróneo" con ventana de 5 min (F5.6-B) y el
--        scroll WhatsApp (F5.6-C) viven fuera de esta migración — se atacan
--        en el Checkpoint C (server actions, UI). Sí entra aquí la barrera
--        RLS por edad del mensaje cuando se decida la implementación de B
--        en C; se posterga deliberadamente para mantener este Checkpoint B
--        centrado en F5.6-A.
-- =============================================================================

BEGIN;

-- ─── 1. ENUM `tipo_conversacion` ──────────────────────────────────────────
CREATE TYPE public.tipo_conversacion AS ENUM ('profe_familia', 'admin_familia');

-- ─── 2. ALTER `conversaciones` ────────────────────────────────────────────
-- Añade columnas nuevas. `tipo_conversacion` NOT NULL con DEFAULT
-- 'profe_familia' rellena automáticamente los rows existentes de F5.
-- `nino_id` pasa a NULLABLE para acoger admin_familia.
ALTER TABLE public.conversaciones
  ADD COLUMN tipo_conversacion public.tipo_conversacion NOT NULL DEFAULT 'profe_familia',
  ADD COLUMN tutor_id          uuid NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  ADD COLUMN admin_id          uuid NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  ADD COLUMN expires_at        timestamptz NULL;

ALTER TABLE public.conversaciones
  ALTER COLUMN nino_id DROP NOT NULL;

-- CHECK de coherencia: cada tipo exige y prohíbe el conjunto correcto de
-- columnas opcionales. profe_familia mantiene la semántica F5 exacta.
ALTER TABLE public.conversaciones
  ADD CONSTRAINT conversaciones_tipo_coherencia CHECK (
    (tipo_conversacion = 'profe_familia'
      AND nino_id  IS NOT NULL
      AND tutor_id IS NULL
      AND admin_id IS NULL
      AND expires_at IS NULL)
    OR
    (tipo_conversacion = 'admin_familia'
      AND nino_id  IS NULL
      AND tutor_id IS NOT NULL
      AND admin_id IS NOT NULL
      AND expires_at IS NOT NULL)
  );

-- Índice único parcial: 1 hilo por (admin, tutor) solo en admin_familia.
-- No afecta a profe_familia (donde admin_id/tutor_id son NULL). Soporta el
-- patrón UPSERT del server action `abrirConversacionAdminFamilia` para
-- reapertura sin riesgo de duplicados.
CREATE UNIQUE INDEX idx_conv_admin_familia_unique
  ON public.conversaciones (admin_id, tutor_id)
  WHERE tipo_conversacion = 'admin_familia';

-- Índice de soporte para el listado del tutor: "mis conversaciones admin↔familia
-- ordenadas por última actividad".
CREATE INDEX conversaciones_tutor_last_msg_idx
  ON public.conversaciones (tutor_id, last_message_at DESC NULLS LAST)
  WHERE tipo_conversacion = 'admin_familia';

-- ─── 3. Helpers SQL ───────────────────────────────────────────────────────

-- 3.1 es_tutor_en_centro(p_tutor_id, p_centro_id)
-- TRUE si el usuario `p_tutor_id` tiene al menos un vínculo activo
-- (tutor_legal o autorizado) sobre un niño no borrado del centro
-- `p_centro_id`. Usado por la policy INSERT de conversaciones admin_familia
-- para validar que el tutor pertenece al centro del admin.
CREATE OR REPLACE FUNCTION public.es_tutor_en_centro(p_tutor_id uuid, p_centro_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.vinculos_familiares vf
    JOIN public.ninos n ON n.id = vf.nino_id
    WHERE vf.usuario_id = p_tutor_id
      AND vf.deleted_at IS NULL
      AND n.deleted_at IS NULL
      AND n.centro_id = p_centro_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.es_tutor_en_centro(uuid, uuid) TO authenticated;

-- 3.2 conversacion_activa(p_conv_id)
-- TRUE si la conversación admite escritura nueva. Para profe_familia, siempre.
-- Para admin_familia, solo si expires_at > now(). Lee `conversaciones`
-- (tabla distinta a `mensajes`) → seguro frente al gotcha MVCC del INSERT
-- en mensajes.
CREATE OR REPLACE FUNCTION public.conversacion_activa(p_conv_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversaciones c
    WHERE c.id = p_conv_id
      AND (
        c.tipo_conversacion = 'profe_familia'
        OR (c.tipo_conversacion = 'admin_familia' AND c.expires_at > now())
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.conversacion_activa(uuid) TO authenticated;

-- 3.3 puede_participar_conversacion(p_conv_id) — EXTENDIDO
-- Divide la lógica por tipo:
--   - profe_familia: lógica F5 sin cambios (admin del centro / profe del niño
--     / tutor con permiso). Ningún cambio funcional para F5.
--   - admin_familia: solo el `admin_id` y el `tutor_id` concretos. Otros
--     admins del mismo centro NO ven el hilo (privacidad per-par).
CREATE OR REPLACE FUNCTION public.puede_participar_conversacion(p_conversacion_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversaciones c
    WHERE c.id = p_conversacion_id
      AND (
        (c.tipo_conversacion = 'profe_familia' AND (
          public.es_admin(c.centro_id)
          OR public.es_profe_de_nino(c.nino_id)
          OR public.tiene_permiso_sobre(c.nino_id, 'puede_recibir_mensajes')
        ))
        OR
        (c.tipo_conversacion = 'admin_familia' AND (
          c.admin_id = auth.uid()
          OR c.tutor_id = auth.uid()
        ))
      )
  );
$$;

-- (GRANT preservado del F5; CREATE OR REPLACE no lo borra.)

-- ─── 4. Trigger extendido: conversaciones_set_centro_id ───────────────────
-- F5 derivaba `centro_id` desde `nino_id` cuando faltaba. Para admin_familia
-- (nino_id NULL) la derivación no aplica; el server action debe proporcionar
-- centro_id explícito. Cambio: solo invocar `centro_de_nino` si nino_id no es
-- NULL. Si tras esto sigue siendo NULL, RAISE igual que F5.
CREATE OR REPLACE FUNCTION public.conversaciones_set_centro_id()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.centro_id IS NULL AND NEW.nino_id IS NOT NULL THEN
    NEW.centro_id := public.centro_de_nino(NEW.nino_id);
  END IF;
  IF NEW.centro_id IS NULL THEN
    RAISE EXCEPTION 'conversaciones: no se pudo derivar centro_id (tipo=% nino_id=% admin_id=% tutor_id=%)',
      NEW.tipo_conversacion, NEW.nino_id, NEW.admin_id, NEW.tutor_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- ─── 5. Trigger nuevo: mensajes_reset_admin_familia_timer ─────────────────
-- AFTER INSERT en `mensajes`. Si la conversación destino es admin_familia,
-- refresca `expires_at = now() + 3 days`. SECURITY DEFINER bypassa la
-- ausencia de policy UPDATE en conversaciones para tutores, permitiendo
-- que el envío de un mensaje por el tutor renueve la ventana sin requerir
-- que el tutor tenga UPDATE directo sobre `conversaciones`. Filtro por
-- tipo en el WHERE: no-op para profe_familia (queda con expires_at NULL).
-- Independiente de `mensajes_touch_conversacion` (que toca last_message_at)
-- — ambos triggers UPDATEan la misma fila pero con columnas disjuntas, sin
-- conflicto de ordenación.
CREATE OR REPLACE FUNCTION public.mensajes_reset_admin_familia_timer()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.conversaciones
     SET expires_at = now() + interval '3 days'
   WHERE id = NEW.conversacion_id
     AND tipo_conversacion = 'admin_familia';
  RETURN NULL;
END;
$$;

CREATE TRIGGER mensajes_reset_admin_familia_timer_trg
  AFTER INSERT ON public.mensajes
  FOR EACH ROW EXECUTE FUNCTION public.mensajes_reset_admin_familia_timer();

-- ─── 6. RLS — `conversaciones` reescritas ────────────────────────────────
-- Las policies F5 referenciaban inline `centro_id`/`nino_id`. Necesitamos
-- rama por tipo. Dropeamos y recreamos para que la lógica quede explícita.
DROP POLICY conversaciones_select ON public.conversaciones;
DROP POLICY conversaciones_insert ON public.conversaciones;

-- SELECT: visibilidad por tipo.
--   - profe_familia: lógica F5 inmutable (admin centro / profe niño / tutor con permiso).
--   - admin_familia: solo el par concreto (admin_id, tutor_id). Visible SIEMPRE,
--     incluido tras caducar (read-only post-expiry — la barrera la pone la
--     INSERT de `mensajes`).
CREATE POLICY conversaciones_select ON public.conversaciones
  FOR SELECT
  USING (
    (tipo_conversacion = 'profe_familia' AND (
      public.es_admin(centro_id)
      OR public.es_profe_de_nino(nino_id)
      OR public.tiene_permiso_sobre(nino_id, 'puede_recibir_mensajes')
    ))
    OR
    (tipo_conversacion = 'admin_familia' AND (
      admin_id = auth.uid()
      OR tutor_id = auth.uid()
    ))
  );

-- INSERT: quién puede crear el hilo.
--   - profe_familia: lógica F5 (creación lazy desde primer mensaje, cualquier participante).
--   - admin_familia: solo el admin auto-identificado, en SU centro, sobre un
--     tutor que pertenezca a ese centro. Bloquea: tutor creando, admin de
--     otro centro, admin contra un tutor sin niños en su centro.
CREATE POLICY conversaciones_insert ON public.conversaciones
  FOR INSERT
  WITH CHECK (
    (tipo_conversacion = 'profe_familia' AND (
      public.es_admin(public.centro_de_nino(nino_id))
      OR public.es_profe_de_nino(nino_id)
      OR public.tiene_permiso_sobre(nino_id, 'puede_recibir_mensajes')
    ))
    OR
    (tipo_conversacion = 'admin_familia' AND (
      admin_id = auth.uid()
      AND public.es_admin(centro_id)
      AND public.es_tutor_en_centro(tutor_id, centro_id)
    ))
  );

-- UPDATE: nuevo. Solo el admin concreto puede UPDATE rows admin_familia
-- (reapertura via UPSERT del server action `abrirConversacionAdminFamilia`,
-- que ejecuta INSERT ... ON CONFLICT DO UPDATE SET expires_at = ...). RLS no
-- inspecciona qué columnas cambian — el server action enforza que la única
-- mutación legítima es `expires_at`. profe_familia sigue con default DENY.
-- El trigger `mensajes_reset_admin_familia_timer` corre como SECURITY
-- DEFINER y bypassa esta policy (el tutor puede insertar mensajes y
-- renovar el timer aunque no esté en `auth.uid() = admin_id`).
CREATE POLICY conversaciones_update_admin_familia ON public.conversaciones
  FOR UPDATE
  USING (tipo_conversacion = 'admin_familia' AND admin_id = auth.uid())
  WITH CHECK (tipo_conversacion = 'admin_familia' AND admin_id = auth.uid());

-- ─── 7. RLS — `mensajes` reescrita (gating de caducidad) ─────────────────
-- F5: `puede_participar_conversacion(conversacion_id) AND autor_id = auth.uid()`.
-- F5.6: añade `conversacion_activa(conversacion_id)` para bloquear INSERT
-- cuando admin_familia ha caducado. profe_familia es siempre activa, así que
-- el comportamiento F5 es idéntico.
DROP POLICY mensajes_insert ON public.mensajes;

CREATE POLICY mensajes_insert ON public.mensajes
  FOR INSERT
  WITH CHECK (
    public.puede_participar_conversacion(conversacion_id)
    AND public.conversacion_activa(conversacion_id)
    AND autor_id = auth.uid()
  );

-- ─── 8. Realtime publication ──────────────────────────────────────────────
-- Los hilos admin_familia se infieren client-side desde los cambios en
-- `mensajes` igual que profe_familia. No se publica `conversaciones` en
-- Realtime (decisión F5 mantenida).

-- Fin de migración Fase 5.6 (Checkpoint B).

COMMIT;
