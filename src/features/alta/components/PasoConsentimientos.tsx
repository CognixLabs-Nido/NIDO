'use client'

import { CheckCircle2Icon } from 'lucide-react'
import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

import { registrarConsentimientoTutor } from '../actions/registrar-consentimiento-tutor'

interface Props {
  consintioInicial: boolean
  onNext: () => void
  onBack: () => void
}

/**
 * Paso 3 — consentimientos. El tutor otorga el consentimiento de `datos_medicos`
 * (acto afirmativo), prerrequisito de la ficha médica y la cartilla (la RPC médica y
 * la RLS del bucket cartilla lo exigen). El consentimiento de `imagen` NO se otorga
 * aquí: se materializa al FIRMAR la autorización de imagen (paso posterior). Es
 * opcional: si el tutor no lo otorga, simplemente no podrá completar el paso médico.
 */
export function PasoConsentimientos({ consintioInicial, onNext, onBack }: Props) {
  const t = useTranslations('alta')
  const tErrors = useTranslations()
  const [consintio, setConsintio] = useState(consintioInicial)
  const [pending, startTransition] = useTransition()

  function otorgar() {
    startTransition(async () => {
      const r = await registrarConsentimientoTutor({ tipo: 'datos_medicos' })
      if (r.success) {
        setConsintio(true)
        toast.success(t('consentimientos.otorgado'))
      } else {
        toast.error(tErrors(r.error))
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2 rounded-lg border p-4">
        <h3 className="text-sm font-semibold">{t('consentimientos.datos_medicos_titulo')}</h3>
        <p className="text-muted-foreground text-sm">{t('consentimientos.datos_medicos_texto')}</p>
        {consintio ? (
          <p className="text-success-700 flex items-center gap-2 text-sm font-medium">
            <CheckCircle2Icon className="size-4" strokeWidth={2} aria-hidden />
            {t('consentimientos.concedido')}
          </p>
        ) : (
          <Button type="button" onClick={otorgar} disabled={pending}>
            {pending ? t('wizard.guardando') : t('consentimientos.otorgar')}
          </Button>
        )}
      </div>

      <p className="text-muted-foreground text-xs">{t('consentimientos.imagen_nota')}</p>

      <div className="flex justify-between border-t pt-4">
        <Button type="button" variant="outline" onClick={onBack}>
          {t('wizard.atras')}
        </Button>
        <Button type="button" onClick={onNext}>
          {t('wizard.siguiente')}
        </Button>
      </div>
    </div>
  )
}
