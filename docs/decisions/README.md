# Architecture Decision Records (ADR) — NIDO

Este directorio contiene los ADR (Architecture Decision Records) del proyecto. Cada ADR documenta una decisión arquitectónica concreta, con su contexto, las opciones consideradas, la decisión adoptada y sus consecuencias.

## Convenciones

- Formato: `ADR-XXXX-slug.md` con numeración correlativa de 4 dígitos.
- Plantilla: ver `_template.md`.
- Estados: `proposed`, `accepted`, `superseded`, `rejected`. Las decisiones derogadas se mantienen en disco con estado `superseded` y enlace cruzado al ADR que las reemplaza.
- Una decisión se considera "tomada" cuando el responsable de NIDO aprueba la spec o el PR asociado.

## Huecos intencionales en la numeración

La numeración avanza cronológicamente, pero hay dos huecos explícitos:

- **ADR-0017** y **ADR-0018**: estos dos slots se asignaron a decisiones de Fase 4.5 (menús semanales recurrentes con motor de cron y pre-generación masiva) que **se descartaron y nunca se mergearon**. La discusión completa y el código se quedaron en el PR #12 (cerrado sin merge) y el PR #13 (reversión del drift que dejaron en remote tras cerrar el #12). La Fase 4.5 se rehízo después con el modelo plantilla+menu_dia mucho más simple, documentado en ADR-0019, ADR-0020, ADR-0021 y ADR-0022.

  La numeración **no se compacta**: se mantiene continua y monótona para preservar el orden cronológico real de las decisiones aceptadas. Comprimir provocaría que los ADRs siguientes (0019+) cambiaran de número y rompería enlaces externos, commits y discusiones referenciadas.

  Si necesitas rescatar el contexto histórico de aquellas decisiones rechazadas:
  - PR #12 (cerrado sin merge) — diseño original de menús semanales recurrentes.
  - PR #13 (mergeado) — `chore(db): revert phase 4.5 drift left in remote after closed pr #12`.
  - ADR-0020 — modelo definitivo de menús (plantilla mensual + `menu_dia`).

## Índice rápido

| ADR  | Título                                                   | Estado                         |
| ---- | -------------------------------------------------------- | ------------------------------ |
| 0001 | Auth by invitation only                                  | accepted                       |
| 0002 | RLS helpers in `public` schema                           | accepted                       |
| 0003 | Aulas: cohortes de años de nacimiento                    | accepted                       |
| 0004 | Cifrado de datos médicos con pgcrypto                    | accepted                       |
| 0005 | Matrículas históricas                                    | accepted                       |
| 0006 | Permisos granulares JSONB en vínculos                    | accepted                       |
| 0007 | RLS policy recursion avoidance                           | accepted                       |
| 0008 | Design system                                            | accepted                       |
| 0009 | Datos pedagógicos en tabla separada                      | accepted                       |
| 0010 | Logo del centro con URL relativa                         | accepted                       |
| 0011 | Ventana de edición: timezone Madrid hardcoded            | accepted                       |
| 0012 | Agenda en 5 tablas vs JSONB                              | accepted                       |
| 0013 | Ventana de edición = mismo día calendario                | accepted (deroga regla previa) |
| 0014 | Componente "Pase de Lista" reutilizable                  | accepted                       |
| 0015 | Asistencia lazy (sin pre-creación de filas)              | accepted                       |
| 0016 | Día cerrado transversal en operativas                    | accepted                       |
| 0017 | _hueco intencional — ver arriba_                         | n/a                            |
| 0018 | _hueco intencional — ver arriba_                         | n/a                            |
| 0019 | Calendario laboral: default + excepciones                | accepted                       |
| 0020 | Plantilla mensual de menú + menu_dia                     | accepted                       |
| 0021 | Extensión de `comidas` con `tipo_plato`                  | accepted                       |
| 0022 | Escala 1-5 reutilizando ENUM existente                   | accepted                       |
| 0023 | Modelo de mensajería con 5 tablas (F5)                   | accepted                       |
| 0024 | Participantes calculados dinámicamente (F5)              | accepted                       |
| 0025 | Push notifications fuera de F5 (F5.5 transversal)        | accepted                       |
| 0026 | Mensajería UI tipo WhatsApp con split-view por rol       | accepted                       |
| 0027 | Arquitectura de push con server actions + `web-push`     | accepted                       |
| 0028 | Manifest mínimo en F5.5 vs PWA completa en F11           | accepted                       |
| 0029 | Admin↔familia 1-por-(admin, tutor) con reapertura        | accepted                       |
| 0030 | Timer reseteable admin↔familia vía trigger AFTER INSERT  | accepted                       |
| 0031 | Marcar erróneo limitado a 5 min, en RLS inline           | accepted                       |
| 0032 | ENUM `tipo_personal_aula` para personal de aula          | accepted                       |
| 0033 | Tabla `/admin/aulas` enriquecida                         | accepted                       |
| 0034 | Sustitución atómica de coordinadora en `profes_aulas`    | accepted                       |
| 0035 | Modelo de recordatorios bidireccionales (F6-A)           | superseded (por ADR-0037)      |
| 0036 | Completar recordatorio idempotente (F6)                  | accepted                       |
| 0037 | Modelo granular de destinatarios de recordatorios (F6-C) | accepted (supera a 0035)       |
