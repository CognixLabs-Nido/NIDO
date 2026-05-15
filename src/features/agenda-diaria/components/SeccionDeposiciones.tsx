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

import { upsertDeposicion } from '../actions/upsert-deposicion'
import { esAnulado } from '../schemas/agenda-diaria'
import type {
  CantidadDeposicion,
  ConsistenciaDeposicion,
  DeposicionInput,
  TipoDeposicion,
} from '../schemas/agenda-diaria'
import type { DeposicionRow } from '../types'

import { BotonMarcarErroneo } from './BotonMarcarErroneo'

interface Props {
  ninoId: string
  fecha: string
  deposiciones: DeposicionRow[]
  diaCerrado: boolean
}

const TIPOS: TipoDeposicion[] = ['pipi', 'caca', 'mixto']
const CONSISTENCIAS: ConsistenciaDeposicion[] = ['normal', 'dura', 'blanda', 'diarrea']
const CANTIDADES: CantidadDeposicion[] = ['mucha', 'normal', 'poca']

export function SeccionDeposiciones({ ninoId, fecha, deposiciones, diaCerrado }: Props) {
  const t = useTranslations('agenda')
  const tErrors = useTranslations()
  const [añadiendo, setAñadiendo] = useState(false)
  const [hora, setHora] = useState('')
  const [tipo, setTipo] = useState<TipoDeposicion>('caca')
  const [consistencia, setConsistencia] = useState<ConsistenciaDeposicion | ''>('normal')
  const [cantidad, setCantidad] = useState<CantidadDeposicion>('normal')
  const [observaciones, setObservaciones] = useState('')
  const [pending, startTransition] = useTransition()

  const tipoItems = TIPOS.map((v) => ({ value: v, label: t(`tipo_deposicion_opciones.${v}`) }))
  const consistenciaItems = CONSISTENCIAS.map((v) => ({
    value: v,
    label: t(`consistencia_opciones.${v}`),
  }))
  const cantidadItems = CANTIDADES.map((v) => ({
    value: v,
    label: t(`cantidad_deposicion_opciones.${v}`),
  }))

  function reset() {
    setHora('')
    setTipo('caca')
    setConsistencia('normal')
    setCantidad('normal')
    setObservaciones('')
    setAñadiendo(false)
  }

  function guardar() {
    const input: DeposicionInput = {
      hora: hora === '' ? null : hora,
      tipo,
      consistencia: tipo === 'pipi' ? null : consistencia === '' ? null : consistencia,
      cantidad,
      observaciones: observaciones.trim() === '' ? null : observaciones,
    }
    startTransition(async () => {
      const r = await upsertDeposicion(ninoId, fecha, input)
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
      {deposiciones.length === 0 && !añadiendo && (
        <p className="text-muted-foreground text-sm">{t('sin_registros')}</p>
      )}
      <ul className="space-y-1.5">
        {deposiciones.map((d) => {
          const anulado = esAnulado(d.observaciones)
          return (
            <li
              key={d.id}
              className={cn(
                'border-border/60 flex flex-wrap items-center gap-2 rounded-lg border p-2 text-sm',
                anulado && 'opacity-50'
              )}
            >
              {anulado && <Badge variant="secondary">{t('estado.anulado')}</Badge>}
              {d.hora && <span className="font-mono text-xs">{d.hora.slice(0, 5)}</span>}
              <Badge variant="info">{t(`tipo_deposicion_opciones.${d.tipo}`)}</Badge>
              <span className={cn(anulado && 'line-through')}>
                {t(`cantidad_deposicion_opciones.${d.cantidad}`)}
              </span>
              {d.consistencia && (
                <span className={cn('text-muted-foreground', anulado && 'line-through')}>
                  · {t(`consistencia_opciones.${d.consistencia}`)}
                </span>
              )}
              {!diaCerrado && !anulado && (
                <div className="ml-auto">
                  <BotonMarcarErroneo tabla="deposiciones" id={d.id} />
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
              <Label className="text-xs">{t('campos.hora')}</Label>
              <Input type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('campos.tipo')}</Label>
              <Select
                items={tipoItems}
                value={tipo}
                onValueChange={(v) => setTipo(v as TipoDeposicion)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {tipoItems.map((i) => (
                    <SelectItem key={i.value} value={i.value}>
                      {i.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {tipo !== 'pipi' && (
              <div className="space-y-1">
                <Label className="text-xs">{t('campos.consistencia')}</Label>
                <Select
                  items={consistenciaItems}
                  value={consistencia || undefined}
                  onValueChange={(v) => setConsistencia(v as ConsistenciaDeposicion)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {consistenciaItems.map((i) => (
                      <SelectItem key={i.value} value={i.value}>
                        {i.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs">{t('campos.cantidad')}</Label>
              <Select
                items={cantidadItems}
                value={cantidad}
                onValueChange={(v) => setCantidad(v as CantidadDeposicion)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {cantidadItems.map((i) => (
                    <SelectItem key={i.value} value={i.value}>
                      {i.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
          data-testid="anadir-deposicion"
        >
          <PlusIcon />
          {t('anadir.deposicion')}
        </Button>
      )}
    </div>
  )
}
