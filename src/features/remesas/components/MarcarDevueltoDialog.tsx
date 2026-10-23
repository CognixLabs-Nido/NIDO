'use client'

import { type ReactElement, useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

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

import { marcarReciboDevuelto } from '../actions/marcar-recibo-devuelto'
import { marcarReciboDevueltoSchema, type MarcarReciboDevueltoInput } from '../schemas/remesa'

interface Props {
  reciboId: string
  /** «Familia · importe», para que se vea qué se devuelve. */
  descripcion: string
  /** Fecha del envío al banco: la devolución no puede ser anterior. */
  fechaEnvio: string | null
  /** Hoy en Madrid (YYYY-MM-DD): la fecha por defecto y el máximo. */
  hoy: string
  trigger: ReactElement
}

/**
 * «Marcar devuelto» (PR-2): la fecha que dice el banco (por defecto hoy) y los gastos que cobra,
 * 0 si no hay. Los gastos se cobran después junto al recibo, en la salida que se elija.
 */
export function MarcarDevueltoDialog({ reciboId, descripcion, fechaEnvio, hoy, trigger }: Props) {
  const t = useTranslations('remesas')
  const tErrors = useTranslations()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const valoresIniciales: MarcarReciboDevueltoInput = { reciboId, fecha: hoy, gastos_euros: 0 }
  const form = useForm<MarcarReciboDevueltoInput>({
    resolver: zodResolver(marcarReciboDevueltoSchema),
    defaultValues: valoresIniciales,
  })

  function onOpenChange(abierto: boolean) {
    setOpen(abierto)
    if (abierto) {
      setError(null)
      form.reset(valoresIniciales)
    }
  }

  function onSubmit(values: MarcarReciboDevueltoInput) {
    setError(null)
    startTransition(async () => {
      const r = await marcarReciboDevuelto(values)
      if (r.success) {
        toast.success(t('devuelto_ok'))
        setOpen(false)
      } else setError(tErrors(r.error))
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{t('devuelto_dialog.titulo')}</DialogTitle>
          <DialogDescription>{descripcion}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
            <FormField
              control={form.control}
              name="fecha"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('devuelto_dialog.fecha')}</FormLabel>
                  <FormControl>
                    <Input type="date" min={fechaEnvio ?? undefined} max={hoy} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="gastos_euros"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('devuelto_dialog.gastos')}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      step={0.01}
                      inputMode="decimal"
                      value={Number.isNaN(field.value) ? '' : field.value}
                      onChange={(e) =>
                        field.onChange(e.target.value === '' ? Number.NaN : Number(e.target.value))
                      }
                    />
                  </FormControl>
                  <p className="text-muted-foreground text-xs">
                    {t('devuelto_dialog.gastos_ayuda')}
                  </p>
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
                {t('devuelto_dialog.cancelar')}
              </Button>
              <Button type="submit" disabled={pending}>
                {t('devuelto_dialog.guardar')}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
