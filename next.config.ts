import createNextIntlPlugin from 'next-intl/plugin'

import type { NextConfig } from 'next'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

const nextConfig: NextConfig = {
  // typedRoutes desactivado: con i18n dinámico (`/${locale}/...`) genera fricción innecesaria.
  // Si se reactiva en Ola 2, hay que castear todas las rutas con `as Route`.

  // F10-1: el procesado de imagen corre server-side (route handler nodejs). `sharp`
  // (binario nativo de libvips) NO debe pasar por el bundler de Next — se carga como
  // external en runtime para que node-file-trace lo empaquete intacto. (El decode HEIC
  // ya NO corre en el servidor: va en el cliente con `heic-to`, porque `@vercel/nft` no
  // traza el `.wasm` de libheif a la función → ENOENT en runtime.)
  serverExternalPackages: ['sharp'],
}

export default withNextIntl(nextConfig)
