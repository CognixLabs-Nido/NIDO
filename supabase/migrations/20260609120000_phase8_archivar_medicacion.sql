-- ─────────────────────────────────────────────────────────────────────────────
-- F8 — ARCHIVAR medicación terminada (estado COMPARTIDO del centro).
--
-- Cuando una pauta de medicación termina (hoy > fecha_fin, ya no hay que darla),
-- profe/admin la archivan para sacarla de la lista de trabajo. Archivar NO anula
-- (la pauta y sus firmas siguen siendo el registro legal): solo marca "terminada y
-- guardada". Es un estado COMPARTIDO — una vez archivada lo está para todo el centro
-- (columna en la fila, no preferencia por usuario).
--
-- Autorización: la archivan ADMIN del centro o PROFE del niño; la FAMILIA no.
-- Se hace por RPC `SECURITY DEFINER` (no por UPDATE directo) para NO ampliar la
-- policy `autorizaciones_update` (autor|admin) a la profe — eso le abriría también
-- publicar/anular/editar. El RPC autoriza y toca SOLO las columnas de archivado.
--
-- Operación sobre esquema productivo → se aplica MANUALMENTE por SQL Editor tras
-- revisión (regla #11, patrón de siempre). No la ejecuta el agente.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. Columnas de archivado (idempotente) ─────────────────────────────────
ALTER TABLE public.autorizaciones
  ADD COLUMN IF NOT EXISTS archivada_at  timestamptz,
  ADD COLUMN IF NOT EXISTS archivada_por uuid REFERENCES public.usuarios(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.autorizaciones.archivada_at IS
  'Medicación terminada y archivada (estado compartido del centro). NULL = activa. Archivar ≠ anular: la pauta y sus firmas siguen válidas como registro.';
COMMENT ON COLUMN public.autorizaciones.archivada_por IS
  'Quién archivó (admin del centro o profe del niño). NULL si no archivada.';

-- Índice parcial para listar el HISTÓRICO (archivadas) de un centro sin escanear todo.
CREATE INDEX IF NOT EXISTS idx_autorizaciones_archivadas
  ON public.autorizaciones (centro_id, archivada_at)
  WHERE archivada_at IS NOT NULL;

-- ─── 2. RPC de archivado (autoriza admin/profe; solo toca columnas de archivado) ─
CREATE OR REPLACE FUNCTION public.archivar_autorizacion(p_autorizacion_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.autorizaciones%ROWTYPE;
BEGIN
  SELECT * INTO a FROM public.autorizaciones WHERE id = p_autorizacion_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Solo medicación se archiva (es la que "termina" por fecha_fin).
  IF a.tipo <> 'medicacion' OR a.es_plantilla THEN
    RETURN false;
  END IF;

  -- Autorización: admin del centro o profe del niño. La familia NO archiva.
  IF NOT (public.es_admin(a.centro_id) OR public.es_profe_de_nino(a.nino_id)) THEN
    RETURN false;
  END IF;

  -- Idempotente: si ya estaba archivada, no la re-sella.
  IF a.archivada_at IS NOT NULL THEN
    RETURN true;
  END IF;

  UPDATE public.autorizaciones
  SET archivada_at = now(),
      archivada_por = auth.uid()
  WHERE id = p_autorizacion_id;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.archivar_autorizacion(uuid) TO authenticated;

COMMENT ON FUNCTION public.archivar_autorizacion(uuid) IS
  'Archiva una instancia de medicación (estado compartido). Autoriza admin del centro o profe del niño; la familia no. Idempotente. Devuelve false si no existe, no es medicación, o sin permiso.';
