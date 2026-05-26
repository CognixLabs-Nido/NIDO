# Manejo de errores en server actions — NIDO

Las server actions devuelven el patrón `ActionResult<T> = { success: true, data: T } | { success: false, error: 'i18n.key' }` (ver `docs/conventions.md`). Este documento define qué claves usar, cuándo, y cómo evitar que el catch-all genérico oculte errores reales.

## Errores específicos antes que catch-all

> **Aprendizaje crítico de Fase 5 post-merge** (hotfix `fix/enviar-mensaje-centro-id`). Aplica a todos los server actions del proyecto.

### Síntoma

Un usuario reporta "no funciona" en una feature. Los logs de Vercel no muestran nada útil (porque el server action devolvió un `error: 'messages.errors.envio_fallo'` genérico y no hubo `console.error`). Mientras tanto, los logs de Supabase muestran un `23503` o `42501` muy claro, pero nadie los vio porque el flujo de error en el código no los exponía.

### Causa

Patrón habitual incorrecto en server actions:

```ts
// ❌ Catch-all genérico que oculta toda diagnosticación
const { data, error } = await supabase.from('mensajes').insert(payload).select('id').single()
if (error || !data) {
  return fail('messages.errors.envio_fallo')
}
```

Cualquier error (FK violation, RLS denial, conexión caída, validación de constraint) acaba en la misma rama, con el mismo mensaje al usuario y **sin huella server-side**. Resultado:

- El usuario ve un toast genérico inútil para diagnosticar.
- El desarrollador no tiene ni siquiera un `console.error` en Vercel logs, así que tiene que reproducir el bug a mano o bucear en Supabase logs (que tampoco siempre están disponibles).
- Los bugs reales se confunden con "el usuario hizo algo raro".

Bug histórico: el catch-all `messages.errors.envio_fallo` ocultó durante 3 días un FK violation (`23503`) en `enviarMensaje` que era trivial de ver en logs de Supabase. La causa raíz (sentinel UUID, ver `db-triggers.md`) se diagnosticó solo después de añadir `console.error` y mirar los logs de Vercel.

### Regla

> **Los server actions deben devolver errores tipados específicos. El catch-all genérico solo como último fallback, y siempre con `console.error(...)` server-side.**

Reglas concretas:

1. **Una clave i18n por tipo de error que el usuario debe poder distinguir.** Mínimo: `no_autorizado`, `sin_permisos`, `<entidad>_no_encontrado` (cuando aplique), `<accion>_fallo` (catch-all). Más si el dominio lo justifica.
2. **Distinguir códigos Postgres relevantes** antes del catch-all:
   - `42501` → `sin_permisos` (RLS denial).
   - `23503` → casi siempre indica un bug de código (FK violation con valor inexistente), no un fallo de usuario. Va al catch-all con `console.error`.
   - `23505` → conflicto de unicidad; típicamente `<entidad>_duplicado` o similar si el usuario puede reaccionar.
3. **`console.error(...)` en TODAS las ramas que devuelven el catch-all.** Sin excepción. El log aparece en Vercel Functions y permite reconstruir el bug sin pedir al usuario que reproduzca.
4. **Nunca usar el catch-all como atajo de programación.** Si una rama puede tener varios errores reales, separa cada uno con su clave i18n; no agrupes "todo lo demás" sin diagnóstico.

### Patrón catch-all (anti-patrón)

```ts
// ❌ Una sola rama; el usuario y el desarrollador quedan a oscuras
const { data, error } = await supabase.from('conversaciones').insert(payload).select('id').single()
if (error || !data) {
  return fail('messages.errors.envio_fallo')
}
```

### Patrón errores tipados (correcto)

```ts
// ✅ Errores tipados + console.error en el fallback
const { data, error } = await supabase.from('conversaciones').insert(payload).select('id').single()

if (error || !data) {
  console.error('[enviarMensaje] conversaciones.insert falló:', error)
  if (error?.code === '42501') {
    return fail('messages.errors.sin_permisos')
  }
  return fail('messages.errors.envio_fallo')
}
```

Y si el error es estructural (entidad parent no existe), el patrón limpio es **resolver antes** con un SELECT y devolver un error tipado:

```ts
// ✅ Pre-check explícito; el catch-all queda solo para sorpresas
const { data: nino, error: ninoErr } = await supabase
  .from('ninos')
  .select('centro_id')
  .eq('id', input.nino_id)
  .maybeSingle()

if (ninoErr) {
  console.error('[enviarMensaje] ninos.select falló:', ninoErr)
  return fail('messages.errors.envio_fallo')
}
if (!nino) {
  return fail('messages.errors.nino_no_encontrado')
}
```

### Claves i18n estándar

Para mantener consistencia entre features, usar este vocabulario en `messages/<locale>.json` bajo `messages.errors.*` (y análogos por feature: `agenda.errors.*`, `asistencia.errors.*`, etc.):

| Clave                     | Cuándo                                                                                                                                          |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `no_autorizado`           | `supabase.auth.getUser()` devuelve null. Usuario sin sesión.                                                                                    |
| `sin_permisos`            | RLS devuelve `42501`. El usuario está autenticado pero no tiene permiso para la acción.                                                         |
| `<entidad>_no_encontrado` | El parent que la acción necesita (niño, aula, conversación...) no existe o RLS lo oculta. Distinguir de "sin permisos" cuando UX lo justifique. |
| `<accion>_fallo`          | **Fallback únicamente.** Errores inesperados. Va siempre con `console.error`.                                                                   |

### Cuándo aplica

- Todos los server actions de NIDO con efectos secundarios (INSERT/UPDATE/DELETE).
- Las queries de solo lectura suelen no necesitar errores tipados al usuario (devuelven array vacío o null si RLS oculta), pero siguen necesitando `console.error` si la query falla por motivos no-RLS.

### Cómo se descubre que falta esto

1. Un bug que tarda más de 1 hora en diagnosticarse y el desarrollador acaba pidiendo logs de Supabase Cloud porque Vercel no muestra nada.
2. El usuario reporta "no funciona" y el toast es siempre el mismo mensaje genérico.
3. Los tests RLS pasan pero la feature falla en producción con un código Postgres que el server action no distingue.

Si pasa cualquiera de los 3, revisar el server action correspondiente y aplicar este patrón.
