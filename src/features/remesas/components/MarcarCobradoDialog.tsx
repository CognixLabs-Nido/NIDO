'use client'

import { type ReactElement, useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Textarea } from '@/components/ui/textarea'

import { marcarCobradoManual } from '../actions/marcar-cobrado-manual'
import {
  FORMAS_COBRO_MANUAL,
  marcarCobradoManualSchema,
  type MarcarCobradoManualInput,
} from '../schemas/remesa'

interface Props {
  reciboId: string
  /** «Familia · importe», para que se vea qué se cobra. */
  descripcion: string
  /** La forma que se propone (la del método del recibo, si es efectivo o transferencia). */
  formaPorDefecto: (typeof FORMAS_COBRO_MANUAL)[number]
  /** Hoy en Madrid (YYYY-MM-DD): la fecha por defecto y el máximo. */
  hoy: string
  trigger: ReactElement
}

/**
 * «Marcar cobrado» (PR-1a): forma, fecha (por defecto hoy) y nota opcional. El error se enseña
 * dentro del diálogo: la app no monta un Toaster, así que un toast no se vería.
 */
export function MarcarCobradoDialog({
  reciboId,
  descripcion,
  formaPorDefecto,
  hoy,
  trigger,
}: Props) {
  const t = useTranslations('remesas')
  const tErrors = useTranslations()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const valoresIniciales: MarcarCobradoManualInput = {
    reciboId,
    forma: formaPorDefecto,
    fecha: hoy,
    nota: '',
  }
  const form = useForm<MarcarCobradoManualInput>({
    resolver: zodResolver(marcarCobradoManualSchema),
    defaultValues: valoresIniciales,
  })

  function onOpenChange(abierto: boolean) {
    setOpen(abierto)
    if (abierto) {
      setError(null)
      form.reset(valoresIniciales)
    }
  }

  function onSubmit(values: MarcarCobradoManualInput) {
    setError(null)
    startTransition(async () => {
      const r = await marcarCobradoManual(values)
      if (r.success) setOpen(false)
      else setError(tErrors(r.error))
    })
  }

  const formaItems = FORMAS_COBRO_MANUAL.map((value) => ({
    value,
    label: t(`forma_cobro.${value}`),
  }))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{t('cobro_dialog.titulo')}</DialogTitle>
          <DialogDescription>{descripcion}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
            <FormField
              control={form.control}
              name="forma"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('cobro_dialog.forma')}</FormLabel>
                  <Select items={formaItems} value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {formaItems.map((item) => (
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
              name="fecha"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('cobro_dialog.fecha')}</FormLabel>
                  <FormControl>
                    <Input type="date" max={hoy} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="nota"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('cobro_dialog.nota')}</FormLabel>
                  <FormControl>
                    <Textarea rows={2} maxLength={500} {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {error && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t('cobro_dialog.cancelar')}
              </Button>
              <Button type="submit" disabled={pending}>
                {t('cobro_dialog.guardar')}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
