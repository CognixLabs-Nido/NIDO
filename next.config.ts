import createNextIntlPlugin from 'next-intl/plugin'

import type { NextConfig } from 'next'

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

const nextConfig: NextConfig = {
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
