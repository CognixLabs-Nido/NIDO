'use client'

import { ShieldCheckIcon, ShieldAlertIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

import type { AdjuntoDniFirmado, PersonaAutorizada } from '../types'

interface Props {
  personas: PersonaAutorizada[]
  /** ¿El hash de la última firma cuadra con texto + lista? `null` = sin firma aún. */
  integridadOk?: boolean | null
  /** Fotos de DNI firmadas (F10-3), enlazadas a cada persona por su DNI. */
  adjuntos?: AdjuntoDniFirmado[]
}

/**
 * Render de la lista de personas autorizadas vigente (de la última firma) +
 * indicador de integridad del hash + foto del DNI (F10-3) cuando la hay. Solo
 * lectura; lo usan los detalles admin y familia.
 */
export function RecogidaLista({ personas, integridadOk, adjuntos }: Props) {
  const t = useTranslations('autorizaciones')
  const dniPorPersona = new Map((adjuntos ?? []).filter((a) => a.dni).map((a) => [a.dni!, a]))

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
          {personas.map((p, i) => {
            const dni = dniPorPersona.get(p.dni)
            return (
              <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
                <span className="font-medium">{p.nombre}</span>
                <span className="text-muted-foreground">{p.dni}</span>
                {p.parentesco && <span className="text-muted-foreground">· {p.parentesco}</span>}
                {dni?.url && (
                  <a
                    href={dni.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-auto shrink-0"
                    aria-label={t('recogida.dni_foto_ver')}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- enlace firmado (cross-origin, caduca) */}
                    <img
                      src={dni.urlMiniatura ?? dni.url}
                      alt={t('recogida.dni_foto')}
                      className="h-9 w-14 rounded border object-cover"
                    />
                  </a>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
