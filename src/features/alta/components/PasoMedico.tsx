'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { CheckCircle2Icon } from 'lucide-react'
import { useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Form } from '@/components/ui/form'
import { guardarInfoMedicaTutor } from '@/features/ninos/actions/guardar-info-medica-tutor'
import { InfoMedicaFields } from '@/features/ninos/components/InfoMedicaFields'
import { infoMedicaSchema, type InfoMedicaInput } from '@/features/ninos/schemas/nino'

import { registrarConsentimientoTutor } from '../actions/registrar-consentimiento-tutor'
import type { MedicaInicial } from '../lib/tipos'

/** Reparto de los 6 campos médicos en las dos sub-fichas del alta (G-1). */
const CAMPOS_GENERAL: (keyof InfoMedicaInput)[] = [
  'medicacion_habitual',
  'alergias_leves',
  'medico_familia',
]
const CAMPOS_EMERGENCIA: (keyof InfoMedicaInput)[] = [
  'alergias_graves',
  'notas_emergencia',
  'telefono_emergencia',
]

interface Props {
  ninoId: string
  inicial: MedicaInicial | null
  /** `general` (medicación/alergias leves/médico) | `emergencia` (alergias graves/notas/tel). */
  variante: 'general' | 'emergencia'
  /** El acuse de confidencialidad de datos médicos (obligatorio para cerrar) va en `general`. */
  mostrarConsentimiento?: boolean
  consintioInicial?: boolean
  onConsentir?: () => void
  /** Último paso del wizard: avanzar = finalizar el alta (relabela el botón). */
  esUltimo?: boolean
  onNext: () => void
  onBack: () => void
}

/**
 * Pasos 6 (general + acuse) y 7 (emergencia) del alta (G-1) — ficha médica VOLUNTARIA
 * (art. 7.4), cifrada vía `guardarInfoMedicaTutor` (RPC, NULL=preserva, gate
 * `es_tutor_legal_de`). Reusa `InfoMedicaFields` con un subconjunto de campos por
 * `variante`, así cada paso escribe lo suyo sin pisar lo otro (NULL=preserva). El acuse de
 * datos médicos (paso 6) reusa `registrarConsentimientoTutor`.
 */
export function PasoMedico({
  ninoId,
  inicial,
  variante,
  mostrarConsentimiento = false,
  consintioInicial = false,
  onConsentir,
  esUltimo = false,
  onNext,
  onBack,
}: Props) {
  const t = useTranslations('alta')
  const tMed = useTranslations('medico')
  const tErrors = useTranslations()
  const [pending, startTransition] = useTransition()
  const [consintio, setConsintio] = useState(consintioInicial)
  const [consintiendo, startConsentir] = useTransition()

  const campos = variante === 'general' ? CAMPOS_GENERAL : CAMPOS_EMERGENCIA

  const form = useForm<InfoMedicaInput>({
    resolver: zodResolver(infoMedicaSchema),
    defaultValues: {
      alergias_graves: inicial?.alergias_graves ?? null,
      notas_emergencia: inicial?.notas_emergencia ?? null,
      medicacion_habitual: inicial?.medicacion_habitual ?? null,
      alergias_leves: inicial?.alergias_leves ?? null,
      medico_familia: inicial?.medico_familia ?? null,
      telefono_emergencia: inicial?.telefono_emergencia ?? null,
    },
  })

  function onSubmit(values: InfoMedicaInput) {
    // Solo envía los campos de la variante (los demás van como null → la RPC los preserva).
    const subset: Partial<InfoMedicaInput> = {}
    for (const c of campos) subset[c] = values[c]
    startTransition(async () => {
      const r = await guardarInfoMedicaTutor({ nino_id: ninoId, ...subset })
      if (r.success) {
        toast.success(t('medico.guardado'))
        onNext()
      } else {
        toast.error(tErrors(r.error))
      }
    })
  }

  function otorgarConsentimiento() {
    startConsentir(async () => {
      const r = await registrarConsentimientoTutor({ tipo: 'datos_medicos' })
      if (r.success) {
        setConsintio(true)
        onConsentir?.()
        toast.success(t('consentimientos.otorgado'))
      } else {
        toast.error(tErrors(r.error))
      }
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
        {mostrarConsentimiento && (
          <div className="space-y-2 rounded-lg border p-4">
            <h3 className="text-sm font-semibold">{t('consentimientos.datos_medicos_titulo')}</h3>
            <p className="text-muted-foreground text-sm">
              {t('consentimientos.datos_medicos_texto')}
            </p>
            {consintio ? (
              <p className="text-success-700 flex items-center gap-2 text-sm font-medium">
                <CheckCircle2Icon className="size-4" strokeWidth={2} aria-hidden />
                {t('consentimientos.concedido')}
              </p>
            ) : (
              <Button type="button" onClick={otorgarConsentimiento} disabled={consintiendo}>
                {consintiendo ? t('wizard.guardando') : t('consentimientos.otorgar')}
              </Button>
            )}
          </div>
        )}

        <p className="text-muted-foreground text-xs">{tMed('aviso_cifrado')}</p>
        <InfoMedicaFields control={form.control} campos={campos} />

        <div className="flex justify-between border-t pt-4">
          <Button type="button" variant="outline" onClick={onBack} disabled={pending}>
            {t('wizard.atras')}
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onNext} disabled={pending}>
              {t('medico.omitir')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending
                ? t('wizard.guardando')
                : esUltimo
                  ? t('wizard.finalizar')
                  : t('wizard.guardar_siguiente')}
            </Button>
          </div>
        </div>
      </form>
    </Form>
  )
}
