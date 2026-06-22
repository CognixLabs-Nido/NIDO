'use client'

import { useFormatter, useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  reenviarInvitacionProfe,
  revocarInvitacionProfe,
} from '@/features/auth/actions/invitar-profe'
import type { InvitacionProfePendiente } from '@/features/auth/queries/get-invitaciones-profe'

interface Props {
  locale: string
  invitaciones: InvitacionProfePendiente[]
}

/**
 * F11-C-1 — lista de invitaciones de profe PENDIENTES con reenviar/revocar. El
 * reenvío refresca expiración y reenvía el email; la revocación cancela la
 * invitación (acción del admin, distinta del rechazo del invitado).
 */
export function InvitacionesProfeList({ locale, invitaciones: initial }: Props) {
  const t = useTranslations('admin.personal.pendientes')
  const tTipos = useTranslations('admin.personal.tipo_personal')
  const tErrors = useTranslations()
  const format = useFormatter()
  const router = useRouter()
  const [invitaciones, setInvitaciones] = useState(initial)
  const [pending, startTransition] = useTransition()

  function reenviar(id: string) {
    startTransition(async () => {
      const r = await reenviarInvitacionProfe(id, locale)
      if (!r.success) {
        toast.error(tErrors(r.error))
        return
      }
      toast.success(t('reenviada'))
      router.refresh()
    })
  }

  function revocar(id: string) {
    startTransition(async () => {
      const r = await revocarInvitacionProfe(id)
      if (!r.success) {
        toast.error(tErrors(r.error))
        return
      }
      setInvitaciones((prev) => prev.filter((i) => i.id !== id))
      toast.info(t('revocada'))
      router.refresh()
    })
  }

  if (invitaciones.length === 0) {
    return <p className="text-muted-foreground text-sm">{t('empty')}</p>
  }

  return (
    <div className="space-y-3">
      {invitaciones.map((inv) => {
        const caducada = inv.caducada
        return (
          <Card key={inv.id}>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
              <div className="min-w-0 space-y-0.5">
                <p className="text-foreground truncate font-medium">
                  {inv.nombre_completo ?? inv.email}
                </p>
                <p className="text-muted-foreground truncate text-sm">{inv.email}</p>
                <p className="text-muted-foreground text-sm">
                  {inv.aula_nombre ?? '—'}
                  {inv.tipo_personal_aula ? ` · ${tTipos(inv.tipo_personal_aula)}` : ''}
                </p>
                <p
                  className={
                    caducada ? 'text-destructive text-sm' : 'text-muted-foreground text-sm'
                  }
                >
                  {caducada
                    ? t('caducada')
                    : t('expira', {
                        fecha: format.dateTime(new Date(inv.expires_at), { dateStyle: 'medium' }),
                      })}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => reenviar(inv.id)} disabled={pending}>
                  {t('reenviar')}
                </Button>
                <Button variant="outline" onClick={() => revocar(inv.id)} disabled={pending}>
                  {t('revocar')}
                </Button>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
