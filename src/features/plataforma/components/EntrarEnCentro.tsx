'use client'

import { useTranslations } from 'next-intl'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { elegirCentro } from '@/features/centros/actions/elegir-centro'

interface Props {
  locale: string
  centroId: string
}

/**
 * «Entrar» en un centro desde el panel de plataforma. Es `elegirCentro`, la misma acción del
 * selector: registra la entrada del superusuario en `audit_log` antes de escribir la cookie, y si
 * no se puede registrar, no entra.
 */
export function EntrarEnCentro({ locale, centroId }: Props) {
  const t = useTranslations('plataforma')
  const tRoot = useTranslations()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function entrar() {
    setError(null)
    startTransition(async () => {
      const r = await elegirCentro({ centroId, locale, returnTo: `/${locale}/admin` })
      if (r && !r.success) setError(r.error)
    })
  }

  return (
    <div className="space-y-1">
      <Button type="button" size="sm" disabled={pending} onClick={entrar}>
        {t('entrar')}
      </Button>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {tRoot(error)}
        </p>
      )}
    </div>
  )
}
