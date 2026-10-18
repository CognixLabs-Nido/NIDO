'use client'

import { useTranslations } from 'next-intl'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'

import { elegirCentro } from '../actions/elegir-centro'

export interface OpcionCentro {
  centroId: string
  nombre: string
}

interface Props {
  locale: string
  centros: ReadonlyArray<OpcionCentro>
  returnTo?: string | null
  /** Centro ya activo (en el conmutador), que se marca y no se puede volver a elegir. */
  actual?: string
  variante?: 'pagina' | 'compacta'
}

/**
 * Lista de centros para elegir (multicentro · Fase 1). Solo se monta cuando el usuario tiene
 * más de un centro. Elegir llama a la acción `elegirCentro`, que valida el centro, escribe la
 * cookie y redirige.
 */
export function SelectorCentro({ locale, centros, returnTo, actual, variante = 'pagina' }: Props) {
  const tRoot = useTranslations()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function elegir(centroId: string) {
    setError(null)
    startTransition(async () => {
      const r = await elegirCentro({ centroId, locale, returnTo })
      if (r && !r.success) setError(r.error)
    })
  }

  return (
    <div className="space-y-2">
      {centros.map((c) => (
        <Button
          key={c.centroId}
          type="button"
          variant={c.centroId === actual ? 'secondary' : 'outline'}
          size={variante === 'compacta' ? 'sm' : 'default'}
          disabled={pending || c.centroId === actual}
          aria-current={c.centroId === actual ? 'true' : undefined}
          className="w-full justify-start"
          onClick={() => elegir(c.centroId)}
        >
          {c.nombre}
        </Button>
      ))}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {tRoot(error)}
        </p>
      )}
    </div>
  )
}
