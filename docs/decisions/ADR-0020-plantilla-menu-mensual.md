# ADR-0020: Plantilla de menú mensual (un día = un menú propio)

## Estado

`accepted`

**Fecha:** 2026-05-16
**Autores:** jovimib + claude-code
**Fase del proyecto:** Fase 4.5b — Menús mensuales

## Contexto

La Fase 4.5 inicial intentó modelar los menús con una **plantilla semanal recurrente** (lunes-viernes con N platos por momento) que aplicaba a todas las semanas del año. Tras Checkpoint B se descartó (PR #12 cerrado sin merge, drift limpiado en PR #13).

La realidad operativa de ANAIA (y de cualquier centro infantil en España):

- ~12-14 festivos al año dispersos por todo el calendario.
- Vacaciones escolares con duración variable (Navidad, Semana Santa, todo agosto).
- Escuela de verano como servicio aparte (julio-agosto), con su propio menú.
- Jornada reducida en periodos específicos (último viernes de verano, vísperas de festivo).
- Cambios de menú por temporada (gazpacho en verano, potajes en invierno) que no se repiten semana a semana.

Un modelo semanal recurrente:

- No puede expresar "este martes es festivo, no hay menú".
- Obliga a un mecanismo de "overrides por día" que duplica complejidad.
- No encaja con cómo la cocina de ANAIA planifica (mes natural, no semana repetitiva).

Tras la limpieza del drift, se rediseña en dos fases:

- **F4.5a (mergeada)**: calendario laboral del centro (`dias_centro`, helpers `tipo_de_dia` / `centro_abierto`).
- **F4.5b (esta)**: menús **mensuales** que se apoyan en el calendario laboral.

## Opciones consideradas

### Opción A: Plantilla semanal recurrente (descartada)

`plantillas_menu` con 5 días × 4 momentos × N platos. Una sola plantilla "activa" por centro. Para festivos/vacaciones: una tabla de overrides.

**Pros:**

- Pocas filas en producción.
- Una vez creada, los lun-vie del año aplican automáticamente.

**Contras:**

- No expresa naturalmente "esta semana en Navidad el centro abre 3 días con menú especial".
- El mecanismo de overrides explota la complejidad: ¿cómo se resuelve un override de "semana 3 de octubre, jueves, 1er plato"?
- No coincide con cómo la cocina entrega los planning (PDF mes por mes).
- Edición sería incremental y poco visual; la directora pierde la visión global del mes.

### Opción B: Un menu_dia por cada día del año

365 filas/año/centro persistidas siempre. Sin plantilla padre.

**Pros:**

- Modelo "rígido", queries simples.
- Sin estado intermedio (no hay borrador / publicada / archivada).

**Contras:**

- 365 filas vacías para días cerrados.
- Sin agrupación, no hay forma de "publicar" un mes ni de "deshacer" cambios masivos.
- El editor del admin necesita un punto de partida — sin plantilla padre, ¿qué se edita?

### Opción C: Plantilla mensual + N menu_dia por mes (la elegida)

`plantillas_menu_mensual` (id, centro_id, mes, anio, estado) + `menu_dia` (1 fila por día con menú). La plantilla agrupa los N días del mes para edición y publicación en bloque.

**Pros:**

- Coincide con la realidad operativa (la cocina entrega menú mes a mes).
- Soporta estados borrador/publicada/archivada para que el admin pueda preparar el mes siguiente mientras el actual sigue activo.
- Una sola `publicada` por (centro, mes, anio) garantizada por índice único parcial.
- Cualquier día puede sobrescribirse sin tocar el resto del mes (caso "cambio de última hora").
- Cero menus para días cerrados (`menu_dia` solo donde la directora ha definido algo); la query del pase de lista resuelve `centro_abierto` aparte.
- Permite múltiples borradores históricos sin contaminar el "menú activo".

**Contras:**

- ~22 filas `menu_dia` por mes (en lugar de 7 semanales). Aritmética: 22 × 12 = 264 filas/año/centro. Aceptable.
- La directora tiene que rellenar mes a mes — no hay "auto-completar la próxima semana con la anterior". Pero como cada mes es distinto en la realidad, no es trabajo perdido.

## Decisión

**Se elige la Opción C.** El menú es **mensual**, un `menu_dia` por día abierto del mes. Estados: `borrador` (en edición), `publicada` (visible para profes y familias), `archivada` (histórico).

Razones decisivas:

1. **Fidelidad operativa**: coincide con cómo la cocina planifica.
2. **Calendario como base**: F4.5a ya resolvió "qué días abre el centro"; F4.5b consume `centro_abierto` para saber qué días tienen menú.
3. **Estados claros**: borrador permite trabajar en el mes siguiente sin pisar el actual; publicar archiva la versión previa automáticamente.
4. **Cero acoplamiento con la asistencia/agenda**: las plantillas no saben de niños; los menús se materializan en `comidas` por niño al pasar lista.

## Consecuencias

### Positivas

- Modelo limpio: editor mensual con el calendario completo a la vista.
- Una `publicada` por mes/centro garantizada por BD (índice único parcial).
- "Cambio de última hora": editar `menu_dia` directamente sin re-publicar.
- Audit log captura cada cambio en plantillas y menu_dia.

### Negativas

- Volumen de filas mayor que el modelo semanal recurrente (no significativo).
- El admin tiene que rellenar todos los días del mes (caso real: ~22 días lectivos).

### Neutras

- Nuevo ENUM `estado_plantilla_menu` (3 valores).
- 2 tablas operativas nuevas.
- Helper `menu_del_dia(centro, fecha)` para resolución directa.

## Plan de implementación

- [x] Migración con 2 tablas + 1 ENUM + helpers + RLS + audit.
- [x] Server actions: crear, guardar-batch, publicar, archivar.
- [x] UI admin con `<CalendarioMensual />` + panel de día.
- [x] Días cerrados (vía `centro_abierto`) atenuados y NO clickables.
- [x] Botón "Guardar mes" único + indicador dirty.
- [x] UI profe del pase de lista que consume el menú publicado.
- [x] UI familia del widget "Menú del día".

## Verificación

- Tests RLS verdes (aislamiento, admin vs profe/tutor, DELETE rechazado).
- Tests functions `menu_del_dia` verdes (publicada gana, borrador no entra, NULL si no hay).
- Tests audit verdes en `plantillas_menu_mensual` y `menu_dia`.
- Trigger BD que valida "fecha dentro del mes de la plantilla" verde (INSERT y UPDATE).

## Referencias

- Spec: `/docs/specs/menus.md`.
- ADRs relacionados: ADR-0014 (componente pase-de-lista), ADR-0019 (calendario laboral), ADR-0021 (extensión `comidas`), ADR-0022 (escala 1-5).
- Spec calendario laboral: `/docs/specs/school-calendar.md`.
