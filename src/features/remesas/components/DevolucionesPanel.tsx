'use client'

import { useLocale, useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { hoyMadrid } from '@/features/agenda-diaria/lib/fecha'
import { ResolverDesbordeDialog } from '@/features/beca-comedor/components/ResolverDesbordeDialog'
import { formatEuros } from '@/shared/lib/format-money'

import {
  cobrableAMano,
  devolucionPorResolver,
  etiquetaMes,
  formaPorDefecto,
  importeDevolucion,
  mesSiguiente,
  type ReciboGestion,
  type SobranteCheque,
} from '../lib/gestion-cobros'
import { MarcarCobradoDialog } from './MarcarCobradoDialog'
import { MarcarDevueltoDialog } from './MarcarDevueltoDialog'
import { ResolverDevolucionDialog } from './ResolverDevolucionDialog'

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
  const tRecibos = useTranslations('recibos')
  const locale = useLocale()
  const hoy = hoyMadrid()

  // PR-1c: el sobrante del cheque, pendiente o cómo se resolvió.
  function textoSobrante(s: SobranteCheque): string {
    const importe = formatEuros(s.excesoCentimos, locale)
    switch (s.resueltoPor) {
      case null:
        return t('sobrante_pendiente', { importe })
      case 'diferir':
        return t('sobrante_diferido', { importe, mes: etiquetaMes(mesSiguiente(s.mes), locale) })
      case 'transferencia':
        return t('sobrante_transferencia', { importe })
    }
  }

  return (
    <Card className="space-y-3 p-5">
      <h2 className="text-foreground text-base font-semibold">{t('devoluciones_title')}</h2>
      {recibos.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('sin_cobros')}</p>
      ) : (
        <div className="divide-y rounded-md border">
          {recibos.map((r) => {
            const descripcion = `${r.familiaEtiqueta} · ${formatEuros(r.totalCentimos, locale)}`
            // PR-2: un devuelto ya resuelto se lee «Devuelto · cobrado por: …», también si quedó cobrado.
            const estadoVisible = r.devolucionSalida ? 'devuelto' : r.estado
            return (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm"
              >
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span>{r.familiaEtiqueta}</span>
                    <Badge
                      variant={
                        r.devolucionSalida ? 'secondary' : (BADGE_VARIANT[r.estado] ?? 'outline')
                      }
                    >
                      {t(`estado_recibo.${estadoVisible}`)}
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
                      {r.devolucionGastosCentimos
                        ? ` · ${t('gastos_devolucion', { importe: formatEuros(r.devolucionGastosCentimos, locale) })}`
                        : ''}
                    </p>
                  )}
                  {r.devolucionSalida === 'siguiente_recibo' && (
                    <p className="text-muted-foreground text-xs">
                      {r.arrastradoA
                        ? t('arrastrada_a', {
                            mes: etiquetaMes(r.arrastradoA, locale),
                            importe: formatEuros(importeDevolucion(r), locale),
                          })
                        : t('cobrado_por', { salida: t(`salidas_cobrado.${r.devolucionSalida}`) })}
                    </p>
                  )}
                  {r.devolucionSalida && r.devolucionSalida !== 'siguiente_recibo' && (
                    <p className="text-muted-foreground text-xs">
                      {t('cobrado_por', { salida: t(`salidas_cobrado.${r.devolucionSalida}`) })}
                      {` · ${formatEuros(importeDevolucion(r), locale)}`}
                      {r.cobroFecha ? ` · ${r.cobroFecha}` : ''}
                      {r.cobroNota ? ` · ${r.cobroNota}` : ''}
                    </p>
                  )}
                  {!r.devolucionSalida &&
                    r.estado === 'cobrado_manual' &&
                    r.cobroFecha &&
                    r.cobroForma && (
                      <p className="text-muted-foreground text-xs">
                        {t('cobrado_el', {
                          fecha: r.cobroFecha,
                          forma: tRecibos(`metodos.${r.cobroForma}`),
                        })}
                        {r.cobroImporteCentimos != null &&
                          ` · ${t('cheque_de', { importe: formatEuros(r.cobroImporteCentimos, locale) })}`}
                        {r.cobroImporteCentimos != null &&
                          r.cobroImporteCentimos < r.totalCentimos &&
                          ` · ${t('diferencia_en_recibo_aparte', {
                            importe: formatEuros(r.totalCentimos - r.cobroImporteCentimos, locale),
                          })}`}
                        {r.sobranteCheque && ` · ${textoSobrante(r.sobranteCheque)}`}
                        {r.cobroNota ? ` · ${r.cobroNota}` : ''}
                      </p>
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {r.estado === 'enviado_banco' && (
                    <MarcarDevueltoDialog
                      reciboId={r.id}
                      descripcion={descripcion}
                      fechaEnvio={r.fechaEnvioBanco}
                      hoy={hoy}
                      trigger={
                        <Button size="sm" variant="outline">
                          {t('marcar_devuelto')}
                        </Button>
                      }
                    />
                  )}
                  {devolucionPorResolver(r) && (
                    <ResolverDevolucionDialog
                      reciboId={r.id}
                      descripcion={descripcion}
                      totalCentimos={r.totalCentimos}
                      gastosCentimos={r.devolucionGastosCentimos ?? 0}
                      fechaDevolucion={r.fechaDevolucion}
                      permiteSepa={r.familiaConMandato}
                      arrastre={r.arrastre}
                      hoy={hoy}
                      trigger={
                        <Button size="sm" variant="outline">
                          {t('resolver_devolucion')}
                        </Button>
                      }
                    />
                  )}
                  {r.sobranteCheque &&
                    r.sobranteCheque.resueltoPor === null &&
                    r.cobroImporteCentimos != null && (
                      <ResolverDesbordeDialog
                        reciboId={r.id}
                        anio={r.sobranteCheque.mes.anio}
                        mes={r.sobranteCheque.mes.mes}
                        cuotaCentimos={r.totalCentimos}
                        becaCentimos={r.cobroImporteCentimos}
                        excesoCentimos={r.sobranteCheque.excesoCentimos}
                        origen="cheque"
                        trigger={
                          <Button size="sm" variant="outline">
                            {t('resolver_sobrante')}
                          </Button>
                        }
                      />
                    )}
                  {cobrableAMano(r) && (
                    <MarcarCobradoDialog
                      reciboId={r.id}
                      descripcion={descripcion}
                      totalCentimos={r.totalCentimos}
                      formaPorDefecto={formaPorDefecto(r)}
                      permiteSepa={r.familiaConMandato}
                      hoy={hoy}
                      trigger={
                        <Button size="sm" variant="outline">
                          {t('cobrar_manual')}
                        </Button>
                      }
                    />
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
