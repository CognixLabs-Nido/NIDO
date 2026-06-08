import { ClipboardCheckIcon, PillIcon } from 'lucide-react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

import type { RolNotif } from '../lib/helpers'
import { esStaff } from '../lib/helpers'
import type { AvisosInicio as Avisos } from '../types'

/**
 * Aviso destacado en el inicio (punto 2). Para staff, lo PRINCIPAL (B) es
 * «pendiente de tu confirmación» (banner ámbar); para familia, «pendientes de
 * firmar». Debajo, medicaciones activas hoy como recordatorio. No renderiza nada
 * si no hay nada pendiente. Server component.
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

  const principalN = staff ? avisos.pendientesConfirmar : avisos.pendientesFirma
  const medsN = avisos.medicacionesActivas
  if (principalN <= 0 && medsN <= 0) return null

  const confirmarHref = `/${locale}/notifications`
  const autorizacionesHref = staff
    ? `/${locale}/admin/autorizaciones`
    : `/${locale}/family/autorizaciones`
  const principalHref = staff ? confirmarHref : autorizacionesHref

  return (
    <div className="space-y-2">
      {principalN > 0 && (
        <Link
          href={principalHref}
          className="flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 transition hover:bg-amber-100 dark:border-amber-900/40 dark:bg-amber-950/30 dark:hover:bg-amber-950/50"
        >
          <ClipboardCheckIcon className="size-5 shrink-0 text-amber-700 dark:text-amber-300" />
          <span className="text-sm font-medium text-amber-900 dark:text-amber-100">
            {staff
              ? t('pendientes_confirmar', { n: principalN })
              : t('pendientes_firma', { n: principalN })}
          </span>
        </Link>
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
