'use client'

import { useId, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { fijarFechaCobro } from '../actions/fijar-fecha-cobro'

interface Props {
  centroId: string
  /** Los recibos a los que se pone (o se quita) la fecha. Sin ninguno, se dice que se marquen. */
  reciboIds: string[]
  onHecho?: () => void
}

/**
 * Poner la misma fecha de cobro a varios recibos, o dejarlos sin fecha. Lo que pasa sin fecha va
 * escrito al lado del campo, siempre a la vista: es lo que no se adivina.
 */
export function FechaCobroForm({ centroId, reciboIds, onHecho }: Props) {
  const t = useTranslations('remesas.fecha_cobro')
  const tErrors = useTranslations()
  const id = useId()
  const [fecha, setFecha] = useState('')
  const [pending, startTransition] = useTransition()
  const num = reciboIds.length

  function guardar(valor: string | null) {
    startTransition(async () => {
      const r = await fijarFechaCobro({ centroId, reciboIds, fecha: valor })
      if (r.success) {
        toast.success(t('guardada', { num: r.data.cambiados }))
        onHecho?.()
      } else {
        toast.error(tErrors(r.error))
      }
    })
  }

  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor={id}>{t('label')}</Label>
          <Input
            id={id}
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            className="w-44"
            aria-describedby={`${id}-explicacion`}
          />
        </div>
        <Button
          size="sm"
          disabled={pending || num === 0 || fecha === ''}
          onClick={() => guardar(fecha)}
        >
          {t('poner', { num })}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={pending || num === 0}
          onClick={() => guardar(null)}
        >
          {t('quitar', { num })}
        </Button>
      </div>
      <p id={`${id}-explicacion`} className="text-foreground text-sm">
        {t('explicacion')}
      </p>
      {num === 0 && <p className="text-muted-foreground text-xs">{t('elige_recibos')}</p>}
    </div>
  )
}
