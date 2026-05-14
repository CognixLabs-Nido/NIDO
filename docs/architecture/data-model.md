# Modelo de datos — NIDO

35 tablas organizadas en 3 módulos. Las de Fase 1 (`usuarios`, `roles_usuario`, `invitaciones`, `auth_attempts`) y Fase 2 (las 10 de Core + 2 transversales) están implementadas. El resto llega en Fases 3-10.

## Módulo Core (11 tablas) — Fases 2 y 2.6

| Tabla                    | Descripción                                                                                                | Estado      |
| ------------------------ | ---------------------------------------------------------------------------------------------------------- | ----------- |
| `centros`                | Escuelas infantiles. `logo_url TEXT NULL` añadido en Fase 2.6.                                             | ✅ Fase 2   |
| `cursos_academicos`      | Años escolares (UNIQUE por centro+nombre, un único `activo` por centro)                                    | ✅ Fase 2   |
| `aulas`                  | Aulas por centro y curso, con `cohorte_anos_nacimiento int[]`                                              | ✅ Fase 2   |
| `usuarios`               | Extiende `auth.users` (Supabase Auth)                                                                      | ✅ Fase 1   |
| `roles_usuario`          | Rol por usuario y centro (UNIQUE por usuario+centro+rol)                                                   | ✅ Fase 1   |
| `ninos`                  | Ficha de cada niño                                                                                         | ✅ Fase 2   |
| `info_medica_emergencia` | Alergias, medicación, contactos urgencia. `alergias_graves` y `notas_emergencia` cifrados                  | ✅ Fase 2   |
| `datos_pedagogicos_nino` | Lactancia, control de esfínteres, siesta, alimentación, idiomas, hermanos. 1:1 con `ninos`                 | ✅ Fase 2.6 |
| `matriculas`             | Histórico niño ↔ aula (un activo por curso, ver ADR-0005)                                                  | ✅ Fase 2   |
| `vinculos_familiares`    | Tutores y autorizados con permisos JSONB granulares. Nueva clave `puede_ver_datos_pedagogicos` en Fase 2.6 | ✅ Fase 2   |
| `profes_aulas`           | Asignación profe ↔ aula (un único principal activo por aula)                                               | ✅ Fase 2   |

## Módulo Operativo (20 tablas) — Fases 3-10

Agendas diarias, comidas, biberones, sueños, deposiciones, asistencias, ausencias, mensajería, recordatorios, eventos, autorizaciones, informes, publicaciones y media.

## Módulo Transversal (5 tablas)

| Tabla                                                       | Estado    |
| ----------------------------------------------------------- | --------- |
| `audit_log` (append-only, triggers automáticos en 6 tablas) | ✅ Fase 2 |
| `consentimientos` (versionados, append-only)                | ✅ Fase 2 |
| `invitaciones` (token + expiración + binding niño/aula)     | ✅ Fase 1 |
| `auth_attempts` (rate limiting login)                       | ✅ Fase 1 |
| `notificaciones_push` y `push_subscriptions`                | ⏳ Fase 5 |

## Reglas obligatorias

- UUIDs en todas las PKs
- Soft delete (`deleted_at`) en entidades sensibles
- `centro_id` redundante en tablas operativas (simplifica RLS)
- Triggers Postgres para audit log automático en: `centros`, `ninos`, `info_medica_emergencia`, `datos_pedagogicos_nino`, `vinculos_familiares`, `roles_usuario`, `matriculas`
- `audit_log` append-only (RLS bloquea UPDATE/DELETE a todos los roles)
- Timestamps siempre `timestamptz`
- Cifrado pgcrypto en `info_medica_emergencia.alergias_graves` y `notas_emergencia` (ver ADR-0004)
- ENUMs en columnas con valores fijos: `user_role` (Fase 1), `curso_estado`, `nino_sexo`, `tipo_vinculo`, `parentesco`, `audit_accion`, `consentimiento_tipo` (Fase 2)

## Foreign keys diferidos cerrados en Fase 2

- `roles_usuario.centro_id` → `centros.id` ON DELETE RESTRICT
- `invitaciones.centro_id` → `centros.id` ON DELETE CASCADE
- `invitaciones.nino_id` → `ninos.id` ON DELETE CASCADE
- `invitaciones.aula_id` → `aulas.id` ON DELETE CASCADE

## Constraints estructurales relevantes

- `aulas.cohorte_anos_nacimiento`: longitud 1-5, valores entre 2020 y 2030.
- `cursos_academicos`: índice parcial único `(centro_id) WHERE estado='activo'` garantiza un único curso activo por centro.
- `matriculas`: índice parcial único `(nino_id, curso_academico_id) WHERE fecha_baja IS NULL` garantiza una matrícula activa por curso.
- `profes_aulas`: índice parcial único `(aula_id) WHERE es_profe_principal AND fecha_fin IS NULL` garantiza un único profe principal activo por aula.
- `info_medica_emergencia.nino_id`: UNIQUE + ON DELETE RESTRICT (un solo registro médico por niño, borrado físico bloqueado — se usa soft delete del niño).
- `datos_pedagogicos_nino.nino_id`: UNIQUE + ON DELETE RESTRICT (mismo patrón). CHECKs: `siesta_numero_diario` ∈ [0,5], `idiomas_casa` longitud [1,8] con cada código de 2 letras (función IMMUTABLE `idiomas_iso_2letras`), y `tipo_alimentacion='otra' ⇒ alimentacion_observaciones NOT NULL`.
