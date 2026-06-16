-- Fase 11 — Alta tutor-driven, Pieza 2b: ninos.apellidos / fecha_nacimiento nullable.
--
-- El esqueleto de niño (creado por la dirección en la invitación) solo fija
-- centro + nombre (+ aula vía matrícula); la IDENTIDAD (apellidos, fecha de
-- nacimiento, sexo, nacionalidad, idioma) la completa el TUTOR en el wizard
-- (pieza posterior). Por eso estas dos columnas, hoy NOT NULL, pasan a NULL.
--
-- La CHECK inline existente `fecha_nacimiento <= CURRENT_DATE` se MANTIENE: una
-- CHECK pasa cuando la expresión es NULL, así que ya admite el esqueleto sin
-- fecha. No se toca.
--
-- Las lecturas operativas (agenda, pase de lista, audiencias, informes, fotos)
-- excluyen estado='pendiente' desde la Pieza 2a → un esqueleto sin rellenar solo
-- aflora en la lista de gestión (admin) y, tras aceptar, en /family (null-safe).

ALTER TABLE public.ninos ALTER COLUMN apellidos DROP NOT NULL;
ALTER TABLE public.ninos ALTER COLUMN fecha_nacimiento DROP NOT NULL;
