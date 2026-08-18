-- =============================================================================
-- ALUMNOS · matriculas.activada_at — sellar cuándo una matrícula se activó DE VERDAD
--
-- PROBLEMA. El modelo no registraba en ningún sitio que una matrícula hubiese llegado a
-- estar `activa`. `activarMatricula` hace `UPDATE ... SET estado='activa'` y `archivar_nino`
-- hace `UPDATE ... SET estado='baja'` SOBRE LA MISMA FILA, viniendo indistintamente de
-- 'pendiente', 'lista' o 'activa'. Resultado: dada una matrícula en 'baja' era IMPOSIBLE
-- saber si fue un alumno de verdad que causó baja o un alta a medias que dirección archivó.
-- `fecha_alta` no sirve como sustituto: es `DEFAULT CURRENT_DATE` en el INSERT, o sea el
-- momento en que se promovió el prospecto, no el de la matriculación.
--
-- Esa laguna es la raíz de dos bugs de las pestañas de alumnos: "Niños" no podía filtrar a
-- los que nunca fueron alumnos sin cargarse el archivo de ex-alumnos.
--
-- DECISIÓN DE JOSE (B). Solución de fondo: una columna que SELLA la activación.
-- "Fue alumno alguna vez" pasa a ser `activada_at IS NOT NULL` — comprobable siempre, en la
-- lista normal y en el archivo, sin ambigüedad y sin depender de `audit_log`.
--
-- POR QUÉ UN TRIGGER Y NO SOLO EL SERVER ACTION. `activarMatricula` NO es el único camino
-- que produce una matrícula activa: `desarchivar_nino` (y su versión blindada en D-5-2)
-- INSERTA directamente con `estado='activa'`, y hay 5 sitios en SQL que insertan matrículas.
-- Sellar solo desde TypeScript dejaría agujeros justo en los caminos que crean ex-alumnos.
-- El trigger sella en la raíz: cubre INSERT y UPDATE, venga de donde venga.
--
-- IDEMPOTENTE: solo sella si `activada_at` es NULL. Una re-activación (baja → activa, o
-- desarchivar) NO pisa el sello original: lo que interesa es la PRIMERA vez que fue alumno.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. La columna
-- -----------------------------------------------------------------------------
ALTER TABLE public.matriculas
  ADD COLUMN IF NOT EXISTS activada_at timestamptz NULL;

COMMENT ON COLUMN public.matriculas.activada_at IS
  'Instante en que esta matrícula pasó a activa por PRIMERA vez. NULL = nunca llegó a activarse (alta a medias). Lo sella el trigger matriculas_sellar_activada_at; no se escribe a mano. Sobrevive a la baja: es la prueba de "fue alumno alguna vez".';

-- Las tres lecturas de alumnos preguntan "¿este niño tiene alguna matrícula sellada?".
-- Índice parcial: solo las selladas, que son las únicas que se buscan.
CREATE INDEX IF NOT EXISTS idx_matriculas_activadas
  ON public.matriculas (nino_id)
  WHERE activada_at IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 2. El trigger que sella
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.matriculas_sellar_activada_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Solo al ENTRAR en 'activa', y solo si no había sello. En UPDATE se exige que el estado
  -- anterior no fuera ya 'activa' para no re-sellar en cada UPDATE de una activa (cambio de
  -- aula, etc.); la guarda `IS NULL` lo cubriría igual, pero así la intención queda explícita.
  IF NEW.estado = 'activa'
     AND NEW.activada_at IS NULL
     AND (TG_OP = 'INSERT' OR OLD.estado IS DISTINCT FROM 'activa')
  THEN
    NEW.activada_at := now();
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.matriculas_sellar_activada_at() IS
  'Sella matriculas.activada_at la primera vez que la matrícula entra en estado activa. Cubre TODOS los caminos (activarMatricula, desarchivar_nino, crear_o_anadir_a_familia...), no solo el server action.';

DROP TRIGGER IF EXISTS matriculas_sellar_activada_at_trg ON public.matriculas;
CREATE TRIGGER matriculas_sellar_activada_at_trg
  BEFORE INSERT OR UPDATE ON public.matriculas
  FOR EACH ROW
  EXECUTE FUNCTION public.matriculas_sellar_activada_at();

-- -----------------------------------------------------------------------------
-- 3. BACKFILL
--
-- (a) Fuente PRECISA: `audit_log`. `matriculas` está auditada, así que cada transición a
--     'activa' dejó una fila con `valores_despues->>'estado' = 'activa'`. El MIN de su `ts`
--     es el instante REAL de la primera activación — mejor dato que `fecha_alta`.
--
--     Rendimiento: `audit_log` son 466 MB / 615k filas y NO tiene índice por `registro_id`
--     (sí `idx_audit_tabla_ts (tabla, ts)`). Por eso esto es UNA pasada agregada filtrando
--     por `tabla`, y NO una subconsulta correlacionada por matrícula: esa segunda forma se
--     comprobó que tarda minutos.
--
-- (b) Red de seguridad: una matrícula que HOY está 'activa' fue activada por definición.
--     Si `audit_log` no la cubriese (purga RGPD, fila anterior al trigger de auditoría),
--     se sella con `fecha_alta` — es una cota inferior honesta, nunca inventa una fecha
--     posterior a la real.
--
-- (c) Lo que NO se sella: las que nunca llegaron a 'activa' quedan en NULL, que es
--     exactamente lo que significan. NO se sella ninguna 'baja' a ciegas.
--
--     Comprobado contra el remoto ANTES de escribir esto: en toda la base de datos hay
--     4 matrículas — 3 'activa' y 1 'pendiente', CERO en 'baja'. Es decir, el caso ambiguo
--     ("una baja que no se sabe si pasó por activa") no existe hoy en producción, y las
--     3 activas tienen las tres su transición registrada en `audit_log`. El backfill es
--     determinista: no hay una sola fila que haya que adivinar.
-- -----------------------------------------------------------------------------
WITH activaciones AS (
  SELECT a.registro_id AS matricula_id, min(a.ts) AS activada_at
    FROM public.audit_log a
   WHERE a.tabla = 'matriculas'
     AND a.valores_despues->>'estado' = 'activa'
   GROUP BY a.registro_id
)
UPDATE public.matriculas m
   SET activada_at = act.activada_at
  FROM activaciones act
 WHERE act.matricula_id = m.id
   AND m.activada_at IS NULL;

UPDATE public.matriculas
   SET activada_at = fecha_alta::timestamptz
 WHERE estado = 'activa'
   AND activada_at IS NULL;

COMMIT;
