'use client'

import { useState, useTransition } from 'react'
import { useForm, type UseFormReturn } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { crearNinoCompleto } from '../actions/crear-nino-completo'
import { crearNinoCompletoSchema, type CrearNinoCompletoInput } from '../schemas/nino'

interface AulaOption {
  id: string
  nombre: string
  cohorte_anos_nacimiento: number[]
}

interface Props {
  centroId: string
  locale: string
  aulas: AulaOption[]
}

export function NuevoNinoWizard({ centroId, locale, aulas }: Props) {
  const t = useTranslations('admin.ninos')
  const tErrors = useTranslations()
  const router = useRouter()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [pending, startTransition] = useTransition()

  const form = useForm<CrearNinoCompletoInput>({
    resolver: zodResolver(crearNinoCompletoSchema),
    defaultValues: {
      datos: {
        nombre: '',
        apellidos: '',
        fecha_nacimiento: '',
        sexo: null,
        nacionalidad: null,
        idioma_principal: 'es',
        notas_admin: null,
      },
      medica: {
        alergias_graves: null,
        notas_emergencia: null,
        medicacion_habitual: null,
        alergias_leves: null,
        medico_familia: null,
        telefono_emergencia: null,
      },
      aula_id: '',
      confirmar_fuera_cohorte: false,
    },
  })

  function onSubmit(values: CrearNinoCompletoInput) {
    startTransition(async () => {
      const r = await crearNinoCompleto(centroId, values)
      if (r.success) {
        toast.success(t('created'))
        router.push(`/${locale}/admin/ninos/${r.data.ninoId}`)
      } else {
        toast.error(tErrors(r.error))
      }
    })
  }

  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <CardTitle>{t('wizard.title')}</CardTitle>
        <p className="text-muted-foreground text-xs">
          {t('wizard.step')} {step}/3 — {t(`wizard.paso${step}`)}
        </p>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {step === 1 && (
              <Paso1
                form={form}
                onNext={async () => {
                  const ok = await form.trigger('datos')
                  if (ok) setStep(2)
                }}
              />
            )}
            {step === 2 && (
              <Paso2 form={form} onBack={() => setStep(1)} onNext={() => setStep(3)} />
            )}
            {step === 3 && (
              <Paso3
                form={form}
                aulas={aulas}
                onBack={() => setStep(2)}
                pending={pending}
                tNino={t}
              />
            )}
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}

type WizardForm = UseFormReturn<CrearNinoCompletoInput>

function Paso1({ form, onNext }: { form: WizardForm; onNext: () => void }) {
  const t = useTranslations('admin.ninos')
  return (
    <div className="space-y-3">
      <FormField
        control={form.control}
        name="datos.nombre"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('fields.nombre')}</FormLabel>
            <FormControl>
              <Input {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="datos.apellidos"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('fields.apellidos')}</FormLabel>
            <FormControl>
              <Input {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="datos.fecha_nacimiento"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('fields.fecha_nacimiento')}</FormLabel>
            <FormControl>
              <Input type="date" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="datos.idioma_principal"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('fields.idioma_principal')}</FormLabel>
            <Select onValueChange={field.onChange} value={field.value}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="es">Español</SelectItem>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="va">Valencià</SelectItem>
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
      <div className="flex justify-end pt-2">
        <Button type="button" onClick={onNext}>
          {t('wizard.next')}
        </Button>
      </div>
    </div>
  )
}

function Paso2({
  form,
  onBack,
  onNext,
}: {
  form: WizardForm
  onBack: () => void
  onNext: () => void
}) {
  const t = useTranslations('admin.ninos')
  const tMed = useTranslations('medico')
  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-xs">{tMed('aviso_cifrado')}</p>
      <FormField
        control={form.control}
        name="medica.alergias_graves"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('fields.alergias_graves')}</FormLabel>
            <FormControl>
              <Textarea rows={2} {...field} value={field.value ?? ''} />
            </FormControl>
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="medica.notas_emergencia"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('fields.notas_emergencia')}</FormLabel>
            <FormControl>
              <Textarea rows={2} {...field} value={field.value ?? ''} />
            </FormControl>
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="medica.medicacion_habitual"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('fields.medicacion_habitual')}</FormLabel>
            <FormControl>
              <Textarea rows={2} {...field} value={field.value ?? ''} />
            </FormControl>
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="medica.telefono_emergencia"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('fields.telefono_emergencia')}</FormLabel>
            <FormControl>
              <Input {...field} value={field.value ?? ''} />
            </FormControl>
          </FormItem>
        )}
      />
      <div className="flex justify-between pt-2">
        <Button type="button" variant="outline" onClick={onBack}>
          {t('wizard.back')}
        </Button>
        <Button type="button" onClick={onNext}>
          {t('wizard.next')}
        </Button>
      </div>
    </div>
  )
}

function Paso3({
  form,
  aulas,
  onBack,
  pending,
  tNino,
}: {
  form: WizardForm
  aulas: AulaOption[]
  onBack: () => void
  pending: boolean
  tNino: (key: string) => string
}) {
  return (
    <div className="space-y-3">
      <FormField
        control={form.control}
        name="aula_id"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{tNino('fields.aula')}</FormLabel>
            <Select onValueChange={field.onChange} value={field.value}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder={tNino('fields.aula_placeholder')} />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {aulas.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.nombre} ({a.cohorte_anos_nacimiento.join(', ')})
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
        name="confirmar_fuera_cohorte"
        render={({ field }) => (
          <FormItem className="flex items-center gap-2">
            <FormControl>
              <input
                type="checkbox"
                checked={field.value ?? false}
                onChange={(e) => field.onChange(e.target.checked)}
              />
            </FormControl>
            <FormLabel className="font-normal">{tNino('fields.confirmar_fuera_cohorte')}</FormLabel>
          </FormItem>
        )}
      />
      <div className="flex justify-between pt-2">
        <Button type="button" variant="outline" onClick={onBack}>
          {tNino('wizard.back')}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? tNino('wizard.saving') : tNino('wizard.submit')}
        </Button>
      </div>
    </div>
  )
}
