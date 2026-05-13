'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  acceptPendingInvitation,
  rejectPendingInvitation,
} from '@/features/auth/actions/accept-invitation'

interface PendingInvitation {
  id: string
  rol_objetivo: string
  centro_id: string
  expires_at: string
}

interface Props {
  invitations: PendingInvitation[]
}

export function PendingInvitationsList({ invitations: initial }: Props) {
  const t = useTranslations('auth.invitation.pending')
  const tRoles = useTranslations('auth.select_role.roles')
  const router = useRouter()
  const [invitations, setInvitations] = useState(initial)
  const [pending, startTransition] = useTransition()

  function accept(id: string) {
    startTransition(async () => {
      const result = await acceptPendingInvitation(id)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setInvitations((prev) => prev.filter((i) => i.id !== id))
      toast.success(t('accepted_toast'))
      router.refresh()
    })
  }

  function reject(id: string) {
    startTransition(async () => {
      const result = await rejectPendingInvitation(id)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setInvitations((prev) => prev.filter((i) => i.id !== id))
      toast.info(t('rejected_toast'))
      router.refresh()
    })
  }

  if (invitations.length === 0) {
    return <p className="text-muted-foreground">{t('empty')}</p>
  }

  return (
    <div className="space-y-4">
      {invitations.map((inv) => (
        <Card key={inv.id}>
          <CardHeader>
            <CardTitle className="text-base">
              {tRoles(inv.rol_objetivo as 'admin' | 'profe' | 'tutor_legal' | 'autorizado')}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Button onClick={() => accept(inv.id)} disabled={pending}>
              {t('accept')}
            </Button>
            <Button onClick={() => reject(inv.id)} disabled={pending} variant="outline">
              {t('reject')}
            </Button>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
