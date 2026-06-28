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

import { actualizarTipoBeca, crearTipoBeca } from '../actions/tipo-beca'
import { tipoBecaSchema, type TipoBecaInput } from '../schemas/tipo-beca'
import type { TipoBecaListItem } from '../queries/get-tipos-beca'

interface Props {
  centroId: string
  tipo?: TipoBecaListItem
  trigger: ReactElement
}

export function TipoBecaFormDialog({ centroId, tipo, trigger }: Props) {
  const t = useTranslations('admin.cuotas')
  const tErrors = useTranslations()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const esEdicion = tipo != null

  const form = useForm<TipoBecaInput>({
    resolver: zodResolver(tipoBecaSchema),
    defaultValues: { nombre: tipo?.nombre ?? '', activo: tipo?.activo ?? true },
  })

  function onSubmit(values: TipoBecaInput) {
    startTransition(async () => {
      const r = esEdicion
        ? await actualizarTipoBeca(tipo.id, values)
        : await crearTipoBeca(centroId, values)
      if (r.success) {
        toast.success(esEdicion ? t('becas.tipo_updated') : t('becas.tipo_created'))
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
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>
            {esEdicion ? t('becas.tipo_editar_title') : t('becas.tipo_nuevo_title')}
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
            <FormField
              control={form.control}
              name="nombre"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('becas.fields.tipo_nombre')}</FormLabel>
                  <FormControl>
                    <Input {...field} maxLength={120} />
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
                    {t('becas.fields.tipo_activo')}
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
