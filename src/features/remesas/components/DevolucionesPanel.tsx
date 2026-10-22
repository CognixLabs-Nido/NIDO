'use client'

import { useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { hoyMadrid } from '@/features/agenda-diaria/lib/fecha'
import { formatEuros } from '@/shared/lib/format-money'

import { crearRegiro } from '../actions/crear-regiro'
import { marcarReciboDevuelto } from '../actions/marcar-recibo-devuelto'
import { cobrableAMano, type ReciboGestion } from '../lib/gestion-cobros'
import { GastosDevolucionDialog } from './GastosDevolucionDialog'
import { MarcarCobradoDialog } from './MarcarCobradoDialog'

interface Props {
  recibos: ReciboGestion[]
}

const BADGE_VARIANT: Record<string, 'secondary' | 'warm' | 'outline'> = {
  pendiente_procesar: 'warm',
  enviado_banco: 'outline',
  devuelto: 'warm',
  cobrado_manual: 'secondary',
}

export function DevolucionesPanel({ recibos }: Props) {
  const t = useTranslations('remesas')
  const tErrors = useTranslations()
  const tRecibos = useTranslations('recibos')
  const locale = useLocale()
  const [pending, startTransition] = useTransition()
  const hoy = hoyMadrid()

  function run(fn: () => Promise<{ success: boolean; error?: string }>, okKey: string) {
    startTransition(async () => {
      const r = await fn()
      if (r.success) toast.success(t(okKey))
      else toast.error(tErrors(r.error ?? 'remesas.errors.invalid'))
    })
  }

  return (
    <Card className="space-y-3 p-5">
      <h2 className="text-foreground text-base font-semibold">{t('devoluciones_title')}</h2>
      {recibos.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('sin_cobros')}</p>
      ) : (
        <div className="divide-y rounded-md border">
          {recibos.map((r) => (
            <div
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm"
            >
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span>{r.familiaEtiqueta}</span>
                  <Badge variant={BADGE_VARIANT[r.estado] ?? 'outline'}>
                    {t(`estado_recibo.${r.estado}`)}
                  </Badge>
                  {r.esRegiro && <Badge variant="outline">{t('regiro_badge')}</Badge>}
                  {r.esEsporadico && <Badge variant="outline">{t('esporadico_badge')}</Badge>}
                  <span className="tabular-nums">{formatEuros(r.totalCentimos, locale)}</span>
                </div>
                {r.estado === 'pendiente_procesar' && (
                  <p className="text-muted-foreground text-xs">
                    {r.metodo ? tRecibos(`metodos.${r.metodo}`) : t('sin_metodo')}
                    {r.conceptoEsporadico ? ` · ${r.conceptoEsporadico}` : ''}
                  </p>
                )}
                {r.fechaDevolucion && (
                  <p className="text-muted-foreground text-xs">
                    {t('devuelta_el', { fecha: r.fechaDevolucion })}
                  </p>
                )}
                {r.estado === 'cobrado_manual' && r.cobroFecha && r.cobroForma && (
                  <p className="text-muted-foreground text-xs">
                    {t('cobrado_el', {
                      fecha: r.cobroFecha,
                      forma: tRecibos(`metodos.${r.cobroForma}`),
                    })}
                    {r.cobroNota ? ` · ${r.cobroNota}` : ''}
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {r.estado === 'enviado_banco' && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      run(() => marcarReciboDevuelto({ reciboId: r.id }), 'devuelto_ok')
                    }
                  >
                    {t('marcar_devuelto')}
                  </Button>
                )}
                {r.estado === 'devuelto' && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => run(() => crearRegiro({ reciboId: r.id }), 'regiro_ok')}
                    >
                      {t('regirar')}
                    </Button>
                    <GastosDevolucionDialog
                      reciboId={r.id}
                      trigger={
                        <Button size="sm" variant="outline">
                          {t('anadir_gastos')}
                        </Button>
                      }
                    />
                  </>
                )}
                {cobrableAMano(r) && (
                  <MarcarCobradoDialog
                    reciboId={r.id}
                    descripcion={`${r.familiaEtiqueta} · ${formatEuros(r.totalCentimos, locale)}`}
                    formaPorDefecto={r.metodo === 'transferencia' ? 'transferencia' : 'efectivo'}
                    hoy={hoy}
                    trigger={
                      <Button size="sm" variant="outline" disabled={pending}>
                        {t('cobrar_manual')}
                      </Button>
                    }
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
