'use client'

import { type ReactElement, useState, useTransition } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useLocale, useTranslations } from 'next-intl'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { formatEuros } from '@/shared/lib/format-money'

import { resolverDevolucion } from '../actions/resolver-devolucion'
import { arrastreOfrecido, etiquetaMes, type DestinoArrastre } from '../lib/gestion-cobros'
import {
  SALIDAS_DEVOLUCION,
  resolverDevolucionSchema,
  salidaConCobro,
  type ResolverDevolucionInput,
} from '../schemas/remesa'

interface Props {
  reciboId: string
  /** «Familia · importe», para que se vea qué se resuelve. */
  descripcion: string
  /** Total del recibo devuelto y gastos de la devolución: la salida cobra la suma. */
  totalCentimos: number
  gastosCentimos: number
  /** Fecha de la devolución: el cobro no puede ser anterior. */
  fechaDevolucion: string | null
  /** ¿Puede volver al banco? Solo con mandato SEPA activo. */
  permiteSepa: boolean
  /**
   * PR-14: adónde iría llevada al siguiente recibo (el mes siguiente). Si ese recibo ya está
   * validado, o el mes cerrado sin recibo, la salida no se ofrece y se dice por qué.
   */
  arrastre: DestinoArrastre | null
  /** Hoy en Madrid (YYYY-MM-DD): la fecha por defecto y el máximo. */
  hoy: string
  trigger: ReactElement
}

/**
 * «Resolver devolución» (PR-2): UNA sola salida, por el recibo más los gastos. Volver a pasarlo por
 * el banco crea un re-giro que entra en la siguiente remesa del mes; efectivo o transferencia lo
 * dejan cobrado, con su fecha y una nota opcional; llevarlo al siguiente recibo (PR-14) añade una
 * línea al recibo del mes siguiente de la familia, que se crea si no lo tiene. Una segunda salida la
 * rechaza la BD.
 */
export function ResolverDevolucionDialog({
  reciboId,
  descripcion,
  totalCentimos,
  gastosCentimos,
  fechaDevolucion,
  permiteSepa,
  arrastre,
  hoy,
  trigger,
}: Props) {
  const t = useTranslations('remesas')
  const tErrors = useTranslations()
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const valoresIniciales: ResolverDevolucionInput = {
    reciboId,
    salida: permiteSepa ? 'banco' : 'efectivo',
    fecha: hoy,
    nota: '',
  }
  const form = useForm<ResolverDevolucionInput>({
    resolver: zodResolver(resolverDevolucionSchema),
    defaultValues: valoresIniciales,
  })
  const salida = useWatch({ control: form.control, name: 'salida' })
  const conCobro = salidaConCobro(salida)
  const aCobrar = formatEuros(totalCentimos + gastosCentimos, locale)

  function onOpenChange(abierto: boolean) {
    setOpen(abierto)
    if (abierto) {
      setError(null)
      form.reset(valoresIniciales)
    }
  }

  function onSubmit(values: ResolverDevolucionInput) {
    setError(null)
    startTransition(async () => {
      const r = await resolverDevolucion(values)
      if (r.success) {
        toast.success(t('resuelta_ok'))
        setOpen(false)
      } else setError(tErrors(r.error))
    })
  }

  // Qué pasa al llevarla al siguiente recibo, o por qué no se puede: una frase por caso.
  function textoArrastre(d: DestinoArrastre): string {
    const valores = { importe: aCobrar, mes: etiquetaMes(d.mes, locale) }
    switch (d.tipo) {
      case 'anadir':
        return t('resolver_dialog.siguiente_ayuda', valores)
      case 'crear':
        return t('resolver_dialog.siguiente_ayuda_crear_x', valores)
      case 'recibo_cerrado':
        return t('resolver_dialog.recibo_siguiente_cerrado', valores)
      case 'mes_cerrado':
        return t('resolver_dialog.mes_siguiente_cerrado', valores)
    }
  }

  const salidaItems = SALIDAS_DEVOLUCION.filter(
    (s) =>
      (s !== 'banco' || permiteSepa) &&
      (s !== 'siguiente_recibo' || (arrastre !== null && arrastreOfrecido(arrastre)))
  ).map((value) => ({ value, label: t(`resolver_dialog.salidas.${value}`) }))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={trigger} />
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{t('resolver_dialog.titulo')}</DialogTitle>
          <DialogDescription>{descripcion}</DialogDescription>
        </DialogHeader>
        <p className="text-sm">
          {gastosCentimos > 0
            ? t('resolver_dialog.a_cobrar_con_gastos', {
                total: aCobrar,
                recibo: formatEuros(totalCentimos, locale),
                gastos: formatEuros(gastosCentimos, locale),
              })
            : t('resolver_dialog.a_cobrar', { total: aCobrar })}
        </p>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
            <FormField
              control={form.control}
              name="salida"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('resolver_dialog.salida')}</FormLabel>
                  <Select items={salidaItems} value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {salidaItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-muted-foreground text-xs">
                    {salida === 'banco'
                      ? t('resolver_dialog.banco_ayuda', { importe: aCobrar })
                      : salida === 'siguiente_recibo' && arrastre
                        ? textoArrastre(arrastre)
                        : !permiteSepa
                          ? t('resolver_dialog.sin_mandato')
                          : null}
                  </p>
                  {arrastre && !arrastreOfrecido(arrastre) && (
                    <p className="text-muted-foreground text-xs">{textoArrastre(arrastre)}</p>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            {conCobro && (
              <FormField
                control={form.control}
                name="fecha"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('resolver_dialog.fecha')}</FormLabel>
                    <FormControl>
                      <Input
                        type="date"
                        min={fechaDevolucion ?? undefined}
                        max={hoy}
                        {...field}
                        value={field.value ?? ''}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {conCobro && (
              <FormField
                control={form.control}
                name="nota"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('resolver_dialog.nota')}</FormLabel>
                    <FormControl>
                      <Textarea rows={2} maxLength={500} {...field} value={field.value ?? ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <p className="text-muted-foreground text-xs">{t('resolver_dialog.una_vez')}</p>

            {error && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t('resolver_dialog.cancelar')}
              </Button>
              <Button type="submit" disabled={pending}>
                {t('resolver_dialog.guardar')}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
