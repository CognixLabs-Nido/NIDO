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

import { registrarGastosDevolucion } from '../actions/registrar-gastos-devolucion'
import { gastosDevolucionSchema, type GastosDevolucionInput } from '../schemas/remesa'

const METODOS = ['sepa', 'efectivo', 'transferencia'] as const

interface Props {
  reciboId: string
  trigger: ReactElement
}

/** Registra los gastos de devolución que cobra el banco (recibo esporádico). */
export function GastosDevolucionDialog({ reciboId, trigger }: Props) {
  const t = useTranslations('remesas')
  const tErrors = useTranslations()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const form = useForm<GastosDevolucionInput>({
    resolver: zodResolver(gastosDevolucionSchema),
    defaultValues: { reciboId, importe_euros: 0, metodo: 'sepa' },
  })

  function onSubmit(values: GastosDevolucionInput) {
    startTransition(async () => {
      const r = await registrarGastosDevolucion(values)
      if (r.success) {
        toast.success(t('gastos_ok'))
        form.reset({ reciboId, importe_euros: 0, metodo: 'sepa' })
        setOpen(false)
      } else {
        toast.error(tErrors(r.error))
      }
    })
  }

  const metodoItems = METODOS.map((value) => ({ value, label: t(`metodos.${value}`) }))

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{t('gastos_title')}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
            <FormField
              control={form.control}
              name="importe_euros"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('fields.importe_gastos')}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      step={0.01}
                      inputMode="decimal"
                      value={field.value === 0 || Number.isNaN(field.value) ? '' : field.value}
                      onChange={(e) =>
                        field.onChange(e.target.value === '' ? 0 : Number(e.target.value))
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="metodo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('fields.metodo')}</FormLabel>
                  <Select items={metodoItems} value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {metodoItems.map((item) => (
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
                {pending ? t('guardando') : t('guardar')}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
