'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DatosPedagogicosForm } from '@/features/datos-pedagogicos/components/DatosPedagogicosForm'

import { PASOS_ALTA, type PasoAlta } from '../lib/estado-alta'
import { PasoConsentimientos } from './PasoConsentimientos'
import { PasoIdentidad, type IdentidadInicial } from './PasoIdentidad'
import { PasoPlaceholder } from './PasoPlaceholder'

import type { DatosPedagogicosInput } from '@/features/datos-pedagogicos/schemas/datos-pedagogicos'

interface Props {
  locale: string
  ninoId: string
  /** Índice (0-based sobre PASOS_ALTA) en el que reanudar (lo deriva la ruta). */
  pasoInicial: number
  identidadInicial: IdentidadInicial
  datosPedagogicosInicial: DatosPedagogicosInput | null
  consintioDatosMedicos: boolean
}

/**
 * Pieza 3b-2 — wizard de alta del tutor. Stepper de 5 pasos; a diferencia del wizard
 * de admin (`NuevoNinoWizard`, un único submit), **cada paso persiste por su cuenta**
 * (guardable/reanudable). En 3b-2a los pasos médico e imagen son placeholders; 3b-2b
 * los sustituye por la ficha médica + cartilla y la firma de imagen + foto.
 */
export function AltaTutorWizard({
  locale,
  ninoId,
  pasoInicial,
  identidadInicial,
  datosPedagogicosInicial,
  consintioDatosMedicos,
}: Props) {
  const t = useTranslations('alta')
  const total = PASOS_ALTA.length
  const [step, setStep] = useState<number>(Math.min(Math.max(pasoInicial, 0), total - 1))

  const paso: PasoAlta = PASOS_ALTA[step]
  const goNext = () => setStep((s) => Math.min(s + 1, total - 1))
  const goBack = () => setStep((s) => Math.max(s - 1, 0))

  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <CardTitle>{t(`wizard.paso.${paso}`)}</CardTitle>
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {t('wizard.step')} {step + 1}/{total}
        </p>
        <div
          className="mt-2 flex gap-1.5"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={total}
          aria-valuenow={step + 1}
          aria-label={t('wizard.progress')}
        >
          {PASOS_ALTA.map((p, i) => (
            <span
              key={p}
              className={
                i <= step
                  ? 'bg-primary h-1.5 flex-1 rounded-full transition-colors'
                  : 'bg-primary-100 h-1.5 flex-1 rounded-full transition-colors'
              }
            />
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {paso === 'identidad' && (
          <PasoIdentidad ninoId={ninoId} inicial={identidadInicial} onNext={goNext} />
        )}

        {paso === 'pedagogicos' && (
          <div className="space-y-4">
            <DatosPedagogicosForm
              ninoId={ninoId}
              locale={locale}
              initial={datosPedagogicosInicial}
            />
            <div className="flex justify-between border-t pt-4">
              <Button type="button" variant="outline" onClick={goBack}>
                {t('wizard.atras')}
              </Button>
              <Button type="button" onClick={goNext}>
                {t('wizard.siguiente')}
              </Button>
            </div>
          </div>
        )}

        {paso === 'consentimientos' && (
          <PasoConsentimientos
            consintioInicial={consintioDatosMedicos}
            onNext={goNext}
            onBack={goBack}
          />
        )}

        {paso === 'medico' && (
          <PasoPlaceholder texto={t('placeholder.medico')} onNext={goNext} onBack={goBack} />
        )}

        {paso === 'imagen' && <PasoPlaceholder texto={t('placeholder.imagen')} onBack={goBack} />}
      </CardContent>
    </Card>
  )
}
