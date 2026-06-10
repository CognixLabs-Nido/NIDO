import { getTranslations } from 'next-intl/server'

import type { SeguimientoAula } from '../types'

import { PublicarLoteButton } from './PublicarLoteButton'

/**
 * Tabla de seguimiento por aula de una campaña: publicados vs total, con la lista
 * desplegable de niños pendientes (para que la dirección pueda reclamar) y, si la
 * campaña está **abierta**, un "Publicar todos" por aula (F9-5-3). Server Component
 * presentacional: recibe el `seguimiento` ya derivado. El desplegable usa `<details>`
 * nativo (accesible, sin JS).
 */
export async function SeguimientoCampana({
  seguimiento,
  campanaId,
  abierta,
}: {
  seguimiento: SeguimientoAula[]
  campanaId: string
  abierta: boolean
}) {
  const t = await getTranslations('informes')

  if (seguimiento.length === 0) {
    return <p className="text-muted-foreground text-sm">{t('campana.seguimiento.sin_aulas')}</p>
  }

  return (
    <ul className="divide-border divide-y rounded-lg border">
      {seguimiento.map((aula) => {
        const completa = aula.total > 0 && aula.publicados === aula.total
        return (
          <li key={aula.aulaId} className="px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{aula.aulaNombre}</span>
              <span className="flex items-center gap-3">
                <span
                  className={
                    completa
                      ? 'text-sm font-medium text-green-700'
                      : 'text-muted-foreground text-sm'
                  }
                >
                  {t('campana.seguimiento.total', {
                    publicados: aula.publicados,
                    total: aula.total,
                  })}
                </span>
                {/* "Publicar todos" del aula: solo si la campaña está abierta y queda algo. */}
                {abierta && !completa && (
                  <PublicarLoteButton
                    campanaId={campanaId}
                    aulaId={aula.aulaId}
                    label={t('campana.acciones.publicar_todos')}
                  />
                )}
              </span>
            </div>
            {aula.pendientes.length > 0 && (
              <details className="mt-2">
                <summary className="text-primary-700 hover:text-primary-800 cursor-pointer text-sm">
                  {t('campana.seguimiento.ver_pendientes', { n: aula.pendientes.length })}
                </summary>
                <ul className="text-muted-foreground mt-1 list-disc space-y-0.5 pl-5 text-sm">
                  {aula.pendientes.map((nino) => (
                    <li key={nino.id}>
                      {nino.nombre} {nino.apellidos}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </li>
        )
      })}
    </ul>
  )
}
