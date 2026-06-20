'use client'

import { CheckCircle2Icon } from 'lucide-react'
import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

import { registrarConsentimientoTutor } from '../actions/registrar-consentimiento-tutor'

interface Props {
  consintioInicial: boolean
  /** Avisa al shell del wizard para que el paso médico desbloquee el gate. */
  onConsentir: () => void
  onNext: () => void
  onBack: () => void
}

/**
 * Paso 3 — acuse de confidencialidad de datos médicos (F11-F). El tutor confirma que
 * ha leído cómo se tratan los datos médicos (registro append-only en `consentimientos`,
 * tipo `datos_medicos` v2.0, sin firma). Ya NO gatea la escritura médica (voluntaria),
 * pero es OBLIGATORIO para cerrar el alta (backstop en `marcar_matricula_lista`). El
 * consentimiento de `imagen` NO se otorga aquí: se materializa al FIRMAR la
 * autorización de imagen (paso posterior).
 */
export function PasoConsentimientos({ consintioInicial, onConsentir, onNext, onBack }: Props) {
  const t = useTranslations('alta')
  const tErrors = useTranslations()
  const [consintio, setConsintio] = useState(consintioInicial)
  const [pending, startTransition] = useTransition()

  function otorgar() {
    startTransition(async () => {
      const r = await registrarConsentimientoTutor({ tipo: 'datos_medicos' })
      if (r.success) {
        setConsintio(true)
        onConsentir()
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
