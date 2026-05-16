'use client'

import { useTranslations } from 'next-intl'
import { useMemo, useState } from 'react'

import { CalendarioMensual } from '@/shared/components/calendario/CalendarioMensual'

import { isoYmd, tipoResuelto } from '../lib/calendario-grid'
import { COLORES_TIPO } from '../lib/colores-tipo'
import type { OverrideMes } from '../types'

interface Props {
  mesInicial: number
  anioInicial: number
  overrides: OverrideMes[]
  locale: 'es' | 'en' | 'va'
}

/**
 * Vista read-only del calendario del centro (profe y familia).
 *
 * Client mínimo: solo state local de `mes`/`anio` para la navegación
 * entre meses. No abre dialogs, no llama a server actions. El cliente
 * resuelve los tipos con `tipoResuelto` para evitar invocar el helper
 * SQL por cada celda.
 */
export function CalendarioCentroReadOnly({ mesInicial, anioInicial, overrides, locale }: Props) {
  const t = useTranslations('calendario')
  const [mes, setMes] = useState(mesInicial)
  const [anio, setAnio] = useState(anioInicial)
  const overrideMap = useMemo(
    () =>
      new Map(overrides.map((o) => [o.fecha, { tipo: o.tipo, observaciones: o.observaciones }])),
    [overrides]
  )

  return (
    <CalendarioMensual
      mes={mes}
      anio={anio}
      onCambioMes={(m, a) => {
        setMes(m)
        setAnio(a)
      }}
      locale={locale}
      ariaLabel={t('vista_solo_lectura')}
      labels={{ anterior: t('selector.anterior'), siguiente: t('selector.siguiente') }}
      renderDia={(fecha, dentroDelMes) => {
        const tipo = tipoResuelto(fecha, overrideMap)
        const cls = COLORES_TIPO[tipo].cell
        const persistido = overrideMap.has(isoYmd(fecha))
        const obs = persistido ? overrideMap.get(isoYmd(fecha))?.observaciones : null
        return (
          <div
            data-tipo={tipo}
            data-persistido={persistido ? 'true' : 'false'}
            title={obs ?? undefined}
            className={`flex h-full flex-col rounded-md border p-1 ${dentroDelMes ? cls : 'border-transparent bg-transparent'}`}
          >
            <span className="text-foreground text-sm font-medium">{fecha.getDate()}</span>
            {persistido && (
              <span className="text-muted-foreground mt-auto truncate text-[10px]">
                {t(`tipos.${tipo}`)}
              </span>
            )}
          </div>
        )
      }}
    />
  )
}
