import { withSentryConfig } from '@sentry/nextjs/config'
import createNextIntlPlugin from 'next-intl/plugin'

import type { NextConfig } from 'next'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

// F10-3: el logo del centro (ADR-0010) se sirve desde el bucket PÚBLICO
// `centro-assets` de Supabase Storage; `next/image` necesita autorizar ese host.
// Derivado de NEXT_PUBLIC_SUPABASE_URL para no fijar el project-ref aquí.
const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : undefined

const nextConfig: NextConfig = {
  images: {
    remotePatterns: supabaseHost
      ? [
          {
            protocol: 'https',
            hostname: supabaseHost,
            pathname: '/storage/v1/object/public/**',
          },
        ]
      : [],
  },

  // typedRoutes desactivado: con i18n dinámico (`/${locale}/...`) genera fricción innecesaria.
  // Si se reactiva en Ola 2, hay que castear todas las rutas con `as Route`.

  // F10-1: el procesado de imagen corre server-side (route handler nodejs). `sharp`
  // (binario nativo de libvips) NO debe pasar por el bundler de Next — se carga como
  // external en runtime para que node-file-trace lo empaquete intacto. (El decode HEIC se
  // descartó: ni en cliente —worker que cuelga— ni en servidor —Turbopack no embarca el
  // `.wasm` de libheif en la función—; el HEIC se rechaza con mensaje claro. Follow-up:
  // decode server-side requiere build con Webpack.)
  serverExternalPackages: ['sharp'],
}

// Sentry (ADR-0056): errores a la región de la UE, sin datos personales. Qué se envía lo
// decide `src/shared/lib/sentry/opciones.ts`; aquí solo va lo del build.
// - Source maps: se suben y se BORRAN del build (no quedan públicos en el navegador).
//   Sin SENTRY_AUTH_TOKEN (CI, local) no se generan ni se suben: el build no depende de
//   Sentry. Si la subida falla, el build sigue con un aviso.
// - tunnelRoute: los eventos del navegador salen por /monitoring (nuestro dominio), así
//   Sentry no ve la IP de la familia. El proxy excluye esa ruta (src/proxy.ts).
const subirSourceMaps = Boolean(process.env.SENTRY_AUTH_TOKEN)

export default withSentryConfig(withNextIntl(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  telemetry: false,
  silent: !process.env.CI,
  sourcemaps: { disable: !subirSourceMaps, deleteSourcemapsAfterUpload: true },
  errorHandler: (err) => {
    console.warn('[sentry] no se pudieron subir los source maps:', err.message)
  },
  tunnelRoute: '/monitoring',
  // Sin trazas de rendimiento, así que no se engancha `onRouterTransitionStart`.
  suppressOnRouterTransitionStartWarning: true,
  widenClientFileUpload: false,
})
