-- Centinela del borrado sin copia (rls-local.yml, solo en la BD efímera; lo comprueba
-- plan-borrado-sin-copia.mjs). Un DELETE con app.borrar_sin_copia se lleva sus copias de audit_log
-- desde audit_trigger_function, fila a fila. Si esa sentencia no va por el índice
-- (tabla, registro_id) con las DOS columnas, recorre el índice entero en cada fila: 7 ms por fila
-- con 370 000 filas, el barrido de un curso pasa de segundos a minutos. Lo que se mira es el PLAN
-- de la sentencia de dentro del trigger (auto_explain, precargado en la imagen de Supabase), no
-- el texto de la función: `TG_TABLE_NAME::text` parecía la corrección y conserva COLLATE "C".
-- Todo dentro de una transacción que acaba en ROLLBACK: la BD queda como estaba para la suite.
\set ON_ERROR_STOP 1
BEGIN;
INSERT INTO public.centros(nombre, direccion, telefono, email_contacto)
  VALUES ('Centinela plan', 'x', '600000000', 'centinela@nido.test') RETURNING id AS c \gset
INSERT INTO public.familias(centro_id, etiqueta) VALUES (:'c', 'C') RETURNING id AS f \gset
INSERT INTO public.ninos(centro_id, nombre, familia_id) VALUES (:'c', 'Centinela', :'f') RETURNING id AS n \gset
INSERT INTO public.agendas_diarias(nino_id, fecha, observaciones_generales)
  VALUES (:'n', DATE '2026-01-12', 'obs') RETURNING id AS a \gset
INSERT INTO public.comidas(agenda_id, momento, cantidad) VALUES (:'a', 'comida', 'todo');
INSERT INTO public.asistencias(nino_id, fecha, estado) VALUES (:'n', DATE '2026-01-12', 'presente');
-- Un audit_log con volumen: con cuatro filas el planner no distingue un plan de otro.
INSERT INTO public.audit_log(tabla, registro_id, accion, centro_id, ts)
  SELECT 'ninos', gen_random_uuid(), 'UPDATE', :'c', now() - make_interval(days => g % 1800)
    FROM generate_series(1, 20000) g;
ANALYZE public.audit_log;
SELECT set_config('app.borrar_sin_copia', 'on', true);
SET LOCAL auto_explain.log_min_duration = 0;
SET LOCAL auto_explain.log_nested_statements = on;
SET LOCAL client_min_messages = log;
-- Tres DELETE de audit_log dentro del trigger: la agenda, su comida (en cascada) y la asistencia.
DELETE FROM public.agendas_diarias WHERE id = :'a';
DELETE FROM public.asistencias WHERE nino_id = :'n';
ROLLBACK;
