-- -----------------------------------------------------------------------------
-- Fase 5.5 — Push notifications: tabla push_subscriptions + RLS
-- -----------------------------------------------------------------------------
-- Ver docs/specs/push-notifications.md y ADR-0027.
--
-- Diseño:
--  - Una fila por (usuario, endpoint del navegador). UNIQUE evita duplicados
--    cuando el cliente reintenta la suscripción.
--  - RLS de aislamiento estricto: solo el propio usuario lee/inserta/actualiza/
--    borra sus suscripciones (`usuario_id = auth.uid()`).
--  - El helper server-side `enviarPushANotificarUsuarios` lee con service_role,
--    no via RLS (lectura cross-user inevitable: el autor del mensaje no es el
--    destinatario).
--  - No se audita (telemetría operativa, no contenido). Si en futuro hace
--    falta auditar entregas, se hará en una tabla `notificaciones_push`
--    separada con su propio trigger.
--  - No se publica en Realtime.
-- -----------------------------------------------------------------------------

-- 1. Tabla -----------------------------------------------------------------
CREATE TABLE public.push_subscriptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id      uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  endpoint        text NOT NULL,
  p256dh          text NOT NULL,
  auth            text NOT NULL,
  user_agent      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  last_active_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (usuario_id, endpoint),
  CHECK (length(endpoint) BETWEEN 1 AND 2048),
  CHECK (length(p256dh)   BETWEEN 1 AND 256),
  CHECK (length(auth)     BETWEEN 1 AND 64),
  CHECK (user_agent IS NULL OR length(user_agent) <= 512)
);

-- Índice para el lookup desde el helper de envío (por usuario_id IN (...)).
CREATE INDEX idx_push_subscriptions_usuario
  ON public.push_subscriptions(usuario_id);

-- 2. Trigger de updated_at -------------------------------------------------
-- Reutiliza public.set_updated_at() definido en Fase 1 (auth.sql).
CREATE TRIGGER push_subscriptions_set_updated_at
  BEFORE UPDATE ON public.push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. RLS -------------------------------------------------------------------
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- SELECT: solo el propio usuario ve sus suscripciones.
CREATE POLICY push_subscriptions_select_self ON public.push_subscriptions
  FOR SELECT
  USING (usuario_id = auth.uid());

-- INSERT: el propio usuario, anti-suplantación vía WITH CHECK.
CREATE POLICY push_subscriptions_insert_self ON public.push_subscriptions
  FOR INSERT
  WITH CHECK (usuario_id = auth.uid());

-- UPDATE: el propio usuario (útil para refrescar last_active_at o p256dh/auth).
CREATE POLICY push_subscriptions_update_self ON public.push_subscriptions
  FOR UPDATE
  USING (usuario_id = auth.uid())
  WITH CHECK (usuario_id = auth.uid());

-- DELETE: el propio usuario (desuscripción manual desde el cliente).
CREATE POLICY push_subscriptions_delete_self ON public.push_subscriptions
  FOR DELETE
  USING (usuario_id = auth.uid());

-- 4. Comentarios -----------------------------------------------------------
COMMENT ON TABLE  public.push_subscriptions IS
  'Suscripciones Web Push por usuario y endpoint del navegador. Ver docs/specs/push-notifications.md.';
COMMENT ON COLUMN public.push_subscriptions.endpoint IS
  'URL del endpoint asignado por el servicio push del navegador (FCM, Mozilla Push, Apple, etc.).';
COMMENT ON COLUMN public.push_subscriptions.p256dh IS
  'Clave pública del cliente (base64url) usada para el cifrado del payload (RFC 8291).';
COMMENT ON COLUMN public.push_subscriptions.auth IS
  'Secreto de autenticación del cliente (base64url, 16 bytes).';
COMMENT ON COLUMN public.push_subscriptions.user_agent IS
  'User-Agent del navegador al suscribirse. Sólo para debug/limpieza; no se considera PII estable.';
COMMENT ON COLUMN public.push_subscriptions.last_active_at IS
  'Timestamp de la última vez que se confirmó actividad (visita o envío exitoso). Reservado para limpieza futura.';
