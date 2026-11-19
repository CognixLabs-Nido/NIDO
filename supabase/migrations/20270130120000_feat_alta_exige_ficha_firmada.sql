-- Fase 10 · 10b-3, segunda de dos: el alta exige la ficha firmada (2026-11-19). Spec:
-- docs/specs/altas-serie.md, «10b-3: el encargo, lo medido abierto y el orden» y «La 10b-3 cierra el
-- punto 3 entero».
--
-- Medido ABIERTO en producción (ensayos terminados en RAISE: 2026-11-18, `~/nido-logs/10/b2/punto3/`,
-- y 2026-11-19, `~/nido-logs/10/b3/abierto/`): con todo lo demás puesto, el tutor cierra el alta
-- llamando a `marcar_matricula_lista` con 0 firmas (A1), sin respuesta de imagen (A2) y sin libro de
-- familia (A3); y Dirección valida (`validar_alta`) un alta en `lista` sin firma (V1). El DNI de los
-- tutores ya lo exigía la base (`privado.tutor_completo`, fase 6): no se toca.
--
--   1. `marcar_matricula_lista`, con la matrícula pendiente, exige el libro de familia (HINT
--      `libro_familia_por_subir`), una firma de la ficha que valga (`privado.firma_ficha_vigente`;
--      HINT `ficha_sin_firmar`) y la respuesta de imagen del tutor de ESA firma (el firmante en la
--      digital, el tutor del papel en la presencial; HINT `imagen_sin_respuesta`). Firmar sigue
--      cerrando: `firmar_ficha` y `registrar_firma_ficha_presencial` insertan la firma antes de
--      llamarla.
--   2. `validar_alta` exige una firma de la ficha que valga (HINT `ficha_sin_firmar`).
--
-- ORDEN: aplicar DESPUÉS del despliegue de la app de la 10b-3. La app de la 10b-2 termina el alta en
-- papel con «Finalizar» (`marcar_matricula_lista` sin firma): con esto aplicado antes de que llegue la
-- pantalla de la firma en papel, Dirección no podría cerrar ninguna alta en papel. No es retroactivo:
-- solo mira el alta que se cierra o se valida. Sin COMMIT ni BEGIN: el SQL Editor la envuelve en su
-- transacción.

-- ─────────────────────────────────────────────────────────────── guarda previa
DO $guarda$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20270129120000') THEN
    RAISE EXCEPTION 'falta la 20270129120000 en el registro: aplica antes la primera migración de la 10b-3';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'firmas_ficha' AND column_name = 'tutor_id') THEN
    RAISE EXCEPTION 'firmas_ficha no tiene tutor_id: la primera migración de la 10b-3 no está';
  END IF;
  IF to_regprocedure('privado.firma_ficha_vigente(uuid)') IS NULL
     OR to_regprocedure('privado.respuesta_imagen(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'falta una de las funciones de las que depende el cierre';
  END IF;
  -- Las dos que se reescriben, con el cuerpo leído en producción (md5 de la lógica normalizada).
  IF md5(btrim(regexp_replace(regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.marcar_matricula_lista(uuid)')), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]+', ' ', 'g')))
     IS DISTINCT FROM '7c33e387eb551afb268a0a8c66055a8e' THEN
    RAISE EXCEPTION 'public.marcar_matricula_lista(uuid) no es la leída en producción el 2026-11-19';
  END IF;
  IF md5(btrim(regexp_replace(regexp_replace(replace((SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.validar_alta(uuid,date)')), chr(13), ''), '--[^' || chr(10) || ']*', '', 'g'), '[[:space:]]+', ' ', 'g')))
     IS DISTINCT FROM 'ba4a30df96ac148ebe09a62615647c72' THEN
    RAISE EXCEPTION 'public.validar_alta(uuid,date) no es la leída en producción el 2026-11-19';
  END IF;
END
$guarda$;

-- ─────────────────────────────────────────────────────────────── el cierre del alta
-- Reescrita desde su definición viva (2026-11-19), con un cambio: el libro, la firma y la respuesta
-- de imagen del tutor de la firma, al final, después de todo lo de antes.
CREATE OR REPLACE FUNCTION public.marcar_matricula_lista(p_nino_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_pendiente boolean;
  v_firma uuid;
BEGIN
  -- Gate AMPLIADO: admin del centro del niño O tutor legal (el tutor pasa igual).
  IF NOT (public.es_admin(privado.centro_de_nino(p_nino_id))
          OR public.es_tutor_legal_de(p_nino_id)) THEN
    RAISE EXCEPTION 'no autorizado a finalizar el alta de este nino'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.matriculas
     WHERE nino_id = p_nino_id
       AND estado = 'pendiente'
       AND fecha_baja IS NULL
       AND deleted_at IS NULL
  ) INTO v_pendiente;

  -- Acuse de confidencialidad de datos médicos obligatorio para cerrar el alta
  -- (backstop F11-F, CONSERVADO). auth.uid() = quien finaliza (admin o tutor), y el acuse es de
  -- ESTE niño (U-3, corregido en la base en 20270103120000).
  IF v_pendiente AND NOT EXISTS (
       SELECT 1 FROM public.consentimientos c
        WHERE c.usuario_id = auth.uid()
          AND c.tipo = 'datos_medicos'
          AND c.nino_id = p_nino_id
          AND c.revocado_en IS NULL) THEN
    RAISE EXCEPTION 'falta el acuse de confidencialidad de datos medicos'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Fase 4 (4b-2): los documentos del centro obligatorios que el niño tiene por firmar. El que el
  -- centro todavía no ha subido (`falta_documento`) no frena (P-6), ni el opcional.
  IF v_pendiente AND EXISTS (
       SELECT 1 FROM privado.documentos_del_nino(p_nino_id) d
        WHERE d.obligatorio AND d.estado = 'por_firmar') THEN
    RAISE EXCEPTION 'faltan documentos del centro por firmar'
      USING HINT = 'documentos_por_firmar';
  END IF;

  -- Fase 5b (20270114120000): los datos del niño que el alta exige. Apellidos y fecha ya se exigían,
  -- pero en silencio (el UPDATE de abajo tocaba 0 filas y devolvía NULL); ahora frenan con su motivo,
  -- junto con los tres obligatorios de la fase 5 (decididos por el responsable el 2026-11-10): lugar
  -- de nacimiento, nacionalidad y hermanos. Solo al cerrar un alta pendiente: no toca a los niños ya
  -- validados. Dirección, que cierra el alta en papel, los escribe con su sesión antes de llegar aquí.
  IF v_pendiente AND EXISTS (
       SELECT 1 FROM public.ninos n
        WHERE n.id = p_nino_id
          AND (n.apellidos IS NULL
               OR n.fecha_nacimiento IS NULL
               OR NULLIF(btrim(n.lugar_nacimiento), '') IS NULL
               OR NULLIF(btrim(n.nacionalidad), '') IS NULL
               OR n.hermanos_total IS NULL
               -- Fase 7 (decidido por el responsable el 2026-11-13): el número de la tarjeta
               -- sanitaria, de cualquier comunidad o aseguradora. La imagen no se exige nunca.
               OR n.sip IS NULL)) THEN
    RAISE EXCEPTION 'faltan datos del nino por completar'
      USING HINT = 'datos_nino_por_completar';
  END IF;

  -- Fase 6 (20270118120000): los datos de los tutores que el alta exige (decididos por el
  -- responsable el 2026-11-12/13: D12, D14, D15 y el número del DNI; `privado.tutor_completo`). El
  -- titular siempre; el segundo tutor si la familia lo tiene (sin fila = «no hay segundo tutor»). Solo
  -- al cerrar un alta pendiente: no toca a las familias ya validadas.
  IF v_pendiente AND (
       NOT EXISTS (
         SELECT 1 FROM public.ninos n
           JOIN public.familia_tutores t
             ON t.familia_id = n.familia_id AND t.rol_familia = 'titular' AND t.deleted_at IS NULL
          WHERE n.id = p_nino_id AND privado.tutor_completo(t))
    OR EXISTS (
         SELECT 1 FROM public.ninos n
           JOIN public.familia_tutores t
             ON t.familia_id = n.familia_id AND t.rol_familia = 'segundo_tutor' AND t.deleted_at IS NULL
          WHERE n.id = p_nino_id AND NOT privado.tutor_completo(t))) THEN
    RAISE EXCEPTION 'faltan datos de los tutores por completar'
      USING HINT = 'datos_tutor_por_completar';
  END IF;

  -- Fase 8b (20270122130000; decidido por el responsable el 2026-11-14): cada servicio que el centro
  -- ofrece al niño, contestado (no, todos los meses o días sueltos). Un centro sin conceptos de
  -- servicio no pide nada. Solo al cerrar un alta pendiente: no toca a los niños ya validados.
  IF v_pendiente AND cardinality(privado.servicios_sin_contestar(p_nino_id)) > 0 THEN
    RAISE EXCEPTION 'faltan servicios por contestar: %', privado.servicios_sin_contestar(p_nino_id)
      USING HINT = 'servicios_por_contestar';
  END IF;

  -- Fase 9b (20270124120000; decidido por el responsable el 2026-11-16): los gastos de gestión del
  -- curso del alta, contestados (transferencia o efectivo) si el centro les ha puesto importe. Que
  -- estén cobrados no frena (D5). Solo al cerrar un alta pendiente: no toca a los niños validados.
  IF v_pendiente AND cardinality(privado.gastos_sin_contestar(p_nino_id)) > 0 THEN
    RAISE EXCEPTION 'faltan los gastos de gestión por contestar'
      USING HINT = 'gastos_por_contestar';
  END IF;

  -- 10b-3 (20270130120000; «La 10b-3 cierra el punto 3 entero», decisión del 2026-11-18): todo lo que
  -- exige el gate de la app, también en la base. Solo al cerrar un alta pendiente: no es retroactivo.
  -- El libro de familia: hasta aquí solo lo miraba el gate (medido: sin él, la firma cerraba el alta).
  IF v_pendiente AND EXISTS (SELECT 1 FROM public.ninos n
                              WHERE n.id = p_nino_id AND NULLIF(btrim(n.libro_familia_path), '') IS NULL) THEN
    RAISE EXCEPTION 'falta el libro de familia' USING HINT = 'libro_familia_por_subir';
  END IF;

  -- La ficha firmada, y que la firma valga (la última, sin refirma posterior, con su sello). Firmar
  -- inserta la firma antes de llamar aquí: firmar sigue cerrando el alta.
  IF v_pendiente THEN
    v_firma := privado.firma_ficha_vigente(p_nino_id);
    IF v_firma IS NULL THEN
      RAISE EXCEPTION 'falta firmar la ficha' USING HINT = 'ficha_sin_firmar';
    END IF;
    -- La respuesta de imagen del tutor de esa firma (decisión del 2026-11-17: «basta que haya
    -- respuesta de quien firma»): el firmante en la digital; en la presencial, el tutor que firmó el
    -- papel, nunca Dirección, que solo la registra.
    IF privado.respuesta_imagen((SELECT COALESCE(f.tutor_id, f.firmante_id) FROM public.firmas_ficha f
                                  WHERE f.id = v_firma), p_nino_id) IS NULL THEN
      RAISE EXCEPTION 'falta la respuesta de imagen de quien firma' USING HINT = 'imagen_sin_respuesta';
    END IF;
  END IF;

  UPDATE public.matriculas
     SET estado = 'lista'
   WHERE nino_id = p_nino_id
     AND estado = 'pendiente'
     AND fecha_baja IS NULL
     AND deleted_at IS NULL
     AND EXISTS (
       SELECT 1 FROM public.ninos n
        WHERE n.id = p_nino_id
          AND n.apellidos IS NOT NULL
          AND n.fecha_nacimiento IS NOT NULL
     )
   RETURNING id INTO v_id;

  RETURN v_id;
END $function$;

-- ─────────────────────────────────────────────────────────────── validar el alta
-- Reescrita desde su definición viva (2026-11-19), con un cambio: exige la firma de la ficha.
CREATE OR REPLACE FUNCTION public.validar_alta(p_matricula_id uuid, p_fecha_incorporacion date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- Fase 8a. Dirección valida un alta terminada por la familia (matrícula 'lista' → 'activa') y dice
-- qué día empieza a venir el niño. Las dos cosas a la vez, o ninguna. Devuelve la matrícula, o NULL
-- si no estaba 'lista' (ya activa, a medias o borrada): el mismo «0 filas» de antes.
DECLARE
  v_centro uuid;
  v_nino uuid;
  v_id uuid;
  r record;
BEGIN
  SELECT n.centro_id, m.nino_id INTO v_centro, v_nino
    FROM public.matriculas m JOIN public.ninos n ON n.id = m.nino_id
   WHERE m.id = p_matricula_id;
  IF v_centro IS NULL OR NOT public.es_admin(v_centro) THEN
    RAISE EXCEPTION 'no autorizado: solo Dirección del centro del niño' USING ERRCODE = '42501';
  END IF;
  IF p_fecha_incorporacion IS NULL THEN
    RAISE EXCEPTION 'falta la fecha de incorporación' USING ERRCODE = 'null_value_not_allowed',
      HINT = 'falta_fecha_incorporacion';
  END IF;

  SELECT m.id INTO v_id FROM public.matriculas m
   WHERE m.id = p_matricula_id AND m.estado = 'lista' AND m.deleted_at IS NULL AND m.fecha_baja IS NULL
   FOR UPDATE;
  IF v_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- 10b-3 (20270130120000): no se valida un alta sin una firma de la ficha que valga. Si un cambio la
  -- invalidó, la familia vuelve a firmar (en `lista` puede sin que nadie lo pida).
  IF privado.firma_ficha_vigente(v_nino) IS NULL THEN
    RAISE EXCEPTION 'la ficha del alta no está firmada, o la firma ya no vale'
      USING HINT = 'ficha_sin_firmar';
  END IF;

  UPDATE public.ninos SET fecha_incorporacion = p_fecha_incorporacion WHERE id = v_nino;
  UPDATE public.matriculas SET estado = 'activa' WHERE id = v_id;

  -- Fase 8b: las mensuales que pide la petición (ya corregida por Dirección, si la corrigió), desde
  -- el día 1 del mes siguiente al de la incorporación: el mes de entrada se cobra por días, por el
  -- parte. «No» y «días sueltos» no tocan nada. Una petición sin contestar no bloquea: Dirección ya
  -- la ha visto en pantalla. Un concepto que el centro ya no ofrece no se aplica.
  FOR r IN
    SELECT p.concepto_id FROM public.peticion_servicio p
     WHERE p.nino_id = v_nino AND p.respuesta = 'mensual'
       AND EXISTS (SELECT 1 FROM privado.servicios_ofrecidos(v_nino) o
                    WHERE o.concepto_id = p.concepto_id AND o.tipo_concepto = 'mensual')
     ORDER BY p.servicio
  LOOP
    PERFORM privado.poner_mensual(v_nino, r.concepto_id, privado.mes_siguiente(p_fecha_incorporacion), true);
  END LOOP;
  RETURN v_id;
END $function$;

-- ─────────────────────────────────────────────────────────────── guarda posterior
DO $posterior$
DECLARE
  v text;
BEGIN
  v := (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.marcar_matricula_lista(uuid)'));
  IF position('libro_familia_por_subir' IN v) = 0 OR position('ficha_sin_firmar' IN v) = 0
     OR position('COALESCE(f.tutor_id, f.firmante_id)' IN v) = 0 THEN
    RAISE EXCEPTION 'marcar_matricula_lista no quedó como se escribió';
  END IF;
  IF position('ficha_sin_firmar' IN (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.validar_alta(uuid,date)'))) = 0 THEN
    RAISE EXCEPTION 'validar_alta no quedó como se escribió';
  END IF;
  -- Lo de antes sigue en su sitio: las seis puertas del cierre que ya había.
  FOREACH v IN ARRAY ARRAY['datos_medicos', 'documentos_por_firmar', 'datos_nino_por_completar',
                           'datos_tutor_por_completar', 'servicios_por_contestar', 'gastos_por_contestar'] LOOP
    IF position(v IN (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.marcar_matricula_lista(uuid)'))) = 0 THEN
      RAISE EXCEPTION 'marcar_matricula_lista perdió %', v;
    END IF;
  END LOOP;
  IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('public.marcar_matricula_lista(uuid)'))
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure('public.validar_alta(uuid,date)')) THEN
    RAISE EXCEPTION 'una de las dos dejó de ser SECURITY DEFINER';
  END IF;
  RAISE NOTICE '10b-3 (2/2): el alta exige el libro, la ficha firmada y la respuesta de imagen de su tutor; validar exige la firma';
END
$posterior$;
