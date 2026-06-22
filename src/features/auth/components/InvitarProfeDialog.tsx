'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
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
import { invitarProfe } from '@/features/auth/actions/invitar-profe'
import { invitarProfeSchema, type InvitarProfeInput } from '@/features/auth/schemas/invitation'
import { TIPO_PERSONAL_AULA } from '@/features/profes-aulas/types'

interface Props {
  locale: string
  aulas: Array<{ id: string; nombre: string }>
}

/**
 * F11-C-1 — "Invitar profe": la dirección invita a un profesor nuevo (nombre,
 * email, aula y tipo de personal). El selector de tipo se construye desde el
 * ENUM `TIPO_PERSONAL_AULA` (no se hardcodea). Al aceptar, el profe completa su
 * alta (contraseña, idioma, acuse, foto) — eso es el flujo accept (F11-C-2).
 */
export function InvitarProfeDialog({ locale, aulas }: Props) {
  const t = useTranslations('admin.personal.invitar')
  const tTipos = useTranslations('admin.personal.tipo_personal')
  const tErrors = useTranslations()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const form = useForm<InvitarProfeInput>({
    resolver: zodResolver(invitarProfeSchema),
    defaultValues: {
      nombreCompleto: '',
      email: '',
      aulaId: '',
      tipoPersonalAula: 'profesora',
    },
  })

  function onSubmit(values: InvitarProfeInput) {
    startTransition(async () => {
      const r = await invitarProfe(values, locale)
      if (r.success) {
        toast.success(t('ok'))
        form.reset()
        setOpen(false)
        router.refresh()
      } else {
        toast.error(tErrors(r.error))
      }
    })
  }

  const aulaItems = aulas.map((a) => ({ value: a.id, label: a.nombre }))
  const tipoItems = TIPO_PERSONAL_AULA.map((tp) => ({ value: tp, label: tTipos(tp) }))

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button>{t('cta')}</Button>} />
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
            <FormField
              control={form.control}
              name="nombreCompleto"
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
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('fields.email')}</FormLabel>
                  <FormControl>
                    <Input type="email" autoComplete="off" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="aulaId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('fields.aula')}</FormLabel>
                  <Select
                    items={aulaItems}
                    onValueChange={field.onChange}
                    value={field.value || undefined}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t('fields.aula_placeholder')} />
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
            <FormField
              control={form.control}
              name="tipoPersonalAula"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('fields.tipo_personal')}</FormLabel>
                  <Select items={tipoItems} onValueChange={field.onChange} value={field.value}>
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
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t('cancel')}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? t('enviando') : t('enviar')}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
