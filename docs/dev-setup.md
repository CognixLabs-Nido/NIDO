# Dev setup — NIDO

Guía operativa para arrancar el proyecto en local y trabajar contra Supabase Cloud. La fuente de verdad sigue siendo `CLAUDE.md`; este documento captura detalles que se descubren al integrar.

## Pre-requisitos

- Node 22+ y npm.
- `direnv` instalado y autorizado en el directorio del proyecto (`direnv allow`). El `.envrc` carga `.env.local` y fija `PROJECT_NAME=nido`, además de cambiar la cuenta `gh` a `CognixLabs-Nido`.
- Una cuenta GitHub asociada a `CognixLabs-Nido` y autenticada con `gh auth login`.
- Acceso al proyecto Supabase `ttroedkdgomfmohgojvg` (NIDO Cloud).
- **No** se necesita Docker. Trabajamos directamente contra el remoto: `supabase db push`, `supabase gen types --project-id`, etc.

## Arranque

```bash
cd /ruta/al/proyecto/NIDO
direnv allow      # solo la primera vez
npm install
npm run dev       # http://localhost:3000
```

## Comandos esenciales (resumen)

Ver tabla completa en `CLAUDE.md`. Notas operativas:

- **`npm run db:types`** — Apunta a `--project-id ttroedkdgomfmohgojvg` (proyecto remoto), **no** a `--local`. Esto se cambió en Fase 2; tras `supabase db push` regenera siempre los types.
- **`npx supabase migration new <nombre>`** — Crea archivo con timestamp UTC en `supabase/migrations/`. Editar y luego `db push`.
- **`npx supabase db push`** — Aplica las migraciones pendientes al remoto. Si una migración falla en medio, Postgres hace ROLLBACK transaccional (las anteriores aplicadas en la misma sesión sí se mantienen).

## Variables de entorno

Definidas en `.env.local` (gitignored). Cargadas por direnv vía `dotenv .env.local`. Las que importan a la app son las `NEXT_PUBLIC_*` (anon key, URL pública), el `SUPABASE_SERVICE_ROLE_KEY` (solo server-side) y `SUPABASE_ACCESS_TOKEN` (CLI de Supabase).

**Las credenciales nunca van en código.** Si falta una variable, pídela al responsable; nunca hardcodear.

## Tests

- **Vitest unit:** `npm test` corre todo (`src/**/*.test.ts`). Para un archivo: `npx vitest run path/al/archivo`.
- **Vitest RLS:** los tests en `src/test/rls/` y `src/test/audit/` se ejecutan contra el proyecto remoto. Crean usuarios y entidades con prefijo `rls-*@nido.test` y los limpian en `afterAll`.
- **Playwright E2E:** `npm run test:e2e`. Arranca `npm run start` automáticamente (requiere `npm run build` previo) en puerto 3000.

## Migraciones — patrones que hay que recordar

### Búsqueda de schema (`search_path`) y extensiones

**Patrón obligatorio para futuras migraciones.** Supabase Cloud instala las extensiones (pgcrypto, uuid-ossp, etc.) en el schema `extensions`, no en `public`. Una función `SECURITY DEFINER` con `SET search_path = public` **no encuentra** `pgp_sym_encrypt`, `uuid_generate_v4` y similares.

```sql
-- ❌ Antipatrón: la función no encuentra pgp_sym_encrypt
CREATE OR REPLACE FUNCTION public.cifrar(p text)
RETURNS bytea LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN pgp_sym_encrypt(p, 'clave');  -- ERROR 42883: function pgp_sym_encrypt(text, unknown) does not exist
END; $$;

-- ✅ Patrón correcto: incluir extensions en el search_path
CREATE OR REPLACE FUNCTION public.cifrar(p text)
RETURNS bytea LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
BEGIN
  RETURN pgp_sym_encrypt(p, 'clave');
END; $$;
```

Esto se aprendió por las malas en Fase 2 (ver `supabase/migrations/20260513214411_phase2_fix_pgcrypto_search_path.sql`). En cualquier función que use:

- `pgp_sym_encrypt`, `pgp_sym_decrypt`, `crypt`, `gen_random_bytes`, `digest` (pgcrypto)
- `uuid_generate_v4`, `uuid_generate_v1mc` (uuid-ossp; en Supabase también está `gen_random_uuid()` de pgcrypto disponible vía `public`)
- Cualquier otra función de extensión en `extensions`

…añadir `extensions` al `search_path`. La forma canónica:

```sql
SET search_path = public, extensions
```

`public` primero para que las tablas de la app se resuelvan sin prefijo; `extensions` después para que las funciones de extensión también.

### Políticas RLS y recursión

Otro aprendizaje de Fase 2: las políticas RLS con `(SELECT col FROM otra_tabla WHERE ...)` inline disparan recursión cuando dos tablas se referencian cruzadamente. **Patrón obligatorio**: encapsular los lookups en funciones `SECURITY DEFINER` (`centro_de_nino`, `es_profe_de_nino`, etc.). Ver [ADR-0007](./decisions/ADR-0007-rls-policy-recursion-avoidance.md) para el detalle completo.

### Secretos en Supabase Vault

NIDO usa Supabase Vault para la clave de cifrado de datos médicos (`name = 'medical_encryption_key'`). El patrón de acceso desde funciones SECURITY DEFINER:

```sql
DECLARE
  v_clave text;
BEGIN
  SELECT decrypted_secret INTO v_clave
  FROM vault.decrypted_secrets
  WHERE name = 'medical_encryption_key';

  IF v_clave IS NULL THEN
    RAISE EXCEPTION 'Clave no configurada en Vault'
      USING HINT = 'Crear secreto en Dashboard → Vault → New secret';
  END IF;
  -- usar v_clave con pgcrypto
END;
```

Justificación completa en [ADR-0004](./decisions/ADR-0004-cifrado-datos-medicos-pgcrypto.md) (a crear en Fase 2). El bloque `DO $$ ... $$` al final de la migración principal verifica que Vault tiene el secreto antes de aplicar — si falta, la migración hace rollback completo.

## Componente Select: prop `items` obligatoria

NIDO usa el componente `Select` de shadcn/ui sobre `@base-ui/react/select`. **Patrón obligatorio**: cuando el `Select` represente entidades cuyo `value` no es human-readable (UUIDs, sentinelas, IDs internos), se pasa el prop `items` al `<Select>` con la forma `{ value, label }`. Sin esto, `<SelectValue>` renderiza el value crudo en el trigger tras la selección — el dropdown sí muestra el children del `<SelectItem>`, pero el trigger no.

### Por qué pasa

`@base-ui/react/select` (`Select.Value`) sólo busca el label asociado al value seleccionado cuando se le entrega la lista de items en el Root. Sin `items`, la implementación cae en un `fallback()` que devuelve `String(value)`. Eso significa:

- Select sobre aulas con `value={aula.id}` → trigger muestra UUID.
- Select sobre estado con `value="__null__"` → trigger muestra `__null__`.
- Select sobre roles con `value={rol_id}` → trigger muestra el id de la fila.

Ver `node_modules/@base-ui/react/esm/internals/resolveValueLabel.js` (función `resolveSelectedLabel`) para el detalle.

### Antipatrón

```tsx
// ❌ Trigger renderiza el UUID literal tras seleccionar
<Select value={field.value} onValueChange={field.onChange}>
  <SelectTrigger>
    <SelectValue placeholder="Selecciona un aula" />
  </SelectTrigger>
  <SelectContent>
    {aulas.map((a) => (
      <SelectItem key={a.id} value={a.id}>
        {a.nombre}
      </SelectItem>
    ))}
  </SelectContent>
</Select>
```

### Patrón correcto

```tsx
// ✅ Trigger renderiza el label legible tras seleccionar
const aulaItems = aulas.map((a) => ({
  value: a.id,
  label: a.nombre,
}))

<Select items={aulaItems} value={field.value} onValueChange={field.onChange}>
  <SelectTrigger>
    <SelectValue placeholder="Selecciona un aula" />
  </SelectTrigger>
  <SelectContent>
    {aulaItems.map((item) => (
      <SelectItem key={item.value} value={item.value}>
        {item.label}
      </SelectItem>
    ))}
  </SelectContent>
</Select>
```

### Cuándo aplica

Siempre que el `value` no sea ya el texto que quieres mostrar:

- **Selects sobre filas de BD** (aulas, niños, usuarios, cursos): `value=id`, `label=nombre`.
- **Enums con sentinela para `null`**: en lugar de un sentinela string (`'__null__'`), pasa `value: null` directamente en `items` — `@base-ui/react` acepta null como valor cuando aparece en la lista.
- **Enums con etiqueta i18n**: `value='F'`, `label=t('sexo_opciones.F')`. El label debería venir de las funciones de traducción, no de strings hardcoded.

### Cuándo NO aplica

Cuando el `value` ya **es** el texto que quieres mostrar (selects de idioma `value="es"` que muestra "es" literal, selects de día de la semana con value 'Lunes', etc.). En esos casos `items` es redundante; el componente puede seguir funcionando con el patrón inline. Aun así, mantener `items` por consistencia no estorba.

### Casos descubiertos por las malas

Estos dos bugs se arreglaron en `chore/post-phase-2-fixes-v2`:

- Wizard `/admin/ninos/nuevo` paso 1: dropdown de "Sexo" mostraba `__null__` antes de seleccionar.
- Wizard `/admin/ninos/nuevo` paso 3: select de aula mostraba UUID en el trigger tras elegir.

Ambos resueltos pasando `items` con `{ value, label }`.

## Regeneración de logos NIDO

El logo definitivo de NIDO vive como PNG en `public/brand/source/nido-logo-source.png`. A partir de ese source, el script `scripts/process-logos.mjs` genera las variantes consumidas por la app (full, wordmark, mark, favicon, iconos PWA).

```bash
# Regenerar todas las variantes desde el source actual
node scripts/process-logos.mjs
```

Reglas operativas:

- **Idempotente**: ejecutarlo sin cambiar el source produce un diff vacío en git. Si ves cambios, el source se ha modificado o `sharp` ha cambiado de versión.
- **Manual**: el script **no** se ejecuta en `next build` ni en CI. Los PNG procesados están commiteados en `public/brand/`.
- **`sharp` como devDependency**: se instala con `npm install` automáticamente. No queda en el bundle de producción.
- **Cuándo correrlo**: cuando el responsable actualice el source PNG (nuevo logo, ajuste de threshold, llegada del SVG vectorial). Tras correrlo, `git status` debe mostrar cambios en `public/brand/*` que se commitean en el mismo PR que el source.
- **Threshold**: el script aplica un threshold de luminancia para volver el fondo negro transparente. Si el source cambia mucho (por ejemplo, pasa a tener fondo blanco), revisar `THRESHOLD_LUMINANCE` en el script.

Ver `docs/decisions/ADR-0008-design-system.md` para el plan de sustitución por la versión vectorial definitiva.

## Onboarding del primer admin (Ola 1)

Hasta que aparezca el flow de "alta de centro" en Ola 2, el primer admin de cada centro se crea manualmente:

1. En Supabase Dashboard → Authentication → Users → Add user (con email y contraseña).
2. En SQL Editor:
   ```sql
   INSERT INTO public.roles_usuario (usuario_id, centro_id, rol)
   VALUES ('<UUID-del-user>', '<UUID-del-centro>', 'admin');
   ```
3. El admin puede entrar a `/{locale}/login` y desde ahí invitar a profes y tutores.

Para ANAIA, el centro es `33c79b50-13b5-4962-b849-d88dd6a21366` (sembrado en la migración de Fase 2 preservando el UUID elegido al darme rol en Fase 1).

## Troubleshooting

- **`Cannot connect to the Docker daemon`** al correr `npm run db:types`: el script apuntaba a `--local`. Cambiado en Fase 2 a `--project-id`. Si aparece de nuevo, revisar `package.json`.
- **Etiqueta `<claude-code-hint>` al final de `src/types/database.ts`** tras `gen types`: bug del plugin de Supabase. Eliminar con `sed -i '/^<claude-code-hint/d' src/types/database.ts`.
- **`infinite recursion detected in policy`**: ver [ADR-0007](./decisions/ADR-0007-rls-policy-recursion-avoidance.md).
- **`function pgp_sym_encrypt(text, text) does not exist`**: añadir `extensions` al `search_path` de la función. Ver sección "Búsqueda de schema" arriba.
- **`permission denied for schema auth`** al crear funciones: las helpers RLS van en `public.*`, no `auth.*`. Ver [ADR-0002](./decisions/ADR-0002-rls-helpers-in-public-schema.md).
