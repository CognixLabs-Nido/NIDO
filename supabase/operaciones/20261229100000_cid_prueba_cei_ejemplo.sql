-- =============================================================================
-- OPERACIÓN 20261229100000 · Un CID de prueba para CEI Ejemplo
--
-- Una sola vez, en producción. NO es una migración: no cambia el esquema y no se registra en
-- supabase_migrations (convención en supabase/operaciones/README.md).
--
-- Contexto: desde 20261229120000 (0c-1) sin el identificador de acreedor (CID) del centro no se
-- firma ningún mandato SEPA. CEI Ejemplo es un CENTRO DE PRUEBAS: no tiene CID porque no cobra a
-- nadie, y sin uno no se podría probar la domiciliación. Decisión del responsable (2026-11-04):
-- «el CID es obligatorio, pero lo que tenemos ahora es un centro falso y no tiene CID, invéntate
-- algo para que funcione».
--
-- El CID: ES81ZZZB00000000. ESTE CID NO VALE PARA COBRAR NADA.
--   · Formato válido de verdad: ES + dígitos de control + ZZZ + NIF. Los dígitos de control (81)
--     son los de ISO 7064 mod 97-10 sobre «NIF + ES00» (el sufijo ZZZ no entra en el cálculo),
--     y este bloque los vuelve a calcular antes de escribir nada. Si algún día alguien valida el
--     formato, pasa.
--   · Se ve que es de prueba: el NIF es B00000000, un CIF de sociedad con el dígito de control
--     correcto y todo ceros. El formato no deja otra marca que no sea el NIF o el sufijo, y el
--     sufijo es ZZZ como se pidió.
--   · Cualquier banco rechazará un adeudo con este acreedor. Un centro real pone el suyo en
--     Cuotas → Datos bancarios, que lo sobrescribe.
--
-- Qué hace: pone identificador_acreedor en CEI Ejemplo, y solo eso. No toca el BIC ni el IBAN de
-- acreedor (siguen vacíos: la descarga de una remesa sigue diciendo que faltan), ni ningún otro
-- centro, ni ninguna otra columna.
--
-- Qué centro: el que da el md5 de su id (el repo es público), con su nombre, sin CID, y el único
-- centro de la base (diagnóstico del 2026-11-04: 1 centro, vivo, sin CID, BIC ni IBAN).
--
-- Todo es UN bloque DO: una sola sentencia, una sola transacción. Cualquier guarda que falle
-- lanza una excepción y no queda NADA hecho.
--
-- ENSAYO: anteponer `SET nido.ensayo = 'on';` al fichero. Corre todo, comprueba todas las
-- guardas y termina en RAISE EXCEPTION con lo de antes y después: no confirma nada. Sin esa línea,
-- el fichero tal cual aplica de verdad.
--
-- Orden: antes de 20261229120000. Esa migración no lo exige (en la BD del CI no hay centros),
-- pero sin él, desde que se aplique, CEI Ejemplo no puede firmar ningún mandato.
-- =============================================================================

DO $operacion$
DECLARE
  -- md5(centros.id) de CEI Ejemplo, diagnosticado el 2026-11-04.
  c_centro_md5 constant text := 'c3cd2d5bab931c1aa46b30c47bc7ad32';
  c_nombre     constant text := 'CEI Ejemplo';
  c_cid        constant text := 'ES81ZZZB00000000';
  c_actor      constant text := 'system:cid_prueba_cei_ejemplo';

  -- RECUENTOS APROBADOS (diagnóstico del 2026-11-04). Si algo da otro número, rollback total.
  e_centros    constant bigint := 1;  -- centros, todas las filas (vivos y borrados)
  e_audit      constant bigint := 1;  -- filas de audit_log de esta transacción: el UPDATE

  v_xid        xid;
  v_id         uuid;
  v_n          bigint;
  v_antes      public.centros%ROWTYPE;
  v_despues    public.centros%ROWTYPE;
  v_resto_a    text;
  v_resto_d    text;
  f            text[] := '{}';
BEGIN
  v_xid := pg_current_xact_id()::xid;
  PERFORM set_config('app.audit_actor', c_actor, true);

  -- ── El instrumento: ISO 7064 mod 97-10, con sus controles ─────────────────────────────
  -- Las letras valen A=10 … Z=35. El IBAN se comprueba con sus 4 primeros al final; el CID,
  -- igual pero saltando el sufijo (posiciones 5 a 7). Válido = resto 1.
  CREATE TEMP TABLE _mod97 ON COMMIT DROP AS
  SELECT x.que, x.valor,
         (SELECT string_agg(CASE WHEN ch ~ '[A-Z]' THEN (ascii(ch) - 55)::text ELSE ch END, ''
                            ORDER BY i)
            FROM unnest(string_to_array(x.reordenado, NULL)) WITH ORDINALITY AS u(ch, i)
         )::numeric % 97 AS resto
    FROM (VALUES
      ('iban_valido',  'ES9121000418450200051332', substr('ES9121000418450200051332', 5) || 'ES91'),
      ('iban_alterado','ES9121000418450200051333', substr('ES9121000418450200051333', 5) || 'ES91'),
      ('cid_alterado', 'ES80ZZZB00000000', substr('ES80ZZZB00000000', 8) || 'ES80'),
      ('cid',          c_cid, substr(c_cid, 8) || substr(c_cid, 1, 4))
    ) AS x(que, valor, reordenado);

  -- ── GUARDA DE ENTRADA ──────────────────────────────────────────────────────────────────
  -- El instrumento distingue: un IBAN conocido pasa y el mismo con un dígito cambiado no.
  IF (SELECT resto FROM _mod97 WHERE que = 'iban_valido') <> 1
     OR (SELECT resto FROM _mod97 WHERE que = 'iban_alterado') = 1
     OR (SELECT resto FROM _mod97 WHERE que = 'cid_alterado') = 1 THEN
    RAISE EXCEPTION 'guarda de entrada: el cálculo mod 97 no distingue un válido de uno alterado';
  END IF;
  IF (SELECT resto FROM _mod97 WHERE que = 'cid') <> 1 THEN
    RAISE EXCEPTION 'guarda de entrada: los dígitos de control de % no son válidos', c_cid;
  END IF;
  IF c_cid !~ '^ES[0-9]{2}[A-Z0-9]{3}B00000000$' OR char_length(c_cid) > 35 THEN
    RAISE EXCEPTION 'guarda de entrada: % no tiene la forma ES + dígitos + sufijo + NIF', c_cid;
  END IF;

  SELECT count(*) INTO v_n FROM public.centros;
  IF v_n <> e_centros THEN
    RAISE EXCEPTION 'guarda de entrada: esperaba % centro y hay %; no se toca nada', e_centros, v_n;
  END IF;
  SELECT id INTO v_id FROM public.centros WHERE md5(id::text) = c_centro_md5;
  IF v_id IS NULL THEN
    RAISE EXCEPTION 'guarda de entrada: no está el centro diagnosticado (md5 del id)';
  END IF;
  SELECT * INTO v_antes FROM public.centros WHERE id = v_id;
  IF v_antes.nombre IS DISTINCT FROM c_nombre OR v_antes.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'guarda de entrada: el centro no es «%» vivo (es «%»)', c_nombre, v_antes.nombre;
  END IF;
  IF v_antes.identificador_acreedor IS NOT NULL THEN
    RAISE EXCEPTION 'guarda de entrada: el centro ya tiene CID (%); no se pisa', v_antes.identificador_acreedor;
  END IF;
  RAISE NOTICE 'ANTES | centros: % | CEI Ejemplo: CID %, BIC %, IBAN de acreedor %',
    v_n, coalesce(v_antes.identificador_acreedor, 'vacío'), coalesce(v_antes.bic_acreedor, 'vacío'),
    CASE WHEN v_antes.iban_acreedor_cifrado IS NULL THEN 'vacío' ELSE 'puesto' END;
  -- Huella de la fila sin las dos columnas que cambian, para comprobar que no cambia nada más.
  SELECT md5((to_jsonb(c) - 'identificador_acreedor' - 'updated_at')::text) INTO v_resto_a
    FROM public.centros c WHERE c.id = v_id;

  -- ── LA OPERACIÓN ───────────────────────────────────────────────────────────────────────
  UPDATE public.centros SET identificador_acreedor = c_cid WHERE id = v_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  -- ── GUARDA DE RECUENTO ─────────────────────────────────────────────────────────────────
  SELECT * INTO v_despues FROM public.centros WHERE id = v_id;
  SELECT md5((to_jsonb(c) - 'identificador_acreedor' - 'updated_at')::text) INTO v_resto_d
    FROM public.centros c WHERE c.id = v_id;
  IF v_n <> 1 THEN
    f := f || format('UPDATE: %s filas, esperaba 1', v_n);
  END IF;
  IF v_despues.identificador_acreedor IS DISTINCT FROM c_cid THEN
    f := f || format('el CID quedó %s', coalesce(v_despues.identificador_acreedor, 'NULL'));
  END IF;
  IF v_resto_d IS DISTINCT FROM v_resto_a THEN
    f := f || 'ha cambiado otra columna del centro'::text;
  END IF;
  IF (SELECT count(*) FROM public.centros) <> e_centros THEN
    f := f || 'ha cambiado el número de centros'::text;
  END IF;
  SELECT count(*) INTO v_n FROM public.audit_log WHERE xmin = v_xid;
  IF v_n <> e_audit
     OR NOT EXISTS (SELECT 1 FROM public.audit_log
                     WHERE xmin = v_xid AND tabla = 'centros' AND accion = 'UPDATE'
                       AND registro_id = v_id AND usuario_id IS NULL AND actor_sistema = c_actor) THEN
    f := f || format('audit_log de esta transacción: %s filas; esperaba %s, el UPDATE de centros con actor %s',
      v_n, e_audit, c_actor);
  END IF;

  IF cardinality(f) > 0 THEN
    RAISE EXCEPTION 'GUARDA: rollback total | %', array_to_string(f, ' | ');
  END IF;

  IF current_setting('nido.ensayo', true) = 'on' THEN
    RAISE EXCEPTION 'ENSAYO OK, nada confirmado | mod 97: IBAN válido pasa, alterados no | CEI Ejemplo: CID vacío → % | resto de la fila igual | audit_log: % (UPDATE, %)',
      v_despues.identificador_acreedor, v_n, c_actor;
  END IF;

  RAISE NOTICE 'CID de prueba puesto | CEI Ejemplo: % | audit_log: % | ESTE CID NO VALE PARA COBRAR NADA',
    v_despues.identificador_acreedor, v_n;
END $operacion$;
