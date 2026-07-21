import { getTranslations } from 'next-intl/server'

import { formatPeriodo } from '@/features/recibos/lib/formato'
import { generarReciboPdf, type LineaReciboPdf } from '@/features/recibos/lib/recibo-pdf'
import { getReciboParaPdf } from '@/features/recibos/queries/get-recibo-pdf-data'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Descarga en PDF de un recibo FAMILIAR (B4). La autorización es la MISMA que la pantalla
 * del portal: `getReciboParaPdf` lee con RLS (`es_tutor_de_familia`) y excluye borradores →
 * un tutor solo baja SUS recibos; si no es visible → 404. El contenido (logo de NIDO,
 * nombre del niño una vez, líneas limpias) lo arma `generarReciboPdf`.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ locale: string; id: string }> }
): Promise<Response> {
  const { locale, id } = await params

  const recibo = await getReciboParaPdf(id)
  if (!recibo) return new Response('Not found', { status: 404 })

  const t = await getTranslations('recibos')

  const titulo =
    recibo.esEsporadico && recibo.conceptoEsporadico
      ? recibo.conceptoEsporadico
      : formatPeriodo(recibo.anio, recibo.mes, locale)

  const metodoLabel = recibo.metodo
    ? `${t('metodo_label')}: ${t(`metodos.${recibo.metodo}`)}`
    : null

  const fechaPartes = [
    recibo.fechaEnvioBanco ? t('enviado_el', { fecha: recibo.fechaEnvioBanco }) : null,
    recibo.fechaDevolucion ? t('devuelto_el', { fecha: recibo.fechaDevolucion }) : null,
  ].filter(Boolean)

  const aLinea = (l: {
    descripcion: string
    cantidad: number
    precioUnitarioCentimos: number
    importeCentimos: number
  }): LineaReciboPdf => ({
    etiqueta: l.descripcion,
    cantidad: l.cantidad,
    precioUnitarioCentimos: l.precioUnitarioCentimos,
    importeCentimos: l.importeCentimos,
  })

  const bytes = await generarReciboPdf({
    centroNombre: recibo.centroNombre,
    titulo,
    estadoLabel: t(`estado_recibo.${recibo.estado}`),
    metodoLabel,
    fechaLinea: fechaPartes.length > 0 ? fechaPartes.join('   ·   ') : null,
    labels: {
      documento: t('pdf_titulo'),
      concepto: t('concepto'),
      cantidad: t('cantidad'),
      precioUnitario: t('precio_unitario'),
      importe: t('importe'),
      subtotal: t('subtotal'),
      total: t('total'),
      lineasFamiliares: t('lineas_familiares'),
    },
    gruposHijo: recibo.gruposHijo.map((g) => ({
      ninoNombre: g.ninoNombre,
      lineas: g.lineas.map(aLinea),
      subtotalCentimos: g.subtotalCentimos,
    })),
    lineasFamiliares: recibo.lineasFamiliares.map(aLinea),
    subtotalFamiliarCentimos: recibo.subtotalFamiliarCentimos,
    totalCentimos: recibo.totalCentimos,
  })

  const mes2 = String(recibo.mes).padStart(2, '0')
  return new Response(Buffer.from(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="recibo-${recibo.anio}-${mes2}.pdf"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
