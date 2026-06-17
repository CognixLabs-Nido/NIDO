'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormLabel } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { guardarInfoMedicaTutor } from '@/features/ninos/actions/guardar-info-medica-tutor'
import { infoMedicaSchema, type InfoMedicaInput } from '@/features/ninos/schemas/nino'

import { SubirCartilla } from './SubirCartilla'

import type { MedicaInicial } from '../lib/tipos'

interface Props {
  ninoId: string
  locale: string
  inicial: MedicaInicial | null
  /** Ya hay una cartilla persistida → SubirCartilla muestra el estado "ya subida". */
  cartillaYaSubida: boolean
  /** Gate: la RPC médica y el bucket cartilla exigen consentimiento `datos_medicos`. */
  consintioDatosMedicos: boolean
  onIrAConsentimientos: () => void
  onNext: () => void
  onBack: () => void
}

/**
 * Paso 4 (OPCIONAL, art. 7.4) — ficha médica del niño + cartilla de vacunas. Escribe
 * por `guardarInfoMedicaTutor` (RPC cifrada, NULL=preserva) y la cartilla por la ruta
 * de 3b-1. Ambas están gateadas por el consentimiento `datos_medicos`: sin él, el paso
 * muestra un aviso para volver a consentimientos en vez del formulario.
 */
export function PasoMedico({
  ninoId,
  locale,
  inicial,
  cartillaYaSubida,
  consintioDatosMedicos,
  onIrAConsentimientos,
  onNext,
  onBack,
}: Props) {
  const t = useTranslations('alta')
  const tNino = useTranslations('admin.ninos')
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

  // Sin consentimiento: el paso es opcional → permite saltarlo o ir a consentirlo.
  if (!consintioDatosMedicos) {
    return (
      <div className="space-y-4">
        <div className="bg-muted/40 rounded-lg border p-4 text-sm">
          <p>{t('medico.requiere_consentimiento')}</p>
          <Button type="button" variant="outline" className="mt-3" onClick={onIrAConsentimientos}>
            {t('medico.ir_a_consentimientos')}
          </Button>
        </div>
        <div className="flex justify-between border-t pt-4">
          <Button type="button" variant="outline" onClick={onBack}>
            {t('wizard.atras')}
          </Button>
          <Button type="button" onClick={onNext}>
            {t('medico.omitir')}
          </Button>
        </div>
      </div>
    )
  }

  const campos: { name: keyof InfoMedicaInput; textarea?: boolean }[] = [
    { name: 'alergias_graves', textarea: true },
    { name: 'notas_emergencia', textarea: true },
    { name: 'medicacion_habitual', textarea: true },
    { name: 'alergias_leves', textarea: true },
    { name: 'medico_familia' },
    { name: 'telefono_emergencia' },
  ]

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
        <p className="text-muted-foreground text-xs">{tMed('aviso_cifrado')}</p>
        {campos.map(({ name, textarea }) => (
          <FormField
            key={name}
            control={form.control}
            name={name}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{tNino(`fields.${name}`)}</FormLabel>
                <FormControl>
                  {textarea ? (
                    <Textarea rows={2} {...field} value={field.value ?? ''} />
                  ) : (
                    <Input {...field} value={field.value ?? ''} />
                  )}
                </FormControl>
              </FormItem>
            )}
          />
        ))}

        <div className="space-y-1.5 border-t pt-3">
          <p className="text-sm font-medium">{t('medico.cartilla_titulo')}</p>
          <SubirCartilla ninoId={ninoId} locale={locale} yaSubida={cartillaYaSubida} />
        </div>

        <div className="flex justify-between border-t pt-4">
          <Button type="button" variant="outline" onClick={onBack} disabled={pending}>
            {t('wizard.atras')}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? t('wizard.guardando') : t('wizard.guardar_siguiente')}
          </Button>
        </div>
      </form>
    </Form>
  )
}
