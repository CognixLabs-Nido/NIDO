'use client'

import { useState, useTransition } from 'react'
import { useForm, Controller } from 'react-hook-form'
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
import { Textarea } from '@/components/ui/textarea'

import { createAula } from '../actions/create-aula'
import { aulaSchema, type AulaInput } from '../schemas/aula'

const ANIOS = [2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027, 2028, 2029, 2030]

interface Props {
  centroId: string
  cursoAcademicoId: string
}

export function NuevaAulaDialog({ centroId, cursoAcademicoId }: Props) {
  const t = useTranslations('admin.aulas')
  const tErrors = useTranslations()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const form = useForm<AulaInput>({
    resolver: zodResolver(aulaSchema),
    defaultValues: {
      nombre: '',
      cohorte_anos_nacimiento: [],
      descripcion: '',
      capacidad_maxima: 12,
    },
  })

  function onSubmit(values: AulaInput) {
    startTransition(async () => {
      const r = await createAula(centroId, cursoAcademicoId, values)
      if (r.success) {
        toast.success(t('created'))
        form.reset()
        setOpen(false)
      } else {
        toast.error(tErrors(r.error))
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button>{t('nueva')}</Button>} />
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t('nueva_title')}</DialogTitle>
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
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormItem>
              <FormLabel>{t('fields.cohorte')}</FormLabel>
              <Controller
                control={form.control}
                name="cohorte_anos_nacimiento"
                render={({ field, fieldState }) => (
                  <div className="space-y-2">
                    <div className="grid grid-cols-4 gap-2">
                      {ANIOS.map((a) => {
                        const checked = field.value.includes(a)
                        return (
                          <label key={a} className="flex items-center gap-1.5 text-sm">
                            <Checkbox
                              checked={checked}
                              onCheckedChange={(c) => {
                                if (c === true) field.onChange([...field.value, a].sort())
                                else field.onChange(field.value.filter((x) => x !== a))
                              }}
                            />
                            {a}
                          </label>
                        )
                      })}
                    </div>
                    {fieldState.error && (
                      <p className="text-destructive text-xs">
                        {tErrors(fieldState.error.message ?? '')}
                      </p>
                    )}
                  </div>
                )}
              />
            </FormItem>
            <FormField
              control={form.control}
              name="capacidad_maxima"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('fields.capacidad')}</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      min={1}
                      max={40}
                      value={field.value}
                      onChange={(e) => field.onChange(Number(e.target.value))}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="descripcion"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('fields.descripcion')}</FormLabel>
                  <FormControl>
                    <Textarea {...field} value={field.value ?? ''} rows={2} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                {t('cancel')}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? t('saving') : t('save')}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
