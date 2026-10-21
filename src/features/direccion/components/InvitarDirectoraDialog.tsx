'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
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
import { IDIOMAS_CORREO } from '@/features/auth/schemas/invitation'

import { invitarDirectora } from '../actions/gestionar-direccion'
import { invitarDirectoraSchema, type InvitarDirectoraInput } from '../schemas/direccion'

/** La admin invita a una directora por correo (también a quien ya tiene cuenta en NIDO). */
export function InvitarDirectoraDialog({ centroId }: { centroId: string }) {
  const t = useTranslations('admin.direccion.invitar')
  const tIdioma = useTranslations('auth.invitation.idioma_correo')
  const tErrors = useTranslations()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const form = useForm<InvitarDirectoraInput>({
    resolver: zodResolver(invitarDirectoraSchema),
    defaultValues: { email: '', idioma: 'es' },
  })

  function onSubmit(values: InvitarDirectoraInput) {
    startTransition(async () => {
      const r = await invitarDirectora(values, centroId)
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

  const idiomaItems = IDIOMAS_CORREO.map((i) => ({ value: i, label: tIdioma(i) }))

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button>{t('cta')}</Button>} />
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">{t('texto')}</p>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('email')}</FormLabel>
                  <FormControl>
                    <Input type="email" autoComplete="off" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="idioma"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{tIdioma('label')}</FormLabel>
                  <Select items={idiomaItems} onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {idiomaItems.map((item) => (
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
                {t('cancelar')}
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
