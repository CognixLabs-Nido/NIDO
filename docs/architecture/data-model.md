# Modelo de datos — NIDO

35 tablas organizadas en 3 módulos. Implementadas hasta Fase 4 incluida: Fase 1 (4 de auth), Fase 2 (10 Core + 2 transversales), Fase 2.6 (1 Core más), Fase 3 (5 operativas), Fase 4 (2 operativas más). El resto llega en Fases 5-10.

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

| Tabla                                            | Descripción                                                                                                                             | Estado    |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `agendas_diarias`                                | Fila padre por niño/día. UNIQUE (nino_id, fecha). ON DELETE RESTRICT                                                                    | ✅ Fase 3 |
| `comidas`                                        | Eventos de comida (4 momentos). FK ON DELETE CASCADE a `agendas_diarias`                                                                | ✅ Fase 3 |
| `biberones`                                      | Eventos de biberón con cantidad_ml ∈ [0,500] y tipo. CASCADE                                                                            | ✅ Fase 3 |
| `suenos`                                         | Siestas. CHECK hora_fin > hora_inicio (o null mientras en curso). CASCADE                                                               | ✅ Fase 3 |
| `deposiciones`                                   | Pipí/caca/mixto con consistencia (solo si caca). CASCADE                                                                                | ✅ Fase 3 |
| `asistencias`                                    | Pase de lista por niño/día. UNIQUE (nino_id, fecha). ON DELETE RESTRICT. CHECK hora_salida > hora_llegada cuando ambas. Lazy (ADR-0015) | ✅ Fase 4 |
| `ausencias`                                      | Rango de ausencia reportada (familia/profe/admin). CHECK fecha_fin ≥ fecha_inicio. Cancelación = UPDATE con prefijo `[cancelada] `      | ✅ Fase 4 |
| `conversaciones`, `mensajes`, `mensaje_lecturas` | ⏳ Fase 5                                                                                                                               |
| `recordatorios`                                  | ⏳ Fase 6                                                                                                                               |
| `eventos`, `confirmaciones_evento`               | ⏳ Fase 7                                                                                                                               |
| `autorizaciones`, `firmas_autorizacion`          | ⏳ Fase 8                                                                                                                               |
| `plantillas_informe`, `informes_evolucion`       | ⏳ Fase 9                                                                                                                               |
| `publicaciones`, `media`, `media_etiquetas`      | ⏳ Fase 10                                                                                                                              |

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
- `centro_id` redundante en tablas operativas o derivado por helper `centro_de_*` (simplifica RLS)
- Triggers Postgres para audit log automático en: `centros`, `ninos`, `info_medica_emergencia`, `datos_pedagogicos_nino`, `vinculos_familiares`, `roles_usuario`, `matriculas`, `agendas_diarias`, `comidas`, `biberones`, `suenos`, `deposiciones`, `asistencias`, `ausencias`
- `audit_log` append-only (RLS bloquea UPDATE/DELETE a todos los roles)
- Timestamps siempre `timestamptz`
- Cifrado pgcrypto en `info_medica_emergencia.alergias_graves` y `notas_emergencia` (ver ADR-0004)
- ENUMs en columnas con valores fijos: `user_role` (Fase 1), `curso_estado`, `nino_sexo`, `tipo_vinculo`, `parentesco`, `audit_accion`, `consentimiento_tipo` (Fase 2), `lactancia_estado`, `control_esfinteres`, `tipo_alimentacion` (Fase 2.6), `estado_general_agenda`, `humor_agenda`, `momento_comida`, `cantidad_comida`, `tipo_biberon`, `calidad_sueno`, `tipo_deposicion`, `consistencia_deposicion`, `cantidad_deposicion` (Fase 3), `estado_asistencia`, `motivo_ausencia` (Fase 4)
- Ventana de edición (Fase 3 y Fase 4, ADR-0013 + ADR-0016 transversal): RLS de INSERT/UPDATE en las 5 tablas operativas de la agenda **y en `asistencias`** exige `dentro_de_ventana_edicion(fecha) = TRUE` (helper hardcoded a `Europe/Madrid`, ADR-0011). Para `ausencias` se usa el helper hermano `hoy_madrid()` en tutor: las RLS exigen `fecha_inicio >= hoy_madrid()` al reportar/editar como tutor. DELETE bloqueado a todos por default DENY en todas estas tablas.
- Publicación Realtime: las 5 tablas de Fase 3 + `asistencias` + `ausencias` en `supabase_realtime`. RLS de SELECT también se aplica a las notificaciones.

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
- `agendas_diarias`: UNIQUE (nino_id, fecha); FK `nino_id` ON DELETE RESTRICT; CHECK `observaciones_generales` ≤ 500.
- Tablas hijo de la agenda (`comidas`, `biberones`, `suenos`, `deposiciones`): FK `agenda_id` ON DELETE CASCADE; CHECKs por campo (length ≤ 500 en text, `cantidad_ml` ∈ [0,500] en biberones, `hora_fin > hora_inicio` en sueños, `tipo='pipi' ⇒ consistencia IS NULL` en deposiciones).
- `asistencias` (Fase 4): UNIQUE (nino_id, fecha); FK `nino_id` ON DELETE RESTRICT; CHECK `length(observaciones) ≤ 500`; CHECK `hora_salida IS NULL OR hora_llegada IS NULL OR hora_salida > hora_llegada`.
- `ausencias` (Fase 4): FK `nino_id` ON DELETE RESTRICT; CHECK `fecha_fin >= fecha_inicio`; CHECK `length(descripcion) ≤ 500`. Cancelación = UPDATE con prefijo `[cancelada] ` en `descripcion` (mismo patrón que `[anulado] ` en agenda).
- Realtime publication: las 5 tablas de Fase 3 + `asistencias` + `ausencias` en `supabase_realtime`. RLS de SELECT también se aplica a las notificaciones.
