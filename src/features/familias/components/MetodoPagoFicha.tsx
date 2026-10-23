'use client'

import { useState, useTransition } from 'react'
import { AlertTriangleIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { Database } from '@/types/database'

import { fijarMetodoPagoFamilia } from '../actions/fijar-metodo-pago-familia'

type MetodoPago = Database['public']['Enums']['metodo_pago']

const METODOS: MetodoPago[] = ['sepa', 'efectivo', 'cheque_guarderia', 'transferencia']

/**
 * PR-7 — cómo paga la familia, en su ficha. Al generar, cada recibo coge este método; el selector
 * de la lista de recibos queda como excepción de un solo mes. Si paga con recibo por banco y no
 * tiene mandato activo, se avisa: sus recibos no pueden entrar en la remesa.
 */
export function MetodoPagoFicha({
  familiaId,
  metodo,
  tieneMandato,
  soloLectura,
}: {
  familiaId: string
  metodo: MetodoPago
  tieneMandato: boolean
  soloLectura: boolean
}) {
  const t = useTranslations('admin.familias.metodo_pago')
  const tMetodos = useTranslations('recibos_panel.metodos')
  const tErrors = useTranslations()
  const [pending, startTransition] = useTransition()
  const [actual, setActual] = useState<MetodoPago>(metodo)
  const items = METODOS.map((m) => ({ value: m, label: tMetodos(m) }))

  function cambiar(nuevo: MetodoPago) {
    if (nuevo === actual) return
    startTransition(async () => {
      const r = await fijarMetodoPagoFamilia({ familia_id: familiaId, metodo: nuevo })
      if (!r.success) {
        toast.error(tErrors(r.error))
        return
      }
      setActual(nuevo)
      toast.success(t('guardado'))
    })
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="text-foreground font-medium">{t('etiqueta')}</p>
          <p className="text-muted-foreground text-xs">{t('hint')}</p>
        </div>
        <Select items={items} value={actual} onValueChange={(v) => cambiar(v as MetodoPago)}>
          <SelectTrigger
            size="sm"
            className="w-56"
            disabled={pending || soloLectura}
            aria-label={t('etiqueta')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {actual === 'sepa' && !tieneMandato && (
        <p className="text-warm-800 flex items-start gap-2 text-xs" role="status">
          <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
          <span>{t('sepa_sin_mandato')}</span>
        </p>
      )}
    </div>
  )
}
