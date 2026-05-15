'use client'

import { PlusIcon } from 'lucide-react'
import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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

import { upsertBiberon } from '../actions/upsert-biberon'
import { esAnulado } from '../schemas/agenda-diaria'
import type { BiberonInput, TipoBiberon } from '../schemas/agenda-diaria'
import type { BiberonRow } from '../types'

import { BotonMarcarErroneo } from './BotonMarcarErroneo'

interface Props {
  ninoId: string
  fecha: string
  biberones: BiberonRow[]
  diaCerrado: boolean
}

const TIPOS: TipoBiberon[] = ['materna', 'formula', 'agua', 'infusion', 'zumo']

export function SeccionBiberones({ ninoId, fecha, biberones, diaCerrado }: Props) {
  const t = useTranslations('agenda')
  const tErrors = useTranslations()
  const [añadiendo, setAñadiendo] = useState(false)
  const [hora, setHora] = useState('')
  const [cantidadMl, setCantidadMl] = useState('120')
  const [tipo, setTipo] = useState<TipoBiberon>('formula')
  const [tomadoCompleto, setTomadoCompleto] = useState(true)
  const [observaciones, setObservaciones] = useState('')
  const [pending, startTransition] = useTransition()

  const tipoItems = TIPOS.map((v) => ({ value: v, label: t(`tipo_biberon_opciones.${v}`) }))

  function reset() {
    setHora('')
    setCantidadMl('120')
    setTipo('formula')
    setTomadoCompleto(true)
    setObservaciones('')
    setAñadiendo(false)
  }

  function guardar() {
    const input: BiberonInput = {
      hora,
      cantidad_ml: Number(cantidadMl),
      tipo,
      tomado_completo: tomadoCompleto,
      observaciones: observaciones.trim() === '' ? null : observaciones,
    }
    startTransition(async () => {
      const r = await upsertBiberon(ninoId, fecha, input)
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
      {biberones.length === 0 && !añadiendo && (
        <p className="text-muted-foreground text-sm">{t('sin_registros')}</p>
      )}
      <ul className="space-y-1.5">
        {biberones.map((b) => {
          const anulado = esAnulado(b.observaciones)
          return (
            <li
              key={b.id}
              className={cn(
                'border-border/60 flex flex-wrap items-center gap-2 rounded-lg border p-2 text-sm',
                anulado && 'opacity-50'
              )}
            >
              {anulado && <Badge variant="secondary">{t('estado.anulado')}</Badge>}
              <span className="font-mono text-xs">{b.hora.slice(0, 5)}</span>
              <Badge variant="info">{t(`tipo_biberon_opciones.${b.tipo}`)}</Badge>
              <span className={cn(anulado && 'line-through')}>{b.cantidad_ml} ml</span>
              {!diaCerrado && !anulado && (
                <div className="ml-auto">
                  <BotonMarcarErroneo tabla="biberones" id={b.id} />
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
              <Label className="text-xs">{t('campos.cantidad_ml')}</Label>
              <Input
                type="number"
                min={0}
                max={500}
                value={cantidadMl}
                onChange={(e) => setCantidadMl(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('campos.tipo')}</Label>
            <Select items={tipoItems} value={tipo} onValueChange={(v) => setTipo(v as TipoBiberon)}>
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
          <div className="flex items-center gap-2">
            <Checkbox
              id="tomado_completo"
              checked={tomadoCompleto}
              onCheckedChange={(c) => setTomadoCompleto(c === true)}
            />
            <Label htmlFor="tomado_completo" className="text-xs font-normal">
              {t('campos.tomado_completo')}
            </Label>
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
          data-testid="anadir-biberon"
        >
          <PlusIcon />
          {t('anadir.biberon')}
        </Button>
      )}
    </div>
  )
}
