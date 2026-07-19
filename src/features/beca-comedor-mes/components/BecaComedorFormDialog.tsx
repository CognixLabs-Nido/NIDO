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

import { guardarBecaComedorMes } from '../actions/beca-comedor-mes'
import { becaComedorMesSchema, type BecaComedorMesInput } from '../schemas/beca-comedor-mes'

interface Props {
  nino: { id: string; nombre: string }
  anio: number
  mes: number
  /** Importe actual en EUROS si el niño ya tiene beca este mes (→ edición); undefined = alta. */
  importeEuros?: number
  trigger: ReactElement
}

export function BecaComedorFormDialog({ nino, anio, mes, importeEuros, trigger }: Props) {
  const t = useTranslations('admin.cuotas')
  const tErrors = useTranslations()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const esEdicion = importeEuros != null

  const form = useForm<BecaComedorMesInput>({
    resolver: zodResolver(becaComedorMesSchema),
    defaultValues: {
      nino_id: nino.id,
      anio,
      mes,
      importe_euros: importeEuros ?? NaN,
    },
  })

  function onSubmit(values: BecaComedorMesInput) {
    startTransition(async () => {
      const r = await guardarBecaComedorMes(values)
      if (r.success) {
        toast.success(t('beca_comedor.saved'))
        setOpen(false)
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
          <DialogTitle>
            {esEdicion
              ? t('beca_comedor.editar_title', { nombre: nino.nombre })
              : t('beca_comedor.nueva_title', { nombre: nino.nombre })}
          </DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
            <FormField
              control={form.control}
              name="importe_euros"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('beca_comedor.importe_label')}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={0}
                      step={0.01}
                      inputMode="decimal"
                      autoFocus
                      value={Number.isNaN(field.value) ? '' : field.value}
                      onChange={(e) =>
                        field.onChange(e.target.value === '' ? NaN : Number(e.target.value))
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <p className="text-muted-foreground text-xs">{t('beca_comedor.note_regenerar')}</p>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t('cancel')}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? t('saving') : esEdicion ? t('save_edit') : t('save_new')}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
