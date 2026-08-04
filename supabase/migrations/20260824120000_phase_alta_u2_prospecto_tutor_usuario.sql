-- =============================================================================
-- Alta unificada · U-2 — el 2.º hijo de familia existente nace como PROSPECTO
--
-- Problema que cierra: "Añadir hijo a familia existente" creaba niño + matrícula
-- DIRECTAMENTE (RPC `crear_o_anadir_a_familia`), saltándose `lista_espera` → el alumno
-- no aparecía en admisiones (así se perdió un alumno real). A partir de U-2 esa vía crea
-- un PROSPECTO como cualquier otro alumno, y la promoción (Invitar / Completar) es la
-- única puerta que crea niño+matrícula.
--
-- D1 (decisión cerrada): el prospecto de 2.º hijo guarda el `usuario_id` del tutor
-- EXISTENTE, no solo su email. El email ya viaja en `email_tutor`, pero es una pista
-- ambigua: la detección por email (`buscar_auth_user_por_email`, FIX B #261) puede fallar
-- si la dirección teclea otro email, si el tutor lo cambió, o si hay homónimos. Con el
-- `usuario_id` la vinculación al promover es EXACTA y no depende de re-teclear nada.
--
-- ADITIVA y retrocompatible: columna NULLABLE. `tutor_usuario_id IS NULL` = prospecto
-- normal (1.er hijo / familia nueva) → sigue el flujo de siempre (crea tutor). Los
-- prospectos ya existentes quedan intactos con NULL.
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor (CLI SIGILL).
-- Tras aplicar: registrar en supabase_migrations.schema_migrations y `npm run db:types`.
-- =============================================================================
BEGIN;

-- ─── 1. Columna D1 ───────────────────────────────────────────────────────────
-- ON DELETE SET NULL (no CASCADE): si la cuenta del tutor se elimina, el prospecto NO
-- debe desaparecer de admisiones — degrada a prospecto normal (la promoción volverá a
-- resolver por email). Perder la pista es aceptable; perder al alumno de la cola no.
ALTER TABLE public.lista_espera
  ADD COLUMN IF NOT EXISTS tutor_usuario_id uuid NULL
    REFERENCES public.usuarios(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.lista_espera.tutor_usuario_id IS
  'U-2/D1: cuenta del tutor EXISTENTE cuando el prospecto es un 2.º hijo (vía "añadir hijo a familia existente"). NULL = prospecto normal (familia nueva) → al promover se crea el tutor. Con valor, la promoción vincula el niño a la familia de ESE usuario en el centro del prospecto, sin depender del email.';

-- Índice parcial: solo los prospectos de 2.º hijo (minoría) — sirve a "¿tiene este tutor
-- prospectos pendientes?" sin cargar con las filas NULL, que son la mayoría.
CREATE INDEX IF NOT EXISTS idx_lista_espera_tutor_usuario
  ON public.lista_espera (tutor_usuario_id)
  WHERE tutor_usuario_id IS NOT NULL;

-- ─── 2. RLS: sin cambios (deliberado) ────────────────────────────────────────
-- `lista_espera_admin_all` (FOR ALL USING es_admin(centro_id)) sigue siendo la única
-- policy y sigue gobernando por centro: la columna nueva no abre ni cierra acceso, y el
-- prospecto se sigue leyendo/escribiendo solo por admin de SU centro.
--
-- Coherencia de centro tutor↔prospecto: NO se enforza en BD a propósito. Un CHECK no
-- puede llevar subquery, y un trigger de validación cross-tabla sería la primera
-- excepción de ese tipo en el esquema. Se garantiza server-side, donde ya se hacía lo
-- mismo para la familia: la action exige admin del centro actual y comprueba
-- `familia.centro_id = centroId` antes de resolver el tutor, así que el `usuario_id`
-- guardado pertenece por construcción a una familia de ESE centro. Al promover se
-- vuelve a acotar por centro (la RPC `crear_o_anadir_a_familia` resuelve la familia
-- SOLO dentro de `p_centro_id`), de modo que un valor incoherente no cruzaría centros:
-- crearía familia nueva en el centro del prospecto.

COMMIT;
