# ADR-0019: Calendario laboral "default + excepciones" con DELETE permitido

## Estado

`accepted`

**Fecha:** 2026-05-16
**Autores:** jovimib + claude-code
**Fase del proyecto:** Fase 4.5a — Calendario laboral del centro

## Contexto

Fase 4.5 se rehízo. El modelo descartado (plantilla semanal recurrente para menús) no encajaba con la realidad operativa: festivos locales, vacaciones escolares, escuela de verano como servicio pagado aparte, jornada reducida los viernes de verano. Tras la limpieza del drift (PR #13), el módulo se divide en dos fases secuenciales:

- **Fase 4.5a (esta):** calendario laboral del centro.
- **Fase 4.5b (siguiente):** menú mensual + pase de lista comida por platos.

El calendario laboral define qué días el centro abre y de qué tipo es cada uno. Lo consultarán múltiples módulos:

- **Menús (F4.5b):** no se genera menú para días cerrados.
- **Calendario y eventos (F7):** los eventos se publican sobre el mismo grid mensual.
- **Asistencia (F4):** `/admin` puede contextualizar con "Hoy es festivo, no se espera asistencia".

Dos decisiones de modelado emergen aquí y merecen ADR conjunto porque están entrelazadas:

1. **¿Persistimos una fila por cada día del año o solo los días que se desvían del default?**
2. **¿Permitimos DELETE en `dias_centro` o seguimos el patrón habitual del proyecto (DELETE bloqueado a todos, anulación con prefijo)?**

Datos de contexto:

- Un curso académico en ANAIA dura ~10 meses (sep-jul). 365 días/año × N centros si se persiste todo.
- ANAIA tiene en torno a 12-14 festivos al año, ~20 días de vacaciones (Navidad + Semana Santa + agosto cerrado), 30-40 días de escuela de verano. Total real de overrides: ~60-80 días/año/centro.
- Los lunes-viernes son lectivos por defecto. Los sábados-domingos cerrados. Esta regla cubre el caso común sin esfuerzo.

## Opciones consideradas

### Opción A: Persistir una fila por cada día del año

Cada día del calendario académico (o todo el año) tiene su fila en `dias_centro`. Marcar un día = INSERT o UPDATE.

**Pros:**

- Modelo "rígido": fácil hacer queries sobre rangos sin pensar en defaults.
- No hay helper SQL `tipo_de_dia` con lógica de fallback — un simple `SELECT … WHERE fecha = ?` basta.

**Contras:**

- 365 filas/año/centro de golpe. Para multi-centro a futuro (10 centros = 3.650 filas/año en una tabla operativa) se acumula sin uso real.
- El alta del centro exige "rellenar el año entero antes de poder usar el calendario", o un proceso de seed feo.
- Los sábados y domingos generan ruido en `audit_log`: 104 filas/año/centro que nadie consulta.
- Modificar el algoritmo "qué se considera laborable por defecto" implica migrar datos, no solo cambiar el helper.

### Opción B: Persistir solo overrides al default

`dias_centro` contiene **únicamente** las filas que se desvían del default lun-vie=lectivo / sáb-dom=cerrado. Un helper SQL `tipo_de_dia(centro, fecha)` resuelve: si hay override, lo devuelve; si no, calcula default por ISODOW.

**Pros:**

- ~60-80 filas/año/centro en lugar de 365. 80% menos.
- Alta de centro: cero filas a sembrar. El calendario "ya funciona" desde el primer día.
- Cambiar la regla del default no exige migración: se cambia el helper.
- Audit log minimal: solo se registra lo que la directora ha marcado activamente.

**Contras:**

- Helper SQL extra (`tipo_de_dia` + `centro_abierto`) que añade ~30 líneas de plpgsql.
- Una query "dame todos los días lectivos del año" exige el helper o lógica cliente para los días sin fila — el cliente del calendario ya lo hace con `tipoDefaultDeFecha`.

### Opción C: Solo lectura del primer día del curso, sembrar a partir de ahí

Híbrido: al activar el curso académico, sembrar las 200-220 filas del periodo lectivo y dejar el resto por defecto. Solo permitir overrides sobre las filas sembradas.

**Pros:**

- Las queries sobre el rango del curso siempre tocan filas reales.

**Contras:**

- Acoplamiento entre `cursos_academicos.estado` y `dias_centro` — al cerrar un curso, ¿se borran las filas? ¿se conservan?
- "Escuela de verano" cae fuera del periodo lectivo y queda en limbo conceptual.
- Mayor complejidad que (B) sin ventaja clara para el caso real.

## Decisión

**Se elige la Opción B**: `dias_centro` persiste solo los overrides al default; un helper SQL `tipo_de_dia(centro, fecha)` resuelve el tipo de cualquier fecha mirando primero `dias_centro` y, si no hay fila, devolviendo `lectivo` para lun-vie y `cerrado` para sáb-dom.

Razones decisivas:

1. **Volumen**: ~80 filas/año/centro vs 365. Aritmética simple a favor de B.
2. **Onboarding**: el centro empieza con calendario funcional sin sembrado.
3. **Cambio de regla por defecto**: si en el futuro queremos que el centro abra los sábados puntuales, basta tocar el helper.
4. **Coherencia con el resto del modelo**: el proyecto evita "filas vacías que dicen lo mismo que el default" en otras tablas (ej. `asistencias` es lazy, ADR-0015; las agendas se crean cuando hay datos).

### DELETE permitido en `dias_centro` (excepción al patrón habitual)

El proyecto sigue una regla consistente: **DELETE bloqueado a todos los roles** (default DENY) en tablas operativas. Cuando algo se quiere anular, se hace con UPDATE de un prefijo:

- `agendas_diarias`, `comidas`, `biberones`, `suenos`, `deposiciones`: `observaciones = '[anulado] ' || …`
- `ausencias`: `descripcion = '[cancelada] ' || …`

En `dias_centro` **rompemos esta regla**. La política RLS de DELETE permite a admin del centro borrar overrides:

```sql
CREATE POLICY dias_centro_delete ON public.dias_centro
  FOR DELETE USING (public.es_admin(centro_id));
```

Justificación:

- **La ausencia de fila tiene significado semántico**: el día sigue el default (lun-vie=lectivo, sáb-dom=cerrado). No es "ningún dato" — es "el default explícito".
- **`dias_centro` no es un evento operativo, es un override de planificación.** Las agendas, asistencias y ausencias son hechos del día que se anotaron en su momento — no se reescriben. Un override de calendario es una declaración administrativa que puede ser corregida.
- **"Anular con prefijo" no aplica conceptualmente**: ¿qué significa "[cancelado] vacaciones" en un día? Confunde más que ayuda al render del calendario, que tendría que decidir si pintar el día como vacaciones o como default.
- **La trazabilidad se preserva**: el trigger de audit captura `valores_antes` con la fila completa en el DELETE. Si la directora marca-borra-marca varios días, todas las operaciones quedan en `audit_log`.

El test de RLS `dias-centro.rls.test.ts` verifica explícitamente que admin puede DELETE y que la fila se borra de verdad (vs. el patrón habitual donde DELETE no hace nada por ausencia de policy).

### Sin ventana de edición

A diferencia de las tablas operativas de F3/F4 (ADR-0013/0016), `dias_centro` **no usa `dentro_de_ventana_edicion`**. El admin puede crear, modificar o eliminar overrides para cualquier fecha (pasada, presente o futura). Razón: el calendario es planificación administrativa, no un hecho operativo del día. Corregir un festivo marcado mal tres meses después es legítimo. Documentado en spec §B y en este ADR.

## Consecuencias

### Positivas

- Modelo compacto: ~80 filas/año/centro real para ANAIA.
- Helper SQL reusable (`tipo_de_dia`, `centro_abierto`) que F4.5b (menú) y F7 (eventos) pueden invocar.
- DELETE de overrides es la UX natural — la directora pulsa "Eliminar" en un día mal marcado y el día vuelve al default. Sin estados intermedios confusos.
- Cliente puede calcular tipos default sin round-trip al servidor (helper TS `tipoDefaultDeFecha`).
- Audit log limpio: solo aparecen los cambios reales de la directora.

### Negativas

- 7 valores de ENUM `tipo_dia_centro` ampliable; añadir un nuevo tipo es un cambio de ENUM (`ALTER TYPE` requiere migración, no rollback trivial).
- "Permitir DELETE" es una excepción documentada — futuros desarrolladores deben recordar esta singularidad. El nombre del ADR y el comentario en la migración la hacen explícita.
- El cliente y el helper SQL **deben mantenerse sincronizados** en la lógica del default (lun-vie/sáb-dom). Si en el futuro cambia, hay que tocar `public.tipo_de_dia` y `src/features/calendario-centro/lib/tipo-default.ts`. Hay test unitario en cliente y test SQL en `tipo-de-dia.test.ts` que pillan derivas.

### Neutras

- Nueva tabla, nuevo ENUM, dos helpers SQL, una rama nueva en `audit_trigger_function`.
- Nuevo componente compartido `<CalendarioMensual />` en `src/shared/components/calendario/` — genérico, reusable por F7.
- Sidebars admin/teacher/family ganan un item "Calendario" cada uno.

## Limitaciones conocidas

- **Festivos manuales**: no hay importación automática de festivos oficiales (BOE estatal, BOPV autonómico, ayuntamiento). El admin los marca a mano. Para ANAIA (un centro en Valencia) son ~12-14 festivos/año, viable. La importación automática (parseo de fuentes oficiales o API tipo `nager.date`) queda **fuera de Ola 1**. Si emerge demanda real al ir multi-centro, se planifica en Ola 2.
- **Sin recurrencia anual**: marcar "Día de la Constitución 6 dic 2026 = festivo" no replica al 6 dic 2027 — hay que volver a marcarlo. La recurrencia ("este día siempre es festivo") añade complejidad (¿cómo se anula una instancia concreta?) sin uso real probado. Fuera de Ola 1.
- **Granularidad por centro, no por aula**: el calendario es del centro. Todas las aulas comparten festivos y vacaciones. ANAIA tiene 5 aulas, sin necesidad real de granularidad por aula.

## Plan de implementación

- [x] Migración `20260516125631_phase4_5a_school_calendar.sql`: ENUM, tabla, helpers, RLS (con DELETE permitido a admin), trigger de audit ampliado.
- [x] Helper TS `tipoDefaultDeFecha` espejo del helper SQL para cálculos cliente.
- [x] Schemas Zod `upsertDiaCentro`, `aplicarTipoARango`, `eliminarDiaCentro`.
- [x] Server actions correspondientes.
- [x] Queries `getCalendarioMes` (overrides del mes con holgura para overflow del grid) y `getProximosDiasCerrados` (widget compacto, horizonte 30 días, LIMIT 5).
- [x] Componente compartido `<CalendarioMensual />` agnóstico de dominio.
- [x] UI admin `/admin/calendario` con editor (popover día + dialog rango con confirmación de N días + leyenda).
- [x] UI read-only `/teacher/calendario` y `/family/calendario` + leyenda + widget en dashboards.
- [x] i18n trilingüe es/en/va.
- [x] Tests: RLS (6), functions SQL (4), audit (2), unit componente (11), unit helpers TS (6), unit schemas (9).
- [x] Playwright smoke + 2 tests diferenciales (skip por defecto).
- [ ] F4.5b (menú mensual) consumirá `tipo_de_dia` y `centro_abierto` para saber qué días tienen menú.
- [ ] F7 (eventos) reusará `<CalendarioMensual />` con su propio `renderDia`.

## Verificación

- Tests RLS verdes (`dias-centro.rls.test.ts`): admin escribe, profe/tutor leen, externos no ven nada.
- Tests functions verdes (`tipo-de-dia.test.ts`): default lun-vie, default sáb-dom, override gana, `centro_abierto` correcto.
- Test audit verde (`dias-centro-audit.test.ts`): DELETE deja `valores_antes` poblado.
- Test unit componente verde (`CalendarioMensual.test.tsx`): grid 7×6, navegación flechas, `rangoSeleccionado` resalta celdas.

## Notas

El `<CalendarioMensual />` se diseñó genérico desde día 1 igual que `<PaseDeListaTable />` (ADR-0014). Cuando F7 lo necesite para eventos, se pasará otro `renderDia` y, si hace falta, otra forma de interacción (`onClickDia` lleva ya un payload de fecha — basta para enlaces a "ver evento del día").

Si en Ola 2 emerge la necesidad de importar festivos oficiales, el patrón más limpio es un proceso server-side (Edge Function o script de seed) que llame a `upsertDiaCentro` por cada festivo descargado. La RLS solo permite admin, así que el proceso debería correr con `service_role` (bypass) o emular sesión de admin.

## Referencias

- Spec: `/docs/specs/school-calendar.md`
- ADRs relacionados:
  - ADR-0007 (RLS recursion avoidance — patrón helpers SECURITY DEFINER STABLE).
  - ADR-0011 (timezone Europe/Madrid — relevante para `hoy_madrid` en widget).
  - ADR-0013 / ADR-0016 (ventana de edición / día cerrado transversal — **NO aplica** aquí, documentado expresamente).
  - ADR-0014 (componente reusable en `shared/` — mismo patrón que `<CalendarioMensual />`).
  - ADR-0015 (lazy materialization — mismo principio que "default + excepciones" en otro dominio).
