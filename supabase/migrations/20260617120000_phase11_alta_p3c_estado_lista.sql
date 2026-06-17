-- F11 P3c — añade el estado 'lista' al ENUM matricula_estado (DEC-B).
-- Ciclo: pendiente → lista → activa → baja. El tutor finaliza el alta (pendiente →
-- lista, RPC marcar_matricula_lista); la dirección valida (lista → activa,
-- activarMatricula con guard lista-only). Aditiva e idempotente.
-- Va SOLA: un ADD VALUE debe commitearse antes de que cualquier función lo
-- referencie (la RPC marcar_matricula_lista va en la migración siguiente).
ALTER TYPE public.matricula_estado ADD VALUE IF NOT EXISTS 'lista' BEFORE 'activa';
