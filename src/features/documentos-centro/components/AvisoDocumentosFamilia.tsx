import { AlertTriangleIcon, FileSignatureIcon } from 'lucide-react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

import type { PorFirmarHijo } from '../queries/get-pendientes-firma'

/**
 * Inicio de la familia (fase 4, 4c): una línea por hijo con documentos obligatorios del centro por
 * firmar, que lleva a su ficha, donde se firman. Si no se ha podido leer, se dice: callar diría
 * «no hay nada que firmar».
 */
export async function AvisoDocumentosFamilia({
  hijos,
  locale,
}: {
  hijos: readonly PorFirmarHijo[]
  locale: string
}) {
  if (hijos.length === 0) return null
  const t = await getTranslations('firmar_documentos.inicio_familia')
  return (
    <div className="space-y-2" data-testid="aviso-documentos-familia">
      {hijos.map((h) =>
        h.n === null ? (
          <p
            key={h.ninoId}
            className="text-muted-foreground flex items-center gap-2 px-1 text-sm"
            role="status"
          >
            <AlertTriangleIcon className="size-4 shrink-0" aria-hidden />
            {t('no_comprobado', { nombre: h.nombre })}
          </p>
        ) : (
          <Link
            key={h.ninoId}
            href={`/${locale}/family/nino/${h.ninoId}#documentos-centro`}
            className="flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 transition hover:bg-amber-100 dark:border-amber-900/40 dark:bg-amber-950/30 dark:hover:bg-amber-950/50"
          >
            <FileSignatureIcon
              className="size-5 shrink-0 text-amber-700 dark:text-amber-300"
              aria-hidden
            />
            <span className="text-sm font-medium text-amber-900 dark:text-amber-100">
              {t('por_firmar', { nombre: h.nombre, n: h.n })}
            </span>
          </Link>
        )
      )}
    </div>
  )
}
