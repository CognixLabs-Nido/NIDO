import { ChevronRightIcon } from 'lucide-react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { formatEuros } from '@/shared/lib/format-money'

import { formatPeriodo } from '../lib/formato'
import type { EstadoHistorial, ReciboHistorial, ReferenciaRecibo } from '../lib/historial-familia'

type BadgeVariant = 'secondary' | 'warm' | 'outline' | 'success' | 'info'

/** Lo que pide algo (un borrador, una devolución) en cálido; lo cerrado, en verde. */
export const BADGE_ESTADO_HISTORIAL: Record<EstadoHistorial, BadgeVariant> = {
  borrador: 'outline',
  validado: 'secondary',
  en_remesa: 'info',
  enviado_banco: 'info',
  devuelto: 'warm',
  cobrado: 'success',
}

/** Enlace al recibo de la familia en la vista de Dirección. */
export function hrefRecibo(locale: string, familiaId: string, reciboId: string): string {
  return `/${locale}/admin/familias/${familiaId}/recibos/${reciboId}`
}

/** El título de un recibo: su concepto si es esporádico y lo tiene; si no, el mes. */
export function tituloRecibo(r: ReciboHistorial, locale: string): string {
  return r.tipo !== 'mensual' && r.concepto ? r.concepto : formatPeriodo(r.anio, r.mes, locale)
}

/**
 * Histórico de recibos de la familia en su ficha (F-6): uno por fila, el más reciente arriba, con
 * su estado y lo que pasó al cobrarlo. El título abre el recibo; los recibos enlazados (el re-giro,
 * la diferencia de un cheque, adónde se llevó una devolución) también se abren.
 */
export function HistorialRecibosFamilia({
  recibos,
  familiaId,
  locale,
}: {
  recibos: ReciboHistorial[]
  familiaId: string
  locale: string
}) {
  const t = useTranslations('admin.familias.recibos')
  return (
    <Card className="overflow-hidden">
      <ul className="divide-border/60 divide-y">
        {recibos.map((r) => (
          <li key={r.id} className="space-y-1 px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={hrefRecibo(locale, familiaId, r.id)}
                className="text-foreground inline-flex items-center gap-1 font-medium hover:underline"
              >
                {tituloRecibo(r, locale)}
                <ChevronRightIcon className="text-muted-foreground size-4" />
              </Link>
              {r.tipo !== 'mensual' && <Badge variant="outline">{t(`tipo.${r.tipo}`)}</Badge>}
              <Badge variant={BADGE_ESTADO_HISTORIAL[r.estado]}>{t(`estado.${r.estado}`)}</Badge>
              <span className="ml-auto font-medium tabular-nums">
                {formatEuros(r.totalCentimos, locale)}
              </span>
            </div>
            <HistoriaCobro recibo={r} familiaId={familiaId} locale={locale} />
          </li>
        ))}
      </ul>
    </Card>
  )
}

/**
 * Lo que pasó con un recibo, frase a frase: la forma de pago, la remesa, el envío al banco, el
 * cobro a mano (con el cheque, su diferencia o su sobrante), la devolución con su salida, de qué
 * recibo nace y qué trae de otros. Cada recibo enlazado se abre. `conNota` enseña la nota del cobro,
 * que es texto libre: solo en el detalle.
 */
export function HistoriaCobro({
  recibo: r,
  familiaId,
  locale,
  conNota = false,
}: {
  recibo: ReciboHistorial
  familiaId: string
  locale: string
  conNota?: boolean
}) {
  const t = useTranslations('admin.familias.recibos')
  const tRecibos = useTranslations('recibos')
  const euros = (c: number) => formatEuros(c, locale)
  const mes = (ref: { anio: number; mes: number }) => formatPeriodo(ref.anio, ref.mes, locale)
  const enlace = (ref: ReferenciaRecibo, texto: string) => (
    <Link href={hrefRecibo(locale, familiaId, ref.reciboId)} className="underline">
      {texto}
    </Link>
  )

  const frases: React.ReactNode[] = []

  frases.push(
    <>
      {t('forma', { forma: r.metodo ? tRecibos(`metodos.${r.metodo}`) : tRecibos('sin_metodo') })}
    </>
  )

  if (r.origen) {
    frases.push(
      enlace(
        r.origen,
        t(r.tipo === 'regiro' ? 'origen_regiro' : 'origen_diferencia', { mes: mes(r.origen) })
      )
    )
  }

  if (r.remesa) {
    frases.push(
      <>{t(r.remesa.enviada ? 'en_remesa_enviada' : 'en_remesa', { mes: mes(r.remesa) })}</>
    )
  }
  if (r.fechaEnvioBanco) frases.push(<>{t('enviado_el', { fecha: r.fechaEnvioBanco })}</>)

  if (r.devolucion) {
    const d = r.devolucion
    frases.push(
      <>
        {d.fecha ? t('devuelto_el', { fecha: d.fecha }) : t('devuelto')}
        {d.gastosCentimos > 0 ? ` · ${t('gastos', { importe: euros(d.gastosCentimos) })}` : ''}
      </>
    )
    const importe = euros(d.importeCentimos)
    if (d.salida === null) {
      frases.push(<>{t('devolucion_pendiente', { importe })}</>)
    } else if (d.salida === 'banco') {
      frases.push(
        d.llevadaA
          ? enlace(d.llevadaA, t('devolucion_banco', { importe }))
          : t('devolucion_banco', { importe })
      )
    } else if (d.salida === 'siguiente_recibo') {
      frases.push(
        d.llevadaA
          ? enlace(d.llevadaA, t('devolucion_siguiente', { importe, mes: mes(d.llevadaA) }))
          : t('devolucion_siguiente_sin_recibo', { importe })
      )
    }
  }

  if (r.cobro) {
    const c = r.cobro
    // Lo cobrado: con una devolución cobrada a mano, el recibo más los gastos.
    const cobrado = r.devolucion ? r.devolucion.importeCentimos : r.totalCentimos
    frases.push(
      <>
        {c.fecha ? t('cobrado_el', { fecha: c.fecha }) : t('cobrado')}
        {c.forma ? ` · ${tRecibos(`metodos.${c.forma}`)}` : ''}
        {c.chequeCentimos == null ? ` · ${euros(cobrado)}` : ''}
      </>
    )
    if (c.chequeCentimos != null) {
      frases.push(<>{t('cheque_de', { importe: euros(c.chequeCentimos) })}</>)
    }
    if (conNota && c.nota) frases.push(<>{t('nota', { nota: c.nota })}</>)
  }

  if (r.diferencia) {
    frases.push(
      enlace(r.diferencia, t('diferencia', { importe: euros(r.diferencia.totalCentimos) }))
    )
  }

  if (r.sobrante) {
    const s = r.sobrante
    const importe = euros(s.excesoCentimos)
    if (s.resueltoPor === null) frases.push(<>{t('sobrante_pendiente', { importe })}</>)
    else if (s.resueltoPor === 'transferencia')
      frases.push(<>{t('sobrante_transferencia', { importe })}</>)
    else
      frases.push(
        s.diferidoA
          ? enlace(s.diferidoA, t('sobrante_diferido', { importe, mes: mes(s.diferidoA) }))
          : t('sobrante_diferido_sin_recibo', { importe })
      )
  }

  for (const inc of r.incluye) {
    frases.push(
      enlace(
        inc,
        t(inc.tipo === 'devolucion' ? 'incluye_devolucion' : 'incluye_sobrante', {
          mes: mes(inc),
          importe: euros(Math.abs(inc.importeCentimos)),
        })
      )
    )
  }

  return (
    <p className="text-muted-foreground flex flex-wrap gap-x-2 gap-y-0.5 text-xs">
      {frases.map((f, i) => (
        <span key={i}>
          {i > 0 && <span aria-hidden="true">· </span>}
          {f}
        </span>
      ))}
    </p>
  )
}
