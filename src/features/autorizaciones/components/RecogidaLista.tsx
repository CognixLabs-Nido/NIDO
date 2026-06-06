'use client'

import { ShieldCheckIcon, ShieldAlertIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

import type { PersonaAutorizada } from '../types'

interface Props {
  personas: PersonaAutorizada[]
  /** ¿El hash de la última firma cuadra con texto + lista? `null` = sin firma aún. */
  integridadOk?: boolean | null
}

/**
 * Render de la lista de personas autorizadas vigente (de la última firma) +
 * indicador de integridad del hash. Solo lectura; lo usan los detalles admin y
 * familia.
 */
export function RecogidaLista({ personas, integridadOk }: Props) {
  const t = useTranslations('autorizaciones')

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-h3">{t('recogida.lista_vigente')}</h2>
        {integridadOk === true && (
          <span className="text-success-700 inline-flex items-center gap-1 text-xs">
            <ShieldCheckIcon className="size-3.5" />
            {t('recogida.integra')}
          </span>
        )}
        {integridadOk === false && (
          <span className="text-coral-700 inline-flex items-center gap-1 text-xs">
            <ShieldAlertIcon className="size-3.5" />
            {t('recogida.no_integra')}
          </span>
        )}
      </div>

      {personas.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('recogida.sin_firmar')}</p>
      ) : (
        <ul className="divide-border divide-y rounded-lg border">
          {personas.map((p, i) => (
            <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
              <span className="font-medium">{p.nombre}</span>
              <span className="text-muted-foreground">{p.dni}</span>
              {p.parentesco && <span className="text-muted-foreground">· {p.parentesco}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
