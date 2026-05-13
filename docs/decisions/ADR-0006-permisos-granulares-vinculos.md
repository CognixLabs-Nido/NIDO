# ADR-0006: Permisos granulares JSONB en `vinculos_familiares` desde Ola 1

## Estado

`accepted`

**Fecha:** 2026-05-13
**Autores:** Iker Milla, claude-code
**Fase del proyecto:** Fase 2 — Entidades core

## Contexto

`vinculos_familiares` modela la relación entre un usuario (con rol `tutor_legal` o `autorizado`) y un niño. La familia "no es un solo permiso": un tutor legal típicamente quiere acceso a TODO, pero un autorizado a recoger no tutor (cuidadora, abuela puntual) solo quiere lo mínimo. Y dentro de los tutores también hay matices: un padre separado puede tener legalmente el derecho de ver la agenda pero no de firmar autorizaciones nuevas.

La pregunta de diseño: ¿modelamos los permisos como flags discretas desde el inicio, o usamos un único "tipo" (tutor / autorizado) y dejamos el detalle para más adelante?

## Opciones consideradas

### Opción A: JSONB `permisos` con keys booleanas, defaults por `tipo_vinculo` (elegida)

```sql
permisos jsonb NOT NULL DEFAULT '{}'::jsonb
```

Las keys son fijas (definidas en `src/features/vinculos/schemas/vinculo.ts`):

```typescript
PERMISOS_KEYS = [
  'puede_recoger',
  'puede_ver_agenda',
  'puede_ver_fotos',
  'puede_ver_info_medica',
  'puede_recibir_mensajes',
  'puede_firmar_autorizaciones',
  'puede_confirmar_eventos',
]
```

Permisos por defecto al crear el vínculo según `tipo_vinculo`:

- `tutor_legal_principal`, `tutor_legal_secundario`: TODOS los flags `true`.
- `autorizado`: TODOS los flags `false`.

La UI completa de toggles por flag queda para Ola 2. En Ola 1 los permisos se crean con sus defaults y no se editan desde la UI todavía.

**Pros:**

- Estructura preparada para Ola 2 sin migración disruptiva: solo hay que añadir UI.
- Las helpers RLS `tiene_permiso_sobre(nino_id, permiso_key)` ya están construidas y son testeables.
- Política RLS `ime_tutor_select` ya filtra por `puede_ver_info_medica`, lo que valida el modelo desde día 1.
- JSONB acomoda permisos futuros sin migración de esquema: si en Ola 3 aparece `puede_solicitar_reuniones`, basta con añadir la key al frontend y al default.

**Contras:**

- JSONB con keys "fijas" no es estrictamente type-safe a nivel BD. Mitigación: las keys están constantes en `PERMISOS_KEYS` y las helpers RLS los referencian.
- Indexar JSONB sobre keys concretas requiere índices funcionales o GIN. No necesario en Ola 1 (volumen pequeño).

### Opción B: Columnas booleanas por permiso

`puede_recoger boolean`, `puede_ver_agenda boolean`, etc.

**Pros:**

- Type-safe.
- Indexables sin trucos.

**Contras:**

- Cada permiso nuevo = migración + actualización de RLS + actualización de cliente. Friction para una zona del modelo que va a evolucionar.
- Schema más rígido cuando Ola 2 introduzca grupos de permisos (por ejemplo "permisos de comunicación" que junte varios flags).

### Opción C: Modelo single-tipo, sin permisos granulares en Ola 1

Solo `tipo_vinculo` (tutor/autorizado), y los permisos se derivan en código.

**Pros:**

- Más simple en Ola 1.

**Contras:**

- Cuando Ola 2 quiera "tutor sin acceso a info médica" o "autorizado que sí puede ver agenda", hay que añadir la columna JSONB de todas formas + migrar todas las filas existentes con valores derivados del tipo. Es una deuda diferida sin ahorro real.
- Las queries RLS sobre datos médicos no pueden distinguir tipos de tutor — todos los `tutor_legal` ven todo, no hay forma de excepcionar.

### Opción D: Tabla relacional `vinculo_permisos (vinculo_id, permiso_key)`

Cada permiso activo es una fila.

**Pros:**

- Normalizada.

**Contras:**

- Sobrediseño: cada flag necesita JOIN o subquery.
- Las RLS policies pasan de `(permisos ->> 'puede_ver_info_medica')::bool` a `EXISTS (SELECT 1 FROM vinculo_permisos ...)`, lo que reintroduce el riesgo de recursión RLS documentado en ADR-0007.

## Decisión

**Se elige la Opción A: JSONB con keys fijas y defaults por tipo.**

```sql
CREATE TABLE public.vinculos_familiares (
  ...
  permisos jsonb NOT NULL DEFAULT '{}'::jsonb,
  ...
);
```

```typescript
export function permisosDefault(
  tipo: 'tutor_legal_principal' | 'tutor_legal_secundario' | 'autorizado'
) {
  const habilitado = tipo === 'autorizado' ? false : true
  return Object.fromEntries(PERMISOS_KEYS.map((k) => [k, habilitado]))
}
```

El server action `crearVinculo` aplica los defaults al INSERT. Las helpers RLS leen `permisos ->> '<key>'` con cast a boolean.

## Consecuencias

### Positivas

- Modelo estable y preparado para Ola 2 desde Ola 1.
- La política RLS `ime_tutor_select` ya valida el modelo: un tutor con `puede_ver_info_medica=true` ve la fila médica; sin el permiso, no.
- Tests RLS `info-medica.rls.test.ts` cubren la diferenciación (un tutor con permiso lee, otro sin permiso devuelve array vacío).
- Cuando llegue la UI completa de gestión de permisos en Ola 2, solo hay que escribir el componente y el server action `updateVinculoPermisos`, todo lo demás queda intacto.

### Negativas

- En Ola 1, la UI no permite editar los permisos por flag (read-only). Para casos límite (un padre separado que no puede ver agendas, etc.) hay que editar manualmente en Supabase Dashboard hasta Ola 2.
- Las keys de permisos son una constante del cliente, no del BD: un dev podría escribir mal una key en una query nueva. Mitigación: usar el helper `tiene_permiso_sobre(nino_id, p_permiso text)` y typar el segundo argumento con `PermisoKey` en TypeScript.

### Neutras

- Las keys `puede_*` están en español por consistencia con el resto del schema (las tablas y columnas son en español; el código es en inglés salvo identificadores de dominio).

## Plan de implementación

- [x] Columna `permisos jsonb NOT NULL DEFAULT '{}'` en `vinculos_familiares`.
- [x] `PERMISOS_KEYS` y `permisosDefault()` en `src/features/vinculos/schemas/vinculo.ts`.
- [x] Helper RLS `public.tiene_permiso_sobre(nino_id uuid, permiso text)`.
- [x] Server action `crearVinculo` que aplica defaults por tipo.
- [x] Tests RLS de aislamiento + permiso médico.
- [ ] **Ola 2**: UI de toggles por flag para que el admin pueda ajustar permisos manualmente. Server action `actualizarPermisosVinculo`. Auditoría de cambios de permisos.

## Verificación

- Test `src/test/rls/info-medica.rls.test.ts`:
  - Tutor con `puede_ver_info_medica=true` puede leer (data length ≥ 1).
  - Tutor con `puede_ver_info_medica=false` no lee (data length = 0, sin error).
- Schema Zod `crearVinculoSchema` valida la entrada antes del INSERT.

## Notas

- Los defaults son una decisión de producto: el tutor legal "merece todo" salvo decisión judicial; el autorizado "solo lo explícito". Si Ola 2 introduce roles más matizados (por ejemplo "tutor con custodia limitada"), añadimos defaults nuevos al helper sin tocar la estructura.
- La política RLS de `vinculos_familiares` permite al propio usuario ver sus vínculos (`vinculos_self_select`), así que un tutor puede comprobar sus propios permisos sin pasar por admin.

## Referencias

- Spec: `docs/specs/core-entities.md` (B14)
- Migración: `supabase/migrations/20260513202012_phase2_core_entities.sql`
- Schema: `src/features/vinculos/schemas/vinculo.ts`
- Server action: `src/features/vinculos/actions/crear-vinculo.ts`
