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

import { editarPerfilTutor } from '../actions/editar-perfil-tutor'
import { editarPerfilTutorSchema, type EditarPerfilTutorInput } from '../schemas/editar-familia'
import type { TutorDetalle } from '../queries/get-familia-detalle'

/**
 * F-6a — diálogo para editar el perfil (identidad + dirección) de un tutor. Solo campos
 * editables; el DNI y el vínculo/rol/cuenta NO se tocan aquí.
 */
export function EditarTutorDialog({
  tutor,
  trigger,
}: {
  tutor: TutorDetalle
  trigger: ReactElement
}) {
  const t = useTranslations('admin.familias')
  const tErrors = useTranslations()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const form = useForm<EditarPerfilTutorInput>({
    resolver: zodResolver(editarPerfilTutorSchema),
    defaultValues: {
      tutor_id: tutor.id,
      nombre_completo: tutor.nombre_completo,
      email: tutor.email,
      direccion_calle: tutor.direccion_calle,
      direccion_numero: tutor.direccion_numero,
      direccion_cp: tutor.direccion_cp,
      direccion_ciudad: tutor.direccion_ciudad,
    },
  })

  function onSubmit(values: EditarPerfilTutorInput) {
    startTransition(async () => {
      const r = await editarPerfilTutor(values)
      if (r.success) {
        toast.success(t('editar_tutor.guardado'))
        setOpen(false)
        router.refresh()
      } else {
        toast.error(tErrors(r.error))
      }
    })
  }

  // Campos de dirección: input vacío → null (para que la BD guarde NULL, no cadena vacía).
  const nullableField = (name: keyof EditarPerfilTutorInput, label: string, maxLength: number) => (
    <FormField
      control={form.control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              value={(field.value as string | null) ?? ''}
              onChange={(e) => field.onChange(e.target.value === '' ? null : e.target.value)}
              maxLength={maxLength}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{t('editar_tutor.title')}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
            <FormField
              control={form.control}
              name="nombre_completo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('fields.nombre')}</FormLabel>
                  <FormControl>
                    <Input
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value)}
                      maxLength={200}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('fields.email')}</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      value={field.value ?? ''}
                      onChange={(e) =>
                        field.onChange(e.target.value === '' ? null : e.target.value)
                      }
                      maxLength={255}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-2 gap-3">
              {nullableField('direccion_calle', t('fields.direccion_calle'), 200)}
              {nullableField('direccion_numero', t('fields.direccion_numero'), 20)}
              {nullableField('direccion_cp', t('fields.direccion_cp'), 12)}
              {nullableField('direccion_ciudad', t('fields.direccion_ciudad'), 120)}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t('editar_tutor.cancelar')}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? t('editar_tutor.guardando') : t('editar_tutor.guardar')}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
