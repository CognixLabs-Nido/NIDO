'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import type { AgendaCompleta, NinoAgendaResumen } from '../types'

import { SeccionBiberones } from './SeccionBiberones'
import { SeccionCabecera } from './SeccionCabecera'
import { SeccionComidas } from './SeccionComidas'
import { SeccionDeposiciones } from './SeccionDeposiciones'
import { SeccionSuenos } from './SeccionSuenos'

interface Props {
  resumen: NinoAgendaResumen
  fecha: string
  diaCerrado: boolean
}

/**
 * Panel expandido con 5 secciones (General, Comidas, Biberones, Sueños,
 * Deposiciones) para un niño en una fecha. Recibe la agenda ya hidratada
 * desde el padre (`NinoAgendaCard` la carga vía server action al expandir).
 *
 * El padre re-monta este componente con `key={ninoId}` cada vez que cambia
 * el niño expandido, por lo que el `active` siempre arranca en "general"
 * sin necesidad de un efecto reactivo.
 */
export function NinoAgendaPanel({
  resumen,
  agenda,
  fecha,
  diaCerrado,
}: Props & { agenda: AgendaCompleta | null }) {
  const t = useTranslations('agenda')
  const [active, setActive] = useState<
    'general' | 'comidas' | 'biberones' | 'suenos' | 'deposiciones'
  >('general')

  const tabs: Array<{
    key: typeof active
    label: string
  }> = [
    { key: 'general', label: t('secciones.general') },
    { key: 'comidas', label: t('secciones.comidas') },
    { key: 'biberones', label: t('secciones.biberones') },
    { key: 'suenos', label: t('secciones.suenos') },
    { key: 'deposiciones', label: t('secciones.deposiciones') },
  ]

  return (
    <div className="space-y-3">
      <div className="border-border flex flex-wrap gap-1 border-b pb-2 text-sm">
        {tabs.map((tb) => (
          <button
            key={tb.key}
            type="button"
            className={
              tb.key === active
                ? 'bg-primary-100 text-primary-700 rounded-md px-2.5 py-1 font-medium'
                : 'text-muted-foreground hover:text-foreground rounded-md px-2.5 py-1'
            }
            onClick={() => setActive(tb.key)}
            aria-pressed={tb.key === active}
          >
            {tb.label}
          </button>
        ))}
      </div>

      {active === 'general' && (
        <SeccionCabecera
          ninoId={resumen.nino.id}
          fecha={fecha}
          initial={
            agenda?.cabecera
              ? {
                  estado_general: agenda.cabecera.estado_general,
                  humor: agenda.cabecera.humor,
                  observaciones_generales: agenda.cabecera.observaciones_generales,
                }
              : null
          }
          diaCerrado={diaCerrado}
        />
      )}
      {active === 'comidas' && (
        <SeccionComidas
          ninoId={resumen.nino.id}
          fecha={fecha}
          comidas={agenda?.comidas ?? []}
          diaCerrado={diaCerrado}
        />
      )}
      {active === 'biberones' && (
        <SeccionBiberones
          ninoId={resumen.nino.id}
          fecha={fecha}
          biberones={agenda?.biberones ?? []}
          diaCerrado={diaCerrado}
        />
      )}
      {active === 'suenos' && (
        <SeccionSuenos
          ninoId={resumen.nino.id}
          fecha={fecha}
          suenos={agenda?.suenos ?? []}
          diaCerrado={diaCerrado}
        />
      )}
      {active === 'deposiciones' && (
        <SeccionDeposiciones
          ninoId={resumen.nino.id}
          fecha={fecha}
          deposiciones={agenda?.deposiciones ?? []}
          diaCerrado={diaCerrado}
        />
      )}
    </div>
  )
}
