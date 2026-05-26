-- Phase 5 hotfix: el autor de un anuncio debe poder ver QUIÉN lo ha leído.
--
-- Bug post-merge F5: el contador "X de Y" en `AnuncioView` mostraba "0 de N"
-- aunque los destinatarios hubieran marcado leído. La causa: la policy
-- `lectura_anuncio_select_self` restringe SELECT a `usuario_id = auth.uid()`.
-- El `count(*)` en `getAnuncioDetalle` para el autor solo veía sus propias
-- filas (típicamente 0), no las de los tutores que sí leyeron.
--
-- Además `lectura_anuncio` no estaba en `supabase_realtime`, así que el autor
-- no se enteraba de las lecturas nuevas sin recargar la página. Para una
-- directora publicando un anuncio crítico (cierre por nieve, emergencia
-- médica) el feedback en vivo es importante.
--
-- Esta migración:
--  1. Añade una policy adicional `lectura_anuncio_select_autor` que permite
--     al autor del anuncio leer todas las filas de `lectura_anuncio` que
--     correspondan a sus anuncios. RLS combina policies por OR, así que la
--     restricción del `select_self` previa se mantiene intacta para los
--     destinatarios (cada uno sigue viendo solo sus propias lecturas).
--  2. Publica `lectura_anuncio` en `supabase_realtime`. La RLS de SELECT se
--     aplica también a las notificaciones — el autor solo recibirá eventos
--     sobre lecturas de SUS anuncios; los destinatarios sobre las suyas.
--
-- Las policies INSERT/UPDATE/DELETE existentes NO se tocan: la lectura sigue
-- siendo un acto privado del destinatario, append-only, sin modificación.

-- ─── 1. Policy adicional: autor del anuncio lee todas sus lecturas ────────
CREATE POLICY lectura_anuncio_select_autor ON public.lectura_anuncio
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.anuncios a
      WHERE a.id = lectura_anuncio.anuncio_id
        AND a.autor_id = auth.uid()
    )
  );

-- ─── 2. Realtime publication ──────────────────────────────────────────────
-- Añadimos solo `lectura_anuncio`. `lectura_conversacion` sigue fuera: el
-- contador de no leídos del badge se recalcula desde `mensajes` (que sí
-- está publicada) en combinación con `router.refresh()` tras
-- `marcarConversacionLeida`. Publicar `lectura_conversacion` no aportaría
-- nada nuevo y sí más eventos en el wire.
ALTER PUBLICATION supabase_realtime ADD TABLE public.lectura_anuncio;
