'use client'

import { useTransition } from 'react'

import { CheckCircle2Icon, ClockIcon } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

import { confirmarAdministracion } from '../actions/confirmar-administracion'
import type { AdministracionItem } from '../types'

interface Props {
  administraciones: AdministracionItem[]
  /** Para decidir si el usuario actual puede confirmar (≠ quien administró). */
  currentUserId?: string | null
  /** El contexto es de staff (admin/profe): habilita el botón «Confirmar». */
  canConfirm?: boolean
}

/**
 * Registro de administraciones de una medicación (F8-3b). Lo ven el staff del aula
 * + dirección y la familia del niño (transparencia). En contexto staff, una fila
 * PENDIENTE muestra «Confirmar» para un 2.º staff distinto del que la administró.
 */
export function RegistroAdministracionLista({
  administraciones,
  currentUserId,
  canConfirm = false,
}: Props) {
  const t = useTranslations('autorizaciones')
  const locale = useLocale()

  const fmt = new Intl.DateTimeFormat(locale, {
    timeZone: 'Europe/Madrid',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <div className="space-y-3">
      <h2 className="text-h3">{t('administracion.titulo')}</h2>
      {administraciones.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('administracion.vacio')}</p>
      ) : (
        <ul className="space-y-2">
          {administraciones.map((a) => (
            <FilaAdministracion
              key={a.id}
              a={a}
              fecha={fmt}
              canConfirm={canConfirm}
              currentUserId={currentUserId ?? null}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function FilaAdministracion({
  a,
  fecha,
  canConfirm,
  currentUserId,
}: {
  a: AdministracionItem
  fecha: Intl.DateTimeFormat
  canConfirm: boolean
  currentUserId: string | null
}) {
  const t = useTranslations('autorizaciones')
  const tRoot = useTranslations()
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const confirmada = a.confirmado_por !== null
  const administrador = a.administrado_por_nombre || t('administracion.staff_generico')
  const confirmador = a.confirmado_por_nombre || t('administracion.staff_generico')
  const esElQueAdministro = currentUserId !== null && a.administrado_por === currentUserId

  function confirmar() {
    startTransition(async () => {
      const res = await confirmarAdministracion({ administracion_id: a.id })
      if (!res.success) {
        toast.error(tRoot(res.error))
        return
      }
      toast.success(t('administracion.confirmada_toast'))
      router.refresh()
    })
  }

  return (
    <li className="rounded-lg border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">
          {a.medicamento} · {a.dosis}
        </span>
        {confirmada ? (
          <Badge variant="outline" className="text-success-700 border-success-200">
            <CheckCircle2Icon className="mr-1 size-3.5" />
            {t('administracion.confirmada_por', {
              nombre: confirmador,
              fecha: a.confirmado_at ? fecha.format(new Date(a.confirmado_at)) : '',
            })}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-amber-700">
            <ClockIcon className="mr-1 size-3.5" />
            {t('administracion.pendiente')}
          </Badge>
        )}
      </div>
      <p className="text-muted-foreground mt-1 text-xs">
        {t('administracion.administrada_por', {
          nombre: administrador,
          fecha: fecha.format(new Date(a.administrado_en)),
        })}
      </p>
      {a.notas && <p className="mt-1 text-sm">{a.notas}</p>}

      {!confirmada && canConfirm && (
        <div className="mt-2">
          {esElQueAdministro ? (
            <p className="text-muted-foreground text-xs">{t('administracion.espera_segundo')}</p>
          ) : (
            <Button size="sm" variant="outline" onClick={confirmar} disabled={pending}>
              <CheckCircle2Icon className="mr-1 size-4" />
              {pending ? t('administracion.confirmando') : t('administracion.confirmar')}
            </Button>
          )}
        </div>
      )}
    </li>
  )
}
