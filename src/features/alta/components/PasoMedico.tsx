'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Form } from '@/components/ui/form'
import { guardarInfoMedicaTutor } from '@/features/ninos/actions/guardar-info-medica-tutor'
import { InfoMedicaFields } from '@/features/ninos/components/InfoMedicaFields'
import { infoMedicaSchema, type InfoMedicaInput } from '@/features/ninos/schemas/nino'

import type { MedicaInicial } from '../lib/tipos'

interface Props {
  ninoId: string
  inicial: MedicaInicial | null
  onNext: () => void
  onBack: () => void
}

/**
 * Paso 4 (VOLUNTARIO, art. 7.4) — ficha médica del niño. Escribe por
 * `guardarInfoMedicaTutor` (RPC cifrada, NULL=preserva, gate solo `es_tutor_legal_de`).
 * Desde F11-F la info médica es voluntaria y ya NO depende del consentimiento: el
 * formulario se muestra siempre y el tutor puede rellenarlo o saltarlo ("Omitir").
 */
export function PasoMedico({ ninoId, inicial, onNext, onBack }: Props) {
  const t = useTranslations('alta')
  const tMed = useTranslations('medico')
  const tErrors = useTranslations()
  const [pending, startTransition] = useTransition()

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
    startTransition(async () => {
      const r = await guardarInfoMedicaTutor({ nino_id: ninoId, ...values })
      if (r.success) {
        toast.success(t('medico.guardado'))
        onNext()
      } else {
        toast.error(tErrors(r.error))
      }
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
        <p className="text-muted-foreground text-xs">{tMed('aviso_cifrado')}</p>
        <InfoMedicaFields control={form.control} />

        <div className="flex justify-between border-t pt-4">
          <Button type="button" variant="outline" onClick={onBack} disabled={pending}>
            {t('wizard.atras')}
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onNext} disabled={pending}>
              {t('medico.omitir')}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? t('wizard.guardando') : t('wizard.guardar_siguiente')}
            </Button>
          </div>
        </div>
      </form>
    </Form>
  )
}
