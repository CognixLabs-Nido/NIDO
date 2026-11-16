-- =============================================================================
-- Fase 9 · gastos de gestión (1 de 2: aditiva, ANTES del despliegue)
-- Spec: docs/specs/altas-serie.md, «Fase 9: gastos de gestión».
--
-- Decisiones (2026-10-29; 2026-11-16 de Jose y del responsable):
--   · El tutor adjunta el justificante de la transferencia o dice que pagará en efectivo. Sin
--     bloqueo automático ni «exento» (D5); ningún recibo, solo la marca de cobro (D6); el
--     justificante en su propio bucket, que la purga alcanza (D8).
--   · Cada curso, también los que continúan, y por niño. El centro fija un importe por curso, que es
--     una PROPUESTA: Dirección pone otro para un niño, o cero, cuando quiera (queda en audit_log). Un
--     centro sin importe no ve nada.
--   · Contestar es obligatorio para cerrar el alta (eso va en la 2 de 2, después del despliegue). Lo
--     que no bloquea es estar cobrado. Después del alta, por la cola. Dirección marca el cobro cuando
--     quiere y ve la lista de los que faltan. PDF e imágenes. Sale en el export y se purga con el niño.
--
-- Aquí: las dos tablas, el bucket, las funciones, la cola (la ruta del justificante), y la purga, el
-- export, la auditoría y su redacción la conocen. Con la app de antes nadie escribe nada.
--
-- Las funciones que cambian se generan con un guion desde su cuerpo de main (md5 normalizado igual
-- al vivo, con la guarda). La aplica el responsable por SQL Editor, copiando el fichero de la rama.
-- Sin COMMIT ni BEGIN. Tras aplicar: registrar en supabase_migrations.schema_migrations.
-- =============================================================================

-- ---- Guarda previa ----
DO $guarda$
DECLARE
  v_md5 text;
  v_esperado text;
  v_firma text;
BEGIN
  -- La 8b, aplicada y registrada: la purga, el export y la auditoría de aquí parten de las suyas.
  IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20270122130000') THEN
    RAISE EXCEPTION 'falta 20270122130000 (la 8b) en el registro';
  END IF;
  FOR v_firma, v_esperado IN VALUES
    ('privado.purgar_nino(uuid)', 'c69a123cf3872b85ae29a620d24afc6b'),
    ('public.export_datos_sujeto(text,uuid)', 'fc870da9048134a04f849f4032db231f'),
    ('public.audit_trigger_function()', '86a9fae6c687de4cf6c366106de57df7'),
    ('public._claves_pii_nino(text)', 'dc36b7155ef4494c7bb1a6515c211529')
  LOOP
    SELECT md5(regexp_replace(regexp_replace(replace(p.prosrc, E'\r', ''), '--[^\n]*', '', 'g'), '\s+', ' ', 'g'))
      INTO v_md5 FROM pg_proc p WHERE p.oid = to_regprocedure(v_firma);
    IF v_md5 IS DISTINCT FROM v_esperado THEN
      RAISE EXCEPTION '% no es la de antes: %', v_firma, coalesce(v_md5, 'falta');
    END IF;
  END LOOP;
  IF to_regclass('public.gastos_gestion') IS NOT NULL OR to_regclass('public.gastos_gestion_curso') IS NOT NULL THEN
    RAISE EXCEPTION 'las tablas de gastos de gestión ya existen';
  END IF;
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'justificantes-gestion') THEN
    RAISE EXCEPTION 'el bucket justificantes-gestion ya existe';
  END IF;
  IF to_regprocedure('public.alta_validada_de_nino(uuid)') IS NULL OR to_regprocedure('privado.ruta_coherente(text,text)') IS NULL THEN
    RAISE EXCEPTION 'faltan alta_validada_de_nino o ruta_coherente';
  END IF;
END $guarda$;

-- ---- 1. El importe que fija el centro para un curso ----
CREATE TABLE public.gastos_gestion_curso (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Lo pone el trigger desde el curso: quien escribe no lo elige.
  centro_id          uuid NOT NULL REFERENCES public.centros(id) ON DELETE CASCADE,
  curso_academico_id uuid NOT NULL REFERENCES public.cursos_academicos(id) ON DELETE CASCADE,
  -- La PROPUESTA del curso, en céntimos. Sin fila, el centro no cobra gastos ese curso. Cero no: un
  -- centro que no los cobra no fija importe; el cero es de un niño (gastos_gestion.importe_centimos).
  importe_centimos   integer NOT NULL CHECK (importe_centimos > 0 AND importe_centimos <= 10000000),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gastos_gestion_curso_uno_por_curso UNIQUE (curso_academico_id)
);
CREATE INDEX idx_gastos_gestion_curso_centro ON public.gastos_gestion_curso (centro_id);

COMMENT ON TABLE public.gastos_gestion_curso IS
  'Los gastos de gestión que fija el centro para un curso (fase 9, 20270123120000): una PROPUESTA '
  'que Dirección puede cambiar para cada niño (gastos_gestion.importe_centimos). Sin fila, el centro '
  'no los cobra ese curso: ni paso en el alta ni nada en la ficha. Solo por fijar_gastos_gestion_curso.';

CREATE FUNCTION privado.gastos_gestion_curso_centro()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.centro_id := (SELECT c.centro_id FROM public.cursos_academicos c WHERE c.id = NEW.curso_academico_id);
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION privado.gastos_gestion_curso_centro() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER gastos_gestion_curso_centro
  BEFORE INSERT OR UPDATE ON public.gastos_gestion_curso
  FOR EACH ROW EXECUTE FUNCTION privado.gastos_gestion_curso_centro();
-- La coherencia de centro de la casa (`20270108120000`), con su columna.
CREATE FUNCTION privado.gastos_gestion_curso_centro_coherente()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.curso_academico_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.cursos_academicos r
     WHERE r.id = NEW.curso_academico_id AND r.centro_id IS DISTINCT FROM NEW.centro_id) THEN
    RAISE EXCEPTION 'public.gastos_gestion_curso.curso_academico_id no es del centro de la fila'
      USING ERRCODE = '23514', HINT = 'centro_ajeno';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION privado.gastos_gestion_curso_centro_coherente() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER zz_centro_coherente
  BEFORE INSERT OR UPDATE OF centro_id, curso_academico_id ON public.gastos_gestion_curso
  FOR EACH ROW EXECUTE FUNCTION privado.gastos_gestion_curso_centro_coherente();
CREATE TRIGGER set_updated_at_gastos_gestion_curso
  BEFORE UPDATE ON public.gastos_gestion_curso
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER audit_gastos_gestion_curso
  AFTER INSERT OR UPDATE OR DELETE ON public.gastos_gestion_curso
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

ALTER TABLE public.gastos_gestion_curso ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gastos_gestion_curso FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.gastos_gestion_curso TO authenticated;
GRANT SELECT ON public.gastos_gestion_curso TO service_role;
-- La Dirección del centro. La familia ve el importe de su hijo por gastos_gestion_nino.
CREATE POLICY gastos_gestion_curso_select ON public.gastos_gestion_curso
  FOR SELECT TO authenticated
  USING (public.es_admin(centro_id));

-- ---- 2. Los gastos de cada niño, por curso ----
CREATE TABLE public.gastos_gestion (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Lo pone el trigger desde el niño.
  centro_id          uuid NOT NULL REFERENCES public.centros(id) ON DELETE CASCADE,
  -- Anular un alta sin terminar borra al niño, y con él esto.
  nino_id            uuid NOT NULL REFERENCES public.ninos(id) ON DELETE CASCADE,
  -- Como el importe del curso: un curso no se borra (se marca); si se borrara, se van con él.
  curso_academico_id uuid NOT NULL REFERENCES public.cursos_academicos(id) ON DELETE CASCADE,
  -- Lo que declaró la familia (o Dirección por ella). NULL: sin contestar.
  forma              text NULL CHECK (forma IN ('transferencia', 'efectivo')),
  -- El justificante de la transferencia, en el bucket justificantes-gestion. Puede llegar después.
  justificante_path  text NULL,
  -- El importe de ESTE niño, si Dirección lo cambia (cero vale: un descuento entero). NULL: el del
  -- curso (gastos_gestion_curso).
  importe_centimos   integer NULL CHECK (importe_centimos >= 0 AND importe_centimos <= 10000000),
  -- La marca de que se cobró (D6: sin recibo). La pone Dirección cuando quiere.
  cobrado_at         timestamptz NULL,
  cobrado_por        uuid NULL REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gastos_gestion_uno_por_curso UNIQUE (nino_id, curso_academico_id),
  CONSTRAINT gastos_gestion_justificante_de_transferencia
    CHECK (justificante_path IS NULL OR forma = 'transferencia'),
  CONSTRAINT gastos_gestion_ruta_del_nino
    CHECK (justificante_path IS NULL
           OR justificante_path ~ ('^' || centro_id || '/' || nino_id || '/[A-Za-z0-9_-]+\.(pdf|jpg|jpeg|png|heic|heif)$')),
  CONSTRAINT gastos_gestion_cobro_con_fecha CHECK (cobrado_por IS NULL OR cobrado_at IS NOT NULL)
);
CREATE INDEX idx_gastos_gestion_centro ON public.gastos_gestion (centro_id);
CREATE INDEX idx_gastos_gestion_curso ON public.gastos_gestion (curso_academico_id);

COMMENT ON TABLE public.gastos_gestion IS
  'Los gastos de gestión de un niño en un curso (fase 9, 20270123120000): cómo dice la familia que '
  'paga (transferencia, con su justificante, o efectivo), el importe de ese niño si Dirección lo '
  'cambia, y la marca de cobro. Sin recibo (D6). Cada curso, también los que continúan, y por niño '
  '(decisiones de Jose, 2026-11-16). Solo por funciones: declarar_gastos_gestion, '
  'fijar_importe_gastos_gestion y marcar_cobro_gastos_gestion.';

CREATE FUNCTION privado.gastos_gestion_centro()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  NEW.centro_id := (SELECT n.centro_id FROM public.ninos n WHERE n.id = NEW.nino_id);
  RETURN NEW;
END $function$;
REVOKE ALL ON FUNCTION privado.gastos_gestion_centro() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER gastos_gestion_centro
  BEFORE INSERT OR UPDATE ON public.gastos_gestion
  FOR EACH ROW EXECUTE FUNCTION privado.gastos_gestion_centro();
CREATE FUNCTION privado.gastos_gestion_centro_coherente()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF NEW.curso_academico_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.cursos_academicos r
     WHERE r.id = NEW.curso_academico_id AND r.centro_id IS DISTINCT FROM NEW.centro_id) THEN
    RAISE EXCEPTION 'public.gastos_gestion.curso_academico_id no es del centro de la fila'
      USING ERRCODE = '23514', HINT = 'centro_ajeno';
  END IF;
  IF NEW.nino_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.ninos r
     WHERE r.id = NEW.nino_id AND r.centro_id IS DISTINCT FROM NEW.centro_id) THEN
    RAISE EXCEPTION 'public.gastos_gestion.nino_id no es del centro de la fila'
      USING ERRCODE = '23514', HINT = 'centro_ajeno';
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION privado.gastos_gestion_centro_coherente() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER zz_centro_coherente
  BEFORE INSERT OR UPDATE OF centro_id, curso_academico_id, nino_id ON public.gastos_gestion
  FOR EACH ROW EXECUTE FUNCTION privado.gastos_gestion_centro_coherente();
CREATE TRIGGER set_updated_at_gastos_gestion
  BEFORE UPDATE ON public.gastos_gestion
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER audit_gastos_gestion
  AFTER INSERT OR UPDATE OR DELETE ON public.gastos_gestion
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function();

ALTER TABLE public.gastos_gestion ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gastos_gestion FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.gastos_gestion TO authenticated;
GRANT SELECT ON public.gastos_gestion TO service_role;
-- Los tutores legales del niño y la Dirección del centro.
CREATE POLICY gastos_gestion_select ON public.gastos_gestion
  FOR SELECT TO authenticated
  USING (public.es_tutor_legal_de(nino_id) OR public.es_admin(centro_id));

-- ---- 3. El bucket del justificante (D8): PDF e imágenes, carpeta {centro}/{niño}/ ----
-- El tamaño y los tipos de imagen, los de los buckets de fotos; las políticas, las de `sip-ninos`.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('justificantes-gestion', 'justificantes-gestion', false, 15728640,
        ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif']);

CREATE POLICY justificantes_gestion_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'justificantes-gestion'
         AND (public.es_admin(((storage.foldername(name))[1])::uuid)
              OR public.es_tutor_legal_de(((storage.foldername(name))[2])::uuid))
         AND privado.ruta_coherente(bucket_id, name));
CREATE POLICY justificantes_gestion_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'justificantes-gestion'
              AND (public.es_admin(((storage.foldername(name))[1])::uuid)
                   OR public.es_tutor_legal_de(((storage.foldername(name))[2])::uuid))
              AND privado.ruta_coherente(bucket_id, name));
CREATE POLICY justificantes_gestion_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'justificantes-gestion'
         AND (public.es_admin(((storage.foldername(name))[1])::uuid)
              OR public.es_tutor_legal_de(((storage.foldername(name))[2])::uuid))
         AND privado.ruta_coherente(bucket_id, name))
  WITH CHECK (bucket_id = 'justificantes-gestion'
              AND (public.es_admin(((storage.foldername(name))[1])::uuid)
                   OR public.es_tutor_legal_de(((storage.foldername(name))[2])::uuid))
              AND privado.ruta_coherente(bucket_id, name));
CREATE POLICY justificantes_gestion_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'justificantes-gestion'
         AND public.es_admin(((storage.foldername(name))[1])::uuid)
         AND privado.ruta_coherente(bucket_id, name));

-- ---- 4. Lo que debe cada niño ----
-- Como los documentos de curso (documentos_del_nino): cada matrícula viva en un curso no cerrado
-- pide los gastos de su curso, si el centro les ha puesto importe. La del alta y la propuesta de la
-- renovación («pasar de curso») son las dos matrículas `pendiente`; por eso el niño que sigue debe
-- los del curso siguiente desde que Dirección se la propone.
CREATE FUNCTION privado.gastos_del_nino(p_nino_id uuid)
 RETURNS TABLE(curso_academico_id uuid, curso_nombre text, importe_curso integer, importe integer,
               importe_propio boolean, forma text, justificante_path text, cobrado_at timestamptz,
               cobrado_por uuid, matricula_pendiente boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT k.id, k.nombre::text, gc.importe_centimos,
         COALESCE(g.importe_centimos, gc.importe_centimos), g.importe_centimos IS NOT NULL,
         g.forma, g.justificante_path, g.cobrado_at, g.cobrado_por,
         bool_or(m.estado = 'pendiente')
    FROM public.ninos n
    JOIN public.matriculas m ON m.nino_id = n.id AND m.fecha_baja IS NULL AND m.deleted_at IS NULL
    JOIN public.cursos_academicos k ON k.id = m.curso_academico_id
                                   AND k.estado <> 'cerrado' AND k.deleted_at IS NULL
    JOIN public.gastos_gestion_curso gc ON gc.curso_academico_id = k.id
    LEFT JOIN public.gastos_gestion g ON g.nino_id = n.id AND g.curso_academico_id = k.id
   WHERE n.id = p_nino_id AND n.deleted_at IS NULL
   GROUP BY k.id, k.nombre, k.fecha_inicio, gc.importe_centimos, g.importe_centimos, g.forma,
            g.justificante_path, g.cobrado_at, g.cobrado_por
   ORDER BY k.fecha_inicio, k.nombre, k.id
$function$;
REVOKE ALL ON FUNCTION privado.gastos_del_nino(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Los cursos que el niño tiene sin contestar ni cobrar (lo que exigirá el cierre del alta, en la 9b).
CREATE FUNCTION privado.gastos_sin_contestar(p_nino_id uuid)
 RETURNS uuid[]
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(array_agg(g.curso_academico_id ORDER BY g.curso_academico_id), '{}')
    FROM privado.gastos_del_nino(p_nino_id) g
   WHERE g.forma IS NULL AND g.cobrado_at IS NULL
$function$;
REVOKE ALL ON FUNCTION privado.gastos_sin_contestar(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Lo que ven la familia (tutor legal) y la Dirección del niño.
CREATE FUNCTION public.gastos_gestion_nino(p_nino_id uuid)
 RETURNS TABLE(curso_academico_id uuid, curso_nombre text, importe_curso integer, importe integer,
               importe_propio boolean, forma text, justificante_path text, cobrado_at timestamptz,
               matricula_pendiente boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_nino_id IS NULL
     OR NOT (public.es_tutor_legal_de(p_nino_id) OR public.es_admin(privado.centro_de_nino(p_nino_id))) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT g.curso_academico_id, g.curso_nombre, g.importe_curso, g.importe, g.importe_propio,
         g.forma, g.justificante_path, g.cobrado_at, g.matricula_pendiente
    FROM privado.gastos_del_nino(p_nino_id) g;
END $function$;
REVOKE ALL ON FUNCTION public.gastos_gestion_nino(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gastos_gestion_nino(uuid) TO authenticated;

-- ---- 5. Escribir ----
-- El importe del curso. NULL lo quita: el centro deja de cobrarlos ese curso. Un curso cerrado no.
CREATE FUNCTION public.fijar_gastos_gestion_curso(p_curso_academico_id uuid, p_importe_centimos integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_centro uuid;
  v_estado public.curso_estado;
BEGIN
  SELECT c.centro_id, c.estado INTO v_centro, v_estado
    FROM public.cursos_academicos c WHERE c.id = p_curso_academico_id AND c.deleted_at IS NULL;
  IF v_centro IS NULL OR NOT public.es_admin(v_centro) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
  IF v_estado = 'cerrado' THEN
    RAISE EXCEPTION 'el curso está cerrado' USING ERRCODE = 'P0001', HINT = 'curso_cerrado';
  END IF;
  IF p_importe_centimos IS NULL THEN
    DELETE FROM public.gastos_gestion_curso WHERE curso_academico_id = p_curso_academico_id;
  ELSE
    INSERT INTO public.gastos_gestion_curso (centro_id, curso_academico_id, importe_centimos)
      VALUES (v_centro, p_curso_academico_id, p_importe_centimos)
    ON CONFLICT (curso_academico_id) DO UPDATE SET importe_centimos = EXCLUDED.importe_centimos
      WHERE gastos_gestion_curso.importe_centimos IS DISTINCT FROM EXCLUDED.importe_centimos;
  END IF;
END $function$;
REVOKE ALL ON FUNCTION public.fijar_gastos_gestion_curso(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fijar_gastos_gestion_curso(uuid, integer) TO authenticated;

-- El curso tiene que ser uno que el niño debe (matrícula viva en un curso no cerrado, con importe).
CREATE FUNCTION privado.gastos_curso_del_nino(p_nino_id uuid, p_curso_academico_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM privado.gastos_del_nino(p_nino_id) g
                  WHERE g.curso_academico_id = p_curso_academico_id) THEN
    RAISE EXCEPTION 'ese curso no tiene gastos de gestión para este niño'
      USING ERRCODE = '22023', HINT = 'curso_sin_gastos';
  END IF;
END $function$;
REVOKE ALL ON FUNCTION privado.gastos_curso_del_nino(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Cómo paga: la familia (tutor legal) mientras el alta no está validada; después, por la cola.
-- Dirección siempre (y es quien aplica la cola). Transferencia con o sin justificante (puede llegar
-- después); efectivo, sin. Devuelve la ruta que había, para que la app borre el fichero viejo.
CREATE FUNCTION public.declarar_gastos_gestion(p_nino_id uuid, p_curso_academico_id uuid, p_forma text,
                                               p_justificante_path text DEFAULT NULL)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_admin boolean;
  v_antes text;
BEGIN
  IF p_nino_id IS NULL THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
  v_admin := public.es_admin(privado.centro_de_nino(p_nino_id));
  IF NOT (v_admin OR public.es_tutor_legal_de(p_nino_id)) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
  IF NOT v_admin AND public.alta_validada_de_nino(p_nino_id) THEN
    RAISE EXCEPTION 'el alta ya está validada: va por la cola'
      USING ERRCODE = 'P0001', HINT = 'alta_validada';
  END IF;
  PERFORM privado.gastos_curso_del_nino(p_nino_id, p_curso_academico_id);
  IF p_forma IS NULL OR p_forma NOT IN ('transferencia', 'efectivo') THEN
    RAISE EXCEPTION 'la forma es transferencia o efectivo' USING ERRCODE = '22023', HINT = 'forma';
  END IF;
  IF p_forma = 'efectivo' AND p_justificante_path IS NOT NULL THEN
    RAISE EXCEPTION 'en efectivo no hay justificante' USING ERRCODE = '22023', HINT = 'forma';
  END IF;
  SELECT g.justificante_path INTO v_antes FROM public.gastos_gestion g
   WHERE g.nino_id = p_nino_id AND g.curso_academico_id = p_curso_academico_id FOR UPDATE;
  INSERT INTO public.gastos_gestion (centro_id, nino_id, curso_academico_id, forma, justificante_path)
    VALUES (privado.centro_de_nino(p_nino_id), p_nino_id, p_curso_academico_id, p_forma, p_justificante_path)
  ON CONFLICT (nino_id, curso_academico_id) DO UPDATE
    SET forma = EXCLUDED.forma, justificante_path = EXCLUDED.justificante_path
    WHERE (gastos_gestion.forma, gastos_gestion.justificante_path)
          IS DISTINCT FROM (EXCLUDED.forma, EXCLUDED.justificante_path);
  RETURN CASE WHEN v_antes IS DISTINCT FROM p_justificante_path THEN v_antes END;
END $function$;
REVOKE ALL ON FUNCTION public.declarar_gastos_gestion(uuid, uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.declarar_gastos_gestion(uuid, uuid, text, text) TO authenticated;

-- El importe de un niño: otro, o cero, cuando Dirección quiera (Jose, 2026-11-16). NULL vuelve al
-- del curso. Queda en audit_log a su nombre.
CREATE FUNCTION public.fijar_importe_gastos_gestion(p_nino_id uuid, p_curso_academico_id uuid,
                                                    p_importe_centimos integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_nino_id IS NULL OR NOT public.es_admin(privado.centro_de_nino(p_nino_id)) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
  PERFORM privado.gastos_curso_del_nino(p_nino_id, p_curso_academico_id);
  INSERT INTO public.gastos_gestion (centro_id, nino_id, curso_academico_id, importe_centimos)
    VALUES (privado.centro_de_nino(p_nino_id), p_nino_id, p_curso_academico_id, p_importe_centimos)
  ON CONFLICT (nino_id, curso_academico_id) DO UPDATE SET importe_centimos = EXCLUDED.importe_centimos
    WHERE gastos_gestion.importe_centimos IS DISTINCT FROM EXCLUDED.importe_centimos;
END $function$;
REVOKE ALL ON FUNCTION public.fijar_importe_gastos_gestion(uuid, uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fijar_importe_gastos_gestion(uuid, uuid, integer) TO authenticated;

-- La marca de cobro (D6), en cualquier momento, con o sin lo que declaró la familia; false la quita.
CREATE FUNCTION public.marcar_cobro_gastos_gestion(p_nino_id uuid, p_curso_academico_id uuid,
                                                   p_cobrado boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_nino_id IS NULL OR NOT public.es_admin(privado.centro_de_nino(p_nino_id)) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_cobrado IS NULL THEN
    RAISE EXCEPTION 'falta decir si está cobrado' USING ERRCODE = '22023', HINT = 'cobrado';
  END IF;
  PERFORM privado.gastos_curso_del_nino(p_nino_id, p_curso_academico_id);
  INSERT INTO public.gastos_gestion (centro_id, nino_id, curso_academico_id, cobrado_at, cobrado_por)
    VALUES (privado.centro_de_nino(p_nino_id), p_nino_id, p_curso_academico_id,
            CASE WHEN p_cobrado THEN now() END, CASE WHEN p_cobrado THEN auth.uid() END)
  ON CONFLICT (nino_id, curso_academico_id) DO UPDATE
    SET cobrado_at = EXCLUDED.cobrado_at, cobrado_por = EXCLUDED.cobrado_por
    WHERE (gastos_gestion.cobrado_at IS NOT NULL) IS DISTINCT FROM p_cobrado;
END $function$;
REVOKE ALL ON FUNCTION public.marcar_cobro_gastos_gestion(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marcar_cobro_gastos_gestion(uuid, uuid, boolean) TO authenticated;

-- ---- 6. La lista de Dirección: los que faltan por cobrar ----
CREATE FUNCTION public.gastos_gestion_pendientes(p_centro_id uuid)
 RETURNS TABLE(nino_id uuid, nombre text, apellidos text, curso_academico_id uuid, curso_nombre text,
               importe integer, forma text, con_justificante boolean, matricula_pendiente boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_centro_id IS NULL OR NOT public.es_admin(p_centro_id) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT n.id, n.nombre::text, n.apellidos::text, g.curso_academico_id, g.curso_nombre, g.importe,
         g.forma, g.justificante_path IS NOT NULL, g.matricula_pendiente
    FROM public.ninos n
    CROSS JOIN LATERAL privado.gastos_del_nino(n.id) g
   WHERE n.centro_id = p_centro_id AND n.deleted_at IS NULL
     AND g.cobrado_at IS NULL AND g.importe > 0
   ORDER BY g.curso_nombre, n.apellidos, n.nombre, n.id;
END $function$;
REVOKE ALL ON FUNCTION public.gastos_gestion_pendientes(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gastos_gestion_pendientes(uuid) TO authenticated;

-- ---- 7. La cola: la ruta del justificante, del propio niño (como el DNI, el libro y el SIP) ----
ALTER TABLE public.cambios_pendientes DROP CONSTRAINT cambios_pendientes_ruta_documento_del_nino;
ALTER TABLE public.cambios_pendientes ADD CONSTRAINT cambios_pendientes_ruta_documento_del_nino
  CHECK (((entidad <> ALL (ARRAY['ninos_libro_familia'::text, 'datos_tutor_dni'::text, 'ninos_sip_documento'::text]))
          OR (COALESCE((payload ->> 'path'::text), ''::text) ~ (((('^'::text || (centro_id)::text) || '/'::text) || (nino_id)::text) || '/[A-Za-z0-9_-]+\.pdf$'::text)))
         AND ((entidad <> 'gastos_gestion'::text)
          OR ((payload ->> 'path'::text) IS NULL)
          OR ((payload ->> 'path'::text) ~ (((('^'::text || (centro_id)::text) || '/'::text) || (nino_id)::text) || '/[A-Za-z0-9_-]+\.(pdf|jpg|jpeg|png|heic|heif)$'::text))));

-- ---- 8. La purga, el export, la auditoría y su redacción conocen las tablas nuevas ----
CREATE OR REPLACE FUNCTION privado.purgar_nino(p_nino_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lista uuid[];
BEGIN
  -- D-5: motivo 'purga_rgpd' → desarchivar_nino RAISE (no reincorpora un sujeto purgado).
  UPDATE public.ninos SET
    nombre           = '[borrado]',
    -- 5a: `apellidos` la deriva la base de los dos; se borran los dos.
    primer_apellido  = '[borrado]',
    segundo_apellido = NULL,
    fecha_nacimiento = DATE '1900-01-01',
    sexo             = NULL,
    nacionalidad     = NULL,
    foto_url         = NULL,
    notas_admin      = NULL,
    -- Purga RGPD del niño: el resto de columnas personales de la ficha. idioma_principal
    -- es NOT NULL: 'zz' (no es un idioma, como en idiomas_casa) en vez de inventar 'es'. El
    -- CHECK solo admite 'zz' con deleted_reason = 'purga_rgpd', que pone este mismo UPDATE.
    idioma_principal     = 'zz',
    direccion_calle      = NULL,
    direccion_numero     = NULL,
    direccion_cp         = NULL,
    direccion_ciudad     = NULL,
    libro_familia_path   = NULL,
    estado_civil_familia = NULL,
    -- 5a: los campos nuevos de la ficha.
    lugar_nacimiento      = NULL,
    dni                   = NULL,
    hermanos_total        = NULL,
    hermanos_lugar        = NULL,
    direccion_provincia   = NULL,
    observaciones_familia = NULL,
    como_nos_conocio      = NULL,
    como_nos_conocio_otro = NULL,
    -- Fase 7: la tarjeta sanitaria, el número y la ruta de la imagen. El objeto del bucket
    -- `sip-ninos` lo borra antes el manifiesto de adjuntos, como el libro de familia.
    sip                   = NULL,
    sip_documento_path    = NULL,
    -- Fase 8a: la fecha de incorporación. Un niño purgado no tiene matrícula activa, que es lo
    -- único que la exige (`privado.ninos_incorporacion_no_se_quita`).
    fecha_incorporacion   = NULL,
    deleted_reason   = 'purga_rgpd',
    deleted_at       = COALESCE(deleted_at, now()),
    -- Retención (PR-7): desde cuándo está bloqueado lo que se conserva.
    purgado_en       = COALESCE(purgado_en, now())
  WHERE id = p_nino_id;

  UPDATE public.info_medica_emergencia SET
    alergias_graves     = NULL,
    notas_emergencia    = NULL,
    medicacion_habitual = NULL,
    alergias_leves      = NULL,
    medico_familia      = NULL,
    telefono_emergencia = NULL
  WHERE nino_id = p_nino_id;

  UPDATE public.datos_pedagogicos_nino SET
    lactancia_observaciones          = NULL,
    control_esfinteres_observaciones = NULL,
    siesta_horario_habitual          = NULL,
    siesta_observaciones             = NULL,
    alimentacion_observaciones       = CASE WHEN tipo_alimentacion = 'otra'
                                            THEN '[borrado]' ELSE NULL END,
    -- Purga RGPD del niño: el CHECK exige de 1 a 8 códigos de 2 letras; 'zz' no es un idioma.
    idiomas_casa                     = ARRAY['zz'],
    deleted_at                       = COALESCE(deleted_at, now())
  WHERE nino_id = p_nino_id;

  -- Purga RGPD del niño: el motivo de baja es texto libre del centro sobre el niño.
  UPDATE public.matriculas SET motivo_baja = NULL
  WHERE nino_id = p_nino_id AND motivo_baja IS NOT NULL;

  -- D-5: motivo 'purga_rgpd' → desarchivar_nino NUNCA revive un vínculo purgado.
  UPDATE public.vinculos_familiares SET
    descripcion_parentesco = NULL,
    deleted_reason         = 'purga_rgpd',
    deleted_at             = COALESCE(deleted_at, now())
  WHERE nino_id = p_nino_id;

  DELETE FROM public.media m
  WHERE EXISTS (
          SELECT 1 FROM public.media_etiquetas e
          WHERE e.media_id = m.id AND e.nino_id = p_nino_id)
    AND NOT EXISTS (
          SELECT 1 FROM public.media_etiquetas e2
          WHERE e2.media_id = m.id AND e2.nino_id <> p_nino_id);
  DELETE FROM public.media_etiquetas WHERE nino_id = p_nino_id;

  -- Cierre de la purga: los cambios pendientes del niño (su dirección, su libro de familia,
  -- los datos de sus tutores) se borran; el payload no entra en audit_log, solo la tabla lo
  -- guarda. Los documentos en Storage los borra antes el manifiesto de adjuntos.
  DELETE FROM public.cambios_pendientes WHERE nino_id = p_nino_id;

  -- Fase 8b: la petición de servicios del alta (lo que la familia pidió). Lo que se cobró de verdad
  -- está en las asignaciones y los recibos, que son fiscales y se quedan.
  DELETE FROM public.peticion_servicio WHERE nino_id = p_nino_id;

  -- Fase 9: los gastos de gestión (lo declarado, el importe y la marca de cobro). Sin recibo (D6): no
  -- hay nada fiscal que guardar aquí. El justificante lo borra antes la app (FUENTES_ADJUNTOS).
  DELETE FROM public.gastos_gestion WHERE nino_id = p_nino_id;

  -- Retención (F11-B, punto 6, PR-4): su operativa (agenda, asistencia, mensajes, informes,
  -- citas, recordatorios, respuestas a eventos) se borra, con sus copias en audit_log.
  PERFORM privado.olvido_borrar_operativa_nino(p_nino_id);

  -- Purga RGPD del niño: la copia en audit_log, con la lista de claves personales por tabla
  -- (_claves_pii_nino).
  PERFORM public._redactar_auditoria_nino(p_nino_id);

  -- Purga de lista_espera: el prospecto del niño se borra entero (la plaza no tiene sentido
  -- sin el niño). Su copia en audit_log se redacta por registro_id: así se alcanza también el
  -- INSERT, que nace con nino_id NULL, y el DELETE que acaba de escribir esta purga.
  WITH borrados AS (
    DELETE FROM public.lista_espera WHERE nino_id = p_nino_id RETURNING id
  )
  SELECT array_agg(id) INTO v_lista FROM borrados;
  UPDATE public.audit_log SET
    valores_antes   = public._redactar_jsonb(valores_antes,   public._claves_pii_nino('lista_espera')),
    valores_despues = public._redactar_jsonb(valores_despues, public._claves_pii_nino('lista_espera'))
  WHERE tabla = 'lista_espera' AND registro_id = ANY (v_lista);

END;
$function$;
CREATE OR REPLACE FUNCTION public.export_datos_sujeto(p_sujeto_tipo text, p_sujeto_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid    uuid := auth.uid();
  v_self   boolean;
  v_admin  boolean;
  v_centro uuid;
  v_email  text;
  v_bloq   boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'no autorizado a exportar este sujeto'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ---------------------------------------------------------------- USUARIO
  IF p_sujeto_tipo = 'usuario' THEN
    v_self := v_uid = p_sujeto_id;
    IF NOT v_self AND NOT EXISTS (
      SELECT 1 FROM public.roles_usuario ru
       WHERE ru.usuario_id = p_sujeto_id
         AND ru.deleted_at IS NULL
         AND privado.es_responsable(ru.centro_id)
    ) THEN
      RAISE EXCEPTION 'no autorizado a exportar este sujeto'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    SELECT u.email INTO v_email FROM auth.users u WHERE u.id = p_sujeto_id;

    -- Cada fila con centro pasa si es el propio usuario o si quien exporta es admin de ese
    -- centro (centro NULL nunca: es_responsable(NULL) es FALSE).
    RETURN jsonb_build_object(
      'preferencias', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'clave', p.clave, 'valor', p.valor, 'actualizado_en', p.updated_at)
               ORDER BY p.clave)
          FROM public.preferencias_usuario p
         WHERE p.usuario_id = p_sujeto_id), '[]'::jsonb),

      'dispositivos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'actualizado_en', s.updated_at,
                 'navegador', s.user_agent, 'registrado_en', s.created_at,
                 'ultima_actividad', s.last_active_at)
               ORDER BY s.created_at)
          FROM public.push_subscriptions s
         WHERE s.usuario_id = p_sujeto_id), '[]'::jsonb),

      'lecturas_conversaciones', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'conversacion_id', l.conversacion_id, 'leido_hasta', l.last_read_at)
               ORDER BY l.last_read_at)
          FROM public.lectura_conversacion l
          JOIN public.conversaciones c ON c.id = l.conversacion_id
         WHERE l.usuario_id = p_sujeto_id
           AND (v_self OR (c.centro_id IS NOT NULL AND privado.es_responsable(c.centro_id)))), '[]'::jsonb),

      'lecturas_anuncios', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'anuncio_id', l.anuncio_id, 'anuncio', a.titulo, 'leido_en', l.leido_at)
               ORDER BY l.leido_at)
          FROM public.lectura_anuncio l
          JOIN public.anuncios a ON a.id = l.anuncio_id
         WHERE l.usuario_id = p_sujeto_id
           AND (v_self OR (a.centro_id IS NOT NULL AND privado.es_responsable(a.centro_id)))), '[]'::jsonb),

      'invitaciones', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'email', i.email, 'nombre_completo', i.nombre_completo,
                 'rol_objetivo', i.rol_objetivo, 'tipo_vinculo', i.tipo_vinculo,
                 -- 2c (2026-11-02, columnas-export.ts)
                 'tipo_personal_aula', i.tipo_personal_aula,
                 'enviada_en', i.created_at, 'expira_en', i.expires_at,
                 'aceptada_en', i.accepted_at, 'rechazada_en', i.rejected_at)
               ORDER BY i.created_at)
          FROM public.invitaciones i
         WHERE v_email IS NOT NULL
           AND lower(i.email) = lower(v_email)
           AND (v_self OR privado.es_responsable(i.centro_id))), '[]'::jsonb),

      'lista_espera_contacto', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', le.created_at, 'actualizado_en', le.updated_at,
                 'telefono_tutor', le.telefono_tutor, 'email_tutor', le.email_tutor,
                 -- 2c (2026-11-02, columnas-export.ts): el prospecto entero, nota incluida
                 'nombre_nino', le.nombre_nino, 'apellidos_nino', le.apellidos_nino,
                 'fecha_nacimiento', le.fecha_nacimiento, 'nota', le.nota,
                 'posicion', le.posicion, 'estado', le.estado, 'curso', ca.nombre,
                 'descartado_en', le.descartado_at)
               ORDER BY le.created_at)
          FROM public.lista_espera le
          LEFT JOIN public.cursos_academicos ca ON ca.id = le.curso_academico_id
         WHERE le.tutor_usuario_id = p_sujeto_id
           AND (v_self OR privado.es_responsable(le.centro_id))), '[]'::jsonb),

      'exportaciones', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'exportado_en', e.created_at,
                 'solicitado_por_ti', e.solicitado_por = p_sujeto_id)
               ORDER BY e.created_at)
          FROM public.export_log e
         WHERE e.sujeto_tipo = 'usuario' AND e.sujeto_id = p_sujeto_id
           AND (v_self OR privado.es_responsable(e.centro_id))), '[]'::jsonb),

      'solicitudes_olvido', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', o.created_at,
                 -- 2c (2026-11-02, columnas-export.ts)
                 'por_plazo', o.por_plazo,
                 'solicitado_en', o.solicitado_en, 'estado', o.estado,
                 'pedida_por_centro', o.pedida_por_centro, 'inmediato', o.inmediato,
                 'confirmada_en', o.confirmada_en, 'gracia_hasta', o.gracia_hasta,
                 'rechazada_en', o.rechazada_en, 'motivo_rechazo', o.motivo_rechazo,
                 'retirada_en', o.retirada_en, 'nota_centro', o.nota_centro,
                 'purgado_en', o.purgado_en)
               ORDER BY o.solicitado_en)
          FROM public.olvido_solicitudes o
         WHERE o.sujeto_tipo = 'usuario' AND o.sujeto_id = p_sujeto_id
           AND (v_self OR privado.es_responsable(o.centro_id))), '[]'::jsonb),

      -- Su perfil de tutor en cada familia (solo su fila, no la del otro tutor).
      'perfiles_familia', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', ft.created_at, 'actualizado_en', ft.updated_at, 'borrado_en', ft.deleted_at,
                 'familia_id', ft.familia_id, 'rol_familia', ft.rol_familia,
                 'nombre_completo', ft.nombre_completo, 'email', ft.email,
                 'direccion_calle', ft.direccion_calle, 'direccion_numero', ft.direccion_numero,
                 'direccion_cp', ft.direccion_cp, 'direccion_ciudad', ft.direccion_ciudad,
                 'dni_documento_path', ft.dni_documento_path,
                 -- Fase 6 (20270118120000): los cinco datos nuevos, de SU fila.
                 'telefono', ft.telefono, 'fecha_nacimiento', ft.fecha_nacimiento,
                 'dni_numero', ft.dni_numero, 'estudios', ft.estudios, 'empresa', ft.empresa)
               ORDER BY ft.created_at)
          FROM public.familia_tutores ft
          JOIN public.familias f ON f.id = ft.familia_id
         WHERE ft.usuario_id = p_sujeto_id AND ft.deleted_at IS NULL
           AND (v_self OR privado.es_responsable(f.centro_id))), '[]'::jsonb),

      -- Los mandatos que firmó él. Del IBAN, solo los 4 últimos dígitos.
      'mandatos_sepa', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'texto_hash', m.texto_hash, 'creado_en', m.created_at, 'actualizado_en', m.updated_at, 'borrado_en', m.deleted_at, 'familia_id', m.familia_id,
                 'identificador_mandato', m.identificador_mandato, 'titular', m.titular,
                 'iban_ultimos4', m.iban_ultimos4, 'estado', m.estado,
                 'metodo_firma', m.metodo_firma, 'fecha_firma', m.fecha_firma,
                 'nombre_tecleado', m.nombre_tecleado, 'firma_imagen', m.firma_imagen,
                 'ip_firma', host(m.ip_address), 'navegador_firma', m.user_agent,
                 'documento_path', m.documento_path,
                 -- 0c-1 (20261229120000): el texto canónico v2 y sus datos
                 'version_canonico', m.version_canonico,
                 'titular_documento', m.titular_documento, 'titular_direccion', m.titular_direccion,
                 'acreedor_cid', m.acreedor_cid, 'acreedor_nombre', m.acreedor_nombre)
               ORDER BY m.created_at)
          FROM public.mandatos_sepa m
         WHERE m.usuario_id = p_sujeto_id AND m.deleted_at IS NULL
           AND (v_self OR privado.es_responsable(m.centro_id))), '[]'::jsonb),

      -- Cobros de cada familia de la que es tutor (los dos tutores reciben lo mismo).
      'cobros_familia', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'id', f.id, 'creado_en', f.created_at, 'actualizado_en', f.updated_at, 'borrado_en', f.deleted_at, 'motivo_borrado', f.deleted_reason,
                 'familia', f.etiqueta, 'metodo_pago', f.metodo_pago,
                 -- 2c (2026-11-02, columnas-export.ts)
                 'metodo_pago_manual', f.metodo_pago_manual,
                 'recibos', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', r.created_at, 'actualizado_en', r.updated_at, 'borrado_en', r.deleted_at,
                            'id', r.id,
                            'anio', r.anio, 'mes', r.mes, 'estado', r.estado, 'metodo', r.metodo,
                            'total_centimos', r.total_centimos, 'es_esporadico', r.es_esporadico,
                            'concepto_esporadico', r.concepto_esporadico,
                            'fecha_envio_banco', r.fecha_envio_banco,
                            'fecha_devolucion', r.fecha_devolucion,
                            'cobro_forma', r.cobro_forma, 'cobro_fecha', r.cobro_fecha,
                            'cobro_nota', r.cobro_nota,
                            'cobro_importe_centimos', r.cobro_importe_centimos,
                            'devolucion_gastos_centimos', r.devolucion_gastos_centimos,
                            'devolucion_salida', r.devolucion_salida,
                            -- 20261215120000: la red del export (columnas-export.ts).
                            'regiro_de', r.devuelto_de_recibo_id,
                            'diferencia_de', r.diferencia_de_recibo_id,
                            'fecha_cobro_banco', r.fecha_cobro_banco,
                            'lineas', COALESCE((
                              SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', lr.created_at, 'arrastre_de_recibo_id', lr.arrastre_de_recibo_id, 'sobrante_de_desborde_id', lr.sobrante_de_desborde_id,
                                       'descripcion', lr.descripcion, 'cantidad', lr.cantidad,
                                       'precio_unitario_centimos', lr.precio_unitario_centimos,
                 -- 2c (2026-11-02, columnas-export.ts)
                 'origen', lr.origen,
                                       'importe_centimos', lr.importe_centimos)
                                     ORDER BY lr.created_at, lr.id)
                                FROM public.lineas_recibo lr
                               WHERE lr.recibo_id = r.id), '[]'::jsonb))
                          ORDER BY r.anio, r.mes, r.created_at)
                     FROM public.recibos r
                    WHERE r.familia_id = f.id AND r.deleted_at IS NULL), '[]'::jsonb),
                 'metodos_pago', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', mp.created_at, 'actualizado_en', mp.updated_at, 'borrado_en', mp.deleted_at,
                            'anio', mp.anio, 'mes', mp.mes, 'metodo', mp.metodo)
                          ORDER BY mp.anio, mp.mes)
                     FROM public.metodo_pago_familia mp
                    WHERE mp.familia_id = f.id AND mp.deleted_at IS NULL), '[]'::jsonb),
                 'conceptos_asignados', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', ac.created_at, 'actualizado_en', ac.updated_at, 'borrado_en', ac.deleted_at,
                 -- 2c (2026-11-02, columnas-export.ts)
                            'origen', ac.origen,
                            'concepto', cc.nombre, 'cantidad', ac.cantidad_default,
                            'importe_especial_centimos', ac.importe_override_centimos,
                            'porcentaje_especial_bp', ac.porcentaje_override_bp,
                            'vigencia_desde', ac.vigencia_desde,
                            'vigencia_hasta', ac.vigencia_hasta)
                          ORDER BY ac.created_at)
                     FROM public.asignacion_concepto ac
                     JOIN public.conceptos_cobro cc ON cc.id = ac.concepto_id
                    WHERE ac.familia_id = f.id AND ac.deleted_at IS NULL), '[]'::jsonb),
                 'beca_comedor_excesos', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'id', d.id, 'recibo_id', d.recibo_id, 'creado_en', d.created_at, 'actualizado_en', d.updated_at,
                            'anio', d.anio, 'mes', d.mes, 'origen', d.origen,
                            'cuota_total_centimos', d.cuota_total_centimos,
                            'beca_total_centimos', d.beca_total_centimos,
                            'exceso_centimos', d.exceso_centimos,
                            'estado', d.estado, 'via', d.via, 'resuelto_en', d.resuelto_at)
                          ORDER BY d.anio, d.mes)
                     FROM public.beca_comedor_desborde d
                    WHERE d.familia_id = f.id), '[]'::jsonb),
                 'beca_comedor_transferencias', COALESCE((
                   SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'recibo_id', bt.recibo_id, 'creado_en', bt.created_at, 'actualizado_en', bt.updated_at,
                            'anio', bt.anio, 'mes', bt.mes, 'origen', bt.origen,
                            'importe_centimos', bt.importe_centimos,
                            'estado', bt.estado, 'realizada_en', bt.realizada_at)
                          ORDER BY bt.anio, bt.mes)
                     FROM public.beca_comedor_transferencia bt
                    WHERE bt.familia_id = f.id), '[]'::jsonb))
               ORDER BY f.created_at)
          FROM public.familias f
         WHERE f.id IN (SELECT ft.familia_id FROM public.familia_tutores ft
                         WHERE ft.usuario_id = p_sujeto_id AND ft.deleted_at IS NULL)
           AND (v_self OR privado.es_responsable(f.centro_id))), '[]'::jsonb),

      -- Retención (PR-7): lo que se conserva por obligación legal y está bloqueado. No sale, y
      -- no se calla: qué es, cuánto y desde cuándo.
      'datos_bloqueados', privado.datos_bloqueados('usuario', p_sujeto_id, v_self),
      'consultas_datos_bloqueados', privado.consultas_datos_bloqueados('usuario', p_sujeto_id, v_self)
    );
  END IF;

  -- ---------------------------------------------------------------- NIÑO
  IF p_sujeto_tipo = 'nino' THEN
    v_centro := privado.centro_de_nino(p_sujeto_id);
    IF v_centro IS NULL THEN
      RAISE EXCEPTION 'no autorizado a exportar este sujeto'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
    v_admin := privado.es_responsable(v_centro);
    v_bloq  := privado.nino_bloqueado(p_sujeto_id);
    IF NOT v_admin AND NOT public.es_tutor_legal_de(p_sujeto_id) THEN
      RAISE EXCEPTION 'no autorizado a exportar este sujeto'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN jsonb_build_object(
      -- Su prospecto entero.
      'lista_espera', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'actualizado_en', le.updated_at,
                 'nombre_nino', le.nombre_nino, 'apellidos_nino', le.apellidos_nino,
                 'fecha_nacimiento', le.fecha_nacimiento, 'telefono_tutor', le.telefono_tutor,
                 'email_tutor', le.email_tutor, 'nota', le.nota, 'posicion', le.posicion,
                 'estado', le.estado, 'curso', ca.nombre, 'apuntado_en', le.created_at,
                 -- 2d (2026-11-02, columnas-export.ts)
                 'descartado_en', le.descartado_at)
               ORDER BY le.created_at)
          FROM public.lista_espera le
          LEFT JOIN public.cursos_academicos ca ON ca.id = le.curso_academico_id
         WHERE le.nino_id = p_sujeto_id), '[]'::jsonb),

      -- Sin motivo_baja. La familia, solo activa/baja (como get_recorrido_nino_familia).
      'matriculas', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', m.created_at, 'borrado_en', m.deleted_at,
                 'id', m.id, 'aula', a.nombre, 'curso', ca.nombre, 'estado', m.estado,
                 'fecha_alta', m.fecha_alta, 'fecha_baja', m.fecha_baja,
                 'activada_en', m.activada_at)
               ORDER BY ca.fecha_inicio, m.fecha_alta, m.id)
          FROM public.matriculas m
          JOIN public.aulas a ON a.id = m.aula_id
          JOIN public.cursos_academicos ca ON ca.id = m.curso_academico_id
         WHERE m.nino_id = p_sujeto_id AND m.deleted_at IS NULL
           AND (v_admin OR m.estado IN ('activa', 'baja'))), '[]'::jsonb),

      -- Por sujeto, no por quién firmó: sale también el que dio el otro tutor.
      'consentimientos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', c.created_at,
                 'tipo', c.tipo, 'version_texto', c.version, 'aceptado_en', c.aceptado_en,
                 'revocado_en', c.revocado_en, 'metodo_firma', c.metodo_firma,
                 'otorgado_por', u.nombre_completo)
               ORDER BY c.aceptado_en)
          FROM public.consentimientos c
          LEFT JOIN public.usuarios u ON u.id = c.usuario_id
         WHERE c.nino_id = p_sujeto_id AND NOT v_bloq
           AND NOT privado.usuario_olvidado_en(c.usuario_id, v_centro)), '[]'::jsonb),

      'acuses_alta', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'tipo', aa.tipo, 'metodo', aa.metodo, 'aceptado_en', aa.aceptado_en)
               ORDER BY aa.aceptado_en)
          FROM public.acuses_alta aa
         WHERE aa.nino_id = p_sujeto_id AND NOT v_bloq
           AND NOT (aa.firmante_id IS NOT NULL
                    AND privado.usuario_olvidado_en(aa.firmante_id, aa.centro_id))), '[]'::jsonb),

      'cambios_solicitados', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'entidad', cp.entidad, 'campo', cp.campo,
                 'valor_propuesto', cp.valor_propuesto, 'detalle', cp.payload,
                 'estado', cp.estado, 'solicitado_en', cp.created_at,
                 'decidido_en', cp.decided_at)
               ORDER BY cp.created_at)
          FROM public.cambios_pendientes cp
         WHERE cp.nino_id = p_sujeto_id), '[]'::jsonb),

      'fin_de_curso', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('curso', ca.nombre, 'registrado_en', rf.created_at)
               ORDER BY rf.created_at)
          FROM public.rollover_finaliza rf
          JOIN public.cursos_academicos ca ON ca.id = rf.curso_academico_id
         WHERE rf.nino_id = p_sujeto_id), '[]'::jsonb),

      'citas', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', ci.created_at, 'actualizado_en', ci.updated_at,
                 'titulo', ci.titulo, 'tipo', ci.tipo, 'fecha', ci.fecha,
                 'hora_inicio', ci.hora_inicio, 'hora_fin', ci.hora_fin, 'lugar', ci.lugar,
                 'descripcion', ci.descripcion, 'estado', ci.estado)
               ORDER BY ci.fecha, ci.hora_inicio)
          FROM public.citas ci
         WHERE ci.nino_id = p_sujeto_id), '[]'::jsonb),

      'eventos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'id', e.id, 'creado_en', e.created_at, 'actualizado_en', e.updated_at,
                 'titulo', e.titulo, 'tipo', e.tipo, 'fecha', e.fecha, 'fecha_fin', e.fecha_fin,
                 'hora_inicio', e.hora_inicio, 'hora_fin', e.hora_fin, 'lugar', e.lugar,
                 'descripcion', e.descripcion, 'estado', e.estado,
                 -- 2d (2026-11-02, columnas-export.ts)
                 'requiere_confirmacion', e.requiere_confirmacion)
               ORDER BY e.fecha, e.hora_inicio)
          FROM public.eventos e
         WHERE e.nino_id = p_sujeto_id), '[]'::jsonb),

      'confirmaciones_eventos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'evento_id', ce.evento_id, 'creado_en', ce.created_at, 'actualizado_en', ce.updated_at,
                 'evento', e.titulo, 'fecha_evento', e.fecha, 'estado', ce.estado,
                 'comentario', ce.comentario, 'confirmado_at', ce.confirmado_at)
               ORDER BY e.fecha)
          FROM public.confirmaciones_evento ce
          JOIN public.eventos e ON e.id = ce.evento_id
         WHERE ce.nino_id = p_sujeto_id), '[]'::jsonb),

      -- Los dirigidos a la familia sobre el niño; los del personal son trabajo del centro.
      'recordatorios', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', r.created_at, 'actualizado_en', r.updated_at,
                 'titulo', r.titulo, 'descripcion', r.descripcion,
                 'vencimiento', r.vencimiento, 'completado_en', r.completado_en,
                 -- 2d (2026-11-02, columnas-export.ts)
                 'erroneo', r.erroneo)
               ORDER BY r.created_at)
          FROM public.recordatorios r
         WHERE r.nino_id = p_sujeto_id AND r.destinatario = 'familia_individual'), '[]'::jsonb),

      'conceptos_asignados', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', ac.created_at, 'actualizado_en', ac.updated_at, 'borrado_en', ac.deleted_at,
                 -- 2c (2026-11-02, columnas-export.ts)
                 'origen', ac.origen,
                 'concepto', cc.nombre, 'cantidad', ac.cantidad_default,
                 'importe_especial_centimos', ac.importe_override_centimos,
                            'porcentaje_especial_bp', ac.porcentaje_override_bp,
                 'vigencia_desde', ac.vigencia_desde, 'vigencia_hasta', ac.vigencia_hasta)
               ORDER BY ac.created_at)
          FROM public.asignacion_concepto ac
          JOIN public.conceptos_cobro cc ON cc.id = ac.concepto_id
         WHERE ac.nino_id = p_sujeto_id AND ac.deleted_at IS NULL), '[]'::jsonb),

      'lineas_recibo', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', lr.created_at, 'beca_tramo_id', lr.beca_tramo_id,
                 'anio', r.anio, 'mes', r.mes, 'descripcion', lr.descripcion,
                 'cantidad', lr.cantidad, 'importe_centimos', lr.importe_centimos,
                 -- 2c (2026-11-02, columnas-export.ts)
                 'precio_unitario_centimos', lr.precio_unitario_centimos, 'origen', lr.origen)
               ORDER BY r.anio, r.mes, lr.created_at)
          FROM public.lineas_recibo lr
          JOIN public.recibos r ON r.id = lr.recibo_id
         WHERE lr.nino_id = p_sujeto_id AND r.deleted_at IS NULL), '[]'::jsonb),

      'servicios_diarios', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', ps.created_at, 'actualizado_en', ps.updated_at,
                 'fecha', ps.fecha, 'servicio', ps.servicio, 'presente', ps.presente)
               ORDER BY ps.fecha, ps.servicio)
          FROM public.parte_servicio_diario ps
         WHERE ps.nino_id = p_sujeto_id), '[]'::jsonb),

      'servicios_pedidos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', sp.created_at, 'actualizado_en', sp.updated_at,
                 -- 8b (2026-11-14): lo que la familia pidió para cada servicio, y el concepto por su nombre.
                 'servicio', sp.servicio, 'respuesta', sp.respuesta, 'concepto', cc.nombre)
               ORDER BY sp.servicio)
          FROM public.peticion_servicio sp
          LEFT JOIN public.conceptos_cobro cc ON cc.id = sp.concepto_id
         WHERE sp.nino_id = p_sujeto_id), '[]'::jsonb),

      'gastos_gestion', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', gg.created_at, 'actualizado_en', gg.updated_at,
                 -- Fase 9 (2026-11-16): el curso, cómo se pagó, el importe de este niño si Dirección lo
                 -- cambió y cuándo se marcó cobrado. El justificante es un fichero: se dice si está.
                 'curso', k.nombre, 'forma', gg.forma, 'importe_centimos', gg.importe_centimos,
                 'con_justificante', gg.justificante_path IS NOT NULL, 'cobrado_en', gg.cobrado_at)
               ORDER BY k.fecha_inicio)
          FROM public.gastos_gestion gg
          JOIN public.cursos_academicos k ON k.id = gg.curso_academico_id
         WHERE gg.nino_id = p_sujeto_id), '[]'::jsonb),

      'beca_comedor_elegibilidad', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', be.created_at, 'actualizado_en', be.updated_at,
                 'curso', ca.nombre, 'fecha_alta', be.fecha_alta,
                 'fecha_baja', be.fecha_baja, 'activa', be.activa)
               ORDER BY be.fecha_alta)
          FROM public.beca_comedor_elegibilidad be
          JOIN public.cursos_academicos ca ON ca.id = be.curso_academico_id
         WHERE be.nino_id = p_sujeto_id), '[]'::jsonb),

      'beca_comedor_tramos', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'id', bt.id, 'tramo_padre_id', bt.tramo_padre_id, 'creado_en', bt.created_at, 'actualizado_en', bt.updated_at,
                 'anio_correspondiente', bt.anio_correspondiente,
                 'mes_correspondiente', bt.mes_correspondiente,
                 'anio_aplicacion', bt.anio_aplicacion, 'mes_aplicacion', bt.mes_aplicacion,
                 'importe_centimos', bt.importe_centimos, 'estado', bt.estado,
                 'origen', bt.origen)
               ORDER BY bt.anio_correspondiente, bt.mes_correspondiente, bt.created_at)
          FROM public.beca_comedor_tramo bt
         WHERE bt.nino_id = p_sujeto_id), '[]'::jsonb),

      -- Sus peticiones de olvido, con su estado (las mismas columnas que en el usuario).
      'solicitudes_olvido', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 -- R1-R7 (2026-11-01, columnas-export.ts)
                 'creado_en', o.created_at,
                 'solicitado_en', o.solicitado_en, 'estado', o.estado,
                 'pedida_por_centro', o.pedida_por_centro, 'inmediato', o.inmediato,
                 'confirmada_en', o.confirmada_en, 'gracia_hasta', o.gracia_hasta,
                 'rechazada_en', o.rechazada_en, 'motivo_rechazo', o.motivo_rechazo,
                 'retirada_en', o.retirada_en, 'nota_centro', o.nota_centro,
                 'purgado_en', o.purgado_en,
                 -- 2d (2026-11-02, columnas-export.ts)
                 'por_plazo', o.por_plazo)
               ORDER BY o.solicitado_en)
          FROM public.olvido_solicitudes o
         WHERE o.sujeto_tipo = 'nino' AND o.sujeto_id = p_sujeto_id), '[]'::jsonb),

      -- Quién ha leído su ficha médica (20261128120000). El nombre, solo si es de la familia del
      -- niño; del personal del centro y del soporte, solo el rol (R4, 2026-11-01).
      'lecturas_ficha_medica', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'leida_en', l.leida_en, 'lector', u.nombre_completo, 'rol_lector', l.rol_lector,
                 'origen', l.origen, 'campos', l.campos)
               ORDER BY l.leida_en)
          FROM public.lecturas_ficha_medica l
          LEFT JOIN public.usuarios u ON u.id = l.lector_id
                                     AND l.rol_lector IN ('tutor_legal', 'autorizado')
         WHERE l.nino_id = p_sujeto_id AND NOT v_bloq), '[]'::jsonb),

      -- Retención (PR-7): lo que se conserva por obligación legal y está bloqueado.
      'datos_bloqueados', privado.datos_bloqueados('nino', p_sujeto_id, v_admin),
      'consultas_datos_bloqueados', privado.consultas_datos_bloqueados('nino', p_sujeto_id, true)
    );
  END IF;

  -- ------------------------------------------------------------------ TUTOR
  -- Fase 6 (20270118120000): un tutor SIN cuenta (el segundo, antes de aceptar la invitación) no es
  -- un usuario y no podía exportarse por ningún camino (medido el 2026-11-13). Lo exporta la
  -- Dirección de su centro, por el id de su fila en `familia_tutores`: su fila entera, y nada del otro
  -- tutor ni del niño (eso va por sus propios sujetos).
  IF p_sujeto_tipo = 'tutor' THEN
    SELECT f.centro_id INTO v_centro
      FROM public.familia_tutores ft JOIN public.familias f ON f.id = ft.familia_id
     WHERE ft.id = p_sujeto_id;
    IF v_centro IS NULL OR NOT privado.es_responsable(v_centro) THEN
      RAISE EXCEPTION 'no autorizado a exportar este sujeto'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    RETURN jsonb_build_object(
      'perfiles_familia', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'creado_en', ft.created_at, 'actualizado_en', ft.updated_at, 'borrado_en', ft.deleted_at,
                 'familia_id', ft.familia_id, 'rol_familia', ft.rol_familia,
                 'nombre_completo', ft.nombre_completo, 'email', ft.email,
                 'direccion_calle', ft.direccion_calle, 'direccion_numero', ft.direccion_numero,
                 'direccion_cp', ft.direccion_cp, 'direccion_ciudad', ft.direccion_ciudad,
                 'dni_documento_path', ft.dni_documento_path,
                 'telefono', ft.telefono, 'fecha_nacimiento', ft.fecha_nacimiento,
                 'dni_numero', ft.dni_numero, 'estudios', ft.estudios, 'empresa', ft.empresa))
          FROM public.familia_tutores ft
         WHERE ft.id = p_sujeto_id), '[]'::jsonb)
    );
  END IF;

  RAISE EXCEPTION 'tipo de sujeto inválido: %', p_sujeto_tipo
    USING ERRCODE = 'invalid_parameter_value';
END
$function$;
CREATE OR REPLACE FUNCTION public.audit_trigger_function()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_centro_id uuid;
  v_antes jsonb;
  v_despues jsonb;
  v_registro_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'centros' THEN
    v_centro_id := COALESCE((NEW).id, (OLD).id);
  ELSIF TG_TABLE_NAME = 'ninos' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'roles_usuario' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'dias_centro' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'plantillas_menu_mensual' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'menu_dia' THEN
    v_centro_id := privado.centro_de_plantilla(COALESCE((NEW).plantilla_id, (OLD).plantilla_id));
  ELSIF TG_TABLE_NAME = 'conversaciones' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'mensajes' THEN
    v_centro_id := public.centro_de_conversacion(COALESCE((NEW).conversacion_id, (OLD).conversacion_id));
  ELSIF TG_TABLE_NAME = 'anuncios' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'recordatorios' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'eventos' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'citas' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'cita_invitados' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'autorizaciones' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'firmas_autorizacion' THEN
    v_centro_id := privado.centro_de_nino(COALESCE((NEW).nino_id, (OLD).nino_id));
  ELSIF TG_TABLE_NAME = 'administraciones_medicacion' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'plantillas_informe' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'informes_evolucion' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'campanas_informe' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'publicaciones' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'media' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'media_etiquetas' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'aulas_curso' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME = 'lista_espera' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  -- ── F-3-A: rollover_finaliza (centro_id directo) ─────────────────────────
  ELSIF TG_TABLE_NAME = 'rollover_finaliza' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  -- ── F-2a: familias (centro_id directo) ───────────────────────────────────
  ELSIF TG_TABLE_NAME = 'familias' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  -- ── F-2a: familia_tutores (centro derivado de la familia) ────────────────
  ELSIF TG_TABLE_NAME = 'familia_tutores' THEN
    v_centro_id := privado.centro_de_familia(COALESCE((NEW).familia_id, (OLD).familia_id));
  ELSIF TG_TABLE_NAME IN (
    'conceptos_cobro',
    'tipos_beca',
    'asignacion_concepto',
    'becas',
    'metodo_pago_familia',
    'parte_servicio_diario',
    'cierre_mensual',
    'recibos',
    'lineas_recibo',
    'remesas',
    'recibos_remesa',
    -- ── B2: beca comedor v2 (centro_id directo) ────────────────────────────
    'beca_comedor_elegibilidad',
    'beca_comedor_tramo',
    'beca_comedor_desborde',
    'beca_comedor_transferencia',
    -- ── Serie de altas, 1b: los documentos del centro firmados ──────────────
    'firmas_documentos_centro',
    -- ── Fase 8b: la petición de servicios del alta ────────────────────────
    'peticion_servicio',
    -- ── Fase 9: los gastos de gestión ─────────────────────────────────────
    'gastos_gestion_curso', 'gastos_gestion'
  ) THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  ELSIF TG_TABLE_NAME IN (
    'info_medica_emergencia',
    'vinculos_familiares',
    'matriculas',
    'datos_pedagogicos_nino',
    'asistencias',
    'ausencias'
  ) THEN
    SELECT n.centro_id INTO v_centro_id
    FROM public.ninos n
    WHERE n.id = COALESCE((NEW).nino_id, (OLD).nino_id);
  ELSIF TG_TABLE_NAME = 'agendas_diarias' THEN
    v_centro_id := privado.centro_de_nino(COALESCE((NEW).nino_id, (OLD).nino_id));
  ELSIF TG_TABLE_NAME IN ('comidas', 'biberones', 'suenos', 'deposiciones') THEN
    v_centro_id := privado.centro_de_agenda(COALESCE((NEW).agenda_id, (OLD).agenda_id));
  END IF;

  -- ── Grupo 1 (PR A): tablas auditadas desde 20261011120000 ────────────────
  -- profes_aulas no tiene centro_id: se deriva del aula. Si el aula ya no está (DELETE en
  -- cascada al borrar el aula), del curso. usuarios no es de un centro: centro_id NULL.
  IF TG_TABLE_NAME = 'profes_aulas' THEN
    v_centro_id := COALESCE(
      privado.centro_de_aula(COALESCE((NEW).aula_id, (OLD).aula_id)),
      (SELECT ca.centro_id FROM public.cursos_academicos ca
        WHERE ca.id = COALESCE((NEW).curso_academico_id, (OLD).curso_academico_id)));
  ELSIF TG_TABLE_NAME IN (
    'aulas',
    'cursos_academicos',
    'tarifa_concepto_anio',
    'acuses_alta',
    'cambios_pendientes',
    'mandatos_sepa'
  ) THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  END IF;

  -- ── Grupo 1 (PR B): invitaciones (centro_id directo) ─────────────────────
  IF TG_TABLE_NAME = 'invitaciones' THEN
    v_centro_id := COALESCE((NEW).centro_id, (OLD).centro_id);
  END IF;

  v_antes   := CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END;
  v_despues := CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END;
  v_registro_id := COALESCE((NEW).id, (OLD).id);

  -- ── Grupo 1 (PR A): columnas que no entran en audit_log ──────────────────
  -- Nada entra en audit_log que la redacción de la purga RGPD no sepa limpiar.
  --   cambios_pendientes: el contenido del cambio (payload, valor_propuesto) lleva datos del
  --     niño (p. ej. la dirección) y acaba en la tabla real, que ya se audita.
  --   mandatos_sepa: el IBAN cifrado y la firma, y los datos del firmante que la purga no
  --     redacta en esta tabla (titular, nombre tecleado, IP, user agent).
  IF TG_TABLE_NAME = 'cambios_pendientes' THEN
    v_antes   := v_antes   - ARRAY['payload', 'valor_propuesto'];
    v_despues := v_despues - ARRAY['payload', 'valor_propuesto'];
  ELSIF TG_TABLE_NAME = 'mandatos_sepa' THEN
    v_antes   := v_antes   - ARRAY['iban_cifrado', 'firma_imagen', 'titular', 'nombre_tecleado',
                                   'ip_address', 'user_agent', 'titular_documento',
                                   'titular_direccion'];
    v_despues := v_despues - ARRAY['iban_cifrado', 'firma_imagen', 'titular', 'nombre_tecleado',
                                   'ip_address', 'user_agent', 'titular_documento',
                                   'titular_direccion'];
  ELSIF TG_TABLE_NAME = 'recibos' THEN
    -- recibos: la nota del cobro manual es texto libre de la directora, y la purga no redacta
    -- recibos (se conservan). La forma y la fecha del cobro sí entran.
    v_antes   := v_antes   - 'cobro_nota';
    v_despues := v_despues - 'cobro_nota';
  END IF;

  -- ── Grupo 1 (PR B): invitaciones sin token ───────────────────────────────
  IF TG_TABLE_NAME = 'invitaciones' THEN
    v_antes   := v_antes   - 'token';
    v_despues := v_despues - 'token';
  END IF;

  -- ── Retención (F11-B, punto 6): nada vive más en audit_log que en su tabla ──
  -- Un borrado por plazo o por olvido se lleva sus copias en audit_log: las anteriores (alta y
  -- cambios) y la que escribiría este DELETE. Lo pide la purga con
  -- set_config('app.borrar_sin_copia', 'on', true), y solo vale sin humano (auth.uid() NULL):
  -- con sesión, el DELETE se audita siempre. Las cascadas pasan por aquí fila a fila, así que
  -- también se llevan las suyas.
  -- TG_TABLE_NAME es `name`, de collation "C", y `::text` la conserva: comparado así con `tabla`
  -- el índice (tabla, registro_id) solo sirve para registro_id y recorre el índice entero en cada
  -- fila (~7 ms con 370 000 filas). Con COLLATE "default" va por clave exacta (0,05 ms).
  IF TG_OP = 'DELETE' AND auth.uid() IS NULL
     AND current_setting('app.borrar_sin_copia', true) = 'on' THEN
    DELETE FROM public.audit_log
     WHERE tabla = TG_TABLE_NAME::text COLLATE "default" AND registro_id = v_registro_id;
    RETURN OLD;
  END IF;

  -- ── Grupo 1 (PR B): actor_sistema ────────────────────────────────────────
  -- Solo sin humano (auth.uid() NULL): la etiqueta de app.audit_actor si empieza por
  -- 'system:' (la fijan las purgas con set_config(..., true)); si no la hay y el rol es
  -- service_role, 'system:service_role'. Con sesión humana nunca se rellena.
  INSERT INTO public.audit_log
    (tabla, registro_id, accion, usuario_id, valores_antes, valores_despues, centro_id, actor_sistema)
  VALUES
    (TG_TABLE_NAME, v_registro_id, TG_OP::public.audit_accion, auth.uid(), v_antes, v_despues, v_centro_id,
     CASE WHEN auth.uid() IS NULL THEN
       CASE
         WHEN current_setting('app.audit_actor', true) LIKE 'system:%'
              AND char_length(current_setting('app.audit_actor', true)) <= 100
           THEN current_setting('app.audit_actor', true)
         WHEN auth.role() = 'service_role' THEN 'system:service_role'
       END
     END);

  RETURN COALESCE(NEW, OLD);
END;
$function$;
CREATE OR REPLACE FUNCTION public._claves_pii_nino(p_tabla text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT ARRAY[
    'nombre', 'apellidos', 'fecha_nacimiento', 'sexo', 'nacionalidad', 'foto_url', 'notas_admin',
    'alergias_graves', 'notas_emergencia', 'medicacion_habitual', 'alergias_leves',
    'medico_familia', 'telefono_emergencia',
    'ip_address', 'user_agent', 'descripcion_parentesco', 'nombre_externo', 'observaciones',
    'observaciones_generales', 'contenido', 'nombre_tecleado'
  ]::text[] || CASE p_tabla
    WHEN 'ninos' THEN ARRAY['idioma_principal', 'direccion_calle', 'direccion_numero', 'direccion_cp',
                            'direccion_ciudad', 'libro_familia_path', 'estado_civil_familia',
                            'primer_apellido', 'segundo_apellido', 'lugar_nacimiento', 'dni',
                            'hermanos_total', 'hermanos_lugar', 'direccion_provincia',
                            'observaciones_familia', 'como_nos_conocio', 'como_nos_conocio_otro',
                            'sip', 'sip_documento_path', 'fecha_incorporacion']
    WHEN 'datos_pedagogicos_nino' THEN ARRAY['lactancia_observaciones', 'control_esfinteres_observaciones',
                            'siesta_horario_habitual', 'siesta_observaciones',
                            'alimentacion_observaciones', 'idiomas_casa']
    WHEN 'matriculas' THEN ARRAY['motivo_baja']
    -- Fase 9: la ruta del justificante, como la de la tarjeta sanitaria.
    WHEN 'gastos_gestion' THEN ARRAY['justificante_path']
    WHEN 'firmas_autorizacion' THEN ARRAY['firma_imagen', 'comentario', 'datos']
    WHEN 'firmas_documentos_centro' THEN ARRAY['firma_imagen']
    WHEN 'autorizaciones' THEN ARRAY['titulo', 'texto', 'datos']
    WHEN 'cita_invitados' THEN ARRAY['comentario']
    WHEN 'lista_espera' THEN ARRAY['nombre_nino', 'apellidos_nino', 'primer_apellido_nino',
                                   'segundo_apellido_nino', 'telefono_tutor', 'email_tutor', 'nota']
    ELSE ARRAY[]::text[]
  END;
$function$;
-- ---- Guarda posterior ----
DO $guarda$
DECLARE
  v_n int;
  v_t text;
BEGIN
  -- Las dos tablas con RLS, sin escritura de la sesión.
  FOREACH v_t IN ARRAY ARRAY['public.gastos_gestion', 'public.gastos_gestion_curso'] LOOP
    IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = v_t::regclass) THEN
      RAISE EXCEPTION '% sin RLS', v_t;
    END IF;
    IF has_table_privilege('authenticated', v_t, 'INSERT') OR has_table_privilege('authenticated', v_t, 'UPDATE')
       OR has_table_privilege('authenticated', v_t, 'DELETE') THEN
      RAISE EXCEPTION 'la sesión escribe en %', v_t;
    END IF;
    SELECT count(*) INTO v_n FROM pg_trigger WHERE tgrelid = v_t::regclass AND tgname = 'zz_centro_coherente';
    IF v_n <> 1 THEN
      RAISE EXCEPTION '% sin zz_centro_coherente', v_t;
    END IF;
  END LOOP;
  -- El bucket, privado, con PDF e imágenes, y sus cuatro políticas.
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'justificantes-gestion' AND NOT public
                  AND allowed_mime_types @> ARRAY['application/pdf', 'image/jpeg']) THEN
    RAISE EXCEPTION 'el bucket justificantes-gestion no es el esperado';
  END IF;
  SELECT count(*) INTO v_n FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
     AND policyname LIKE 'justificantes_gestion_%';
  IF v_n <> 4 THEN
    RAISE EXCEPTION 'el bucket tiene % políticas, no 4', v_n;
  END IF;
  -- Cada pieza, en su cuerpo vivo.
  IF position('gastos_gestion' IN (SELECT prosrc FROM pg_proc WHERE oid = 'privado.purgar_nino(uuid)'::regprocedure)) = 0
     OR position('''gastos_gestion''' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.export_datos_sujeto(text,uuid)'::regprocedure)) = 0
     OR position('''gastos_gestion''' IN (SELECT prosrc FROM pg_proc WHERE oid = 'public.audit_trigger_function()'::regprocedure)) = 0
     OR NOT ('justificante_path' = ANY (public._claves_pii_nino('gastos_gestion')))
     OR 'justificante_path' = ANY (public._claves_pii_nino('ninos')) THEN
    RAISE EXCEPTION 'falta alguna pieza en la purga, el export, la auditoría o su redacción';
  END IF;
  -- Las funciones nuevas, para la sesión; las de privado, para nadie.
  IF NOT has_function_privilege('authenticated', 'public.declarar_gastos_gestion(uuid,uuid,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.gastos_gestion_pendientes(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.gastos_gestion_nino(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'privado.gastos_del_nino(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'los permisos de las funciones no son los esperados';
  END IF;
  -- La cola: la ruta de otro niño no entra; una imagen del propio, sí (se comprueba la expresión).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cambios_pendientes_ruta_documento_del_nino'
                  AND pg_get_constraintdef(oid) LIKE '%gastos_gestion%') THEN
    RAISE EXCEPTION 'la cola no conoce la ruta del justificante';
  END IF;
END $guarda$;
