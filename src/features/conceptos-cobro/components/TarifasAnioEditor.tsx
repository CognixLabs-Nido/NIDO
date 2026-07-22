'use client'

import { useMemo, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { centimosAEuros } from '@/shared/lib/format-money'

import {
  eliminarTarifaConceptoAnio,
  guardarTarifaConceptoAnio,
} from '../actions/tarifa-concepto-anio'
import type { TarifaAnioItem } from '../queries/get-tarifas-concepto-anio'

interface Props {
  conceptoId: string
  /** Años de nacimiento presentes en el centro (derivados de los niños). */
  aniosNacimientoCentro: number[]
  /** Tarifas ya guardadas para este concepto. */
  tarifas: TarifaAnioItem[]
}

/**
 * B1-2 — editor de importes por año de nacimiento de un concepto. Muestra una fila por año
 * (los años del centro + los que ya tienen tarifa + los añadidos a mano) y permite guardar /
 * quitar cada tarifa por separado (upsert/delete directo, patrón panel-por-fila). El
 * refresco de datos lo hace `revalidatePath` dentro de las server actions.
 */
export function TarifasAnioEditor({ conceptoId, aniosNacimientoCentro, tarifas }: Props) {
  const t = useTranslations('admin.cuotas.tarifa_anio')
  const [aniosManuales, setAniosManuales] = useState<number[]>([])
  const [nuevoAnio, setNuevoAnio] = useState('')

  const tarifaPorAnio = useMemo(() => {
    const m = new Map<number, TarifaAnioItem>()
    for (const tf of tarifas) m.set(tf.anioNacimiento, tf)
    return m
  }, [tarifas])

  // Años a mostrar: centro ∪ con-tarifa ∪ añadidos a mano, descendente (el más nuevo arriba).
  const anios = useMemo(() => {
    const set = new Set<number>([
      ...aniosNacimientoCentro,
      ...tarifas.map((tf) => tf.anioNacimiento),
      ...aniosManuales,
    ])
    return [...set].sort((a, b) => b - a)
  }, [aniosNacimientoCentro, tarifas, aniosManuales])

  function anadirAnio() {
    const n = Number(nuevoAnio)
    if (!Number.isInteger(n) || n < 2000 || n > 2100) {
      toast.error(t('validation.anio_invalido'))
      return
    }
    if (!anios.includes(n)) setAniosManuales((prev) => [...prev, n])
    setNuevoAnio('')
  }

  return (
    <div className="bg-muted/40 space-y-3 rounded-md border p-3">
      <div className="space-y-0.5">
        <p className="text-sm font-medium">{t('title')}</p>
        <p className="text-muted-foreground text-xs">{t('hint_override')}</p>
      </div>

      {anios.length === 0 ? (
        <p className="text-muted-foreground text-xs">{t('sin_anios')}</p>
      ) : (
        <div className="space-y-2">
          <div className="text-muted-foreground grid grid-cols-[5rem_1fr_auto] items-center gap-2 text-xs">
            <span>{t('col_anio')}</span>
            <span>{t('col_importe')}</span>
            <span />
          </div>
          {anios.map((anio) => (
            <FilaTarifa
              key={anio}
              conceptoId={conceptoId}
              anio={anio}
              tarifa={tarifaPorAnio.get(anio)}
            />
          ))}
        </div>
      )}

      <div className="flex items-end gap-2 pt-1">
        <Input
          type="number"
          min={2000}
          max={2100}
          inputMode="numeric"
          className="w-32"
          placeholder={t('anio_placeholder')}
          value={nuevoAnio}
          onChange={(e) => setNuevoAnio(e.target.value)}
        />
        <Button type="button" variant="outline" size="sm" onClick={anadirAnio}>
          {t('anadir_anio')}
        </Button>
      </div>
    </div>
  )
}

function FilaTarifa({
  conceptoId,
  anio,
  tarifa,
}: {
  conceptoId: string
  anio: number
  tarifa?: TarifaAnioItem
}) {
  const t = useTranslations('admin.cuotas.tarifa_anio')
  const tErrors = useTranslations()
  const [euros, setEuros] = useState(tarifa ? String(centimosAEuros(tarifa.importeCentimos)) : '')
  const [pending, startTransition] = useTransition()

  function guardar() {
    startTransition(async () => {
      const r = await guardarTarifaConceptoAnio({
        concepto_id: conceptoId,
        anio_nacimiento: anio,
        importe_euros: euros === '' ? NaN : Number(euros),
      })
      if (r.success) toast.success(t('saved'))
      else toast.error(tErrors(r.error))
    })
  }

  function quitar() {
    startTransition(async () => {
      const r = await eliminarTarifaConceptoAnio({ concepto_id: conceptoId, anio_nacimiento: anio })
      if (r.success) {
        toast.success(t('deleted'))
        setEuros('')
      } else {
        toast.error(tErrors(r.error))
      }
    })
  }

  return (
    <div className="grid grid-cols-[5rem_1fr_auto] items-center gap-2">
      <span className="text-sm tabular-nums">{anio}</span>
      <Input
        type="number"
        min={0}
        step={0.01}
        inputMode="decimal"
        value={euros}
        onChange={(e) => setEuros(e.target.value)}
      />
      <div className="flex gap-1">
        <Button type="button" size="sm" variant="secondary" disabled={pending} onClick={guardar}>
          {t('guardar')}
        </Button>
        {tarifa && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={pending}
            onClick={quitar}
          >
            {t('quitar')}
          </Button>
        )}
      </div>
    </div>
  )
}
