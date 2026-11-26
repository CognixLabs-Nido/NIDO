'use client'

import { NoSePudoLeer } from './NoSePudoLeer'

/**
 * El `error.tsx` común (censo C, 2026-11-25): lo que se ve cuando una página no se pudo leer. Va en cada
 * sección con layout (teacher, family, admin…), para que la navegación de la sección siga a la vista; el
 * de la raíz de `[locale]` recoge el resto. «Reintentar» vuelve a renderizar la página. El fallo ya quedó
 * en el log del servidor, donde se lanzó.
 */
export function ErrorDeSeccion({
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <NoSePudoLeer alcance="pagina" reintentar={reset} />
}
