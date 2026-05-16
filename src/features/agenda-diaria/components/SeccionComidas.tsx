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
import { agruparComidasPorMomento } from '@/features/menus/lib/agrupar-comidas'

import { upsertComida } from '../actions/upsert-comida'
import { esAnulado } from '../schemas/agenda-diaria'
import type { ComidaInput, CantidadComida, MomentoComida } from '../schemas/agenda-diaria'
import type { ComidaRow } from '../types'

import { BotonMarcarErroneo } from './BotonMarcarErroneo'

interface Props {
  ninoId: string
  fecha: string
  comidas: ComidaRow[]
  diaCerrado: boolean
}

const MOMENTOS: MomentoComida[] = ['desayuno', 'media_manana', 'comida', 'merienda']
const CANTIDADES: CantidadComida[] = ['todo', 'mayoria', 'mitad', 'poco', 'nada']

export function SeccionComidas({ ninoId, fecha, comidas, diaCerrado }: Props) {
  const t = useTranslations('agenda')
  const tErrors = useTranslations()
  const [añadiendo, setAñadiendo] = useState(false)
  const [momento, setMomento] = useState<MomentoComida>('comida')
  const [hora, setHora] = useState('')
  const [cantidad, setCantidad] = useState<CantidadComida>('todo')
  const [descripcion, setDescripcion] = useState('')
  const [observaciones, setObservaciones] = useState('')
  const [pending, startTransition] = useTransition()

  const momentoItems = MOMENTOS.map((v) => ({ value: v, label: t(`momento_opciones.${v}`) }))
  const cantidadItems = CANTIDADES.map((v) => ({
    value: v,
    label: t(`cantidad_comida_opciones.${v}`),
  }))

  function reset() {
    setMomento('comida')
    setHora('')
    setCantidad('todo')
    setDescripcion('')
    setObservaciones('')
    setAñadiendo(false)
  }

  function guardar() {
    const input: ComidaInput = {
      momento,
      hora: hora === '' ? null : hora,
      cantidad,
      descripcion: descripcion.trim() === '' ? null : descripcion,
      observaciones: observaciones.trim() === '' ? null : observaciones,
    }
    startTransition(async () => {
      const r = await upsertComida(ninoId, fecha, input)
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
      {comidas.length === 0 && !añadiendo && (
        <p className="text-muted-foreground text-sm">{t('sin_registros')}</p>
      )}
      <div className="space-y-3">
        {agruparComidasPorMomento(comidas).map((grupo) => (
          <GrupoComidaProfe
            key={grupo.momento}
            momento={grupo.momento}
            filasGenericas={grupo.filasGenericas as ComidaRow[]}
            platos={grupo.platos as ComidaRow[]}
            diaCerrado={diaCerrado}
          />
        ))}
      </div>

      {!diaCerrado && añadiendo && (
        <div
          className="border-border bg-muted/40 space-y-2 rounded-lg border p-3"
          aria-busy={pending}
        >
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">{t('campos.momento')}</Label>
              <Select
                items={momentoItems}
                value={momento}
                onValueChange={(v) => setMomento(v as MomentoComida)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {momentoItems.map((i) => (
                    <SelectItem key={i.value} value={i.value}>
                      {i.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('campos.hora')}</Label>
              <Input
                type="time"
                value={hora}
                onChange={(e) => setHora(e.target.value)}
                placeholder="13:00"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('campos.cantidad')}</Label>
            <Select
              items={cantidadItems}
              value={cantidad}
              onValueChange={(v) => setCantidad(v as CantidadComida)}
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
          <div className="space-y-1">
            <Label className="text-xs">{t('campos.descripcion')}</Label>
            <Input
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              maxLength={500}
            />
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
          data-testid="anadir-comida"
        >
          <PlusIcon />
          {t('anadir.comida')}
        </Button>
      )}
    </div>
  )
}

/**
 * Grupo por momento para la vista profe (cards expandidas del aula).
 * Refleja el mismo patrón que `<GrupoComidaFamilia />` pero con el botón
 * "Marcar erróneo" por fila cuando no es día cerrado.
 */
function GrupoComidaProfe({
  momento,
  filasGenericas,
  platos,
  diaCerrado,
}: {
  momento: ComidaRow['momento']
  filasGenericas: ComidaRow[]
  platos: ComidaRow[]
  diaCerrado: boolean
}) {
  const t = useTranslations('agenda')
  const tPlatos = useTranslations('menus.pase_de_lista.platos')

  return (
    <div className="space-y-1.5" data-testid={`grupo-momento-${momento}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="warm">{t(`momento_opciones.${momento}`)}</Badge>
        {filasGenericas[0]?.hora && (
          <span className="font-mono text-xs">{filasGenericas[0].hora.slice(0, 5)}</span>
        )}
      </div>

      {filasGenericas.length > 0 && (
        <ul className="space-y-1">
          {filasGenericas.map((c) => {
            const anulado = esAnulado(c.observaciones)
            return (
              <li
                key={c.id}
                className={cn(
                  'border-border/60 flex flex-wrap items-center gap-2 rounded-lg border p-2 text-sm',
                  anulado && 'opacity-50'
                )}
              >
                {anulado && <Badge variant="secondary">{t('estado.anulado')}</Badge>}
                <span className={cn(anulado && 'line-through')}>
                  {t(`cantidad_comida_opciones.${c.cantidad}`)}
                </span>
                {c.descripcion && (
                  <span className={cn('text-muted-foreground', anulado && 'line-through')}>
                    · {c.descripcion}
                  </span>
                )}
                {!diaCerrado && !anulado && (
                  <div className="ml-auto">
                    <BotonMarcarErroneo tabla="comidas" id={c.id} />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {platos.length > 0 && (
        <ul className="ml-2 space-y-1 border-l-2 border-neutral-200 pl-3">
          {platos.map((p) => {
            const anulado = esAnulado(p.observaciones)
            return (
              <li
                key={p.id}
                className={cn(
                  'border-border/60 flex flex-wrap items-center gap-2 rounded-lg border p-2 text-sm',
                  anulado && 'opacity-50'
                )}
              >
                {anulado && <Badge variant="secondary">{t('estado.anulado')}</Badge>}
                <Badge variant="secondary">{p.tipo_plato ? tPlatos(p.tipo_plato) : ''}</Badge>
                <span className={cn(anulado && 'line-through')}>
                  {t(`cantidad_comida_opciones.${p.cantidad}`)}
                </span>
                {p.descripcion && (
                  <span className={cn('text-muted-foreground', anulado && 'line-through')}>
                    · {p.descripcion}
                  </span>
                )}
                {!diaCerrado && !anulado && (
                  <div className="ml-auto">
                    <BotonMarcarErroneo tabla="comidas" id={p.id} />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
