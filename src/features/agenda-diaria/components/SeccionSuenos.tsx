'use client'

import { PlusIcon } from 'lucide-react'
import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

import { upsertSueno } from '../actions/upsert-sueno'
import { esAnulado } from '../schemas/agenda-diaria'
import type { CalidadSueno, SuenoInput } from '../schemas/agenda-diaria'
import type { SuenoRow } from '../types'

import { BotonMarcarErroneo } from './BotonMarcarErroneo'

interface Props {
  ninoId: string
  fecha: string
  suenos: SuenoRow[]
  diaCerrado: boolean
}

const CALIDADES: CalidadSueno[] = ['profundo', 'tranquilo', 'intermitente', 'nada']

export function SeccionSuenos({ ninoId, fecha, suenos, diaCerrado }: Props) {
  const t = useTranslations('agenda')
  const tErrors = useTranslations()
  const [añadiendo, setAñadiendo] = useState(false)
  const [horaInicio, setHoraInicio] = useState('')
  const [horaFin, setHoraFin] = useState('')
  const [calidad, setCalidad] = useState<CalidadSueno | ''>('')
  const [observaciones, setObservaciones] = useState('')
  const [pending, startTransition] = useTransition()

  const calidadItems = CALIDADES.map((v) => ({ value: v, label: t(`calidad_sueno_opciones.${v}`) }))

  function reset() {
    setHoraInicio('')
    setHoraFin('')
    setCalidad('')
    setObservaciones('')
    setAñadiendo(false)
  }

  function guardar() {
    const input: SuenoInput = {
      hora_inicio: horaInicio,
      hora_fin: horaFin === '' ? null : horaFin,
      calidad: calidad === '' ? null : calidad,
      observaciones: observaciones.trim() === '' ? null : observaciones,
    }
    startTransition(async () => {
      const r = await upsertSueno(ninoId, fecha, input)
      if (r.success) {
        toast.success(t('guardado'))
        reset()
      } else {
        toast.error(tErrors(r.error))
      }
    })
  }

  return (
    <div className="space-y-2">
      {suenos.length === 0 && !añadiendo && (
        <p className="text-muted-foreground text-sm">{t('sin_registros')}</p>
      )}
      <ul className="space-y-1.5">
        {suenos.map((s) => {
          const anulado = esAnulado(s.observaciones)
          return (
            <li
              key={s.id}
              className={cn(
                'border-border/60 flex flex-wrap items-center gap-2 rounded-lg border p-2 text-sm',
                anulado && 'opacity-50'
              )}
            >
              {anulado && <Badge variant="secondary">{t('estado.anulado')}</Badge>}
              <span className={cn('font-mono text-xs', anulado && 'line-through')}>
                {s.hora_inicio.slice(0, 5)}–{s.hora_fin ? s.hora_fin.slice(0, 5) : '...'}
              </span>
              {s.calidad && (
                <Badge variant="warm">{t(`calidad_sueno_opciones.${s.calidad}`)}</Badge>
              )}
              {!diaCerrado && !anulado && (
                <div className="ml-auto">
                  <BotonMarcarErroneo tabla="suenos" id={s.id} />
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {!diaCerrado && añadiendo && (
        <div
          className="border-border bg-muted/40 space-y-2 rounded-lg border p-3"
          aria-busy={pending}
        >
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">{t('campos.hora_inicio')}</Label>
              <Input
                type="time"
                value={horaInicio}
                onChange={(e) => setHoraInicio(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('campos.hora_fin')}</Label>
              <Input type="time" value={horaFin} onChange={(e) => setHoraFin(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('campos.calidad')}</Label>
            <Select
              items={calidadItems}
              value={calidad || undefined}
              onValueChange={(v) => setCalidad(v as CalidadSueno)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {calidadItems.map((i) => (
                  <SelectItem key={i.value} value={i.value}>
                    {i.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('campos.observaciones')}</Label>
            <Textarea
              rows={2}
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              maxLength={500}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={reset}>
              {t('anular.cancelar')}
            </Button>
            <Button type="button" size="sm" onClick={guardar} disabled={pending}>
              {pending ? t('guardando') : t('guardar')}
            </Button>
          </div>
        </div>
      )}

      {!diaCerrado && !añadiendo && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setAñadiendo(true)}
          data-testid="anadir-sueno"
        >
          <PlusIcon />
          {t('anadir.sueno')}
        </Button>
      )}
    </div>
  )
}
