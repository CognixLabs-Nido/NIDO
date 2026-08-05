-- =============================================================================
-- Alta unificada · U-4 — admisiones sin callejones: el prospecto recuerda SU niño
--
-- Problema que cierra (D4): al promover un prospecto (Invitar / Completar) se marcaba
-- `estado='invitado'` y ahí se acababa la pista. La lista de admisiones solo ofrece acciones
-- a los `en_espera`, así que un prospecto YA promovido cuya alta se quedó a medias se volvía
-- MUDO: sin botones, sin forma de reanudar el wizard, sin ver en qué punto estaba. Prospectos
-- atascados y sin acción posible.
--
-- Para poder pintar el estado real de la matrícula y ofrecer "Reanudar alta" hace falta saber
-- QUÉ niño salió de QUÉ prospecto, y ese enlace no existía en ninguna parte: `lista_espera` no
-- tenía `nino_id` ni equivalente. Esta migración lo añade.
--
-- Por qué columna y no derivarlo: se podría casar prospecto↔niño por
-- (centro, nombre, apellidos, fecha_nacimiento) —es la clave anti-colisión que ya usa
-- `crear_o_anadir_a_familia`— y hoy resolvería sin ambigüedad. Pero el wizard deja al tutor
-- EDITAR apellidos y fecha del menor, así que el match se rompe precisamente en el estado
-- "alta en curso" que el badge quiere mostrar. Mismo criterio que U-2/D1 con
-- `tutor_usuario_id`: guardar el id exacto en vez de adivinarlo después.
--
-- ADITIVA y retrocompatible: columna NULLABLE. `nino_id IS NULL` = prospecto sin promover
-- (o promoción anterior a U-4 no reconstruible) → la lista sigue ofreciendo Invitar/Completar,
-- que es la acción correcta para ese caso.
--
-- Operación sobre esquema productivo → la aplica el responsable por SQL Editor (CLI SIGILL).
-- Tras aplicar: registrar en supabase_migrations.schema_migrations y `npm run db:types`.
-- =============================================================================
BEGIN;

-- ─── 1. El enlace ────────────────────────────────────────────────────────────
-- ON DELETE SET NULL (no CASCADE): si el niño se borra, el prospecto NO debe desaparecer de
-- admisiones — degrada a prospecto sin promover y vuelve a ofrecer Invitar/Completar. Perder
-- la pista es aceptable; perder al alumno de la cola no. (Mismo razonamiento que U-2/D1.)
ALTER TABLE public.lista_espera
  ADD COLUMN IF NOT EXISTS nino_id uuid NULL
    REFERENCES public.ninos(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.lista_espera.nino_id IS
  'U-4/D4: niño creado al PROMOVER este prospecto (Invitar o Completar). Permite pintar el estado real de su matrícula en admisiones y ofrecer "Reanudar alta" (wizard /alta/[ninoId]). NULL = sin promover → la lista ofrece Invitar/Completar.';

CREATE INDEX IF NOT EXISTS idx_lista_espera_nino
  ON public.lista_espera (nino_id)
  WHERE nino_id IS NOT NULL;

-- ─── 2. Backfill de los prospectos ya promovidos ─────────────────────────────
-- Los promovidos ANTES de U-4 no tienen el enlace y son justo los que están mudos hoy. Se
-- reconstruye por la clave con la que el niño fue creado a partir del prospecto
-- (centro + nombre + apellidos + fecha de nacimiento), que en el momento de la promoción es
-- copia literal de la fila de `lista_espera`.
--
-- CONSERVADOR a propósito: solo toca filas `invitado` sin enlace y solo cuando el match es
-- ÚNICO. Si hay 0 candidatos (nombre editado ya en el wizard) o >1 (homónimos), se deja NULL:
-- ese prospecto seguirá ofreciendo Invitar/Completar en vez de apuntar al niño equivocado —
-- enlazar mal sería peor que no enlazar. IDEMPOTENTE: re-ejecutarla no cambia nada.
UPDATE public.lista_espera le
   SET nino_id = (
     SELECT n.id
       FROM public.ninos n
      WHERE n.centro_id = le.centro_id
        AND n.deleted_at IS NULL
        AND lower(n.nombre) = lower(le.nombre_nino)
        AND lower(coalesce(n.apellidos, '')) = lower(coalesce(le.apellidos_nino, ''))
        AND n.fecha_nacimiento IS NOT DISTINCT FROM le.fecha_nacimiento
   )
 WHERE le.estado = 'invitado'
   AND le.nino_id IS NULL
   AND (SELECT count(*)
          FROM public.ninos n2
         WHERE n2.centro_id = le.centro_id
           AND n2.deleted_at IS NULL
           AND lower(n2.nombre) = lower(le.nombre_nino)
           AND lower(coalesce(n2.apellidos, '')) = lower(coalesce(le.apellidos_nino, ''))
           AND n2.fecha_nacimiento IS NOT DISTINCT FROM le.fecha_nacimiento) = 1;

-- ─── 3. RLS: sin cambios (deliberado) ────────────────────────────────────────
-- `lista_espera_admin_all` (FOR ALL USING es_admin(centro_id)) sigue siendo la única policy:
-- la columna nueva no abre ni cierra acceso. El estado de la matrícula que la lista pinta se
-- lee de `matriculas` con el cliente AUTENTICADO del admin, cuya RLS ya lo autoriza por
-- centro — no hace falta policy nueva ni service role.
--
-- Coherencia centro prospecto↔niño: se garantiza server-side (la promoción crea el niño en
-- `prospecto.centro_id`) y el backfill exige `n.centro_id = le.centro_id`. No se enforza con
-- trigger cross-tabla, igual que en U-2/D1.

COMMIT;
