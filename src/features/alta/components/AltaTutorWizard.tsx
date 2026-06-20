'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DatosPedagogicosForm } from '@/features/datos-pedagogicos/components/DatosPedagogicosForm'

import { PASOS_ALTA, type PasoAlta } from '../lib/estado-alta'
import { PasoConsentimientos } from './PasoConsentimientos'
import { PasoIdentidad, type IdentidadInicial } from './PasoIdentidad'
import { PasoImagen } from './PasoImagen'
import { PasoMedico } from './PasoMedico'

import type { DatosPedagogicosInput } from '@/features/datos-pedagogicos/schemas/datos-pedagogicos'
import type { ImagenPanelData, MedicaInicial } from '../lib/tipos'

interface Props {
  locale: string
  ninoId: string
  ninoNombre: string
  /** Índice (0-based sobre PASOS_ALTA) en el que reanudar (lo deriva la ruta). */
  pasoInicial: number
  identidadInicial: IdentidadInicial
  datosPedagogicosInicial: DatosPedagogicosInput | null
  consintioDatosMedicos: boolean
  medicaInicial: MedicaInicial | null
  fotoInicialUrl: string | null
  imagenPanel: ImagenPanelData | null
  imagenSinPlantilla: boolean
  currentUserId: string
  currentUserNombre: string
}

/**
 * Pieza 3b-2 — wizard de alta del tutor. Stepper de 5 pasos; a diferencia del wizard
 * de admin (`NuevoNinoWizard`, un único submit), **cada paso persiste por su cuenta**
 * (guardable/reanudable). Pasos pesados (médico + imagen/foto). Al "Finalizar"
 * (P3c), `PasoImagen` llama a `finalizarAlta` (matrícula → 'lista') y navega; la ruta
 * sirve entonces la pantalla "completado, pendiente de validación". La activación
 * (`'lista' → 'activa'`) la hace la dirección.
 */
export function AltaTutorWizard({
  locale,
  ninoId,
  ninoNombre,
  pasoInicial,
  identidadInicial,
  datosPedagogicosInicial,
  consintioDatosMedicos,
  medicaInicial,
  fotoInicialUrl,
  imagenPanel,
  imagenSinPlantilla,
  currentUserId,
  currentUserNombre,
}: Props) {
  const t = useTranslations('alta')
  const total = PASOS_ALTA.length
  const [step, setStep] = useState<number>(Math.min(Math.max(pasoInicial, 0), total - 1))
  // El acuse de datos médicos se liftea al shell para reflejar el check al volver al paso.
  const [consintio, setConsintio] = useState(consintioDatosMedicos)

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
          <PasoIdentidad
            ninoId={ninoId}
            ninoNombre={ninoNombre}
            inicial={identidadInicial}
            onNext={goNext}
          />
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
            consintioInicial={consintio}
            onConsentir={() => setConsintio(true)}
            onNext={goNext}
            onBack={goBack}
          />
        )}

        {paso === 'medico' && (
          <PasoMedico ninoId={ninoId} inicial={medicaInicial} onNext={goNext} onBack={goBack} />
        )}

        {paso === 'imagen' && (
          <PasoImagen
            ninoId={ninoId}
            locale={locale}
            ninoNombre={ninoNombre}
            panel={imagenPanel}
            sinPlantilla={imagenSinPlantilla}
            fotoInicialUrl={fotoInicialUrl}
            currentUserId={currentUserId}
            currentUserNombre={currentUserNombre}
            onBack={goBack}
          />
        )}
      </CardContent>
    </Card>
  )
}
