# ADR-0022: Escala 1-5 en UI mapeada al enum `cantidad_comida` existente

## Estado

`accepted`

**Fecha:** 2026-05-16
**Autores:** jovimib + claude-code
**Fase del proyecto:** Fase 4.5b — Menús mensuales

## Contexto

Fase 3 introdujo el ENUM `cantidad_comida` con 5 valores semánticos: `nada`, `poco`, `mitad`, `mayoria`, `todo`. La UI de la agenda muestra estos valores como texto traducido ("Nada", "Poco", "La mitad", "Mayoría", "Todo").

Fase 4.5b construye el pase de lista de comida por platos. La profe quiere marcar la cantidad por celda (niño × plato) **rápido**: en una mesa con 15 niños y 3 platos en la comida, son 45 selecciones. El texto largo ("Mayoría") es más lento de procesar que un número (4).

Las profes de ANAIA pidieron explícitamente una escala **1-5**:

- 1 = nada
- 2 = poco
- 3 = la mitad
- 4 = casi todo
- 5 = todo

Decisión a tomar: ¿se crea un ENUM nuevo `cantidad_escala_1_5` con valores `1`-`5`, o se mapea la escala 1-5 al ENUM existente `cantidad_comida` (cambiando solo cómo se muestra en UI)?

## Opciones consideradas

### Opción A: Crear ENUM nuevo `cantidad_escala_1_5`

Nueva columna en `comidas` (o nueva tabla). Los valores 1-5 conviven con el enum semántico de F3.

**Pros:**

- "1-5" es un dato puro, sin ambigüedad textual.
- Si en el futuro la UI cambia (emojis, slider continuo), el mapeo no afecta a la BD.

**Contras:**

- Duplica un concepto que ya existe con 5 valores.
- Los datos de F3 ya capturados en `cantidad_comida` no se cruzan con los nuevos.
- Los informes futuros tendrían que unificar dos campos.
- Migración: si en el futuro queremos volver a "solo texto", hay que cargar.

### Opción B: Mapear 1-5 al enum `cantidad_comida` existente (la elegida)

La UI muestra botones 1-5; el batch los traduce a `nada`/`poco`/`mitad`/`mayoria`/`todo` al guardar. La BD sigue siendo idéntica a F3.

**Pros:**

- BD coherente: un solo enum captura cuánto comió un niño, sin importar quién/cuándo lo registró.
- Informes y estadísticas operan sobre un único campo.
- La UI puede iterar libremente (emojis, slider, sólo iconos) sin tocar la BD.
- F3 sigue funcionando sin cambios.

**Contras:**

- La etiqueta `mayoria` no encaja bien con el número 4 cuando se muestra como texto: en la agenda diaria, "Mayoría" suena raro en frases tipo "comió la mayoría". Tres opciones:
  - Cambiar la etiqueta textual a algo más natural como "Casi todo".
  - Aceptar que "mayoría" se ve solo en F3 (sin pase de lista).
  - Mostrar el número incluso en la agenda.

## Decisión

**Se elige la Opción B.** La escala 1-5 es una representación visual; el ENUM `cantidad_comida` es la verdad de la BD.

Además, **se cambia la etiqueta `mayoria` → "Casi todo" / "Almost all" / "Quasi tot"** en `messages/{es,en,va}.json`. El enum sigue siendo `mayoria` (cero cambio en BD); solo cambia el texto traducido visible al usuario.

Razones:

1. **No duplicar conceptos**: 5 valores semánticos cubren ya el espectro real.
2. **F3 intacto**: la agenda diaria y los registros previos siguen leyendo el mismo enum.
3. **UI flexible**: el helper `cantidadANumero` / `numeroACantidad` (`src/features/menus/lib/escala.ts`) aísla el mapeo en un único lugar testeable.
4. **"Casi todo" es mejor**: la palabra "Mayoría" en frase ("comió la mayoría") es forzada en español natural. "Casi todo" lee mejor y aplica a F3 y F4.5b por igual.

## Consecuencias

### Positivas

- BD coherente entre F3 y F4.5b.
- Helpers TS para mapeo bidireccional con tests unitarios.
- Cambio de etiqueta minimal: 3 strings en JSON.
- Cualquier sitio que muestre la cantidad (agenda familia, agenda profe, informes futuros, audit log de cambios) lee del mismo enum.

### Negativas

- Los datos pre-F4.5b con `mayoria` se muestran ahora como "Casi todo" en la agenda. Esto es intencional: el sentido del valor no cambió, solo la palabra usada para describirlo.
- Si alguien dependiera del texto exacto "Mayoría" en una integración externa (no hay), se rompería.

### Neutras

- `src/features/menus/lib/escala.ts` con `cantidadANumero`, `numeroACantidad`, `ESCALA_1_5_OPTIONS`.
- Tests unit del mapeo bidireccional (3 casos).
- Cambio i18n verificado a mano: la agenda de F3 sigue renderizando sin errores; ningún texto hardcoded en código.

## Plan de implementación

- [x] Helper `src/features/menus/lib/escala.ts`.
- [x] Tests unitarios del mapeo.
- [x] UI del pase de lista muestra `1`-`5` como label en botones.
- [x] i18n: `agenda.cantidad_comida_opciones.mayoria` actualizado en es/en/va.
- [x] Verificación manual: ningún sitio en `src/` hardcodea la palabra anterior.

## Verificación

- Tests `escala.test.ts` verdes.
- `grep -rn "Mayoría\|Most\|Majoria"` en `src/` no devuelve nada con esa cantidad como texto.
- F3 RLS y audit tests siguen verdes (no cambia el comportamiento de la BD).

## Referencias

- Spec: `/docs/specs/menus.md` §B58.
- ADRs relacionados: ADR-0014 (componente pase de lista), ADR-0020 (plantilla mensual), ADR-0021 (extensión `comidas`).
- ENUM `cantidad_comida` definido en migración F3 `20260515153711_phase3_daily_agenda.sql`.
