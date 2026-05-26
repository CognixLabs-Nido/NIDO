# Triggers de base de datos — NIDO

Documento sobre los triggers BEFORE/AFTER definidos sobre tablas operativas, y los patrones que el código cliente debe respetar al insertar en tablas que los tienen.

## Triggers de auto-fill: nunca confíes en sentinels

> **Aprendizaje crítico de Fase 5 post-merge** (hotfix `fix/enviar-mensaje-centro-id`). Cualquier server action que invoque un INSERT en una tabla con triggers BEFORE de auto-fill debe seguir esta regla.

### Síntoma

El server action invoca `from('tabla').insert({ col: '00000000-0000-0000-0000-000000000000', ... })` con un UUID sentinel (o cadena vacía, o cualquier valor "no significativo"), confiando en que un trigger `BEFORE INSERT` rellene la columna con el valor real. La inserción falla con `23503 — foreign key violation` o similar. El usuario solo ve el catch-all genérico (`messages.errors.envio_fallo`).

### Causa

Los triggers de auto-fill típicamente comprueban `IF NEW.col IS NULL THEN NEW.col := <valor calculado>; END IF;`. Es decir, **solo actúan cuando la columna llega como NULL**. Un UUID sentinel válido sintácticamente pasa intacto al INSERT, no dispara la rama de auto-fill, y si la columna tiene FK, viola la constraint.

Ejemplo histórico: el trigger `conversaciones_set_centro_id` autorrellena `centro_id` a partir del `nino_id` cuando `NEW.centro_id IS NULL`. El server action `enviar-mensaje.ts` pasaba `centro_id: '00000000-0000-0000-0000-000000000000'` esperando que el trigger lo sobrescribiera. El trigger no lo tocaba, y el sentinel rompía la FK contra `centros`. El bug tardó 3 días en diagnosticarse porque el catch-all i18n (`messages.errors.envio_fallo`) ocultaba el código real `23503` que sí era obvio en los logs de Supabase.

### Regla

> **El código cliente que invoca un INSERT en una tabla con triggers BEFORE de auto-fill debe:**
>
> 1. **Pasar `NULL` explícito** en las columnas que el trigger debe rellenar — nunca un sentinel ni cadena vacía; o
> 2. **Resolver el valor en el server action** explícitamente (un `SELECT ... FROM <fuente> WHERE id = ?`) y pasar el valor real al INSERT, sin delegar al trigger.
>
> La opción (2) es preferible cuando la columna es **NOT NULL en TypeScript** (forzaría a hacer `as any` para pasar NULL), o cuando quieres que el flujo de derivación quede documentado, testeable y trazable en código de aplicación, no en SQL.

### Patrón sentinel (anti-patrón)

```ts
// ❌ El trigger NO se dispara porque centro_id no es NULL
const { data, error } = await supabase
  .from('conversaciones')
  .insert({
    nino_id: input.nino_id,
    centro_id: '00000000-0000-0000-0000-000000000000', // sentinel: pasa intacto
  })
  .select('id')
  .single()
// → error 23503 FK violation contra `centros`
```

### Patrón explícito (correcto)

```ts
// ✅ Derivar centro_id del niño antes del INSERT
const { data: nino, error: ninoErr } = await supabase
  .from('ninos')
  .select('centro_id')
  .eq('id', input.nino_id)
  .maybeSingle()

if (ninoErr) return fail('messages.errors.envio_fallo')
if (!nino) return fail('messages.errors.nino_no_encontrado')

const { data, error } = await supabase
  .from('conversaciones')
  .insert({
    nino_id: input.nino_id,
    centro_id: nino.centro_id, // valor real
  })
  .select('id')
  .single()
```

### Cuándo aplica

- Tablas con trigger BEFORE de auto-fill cuya columna autocompletada es **NOT NULL** + tiene **FK**. Ejemplos en NIDO: `conversaciones.centro_id`, `agendas_diarias.centro_id`, `anuncios.centro_id` (vía `conversaciones_set_centro_id` y análogos).
- Cualquier tabla nueva que añada un trigger de este tipo: documentar en este archivo y exigir el patrón explícito en los server actions de la feature.

### Cómo se descubre

Sintomatología típica que delata el bug:

1. INSERT falla en producción con FK violation contra una tabla parent (ej. `centros`, `aulas`).
2. El código cliente parece "correcto" porque pasa un UUID válido.
3. Los logs de Supabase muestran `code: '23503'` y el nombre de la constraint.
4. El trigger BEFORE INSERT de la tabla compruba `IS NULL` antes de actuar.

Si esos 4 puntos cuadran, es este patrón. Cambia el sentinel por NULL o, mejor, deriva el valor explícitamente.

## Triggers de auto-fill conocidos

| Tabla             | Trigger                         | Columna autocompletada | Fuente del valor                       | Patrón recomendado en server actions |
| ----------------- | ------------------------------- | ---------------------- | -------------------------------------- | ------------------------------------ |
| `conversaciones`  | `conversaciones_set_centro_id`  | `centro_id`            | `SELECT centro_id FROM ninos WHERE id` | Derivar explícito en server action   |
| `agendas_diarias` | `agendas_diarias_set_centro_id` | `centro_id`            | `SELECT centro_id FROM ninos WHERE id` | Derivar explícito en server action   |
| `anuncios`        | `anuncios_set_centro_id`        | `centro_id`            | `SELECT centro_id FROM aulas WHERE id` | Derivar explícito en server action   |

> Para añadir un trigger nuevo a esta tabla, abre PR con su entrada en este documento y un test RLS de regresión equivalente a `messaging.rls.test.ts` t25/t26.
