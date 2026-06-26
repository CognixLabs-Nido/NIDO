'use client'

import { useState, useTransition } from 'react'

import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

import { finalizarAlta } from '../actions/finalizar-alta'
import { PASOS_ALTA, PASO_MIN_AUTENTICADO, type PasoAlta } from '../lib/estado-alta'
import { PasoAcuses } from './PasoAcuses'
import { PasoCuenta } from './PasoCuenta'
import { PasoMedico } from './PasoMedico'
import { PasoMenor, type DireccionInicial } from './PasoMenor'
import { PasoTutor, type DatosTutorInicial } from './PasoTutor'
import type { IdentidadInicial } from './PasoIdentidad'

import type { DatosPedagogicosInput } from '@/features/datos-pedagogicos/schemas/datos-pedagogicos'
import type { EstadoCivil } from '../schemas/alta-documentos'
import type { FirmaPanelData, ImagenPanelData, MedicaInicial } from '../lib/tipos'

/** Datos de la invitación para el paso `cuenta` (solo en `/invitation/[token]`). */
export interface ModoInvitacion {
  token: string
  email: string
  nombreInicial: string
  requiereParentesco: boolean
}

interface Props {
  locale: string
  ninoId: string
  ninoNombre: string
  /** Índice (0-based sobre PASOS_ALTA) en el que reanudar (lo deriva la ruta). */
  pasoInicial: number
  /** Presente solo en `/invitation/[token]`: el wizard muestra el paso `cuenta`. */
  modoInvitacion?: ModoInvitacion
  identidadInicial: IdentidadInicial
  direccionInicial: DireccionInicial
  datosPedagogicosInicial: DatosPedagogicosInput | null
  libroFamiliaUrl: string | null
  consintioDatosMedicos: boolean
  medicaInicial: MedicaInicial | null
  fotoInicialUrl: string | null
  imagenPanel: ImagenPanelData | null
  imagenSinPlantilla: boolean
  normasPanel: FirmaPanelData | null
  normasSinPlantilla: boolean
  familiaEstadoCivil: EstadoCivil | null
  datosTutor1: DatosTutorInicial | null
  datosTutor2: DatosTutorInicial | null
  currentUserId: string
  currentUserNombre: string
}

/**
 * Wizard de alta del tutor (F11-G) — 7 pasos guardables/reanudables, DOS entradas al
 * MISMO componente: `/invitation/[token]` (paso `cuenta`, pre-login) y `/alta/[ninoId]`
 * (pasos 2-7, post-login; reanudación). En `/alta` el paso `cuenta` es inalcanzable
 * (`PASO_MIN_AUTENTICADO`). El último paso (`emergencia`) finaliza el alta
 * (`finalizarAlta`, matrícula → 'lista') y la ruta sirve la pantalla "pendiente de
 * validación".
 */
export function AltaTutorWizard({
  locale,
  ninoId,
  ninoNombre,
  pasoInicial,
  modoInvitacion,
  identidadInicial,
  direccionInicial,
  datosPedagogicosInicial,
  libroFamiliaUrl,
  consintioDatosMedicos,
  medicaInicial,
  fotoInicialUrl,
  imagenPanel,
  imagenSinPlantilla,
  normasPanel,
  normasSinPlantilla,
  familiaEstadoCivil,
  datosTutor1,
  datosTutor2,
  currentUserId,
  currentUserNombre,
}: Props) {
  const t = useTranslations('alta')
  const tErrors = useTranslations()
  const router = useRouter()
  const searchParams = useSearchParams()
  const total = PASOS_ALTA.length
  const pasoMin = modoInvitacion ? 0 : PASO_MIN_AUTENTICADO
  const [step, setStep] = useState<number>(
    Math.min(Math.max(modoInvitacion ? 0 : pasoInicial, pasoMin), total - 1)
  )
  const [consintio, setConsintio] = useState(consintioDatosMedicos)
  const [, startFinalizar] = useTransition()

  const paso: PasoAlta = PASOS_ALTA[step]
  const goNext = () => setStep((s) => Math.min(s + 1, total - 1))
  const goBack = () => setStep((s) => Math.max(s - 1, pasoMin))

  function finalizar() {
    startFinalizar(async () => {
      const r = await finalizarAlta(ninoId)
      if (!r.success) {
        toast.error(tErrors(r.error))
        return
      }
      if (searchParams.get('editar')) {
        router.replace(`/${locale}/alta/${ninoId}`)
      } else {
        router.refresh()
      }
    })
  }

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
        {paso === 'cuenta' && modoInvitacion && (
          <PasoCuenta
            locale={locale}
            token={modoInvitacion.token}
            email={modoInvitacion.email}
            ninoId={ninoId}
            nombreInicial={modoInvitacion.nombreInicial}
            requiereParentesco={modoInvitacion.requiereParentesco}
          />
        )}

        {paso === 'acuses' && (
          <PasoAcuses
            locale={locale}
            normasPanel={normasPanel}
            normasSinPlantilla={normasSinPlantilla}
            currentUserId={currentUserId}
            currentUserNombre={currentUserNombre}
            onNext={goNext}
            onBack={goBack}
          />
        )}

        {paso === 'menor' && (
          <PasoMenor
            locale={locale}
            ninoId={ninoId}
            ninoNombre={ninoNombre}
            identidadInicial={identidadInicial}
            direccionInicial={direccionInicial}
            datosPedagogicosInicial={datosPedagogicosInicial}
            libroFamiliaUrl={libroFamiliaUrl}
            fotoInicialUrl={fotoInicialUrl}
            imagenPanel={imagenPanel}
            imagenSinPlantilla={imagenSinPlantilla}
            currentUserId={currentUserId}
            currentUserNombre={currentUserNombre}
            onNext={goNext}
            onBack={goBack}
          />
        )}

        {paso === 'tutor1' && (
          <PasoTutor
            locale={locale}
            ninoId={ninoId}
            tipoVinculo="tutor_legal_principal"
            inicial={datosTutor1}
            estadoCivilInicial={familiaEstadoCivil}
            mostrarEstadoCivil
            emailReadonly
            opcional={false}
            onNext={goNext}
            onBack={goBack}
          />
        )}

        {paso === 'tutor2' && (
          <PasoTutor
            locale={locale}
            ninoId={ninoId}
            tipoVinculo="tutor_legal_secundario"
            inicial={datosTutor2}
            estadoCivilInicial={null}
            mostrarEstadoCivil={false}
            emailReadonly={false}
            opcional
            onNext={goNext}
            onBack={goBack}
          />
        )}

        {paso === 'medico' && (
          <PasoMedico
            ninoId={ninoId}
            inicial={medicaInicial}
            variante="general"
            mostrarConsentimiento
            consintioInicial={consintio}
            onConsentir={() => setConsintio(true)}
            onNext={goNext}
            onBack={goBack}
          />
        )}

        {paso === 'emergencia' && (
          <PasoMedico
            ninoId={ninoId}
            inicial={medicaInicial}
            variante="emergencia"
            esUltimo
            onNext={finalizar}
            onBack={goBack}
          />
        )}
      </CardContent>
    </Card>
  )
}
