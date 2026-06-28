'use client'

import { type ReactElement, useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

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
import { centimosAEuros } from '@/shared/lib/format-money'

import { actualizarConcepto } from '../actions/actualizar-concepto'
import { crearConcepto } from '../actions/crear-concepto'
import {
  conceptoCobroSchema,
  TIPOS_CONCEPTO,
  type ConceptoCobroInput,
} from '../schemas/concepto-cobro'
import type { ConceptoCobroListItem } from '../queries/get-conceptos-cobro'

interface Props {
  centroId: string
  /** Si viene, el diálogo edita ese concepto; si no, crea uno nuevo. */
  concepto?: ConceptoCobroListItem
  trigger: ReactElement
}

export function ConceptoFormDialog({ centroId, concepto, trigger }: Props) {
  const t = useTranslations('admin.cuotas')
  const tErrors = useTranslations()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const esEdicion = concepto != null

  const form = useForm<ConceptoCobroInput>({
    resolver: zodResolver(conceptoCobroSchema),
    defaultValues: {
      nombre: concepto?.nombre ?? '',
      tipo_concepto: concepto?.tipo_concepto ?? 'mensual',
      precio_euros: concepto ? centimosAEuros(concepto.precio_centimos) : 0,
      activo: concepto?.activo ?? true,
    },
  })

  const tipoItems = TIPOS_CONCEPTO.map((value) => ({ value, label: t(`tipos.${value}`) }))

  function onSubmit(values: ConceptoCobroInput) {
    startTransition(async () => {
      const r = esEdicion
        ? await actualizarConcepto(concepto.id, values)
        : await crearConcepto(centroId, values)
      if (r.success) {
        toast.success(esEdicion ? t('updated') : t('created'))
        if (!esEdicion) form.reset()
        setOpen(false)
      } else {
        toast.error(tErrors(r.error))
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{esEdicion ? t('editar_title') : t('nuevo_title')}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
            <FormField
              control={form.control}
              name="nombre"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('fields.nombre')}</FormLabel>
                  <FormControl>
                    <Input {...field} maxLength={120} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="tipo_concepto"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('fields.tipo')}</FormLabel>
                  <Select items={tipoItems} value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
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
              name="precio_euros"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('fields.precio')}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      step={0.01}
                      inputMode="decimal"
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
              name="activo"
              render={({ field }) => (
                <FormItem>
                  <label className="flex items-center gap-2 text-sm">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(c) => field.onChange(c === true)}
                      />
                    </FormControl>
                    {t('fields.activo')}
                  </label>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t('cancel')}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? t('saving') : esEdicion ? t('save_edit') : t('save_new')}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
