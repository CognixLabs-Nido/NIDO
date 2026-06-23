'use client'

import { useTransition } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
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

import { publicarAnuncio } from '../actions/publicar-anuncio'
import { anuncioInputSchema, type AnuncioInput } from '../schemas/messaging'
import type { AmbitoAnuncio } from '../types'

interface Props {
  locale: string
  /** Si rol = profe, se pasa fijo el aula activa del profe (single-item). */
  rolEsAdmin: boolean
  aulas: Array<{ id: string; nombre: string }>
}

/**
 * Composer del nuevo anuncio. Si el usuario es profe, se fuerza
 * ambito='aula' y el select de aula puede tener una sola opción (su
 * aula activa). Si es admin, puede elegir ámbito y, para 'aula',
 * cualquier aula del centro.
 */
export function AnuncioComposer({ locale, rolEsAdmin, aulas }: Props) {
  const t = useTranslations('messages.anuncio')
  const tValidation = useTranslations('messages.validation')
  const tErr = useTranslations('messages.errors')
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const defaultAulaId = !rolEsAdmin && aulas.length > 0 ? aulas[0]!.id : null

  const form = useForm<AnuncioInput>({
    resolver: zodResolver(anuncioInputSchema),
    defaultValues: {
      ambito: rolEsAdmin ? 'centro' : 'aula',
      aula_id: defaultAulaId,
      titulo: '',
      contenido: '',
    },
  })

  const ambito = useWatch({ control: form.control, name: 'ambito' })

  // `items` para Select.Root: la prop es obligatoria cuando el value no es ya
  // human-readable (UUIDs, enums opacos). Sin esto, Select.Value renderiza el
  // value crudo en el trigger cerrado. Ver docs/dev-setup.md "Select: prop
  // items obligatoria" y ADR-0007.
  const ambitoItems = [
    { value: 'centro', label: t('ambito_centro') },
    { value: 'aula', label: t('ambito_aula') },
  ]
  const aulaItems = aulas.map((a) => ({ value: a.id, label: a.nombre }))

  function onSubmit(values: AnuncioInput) {
    startTransition(async () => {
      const res = await publicarAnuncio(values)
      if (!res.success) {
        const fallbackKey = 'envio_fallo' as const
        if (res.error.startsWith('messages.validation.')) {
          toast.error(tValidation(res.error.replace('messages.validation.', '') as 'titulo_vacio'))
        } else if (res.error.startsWith('messages.errors.')) {
          const k = res.error.replace('messages.errors.', '') as
            | 'envio_fallo'
            | 'no_autorizado'
            | 'conexion'
          toast.error(tErr(k))
        } else {
          toast.error(tErr(fallbackKey))
        }
        return
      }
      toast.success(t('publicado_toast'))
      router.push(`/${locale}/messages/anuncios/${res.data.anuncio_id}`)
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-2xl font-semibold">{t('nuevo')}</h1>
      </header>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          {rolEsAdmin && (
            <FormField
              control={form.control}
              name="ambito"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('ambito_label')}</FormLabel>
                  <Select
                    items={ambitoItems}
                    value={field.value}
                    onValueChange={(v) => {
                      field.onChange(v as AmbitoAnuncio)
                      if (v === 'centro') form.setValue('aula_id', null)
                    }}
                  >
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
          )}

          {ambito === 'aula' && (
            <FormField
              control={form.control}
              name="aula_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('aula_label')}</FormLabel>
                  <Select
                    items={aulaItems}
                    value={field.value ?? ''}
                    onValueChange={(v) => field.onChange(v)}
                    disabled={!rolEsAdmin && aulas.length === 1}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t('aula_placeholder')} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {aulaItems.map((item) => (
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
            name="titulo"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('titulo_label')}</FormLabel>
                <FormControl>
                  <Input {...field} maxLength={200} placeholder={t('titulo_placeholder')} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="contenido"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('contenido_label')}</FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    rows={6}
                    maxLength={4000}
                    placeholder={t('contenido_placeholder')}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button type="submit" disabled={pending}>
            {pending ? t('publicando') : t('publicar')}
          </Button>
        </form>
      </Form>
    </div>
  )
}
