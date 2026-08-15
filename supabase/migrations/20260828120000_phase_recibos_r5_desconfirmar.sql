-- =============================================================================
-- RECIBOS · R-5 — DESCONFIRMAR un recibo (confirmado → borrador)
--
-- PROBLEMA. Hasta aquí un recibo confirmado era definitivo: `congelar_si_mes_cerrado`
-- prohibía explícitamente el retroceso ("recibo confirmado: no puede volver a borrador").
-- Si la directora detectaba un error DESPUÉS de confirmar, no tenía ninguna vía: ni editar
-- en caliente (las líneas de un no-borrador están congeladas) ni volver atrás. La única
-- salida era un esporádico de ajuste, que ensucia el mes.
--
-- DECISIÓN DE JOSE (A). Se abre una vía EXPLÍCITA: "Modificar" desconfirma el recibo
-- (confirmado → borrador), se edita con las herramientas de R-3, y se vuelve a confirmar.
-- El candado sigue existiendo; lo que cambia es que ahora tiene llave, y la llave se ve.
--
-- SALVAGUARDA (Jose). Si el recibo YA está en una REMESA CREADA, no se toca. El dinero ha
-- salido del ámbito del centro: el fichero SEPA ya se ha podido generar y llevar al banco.
--
--   ¿Cómo se detecta "está en una remesa"? Por una FILA en `recibos_remesa` cuyo `remesa_id`
--   apunte a una remesa NO borrada. No hace falta matizar "creada vs enviada vs cobrada":
--   `estado_remesa` solo tiene DOS valores, `borrador | enviada`, y ambos son "ya creada"
--   — `crearRemesa` inserta la remesa Y sus enlaces en el mismo paso, así que el enlace
--   existe desde el instante de la creación, que es justo el corte que pidió Jose. No hay
--   estado "cobrada" en la remesa (el cobro se refleja en el ESTADO DEL RECIBO). El esquema
--   ya trataba ese enlace como un candado: `recibos_remesa.recibo_id` es ON DELETE RESTRICT.
--
-- CORTE POR ESTADO DEL RECIBO. Se desconfirma SOLO desde `pendiente_procesar`, que es lo
-- que la UI llama "confirmado". Los otros tres estados no son "confirmado" sino el ciclo de
-- cobro ya avanzado:
--   · `enviado_banco` y `devuelto` solo se alcanzan A TRAVÉS de una remesa → la salvaguarda
--     de arriba ya los cubre; el corte por estado es el segundo cerrojo de la misma puerta.
--   · `cobrado_manual` SÍ es alcanzable sin remesa (efectivo/transferencia, `marcarCobradoManual`).
--     Ahí el dinero ya ha entrado, así que queda fuera: la línea de Jose habla de un recibo
--     confirmado, no de uno cobrado. Es el corte conservador; aflojarlo es una línea.
--
-- REABRIR EL MES (colateral obligatorio). `confirmar_recibo` ancla `cierre_mensual` cuando
-- deja de haber borradores regulares en el mes (decisión R8: cerrado = "mes íntegramente
-- procesado"). Desconfirmar crea un borrador → esa invariante deja de ser cierta y hay que
-- retirar el ancla, o el mes se queda marcado como cerrado con un borrador dentro y el
-- panel bloquea la edición que acabamos de habilitar. Se borra la fila de `cierre_mensual`;
-- `audit_cierre_mensual` (AFTER INSERT/UPDATE/DELETE) deja la reapertura en la auditoría, y
-- al reconfirmar el último borrador `confirmar_recibo` la vuelve a anclar.
--
-- LO QUE NO TOCA. Desconfirmar es un UPDATE de una sola columna. NO toca `lineas_recibo`
-- (las manuales de R-3 y las automáticas siguen donde estaban), NI `beca_comedor_desborde`,
-- NI `beca_comedor_transferencia`, NI `recibos_remesa`. El bloque de inmutabilidad de abajo
-- se mantiene intacto, así que el retroceso de estado no puede colar de matute un cambio de
-- total/método/familia: si el UPDATE cambia algo más que el estado, sigue abortando.
--
-- Aplicar por SQL Editor (rol postgres). NO por CLI.
-- =============================================================================
BEGIN;

-- -----------------------------------------------------------------------------
-- 1. La salvaguarda, como una sola definición.
--    La comparten el trigger (invariante de BD) y la RPC (error limpio para la UI); si
--    viviera duplicada, un día divergirían y el candado se quedaría solo en un lado.
--    SECURITY DEFINER porque el trigger corre para cualquier admin y `recibos_remesa` está
--    bajo RLS de `es_admin(centro_id)`: sin DEFINER, un admin de otro centro no vería el
--    enlace y la salvaguarda se abriría justo para quien no debe.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recibo_en_remesa(p_recibo_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.recibos_remesa rr
    JOIN public.remesas rm ON rm.id = rr.remesa_id
    WHERE rr.recibo_id = p_recibo_id
      AND rm.deleted_at IS NULL
  );
$$;

COMMENT ON FUNCTION public.recibo_en_remesa(uuid) IS
  'R-5: ¿el recibo está incluido en alguna remesa CREADA y no borrada? Salvaguarda de desconfirmar_recibo: si es true, el recibo ya no se modifica.';

GRANT EXECUTE ON FUNCTION public.recibo_en_remesa(uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- 2. Congelado por estado: se abre EXACTAMENTE una puerta.
--    Copia literal de la función vigente (F-4-4) con un único cambio: el retroceso a
--    'borrador' deja de ser un rechazo incondicional y pasa por las dos condiciones de
--    arriba. Todo lo demás —parte de servicio por mes, borrado de confirmados, líneas del
--    recibo padre, inmutabilidad de columnas— se mantiene byte a byte.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.congelar_si_mes_cerrado()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_centro uuid;
  v_anio integer;
  v_mes integer;
  r_recibo record;
BEGIN
  -- Exención de service_role (backend de confianza, NUNCA expuesto al cliente): permite la
  -- limpieza/teardown, el CASCADE de borrado de centros y las correcciones server-side. El
  -- congelado protege frente a ediciones de ADMIN (authenticated), no frente al backend. El
  -- motor (SECURITY DEFINER llamado por admin) corre con auth.role()='authenticated' → NO se
  -- exime, pero solo toca borradores. auth.role() lee el claim del JWT (nivel request), no el
  -- rol de ejecución del DEFINER, así que distingue correctamente al llamante.
  IF auth.role() = 'service_role' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_TABLE_NAME = 'parte_servicio_diario' THEN
    -- Congelado POR MES: el parte de un mes cerrado (cierre_mensual) es inmutable.
    v_centro := public.centro_de_nino(COALESCE(NEW.nino_id, OLD.nino_id));
    v_anio := EXTRACT(YEAR  FROM COALESCE(NEW.fecha, OLD.fecha))::integer;
    v_mes  := EXTRACT(MONTH FROM COALESCE(NEW.fecha, OLD.fecha))::integer;
    IF public.mes_cerrado(v_centro, v_anio, v_mes) THEN
      RAISE EXCEPTION 'mes cerrado: el parte de servicio de % no es editable',
        to_char(COALESCE(NEW.fecha, OLD.fecha), 'YYYY-MM') USING ERRCODE = 'P0001';
    END IF;

  ELSIF TG_TABLE_NAME = 'recibos' THEN
    -- Congelado POR ESTADO. Solo recibos REGULARES (esporádicos y devoluciones fuera).
    IF COALESCE(NEW.es_esporadico, OLD.es_esporadico) = false
       AND COALESCE(NEW.devuelto_de_recibo_id, OLD.devuelto_de_recibo_id) IS NULL THEN
      IF TG_OP = 'DELETE' THEN
        -- Solo se borra un borrador (regeneración). Un confirmado no se borra.
        IF OLD.estado <> 'borrador' THEN
          RAISE EXCEPTION 'recibo confirmado: % no se borra',
            to_char(make_date(OLD.anio, OLD.mes, 1), 'YYYY-MM') USING ERRCODE = 'P0001';
        END IF;
      ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.estado <> 'borrador' THEN
          -- R-5: el retroceso a borrador ("desconfirmar") deja de estar prohibido, pero solo
          -- por la puerta estrecha. Se comprueba AQUÍ, y no solo en la RPC, porque esto es
          -- una invariante del dato: ningún UPDATE directo debe poder reabrir un recibo que
          -- ya viajó al banco, venga de la RPC, de otra action o de un arreglo a mano.
          IF NEW.estado = 'borrador' THEN
            IF OLD.estado <> 'pendiente_procesar' THEN
              RAISE EXCEPTION 'recibo en el circuito de cobro (%): ya no vuelve a borrador',
                OLD.estado USING ERRCODE = 'P0001';
            END IF;
            IF public.recibo_en_remesa(OLD.id) THEN
              RAISE EXCEPTION 'recibo en remesa: no se puede modificar'
                USING ERRCODE = 'P0001';
            END IF;
          END IF;
          IF NOT (
                NEW.total_centimos        IS NOT DISTINCT FROM OLD.total_centimos
            AND NEW.metodo                IS NOT DISTINCT FROM OLD.metodo
            AND NEW.familia_id            IS NOT DISTINCT FROM OLD.familia_id
            AND NEW.nino_id               IS NOT DISTINCT FROM OLD.nino_id
            AND NEW.anio                  IS NOT DISTINCT FROM OLD.anio
            AND NEW.mes                   IS NOT DISTINCT FROM OLD.mes
            AND NEW.es_esporadico         IS NOT DISTINCT FROM OLD.es_esporadico
            AND NEW.concepto_esporadico   IS NOT DISTINCT FROM OLD.concepto_esporadico
            AND NEW.devuelto_de_recibo_id IS NOT DISTINCT FROM OLD.devuelto_de_recibo_id
          ) THEN
            RAISE EXCEPTION 'recibo confirmado: inmutable salvo estado/fecha de cobro'
              USING ERRCODE = 'P0001';
          END IF;
        END IF;
        -- OLD.estado='borrador': edición libre, incluye la transición a pendiente_procesar.
      END IF;
      -- TG_OP='INSERT': permitido (el recibo regular nace en borrador).
    END IF;

  ELSIF TG_TABLE_NAME = 'lineas_recibo' THEN
    -- Congelado POR ESTADO del recibo padre.
    SELECT estado, es_esporadico, devuelto_de_recibo_id, anio, mes
      INTO r_recibo
      FROM public.recibos WHERE id = COALESCE(NEW.recibo_id, OLD.recibo_id);
    IF FOUND
       AND r_recibo.es_esporadico = false
       AND r_recibo.devuelto_de_recibo_id IS NULL
       AND r_recibo.estado <> 'borrador' THEN
      RAISE EXCEPTION 'recibo confirmado: las líneas de % no son editables',
        to_char(make_date(r_recibo.anio, r_recibo.mes, 1), 'YYYY-MM') USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END $$;

-- -----------------------------------------------------------------------------
-- 3. desconfirmar_recibo — el espejo exacto de confirmar_recibo.
--    Mismas puertas (existe / admin / regular), misma idempotencia, y el mismo valor de
--    retorno leído al revés: confirmar devuelve "el mes ha quedado CERRADO"; desconfirmar
--    devuelve "el mes ha quedado REABIERTO".
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.desconfirmar_recibo(p_recibo_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
BEGIN
  SELECT centro_id, anio, mes, estado, es_esporadico, devuelto_de_recibo_id, deleted_at
    INTO r FROM public.recibos WHERE id = p_recibo_id;
  IF NOT FOUND OR r.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'recibo no encontrado' USING ERRCODE = '22023';
  END IF;
  IF NOT public.es_admin(r.centro_id) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
  IF r.es_esporadico OR r.devuelto_de_recibo_id IS NOT NULL THEN
    RAISE EXCEPTION 'no es un recibo regular' USING ERRCODE = '22023';
  END IF;

  -- Idempotente: ya es borrador. No se re-abre el mes (si está cerrado con un borrador
  -- dentro, el desajuste no lo ha creado esta llamada y no es asunto suyo arreglarlo).
  IF r.estado = 'borrador' THEN
    RETURN false;
  END IF;

  IF r.estado <> 'pendiente_procesar' THEN
    RAISE EXCEPTION 'recibo en el circuito de cobro (%): ya no vuelve a borrador', r.estado
      USING ERRCODE = 'P0001';
  END IF;

  IF public.recibo_en_remesa(p_recibo_id) THEN
    RAISE EXCEPTION 'recibo en remesa: no se puede modificar' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.recibos SET estado = 'borrador' WHERE id = p_recibo_id;

  -- Retirar el ancla del cierre: con este borrador dentro, el mes ya no está "íntegramente
  -- procesado". Sin esto el panel seguiría bloqueado y "Modificar" no serviría de nada.
  DELETE FROM public.cierre_mensual
    WHERE centro_id = r.centro_id AND anio = r.anio AND mes = r.mes;

  RETURN FOUND;
END $$;

COMMENT ON FUNCTION public.desconfirmar_recibo(uuid) IS
  'R-5: devuelve un recibo confirmado (pendiente_procesar) a borrador para poder corregirlo. Bloqueado si está en una remesa creada o si el cobro ya avanzó. Reabre el mes (borra cierre_mensual). Devuelve true si el mes estaba cerrado y se ha reabierto.';

REVOKE ALL ON FUNCTION public.desconfirmar_recibo(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.desconfirmar_recibo(uuid) TO authenticated;

COMMIT;
