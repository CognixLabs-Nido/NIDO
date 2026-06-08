import { CheckCircle2Icon, ClipboardCheckIcon, PillIcon } from 'lucide-react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

import type { RolNotif } from '../lib/helpers'
import { esStaff } from '../lib/helpers'
import type { AvisosInicio as Avisos } from '../types'

/**
 * Aviso de inicio (puntos 2 + 3): RESUMEN DE ESTADO «X firmadas · Y pendientes».
 * Para staff lo principal (B) es «pendiente de tu confirmación» (banner ámbar) y el
 * resumen son las confirmadas; para familia, pendientes de firmar + firmadas. Debajo,
 * medicaciones activas hoy. No renderiza nada si no hay actividad. Server component.
 */
export async function AvisosInicio({
  avisos,
  rol,
  locale,
}: {
  avisos: Avisos
  rol: RolNotif
  locale: string
}) {
  const t = await getTranslations('notificaciones.avisos')
  const staff = esStaff(rol)

  const pendientesN = staff ? avisos.pendientesConfirmar : avisos.pendientesFirma
  const hechasN = staff ? avisos.confirmadas : avisos.firmadas
  const medsN = avisos.medicacionesActivas
  if (pendientesN <= 0 && hechasN <= 0 && medsN <= 0) return null

  const pendientesHref = staff ? `/${locale}/notifications` : `/${locale}/family/autorizaciones`
  const autorizacionesHref = staff
    ? `/${locale}/admin/autorizaciones`
    : `/${locale}/family/autorizaciones`

  const pendientesLabel = staff
    ? t('pendientes_confirmar', { n: pendientesN })
    : t('pendientes_firma', { n: pendientesN })
  const hechasLabel = staff ? t('confirmadas', { n: hechasN }) : t('firmadas', { n: hechasN })

  return (
    <div className="space-y-2">
      {/* Pendiente = banner ámbar (CTA). Lo principal (B). */}
      {pendientesN > 0 && (
        <Link
          href={pendientesHref}
          className="flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 transition hover:bg-amber-100 dark:border-amber-900/40 dark:bg-amber-950/30 dark:hover:bg-amber-950/50"
        >
          <ClipboardCheckIcon className="size-5 shrink-0 text-amber-700 dark:text-amber-300" />
          <span className="text-sm font-medium text-amber-900 dark:text-amber-100">
            {pendientesLabel}
            {hechasN > 0 && (
              <span className="font-normal text-amber-700 dark:text-amber-300">
                {' · '}
                {hechasLabel}
              </span>
            )}
          </span>
        </Link>
      )}

      {/* Sin pendientes pero con hechas: resumen tranquilo (verde). */}
      {pendientesN <= 0 && hechasN > 0 && (
        <div className="text-success-700 flex items-center gap-2 px-1 text-sm">
          <CheckCircle2Icon className="size-4 shrink-0" />
          <span>{t('todo_hecho', { n: hechasN })}</span>
        </div>
      )}

      {medsN > 0 && (
        <Link
          href={autorizacionesHref}
          className="text-muted-foreground hover:text-foreground flex items-center gap-2 px-1 text-sm transition"
        >
          <PillIcon className="size-4 shrink-0" />
          <span>{t('medicaciones_activas', { n: medsN })}</span>
        </Link>
      )}
    </div>
  )
}
