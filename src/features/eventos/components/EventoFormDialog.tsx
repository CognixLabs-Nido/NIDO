'use client'

import { useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'

import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { z } from 'zod'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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

import { crearEvento } from '../actions/crear-evento'
import type { AmbitoEvento, TipoEvento } from '../types'

interface Props {
  locale: string
  /** Ámbitos que el rol puede crear (admin: los 3; profe: solo 'aula'). */
  ambitos: AmbitoEvento[]
  aulas: { id: string; nombre: string }[]
  ninos: { id: string; nombre: string; apellidos: string }[]
}

const TIPOS: TipoEvento[] = ['excursion', 'reunion', 'fiesta', 'vacaciones', 'otro']

const formSchema = z
  .object({
    ambito: z.enum(['centro', 'aula', 'nino']),
    aula_id: z.string().uuid().nullable(),
    nino_id: z.string().uuid().nullable(),
    tipo: z.enum(['excursion', 'reunion', 'fiesta', 'vacaciones', 'otro']),
    titulo: z
      .string()
      .trim()
      .min(1, 'eventos.validation.titulo_vacio')
      .max(200, 'eventos.validation.titulo_largo'),
    descripcion: z.string().trim().max(2000, 'eventos.validation.descripcion_larga'),
    lugar: z.string().trim().max(200, 'eventos.validation.lugar_largo'),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'eventos.validation.fecha_invalida'),
    fecha_fin: z.string(),
    hora_inicio: z.string(),
    hora_fin: z.string(),
    requiere_confirmacion: z.boolean(),
  })
  .superRefine((v, ctx) => {
    if (v.ambito === 'aula' && !v.aula_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['aula_id'],
        message: 'eventos.validation.aula_requerida',
      })
    }
    if (v.ambito === 'nino' && !v.nino_id) {
      ctx.addIssue({
        code: 'custom',
        path: ['nino_id'],
        message: 'eventos.validation.nino_requerido',
      })
    }
    if (v.fecha_fin && v.fecha_fin < v.fecha) {
      ctx.addIssue({
        code: 'custom',
        path: ['fecha_fin'],
        message: 'eventos.validation.rango_invalido',
      })
    }
  })

type FormValues = z.infer<typeof formSchema>

export function EventoFormDialog({ locale: _locale, ambitos, aulas, ninos }: Props) {
  const t = useTranslations('eventos')
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      ambito: ambitos[0] ?? 'aula',
      aula_id: null,
      nino_id: null,
      tipo: 'excursion',
      titulo: '',
      descripcion: '',
      lugar: '',
      fecha: '',
      fecha_fin: '',
      hora_inicio: '',
      hora_fin: '',
      requiere_confirmacion: false,
    },
  })

  const ambito = form.watch('ambito')
  const ambitoItems = ambitos.map((a) => ({ value: a, label: t(`ambitos.${a}`) }))
  const tipoItems = TIPOS.map((tp) => ({ value: tp, label: t(`tipos.${tp}`) }))
  const aulaItems = aulas.map((a) => ({ value: a.id, label: a.nombre }))
  const ninoItems = ninos.map((n) => ({ value: n.id, label: `${n.nombre} ${n.apellidos}` }))

  function onAmbitoChange(v: AmbitoEvento) {
    form.setValue('ambito', v)
    if (v !== 'aula') form.setValue('aula_id', null)
    if (v !== 'nino') form.setValue('nino_id', null)
  }

  function onSubmit(values: FormValues) {
    startTransition(async () => {
      const res = await crearEvento({
        ambito: values.ambito,
        aula_id: values.ambito === 'aula' ? values.aula_id : null,
        nino_id: values.ambito === 'nino' ? values.nino_id : null,
        tipo: values.tipo,
        titulo: values.titulo,
        descripcion: values.descripcion.trim() ? values.descripcion : null,
        lugar: values.lugar.trim() ? values.lugar : null,
        fecha: values.fecha,
        fecha_fin: values.fecha_fin || null,
        hora_inicio: values.hora_inicio || null,
        hora_fin: values.hora_fin || null,
        requiere_confirmacion: values.requiere_confirmacion,
      })
      if (!res.success) {
        toast.error(t('errors.creacion_fallo'))
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
      <DialogTrigger render={<Button data-testid="eventos-nuevo" />}>
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
            data-testid="evento-form"
          >
            {ambitos.length > 1 && (
              <FormField
                control={form.control}
                name="ambito"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('form.ambito')}</FormLabel>
                    <Select
                      items={ambitoItems}
                      value={field.value}
                      onValueChange={(v) => onAmbitoChange(v as AmbitoEvento)}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {ambitoItems.map((item) => (
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

            {ambito === 'aula' && (
              <FormField
                control={form.control}
                name="aula_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('form.aula')}</FormLabel>
                    <Select
                      items={aulaItems}
                      value={field.value ?? ''}
                      onValueChange={(v) => field.onChange(v)}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full" data-testid="evento-aula-select">
                          <SelectValue placeholder={t('form.aula_placeholder')} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {aulaItems.map((item) => (
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

            {ambito === 'nino' && (
              <FormField
                control={form.control}
                name="nino_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('form.nino')}</FormLabel>
                    <Select
                      items={ninoItems}
                      value={field.value ?? ''}
                      onValueChange={(v) => field.onChange(v)}
                    >
                      <FormControl>
                        <SelectTrigger className="w-full" data-testid="evento-nino-select">
                          <SelectValue placeholder={t('form.nino_placeholder')} />
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
              name="tipo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('form.tipo')}</FormLabel>
                  <Select
                    items={tipoItems}
                    value={field.value}
                    onValueChange={(v) => field.onChange(v)}
                  >
                    <FormControl>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {tipoItems.map((item) => (
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
              name="titulo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('form.titulo')}</FormLabel>
                  <FormControl>
                    <Input {...field} maxLength={200} placeholder={t('form.titulo_placeholder')} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="fecha"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('form.fecha')}</FormLabel>
                  <FormControl>
                    <Input {...field} type="date" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="fecha_fin"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('form.fecha_fin')}</FormLabel>
                  <FormControl>
                    <Input {...field} type="date" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-2 gap-2">
              <FormField
                control={form.control}
                name="hora_inicio"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('form.hora_inicio')}</FormLabel>
                    <FormControl>
                      <Input {...field} type="time" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="hora_fin"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('form.hora_fin')}</FormLabel>
                    <FormControl>
                      <Input {...field} type="time" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="lugar"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('form.lugar')}</FormLabel>
                  <FormControl>
                    <Input {...field} maxLength={200} />
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
                  <FormLabel>{t('form.descripcion')}</FormLabel>
                  <FormControl>
                    <Textarea {...field} rows={3} maxLength={2000} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="requiere_confirmacion"
              render={({ field }) => (
                <FormItem>
                  <label className="flex items-center gap-2">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(checked) => field.onChange(checked === true)}
                        data-testid="evento-requiere-confirmacion"
                      />
                    </FormControl>
                    <FormLabel className="!mt-0">{t('form.requiere_confirmacion')}</FormLabel>
                  </label>
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
