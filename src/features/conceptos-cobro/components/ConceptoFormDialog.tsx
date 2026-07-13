'use client'

import { type ReactElement, useState, useTransition } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { centimosAEuros } from '@/shared/lib/format-money'

import { actualizarConcepto } from '../actions/actualizar-concepto'
import { crearConcepto } from '../actions/crear-concepto'
import {
  AMBITOS,
  conceptoCobroSchema,
  SERVICIOS_DIARIOS,
  TIPOS_CONCEPTO,
  TIPOS_VALOR,
  type ConceptoCobroInput,
} from '../schemas/concepto-cobro'
import type { ConceptoCobroListItem } from '../queries/get-conceptos-cobro'

interface Props {
  centroId: string
  /** Si viene, el diálogo edita ese concepto; si no, crea uno nuevo. */
  concepto?: ConceptoCobroListItem
  /** Catálogo del centro (para el selector de concepto base de un descuento porcentual). */
  conceptos: ConceptoCobroListItem[]
  trigger: ReactElement
}

export function ConceptoFormDialog({ centroId, concepto, conceptos, trigger }: Props) {
  const t = useTranslations('admin.cuotas')
  const tErrors = useTranslations()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const esEdicion = concepto != null

  const form = useForm<ConceptoCobroInput>({
    resolver: zodResolver(conceptoCobroSchema),
    defaultValues: {
      nombre: concepto?.nombre ?? '',
      signo: concepto?.signo === -1 ? -1 : 1,
      tipo_valor: (concepto?.tipo_valor as 'fijo' | 'porcentaje') ?? 'fijo',
      tipo_concepto: concepto?.tipo_concepto ?? 'mensual',
      ambito: (concepto?.ambito as 'nino' | 'familia') ?? 'nino',
      importe_euros:
        concepto?.importe_centimos != null ? centimosAEuros(concepto.importe_centimos) : null,
      porcentaje: concepto?.porcentaje_bp != null ? concepto.porcentaje_bp / 100 : null,
      servicio: concepto?.servicio ?? null,
      concepto_base_id: concepto?.concepto_base_id ?? null,
      activo: concepto?.activo ?? true,
    },
  })

  const signo = useWatch({ control: form.control, name: 'signo' })
  const tipoValor = useWatch({ control: form.control, name: 'tipo_valor' })
  const tipoConcepto = useWatch({ control: form.control, name: 'tipo_concepto' })
  const esDiario = tipoConcepto === 'diario'
  const esPorcentaje = tipoValor === 'porcentaje'
  const esDescuentoPorcentual = Number(signo) === -1 && esPorcentaje

  const signoItems = [
    { value: '1', label: t('signos.cobro') },
    { value: '-1', label: t('signos.descuento') },
  ]
  const valorItems = TIPOS_VALOR.map((value) => ({ value, label: t(`valores.${value}`) }))
  const tipoItems = TIPOS_CONCEPTO.map((value) => ({ value, label: t(`tipos.${value}`) }))
  const ambitoItems = AMBITOS.map((value) => ({ value, label: t(`ambitos.${value}`) }))
  const servicioItems = SERVICIOS_DIARIOS.map((value) => ({
    value,
    label: t(`servicios.${value}`),
  }))
  // Base: cualquier concepto del centro salvo el que se edita (evita auto-referencia).
  const baseItems = conceptos
    .filter((c) => c.id !== concepto?.id)
    .map((c) => ({ value: c.id, label: c.nombre }))

  function onSubmit(values: ConceptoCobroInput) {
    startTransition(async () => {
      const r = esEdicion
        ? await actualizarConcepto(concepto.id, values)
        : await crearConcepto(centroId, values)
      if (r.success) {
        toast.success(esEdicion ? t('updated') : t('created'))
        if (!esEdicion) form.reset()
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
          <DialogTitle>{esEdicion ? t('editar_title') : t('nuevo_title')}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
            <FormField
              control={form.control}
              name="nombre"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('fields.nombre')}</FormLabel>
                  <FormControl>
                    <Input {...field} maxLength={120} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="signo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('fields.signo')}</FormLabel>
                  <Select
                    items={signoItems}
                    value={String(field.value)}
                    onValueChange={(v) => field.onChange(Number(v))}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {signoItems.map((item) => (
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
              name="tipo_valor"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('fields.tipo_valor')}</FormLabel>
                  <Select items={valorItems} value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {valorItems.map((item) => (
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

            {esPorcentaje ? (
              <FormField
                control={form.control}
                name="porcentaje"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('fields.porcentaje')}</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        step={0.01}
                        inputMode="decimal"
                        value={field.value == null || Number.isNaN(field.value) ? '' : field.value}
                        onChange={(e) =>
                          field.onChange(e.target.value === '' ? null : Number(e.target.value))
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : (
              <FormField
                control={form.control}
                name="importe_euros"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('fields.importe')}</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        step={0.01}
                        inputMode="decimal"
                        value={field.value == null || Number.isNaN(field.value) ? '' : field.value}
                        onChange={(e) =>
                          field.onChange(e.target.value === '' ? null : Number(e.target.value))
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <FormField
              control={form.control}
              name="tipo_concepto"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('fields.tipo')}</FormLabel>
                  <Select items={tipoItems} value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {tipoItems.map((item) => (
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

            {esDiario && (
              <FormField
                control={form.control}
                name="servicio"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('fields.servicio')}</FormLabel>
                    <Select
                      items={servicioItems}
                      value={field.value ?? undefined}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={t('fields.servicio_placeholder')} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {servicioItems.map((item) => (
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
            )}

            <FormField
              control={form.control}
              name="ambito"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('fields.ambito')}</FormLabel>
                  <Select items={ambitoItems} value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {ambitoItems.map((item) => (
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

            {esDescuentoPorcentual && (
              <FormField
                control={form.control}
                name="concepto_base_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('fields.concepto_base')}</FormLabel>
                    <Select
                      items={baseItems}
                      value={field.value ?? undefined}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={t('fields.concepto_base_placeholder')} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {baseItems.map((item) => (
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
            )}

            <FormField
              control={form.control}
              name="activo"
              render={({ field }) => (
                <FormItem>
                  <label className="flex items-center gap-2 text-sm">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={(c) => field.onChange(c === true)}
                      />
                    </FormControl>
                    {t('fields.activo')}
                  </label>
                  <FormMessage />
                </FormItem>
              )}
            />

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
