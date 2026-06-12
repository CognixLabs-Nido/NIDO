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

export default withNextIntl(nextConfig)
