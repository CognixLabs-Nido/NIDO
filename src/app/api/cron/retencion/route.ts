import { NextResponse } from 'next/server'

import { logger } from '@/shared/lib/logger'

import { purgarVencidos } from '@/features/olvido/actions/purgar-vencidos'
import { barrerRetencion } from '@/features/retencion/actions/barrer-retencion'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Cron de RGPD (F11-A6). Lo dispara **Vercel Cron** (ver `vercel.json`, diario),
 * que añade `Authorization: Bearer ${CRON_SECRET}` a la petición. Ejecuta dos
 * barridos service-role:
 *   1. `purgarVencidos()` — olvido a demanda cuya gracia (30 d) ha vencido (A4).
 *   2. `barrerRetencion()` — retención POR TIEMPO (A6): DNIs de recogida y fotos.
 *
 * `RETENCION_DRY_RUN` (D4): por defecto (sin la var o != 'false') corre en
 * dry-run → registra lo que purgaría SIN borrar. Se pasa a borrado autónomo con
 * `RETENCION_DRY_RUN=false` tras verificar el predicado en producción.
 *
 * No está bajo el proxy de locale/auth (matcher excluye `/api`); el único control
 * de acceso es el secreto. Si falta `CRON_SECRET`, responde 401 (fail-closed).
 */
export async function GET(request: Request): Promise<Response> {
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return new NextResponse('No autorizado', { status: 401 })
  }

  const dryRun = process.env.RETENCION_DRY_RUN !== 'false'

  const olvido = await purgarVencidos()
  const retencion = await barrerRetencion({ dryRun })

  logger.info('cron retencion ejecutado', JSON.stringify({ dryRun, olvido, retencion }))

  return NextResponse.json({ ok: true, dryRun, olvido, retencion })
}
