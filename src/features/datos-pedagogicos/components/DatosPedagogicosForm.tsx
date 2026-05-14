'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  datosPedagogicosInputSchema,
  parseIdiomasCsv,
  type DatosPedagogicosInput,
} from '../schemas/datos-pedagogicos'
import { upsertDatosPedagogicos } from '../actions/upsert-datos-pedagogicos'

interface Props {
  ninoId: string
  locale: string
  initial: DatosPedagogicosInput | null
}

export function DatosPedagogicosForm({ ninoId, locale, initial }: Props) {
  const t = useTranslations('pedagogico')
  const tErrors = useTranslations()
  const [pending, startTransition] = useTransition()

  // El input crudo de idiomas se mantiene en estado local; el array tipado
  // del schema vive en el form y se sincroniza onBlur. Permite que el usuario
  // escriba "es,en,va" cómodamente sin parsing intermedio.
  const [idiomasRaw, setIdiomasRaw] = useState<string>((initial?.idiomas_casa ?? ['es']).join(', '))

  const form = useForm<DatosPedagogicosInput>({
    resolver: zodResolver(datosPedagogicosInputSchema),
    defaultValues: {
      nino_id: ninoId,
      lactancia_estado: initial?.lactancia_estado ?? 'no_aplica',
      lactancia_observaciones: initial?.lactancia_observaciones ?? null,
      control_esfinteres: initial?.control_esfinteres ?? 'panal_completo',
      control_esfinteres_observaciones: initial?.control_esfinteres_observaciones ?? null,
      siesta_horario_habitual: initial?.siesta_horario_habitual ?? null,
      siesta_numero_diario: initial?.siesta_numero_diario ?? null,
      siesta_observaciones: initial?.siesta_observaciones ?? null,
      tipo_alimentacion: initial?.tipo_alimentacion ?? 'omnivora',
      alimentacion_observaciones: initial?.alimentacion_observaciones ?? null,
      idiomas_casa: initial?.idiomas_casa ?? ['es'],
      tiene_hermanos_en_centro: initial?.tiene_hermanos_en_centro ?? false,
    },
  })

  function syncIdiomas(raw: string) {
    form.setValue('idiomas_casa', parseIdiomasCsv(raw), {
      shouldValidate: true,
    })
  }

  const lactanciaItems = (['materna', 'biberon', 'mixta', 'finalizada', 'no_aplica'] as const).map(
    (v) => ({ value: v, label: t(`lactancia_opciones.${v}`) })
  )

  const esfinteresItems = (
    ['panal_completo', 'transicion', 'sin_panal_diurno', 'sin_panal_total'] as const
  ).map((v) => ({ value: v, label: t(`control_esfinteres_opciones.${v}`) }))

  const alimentacionItems = (
    [
      'omnivora',
      'vegetariana',
      'vegana',
      'sin_lactosa',
      'sin_gluten',
      'religiosa_halal',
      'religiosa_kosher',
      'otra',
    ] as const
  ).map((v) => ({ value: v, label: t(`alimentacion_opciones.${v}`) }))

  function onSubmit(values: DatosPedagogicosInput) {
    startTransition(async () => {
      const r = await upsertDatosPedagogicos(locale, values)
      if (r.success) {
        toast.success(t('guardado'))
      } else {
        toast.error(tErrors(r.error))
      }
    })
  }

  // Asegura tipos correctos para tipo_alimentacion en el render (evita TS warns).
  const tipoAlim = form.watch('tipo_alimentacion')

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Lactancia */}
        <section className="space-y-3">
          <h3 className="text-h3 text-foreground">{t('seccion.lactancia')}</h3>
          <FormField
            control={form.control}
            name="lactancia_estado"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('fields.lactancia_estado')}</FormLabel>
                <Select items={lactanciaItems} value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {lactanciaItems.map((i) => (
                      <SelectItem key={i.value} value={i.value}>
                        {i.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="lactancia_observaciones"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('fields.lactancia_observaciones')}</FormLabel>
                <FormControl>
                  <Textarea rows={2} {...field} value={field.value ?? ''} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </section>

        {/* Control esfínteres */}
        <section className="space-y-3">
          <h3 className="text-h3 text-foreground">{t('seccion.control_esfinteres')}</h3>
          <FormField
            control={form.control}
            name="control_esfinteres"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('fields.control_esfinteres')}</FormLabel>
                <Select items={esfinteresItems} value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {esfinteresItems.map((i) => (
                      <SelectItem key={i.value} value={i.value}>
                        {i.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="control_esfinteres_observaciones"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('fields.control_esfinteres_observaciones')}</FormLabel>
                <FormControl>
                  <Textarea rows={2} {...field} value={field.value ?? ''} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </section>

        {/* Siesta */}
        <section className="space-y-3">
          <h3 className="text-h3 text-foreground">{t('seccion.siesta')}</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="siesta_horario_habitual"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('fields.siesta_horario_habitual')}</FormLabel>
                  <FormControl>
                    <Input placeholder="13:00-14:30" {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="siesta_numero_diario"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('fields.siesta_numero_diario')}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      max={5}
                      value={field.value ?? ''}
                      onChange={(e) =>
                        field.onChange(e.target.value === '' ? null : Number(e.target.value))
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
          <FormField
            control={form.control}
            name="siesta_observaciones"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('fields.siesta_observaciones')}</FormLabel>
                <FormControl>
                  <Textarea rows={2} {...field} value={field.value ?? ''} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </section>

        {/* Alimentación */}
        <section className="space-y-3">
          <h3 className="text-h3 text-foreground">{t('seccion.alimentacion')}</h3>
          <FormField
            control={form.control}
            name="tipo_alimentacion"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('fields.tipo_alimentacion')}</FormLabel>
                <Select
                  items={alimentacionItems}
                  value={field.value}
                  onValueChange={field.onChange}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {alimentacionItems.map((i) => (
                      <SelectItem key={i.value} value={i.value}>
                        {i.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="alimentacion_observaciones"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  {t('fields.alimentacion_observaciones')}
                  {tipoAlim === 'otra' ? ' *' : ''}
                </FormLabel>
                <FormControl>
                  <Textarea rows={2} {...field} value={field.value ?? ''} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </section>

        {/* Idiomas + hermanos */}
        <section className="space-y-3">
          <h3 className="text-h3 text-foreground">{t('seccion.otros')}</h3>
          <FormField
            control={form.control}
            name="idiomas_casa"
            render={() => (
              <FormItem>
                <FormLabel>{t('fields.idiomas_casa')}</FormLabel>
                <FormControl>
                  <Input
                    placeholder={t('idiomas_casa_placeholder')}
                    value={idiomasRaw}
                    onChange={(e) => setIdiomasRaw(e.target.value)}
                    onBlur={() => syncIdiomas(idiomasRaw)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="tiene_hermanos_en_centro"
            render={({ field }) => (
              <FormItem className="flex items-center gap-2">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={(c) => field.onChange(c === true)}
                  />
                </FormControl>
                <Label className="font-normal">{t('fields.tiene_hermanos_en_centro')}</Label>
              </FormItem>
            )}
          />
        </section>

        <div className="flex justify-end pt-2">
          <Button type="submit" disabled={pending}>
            {pending ? t('guardando') : t('guardar')}
          </Button>
        </div>
      </form>
    </Form>
  )
}
