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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'

import { gestionarDomiciliacionFamilia } from '../actions/gestionar-domiciliacion-familia'
import {
  domiciliacionFamiliaSchema,
  type DomiciliacionFamiliaInput,
} from '../schemas/domiciliacion'

/**
 * F-2c-3 — diálogo de Dirección para REGISTRAR (1º) o SUSTITUIR la domiciliación SEPA de una
 * familia en modo PRESENCIAL (la familia firmó en papel; sin PDF ni trazo). Mismo formulario
 * para ambos; la action decide registrar vs sustituir según la familia tenga o no mandato.
 */
export function DomiciliacionDialog({
  familiaId,
  titularInicial,
  trigger,
}: {
  familiaId: string
  /** Prefill del titular (el actual, al sustituir); vacío al registrar el 1º. */
  titularInicial?: string | null
  trigger: ReactElement
}) {
  const t = useTranslations('admin.familias.domiciliacion')
  const tErrors = useTranslations()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const form = useForm<DomiciliacionFamiliaInput>({
    resolver: zodResolver(domiciliacionFamiliaSchema),
    defaultValues: { familia_id: familiaId, iban: '', titular: titularInicial ?? '' },
  })

  function onSubmit(values: DomiciliacionFamiliaInput) {
    startTransition(async () => {
      const r = await gestionarDomiciliacionFamilia(values)
      if (r.success) {
        toast.success(t('guardado'))
        setOpen(false)
        form.reset({ familia_id: familiaId, iban: '', titular: values.titular })
        router.refresh()
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
          <DialogTitle>{t('dialog_titulo')}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
            <p className="border-accent-warm-300 bg-accent-warm-50 text-accent-warm-800 rounded-lg border p-3 text-sm">
              {t('presencial_nota')}
            </p>
            <FormField
              control={form.control}
              name="titular"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('titular')}</FormLabel>
                  <FormControl>
                    <Input {...field} maxLength={140} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="iban"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('iban')}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      placeholder="ES00 0000 0000 0000 0000 0000"
                      autoComplete="off"
                    />
                  </FormControl>
                  <FormDescription>{t('iban_ayuda')}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t('cancelar')}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? t('guardando') : t('confirmar')}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
