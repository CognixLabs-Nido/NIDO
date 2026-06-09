import { ArchiveIcon, PillIcon } from 'lucide-react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

import { Badge } from '@/components/ui/badge'
import { getMedicacionesConActividad } from '@/features/autorizaciones/queries/get-medicaciones-actividad'

import { ArchivarMedicacionButton } from './ArchivarMedicacionButton'
import { EstadoDocBadge } from './EstadoFirmaBadge'

/**
 * Sección de medicación de la pestaña Autorizaciones (los 3 roles). Muestra, en la
 * propia lista, la actividad de cada pauta (dosis dadas + pendientes de confirmar) sin
 * abrir el detalle. Para profe/admin (`puedeArchivar`), las pautas TERMINADAS muestran
 * el aviso + botón para archivar. `soloHistorico` lista las archivadas (botón Histórico).
 * La familia ve lo mismo en lectura (sin archivar).
 */
export async function SeccionMedicacion({
  locale,
  baseHref,
  puedeArchivar,
  soloHistorico = false,
}: {
  locale: string
  baseHref: string
  puedeArchivar: boolean
  soloHistorico?: boolean
}) {
  const t = await getTranslations('autorizaciones')
  const items = await getMedicacionesConActividad(soloHistorico)

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="space-y-1">
          <h2 className="text-h2 text-foreground flex items-center gap-2">
            <PillIcon className="size-5" />
            {soloHistorico ? t('medicacion_lista.historico_titulo') : t('medicacion_lista.titulo')}
          </h2>
          <p className="text-muted-foreground text-sm">
            {soloHistorico ? t('medicacion_lista.historico_desc') : t('medicacion_lista.desc')}
          </p>
        </div>
        {/* Botón Histórico ↔ Activas (toggle por query param). */}
        {soloHistorico ? (
          <Link
            href={`/${locale}${baseHref}`}
            className="text-primary-600 hover:text-primary-700 text-sm"
          >
            {t('medicacion_lista.ver_activas')}
          </Link>
        ) : (
          <Link
            href={`/${locale}${baseHref}?historico=1`}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
          >
            <ArchiveIcon className="size-4" />
            {t('medicacion_lista.ver_historico')}
          </Link>
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {soloHistorico ? t('medicacion_lista.historico_vacio') : t('medicacion_lista.vacio')}
        </p>
      ) : (
        <ul className="divide-border divide-y rounded-lg border">
          {items.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <Link
                href={`/${locale}${baseHref}/${m.id}`}
                className="min-w-0 flex-1 hover:underline"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{m.titulo}</span>
                  {m.nino_nombre && (
                    <span className="text-muted-foreground text-xs">{m.nino_nombre}</span>
                  )}
                  <EstadoDocBadge estado={m.estado} />
                  {m.archivada && (
                    <Badge variant="secondary">{t('medicacion_lista.archivada')}</Badge>
                  )}
                  {!m.archivada && m.terminada && (
                    <Badge variant="outline" className="text-amber-700">
                      {t('medicacion_lista.terminada')}
                    </Badge>
                  )}
                </span>
                <span className="text-muted-foreground mt-0.5 flex flex-wrap gap-x-2 text-xs">
                  <span>{t('medicacion_lista.dadas', { n: m.dadas })}</span>
                  {m.pendientesConfirmar > 0 && (
                    <span className="text-amber-700">
                      · {t('medicacion_lista.pendientes_confirmar', { n: m.pendientesConfirmar })}
                    </span>
                  )}
                </span>
              </Link>
              {/* Aviso de archivar: pauta terminada, no archivada, y el rol puede archivar. */}
              {puedeArchivar && m.terminada && !m.archivada && (
                <ArchivarMedicacionButton autorizacionId={m.id} />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
