# ADR-0017: Plantilla de menú por día de semana, no por fecha específica

## Estado

`accepted`

**Fecha:** 2026-05-16
**Autores:** jovimib + claude-code
**Fase del proyecto:** Fase 4.5 — Menús + pase de lista comida batch

## Contexto

Fase 4.5 introduce un módulo de menús semanales del centro. Cada centro define qué se cocina cada día (desayuno, media mañana, comida, merienda) y esa información se usa en dos puntos:

1. **Pase de lista batch de comida** (`/teacher/aula/[id]/comida`): pre-rellena la descripción de cada `comidas.descripcion` con el menú del día, dejando a la profe solo marcar la cantidad.
2. **Widget "Menú del día"** en `/family/nino/[id]`: la familia ve qué se le sirvió ese día como referencia.

La pregunta de diseño: ¿cómo se modela "lo que se cocina cada día"?

- Por **día concreto** (`plantilla_menu_dia(plantilla_id, fecha, ...)`): cada día tiene su propio menú. Permite excepciones (festivos, fiestas, jornadas especiales).
- Por **día de la semana** (`plantilla_menu_dia(plantilla_id, dia_semana, ...)`): el menú se repite ciclicamente lunes-viernes. Más compacto.

Restricciones del producto cerradas en Ola 1:

- El centro inicial (ANAIA) tiene **menús semanales estables**. Las excepciones son raras (3-4 al año).
- F4.5 es una fase **puente** entre F4 y F5: scope minimal, 6-10h máximo según roadmap.
- La spec puede crecer en Ola 2 si las profes piden excepciones, pero no debe meter complejidad innecesaria ahora.
- La plantilla NO materializa filas en `comidas` (ver ADR-0018): la descripción se copia al rellenar el pase de lista.

## Opciones consideradas

### Opción A: Día de la semana (elegida)

```sql
CREATE TABLE plantilla_menu_dia (
  id UUID PK,
  plantilla_id UUID FK,
  dia_semana ENUM('lunes', 'martes', 'miercoles', 'jueves', 'viernes'),
  desayuno TEXT NULL, media_manana TEXT NULL, comida TEXT NULL, merienda TEXT NULL,
  UNIQUE (plantilla_id, dia_semana)
);
```

Una plantilla = 5 filas máximo (una por día laborable). El helper `menu_del_dia(centro, fecha)` resuelve `EXTRACT(ISODOW FROM fecha)` y devuelve la fila correspondiente.

**Pros:**

- Mínimo trabajo del admin: 5 entradas por plantilla, no 365.
- Tabla compacta — incluso con N plantillas archivadas, son N×5 filas máximo.
- Resolución por fecha trivial (función SQL con CASE sobre ISODOW).
- Encaja con cómo razona el centro: "los lunes hay lentejas, los martes pasta…".
- Modelo extensible: si Ola 2 quiere excepciones por fecha, se añade una nueva tabla `plantilla_menu_excepcion(plantilla_id, fecha, ...)` que **sobrescribe** lo que diga el día de semana. No requiere migración disruptiva.

**Contras:**

- Festivos / días especiales no son modelables en Ola 1. Si un viernes hay menú especial, hoy se gestiona vía override por niño (la profe edita la descripción en el pase de lista).
- Sábados y domingos no tienen menú (el ENUM `dia_semana` solo cubre lunes-viernes). Coherente con que el centro no abre fines de semana, pero no extensible si en el futuro abriera.

### Opción B: Día concreto (fecha específica)

```sql
CREATE TABLE plantilla_menu_dia (
  id UUID PK,
  plantilla_id UUID FK,
  fecha DATE NOT NULL,
  desayuno TEXT NULL, media_manana TEXT NULL, comida TEXT NULL, merienda TEXT NULL,
  UNIQUE (plantilla_id, fecha)
);
```

Una plantilla = un menú por cada día calendario. El helper `menu_del_dia(centro, fecha)` busca por `fecha` directa.

**Pros:**

- Excepciones gratis: festivos, fiestas, jornadas especiales se modelan como una fila más.
- Más natural si el admin quisiera ver "el menú del 15 de octubre".

**Contras:**

- 5× el trabajo del admin: cada plantilla mensual son ~20 filas, anual ~250. Insostenible sin import desde PDF o duplicación automática.
- Si el menú se repite ciclicamente (caso común), el admin lo duplica 4 veces al mes.
- Sin import / duplicación, en la práctica nadie va a rellenar 20 filas en cada plantilla → resultado: menús incompletos.
- Una vez creada la plantilla, modificar "los lunes son ahora con menú X" implica editar N filas, no 1.

### Opción C: Ambos (día de semana + excepciones por fecha)

`plantilla_menu_dia(plantilla_id, dia_semana)` + `plantilla_menu_excepcion(plantilla_id, fecha)`.

El helper `menu_del_dia` busca primero excepción por fecha; si no encuentra, cae al día de semana.

**Pros:**

- Cubre el 100% de casos.

**Contras:**

- 2 tablas, 2 índices únicos, lógica de fallback en el helper, UI más compleja en el admin (¿cómo navega entre la plantilla base y las excepciones?).
- Sobre-diseño para Ola 1 si ANAIA no necesita excepciones.

## Decisión

**Se elige la Opción A** (día de semana) porque:

- Cubre el caso de uso real de ANAIA y la mayoría de centros infantiles 0-3 (menús semanales estables).
- Mantiene F4.5 minimal en línea con el roadmap (~8h totales).
- La extensión a Opción C es **aditiva**, no destructiva: si Ola 2 pide excepciones, se añade `plantilla_menu_excepcion` sin romper la tabla actual.

La spec deja explícitamente fuera del alcance las excepciones por fecha (ver "Fuera" en `docs/specs/menus.md`).

## Consecuencias

### Positivas

- Admin rellena 5 filas por plantilla. Tabla pequeña.
- Helper `menu_del_dia` simple: CASE sobre `EXTRACT(ISODOW FROM fecha)`, sin lookup por fecha.
- ENUM `dia_semana` cerrado (5 valores) hace la BD type-safe.
- Coherente con cómo se planifica menú en cocina real ("lunes = lentejas").

### Negativas

- Festivos no modelables sin override manual fila a fila en el pase de lista. El admin no puede "decir" "el 15 de octubre cocinamos paella" desde la plantilla.
- Si el centro abre sábados (caso minoritario en 0-3), el modelo no lo soporta. Habría que ampliar el ENUM.

### Neutras

- El helper `menu_del_dia` usa `ISODOW` (lunes=1..viernes=5, domingo=7) en lugar de `DOW` (domingo=0..sábado=6). Más natural para CASE sobre `dia_semana`.
- El ENUM lleva acentos transcritos en ASCII (`miercoles` sin acento) por compatibilidad con Postgres ENUMs. Las traducciones (`Miércoles`) viven en i18n.

## Plan de implementación

- [x] Tabla `plantilla_menu_dia` con UNIQUE (plantilla_id, dia_semana).
- [x] ENUM `dia_semana` con valores lunes..viernes.
- [x] Helper `menu_del_dia(centro, fecha)` con ISODOW + CASE.
- [x] Tests SQL: lunes con datos, sábado/domingo vacío, fuera de vigencia vacío, archivada vacío.
- [x] UI admin con 5 cards (uno por día), 4 textareas (uno por momento).
- [ ] **Ola 2 si las profes lo piden**: tabla `plantilla_menu_excepcion(plantilla_id, fecha, ...)` + lookup en el helper.

## Verificación

- Test `menu_del_dia('2026-02-02')` (lunes) devuelve datos.
- Test `menu_del_dia('2026-02-07')` (sábado) devuelve cero filas.
- Test `menu_del_dia('2026-02-08')` (domingo) devuelve cero filas.

## Referencias

- Spec: `docs/specs/menus.md` (US-33, alcance, modelo de datos).
- ADRs relacionados: ADR-0018 (lazy materialization de comidas desde plantilla).
- Migración: `supabase/migrations/20260516000000_phase4_5_menus.sql`.
