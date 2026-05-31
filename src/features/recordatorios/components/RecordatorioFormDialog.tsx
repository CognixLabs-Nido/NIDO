'use client'

import { useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { z } from 'zod'
import { PlusIcon } from 'lucide-react'

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
import { Textarea } from '@/components/ui/textarea'

import { crearRecordatorio } from '../actions/crear-recordatorio'
import { datetimeLocalAIso, requiereNino } from '../lib/form-helpers'
import type { RecordatorioDestinatarioInput } from '../schemas/recordatorios'
import type { NinoParaRecordatorio } from '../queries/get-ninos-para-recordatorios'

interface Props {
  locale: string
  /** Destinos que el rol del usuario puede crear (destinosParaRol). */
  destinos: RecordatorioDestinatarioInput[]
  ninos: NinoParaRecordatorio[]
}

// Schema de FORM (UI): `vencimiento` es el string local del input datetime-local
// (se convierte a ISO al enviar). El cross-field niño se valida igual que en BD.
// La validación de longitudes y la autorización las re-aplica el server action.
const formSchema = z
  .object({
    destinatario: z.enum(['familia', 'equipo', 'direccion', 'personal']),
    nino_id: z.string().uuid().nullable(),
    titulo: z
      .string()
      .trim()
      .min(1, 'recordatorios.validation.titulo_vacio')
      .max(200, 'recordatorios.validation.titulo_largo'),
    descripcion: z.string().trim().max(1000, 'recordatorios.validation.descripcion_larga'),
    vencimiento: z.string(),
  })
  .superRefine((v, ctx) => {
    if (requiereNino(v.destinatario) && !v.nino_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['nino_id'],
        message: 'recordatorios.validation.nino_requerido',
      })
    }
  })

type FormValues = z.infer<typeof formSchema>

export function RecordatorioFormDialog({ locale, destinos, ninos }: Props) {
  const t = useTranslations('recordatorios')
  const tDestinos = useTranslations('recordatorios.destinos')
  const tForm = useTranslations('recordatorios.form')
  const tVal = useTranslations('recordatorios.validation')
  const tErr = useTranslations('recordatorios.errors')
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      destinatario: destinos[0] ?? 'personal',
      nino_id: null,
      titulo: '',
      descripcion: '',
      vencimiento: '',
    },
  })

  const destino = form.watch('destinatario')
  const destinoItems = destinos.map((d) => ({ value: d, label: tDestinos(d) }))
  const ninoItems = ninos.map((n) => ({ value: n.id, label: `${n.nombre} ${n.apellidos}` }))

  function traducirError(error: string): string {
    if (error.startsWith('recordatorios.validation.')) {
      return tVal(error.replace('recordatorios.validation.', ''))
    }
    if (error.startsWith('recordatorios.errors.')) {
      return tErr(error.replace('recordatorios.errors.', ''))
    }
    return tErr('creacion_fallo')
  }

  function onSubmit(values: FormValues) {
    startTransition(async () => {
      const res = await crearRecordatorio({
        destinatario: values.destinatario,
        nino_id: requiereNino(values.destinatario) ? values.nino_id : null,
        titulo: values.titulo,
        descripcion: values.descripcion.trim() ? values.descripcion : null,
        vencimiento: datetimeLocalAIso(values.vencimiento),
      })
      if (!res.success) {
        toast.error(traducirError(res.error))
        return
      }
      toast.success(t('acciones.creado_toast'))
      form.reset()
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button data-testid="recordatorios-nuevo" />}>
        <PlusIcon className="size-4" aria-hidden />
        {t('nuevo')}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('nuevo')}</DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-4"
            data-testid="recordatorio-form"
          >
            <FormField
              control={form.control}
              name="destinatario"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tForm('destino')}</FormLabel>
                  <Select
                    items={destinoItems}
                    value={field.value}
                    onValueChange={(v) => {
                      field.onChange(v as RecordatorioDestinatarioInput)
                      if (!requiereNino(v as RecordatorioDestinatarioInput)) {
                        form.setValue('nino_id', null)
                      }
                    }}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {destinoItems.map((item) => (
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

            {requiereNino(destino) && (
              <FormField
                control={form.control}
                name="nino_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{tForm('nino')}</FormLabel>
                    <Select
                      items={ninoItems}
                      value={field.value ?? ''}
                      onValueChange={(v) => field.onChange(v)}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full" data-testid="recordatorio-nino-select">
                          <SelectValue placeholder={tForm('nino_placeholder')} />
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
            )}

            <FormField
              control={form.control}
              name="titulo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tForm('titulo')}</FormLabel>
                  <FormControl>
                    <Input {...field} maxLength={200} placeholder={tForm('titulo_placeholder')} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="descripcion"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tForm('descripcion')}</FormLabel>
                  <FormControl>
                    <Textarea {...field} rows={3} maxLength={1000} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="vencimiento"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tForm('vencimiento')}</FormLabel>
                  <FormControl>
                    <Input {...field} type="datetime-local" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type="submit" disabled={pending} className="w-full">
              {pending ? t('acciones.creando') : t('acciones.crear')}
            </Button>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
