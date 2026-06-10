import {
  AlertTriangleIcon,
  ArchiveIcon,
  CheckCircle2Icon,
  ClipboardCheckIcon,
  ClipboardListIcon,
  PenLineIcon,
  PillIcon,
} from 'lucide-react'
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
  const esAdmin = rol === 'admin'

  const pendientesN = staff ? avisos.pendientesConfirmar : avisos.pendientesFirma
  const hechasN = staff ? avisos.confirmadas : avisos.firmadas
  const medsN = avisos.medicacionesActivas
  const nuevasFirmasN = staff ? avisos.nuevasFirmas : 0
  const revocacionesN = staff ? avisos.revocaciones : 0
  const archivarN = staff ? avisos.medicacionesPorArchivar : 0
  // Informes nuevos publicados: solo familia (F9-3).
  const informesNuevosN = staff ? 0 : avisos.informesNuevos
  // Informes pendientes de campaña: solo profe redactora (F9-5-2).
  const campanaPend = staff ? avisos.campanaPendientes : null
  if (
    pendientesN <= 0 &&
    hechasN <= 0 &&
    medsN <= 0 &&
    nuevasFirmasN <= 0 &&
    revocacionesN <= 0 &&
    archivarN <= 0 &&
    informesNuevosN <= 0 &&
    !campanaPend
  )
    return null

  // La profe gestiona sus autorizaciones en /teacher; el admin en /admin; la familia
  // en /family. (Ya no hay pestaña /notifications: todo va a la de autorizaciones.)
  const autorizacionesHref = !staff
    ? `/${locale}/family/autorizaciones`
    : esAdmin
      ? `/${locale}/admin/autorizaciones`
      : `/${locale}/teacher/autorizaciones`
  const pendientesHref = autorizacionesHref
  const informesHref = `/${locale}/family/informes`
  const campanaInformesHref = `/${locale}/teacher/informes`

  // Fecha límite (más próxima) formateada en el huso del centro para el aviso de campaña.
  const campanaFechaFmt = campanaPend
    ? new Intl.DateTimeFormat(locale, {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(new Date(`${campanaPend.fechaLimite}T12:00:00Z`))
    : ''
  const campanaLabel = campanaPend
    ? campanaPend.vencida
      ? t('campana_vencida', { n: campanaPend.n, fecha: campanaFechaFmt })
      : campanaPend.urgente
        ? t('campana_urgente', { n: campanaPend.n, fecha: campanaFechaFmt })
        : t('campana_pendientes', { n: campanaPend.n, fecha: campanaFechaFmt })
    : ''

  const pendientesLabel = staff
    ? t('pendientes_confirmar', { n: pendientesN })
    : t('pendientes_firma', { n: pendientesN })
  const hechasLabel = staff ? t('confirmadas', { n: hechasN }) : t('firmadas', { n: hechasN })

  return (
    <div className="space-y-2">
      {/* Revocación = alerta de seguridad (rojo). Lo más prioritario, arriba del todo. */}
      {revocacionesN > 0 && (
        <Link
          href={autorizacionesHref}
          className="flex items-center gap-3 rounded-xl border border-red-300 bg-red-50 p-4 transition hover:bg-red-100 dark:border-red-900/40 dark:bg-red-950/30 dark:hover:bg-red-950/50"
        >
          <AlertTriangleIcon className="size-5 shrink-0 text-red-700 dark:text-red-300" />
          <span className="text-sm font-medium text-red-900 dark:text-red-100">
            {t('revocaciones', { n: revocacionesN })}
          </span>
        </Link>
      )}

      {/* Informes pendientes de campaña (F9-5-2, solo profe redactora). Rojo si
          urgente/vencida (≤3 días o pasada), ámbar si aún hay margen. El texto dice
          siempre "vence el…/venció el…": el color no es el único indicador (AA). */}
      {campanaPend && (
        <Link
          href={campanaInformesHref}
          className={
            campanaPend.urgente
              ? 'flex items-center gap-3 rounded-xl border border-red-300 bg-red-50 p-4 transition hover:bg-red-100 dark:border-red-900/40 dark:bg-red-950/30 dark:hover:bg-red-950/50'
              : 'flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 transition hover:bg-amber-100 dark:border-amber-900/40 dark:bg-amber-950/30 dark:hover:bg-amber-950/50'
          }
        >
          {campanaPend.urgente ? (
            <AlertTriangleIcon className="size-5 shrink-0 text-red-700 dark:text-red-300" />
          ) : (
            <ClipboardListIcon className="size-5 shrink-0 text-amber-700 dark:text-amber-300" />
          )}
          <span
            className={
              campanaPend.urgente
                ? 'text-sm font-medium text-red-900 dark:text-red-100'
                : 'text-sm font-medium text-amber-900 dark:text-amber-100'
            }
          >
            {campanaLabel}
          </span>
        </Link>
      )}

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

      {/* Informe(s) de evolución recién publicado(s) que la familia no ha abierto
          (F9-3). Verde (success), coherente con el sombreado de publicados. */}
      {informesNuevosN > 0 && (
        <Link
          href={informesHref}
          className="border-success-200 bg-success-50 hover:bg-success-100 flex items-center gap-3 rounded-xl border p-4 transition"
        >
          <ClipboardListIcon className="text-success-700 size-5 shrink-0" />
          <span className="text-success-900 text-sm font-medium">
            {t('informes_nuevos', { n: informesNuevosN })}
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

      {/* "Ha llegado una firma nueva" de una familia (recogida/medicación). Aviso
          informativo (azul), distinto del CTA ámbar de "pendiente de confirmar". */}
      {nuevasFirmasN > 0 && (
        <Link
          href={autorizacionesHref}
          className="flex items-center gap-3 rounded-xl border border-sky-300 bg-sky-50 p-4 transition hover:bg-sky-100 dark:border-sky-900/40 dark:bg-sky-950/30 dark:hover:bg-sky-950/50"
        >
          <PenLineIcon className="size-5 shrink-0 text-sky-700 dark:text-sky-300" />
          <span className="text-sm font-medium text-sky-900 dark:text-sky-100">
            {t('nuevas_firmas', { n: nuevasFirmasN })}
          </span>
        </Link>
      )}

      {/* Medicaciones terminadas pendientes de archivar (solo staff). Acción ligera. */}
      {archivarN > 0 && (
        <Link
          href={autorizacionesHref}
          className="flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 transition hover:bg-amber-100 dark:border-amber-900/40 dark:bg-amber-950/30 dark:hover:bg-amber-950/50"
        >
          <ArchiveIcon className="size-5 shrink-0 text-amber-700 dark:text-amber-300" />
          <span className="text-sm font-medium text-amber-900 dark:text-amber-100">
            {t('por_archivar', { n: archivarN })}
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
