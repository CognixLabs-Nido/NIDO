-- ─────────────────────────────────────────────────────────────────────────────
-- F8 — Migración de las REGLAS de régimen interno legacy (#56) al modelo nuevo.
--
-- CONTEXTO. El rework de catálogo (20260607120000_phase8_rw0_catalogo.sql) dejó
-- válidas las filas LEGACY de #56: instancias de `reglas_regimen_interno` del
-- modelo viejo (una por niño, `es_plantilla=false`, `plantilla_id IS NULL`,
-- `ambito IS NULL`, `nino_id` seteado). Esta migración las **enlaza al modelo A**
-- (patrón "enviado a una audiencia"): les pone `ambito='nino'` y `plantilla_id`
-- apuntando a la plantilla publicada de "Régimen interno" del centro. Tras esto,
-- aparecen en el SEGUIMIENTO del admin y siguen el flujo estándar.
--
-- SEGURIDAD / RGPD.
--   * NO fabrica texto legal. Si un centro NO tiene aún una plantilla PUBLICADA de
--     `reglas_regimen_interno`, ese centro se SALTA con un NOTICE: el admin debe
--     crear y publicar la plantilla primero (catálogo) y re-ejecutar esta migración.
--   * NO toca `texto`/`texto_version`/`firmas` de las instancias → la integridad
--     del hash y las firmas existentes se conservan intactas.
--   * Idempotente: solo afecta filas legacy (plantilla_id NULL, ambito NULL); al
--     re-ejecutar, las ya migradas quedan fuera del WHERE.
--   * Operación sobre datos productivos → se aplica MANUALMENTE por SQL Editor tras
--     revisión (regla #11). No la ejecuta el agente.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  c            RECORD;
  v_plantilla  uuid;
  v_migradas   integer;
  v_total      integer := 0;
  v_saltados   integer := 0;
BEGIN
  FOR c IN
    SELECT DISTINCT centro_id
    FROM public.autorizaciones
    WHERE es_plantilla = false
      AND tipo = 'reglas_regimen_interno'
      AND plantilla_id IS NULL
      AND ambito IS NULL
      AND nino_id IS NOT NULL
  LOOP
    -- Plantilla publicada y definitiva de "Régimen interno" del centro (la del
    -- catálogo nuevo). Debe existir; si no, se salta el centro (no se inventa).
    SELECT id INTO v_plantilla
    FROM public.autorizaciones
    WHERE es_plantilla = true
      AND tipo = 'reglas_regimen_interno'
      AND centro_id = c.centro_id
      AND estado = 'publicada'
      AND texto_definitivo = true
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_plantilla IS NULL THEN
      v_saltados := v_saltados + 1;
      RAISE NOTICE 'Centro % SALTADO: sin plantilla publicada de reglas_regimen_interno. Crea y publica la plantilla y re-ejecuta.', c.centro_id;
      CONTINUE;
    END IF;

    UPDATE public.autorizaciones
    SET plantilla_id = v_plantilla,
        ambito       = 'nino'
    WHERE es_plantilla = false
      AND tipo = 'reglas_regimen_interno'
      AND centro_id = c.centro_id
      AND plantilla_id IS NULL
      AND ambito IS NULL
      AND nino_id IS NOT NULL;

    GET DIAGNOSTICS v_migradas = ROW_COUNT;
    v_total := v_total + v_migradas;
    RAISE NOTICE 'Centro %: % instancias de reglas migradas a plantilla %.', c.centro_id, v_migradas, v_plantilla;
  END LOOP;

  RAISE NOTICE 'Migración #56 completada: % instancias migradas, % centros saltados (sin plantilla).', v_total, v_saltados;
END $$;
