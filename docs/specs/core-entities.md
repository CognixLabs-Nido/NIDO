---
feature: core-entities
wave: 1
phase: 2
status: draft
priority: critical
last_updated: 2026-05-13
related_adrs:
  [
    'ADR-0003-aulas-cohortes-nacimiento',
    'ADR-0004-cifrado-datos-medicos-pgcrypto',
    'ADR-0005-matriculas-historicas',
    'ADR-0006-permisos-granulares-vinculos',
  ]
related_specs: ['auth']
---

# Spec — Entidades core + RLS + audit log (Fase 2)

## Resumen ejecutivo

Modelo de datos core de NIDO: centros, cursos académicos, aulas (clasificadas por cohorte de nacimiento), niños, datos médicos de emergencia (cifrados a nivel columna con pgcrypto), matrículas históricas, vínculos familiares con permisos granulares, asignación profe↔aula, audit log automático con triggers, y consentimientos versionados. Esta fase deja la base sobre la que se construyen todas las fases operativas (3–10), e incluye la UI mínima de administración para que el responsable de ANAIA pueda crear el centro real, definir sus aulas y matricular niños sin tocar Supabase.

## Contexto

Fase 1 dejó identidad y acceso funcionando con 4 roles (`admin`, `profe`, `tutor_legal`, `autorizado`) y RLS aislando a cada usuario, pero las tablas `centros`, `aulas`, `ninos`, `matriculas`, `vinculos_familiares`, `profes_aulas`, `info_medica_emergencia` no existían: la migración de Fase 1 las referenciaba con `uuid` sin FK (constraint deferred a esta fase).

Toca ahora construir ese modelo, conectar los FKs que quedaron pendientes y añadir las dos infraestructuras transversales que el resto del sistema necesitará desde la primera operación real: **audit log automático** (RGPD: trazabilidad de accesos y modificaciones de datos sensibles) y **cifrado a nivel columna** en `info_medica_emergencia` (datos médicos de menores, riesgo alto si filtran).

Además, esta fase materializa el contexto operativo real de ANAIA, la primera (y por ahora única) escuela infantil: 5 aulas con nombres concretos (Sea, Farm big, Farm little, Sabanna big, Sabanna little) clasificadas por **cohorte de nacimiento** (array de años) y un curso académico 2026-27. El responsable creó manualmente un `centro_id` UUID al darse rol admin en Fase 1: hay que preservar ese UUID al crear la fila `centros`, o el FK `roles_usuario.centro_id → centros.id` deja huérfana la fila de admin.

## User stories

- US-08: Como admin, quiero editar los datos de mi centro (nombre, dirección, contacto, idioma por defecto).
- US-09: Como admin, quiero crear cursos académicos y marcar uno como activo a la vez (los demás del mismo centro pasan a cerrado automáticamente).
- US-10: Como admin, quiero crear aulas dentro del curso activo definiendo cohortes de nacimiento (uno o varios años) y capacidad.
- US-11: Como admin, quiero asignar profes a aulas, marcando opcionalmente uno como principal.
- US-12: Como admin, quiero registrar un niño nuevo con sus datos personales, sus datos médicos de emergencia y matricularlo directamente en un aula del curso activo.
- US-13: Como admin, quiero ver el historial de matrículas de un niño (a qué aula y cuándo) y poder cambiarlo de aula generando fecha de baja en la anterior y alta en la nueva.
- US-14: Como admin, quiero ver el audit log de mi centro y filtrar por tabla, acción, usuario o fecha.
- US-15: Como profe, quiero ver solo los niños de las aulas a las que estoy asignado.
- US-16: Como tutor legal, quiero ver los datos básicos de mi hijo/a (los que mi vínculo permite).
- US-17: Como tutor sin permiso `puede_ver_info_medica`, NO debo poder leer datos médicos del niño aunque sea mi hijo.

## Alcance

**Dentro:**

- 10 tablas nuevas: `centros`, `cursos_academicos`, `aulas`, `ninos`, `info_medica_emergencia`, `matriculas`, `vinculos_familiares`, `profes_aulas`, `audit_log`, `consentimientos`.
- FKs diferidos de Fase 1: `roles_usuario.centro_id → centros.id`, `invitaciones.centro_id → centros.id`, `invitaciones.nino_id → ninos.id`, `invitaciones.aula_id → aulas.id`.
- 4 helpers RLS adicionales en `public.*`: `es_profe_de_aula`, `es_tutor_de`, `tiene_permiso_sobre`, `pertenece_a_centro`.
- Políticas RLS para las 10 tablas nuevas.
- Audit log automático con `audit_trigger_function()` aplicada a 6 tablas (`centros`, `ninos`, `info_medica_emergencia`, `vinculos_familiares`, `roles_usuario`, `matriculas`).
- Cifrado pgcrypto a nivel columna en `info_medica_emergencia.alergias_graves` y `notas_emergencia`. Funciones `set_info_medica_emergencia_cifrada(...)` y `get_info_medica_emergencia(...)` para escribir y leer.
- Seed de ANAIA: 1 fila `centros` con UUID preservado, 1 fila `cursos_academicos` (2026-27 planificado), 5 filas `aulas` con cohortes.
- Server Actions y schemas Zod para cada feature (centros, cursos, aulas, ninos, matriculas, vinculos, profes-aulas).
- UI funcional para admin: dashboard, centro, cursos, aulas (lista + detalle), niños (lista + nuevo + detalle), audit log.
- UI mínima para profe: dashboard con aulas asignadas, lista de niños del aula.
- UI mínima para familia: dashboard con niños vinculados, ficha básica del niño (sujeta a permisos del vínculo).
- i18n trilingüe (es/en/va) para todos los strings nuevos.
- Tests Vitest (schemas + RLS + audit + cifrado) y Playwright (E2E admin CRUD y aislamiento profe).
- 4 ADRs: cohortes, cifrado médico, matrículas históricas, permisos granulares.

**Fuera (no se hace aquí):**

- Tablas operativas (`agendas_diarias`, `comidas`, `biberones`, `suenos`, `deposiciones`, `asistencias`, etc.) → **Fase 3+**.
- UI de gestión granular de permisos por vínculo familiar (el admin solo ve los permisos por defecto en Ola 1; UI completa de edición de cada flag → **Ola 2**).
- Importación masiva de niños / CSV → no en Ola 1.
- Rotación efectiva de `MEDICAL_ENCRYPTION_KEY`: la función `rotate_medical_key()` queda documentada y el plan en ADR-0004, pero no se ejecuta en esta fase (no hay necesidad real todavía).
- Carga de fotos del niño (`foto_url` queda como columna pero la subida es **Fase 10** — Fotos y publicaciones).
- Notificaciones push de cualquier tipo → cuando aparezca la primera necesidad real (Fase 5+).
- Tabla `notificaciones_push` y `push_subscriptions` → **Fase 5**.

## Comportamientos detallados

### B9 — Gestión del centro (admin)

**Pre-condiciones:** usuario con rol `admin` en el centro.

**Flujo:**

1. `/{locale}/admin/centro` muestra los datos del centro (Server Component cargando `centros` por id del rol activo).
2. Botón "Editar" abre `<EditarCentroDialog />` (Client) con RHF + Zod.
3. Submit → Server Action `updateCentro` valida y hace `UPDATE centros SET ... WHERE id = $1`.
4. RLS bloquea el UPDATE si el usuario no es admin del centro.

**Post-condiciones:** centro actualizado, audit log captura el UPDATE (la tabla `centros` está auditada — ver B16). El soft delete (`UPDATE centros SET deleted_at = now()`) también queda registrado.

**Edge cases:** Nadie crea centros desde la UI en Ola 1 — el centro de ANAIA se siembra en migración con UUID conocido. La creación de nuevos centros queda para Ola 2 (alta de centros con verificación legal).

### B10 — CRUD de cursos académicos

**Pre-condiciones:** admin del centro.

**Flujo crear:**

1. `/{locale}/admin/cursos` lista cursos del centro ordenados por `fecha_inicio` descendente, con badge de estado.
2. Botón "Nuevo curso" → diálogo con `nombre`, `fecha_inicio`, `fecha_fin`. Estado por defecto `planificado`.
3. Submit → Server Action `createCurso` con Zod (nombre único por centro, fecha_inicio < fecha_fin, fechas dentro de rango razonable [2020-01-01, 2050-12-31]).
4. INSERT. Si ya existe un curso con ese nombre → error i18n específico.

**Flujo activar curso:**

1. Click en "Marcar como activo" en un curso `planificado` o `cerrado`.
2. Server Action `activarCurso` ejecuta en una transacción:
   - `UPDATE cursos_academicos SET estado = 'cerrado' WHERE centro_id = $centro AND estado = 'activo' AND id != $id`.
   - `UPDATE cursos_academicos SET estado = 'activo' WHERE id = $id`.
3. Constraint a nivel BD: índice parcial único `(centro_id) WHERE estado = 'activo'` impide que haya dos activos simultáneos.

**Post-condiciones:** un solo curso `activo` por centro. Los cursos `cerrado` no se pueden volver a activar **desde la UI** (botón desactivado); técnicamente la BD lo permite, pero el server action lo rechaza con error i18n `curso.error.no_reabrir_cerrado`.

**Edge cases:**

- Crear un curso con fechas solapadas a otro existente: se permite (un centro puede planificar el siguiente curso antes de cerrar el actual).
- Eliminar un curso: soft delete con `deleted_at`. Bloqueado si tiene aulas o matrículas asociadas (FK ON DELETE RESTRICT).

### B11 — CRUD de aulas

**Pre-condiciones:** admin del centro, curso `planificado` o `activo` seleccionado.

**Flujo crear aula:**

1. `/{locale}/admin/aulas?curso={curso_id}` (default: curso activo del centro).
2. Botón "Nueva aula" → diálogo con `nombre`, `cohorte_anos_nacimiento` (multi-select de años 2020–2030), `descripcion` (opcional), `capacidad_maxima` (default 12, rango 1–40).
3. Submit → Server Action `createAula` con Zod:
   - `nombre`: 2–80 chars, único por curso.
   - `cohorte_anos_nacimiento`: array no vacío, cada elemento int entre 2020 y 2030.
   - `capacidad_maxima`: int 1–40.
4. INSERT con `centro_id` derivado del curso.

**Flujo asignar profe:**

1. `/{locale}/admin/aulas/[id]` muestra detalle: profes asignados (vía `profes_aulas` activos), niños matriculados.
2. Botón "Asignar profe" → diálogo con select de usuarios con rol `profe` en el centro, fecha_inicio (default hoy), checkbox `es_profe_principal`.
3. Submit → Server Action `asignarProfeAula`:
   - Valida que el usuario tiene rol `profe` activo en el centro.
   - Si `es_profe_principal=true` y ya hay otro principal activo: error i18n. Constraint BD: índice parcial único `(aula_id) WHERE es_profe_principal AND fecha_fin IS NULL`.
   - INSERT en `profes_aulas`.

**Edge cases:**

- Cambiar cohorte de un aula con niños matriculados: permitido (el aula puede evolucionar entre cursos). La validación de "fecha_nacimiento del niño coincide con cohorte" se aplica solo al momento de matricular, no posterior.
- Eliminar un aula con matrículas activas: bloqueado (FK ON DELETE RESTRICT). El admin debe primero dar de baja matrículas.

### B12 — Crear niño con datos médicos

**Pre-condiciones:** admin del centro, al menos un aula creada.

**Flujo:**

1. `/{locale}/admin/ninos/nuevo` es un formulario en 3 pasos (wizard) — todo Client Component con RHF + estado local:
   - **Paso 1 — Datos personales:** nombre, apellidos, fecha_nacimiento, sexo (opcional), nacionalidad (opcional), idioma_principal (default 'es'), foto (deshabilitada en Fase 2 — solo placeholder).
   - **Paso 2 — Datos médicos de emergencia:** alergias_graves (textarea), notas_emergencia (textarea), medicacion_habitual, alergias_leves, medico_familia, telefono_emergencia. Aviso visible: "Estos datos se almacenan cifrados". Todos los campos opcionales — un niño sin datos médicos también es válido.
   - **Paso 3 — Matrícula:** select de aula del curso activo (filtrada por aulas cuya cohorte incluya el año de `fecha_nacimiento`). Si ninguna aula coincide → aviso y se permite elegir cualquier aula del curso con confirmación explícita (caso real: ANAIA puede excepcionar). `fecha_alta` = hoy por defecto.
2. Submit final → Server Action `crearNinoCompleto` en transacción:
   - `INSERT INTO ninos (...) RETURNING id`.
   - Si hay datos médicos llenos: `SELECT public.set_info_medica_emergencia_cifrada(nino_id, alergias_graves, notas_emergencia, medicacion_habitual, alergias_leves, medico_familia, telefono_emergencia)`.
   - `INSERT INTO matriculas (nino_id, aula_id, curso_academico_id, fecha_alta)`.
3. Si falla cualquier paso, ROLLBACK completo. Devuelve `{ success: true, nino_id }` o `{ success: false, error, paso }`.

**Edge cases:**

- Niño con fecha_nacimiento fuera de cualquier cohorte de aula: confirmación explícita del admin antes de matricular.
- Fecha de nacimiento futura o > 5 años: error de validación Zod.
- Audit log: el INSERT de `ninos` y el INSERT de `info_medica_emergencia` quedan auditados (cada uno como una fila distinta en `audit_log`). El INSERT en `matriculas` también.

### B13 — Matrícula y cambio de aula

**Flujo crear matrícula (desde admin/ninos/[id]):**

1. Botón "Matricular en aula" → diálogo con select de aulas del curso activo + fecha_alta.
2. Server Action `matricular`:
   - Valida que no existe otra matrícula activa del mismo niño en el mismo curso (constraint: índice parcial único `(nino_id, curso_academico_id) WHERE fecha_baja IS NULL`).
   - INSERT.

**Flujo cambio de aula:**

1. Botón "Cambiar de aula" en matrícula activa.
2. Diálogo: `nueva_aula_id`, `fecha_baja` (hoy por defecto), `motivo_baja` (texto libre, opcional pero recomendado).
3. Server Action `cambiarAula` en transacción:
   - `UPDATE matriculas SET fecha_baja = $fecha, motivo_baja = $motivo WHERE id = $matricula_actual`.
   - `INSERT INTO matriculas (nino_id, aula_id, curso_academico_id, fecha_alta = fecha_baja del anterior) RETURNING id`.
4. El historial completo queda preservado.

**Edge cases:**

- Dar de baja sin abrir nueva: permitido (caso "se va del centro a mitad de curso"). El admin solo hace `darDeBaja` (no abre nueva).
- Intentar cambiar a la misma aula: error i18n.

### B14 — Vínculos familiares (admin)

**Flujo:**

1. `/{locale}/admin/ninos/[id]` tiene sección "Familia y autorizados".
2. Botón "Añadir vínculo" → diálogo con: `usuario_id` (busca usuarios del centro por email), `tipo_vinculo`, `parentesco`, `descripcion_parentesco` (si parentesco='otro').
3. Server Action `crearVinculo`:
   - Valida que `usuario_id` tiene un rol activo `tutor_legal` o `autorizado` en el centro.
   - Constraint UNIQUE(nino_id, usuario_id) impide duplicar.
   - **Permisos por defecto según `tipo_vinculo`** (todos los campos JSON):
     - `tutor_legal_principal`, `tutor_legal_secundario`: `{ puede_recoger: true, puede_ver_agenda: true, puede_ver_fotos: true, puede_ver_info_medica: true, puede_recibir_mensajes: true, puede_firmar_autorizaciones: true, puede_confirmar_eventos: true }`.
     - `autorizado`: todos `false`.
   - INSERT.

**Edición de permisos:** en Fase 2 solo se muestran los permisos por defecto en read-only. La UI completa de toggles por permiso queda para Ola 2 — aquí solo creamos la estructura.

**Edge cases:**

- Usuario sin rol `tutor_legal`/`autorizado` activo: error i18n.
- Eliminar vínculo: soft delete (`deleted_at`). Permisos asociados quedan "congelados" en el último valor.

### B15 — Cifrado de datos médicos

**Decisión de diseño:** las columnas sensibles `alergias_graves` y `notas_emergencia` son `BYTEA`. Nunca se INSERTA ni se SELECT directamente desde el código aplicativo — siempre vía las funciones helper SECURITY DEFINER.

**Escritura:** `public.set_info_medica_emergencia_cifrada(p_nino_id, p_alergias_graves, p_notas_emergencia, p_medicacion_habitual, p_alergias_leves, p_medico_familia, p_telefono_emergencia)`.

- Autorización dentro de la función: solo `public.es_admin(centro_del_niño)`.
- Cifra `p_alergias_graves` y `p_notas_emergencia` con `pgp_sym_encrypt(text, key)`.
- INSERT o UPDATE con `ON CONFLICT (nino_id) DO UPDATE`.
- Texto plano del resto de columnas se guarda tal cual.

**Lectura:** `public.get_info_medica_emergencia(p_nino_id)`.

- Autorización: admin del centro **O** profe del aula actual del niño **O** vínculo familiar con `puede_ver_info_medica=true`.
- Descifra `alergias_graves` y `notas_emergencia` con `pgp_sym_decrypt(bytea, key)`.
- Devuelve TABLE con las columnas en texto plano.

**Clave:** `current_setting('app.medical_encryption_key', false)` — variable de sesión Postgres persistida vía `ALTER DATABASE postgres SET app.medical_encryption_key = '<32-bytes-base64>'`. La clave se configura ANTES de aplicar la migración. Si no existe, las funciones fallan con un error técnico (Postgres devuelve `unrecognized configuration parameter`) — el server action captura y devuelve error i18n `medico.error.cifrado_no_configurado`.

**Plan de rotación** (no se ejecuta en Fase 2, documentado en ADR-0004): función `public.rotate_medical_key(p_old_key text, p_new_key text)` que itera filas, descifra con vieja, cifra con nueva en una transacción; tras éxito, el admin ejecuta `ALTER DATABASE postgres SET app.medical_encryption_key = '<nueva>'`.

### B16 — Audit log automático

**Función trigger genérica** (en `public.*`, SECURITY DEFINER):

```sql
CREATE OR REPLACE FUNCTION public.audit_trigger_function()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_centro_id uuid;
  v_antes jsonb;
  v_despues jsonb;
  v_registro_id uuid;
BEGIN
  v_centro_id := CASE TG_TABLE_NAME
    WHEN 'centros' THEN COALESCE((NEW).id, (OLD).id)
    WHEN 'ninos' THEN COALESCE((NEW).centro_id, (OLD).centro_id)
    WHEN 'info_medica_emergencia' THEN (SELECT centro_id FROM ninos WHERE id = COALESCE((NEW).nino_id, (OLD).nino_id))
    WHEN 'vinculos_familiares' THEN (SELECT centro_id FROM ninos WHERE id = COALESCE((NEW).nino_id, (OLD).nino_id))
    WHEN 'matriculas' THEN (SELECT centro_id FROM ninos WHERE id = COALESCE((NEW).nino_id, (OLD).nino_id))
    WHEN 'roles_usuario' THEN COALESCE((NEW).centro_id, (OLD).centro_id)
  END;

  v_antes := CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) END;
  v_despues := CASE WHEN TG_OP IN ('INSERT','UPDATE') THEN to_jsonb(NEW) END;
  v_registro_id := COALESCE((NEW).id, (OLD).id);

  INSERT INTO public.audit_log (tabla, registro_id, accion, usuario_id, valores_antes, valores_despues, centro_id)
  VALUES (TG_TABLE_NAME, v_registro_id, TG_OP::audit_accion, auth.uid(), v_antes, v_despues, v_centro_id);

  RETURN COALESCE(NEW, OLD);
END;
$$;
```

Triggers aplicados como `AFTER INSERT OR UPDATE OR DELETE FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_function()` en:

- `centros`
- `ninos`
- `info_medica_emergencia`
- `vinculos_familiares`
- `roles_usuario` (extensión retroactiva sobre tabla de Fase 1)
- `matriculas`

**Append-only:** la política RLS de `audit_log` bloquea `UPDATE` y `DELETE` a TODOS los roles (incluido admin). Solo INSERT desde la función trigger (SECURITY DEFINER bypassa RLS internamente). Lectura solo por admin del centro del registro.

**Soft delete:** un `UPDATE ninos SET deleted_at = now()` se captura como `accion='UPDATE'` con `valores_antes.deleted_at = null` y `valores_despues.deleted_at = <timestamp>`. No usamos DELETE físico salvo cascada de FK.

### B17 — Vista admin del audit log

**Flujo:**

1. `/{locale}/admin/audit` (lista paginada de `audit_log` del centro, orden descendente por timestamp).
2. Filtros: tabla, accion, usuario_id, rango de fechas.
3. Cada fila expandible muestra el diff JSON (`valores_antes` vs `valores_despues`) en un componente `<JsonDiff />`.

RLS filtra automáticamente por centro del admin.

## Casos edge

- **Centro sin curso activo**: `/admin/aulas` muestra estado vacío con CTA "Crea o activa un curso primero".
- **Aula sin profes asignados**: visible en lista admin con badge `Sin profe`. No bloquea matrículas (el profe se asigna después).
- **Niño matriculado en aula sin que su año de nacimiento coincida con la cohorte**: warning en lugar de error, requiere confirmación explícita del admin. Útil para excepciones reales (e.g. hermano que entra a mitad de curso).
- **Datos médicos con clave de cifrado mal configurada**: server action devuelve error i18n; las funciones BD fallan con `unrecognized configuration parameter`. Sin la clave, NO se puede leer ni escribir datos médicos cifrados.
- **Audit log para registro sin centro derivable** (e.g. trigger sobre `roles_usuario` cuyo `centro_id` se borró por error): la función inserta `centro_id = NULL` y se logea como anomalía. Sin embargo no debería ocurrir en la práctica con los FK ON DELETE RESTRICT.
- **Profe asignado a aula A y luego a aula B**: ve niños de A y B simultáneamente mientras ambas asignaciones están activas (`fecha_fin IS NULL`).
- **Vínculo familiar cuando el usuario se invita por primera vez** (Fase 1 B8): la invitación se acepta → INSERT en `roles_usuario` → el admin debe crear el vínculo en `vinculos_familiares` después (no automático, es un paso explícito).
- **Cambiar tipo de vínculo de un tutor a autorizado**: NO se sobrescriben permisos automáticamente; permanecen los que tenía. El admin debe ajustar permisos manualmente si quiere bajarle privilegios. (En Ola 2 la UI completa permite editar cada flag.)
- **Concurrencia: dos admins editan el mismo niño simultáneamente**: last-write-wins en Fase 2 (sin locking optimista). Audit log preserva ambas versiones.
- **Sin conexión / red lenta**: RHF muestra "Enviando..."; toast de error al fallar; reintentar.
- **i18n**: todas las pantallas verifican que las 3 lenguas tienen todas las claves vía `npm run i18n:check` (script existente desde Fase 0).
- **Borrado y soft delete**: las consultas con `JOIN ... USING (deleted_at IS NULL)` filtran. RLS no filtra automáticamente por `deleted_at`; lo gestiona la query.

## Validaciones (Zod)

Schemas en `src/features/<entidad>/schemas/`:

```typescript
// src/features/centros/schemas/centro.ts
export const centroSchema = z.object({
  nombre: z.string().min(2).max(120),
  direccion: z.string().min(2).max(240),
  telefono: z.string().min(5).max(30),
  email_contacto: z.string().email(),
  web: z.string().url().optional().nullable(),
  idioma_default: z.enum(['es', 'en', 'va']),
})

// src/features/cursos/schemas/curso.ts
export const cursoSchema = z
  .object({
    nombre: z.string().min(2).max(40),
    fecha_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    fecha_fin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .refine((d) => d.fecha_inicio < d.fecha_fin, { message: 'curso.validation.fechas_invertidas' })

// src/features/aulas/schemas/aula.ts
export const aulaSchema = z.object({
  nombre: z.string().min(2).max(80),
  cohorte_anos_nacimiento: z.array(z.number().int().min(2020).max(2030)).min(1).max(5),
  descripcion: z.string().max(500).optional().nullable(),
  capacidad_maxima: z.number().int().min(1).max(40),
})

// src/features/ninos/schemas/nino.ts
export const ninoSchema = z.object({
  nombre: z.string().min(1).max(80),
  apellidos: z.string().min(1).max(120),
  fecha_nacimiento: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((d) => new Date(d) <= new Date(), { message: 'nino.validation.fecha_futura' }),
  sexo: z.enum(['F', 'M', 'X']).optional().nullable(),
  nacionalidad: z.string().max(60).optional().nullable(),
  idioma_principal: z.enum(['es', 'en', 'va']).default('es'),
  notas_admin: z.string().max(1000).optional().nullable(),
})

export const infoMedicaSchema = z.object({
  alergias_graves: z.string().max(2000).optional().nullable(),
  notas_emergencia: z.string().max(2000).optional().nullable(),
  medicacion_habitual: z.string().max(2000).optional().nullable(),
  alergias_leves: z.string().max(2000).optional().nullable(),
  medico_familia: z.string().max(120).optional().nullable(),
  telefono_emergencia: z.string().max(30).optional().nullable(),
})

// src/features/matriculas/schemas/matricula.ts
export const matriculaSchema = z.object({
  nino_id: z.string().uuid(),
  aula_id: z.string().uuid(),
  fecha_alta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
})

export const cambioAulaSchema = z.object({
  nueva_aula_id: z.string().uuid(),
  fecha_baja: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  motivo_baja: z.string().max(500).optional().nullable(),
})

// src/features/vinculos/schemas/vinculo.ts
export const tipoVinculoEnum = z.enum([
  'tutor_legal_principal',
  'tutor_legal_secundario',
  'autorizado',
])
export const parentescoEnum = z.enum([
  'madre',
  'padre',
  'abuela',
  'abuelo',
  'tia',
  'tio',
  'hermana',
  'hermano',
  'cuidadora',
  'otro',
])

export const vinculoSchema = z
  .object({
    usuario_id: z.string().uuid(),
    tipo_vinculo: tipoVinculoEnum,
    parentesco: parentescoEnum,
    descripcion_parentesco: z.string().max(120).optional().nullable(),
  })
  .refine((d) => (d.parentesco === 'otro' ? !!d.descripcion_parentesco : true), {
    message: 'vinculo.validation.descripcion_requerida',
  })

// src/features/profes-aulas/schemas/profe-aula.ts
export const profeAulaSchema = z.object({
  profe_id: z.string().uuid(),
  fecha_inicio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  es_profe_principal: z.boolean().default(false),
})
```

**Helper compartido cliente/servidor:** `src/features/aulas/lib/cohorte.ts`:

```typescript
export function fechaEnCohorte(fecha_nacimiento: string, cohorte: number[]): boolean {
  const anio = Number(fecha_nacimiento.slice(0, 4))
  return cohorte.includes(anio)
}
```

## Modelo de datos afectado

**Tablas nuevas:** 10 — `centros`, `cursos_academicos`, `aulas`, `ninos`, `info_medica_emergencia`, `matriculas`, `vinculos_familiares`, `profes_aulas`, `audit_log`, `consentimientos`.

**Tablas modificadas (FKs diferidos):** `roles_usuario`, `invitaciones`.

**Tablas consultadas:** `usuarios` (de Fase 1).

Migración: `supabase/migrations/<timestamp>_phase2_core_entities.sql`.

### SQL completo (resumen)

```sql
-- Extensiones (pgcrypto ya activo de Fase 1, idempotente)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ENUMs nuevos
CREATE TYPE public.curso_estado AS ENUM ('planificado', 'activo', 'cerrado');
CREATE TYPE public.nino_sexo AS ENUM ('F', 'M', 'X');
CREATE TYPE public.tipo_vinculo AS ENUM ('tutor_legal_principal', 'tutor_legal_secundario', 'autorizado');
CREATE TYPE public.parentesco AS ENUM ('madre', 'padre', 'abuela', 'abuelo', 'tia', 'tio', 'hermana', 'hermano', 'cuidadora', 'otro');
CREATE TYPE public.audit_accion AS ENUM ('INSERT', 'UPDATE', 'DELETE');
CREATE TYPE public.consentimiento_tipo AS ENUM ('terminos', 'privacidad', 'imagen', 'datos_medicos');

-- centros
CREATE TABLE public.centros (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  direccion text NOT NULL,
  telefono text NOT NULL,
  email_contacto text NOT NULL,
  web text,
  idioma_default text NOT NULL DEFAULT 'es' CHECK (idioma_default IN ('es','en','va')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

-- cursos_academicos
CREATE TABLE public.cursos_academicos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id uuid NOT NULL REFERENCES public.centros(id) ON DELETE RESTRICT,
  nombre text NOT NULL,
  fecha_inicio date NOT NULL,
  fecha_fin date NOT NULL,
  estado public.curso_estado NOT NULL DEFAULT 'planificado',
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (centro_id, nombre),
  CHECK (fecha_inicio < fecha_fin)
);
CREATE UNIQUE INDEX idx_un_curso_activo_por_centro
  ON public.cursos_academicos(centro_id)
  WHERE estado = 'activo' AND deleted_at IS NULL;

-- aulas
CREATE TABLE public.aulas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id uuid NOT NULL REFERENCES public.centros(id) ON DELETE RESTRICT,
  curso_academico_id uuid NOT NULL REFERENCES public.cursos_academicos(id) ON DELETE RESTRICT,
  nombre text NOT NULL,
  cohorte_anos_nacimiento int[] NOT NULL CHECK (
    array_length(cohorte_anos_nacimiento, 1) >= 1
    AND array_length(cohorte_anos_nacimiento, 1) <= 5
  ),
  descripcion text,
  capacidad_maxima int NOT NULL DEFAULT 12 CHECK (capacidad_maxima BETWEEN 1 AND 40),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (curso_academico_id, nombre)
);
CREATE INDEX idx_aulas_centro ON public.aulas(centro_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_aulas_curso ON public.aulas(curso_academico_id) WHERE deleted_at IS NULL;

-- ninos
CREATE TABLE public.ninos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centro_id uuid NOT NULL REFERENCES public.centros(id) ON DELETE RESTRICT,
  nombre text NOT NULL,
  apellidos text NOT NULL,
  fecha_nacimiento date NOT NULL CHECK (fecha_nacimiento <= CURRENT_DATE),
  sexo public.nino_sexo,
  foto_url text,
  nacionalidad text,
  idioma_principal text NOT NULL DEFAULT 'es' CHECK (idioma_principal IN ('es','en','va')),
  notas_admin text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX idx_ninos_centro ON public.ninos(centro_id) WHERE deleted_at IS NULL;

-- info_medica_emergencia
CREATE TABLE public.info_medica_emergencia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nino_id uuid NOT NULL UNIQUE REFERENCES public.ninos(id) ON DELETE RESTRICT,
  alergias_graves bytea,
  notas_emergencia bytea,
  medicacion_habitual text,
  alergias_leves text,
  medico_familia text,
  telefono_emergencia text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- matriculas
CREATE TABLE public.matriculas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nino_id uuid NOT NULL REFERENCES public.ninos(id) ON DELETE RESTRICT,
  aula_id uuid NOT NULL REFERENCES public.aulas(id) ON DELETE RESTRICT,
  curso_academico_id uuid NOT NULL REFERENCES public.cursos_academicos(id) ON DELETE RESTRICT,
  fecha_alta date NOT NULL DEFAULT CURRENT_DATE,
  fecha_baja date,
  motivo_baja text,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (fecha_baja IS NULL OR fecha_baja >= fecha_alta)
);
CREATE UNIQUE INDEX idx_matricula_activa_unica
  ON public.matriculas(nino_id, curso_academico_id)
  WHERE fecha_baja IS NULL AND deleted_at IS NULL;
CREATE INDEX idx_matriculas_aula ON public.matriculas(aula_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_matriculas_nino ON public.matriculas(nino_id) WHERE deleted_at IS NULL;

-- vinculos_familiares
CREATE TABLE public.vinculos_familiares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nino_id uuid NOT NULL REFERENCES public.ninos(id) ON DELETE CASCADE,
  usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  tipo_vinculo public.tipo_vinculo NOT NULL,
  parentesco public.parentesco NOT NULL,
  descripcion_parentesco text,
  permisos jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (nino_id, usuario_id)
);
CREATE INDEX idx_vinculos_usuario ON public.vinculos_familiares(usuario_id) WHERE deleted_at IS NULL;

-- profes_aulas
CREATE TABLE public.profes_aulas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profe_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  aula_id uuid NOT NULL REFERENCES public.aulas(id) ON DELETE CASCADE,
  fecha_inicio date NOT NULL DEFAULT CURRENT_DATE,
  fecha_fin date,
  es_profe_principal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CHECK (fecha_fin IS NULL OR fecha_fin >= fecha_inicio)
);
CREATE UNIQUE INDEX idx_un_principal_activo_por_aula
  ON public.profes_aulas(aula_id)
  WHERE es_profe_principal AND fecha_fin IS NULL AND deleted_at IS NULL;
CREATE INDEX idx_profes_aulas_profe ON public.profes_aulas(profe_id) WHERE deleted_at IS NULL;

-- audit_log
CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tabla text NOT NULL,
  registro_id uuid,
  accion public.audit_accion NOT NULL,
  usuario_id uuid REFERENCES public.usuarios(id),
  valores_antes jsonb,
  valores_despues jsonb,
  centro_id uuid,
  ts timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_centro_ts ON public.audit_log(centro_id, ts DESC);
CREATE INDEX idx_audit_tabla_ts ON public.audit_log(tabla, ts DESC);

-- consentimientos
CREATE TABLE public.consentimientos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  tipo public.consentimiento_tipo NOT NULL,
  version text NOT NULL,
  aceptado_en timestamptz NOT NULL DEFAULT now(),
  ip_address inet,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_consentimientos_usuario ON public.consentimientos(usuario_id);

-- Triggers updated_at
CREATE TRIGGER centros_updated_at BEFORE UPDATE ON public.centros
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER aulas_updated_at BEFORE UPDATE ON public.aulas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER ninos_updated_at BEFORE UPDATE ON public.ninos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER info_medica_emergencia_updated_at BEFORE UPDATE ON public.info_medica_emergencia
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER vinculos_familiares_updated_at BEFORE UPDATE ON public.vinculos_familiares
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- FKs diferidos de Fase 1 (las columnas existen sin FK desde Fase 1)
ALTER TABLE public.roles_usuario
  ADD CONSTRAINT roles_usuario_centro_id_fkey
  FOREIGN KEY (centro_id) REFERENCES public.centros(id) ON DELETE RESTRICT;

ALTER TABLE public.invitaciones
  ADD CONSTRAINT invitaciones_centro_id_fkey FOREIGN KEY (centro_id) REFERENCES public.centros(id) ON DELETE CASCADE,
  ADD CONSTRAINT invitaciones_nino_id_fkey   FOREIGN KEY (nino_id)   REFERENCES public.ninos(id)   ON DELETE CASCADE,
  ADD CONSTRAINT invitaciones_aula_id_fkey   FOREIGN KEY (aula_id)   REFERENCES public.aulas(id)   ON DELETE CASCADE;
```

## Políticas RLS

### Helpers nuevos (todos en `public.*`, SECURITY DEFINER, STABLE)

```sql
CREATE OR REPLACE FUNCTION public.pertenece_a_centro(p_centro_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.roles_usuario
    WHERE usuario_id = auth.uid()
      AND centro_id = p_centro_id
      AND deleted_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.es_profe_de_aula(p_aula_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profes_aulas
    WHERE profe_id = auth.uid()
      AND aula_id = p_aula_id
      AND fecha_fin IS NULL
      AND deleted_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.es_tutor_de(p_nino_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.vinculos_familiares
    WHERE usuario_id = auth.uid()
      AND nino_id = p_nino_id
      AND deleted_at IS NULL
  );
$$;

CREATE OR REPLACE FUNCTION public.tiene_permiso_sobre(p_nino_id uuid, p_permiso text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.vinculos_familiares
    WHERE usuario_id = auth.uid()
      AND nino_id = p_nino_id
      AND deleted_at IS NULL
      AND COALESCE((permisos ->> p_permiso)::boolean, false) = true
  );
$$;
```

### Políticas por tabla (resumen — SQL completo en migración)

**`centros`** — ENABLE RLS, default deny:

```sql
CREATE POLICY centros_select_miembros ON public.centros FOR SELECT USING (public.pertenece_a_centro(id));
CREATE POLICY centros_admin_all       ON public.centros FOR ALL    USING (public.es_admin(id));
```

**`cursos_academicos`**:

```sql
CREATE POLICY cursos_select_miembros ON public.cursos_academicos FOR SELECT USING (public.pertenece_a_centro(centro_id));
CREATE POLICY cursos_admin_all       ON public.cursos_academicos FOR ALL    USING (public.es_admin(centro_id));
```

**`aulas`**:

```sql
CREATE POLICY aulas_select_miembros ON public.aulas FOR SELECT USING (public.pertenece_a_centro(centro_id));
CREATE POLICY aulas_admin_all       ON public.aulas FOR ALL    USING (public.es_admin(centro_id));
```

**`ninos`**:

```sql
CREATE POLICY ninos_admin_all     ON public.ninos FOR ALL    USING (public.es_admin(centro_id));
CREATE POLICY ninos_profe_select  ON public.ninos FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.matriculas m
    WHERE m.nino_id = public.ninos.id
      AND m.fecha_baja IS NULL AND m.deleted_at IS NULL
      AND public.es_profe_de_aula(m.aula_id)
  )
);
CREATE POLICY ninos_tutor_select  ON public.ninos FOR SELECT USING (public.es_tutor_de(id));
```

**`info_medica_emergencia`** — UPDATE/INSERT solo vía funciones SECURITY DEFINER; SELECT directo permitido a admin + profe del aula actual + tutor con permiso:

```sql
CREATE POLICY ime_admin_all ON public.info_medica_emergencia FOR ALL USING (
  public.es_admin((SELECT centro_id FROM public.ninos WHERE id = nino_id))
);
CREATE POLICY ime_profe_select ON public.info_medica_emergencia FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.matriculas m
    WHERE m.nino_id = info_medica_emergencia.nino_id
      AND m.fecha_baja IS NULL AND m.deleted_at IS NULL
      AND public.es_profe_de_aula(m.aula_id)
  )
);
CREATE POLICY ime_tutor_select ON public.info_medica_emergencia FOR SELECT USING (
  public.tiene_permiso_sobre(nino_id, 'puede_ver_info_medica')
);
```

**`matriculas`**:

```sql
CREATE POLICY matriculas_admin_all     ON public.matriculas FOR ALL    USING (public.es_admin((SELECT centro_id FROM public.ninos WHERE id = nino_id)));
CREATE POLICY matriculas_profe_select  ON public.matriculas FOR SELECT USING (public.es_profe_de_aula(aula_id));
CREATE POLICY matriculas_tutor_select  ON public.matriculas FOR SELECT USING (public.es_tutor_de(nino_id));
```

**`vinculos_familiares`**:

```sql
CREATE POLICY vinculos_admin_all      ON public.vinculos_familiares FOR ALL    USING (public.es_admin((SELECT centro_id FROM public.ninos WHERE id = nino_id)));
CREATE POLICY vinculos_self_select    ON public.vinculos_familiares FOR SELECT USING (usuario_id = auth.uid());
CREATE POLICY vinculos_profe_select   ON public.vinculos_familiares FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.matriculas m
    WHERE m.nino_id = vinculos_familiares.nino_id
      AND m.fecha_baja IS NULL AND m.deleted_at IS NULL
      AND public.es_profe_de_aula(m.aula_id)
  )
);
```

**`profes_aulas`**:

```sql
CREATE POLICY profes_aulas_admin_all     ON public.profes_aulas FOR ALL    USING (
  public.es_admin((SELECT centro_id FROM public.aulas WHERE id = aula_id))
);
CREATE POLICY profes_aulas_self_select   ON public.profes_aulas FOR SELECT USING (profe_id = auth.uid());
```

**`audit_log`** — append-only:

```sql
CREATE POLICY audit_admin_select ON public.audit_log FOR SELECT USING (public.es_admin(centro_id));
-- INSERT solo desde trigger (SECURITY DEFINER bypassa RLS). Sin policy de INSERT/UPDATE/DELETE = denegado.
```

**`consentimientos`**:

```sql
CREATE POLICY consentimientos_self_select  ON public.consentimientos FOR SELECT USING (usuario_id = auth.uid());
CREATE POLICY consentimientos_admin_select ON public.consentimientos FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.roles_usuario ru
    WHERE ru.usuario_id = consentimientos.usuario_id
      AND ru.deleted_at IS NULL
      AND public.es_admin(ru.centro_id)
  )
);
CREATE POLICY consentimientos_insert ON public.consentimientos FOR INSERT WITH CHECK (usuario_id = auth.uid());
-- UPDATE/DELETE no tienen policy = denegado.
```

## Pantallas y rutas

### Admin

- `/{locale}/admin` — dashboard: contador de aulas, niños activos, usuarios activos. CTAs a las 4 zonas.
- `/{locale}/admin/centro` — datos del centro, editable.
- `/{locale}/admin/cursos` — lista de cursos, crear nuevo, activar.
- `/{locale}/admin/aulas` — lista de aulas del curso activo, crear nueva.
- `/{locale}/admin/aulas/[id]` — detalle: profes asignados, niños matriculados, editar aula.
- `/{locale}/admin/ninos` — lista paginada y buscable, link a detalle.
- `/{locale}/admin/ninos/nuevo` — wizard 3 pasos.
- `/{locale}/admin/ninos/[id]` — detalle con tabs: Datos personales, Datos médicos, Familia y autorizados, Historial matrículas.
- `/{locale}/admin/audit` — lista del audit log con filtros.

### Profe

- `/{locale}/teacher` — dashboard con cards por aula asignada.
- `/{locale}/teacher/aula/[id]` — lista de niños matriculados (sin agenda — Fase 3).

### Familia

- `/{locale}/family` — dashboard con cards por niño vinculado.
- `/{locale}/family/nino/[id]` — datos básicos del niño, filtrados por los permisos del vínculo.

## Componentes UI

- `<DashboardStatCard />` (Server) — usado en los 3 dashboards.
- `<EditarCentroDialog />` (Client) — RHF + Zod.
- `<CursosTabla />` (Server) + `<NuevoCursoDialog />`, `<ActivarCursoButton />` (Client).
- `<AulasTabla />` (Server) + `<NuevaAulaDialog />`, `<EditarAulaDialog />` (Client) con multi-select de cohortes.
- `<NinosTabla />` (Server) con buscador (Client) y paginación.
- `<NuevoNinoWizard />` (Client) — 3 pasos.
- `<NinoTabs />` (Server) + sub-componentes Client por tab.
- `<InfoMedicaSection />` (Server) — query `get_info_medica_emergencia(nino_id)`, render texto plano; UPDATE vía `<EditarInfoMedicaDialog />` (Client).
- `<VinculosTabla />` + `<NuevoVinculoDialog />`.
- `<MatriculasHistorial />` + `<CambioAulaDialog />`.
- `<ProfesAulaTabla />` + `<AsignarProfeDialog />`.
- `<AuditLogTabla />` con filtros + `<JsonDiff />`.
- `<AulaCardProfe />` y `<NinoCardFamilia />` — dashboards lectores.

Componentes shadcn nuevos a instalar (si faltan): `table`, `dialog`, `select`, `tabs`, `badge`, `calendar`/`date-picker`.

## Eventos y notificaciones

- **Push**: ninguna en Fase 2.
- **Email**: ninguno nuevo. Los emails de Fase 1 (invitación, reset password) siguen funcionando contra los nuevos FKs.
- **Audit log**: capturado por triggers automáticos en `ninos`, `info_medica_emergencia`, `vinculos_familiares`, `roles_usuario`, `matriculas`. Sin código aplicativo que escriba a audit log directamente.

## i18n

Namespaces nuevos en `messages/{es,en,va}.json`:

```json
{
  "admin": {
    "dashboard": { "title": "Panel de administración", "stats": { "aulas": "Aulas", "ninos_activos": "Niños activos", "usuarios_activos": "Usuarios activos" } },
    "centro": { "title": "Datos del centro", "fields": { "nombre": "Nombre", "direccion": "Dirección", ... } },
    "cursos": { "title": "Cursos académicos", "nuevo": "Nuevo curso", "activar": "Marcar como activo", "estados": { "planificado": "Planificado", "activo": "Activo", "cerrado": "Cerrado" } },
    "aulas": { "title": "Aulas", "nueva": "Nueva aula", "cohorte": "Cohorte de nacimiento", "capacidad": "Capacidad máxima" },
    "ninos": { "title": "Niños", "nuevo": "Nuevo niño", "wizard": { "paso1": "Datos personales", "paso2": "Datos médicos", "paso3": "Asignar aula" } },
    "audit": { "title": "Audit log", "filtros": { "tabla": "Tabla", "accion": "Acción", "usuario": "Usuario", "desde": "Desde", "hasta": "Hasta" } }
  },
  "teacher": {
    "dashboard": { "title": "Mis aulas", "ningun_aula": "No tienes aulas asignadas todavía." }
  },
  "family": {
    "dashboard": { "title": "Mis niños", "ningun_nino": "No tienes niños vinculados." }
  },
  "centro": { "validation": { "nombre_corto": "Nombre demasiado corto" }, ... },
  "curso": { "validation": { "fechas_invertidas": "La fecha de inicio debe ser anterior a la fecha de fin" }, "error": { "no_reabrir_cerrado": "Un curso cerrado no se puede reabrir desde la UI" } },
  "aula": { "validation": { "cohorte_vacia": "Indica al menos un año de cohorte", "cohorte_anio_invalido": "Año fuera de rango (2020–2030)" } },
  "nino": { "validation": { "fecha_futura": "La fecha de nacimiento no puede ser futura", "fuera_de_cohorte": "El año de nacimiento no coincide con la cohorte del aula. ¿Confirmar?" } },
  "matricula": { "validation": { "ya_matriculado": "Este niño ya tiene una matrícula activa en este curso" } },
  "vinculo": { "validation": { "descripcion_requerida": "Indica la descripción del parentesco", "usuario_sin_rol": "Este usuario no tiene rol familiar en el centro" } },
  "medico": { "error": { "cifrado_no_configurado": "La configuración de cifrado de datos médicos no está disponible. Contacta con soporte." }, "aviso_cifrado": "Estos datos se almacenan cifrados." }
}
```

Traducciones equivalentes para `en` y `va`.

## Accesibilidad

- Wizard de nuevo niño con navegación de teclado completa entre pasos.
- Multi-select de cohortes con etiquetas `aria-label` y soporte de Space/Enter para toggle.
- Tablas con `<th scope>` y `role="rowgroup"` correctos.
- Audit log con expand/collapse accesible (botón con `aria-expanded`).
- Diálogos shadcn ya cumplen WAI-ARIA APG por defecto.
- Mensajes de error vinculados con `aria-describedby`.

## Performance

- Listados con paginación server-side (50 por página por defecto).
- Indexado pensado para queries con `centro_id` (todas las tablas core).
- `audit_log` indexado por `(centro_id, ts DESC)` — el listado es siempre el patrón.
- Wizard de nuevo niño: cada paso se valida client-side antes de enviar; solo el último submit hace round-trip.
- Bundle JS por página < 200 KB.

## Telemetría

- `admin.curso_creado`, `admin.curso_activado`.
- `admin.aula_creada`.
- `admin.nino_creado`.
- `admin.matricula_creada`, `admin.matricula_cambio_aula`, `admin.matricula_baja`.
- `admin.vinculo_creado`.
- `admin.info_medica_actualizada` (sin contenido — solo flag de que hubo cambio).
- `admin.audit_log_visto` (con filtros aplicados, sin valores sensibles).

## Tests requeridos

### Vitest unit (`src/features/<entidad>/__tests__/`)

- [ ] `centro.schema.test.ts`
- [ ] `curso.schema.test.ts` — fechas invertidas, nombre corto.
- [ ] `aula.schema.test.ts` — cohorte vacía, año fuera de rango, capacidad fuera.
- [ ] `nino.schema.test.ts` — fecha futura, idiomas válidos.
- [ ] `info-medica.schema.test.ts`.
- [ ] `matricula.schema.test.ts`.
- [ ] `vinculo.schema.test.ts` — descripción requerida si parentesco='otro'.
- [ ] `profe-aula.schema.test.ts`.
- [ ] `cohorte.test.ts` — `fechaEnCohorte(...)` cubre casos límite.

### Vitest RLS (`src/test/rls/`)

- [ ] `centros.rls.test.ts` — admin de centro A no ve datos de centro B.
- [ ] `aulas.rls.test.ts` — profe de aula A no ve niños de aula B (vía matrículas).
- [ ] `vinculos.rls.test.ts` — tutor de niño X no ve niño Y.
- [ ] `info-medica.rls.test.ts` — tutor sin `puede_ver_info_medica` no puede leer; con permiso sí.
- [ ] `audit-log.rls.test.ts` — UPDATE/DELETE rechazados para admin y para anon. Lectura solo admin del centro.

### Vitest audit (`src/test/audit/`)

- [ ] `audit.test.ts` — INSERT en `ninos` genera fila en `audit_log`. UPDATE captura antes/después. Soft delete (UPDATE `deleted_at`) se audita.

### Vitest cifrado (`src/test/rls/cifrado.test.ts`)

- [ ] SELECT directo a `info_medica_emergencia.alergias_graves` devuelve BYTEA (no plaintext).
- [ ] `get_info_medica_emergencia(nino_id)` descifra y devuelve texto plano.
- [ ] `set_info_medica_emergencia_cifrada(...)` con texto que se descifra correcto.

### Playwright E2E (`e2e/`)

- [ ] `admin-crud-flow.spec.ts` — admin crea curso → activa → crea aula → crea niño + datos médicos → matricula → ve en lista.
- [ ] `profe-aislamiento.spec.ts` — profe asignado a aula A solo ve niños de A.

## Criterios de aceptación

- [ ] Todos los tests listados pasan en CI.
- [ ] Lighthouse > 90 en `/admin`, `/admin/cursos`, `/admin/aulas`, `/admin/ninos`.
- [ ] axe-core sin violations en las nuevas pantallas.
- [ ] Las 3 lenguas (es/en/va) tienen todas las claves nuevas.
- [ ] La app funciona en iOS Safari 16.4+ y Chrome Android.
- [ ] ADR-0003, ADR-0004, ADR-0005, ADR-0006 escritos y aceptados.
- [ ] `docs/architecture/data-model.md` actualizado con las 10 tablas nuevas.
- [ ] `docs/architecture/rls-policies.md` actualizado con los 4 helpers nuevos y las políticas por tabla.
- [ ] `docs/journey/progress.md` con entrada de Fase 2.
- [ ] Deploy a Vercel verde tras merge.
- [ ] La fila de ANAIA en `centros` tiene el UUID preservado de Fase 1 (FK de `roles_usuario.centro_id → centros.id` no se viola).
- [ ] `app.medical_encryption_key` configurada en Supabase y verificada con un test de roundtrip cifrado/descifrado.

## Decisiones técnicas relevantes

- **Cohortes de nacimiento como `int[]` vs rangos** → ADR-0003.
- **Cifrado pgcrypto a nivel columna en `info_medica_emergencia`** → ADR-0004 (incluye plan de rotación).
- **`matriculas` como tabla histórica vs FK directa niño→aula** → ADR-0005.
- **Permisos granulares JSONB en `vinculos_familiares` desde Ola 1** → ADR-0006.
- **Clave de cifrado vía variable de sesión Postgres (`current_setting`)** vs Supabase Vault: elegimos `current_setting` por simplicidad y compatibilidad con Supabase Cloud sin add-ons; Vault podría introducirse en Ola 2 si la rotación se vuelve operacionalmente relevante.
- **Audit log derivando `centro_id` por CASE en función trigger** vs almacenar denormalizado en todas las tablas: hacemos el lookup en el trigger porque la columna `centro_id` ya está disponible en las tablas auditadas o es derivable con un JOIN simple a `ninos`/`roles_usuario`.

## Referencias

- ADR-0001-auth-by-invitation-only.md
- ADR-0002-rls-helpers-in-public-schema.md
- ADR-0003 a ADR-0006 (a crear en esta fase).
- `docs/specs/auth.md`
- `docs/architecture/data-model.md`
- `docs/architecture/rls-policies.md`
- Migración: `supabase/migrations/<timestamp>_phase2_core_entities.sql`.
