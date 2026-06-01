'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { CalendarClockIcon, CheckIcon, Trash2Icon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

import { anularRecordatorio } from '../actions/anular-recordatorio'
import { completarRecordatorio } from '../actions/completar-recordatorio'
import { puedeAnular } from '../lib/form-helpers'
import type { RecordatorioListItem } from '../types'

interface Props {
  item: RecordatorioListItem
  userId: string
  locale: string
}

function formatVencimiento(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'va' ? 'ca-ES-valencia' : locale, {
    timeZone: 'Europe/Madrid',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso))
}

/** Mapea la key de error de la action a un mensaje i18n via el namespace errors. */
function toastErrorDe(error: string, tErr: (k: string) => string): void {
  const k = error.startsWith('recordatorios.errors.')
    ? error.replace('recordatorios.errors.', '')
    : 'creacion_fallo'
  toast.error(tErr(k))
}

export function RecordatorioItem({ item, userId, locale }: Props) {
  const t = useTranslations('recordatorios')
  const tErr = useTranslations('recordatorios.errors')
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const completado = item.completado_en !== null
  const anulable = puedeAnular(item, userId)

  function onCompletar() {
    startTransition(async () => {
      const res = await completarRecordatorio({ recordatorio_id: item.id })
      if (!res.success) {
        toastErrorDe(res.error, tErr)
        return
      }
      toast.success(t('acciones.completado_toast'))
      router.refresh()
    })
  }

  function onAnular() {
    if (!window.confirm(t('acciones.confirmar_anular'))) return
    startTransition(async () => {
      const res = await anularRecordatorio({ recordatorio_id: item.id })
      if (!res.success) {
        toastErrorDe(res.error, tErr)
        return
      }
      toast.success(t('acciones.anulado_toast'))
      router.refresh()
    })
  }

  return (
    <li
      className="flex items-start justify-between gap-3 rounded-lg border p-3"
      data-testid="recordatorio-item"
      data-completado={completado}
      data-erroneo={item.erroneo}
    >
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <Badge variant="outline">{t(`destinos.${item.destinatario}`)}</Badge>
          {/* Contexto del destino: niño (familia_individual), aula (familias_aula)
              o profesora (profe_individual). Solo uno aplica por la coherencia BD. */}
          {(item.nino_nombre || item.aula_nombre || item.usuario_destinatario_nombre) && (
            <span className="text-muted-foreground text-xs">
              {item.nino_nombre ?? item.aula_nombre ?? item.usuario_destinatario_nombre}
            </span>
          )}
          {item.erroneo && (
            <Badge variant="outline" className="text-destructive">
              {t('estados.anulado')}
            </Badge>
          )}
        </div>
        <p
          className={`text-sm font-medium ${completado ? 'text-muted-foreground line-through' : ''}`}
        >
          {item.titulo}
        </p>
        {item.descripcion && (
          <p className="text-muted-foreground mt-0.5 text-sm">{item.descripcion}</p>
        )}
        <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {item.vencimiento && (
            <span className="inline-flex items-center gap-1">
              <CalendarClockIcon className="size-3" aria-hidden />
              {t('estados.vence', { fecha: formatVencimiento(item.vencimiento, locale) })}
            </span>
          )}
          {completado ? (
            <span>{t('estados.completado_por', { nombre: item.autor_nombre ?? '' })}</span>
          ) : (
            item.autor_nombre && (
              <span>{t('estados.creado_por', { nombre: item.autor_nombre })}</span>
            )
          )}
        </div>
      </div>

      {!completado && !item.erroneo && (
        <div className="flex shrink-0 flex-col gap-1.5">
          <Button
            size="sm"
            variant="outline"
            onClick={onCompletar}
            disabled={pending}
            data-testid="recordatorio-completar"
          >
            <CheckIcon className="size-4" aria-hidden />
            {t('acciones.completar')}
          </Button>
          {anulable && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onAnular}
              disabled={pending}
              data-testid="recordatorio-anular"
            >
              <Trash2Icon className="size-4" aria-hidden />
              {t('acciones.anular')}
            </Button>
          )}
        </div>
      )}
    </li>
  )
}
