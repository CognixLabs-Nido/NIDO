-- =============================================================================
-- F11 alta 4e (bug 5 acuses) — SEED de normas de régimen interno FIRMABLES (ANAIA)
-- -----------------------------------------------------------------------------
-- SOLO DATOS (no toca esquema ni código). Decisión de producto: patrón A, NO
-- self-service. La dirección publica UNA instancia de `reglas_regimen_interno`
-- con TEXTO PLACEHOLDER, firmable YA por el tutor en el paso de acuses del alta.
-- Cuando existan las normas reales, se sustituye el `texto` (dato); el flujo de
-- firma no cambia. (App en test con datos falsos → sin caveat de re-firma.)
--
-- Crea 2 filas en `autorizaciones` (formas del CHECK autorizaciones_tipo_coherencia
-- de RW-0) y anula la instancia legacy mal formada (ambito=NULL, invisible al tutor):
--   1) PLANTILLA (forma 1): catálogo del centro.
--   2) INSTANCIA patrón A ámbito 'centro' (forma 3): la que firma la familia.
--      → visible al tutor por RLS (usuario_es_audiencia_autorizacion_row: ámbito
--        'centro' ⇒ pertenece_a_centro) y firmable (autorizacion_firmable:
--        publicada + texto_definitivo=true + vigencia NULL).
--   3) ANULA la instancia legacy (estado='anulada'; NO se borra, NO se toca ambito).
--
-- IDs por SUBCONSULTA (sin UUIDs a pelo). Idempotente: las inserciones van
-- guardadas con NOT EXISTS, así que re-ejecutar no duplica ni choca con el índice
-- único parcial idx_autorizaciones_plantilla_unica (centro_id, tipo).
--
-- APLICAR POR SQL EDITOR (rol postgres → bypassa RLS). NO por CLI.
-- =============================================================================

WITH
-- Centro ANAIA (seed phase2: centros.nombre = 'ANAIA').
anaia AS (
  SELECT id FROM public.centros WHERE nombre = 'ANAIA' LIMIT 1
),
-- Un usuario admin REAL y vigente de ANAIA para `creado_por` (FK RESTRICT).
admin_user AS (
  SELECT ru.usuario_id
  FROM public.roles_usuario ru, anaia
  WHERE ru.centro_id = anaia.id
    AND ru.rol = 'admin'
    AND ru.deleted_at IS NULL
  ORDER BY ru.usuario_id
  LIMIT 1
),
-- ¿Ya hay plantilla activa (no anulada) de reglas para ANAIA? (idempotencia + índice único).
plantilla_existente AS (
  SELECT a.id
  FROM public.autorizaciones a, anaia
  WHERE a.centro_id = anaia.id
    AND a.tipo = 'reglas_regimen_interno'
    AND a.es_plantilla = true
    AND a.estado <> 'anulada'
  LIMIT 1
),
-- (1) PLANTILLA (forma 1) — solo si no existe ya.
plantilla_nueva AS (
  INSERT INTO public.autorizaciones (
    centro_id, tipo, es_plantilla, ambito, evento_id, nino_id, aula_id, plantilla_id,
    titulo, texto, texto_version, texto_definitivo, estado, firmantes_requeridos, creado_por
  )
  SELECT
    anaia.id, 'reglas_regimen_interno', true, NULL, NULL, NULL, NULL, NULL,
    'Normas de régimen interno', 'Normas de régimen interno en desarrollo',
    'v1-placeholder', true, 'publicada', 'uno_principal', admin_user.usuario_id
  FROM anaia, admin_user
  WHERE NOT EXISTS (SELECT 1 FROM plantilla_existente)
  RETURNING id
),
-- Id de la plantilla a usar (la nueva o la ya existente).
plantilla AS (
  SELECT id FROM plantilla_nueva
  UNION ALL
  SELECT id FROM plantilla_existente
),
-- ¿Ya hay instancia patrón A ámbito centro publicada? (idempotencia).
instancia_existente AS (
  SELECT a.id
  FROM public.autorizaciones a, anaia
  WHERE a.centro_id = anaia.id
    AND a.tipo = 'reglas_regimen_interno'
    AND a.es_plantilla = false
    AND a.ambito = 'centro'
    AND a.estado = 'publicada'
  LIMIT 1
),
-- (2) INSTANCIA patrón A ámbito 'centro' (forma 3) — solo si no existe ya.
instancia_nueva AS (
  INSERT INTO public.autorizaciones (
    centro_id, tipo, es_plantilla, ambito, evento_id, nino_id, aula_id, plantilla_id,
    titulo, texto, texto_version, texto_definitivo, estado, firmantes_requeridos,
    vigencia_desde, vigencia_hasta, creado_por
  )
  SELECT
    anaia.id, 'reglas_regimen_interno', false, 'centro', NULL, NULL, NULL, plantilla.id,
    'Normas de régimen interno', 'Normas de régimen interno en desarrollo',
    'v1-placeholder', true, 'publicada', 'uno_principal',
    NULL, NULL, admin_user.usuario_id
  FROM anaia, admin_user, plantilla
  WHERE NOT EXISTS (SELECT 1 FROM instancia_existente)
  RETURNING id
),
-- (3) ANULA la instancia legacy mal formada (ambito NULL, sin plantilla). NO se borra.
anular_legacy AS (
  UPDATE public.autorizaciones a
  SET estado = 'anulada'
  FROM anaia
  WHERE a.centro_id = anaia.id
    AND a.tipo = 'reglas_regimen_interno'
    AND a.es_plantilla = false
    AND a.ambito IS NULL
    AND a.plantilla_id IS NULL
    AND a.estado <> 'anulada'
  RETURNING a.id
)
-- Diagnóstico: si admin_user_id sale NULL, no había admin y no se insertó nada.
SELECT
  (SELECT usuario_id FROM admin_user)                     AS admin_user_id,
  (SELECT id FROM plantilla LIMIT 1)                      AS plantilla_id,
  (SELECT id FROM instancia_nueva)                        AS instancia_nueva_id,
  (SELECT id FROM instancia_existente)                    AS instancia_ya_existia,
  (SELECT count(*)::int FROM anular_legacy)               AS legacy_anuladas;
