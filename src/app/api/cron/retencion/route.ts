import { NextResponse } from 'next/server'

import { logger } from '@/shared/lib/logger'

import { purgarVencidos } from '@/features/olvido/actions/purgar-vencidos'
import { barrerRetencion } from '@/features/retencion/actions/barrer-retencion'
import { purgarAuditLog } from '@/features/retencion/lib/audit-log'
import { borrarCuentasOlvidadas, purgarCuentas } from '@/features/retencion/lib/cuentas'
import { purgarExpedientes } from '@/features/retencion/lib/expediente'
import { destruirFirmas } from '@/features/retencion/lib/firmas'
import { destruirFiscal } from '@/features/retencion/lib/fiscal'
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
 *   8. `destruirFirmas()` — lo que se conserva por obligación de los niños ya purgados (firmas,
 *      acuses, consentimientos, medicación, autorizaciones, eventos de ámbito niño), al vencer su
 *      plazo provisional desde la baja, sin copia en audit_log (20261207120000). Después del 7:
 *      solo destruye con el niño purgado.
 *   9. `purgarCuentas()` — la cuenta de los tutores y autorizados a los años de la baja de su
 *      último hijo en el centro: la purga del olvido, por una petición «por plazo», sin correo
 *      (20261207120000).
 *  10. `destruirFiscal()` — lo fiscal de las familias a los años de su último recibo pagado (o del
 *      final del curso de la baja, si no pagaron ninguno): recibos, remesas, mandatos y su
 *      documento, becas, tutores, la familia y las fichas anónimas de sus niños, sin copia en
 *      audit_log (20261208120000). Después del 9: espera a que sus tutores estén purgados.
 *  11. `borrarCuentasOlvidadas()` — la cuenta de quien ya no tiene nada en ningún centro, en la BD
 *      y en Auth (20261208120000). Después del 10: espera a que lo fiscal se lleve su perfil.
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
  const firmas = await destruirFirmas({ dryRun })
  const cuentas = await purgarCuentas({ dryRun })
  const fiscal = await destruirFiscal({ dryRun })
  const cuentasOlvidadas = await borrarCuentasOlvidadas({ dryRun })

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
      firmas,
      cuentas,
      fiscal,
      cuentasOlvidadas,
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
    firmas,
    cuentas,
    fiscal,
    cuentasOlvidadas,
  })
}
