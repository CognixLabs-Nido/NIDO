# Modelo de datos — NIDO

35 tablas organizadas en 3 módulos. Detalle completo pendiente de implementación en Fase 2.

## Módulo Core (10 tablas)

| Tabla                    | Descripción                                        |
| ------------------------ | -------------------------------------------------- |
| `centros`                | Escuelas infantiles                                |
| `cursos_academicos`      | Años escolares                                     |
| `aulas`                  | Aulas por centro y curso                           |
| `usuarios`               | Extiende `auth.users` (Supabase Auth)              |
| `roles_usuario`          | Rol por usuario y centro                           |
| `ninos`                  | Ficha de cada niño                                 |
| `info_medica_emergencia` | Alergias, medicación, contactos urgencia (cifrado) |
| `matriculas`             | Histórico niño ↔ aula                              |
| `vinculos_familiares`    | Tutores y autorizados con permisos granulares      |
| `profes_aulas`           | Asignación profe ↔ aula                            |

## Módulo Operativo (20 tablas)

Agendas diarias, comidas, biberones, sueños, deposiciones, asistencias, ausencias, mensajería, recordatorios, eventos, autorizaciones, informes, publicaciones y media.

## Módulo Transversal (5 tablas)

`audit_log`, `notificaciones_push`, `push_subscriptions`, `invitaciones`, `consentimientos`.

## Reglas obligatorias

- UUIDs en todas las PKs
- Soft delete (`deleted_at`) en entidades sensibles
- `centro_id` redundante en tablas operativas (simplifica RLS)
- Triggers Postgres para audit log automático
- `audit_log` append-only (RLS bloquea UPDATE/DELETE)
- Timestamps siempre `timestamptz`
- Cifrado pgcrypto en `info_medica_emergencia`
