# Proxy de sesión — `src/proxy.ts`

El proxy (el `middleware` de Next.js 16) hace tres cosas en cada navegación: el locale de next-intl, refrescar la sesión de Supabase (`updateSession`) y el control por rol (`requiredRolesFor`). Sigue el patrón oficial de `@supabase/ssr`, adaptado a que la respuesta la crea next-intl, con dos diferencias deliberadas. Esta página dice cuáles son y por qué.

## Composición con next-intl

Cuando `getUser()` renueva el token, el patrón oficial escribe las cookies nuevas en dos sitios: en `request.cookies`, para que los Server Components de **esa misma petición** lean el token nuevo, y en la respuesta, para el navegador. Para lo primero rehace la respuesta con `NextResponse.next({ request })`, que copia las cabeceras de la petición ya actualizadas.

Aquí la respuesta que hay que devolver es la de `intlMiddleware(request)` (puede haber reescrito la ruta o puesto sus cabeceras), y next-intl hace esa misma copia de `request.headers` en el momento de crearla. Por eso el orden es:

1. `createServerClient` y `getUser()`. `setAll` escribe cada cookie renovada en `request.cookies` (que reescribe la cabecera `cookie` de la petición) y la guarda.
2. `intlMiddleware(request)`: su respuesta ya lleva la cookie nueva en las cabeceras que leen los Server Components.
3. Las cookies guardadas se ponen en esa respuesta, para el navegador. `redirectConservandoCookies` las copia también a las redirecciones a `/login` y a `/forbidden`; sin eso, el token renovado se perdía y la siguiente petición salía sin sesión.

Hasta #355 el orden era el inverso (next-intl primero): el navegador recibía la cookie nueva, pero los Server Components de esa petición veían la vieja. Lo cubre `src/__tests__/proxy-sesion.test.ts`, que con el orden antiguo falla.

## `getUser()` y no `getClaims()`

El patrón oficial actual usa `supabase.auth.getClaims()`, que valida el JWT en local con la clave pública del proyecto (ES256), sin llamada de red. NIDO usa `getUser()`, que pregunta a Auth en cada navegación.

**Por qué (decisión del responsable, 2026-10-15):** la purga RGPD banea la cuenta (`anonimizarCuentaAuth`). Con `getClaims()`, un usuario purgado y baneado seguiría pasando el proxy hasta que caduque su token (≤1 h por defecto), porque su JWT sigue siendo válido. Con `getUser()`, Auth responde que la cuenta ya no vale y el proxy lo manda a `/login` al momento. Con purgas RGPD de por medio, eso pesa más que la latencia de la llamada.

Medido contra el GoTrue real en `src/test/audit/purga-cierre.test.ts`: tras `anonimizarCuentaAuth`, `getUser` con el token que el usuario ya tenía falla y `getClaims` lo sigue aceptando.

La RLS ya le cierra los datos en ese hueco (sus roles y vínculos quedan dados de baja), así que `getClaims()` no abriría datos; lo que se evita es que la cuenta purgada siga navegando por la app.

## El matcher

```ts
matcher: ['/((?!api|_next|_vercel|monitoring|.*\\..*).*)']
```

El oficial solo excluye los estáticos. Este excluye además:

- **`/api`**: hoy solo tiene `cron`, que se autentica con su secreto y no lleva sesión de usuario. Una ruta nueva bajo `/api` que use la sesión no pasa por el proxy: tiene que refrescarla ella misma (un route handler sí puede escribir cookies).
- **`/monitoring`**: el túnel de Sentry (ADR-0056). Es una reescritura de `next.config.ts` hacia la ingesta de la UE, sin página detrás; si pasara por el proxy, next-intl la redirigiría a `/es/monitoring` y los eventos no llegarían. Ninguna página puede empezar por `monitoring`: se saltaría el control de rol.
- **Cualquier ruta con un punto**: son los ficheros de `public/` (iconos, manifest, imágenes). Una página con un «.» en un segmento se saltaría el proxy, y con él el control de rol. Por eso los segmentos de página no llevan punto; los valores de los segmentos dinámicos son uuids.

## Control de rol

`requiredRolesFor(rest)` (`src/proxy-roles.ts`) dice qué roles pide cada ruta; el proxy lee `roles_usuario` vivos del usuario con su propia sesión (RLS) y, si no tiene ninguno, redirige a `/forbidden`. Es una consulta más por navegación protegida, que el patrón oficial no tiene: es lo que añade NIDO encima, no una divergencia. Las rutas públicas (`PUBLIC_PATTERNS`) refrescan la sesión y no se gatean.
