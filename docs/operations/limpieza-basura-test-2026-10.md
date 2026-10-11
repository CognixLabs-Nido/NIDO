# Limpieza de la basura de test en producción (octubre de 2026)

**Estado:** aplicada en producción el 12-10-2026 (NOTICE «Limpieza hecha», todas las guardas pasaron). Operación: `supabase/operaciones/20261012120000_limpieza_basura_test.sql`.

## De dónde viene

La suite RLS corrió contra producción hasta el 11-10-2026. #340 cerró el grifo (la suite aborta si la BD no es local) y la nocturna nueva (#342) ya no toca producción. Desde la última nocturna antigua (11-10-2026, 08:21–09:08 UTC) no ha entrado ninguna fila en `audit_log`.

Lo que quedó:

- **8 centros de test vivos**, con 6 niños, 24 familias, 4 aulas, 4 cursos y 2 `acuses_alta`. Todos con email `@nido.test`, creados en la ventana de esa nocturna, sin roles ni objetos en Storage.
- **28.550 filas de `audit_log` con `centro_id` NULL.** Al borrar un fixture, el DELETE en cascada de sus hijos (vínculos, tutores, firmas…) busca el centro por un padre que ya no existe y lo graba NULL. `deleteTestCentro` solo borraba la auditoría por `centro_id`, y estas se le escapaban. La purga del 30-sep (`purga-audit-log-tests.md`) las dejó fuera porque no había criterio seguro.
- **298 filas de `audit_log` con `centro_id` de centros de test:** 278 de los 8 vivos y 20 de 3 ya borrados.
- **16 usuarios `@nido.test` en Auth**, todos de esa nocturna y sin roles. **No entran en esta operación:** van en un paso aparte, por la admin API de Auth.

## El criterio de las filas con `centro_id` NULL

Está escrito en el fichero, en el CTE `basura`. Una fila cae si:

- **Es de una de las 6 tablas que caen en cascada** (`vinculos_familiares`, `familia_tutores`, `menu_dia`, `firmas_autorizacion`, `comidas`, `mensajes`) y cumple todo esto:
  - es un `DELETE`;
  - su padre (niño, familia, plantilla de menú, agenda o conversación) ya no existe y nunca apareció en la auditoría de ANAIA;
  - el usuario que referencia, si lo hay, nunca fue de ANAIA y ya no existe o es `@nido.test`;
  - su email, si lo tiene, es `@nido.test`.
- **O es de `usuarios`** (auditada desde `20261011120000`), se escribió en la ventana de la nocturna del 11-10, nunca fue de ANAIA y el usuario ya no existe o es `@nido.test`.

Diagnóstico del 12-10-2026 (solo lectura):

| Tabla                 |      Filas | Notas                                                                    |
| --------------------- | ---------: | ------------------------------------------------------------------------ |
| `vinculos_familiares` |     17.264 | Padre vivo: 0. Padre de ANAIA: 0. 5 con usuario vivo, todos `@nido.test` |
| `familia_tutores`     |      9.005 | Las 822 con email, `@nido.test`. 13 con usuario vivo, todos `@nido.test` |
| `menu_dia`            |      1.267 | Plantilla viva: 0                                                        |
| `firmas_autorizacion` |        500 | Niño vivo: 0                                                             |
| `comidas`             |        252 | Agenda viva: 0                                                           |
| `mensajes`            |        251 | Conversación viva: 0                                                     |
| `usuarios`            |         11 | Todas de la nocturna del 11-10                                           |
| **Total**             | **28.550** | **Ninguna fila con `centro_id` NULL queda fuera**                        |

Corroboración independiente: 28.415 de las 28.550 se escribieron durante un run de GitHub que corría la suite contra producción (`rls-suite.yml`, `ci-main.yml` o `ci-pr.yml`). Las otras 135 caen en días de ejecuciones locales de la suite contra el remoto (17-ago y 1-oct, entre otros).

## Qué hace la operación, en una transacción

1. **Guarda ANAIA:** 164 filas de auditoría, 4 niños y 9 roles. Si no cuadra, no toca nada.
2. **Los 8 centros**, por lista explícita, en el orden de `deleteTestCentro`. Añade `acuses_alta`, que referencia `ninos` sin cascada.
3. **Las 28.550 filas con `centro_id` NULL** del criterio.
4. **Las 298 filas** de los centros de test.
5. **Las filas que escribe la propia operación** (sus DELETE disparan el trigger de auditoría), localizadas por `xmin`: la limpieza no deja rastro de sí misma.
6. **Guarda de recuento:** cada paso borra exactamente lo aprobado, tabla por tabla.
7. **Guarda ANAIA otra vez:** 164/4/9.

## Estado tras aplicarla (verificado en vivo, 12-10-2026)

- `audit_log`: 164 filas, todas de ANAIA; 0 con `centro_id` NULL y 0 de otros centros. La más reciente sigue siendo del 10-10: la operación no dejó rastro.
- 1 centro (ANAIA), 4 niños, 9 roles, 3 familias y 4 `acuses_alta`, todos de ANAIA.

## Pendiente después

- Borrar los 16 usuarios `@nido.test` de Auth por la admin API (paso aparte).
- `VACUUM (ANALYZE) public.audit_log;` en una ejecución aparte, opcional.
