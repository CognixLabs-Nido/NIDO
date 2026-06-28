'use client'

import { type ReactElement, useState, useTransition } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

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
import { centimosAEuros } from '@/shared/lib/format-money'

import { actualizarBeca, crearBeca } from '../actions/beca'
import { becaSchema, type BecaInput } from '../schemas/beca'
import type { BecaListItem } from '../queries/get-becas'

export interface OpcionMin {
  id: string
  nombre: string
}

interface Props {
  centroId: string
  beca?: BecaListItem
  ninos: OpcionMin[]
  tipos: OpcionMin[]
  trigger: ReactElement
}

export function BecaFormDialog({ centroId, beca, ninos, tipos, trigger }: Props) {
  const t = useTranslations('admin.cuotas')
  const tErrors = useTranslations()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const esEdicion = beca != null

  const form = useForm<BecaInput>({
    resolver: zodResolver(becaSchema),
    defaultValues: {
      nino_id: beca?.nino_id ?? '',
      tipo_beca_id: beca?.tipo_beca_id ?? '',
      importe_euros: beca ? centimosAEuros(beca.importe_centimos) : 0,
      fecha_desde: beca?.fecha_desde ?? '',
      fecha_hasta: beca?.fecha_hasta ?? '',
    },
  })

  const ninoItems = ninos.map((n) => ({ value: n.id, label: n.nombre }))
  const tipoItems = tipos.map((tp) => ({ value: tp.id, label: tp.nombre }))

  function onSubmit(values: BecaInput) {
    startTransition(async () => {
      const r = esEdicion
        ? await actualizarBeca(beca.id, values)
        : await crearBeca(centroId, values)
      if (r.success) {
        toast.success(esEdicion ? t('becas.updated') : t('becas.created'))
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
          <DialogTitle>{esEdicion ? t('becas.editar_title') : t('becas.nueva_title')}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
            <FormField
              control={form.control}
              name="nino_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('becas.fields.nino')}</FormLabel>
                  <Select items={ninoItems} value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t('becas.elige_nino')} />
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
              name="tipo_beca_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('becas.fields.tipo')}</FormLabel>
                  <Select items={tipoItems} value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t('becas.elige_tipo')} />
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
              name="importe_euros"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('becas.fields.importe')}</FormLabel>
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

            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="fecha_desde"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('becas.fields.desde')}</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Controller
                control={form.control}
                name="fecha_hasta"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>{t('becas.fields.hasta')}</FormLabel>
                    <Input
                      type="date"
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value)}
                    />
                    {fieldState.error && (
                      <p className="text-destructive text-sm">
                        {tErrors(fieldState.error.message ?? '')}
                      </p>
                    )}
                  </FormItem>
                )}
              />
            </div>

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
