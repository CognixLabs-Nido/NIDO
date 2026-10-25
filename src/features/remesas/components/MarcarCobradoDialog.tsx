'use client'

import { type ReactElement, useMemo, useState, useTransition } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useLocale, useTranslations } from 'next-intl'

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
import { centimosAEuros, eurosACentimos, formatEuros } from '@/shared/lib/format-money'

import { cobrarConCheque } from '../actions/cobrar-con-cheque'
import { marcarCobradoManual } from '../actions/marcar-cobrado-manual'
import {
  FORMAS_COBRO_MANUAL,
  METODOS_DIFERENCIA,
  crearCobroDialogSchema,
  type CobroDialogInput,
} from '../schemas/remesa'

interface Props {
  reciboId: string
  /** «Familia · importe», para que se vea qué se cobra. */
  descripcion: string
  /** Total del recibo: el importe del cheque se compara con él. */
  totalCentimos: number
  /** La forma que se propone (la del método del recibo, si se cobra a mano). */
  formaPorDefecto: (typeof FORMAS_COBRO_MANUAL)[number]
  /** ¿Puede ir la diferencia de un cheque al banco? Solo con mandato SEPA activo. */
  permiteSepa: boolean
  /** Hoy en Madrid (YYYY-MM-DD): la fecha por defecto y el máximo. */
  hoy: string
  trigger: ReactElement
}

/**
 * «Marcar cobrado»: forma, fecha (por defecto hoy) y nota opcional (PR-1a). Con cheque guardería /
 * ticket restaurant pide además el importe del cheque y, si no cubre el recibo, cómo se cobra lo
 * que queda, que va a un recibo aparte (PR-1b). Si lo supera, avisa de que el sobrante queda
 * pendiente (PR-1c). El error se enseña dentro del diálogo, junto al formulario que lo causó.
 */
export function MarcarCobradoDialog({
  reciboId,
  descripcion,
  totalCentimos,
  formaPorDefecto,
  permiteSepa,
  hoy,
  trigger,
}: Props) {
  const t = useTranslations('remesas')
  const tErrors = useTranslations()
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const valoresIniciales: CobroDialogInput = {
    reciboId,
    forma: formaPorDefecto,
    fecha: hoy,
    nota: '',
    importe_euros: centimosAEuros(totalCentimos),
    metodoDiferencia: undefined,
  }
  const schema = useMemo(() => crearCobroDialogSchema(totalCentimos), [totalCentimos])
  const form = useForm<CobroDialogInput>({
    resolver: zodResolver(schema),
    defaultValues: valoresIniciales,
  })
  const forma = useWatch({ control: form.control, name: 'forma' })
  const importe = useWatch({ control: form.control, name: 'importe_euros' })
  const conCheque = forma === 'cheque_guarderia'
  const diferenciaCentimos =
    conCheque && importe !== undefined && Number.isFinite(importe)
      ? totalCentimos - eurosACentimos(importe)
      : 0

  function onOpenChange(abierto: boolean) {
    setOpen(abierto)
    if (abierto) {
      setError(null)
      form.reset(valoresIniciales)
    }
  }

  function onSubmit(values: CobroDialogInput) {
    setError(null)
    startTransition(async () => {
      const r =
        values.forma === 'cheque_guarderia'
          ? await cobrarConCheque({
              reciboId: values.reciboId,
              importe_euros: values.importe_euros ?? 0,
              fecha: values.fecha,
              nota: values.nota,
              metodoDiferencia: diferenciaCentimos > 0 ? values.metodoDiferencia : undefined,
            })
          : await marcarCobradoManual({
              reciboId: values.reciboId,
              forma: values.forma,
              fecha: values.fecha,
              nota: values.nota,
            })
      if (r.success) setOpen(false)
      else setError(tErrors(r.error))
    })
  }

  const formaItems = FORMAS_COBRO_MANUAL.map((value) => ({
    value,
    label: t(`forma_cobro.${value}`),
  }))
  const metodoItems = METODOS_DIFERENCIA.filter((m) => m !== 'sepa' || permiteSepa).map(
    (value) => ({ value, label: t(`cobro_dialog.metodos_diferencia.${value}`) })
  )

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

            {conCheque && (
              <FormField
                control={form.control}
                name="importe_euros"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('cobro_dialog.importe_cheque')}</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        step={0.01}
                        inputMode="decimal"
                        value={
                          field.value === undefined || Number.isNaN(field.value) ? '' : field.value
                        }
                        onChange={(e) =>
                          field.onChange(e.target.value === '' ? undefined : Number(e.target.value))
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {conCheque && diferenciaCentimos < 0 && (
              <p className="text-muted-foreground text-xs">
                {t('cobro_dialog.sobrante_pendiente', {
                  importe: formatEuros(-diferenciaCentimos, locale),
                })}
              </p>
            )}

            {conCheque && diferenciaCentimos > 0 && (
              <FormField
                control={form.control}
                name="metodoDiferencia"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {t('cobro_dialog.metodo_diferencia', {
                        importe: formatEuros(diferenciaCentimos, locale),
                      })}
                    </FormLabel>
                    <Select
                      items={metodoItems}
                      value={field.value ?? null}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={t('cobro_dialog.elige_metodo')} />
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
                    <p className="text-muted-foreground text-xs">
                      {permiteSepa
                        ? t('cobro_dialog.diferencia_aparte')
                        : t('cobro_dialog.diferencia_sin_mandato')}
                    </p>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

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
