import createNextIntlPlugin from 'next-intl/plugin'

import type { NextConfig } from 'next'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

const nextConfig: NextConfig = {
  // typedRoutes desactivado: con i18n dinámico (`/${locale}/...`) genera fricción innecesaria.
  // Si se reactiva en Ola 2, hay que castear todas las rutas con `as Route`.

  // F10-1: el procesado de imagen corre server-side (route handler nodejs).
  // `sharp` (binario nativo de libvips) y `heic-convert` (WASM de libheif) NO
  // deben pasar por el bundler de Next — se cargan como externals en runtime.
  serverExternalPackages: ['sharp', 'heic-convert'],
}

export default withNextIntl(nextConfig)
