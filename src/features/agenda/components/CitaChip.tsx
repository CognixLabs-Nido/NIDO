'use client'

import { useTranslations } from 'next-intl'

import { cn } from '@/lib/utils'

import type { CitaAgenda, RsvpEstado, TipoCita } from '../types'

const TIPO_CLASES: Record<TipoCita, string> = {
  reunion_familia: 'border-l-blue-400 bg-blue-50',
  reunion_clase: 'border-l-violet-400 bg-violet-50',
  reunion_claustro: 'border-l-amber-400 bg-amber-50',
  visita: 'border-l-emerald-400 bg-emerald-50',
}

const RSVP_CLASES: Record<RsvpEstado, string> = {
  pendiente: 'bg-muted text-muted-foreground',
  aceptado: 'bg-emerald-100 text-emerald-700',
  rechazado: 'bg-rose-100 text-rose-700',
}

interface Props {
  cita: CitaAgenda
  onClick?: (cita: CitaAgenda) => void
  /** En la vista mes los chips son más compactos (sin hora_fin ni RSVP). */
  compacto?: boolean
}

/** Render compartido de una cita en las vistas día/semana/mes. */
export function CitaChip({ cita, onClick, compacto = false }: Props) {
  const t = useTranslations('citas')
  const cancelada = cita.estado === 'cancelada'

  const contenido = (
    <>
      <span className="truncate font-medium">{cita.titulo}</span>
      {!compacto && (
        <span className="text-muted-foreground text-xs">
          {cita.hora_inicio.slice(0, 5)}
          {cita.hora_fin ? `–${cita.hora_fin.slice(0, 5)}` : ''} · {t(`tipos.${cita.tipo}`)}
        </span>
      )}
      <div className="flex flex-wrap items-center gap-1">
        {cita.mi_estado && cita.mi_estado !== 'pendiente' && (
          <span className={cn('rounded px-1.5 py-0.5 text-[10px]', RSVP_CLASES[cita.mi_estado])}>
            {t(`rsvp.${cita.mi_estado}`)}
          </span>
        )}
        {cita.es_organizador && (
          <span className="text-muted-foreground text-[10px]">{t('soy_organizador')}</span>
        )}
      </div>
    </>
  )

  const clases = cn(
    'flex w-full flex-col gap-0.5 rounded-md border border-l-4 px-2 py-1 text-left text-sm',
    TIPO_CLASES[cita.tipo],
    cancelada && 'opacity-50 line-through',
    onClick && 'hover:ring-ring cursor-pointer hover:ring-2'
  )

  if (onClick) {
    return (
      <button type="button" className={clases} onClick={() => onClick(cita)}>
        {contenido}
      </button>
    )
  }
  return <div className={clases}>{contenido}</div>
}
