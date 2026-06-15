'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  acceptPendingInvitation,
  rejectPendingInvitation,
} from '@/features/auth/actions/accept-invitation'

const PARENTESCO_OPCIONES = [
  'madre',
  'padre',
  'abuela',
  'abuelo',
  'tia',
  'tio',
  'hermana',
  'hermano',
  'cuidadora',
  'otro',
] as const

const ROLES_FAMILIA = ['tutor_legal', 'autorizado']

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
  const tVinculo = useTranslations('vinculo')
  const router = useRouter()
  const [invitations, setInvitations] = useState(initial)
  const [pending, startTransition] = useTransition()
  const [parentesco, setParentesco] = useState<Record<string, string>>({})
  const [descripcion, setDescripcion] = useState<Record<string, string>>({})

  function accept(inv: PendingInvitation) {
    const esFamilia = ROLES_FAMILIA.includes(inv.rol_objetivo)
    const p = parentesco[inv.id]
    if (esFamilia && !p) {
      toast.error(tVinculo('validation.parentesco_requerido'))
      return
    }
    if (esFamilia && p === 'otro' && !descripcion[inv.id]) {
      toast.error(tVinculo('validation.descripcion_requerida'))
      return
    }
    startTransition(async () => {
      const result = await acceptPendingInvitation(
        inv.id,
        esFamilia
          ? { parentesco: p, descripcionParentesco: descripcion[inv.id] ?? null }
          : undefined
      )
      if (!result.success) {
        toast.error(result.error)
        return
      }
      setInvitations((prev) => prev.filter((i) => i.id !== inv.id))
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
      {invitations.map((inv) => {
        const esFamilia = ROLES_FAMILIA.includes(inv.rol_objetivo)
        return (
          <Card key={inv.id}>
            <CardHeader>
              <CardTitle className="text-base">
                {tRoles(inv.rol_objetivo as 'admin' | 'profe' | 'tutor_legal' | 'autorizado')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {esFamilia && (
                <div className="space-y-2">
                  <Label>{tVinculo('fields.parentesco')}</Label>
                  <Select
                    value={parentesco[inv.id] ?? undefined}
                    onValueChange={(v) =>
                      setParentesco((prev) => ({ ...prev, [inv.id]: v as string }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={tVinculo('fields.parentesco_placeholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {PARENTESCO_OPCIONES.map((p) => (
                        <SelectItem key={p} value={p}>
                          {tVinculo(`parentesco.${p}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {parentesco[inv.id] === 'otro' && (
                    <Input
                      placeholder={tVinculo('fields.descripcion_parentesco')}
                      value={descripcion[inv.id] ?? ''}
                      onChange={(e) =>
                        setDescripcion((prev) => ({ ...prev, [inv.id]: e.target.value }))
                      }
                    />
                  )}
                </div>
              )}
              <div className="flex gap-2">
                <Button onClick={() => accept(inv)} disabled={pending}>
                  {t('accept')}
                </Button>
                <Button onClick={() => reject(inv.id)} disabled={pending} variant="outline">
                  {t('reject')}
                </Button>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
