'use client'

import { type ReactElement, useState, useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { formatEuros } from '@/shared/lib/format-money'

import { resolverDesborde } from '../actions/resolver-desborde'
import { mesSiguiente } from '../lib/reparto-desborde'
import { etiquetaMes } from '../lib/meses'

interface Props {
  reciboId: string
  anio: number
  mes: number
  cuotaCentimos: number
  becaCentimos: number
  excesoCentimos: number
  trigger: ReactElement
}

/**
 * V2-4 — Resuelve el desborde de UN recibo (una familia) por una de las DOS vías: diferir el
 * exceso al mes siguiente (tramos resto por niño) o devolverlo por transferencia. Muestra
 * cuota/beca/exceso. La resolución la ejecuta la server action (reparto y claim server-side).
 */
export function ResolverDesbordeDialog({
  reciboId,
  anio,
  mes,
  cuotaCentimos,
  becaCentimos,
  excesoCentimos,
  trigger,
}: Props) {
  const t = useTranslations('admin.cuotas.beca_comedor.desborde')
  const tRoot = useTranslations()
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const sig = mesSiguiente(anio, mes)
  const mesSiguienteEtiqueta = etiquetaMes(locale, sig.anio, sig.mes)

  function resolver(via: 'diferir' | 'transferencia') {
    startTransition(async () => {
      const r = await resolverDesborde({ recibo_id: reciboId, via })
      if (r.success) {
        toast.success(via === 'diferir' ? t('diferido_ok') : t('transferencia_ok'))
        setOpen(false)
      } else {
        toast.error(tRoot(r.error))
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
        </DialogHeader>

        <p className="text-muted-foreground text-sm">{t('intro')}</p>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <dt className="text-muted-foreground">{t('cuota')}</dt>
          <dd className="text-right tabular-nums">{formatEuros(cuotaCentimos, locale)}</dd>
          <dt className="text-muted-foreground">{t('beca')}</dt>
          <dd className="text-right tabular-nums">{formatEuros(becaCentimos, locale)}</dd>
          <dt className="font-medium">{t('exceso')}</dt>
          <dd className="text-right font-medium tabular-nums">
            {formatEuros(excesoCentimos, locale)}
          </dd>
        </dl>

        <div className="space-y-2 pt-1">
          <p className="text-muted-foreground text-xs">
            {t('via_diferir_hint', { mes: mesSiguienteEtiqueta })}
          </p>
          <p className="text-muted-foreground text-xs">{t('via_transferencia_hint')}</p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {t('cancelar')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => resolver('transferencia')}
            disabled={pending}
          >
            {t('via_transferencia')}
          </Button>
          <Button type="button" onClick={() => resolver('diferir')} disabled={pending}>
            {t('via_diferir')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
