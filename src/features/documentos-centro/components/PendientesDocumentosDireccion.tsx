import { AlertTriangleIcon, FileClockIcon, FileXIcon } from 'lucide-react'
import Link from 'next/link'
import { getFormatter, getTranslations } from 'next-intl/server'

import type { Resultado } from '../lib/firmar-documentos'
import type { PendientesCentro } from '../lib/pendientes'

/**
 * Inicio de Dirección (fase 4, 4c): lo pendiente de los documentos del centro, sin buscarlo.
 *
 *  - **Por firmar**, de la familia: por documento y curso, cuántos niños y desde cuándo, y la lista
 *    de niños, cada uno a su ficha (pestaña Documentación), donde se registra la firma en papel.
 *  - **Sin subir**, del centro: aparte y dicho como lo que es («no existía» no es «no ha firmado»).
 *    El enlace para subirlo, solo a la admin del centro: la pantalla de documentos es suya (J1).
 *
 * Si la lectura falla, se dice; callar diría «está todo firmado».
 */
export async function PendientesDocumentosDireccion({
  pendientes,
  esResponsable,
  locale,
}: {
  pendientes: Resultado<PendientesCentro>
  esResponsable: boolean
  locale: string
}) {
  const t = await getTranslations('firmar_documentos')
  if (!pendientes.ok) {
    return (
      <p className="text-muted-foreground flex items-center gap-2 px-1 text-sm" role="status">
        <AlertTriangleIcon className="size-4 shrink-0" aria-hidden />
        {t('inicio_direccion.no_comprobado')}
      </p>
    )
  }
  const { porFirmar, sinSubir } = pendientes.data
  if (porFirmar.length === 0 && sinSubir.length === 0) return null
  const format = await getFormatter()
  const fecha = (iso: string) =>
    format.dateTime(new Date(iso), { dateStyle: 'long', timeZone: 'Europe/Madrid' })
  const nombreDoc = (titulo: string, curso: string | null) =>
    curso ? `«${titulo}» · ${t('curso', { curso })}` : `«${titulo}»`

  return (
    <section className="space-y-2" aria-label={t('inicio_direccion.titulo')}>
      {porFirmar.map((g) => (
        <details
          key={`${g.documentoId}:${g.cursoNombre ?? ''}`}
          className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-900/40 dark:bg-amber-950/30"
          data-testid="documento-por-firmar"
        >
          <summary className="flex cursor-pointer items-center gap-3 text-sm font-medium text-amber-900 dark:text-amber-100">
            <FileClockIcon
              className="size-5 shrink-0 text-amber-700 dark:text-amber-300"
              aria-hidden
            />
            {t('inicio_direccion.por_firmar', {
              documento: nombreDoc(g.titulo, g.cursoNombre),
              n: g.ninos.length,
              fecha: fecha(g.ninos[0]!.desde),
            })}
          </summary>
          <ul className="mt-3 space-y-1 pl-8 text-sm">
            {g.ninos.map((n) => (
              <li key={n.ninoId}>
                <Link
                  href={`/${locale}/admin/ninos/${n.ninoId}?tab=documentacion`}
                  className="text-amber-900 underline dark:text-amber-100"
                >
                  {n.nombre}
                </Link>
                <span className="text-amber-700 dark:text-amber-300">
                  {' · '}
                  {t('inicio_direccion.desde', { fecha: fecha(n.desde) })}
                </span>
              </li>
            ))}
          </ul>
        </details>
      ))}
      {sinSubir.map((g) => (
        <div
          key={`${g.documentoId}:${g.cursoNombre ?? ''}`}
          className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border p-4 text-sm"
          data-testid="documento-sin-subir"
        >
          <FileXIcon className="size-5 shrink-0" aria-hidden />
          <span>
            {t('inicio_direccion.sin_subir', {
              documento: nombreDoc(g.titulo, g.cursoNombre),
              n: g.ninos,
            })}
          </span>
          {esResponsable && (
            <Link
              href={`/${locale}/admin/documentos-centro`}
              className="text-primary font-medium underline"
            >
              {t('inicio_direccion.subir')}
            </Link>
          )}
        </div>
      ))}
    </section>
  )
}
