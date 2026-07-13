'use client'

import { type ReactElement, useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
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

import { editarEtiquetaFamilia } from '../actions/editar-etiqueta-familia'
import {
  editarEtiquetaFamiliaSchema,
  type EditarEtiquetaFamiliaInput,
} from '../schemas/editar-familia'

/** F-6a — diálogo para editar la etiqueta de una familia (Dirección). */
export function EditarEtiquetaDialog({
  familiaId,
  etiquetaActual,
  trigger,
}: {
  familiaId: string
  etiquetaActual: string | null
  trigger: ReactElement
}) {
  const t = useTranslations('admin.familias')
  const tErrors = useTranslations()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const form = useForm<EditarEtiquetaFamiliaInput>({
    resolver: zodResolver(editarEtiquetaFamiliaSchema),
    defaultValues: { familia_id: familiaId, etiqueta: etiquetaActual ?? '' },
  })

  function onSubmit(values: EditarEtiquetaFamiliaInput) {
    startTransition(async () => {
      const r = await editarEtiquetaFamilia(values)
      if (r.success) {
        toast.success(t('editar_etiqueta.guardado'))
        setOpen(false)
        router.refresh()
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
          <DialogTitle>{t('editar_etiqueta.title')}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
            <FormField
              control={form.control}
              name="etiqueta"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('fields.etiqueta')}</FormLabel>
                  <FormControl>
                    <Input {...field} maxLength={200} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t('editar_etiqueta.cancelar')}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? t('editar_etiqueta.guardando') : t('editar_etiqueta.guardar')}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
