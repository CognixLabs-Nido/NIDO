'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useTransition } from 'react'
import { useForm } from 'react-hook-form'
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
import { actualizarNinoTutor } from '@/features/ninos/actions/actualizar-nino-tutor'
import {
  actualizarNinoTutorSchema,
  type ActualizarNinoTutorInput,
} from '@/features/ninos/schemas/nino'

export interface IdentidadInicial {
  apellidos: string | null
  fecha_nacimiento: string | null
  sexo: 'F' | 'M' | 'X' | null
  nacionalidad: string | null
  idioma_principal: string
}

interface Props {
  ninoId: string
  inicial: IdentidadInicial
  onNext: () => void
}

function idiomaValido(v: string): 'es' | 'en' | 'va' {
  return v === 'en' || v === 'va' ? v : 'es'
}

/**
 * Paso 1 (OBLIGATORIO) — el tutor escribe la identidad de su hijo vía
 * `actualizarNinoTutor` (RPC `actualizar_identidad_nino_tutor`, gate `es_tutor_de`).
 * Whitelist: apellidos, fecha_nacimiento, sexo, nacionalidad, idioma_principal
 * (aula/centro/flags los fija la dirección). Al guardar correctamente, avanza.
 */
export function PasoIdentidad({ ninoId, inicial, onNext }: Props) {
  const t = useTranslations('alta')
  const tNino = useTranslations('admin.ninos')
  const tErrors = useTranslations()
  const [pending, startTransition] = useTransition()

  const form = useForm<ActualizarNinoTutorInput>({
    resolver: zodResolver(actualizarNinoTutorSchema),
    defaultValues: {
      nino_id: ninoId,
      apellidos: inicial.apellidos ?? '',
      fecha_nacimiento: inicial.fecha_nacimiento ?? '',
      sexo: inicial.sexo,
      nacionalidad: inicial.nacionalidad,
      idioma_principal: idiomaValido(inicial.idioma_principal),
    },
  })

  function onSubmit(values: ActualizarNinoTutorInput) {
    startTransition(async () => {
      const r = await actualizarNinoTutor(values)
      if (r.success) {
        toast.success(t('identidad.guardado'))
        onNext()
      } else {
        toast.error(tErrors(r.error))
      }
    })
  }

  const sexoItems = [
    { value: 'F', label: tNino('sexo_opciones.F') },
    { value: 'M', label: tNino('sexo_opciones.M') },
    { value: 'X', label: tNino('sexo_opciones.X') },
    { value: null, label: tNino('sexo_opciones.no_contesta') },
  ]

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
        <FormField
          control={form.control}
          name="apellidos"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{tNino('fields.apellidos')}</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="fecha_nacimiento"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{tNino('fields.fecha_nacimiento')}</FormLabel>
              <FormControl>
                <Input type="date" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="sexo"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{tNino('fields.sexo')}</FormLabel>
              <Select items={sexoItems} value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder={tNino('fields.sexo_placeholder')} />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {sexoItems.map((item) => (
                    <SelectItem key={String(item.value)} value={item.value}>
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
          name="nacionalidad"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{tNino('fields.nacionalidad')}</FormLabel>
              <FormControl>
                <Input {...field} value={field.value ?? ''} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="idioma_principal"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{tNino('fields.idioma_principal')}</FormLabel>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="es">Español</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="va">Valencià</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex justify-end border-t pt-4">
          <Button type="submit" disabled={pending}>
            {pending ? t('wizard.guardando') : t('wizard.guardar_siguiente')}
          </Button>
        </div>
      </form>
    </Form>
  )
}
