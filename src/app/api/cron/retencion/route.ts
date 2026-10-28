import { NextResponse } from 'next/server'

import { logger } from '@/shared/lib/logger'

import { purgarVencidos } from '@/features/olvido/actions/purgar-vencidos'
import { barrerRetencion } from '@/features/retencion/actions/barrer-retencion'
import { purgarAuditLog } from '@/features/retencion/lib/audit-log'
import { purgarExpedientes } from '@/features/retencion/lib/expediente'
import { purgarLecturasFichaMedica } from '@/features/retencion/lib/lecturas-ficha-medica'
import { purgarListaEspera } from '@/features/retencion/lib/lista-espera'
import { purgarOperativa } from '@/features/retencion/lib/operativa'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * Cron de RGPD (F11-A6). Lo dispara **Vercel Cron** (ver `vercel.json`, diario),
 * que añade `Authorization: Bearer ${CRON_SECRET}` a la petición. Ejecuta los
 * barridos service-role:
 *   1. `purgarVencidos()` — olvido a demanda cuya gracia (30 d) ha vencido (A4).
 *   2. `barrerRetencion()` — retención POR TIEMPO (A6): DNIs de recogida y fotos.
 *   3. `purgarLecturasFichaMedica()` — el registro de lecturas de la ficha médica, al vencer su
 *      plazo provisional (20261128120000).
 *   4. `purgarAuditLog()` — audit_log, al vencer su plazo provisional (20261129120000).
 *   5. `purgarListaEspera()` — los prospectos que no llegaron a alta, al vencer su plazo
 *      provisional (20261130120000).
 *   6. `purgarOperativa()` — la operativa del día a día, al vencer su plazo provisional desde el
 *      final del curso en que se escribió, con sus copias en audit_log (20261203120000).
 *   7. `purgarExpedientes()` — el expediente de los niños de baja, al vencer su plazo provisional
 *      desde la baja: la purga del olvido, con sus ficheros de Storage (20261204120000).
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
  const lecturasFichaMedica = await purgarLecturasFichaMedica({ dryRun })
  const auditLog = await purgarAuditLog({ dryRun })
  const listaEspera = await purgarListaEspera({ dryRun })
  const operativa = await purgarOperativa({ dryRun })
  const expediente = await purgarExpedientes({ dryRun })

  logger.info(
    'cron retencion ejecutado',
    JSON.stringify({
      dryRun,
      olvido,
      retencion,
      lecturasFichaMedica,
      auditLog,
      listaEspera,
      operativa,
      expediente,
    })
  )

  return NextResponse.json({
    ok: true,
    dryRun,
    olvido,
    retencion,
    lecturasFichaMedica,
    auditLog,
    listaEspera,
    operativa,
    expediente,
  })
}
