'use client'

import { type ReactElement, useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { CheckCircle2Icon } from 'lucide-react'
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

import { guardarDatosAcreedor } from '../actions/guardar-datos-acreedor'
import type { DatosAcreedorConfig } from '../queries/get-datos-acreedor'
import { datosAcreedorSchema, type DatosAcreedorInput } from '../schemas/remesa'

interface Props {
  config: DatosAcreedorConfig
  trigger: ReactElement
}

/**
 * Config del acreedor SEPA (pantalla siempre editable por dirección). CID y BIC se
 * muestran y editan directamente. El IBAN va cifrado: NO se muestra guardado; para
 * cambiarlo se reintroduce completo. "IBAN configurado ✓" indica que hay uno sin
 * revelarlo (dejar vacío = conservar el existente).
 */
export function DatosAcreedorDialog({ config, trigger }: Props) {
  const t = useTranslations('remesas')
  const tErrors = useTranslations()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const form = useForm<DatosAcreedorInput>({
    resolver: zodResolver(datosAcreedorSchema),
    defaultValues: {
      identificador_acreedor: config.identificadorAcreedor ?? '',
      bic_acreedor: config.bicAcreedor ?? '',
      iban: '',
    },
  })

  function onSubmit(values: DatosAcreedorInput) {
    startTransition(async () => {
      const r = await guardarDatosAcreedor(values)
      if (r.success) {
        toast.success(t('acreedor_guardado'))
        form.reset({ ...values, iban: '' })
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
          <DialogTitle>{t('acreedor_title')}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
            <FormField
              control={form.control}
              name="identificador_acreedor"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('fields.identificador_acreedor')}</FormLabel>
                  <FormControl>
                    <Input {...field} maxLength={35} placeholder="ES00ZZZ00000000000" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="bic_acreedor"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('fields.bic_acreedor')}</FormLabel>
                  <FormControl>
                    <Input {...field} maxLength={11} placeholder="BSCHESMMXXX" />
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
                  <FormLabel>{t('fields.iban_acreedor')}</FormLabel>
                  {config.ibanConfigurado && (
                    <p className="flex items-center gap-1 text-sm text-emerald-600">
                      <CheckCircle2Icon className="size-4" />
                      {t('iban_configurado')}
                    </p>
                  )}
                  <FormControl>
                    <Input
                      {...field}
                      maxLength={34}
                      autoComplete="off"
                      placeholder={config.ibanConfigurado ? t('iban_cambiar_placeholder') : 'ES...'}
                    />
                  </FormControl>
                  <p className="text-muted-foreground text-xs">{t('iban_ayuda')}</p>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t('cancel')}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? t('guardando') : t('guardar')}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
