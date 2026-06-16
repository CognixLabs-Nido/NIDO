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
import { invitarFamiliaConEsqueleto } from '@/features/auth/actions/invitar-familia-con-esqueleto'
import {
  invitarFamiliaConEsqueletoSchema,
  type InvitarFamiliaConEsqueletoInput,
} from '@/features/auth/schemas/invitation'

interface Props {
  locale: string
  aulas: Array<{ id: string; nombre: string }>
}

/**
 * Pieza 2b — "Invitar familia": la dirección crea un esqueleto de niño + matrícula
 * pendiente + invitación al tutor en un paso. Coexiste con NuevoNinoWizard (alta
 * admin completa).
 */
export function InvitarFamiliaDialog({ locale, aulas }: Props) {
  const t = useTranslations('admin.ninos.invitar')
  const tErrors = useTranslations()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const form = useForm<InvitarFamiliaConEsqueletoInput>({
    resolver: zodResolver(invitarFamiliaConEsqueletoSchema),
    defaultValues: {
      nombreNino: '',
      aulaId: '',
      email: '',
      tipoVinculo: 'tutor_legal_principal',
    },
  })

  function onSubmit(values: InvitarFamiliaConEsqueletoInput) {
    startTransition(async () => {
      const r = await invitarFamiliaConEsqueleto(values, locale)
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

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline">{t('cta')}</Button>} />
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
            <FormField
              control={form.control}
              name="nombreNino"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('fields.nombre_nino')}</FormLabel>
                  <FormControl>
                    <Input {...field} />
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
                  <Select onValueChange={field.onChange} value={field.value || undefined}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t('fields.aula_placeholder')} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {aulas.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.nombre}
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
              name="tipoVinculo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('fields.tipo_vinculo')}</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="tutor_legal_principal">
                        {t('tipo_vinculo.principal')}
                      </SelectItem>
                      <SelectItem value="tutor_legal_secundario">
                        {t('tipo_vinculo.secundario')}
                      </SelectItem>
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
