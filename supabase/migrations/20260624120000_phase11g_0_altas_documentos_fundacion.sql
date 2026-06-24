-- =============================================================================
-- Fase 11-G-0 — "Altas con documentos" · Fundación (capa de datos + Storage)
-- =============================================================================
-- ADITIVA: solo CREATE TYPE / CREATE TABLE / ADD COLUMN / CREATE bucket+policies /
-- CREATE FUNCTION+TRIGGER. NUNCA drop+recreate de objetos vivos. Sustituye el alta
-- tutor-driven (F11-P) por un alta de 8 pasos con documentos. SIN UI ni acciones
-- (eso es G-1..G-4). Fuente de verdad: decisiones A–J cerradas por el responsable
-- (2026-06-24), recogidas en memoria del proyecto (project_nido_f11g_altas_documentos).
--
-- DECISIONES DE MODELADO (confirmadas por el responsable sobre las 5 abiertas):
--  1. Documentos anclados en {ninoId} (no {usuarioId}): el tutor 1 (es_tutor_legal_de)
--     sube su DNI, el del tutor 2 pendiente y el libro de familia; admin + tutor legal
--     leen; profes NO (no son admin ni tutor legal). Resuelve el tutor 2 sin cuenta (D-a).
--  2. El DNI del tutor vive como columna (dni_documento_path) de datos_tutor, no en
--     tabla aparte (decisión C cumplida como columna; evita 2 tablas con la misma clave).
--  3. estado_civil_familia + dirección "de familia" cuelgan de ninos (no hay entidad
--     "familia"; el niño es el ancla del alta). RIESGO ACEPTADO: si la directora edita
--     en un solo hermano puede divergir; la UI de G-1 PROPAGA al editar (decisión G-1).
--  4. La firma del mandato SEPA es AUTO-CONTENIDA en mandatos_sepa (columnas espejo de
--     firmas_autorizacion), SIN tocar el enum tipo_autorizacion ni el CHECK de 5 formas
--     de F8 (menor riesgo en aditiva). El trazo se captura reusando el componente de F8.
--  5. Los audit triggers de las tablas nuevas se DIFIEREN a G-1/G-2 (donde aterrizan las
--     escrituras): reproducir audit_trigger_function entera a ciegas es el punto más
--     frágil y, sin escrituras en G-0, es funcionalmente equivalente añadirlos al llegar.
--  + cambios_pendientes (decisión J) entra YA en G-0 con MODELO SIMPLE anclado en nino:
--     CREATE TABLE + RLS, sin lógica (se refina en G-3).
--
-- Buckets (3, PRIVADOS, application/pdf): libro-familia, dni-tutores, mandato-sepa.
--   Ruta {centroId}/{ninoId}/...  → [1]=centroId, [2]=ninoId.
--   Acceso: SELECT/INSERT/UPDATE = es_admin([1]) OR es_tutor_legal_de([2]); DELETE = es_admin.
--   "Previsualizar-no-descargar" del tutor se resuelve en capa app (disposition de la URL
--   firmada que genera el server), no en RLS.
--
-- Gotcha MVCC: las SELECT policies de las tablas nuevas usan es_admin(centro_id) y
-- es_tutor_legal_de(nino_id), que leen OTRAS tablas (roles_usuario / vinculos_familiares),
-- nunca la tabla insertada → INSERT…RETURNING seguro, sin helper row-aware (ADR-0007 + §MVCC).
--
-- Operación sobre esquema productivo → se aplica MANUALMENTE por SQL Editor (CLI con bug
-- SIGILL). Tras aplicarla: registrar la versión en supabase_migrations.schema_migrations y
-- regenerar src/types/database.ts (`npm run db:types`).
-- =============================================================================
BEGIN;

-- ─── 1. ENUMs nuevos ─────────────────────────────────────────────────────────
CREATE TYPE public.estado_civil AS ENUM (
  'casados', 'separados', 'divorciados', 'pareja_de_hecho', 'soltero', 'viudo'
);

CREATE TYPE public.estado_mandato_sepa AS ENUM ('activo', 'revocado');

CREATE TYPE public.estado_cambio_pendiente AS ENUM ('pendiente', 'aprobado', 'rechazado');

-- ─── 2. Helper: derivar centro_id desde el niño (BEFORE INSERT) ───────────────
-- centro_id es redundante (para RLS simple) y se deriva siempre del niño → fuente
-- única de verdad. Compartido por las 3 tablas nuevas (todas llevan nino_id + centro_id).
CREATE OR REPLACE FUNCTION public.derivar_centro_id_de_nino()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.centro_id := public.centro_de_nino(NEW.nino_id);
  RETURN NEW;
END $$;

-- ─── 3. ninos: dirección del menor + libro de familia + estado civil de familia ─
ALTER TABLE public.ninos
  ADD COLUMN direccion_calle    text NULL,
  ADD COLUMN direccion_numero   text NULL,
  ADD COLUMN direccion_cp       text NULL,
  ADD COLUMN direccion_ciudad   text NULL,
  ADD COLUMN libro_familia_path text NULL,
  ADD COLUMN estado_civil_familia public.estado_civil NULL;

ALTER TABLE public.ninos
  ADD CONSTRAINT ninos_direccion_longitudes CHECK (
    (direccion_calle  IS NULL OR char_length(direccion_calle)  <= 200) AND
    (direccion_numero IS NULL OR char_length(direccion_numero) <= 20)  AND
    (direccion_cp     IS NULL OR char_length(direccion_cp)     <= 12)  AND
    (direccion_ciudad IS NULL OR char_length(direccion_ciudad) <= 120)
  );

COMMENT ON COLUMN public.ninos.libro_familia_path IS
  'F11-G: ruta del PDF en el bucket privado libro-familia ({centroId}/{ninoId}/...). 1 PDF/niño (decisión B). Se firma para mostrar.';
COMMENT ON COLUMN public.ninos.estado_civil_familia IS
  'F11-G: estado civil de la familia (1 valor por familia, decisión F). Ancla en el niño al no existir entidad familia; la UI de G-1 propaga entre hermanos al editar.';

-- ─── 4. datos_tutor: una fila por tutor del alta (identidad + dirección + DNI) ──
-- Maneja tutor 1 (registrado: usuario_id NOT NULL) y tutor 2 pendiente (usuario_id NULL,
-- email/nombre que teclea el tutor 1; se enlaza al aceptar la invitación en G-3).
CREATE TABLE public.datos_tutor (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id          uuid NOT NULL REFERENCES public.centros(id) ON DELETE CASCADE,
  nino_id            uuid NOT NULL REFERENCES public.ninos(id)   ON DELETE CASCADE,
  tipo_vinculo       public.tipo_vinculo NOT NULL,
  usuario_id         uuid NULL REFERENCES public.usuarios(id)    ON DELETE SET NULL,
  email              text NULL,
  nombre_completo    text NULL,
  direccion_calle    text NULL,
  direccion_numero   text NULL,
  direccion_cp       text NULL,
  direccion_ciudad   text NULL,
  dni_documento_path text NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  deleted_at         timestamptz NULL,
  CONSTRAINT datos_tutor_tipo_vinculo_legal CHECK (
    tipo_vinculo IN ('tutor_legal_principal', 'tutor_legal_secundario')
  ),
  CONSTRAINT datos_tutor_longitudes CHECK (
    (email           IS NULL OR char_length(email)           <= 255) AND
    (nombre_completo IS NULL OR char_length(nombre_completo) BETWEEN 2 AND 120) AND
    (direccion_calle  IS NULL OR char_length(direccion_calle)  <= 200) AND
    (direccion_numero IS NULL OR char_length(direccion_numero) <= 20)  AND
    (direccion_cp     IS NULL OR char_length(direccion_cp)     <= 12)  AND
    (direccion_ciudad IS NULL OR char_length(direccion_ciudad) <= 120)
  )
);

-- Un registro por tutor (principal/secundario) y niño, ignorando soft-deleted.
CREATE UNIQUE INDEX idx_datos_tutor_nino_vinculo
  ON public.datos_tutor (nino_id, tipo_vinculo)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE public.datos_tutor IS
  'F11-G: datos del tutor en el alta (identidad + dirección + ruta del DNI en bucket dni-tutores). usuario_id NULL = tutor 2 pendiente de invitación (D-a). DNI como columna, no tabla aparte (decisión C).';

CREATE TRIGGER datos_tutor_set_centro_id
  BEFORE INSERT ON public.datos_tutor
  FOR EACH ROW EXECUTE FUNCTION public.derivar_centro_id_de_nino();
CREATE TRIGGER datos_tutor_set_updated_at
  BEFORE UPDATE ON public.datos_tutor
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.datos_tutor ENABLE ROW LEVEL SECURITY;

CREATE POLICY datos_tutor_select ON public.datos_tutor
  FOR SELECT TO authenticated
  USING (public.es_admin(centro_id) OR public.es_tutor_legal_de(nino_id));
CREATE POLICY datos_tutor_insert ON public.datos_tutor
  FOR INSERT TO authenticated
  WITH CHECK (public.es_admin(centro_id) OR public.es_tutor_legal_de(nino_id));
CREATE POLICY datos_tutor_update ON public.datos_tutor
  FOR UPDATE TO authenticated
  USING (public.es_admin(centro_id) OR public.es_tutor_legal_de(nino_id))
  WITH CHECK (public.es_admin(centro_id) OR public.es_tutor_legal_de(nino_id));
-- DELETE: sin policy → default DENY (baja = soft delete con deleted_at vía UPDATE).

-- ─── 5. mandatos_sepa: IBAN + mandato firmado (preparado para fase B) ──────────
CREATE TABLE public.mandatos_sepa (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id             uuid NOT NULL REFERENCES public.centros(id)  ON DELETE CASCADE,
  nino_id               uuid NOT NULL REFERENCES public.ninos(id)    ON DELETE CASCADE,
  usuario_id            uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  identificador_mandato text NOT NULL,
  iban                  text NOT NULL,
  titular               text NOT NULL,
  documento_path        text NULL,
  estado                public.estado_mandato_sepa NOT NULL DEFAULT 'activo',
  -- Firma auto-contenida (espejo de firmas_autorizacion; decisión 4). Append-only de hecho:
  -- revocar = estado='revocado' + fila/mandato nuevo; no se mutan los campos de firma.
  firma_imagen          text NULL,
  nombre_tecleado       text NULL,
  texto_hash            text NULL,
  ip_address            inet NULL,
  user_agent            text NULL,
  fecha_firma           timestamptz NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz NULL,
  CONSTRAINT mandatos_sepa_identificador_unico UNIQUE (identificador_mandato),
  CONSTRAINT mandatos_sepa_longitudes CHECK (
    char_length(identificador_mandato) BETWEEN 1 AND 80 AND
    char_length(iban)    BETWEEN 15 AND 34 AND
    char_length(titular) BETWEEN 1 AND 140 AND
    (firma_imagen    IS NULL OR char_length(firma_imagen)    <= 500000) AND
    (nombre_tecleado IS NULL OR char_length(nombre_tecleado) <= 140)    AND
    (texto_hash      IS NULL OR texto_hash ~ '^[0-9a-f]{64}$')
  )
);

COMMENT ON TABLE public.mandatos_sepa IS
  'F11-G: mandato SEPA por tutor (IBAN + identificador NIDO-{centroCorto}-{tutorCorto}-{ts} + firma con trazo). documento_path = PDF en bucket mandato-sepa. Preparada para que la fase B (pain.008.001.02 + cuotas) consuma identificador_mandato. IBAN en claro (no es categoría especial; solo salud se cifra, ADR-0004).';

CREATE TRIGGER mandatos_sepa_set_centro_id
  BEFORE INSERT ON public.mandatos_sepa
  FOR EACH ROW EXECUTE FUNCTION public.derivar_centro_id_de_nino();
CREATE TRIGGER mandatos_sepa_set_updated_at
  BEFORE UPDATE ON public.mandatos_sepa
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.mandatos_sepa ENABLE ROW LEVEL SECURITY;

CREATE POLICY mandatos_sepa_select ON public.mandatos_sepa
  FOR SELECT TO authenticated
  USING (public.es_admin(centro_id) OR public.es_tutor_legal_de(nino_id));
CREATE POLICY mandatos_sepa_insert ON public.mandatos_sepa
  FOR INSERT TO authenticated
  WITH CHECK (
    (public.es_admin(centro_id) OR public.es_tutor_legal_de(nino_id))
    AND usuario_id = auth.uid()
  );
CREATE POLICY mandatos_sepa_update ON public.mandatos_sepa
  FOR UPDATE TO authenticated
  USING (public.es_admin(centro_id) OR public.es_tutor_legal_de(nino_id))
  WITH CHECK (public.es_admin(centro_id) OR public.es_tutor_legal_de(nino_id));
-- DELETE: sin policy → default DENY.

-- ─── 6. cambios_pendientes: cola genérica de edición→validación (decisión J) ──
-- MODELO SIMPLE en G-0 (sin lógica): la generalización fina y la cola /admin/pendientes
-- + badge se refinan en G-3. Anclado en nino para RLS coherente (admin del centro;
-- tutor legal del niño afectado).
CREATE TABLE public.cambios_pendientes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id       uuid NOT NULL REFERENCES public.centros(id)  ON DELETE CASCADE,
  nino_id         uuid NOT NULL REFERENCES public.ninos(id)    ON DELETE CASCADE,
  entidad         text NOT NULL,
  registro_id     uuid NOT NULL,
  campo           text NULL,
  payload         jsonb NULL,
  valor_propuesto jsonb NULL,
  estado          public.estado_cambio_pendiente NOT NULL DEFAULT 'pendiente',
  solicitado_por  uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE RESTRICT,
  revisado_por    uuid NULL REFERENCES public.usuarios(id)     ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  decided_at      timestamptz NULL,
  CONSTRAINT cambios_pendientes_entidad_longitud CHECK (char_length(entidad) BETWEEN 1 AND 60),
  CONSTRAINT cambios_pendientes_campo_o_payload CHECK (campo IS NOT NULL OR payload IS NOT NULL),
  CONSTRAINT cambios_pendientes_decision_coherente CHECK (
    (estado = 'pendiente' AND decided_at IS NULL AND revisado_por IS NULL) OR
    (estado <> 'pendiente' AND decided_at IS NOT NULL AND revisado_por IS NOT NULL)
  )
);

CREATE INDEX idx_cambios_pendientes_cola
  ON public.cambios_pendientes (centro_id) WHERE estado = 'pendiente';

COMMENT ON TABLE public.cambios_pendientes IS
  'F11-G (decisión J): cola genérica de ediciones del tutor pendientes de validación por la directora. Modelo simple en G-0; cola /admin/pendientes + badge in-app (sin push/email) se construyen en G-3.';

CREATE TRIGGER cambios_pendientes_set_centro_id
  BEFORE INSERT ON public.cambios_pendientes
  FOR EACH ROW EXECUTE FUNCTION public.derivar_centro_id_de_nino();

ALTER TABLE public.cambios_pendientes ENABLE ROW LEVEL SECURITY;

-- Lectura: admin del centro + tutor legal del niño afectado (ve el estado de lo que pidió).
CREATE POLICY cambios_pendientes_select ON public.cambios_pendientes
  FOR SELECT TO authenticated
  USING (public.es_admin(centro_id) OR public.es_tutor_legal_de(nino_id));
-- Escritura: el tutor legal solicita (anti-suplantación: solicitado_por = auth.uid()).
CREATE POLICY cambios_pendientes_insert ON public.cambios_pendientes
  FOR INSERT TO authenticated
  WITH CHECK (public.es_tutor_legal_de(nino_id) AND solicitado_por = auth.uid());
-- Decisión (aprobar/rechazar): solo admin del centro.
CREATE POLICY cambios_pendientes_update ON public.cambios_pendientes
  FOR UPDATE TO authenticated
  USING (public.es_admin(centro_id))
  WITH CHECK (public.es_admin(centro_id));
-- DELETE: sin policy → default DENY.

-- ─── 7. Buckets de Storage (3 PRIVADOS, application/pdf, ≤10 MB) ──────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('libro-familia', 'libro-familia', false, 10485760, ARRAY['application/pdf']),
  ('dni-tutores',   'dni-tutores',   false, 10485760, ARRAY['application/pdf']),
  ('mandato-sepa',  'mandato-sepa',  false, 10485760, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;

-- Rutas {centroId}/{ninoId}/...  → [1]=centroId, [2]=ninoId. Acceso idéntico en los 3:
-- leer/subir/sustituir = admin del centro o tutor legal del niño; borrar = admin.
-- Profes quedan fuera (no son admin ni tutor legal). El tutor "previsualiza lo suyo"
-- (SELECT); descargar-no se enforza en capa app (disposition de la URL firmada).

-- libro-familia --------------------------------------------------------------
CREATE POLICY "libro_familia_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'libro-familia'
    AND (
      public.es_admin(((storage.foldername(name))[1])::uuid)
      OR public.es_tutor_legal_de(((storage.foldername(name))[2])::uuid)
    )
  );
CREATE POLICY "libro_familia_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'libro-familia'
    AND (
      public.es_admin(((storage.foldername(name))[1])::uuid)
      OR public.es_tutor_legal_de(((storage.foldername(name))[2])::uuid)
    )
  );
CREATE POLICY "libro_familia_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'libro-familia'
    AND (
      public.es_admin(((storage.foldername(name))[1])::uuid)
      OR public.es_tutor_legal_de(((storage.foldername(name))[2])::uuid)
    )
  )
  WITH CHECK (
    bucket_id = 'libro-familia'
    AND (
      public.es_admin(((storage.foldername(name))[1])::uuid)
      OR public.es_tutor_legal_de(((storage.foldername(name))[2])::uuid)
    )
  );
CREATE POLICY "libro_familia_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'libro-familia'
    AND public.es_admin(((storage.foldername(name))[1])::uuid)
  );

-- dni-tutores ----------------------------------------------------------------
CREATE POLICY "dni_tutores_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'dni-tutores'
    AND (
      public.es_admin(((storage.foldername(name))[1])::uuid)
      OR public.es_tutor_legal_de(((storage.foldername(name))[2])::uuid)
    )
  );
CREATE POLICY "dni_tutores_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'dni-tutores'
    AND (
      public.es_admin(((storage.foldername(name))[1])::uuid)
      OR public.es_tutor_legal_de(((storage.foldername(name))[2])::uuid)
    )
  );
CREATE POLICY "dni_tutores_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'dni-tutores'
    AND (
      public.es_admin(((storage.foldername(name))[1])::uuid)
      OR public.es_tutor_legal_de(((storage.foldername(name))[2])::uuid)
    )
  )
  WITH CHECK (
    bucket_id = 'dni-tutores'
    AND (
      public.es_admin(((storage.foldername(name))[1])::uuid)
      OR public.es_tutor_legal_de(((storage.foldername(name))[2])::uuid)
    )
  );
CREATE POLICY "dni_tutores_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'dni-tutores'
    AND public.es_admin(((storage.foldername(name))[1])::uuid)
  );

-- mandato-sepa ---------------------------------------------------------------
CREATE POLICY "mandato_sepa_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'mandato-sepa'
    AND (
      public.es_admin(((storage.foldername(name))[1])::uuid)
      OR public.es_tutor_legal_de(((storage.foldername(name))[2])::uuid)
    )
  );
CREATE POLICY "mandato_sepa_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'mandato-sepa'
    AND (
      public.es_admin(((storage.foldername(name))[1])::uuid)
      OR public.es_tutor_legal_de(((storage.foldername(name))[2])::uuid)
    )
  );
CREATE POLICY "mandato_sepa_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'mandato-sepa'
    AND (
      public.es_admin(((storage.foldername(name))[1])::uuid)
      OR public.es_tutor_legal_de(((storage.foldername(name))[2])::uuid)
    )
  )
  WITH CHECK (
    bucket_id = 'mandato-sepa'
    AND (
      public.es_admin(((storage.foldername(name))[1])::uuid)
      OR public.es_tutor_legal_de(((storage.foldername(name))[2])::uuid)
    )
  );
CREATE POLICY "mandato_sepa_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'mandato-sepa'
    AND public.es_admin(((storage.foldername(name))[1])::uuid)
  );

COMMIT;
