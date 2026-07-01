import { getTranslations } from 'next-intl/server'

import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { pivoteACsvFilas } from '@/features/recibos/lib/pivote-csv'
import { getPivotePeriodo } from '@/features/recibos/queries/get-pivote-periodo'
import { generarCsv } from '@/shared/lib/export-csv'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Descarga CSV de la pivote de recibos del período (F12-B-7): filas = recibo (tutor +
 * niño + estado + método), columnas = por concepto, con totales por columna y general.
 * Bajo demanda, no se almacena. Autoriza vía RLS (getPivotePeriodo solo ve los recibos
 * del centro del admin). Sin período válido / sin centro → 400.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ locale: string }> }
): Promise<Response> {
  const { locale } = await params
  const { searchParams } = new URL(request.url)
  const anio = clampInt(searchParams.get('anio'), 2024, 2100)
  const mes = clampInt(searchParams.get('mes'), 1, 12)
  if (anio === null || mes === null) return new Response('bad_request', { status: 400 })

  const centroId = await getCentroActualId()
  if (!centroId) return new Response('forbidden', { status: 403 })

  const [pivote, t] = await Promise.all([
    getPivotePeriodo(centroId, anio, mes),
    getTranslations({ locale, namespace: 'recibos' }),
  ])

  const filas = pivoteACsvFilas(pivote, {
    tutor: t('csv.tutor'),
    nino: t('csv.nino'),
    estado: t('csv.estado'),
    metodo: t('csv.metodo'),
    total: t('csv.total'),
    totalesFila: t('csv.totales'),
    sinMetodo: t('sin_metodo'),
    estadoLabel: (e) => t(`estado_recibo.${e}`),
    metodoLabel: (m) => t(`metodos.${m}`),
  })

  const csv = generarCsv(filas)
  const filename = `recibos-${anio}-${String(mes).padStart(2, '0')}.csv`
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}

/** Entero dentro de [min,max] o null (→ 400). */
function clampInt(raw: string | null, min: number, max: number): number | null {
  const n = Number(raw)
  return Number.isInteger(n) && n >= min && n <= max ? n : null
}
