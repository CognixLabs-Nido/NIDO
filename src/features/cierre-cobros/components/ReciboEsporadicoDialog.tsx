'use client'

import { useState, useTransition } from 'react'
import { useFieldArray, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Trash2Icon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
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

import { crearReciboEsporadico } from '../actions/crear-recibo-esporadico'
import { lineaEsporadicaSchema } from '../schemas/cierre'

const METODOS = ['ninguno', 'sepa', 'efectivo', 'transferencia'] as const

const formSchema = z.object({
  ninoId: z.string().uuid('cierre_cobros.validation.nino_requerido'),
  concepto: z
    .string()
    .trim()
    .min(1, 'cierre_cobros.validation.concepto_requerido')
    .max(200, 'cierre_cobros.validation.concepto_largo'),
  metodo: z.string(),
  lineas: z.array(lineaEsporadicaSchema).min(1, 'cierre_cobros.validation.sin_lineas'),
})
type FormValues = z.infer<typeof formSchema>

interface Props {
  anio: number
  mes: number
  ninos: Array<{ id: string; nombre: string }>
}

export function ReciboEsporadicoDialog({ anio, mes, ninos }: Props) {
  const t = useTranslations('cierre_cobros')
  const tErrors = useTranslations()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      ninoId: '',
      concepto: '',
      metodo: 'ninguno',
      lineas: [{ descripcion: '', cantidad: 1, importe_euros: 0 }],
    },
  })
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'lineas' })

  const ninoItems = ninos.map((n) => ({ value: n.id, label: n.nombre }))
  const metodoItems = METODOS.map((m) => ({ value: m, label: t(`metodos.${m}`) }))

  function onSubmit(values: FormValues) {
    startTransition(async () => {
      const r = await crearReciboEsporadico({
        ninoId: values.ninoId,
        anio,
        mes,
        concepto: values.concepto,
        metodo:
          values.metodo === 'ninguno'
            ? null
            : (values.metodo as 'sepa' | 'efectivo' | 'transferencia'),
        lineas: values.lineas,
      })
      if (r.success) {
        toast.success(t('esporadico_ok'))
        form.reset()
        setOpen(false)
      } else {
        toast.error(tErrors(r.error))
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline">{t('nuevo_esporadico')}</Button>} />
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t('esporadico_title')}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
            <FormField
              control={form.control}
              name="ninoId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('fields.nino')}</FormLabel>
                  <Select
                    items={ninoItems}
                    value={field.value || undefined}
                    onValueChange={field.onChange}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t('fields.nino_placeholder')} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {ninoItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
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
              name="concepto"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('fields.concepto')}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      maxLength={200}
                      placeholder={t('fields.concepto_placeholder')}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="metodo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('fields.metodo')}</FormLabel>
                  <Select items={metodoItems} value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {metodoItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-2">
              <FormLabel>{t('fields.lineas')}</FormLabel>
              {fields.map((f, i) => (
                <div key={f.id} className="flex items-start gap-2">
                  <FormField
                    control={form.control}
                    name={`lineas.${i}.descripcion`}
                    render={({ field }) => (
                      <FormItem className="flex-1">
                        <FormControl>
                          <Input {...field} maxLength={200} placeholder={t('fields.linea_desc')} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`lineas.${i}.cantidad`}
                    render={({ field }) => (
                      <FormItem className="w-20">
                        <FormControl>
                          <Input
                            type="number"
                            min={1}
                            step={1}
                            inputMode="numeric"
                            aria-label={t('fields.linea_cantidad')}
                            value={Number.isNaN(field.value) ? '' : field.value}
                            onChange={(e) =>
                              field.onChange(e.target.value === '' ? NaN : Number(e.target.value))
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name={`lineas.${i}.importe_euros`}
                    render={({ field }) => (
                      <FormItem className="w-28">
                        <FormControl>
                          <Input
                            type="number"
                            min={0}
                            step={0.01}
                            inputMode="decimal"
                            aria-label={t('fields.linea_importe')}
                            value={Number.isNaN(field.value) ? '' : field.value}
                            onChange={(e) =>
                              field.onChange(e.target.value === '' ? NaN : Number(e.target.value))
                            }
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t('quitar_linea')}
                    disabled={fields.length === 1}
                    onClick={() => remove(i)}
                  >
                    <Trash2Icon className="size-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => append({ descripcion: '', cantidad: 1, importe_euros: 0 })}
              >
                {t('anadir_linea')}
              </Button>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t('cancel')}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? t('guardando') : t('crear_esporadico')}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
