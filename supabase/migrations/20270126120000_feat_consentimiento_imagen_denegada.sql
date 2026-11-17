-- Fase 10 · 10a-1: el «no» de la imagen tiene un tipo propio (2026-11-17). Spec:
-- docs/specs/altas-serie.md, «La imagen como respuesta: lo medido y el diseño».
--
-- Decisión del responsable del 2026-11-17, punto 2: «la base exige una RESPUESTA, no un «sí». Y sí,
-- hay que guardar el «no»» … «Guarda el «no» como respuesta de primera clase, con su fecha y quién la
-- dio, revocable y reversible como el «sí».» Hoy una familia que no quiere fotos tiene que aceptar
-- para terminar el alta (art. 7.4; D3 ya lo decía en junio).
--
-- El «no» va en `consentimientos` con su tipo, `imagen_denegada`, y no como una fila
-- `tipo = 'imagen'`: los siete lectores del «sí» (medidos en producción el 2026-11-17) leen toda fila
-- `imagen` sin revocar como un «sí», y filtran por ese tipo, así que no ven este. La maquinaria
-- genérica de la tabla (purga, retención, bloqueo tras la baja, exportación, anular el alta) trata
-- igual toda fila, y el «no» la hereda sin tocarla.
--
-- Esta migración SOLO añade el valor: Postgres no deja usarlo en la transacción que lo añade (55P04),
-- así que las funciones que lo usan van en la siguiente, 10a-2, ensayada con esta ya aplicada.
--
-- ORDEN: aplicar esta antes de mergear su PR (los tipos de la app ya llevan el valor). Sin COMMIT ni
-- BEGIN: el SQL Editor la envuelve en su transacción.

-- ─────────────────────────────────────────────────────────────── guarda previa
DO $guarda$
DECLARE
  v text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20270125130000') THEN
    RAISE EXCEPTION 'falta la 20270125130000 en el registro';
  END IF;

  SELECT string_agg(enumlabel::text, ',' ORDER BY enumsortorder) INTO v
    FROM pg_enum WHERE enumtypid = 'public.consentimiento_tipo'::regtype;
  IF v IS DISTINCT FROM 'terminos,privacidad,imagen,datos_medicos' THEN
    RAISE EXCEPTION 'consentimiento_tipo no tiene las etiquetas esperadas: %', v;
  END IF;
END
$guarda$;

-- ─────────────────────────────────────────────────────────────── el valor
ALTER TYPE public.consentimiento_tipo ADD VALUE 'imagen_denegada';

-- ─────────────────────────────────────────────────────────────── guarda posterior
DO $guarda$
DECLARE
  v text;
  f text;
BEGIN
  SELECT string_agg(enumlabel::text, ',' ORDER BY enumsortorder) INTO v
    FROM pg_enum WHERE enumtypid = 'public.consentimiento_tipo'::regtype;
  IF v IS DISTINCT FROM 'terminos,privacidad,imagen,datos_medicos,imagen_denegada' THEN
    RAISE EXCEPTION 'no quedó imagen_denegada al final de consentimiento_tipo: %', v;
  END IF;

  -- Nada más cambia: las filas por tipo, tal cual (se comparan como texto: el valor nuevo no se
  -- puede nombrar como enum hasta el COMMIT).
  SELECT string_agg(t || ' ' || n, ', ' ORDER BY t) INTO f
    FROM (SELECT tipo::text t, count(*) n FROM public.consentimientos GROUP BY 1) x;
  RAISE NOTICE 'consentimiento_tipo: %. Filas por tipo: %', v, coalesce(f, '(ninguna)');
END
$guarda$;
