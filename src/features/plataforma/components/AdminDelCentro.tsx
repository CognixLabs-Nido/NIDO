'use client'

import { useTranslations } from 'next-intl'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import { invitarAdmin } from '../actions/invitar-admin'

interface Props {
  centroId: string
  invitacion: 'pendiente' | 'caducada' | null
}

/**
 * La admin de un centro que no la tiene (Fase 5, PR 2): reenviar la invitación pendiente o
 * caducada, o invitar a otra persona (caduca la anterior). Solo sale con el centro sin admin viva:
 * con una, la BD no deja invitar otra.
 */
export function AdminDelCentro({ centroId, invitacion }: Props) {
  const t = useTranslations('plataforma.admin')
  const tRoot = useTranslations()
  const [pending, startTransition] = useTransition()
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [hecho, setHecho] = useState<'reenviada' | 'enviada' | null>(null)

  function enviar(conEmail: boolean) {
    setError(null)
    setHecho(null)
    startTransition(async () => {
      const r = await invitarAdmin(conEmail ? { centroId, email } : { centroId })
      if (!r.success) {
        setError(r.error)
        return
      }
      setHecho(conEmail ? 'enviada' : 'reenviada')
      if (conEmail) setEmail('')
    })
  }

  return (
    <div className="space-y-2 rounded-md border p-3">
      {invitacion && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => enviar(false)}
        >
          {t('reenviar')}
        </Button>
      )}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          enviar(true)
        }}
      >
        <label className="flex min-w-60 flex-1 flex-col gap-1 text-sm">
          {invitacion ? t('email_otra') : t('email')}
          <Input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="off"
          />
        </label>
        <Button type="submit" size="sm" disabled={pending}>
          {t('invitar')}
        </Button>
      </form>
      {hecho && (
        <p role="status" className="text-sm">
          {t(hecho)}
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {tRoot(error)}
        </p>
      )}
    </div>
  )
}
