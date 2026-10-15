# Proxy de sesión — `src/proxy.ts`

El proxy (el `middleware` de Next.js 16) hace tres cosas en cada navegación: el locale de next-intl, refrescar la sesión de Supabase (`updateSession`) y el control por rol (`requiredRolesFor`). Sigue el patrón oficial de `@supabase/ssr` con tres diferencias. Esta página dice cuáles son y por qué.

## Composición con next-intl

La respuesta de partida es la de `intlMiddleware(request)`, no un `NextResponse.next({ request })` nuevo: next-intl puede haber reescrito la ruta o puesto sus cabeceras, y esa respuesta es la que hay que devolver. El cliente de Supabase escribe las cookies renovadas en esa respuesta, y `redirectConservandoCookies` las copia a cualquier redirección (a `/login` o a `/forbidden`). Sin eso, el token renovado se perdía y la siguiente petición salía sin sesión.

## `getUser()` y no `getClaims()`

El patrón oficial actual usa `supabase.auth.getClaims()`, que valida el JWT en local con la clave pública del proyecto (ES256), sin llamada de red. NIDO usa `getUser()`, que pregunta a Auth en cada navegación.

**Por qué (decisión del responsable, 2026-10-15):** la purga RGPD banea la cuenta (`anonimizarCuentaAuth`). Con `getClaims()`, un usuario purgado y baneado seguiría pasando el proxy hasta que caduque su token (≤1 h por defecto), porque su JWT sigue siendo válido. Con `getUser()`, Auth responde que la cuenta ya no vale y el proxy lo manda a `/login` al momento. Con purgas RGPD de por medio, eso pesa más que la latencia de la llamada.

La RLS ya le cierra los datos en ese hueco (sus roles y vínculos quedan dados de baja), así que `getClaims()` no abriría datos; lo que se evita es que la cuenta purgada siga navegando por la app.

## El matcher

```ts
matcher: ['/((?!api|_next|_vercel|.*\\..*).*)']
```

El oficial solo excluye los estáticos. Este excluye además:

- **`/api`**: hoy solo tiene `cron`, que se autentica con su secreto y no lleva sesión de usuario. Una ruta nueva bajo `/api` que use la sesión no pasa por el proxy: tiene que refrescarla ella misma (un route handler sí puede escribir cookies).
- **Cualquier ruta con un punto**: son los ficheros de `public/` (iconos, manifest, imágenes). Una página con un «.» en un segmento se saltaría el proxy, y con él el control de rol. Por eso los segmentos de página no llevan punto; los valores de los segmentos dinámicos son uuids.

## Control de rol

`requiredRolesFor(rest)` (`src/proxy-roles.ts`) dice qué roles pide cada ruta; el proxy lee `roles_usuario` vivos del usuario con su propia sesión (RLS) y, si no tiene ninguno, redirige a `/forbidden`. Es una consulta más por navegación protegida, que el patrón oficial no tiene: es lo que añade NIDO encima, no una divergencia. Las rutas públicas (`PUBLIC_PATTERNS`) refrescan la sesión y no se gatean.
