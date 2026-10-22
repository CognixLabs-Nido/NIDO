'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'

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

import { crearCentro } from '../actions/crear-centro'
import { crearCentroSchema, type CrearCentroInput } from '../schemas/crear-centro'

interface Props {
  locale: string
  /** El curso calculado por la fecha (`cursoPorFecha`); el superusuario lo puede cambiar. */
  curso: { nombre: string; inicio: string; fin: string }
}

const CAMPOS_TEXTO = [
  ['nombre', 'text'],
  ['direccion', 'text'],
  ['telefono', 'tel'],
  ['email_contacto', 'email'],
] as const

const CAMPOS_CURSO = [
  ['curso_nombre', 'text'],
  ['curso_inicio', 'date'],
  ['curso_fin', 'date'],
] as const

/**
 * Crear un centro (Fase 5, PR 2): nombre, dirección, teléfono, email de contacto e idioma; el curso
 * con el que nace; y el email de su admin, obligatorio. Si el correo de la invitación no sale, el
 * centro ya está creado y se dice: la invitación se reenvía desde el panel.
 */
export function NuevoCentroForm({ locale, curso }: Props) {
  const t = useTranslations('plataforma.nuevo')
  const tRoot = useTranslations()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [sinCorreo, setSinCorreo] = useState(false)

  const form = useForm<CrearCentroInput>({
    resolver: zodResolver(crearCentroSchema),
    defaultValues: {
      nombre: '',
      direccion: '',
      telefono: '',
      email_contacto: '',
      idioma_default: 'es',
      curso_nombre: curso.nombre,
      curso_inicio: curso.inicio,
      curso_fin: curso.fin,
      email_admin: '',
    },
  })

  function onSubmit(values: CrearCentroInput) {
    setError(null)
    startTransition(async () => {
      const r = await crearCentro(values)
      if (!r.success) {
        setError(r.error)
        return
      }
      if (r.data.errorCorreo) {
        setSinCorreo(true)
        return
      }
      router.push(`/${locale}/plataforma`)
    })
  }

  if (sinCorreo) {
    return (
      <div className="space-y-3">
        <p role="alert" className="text-sm text-amber-800 dark:text-amber-200">
          {t('creado_sin_correo')}
        </p>
        <Link href={`/${locale}/plataforma`} className="text-sm underline">
          {t('volver')}
        </Link>
      </div>
    )
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <fieldset className="space-y-3">
          <legend className="text-h3 mb-2">{t('centro')}</legend>
          {CAMPOS_TEXTO.map(([campo, tipo]) => (
            <FormField
              key={campo}
              control={form.control}
              name={campo}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t(`campos.${campo}`)}</FormLabel>
                  <FormControl>
                    <Input type={tipo} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ))}
          <FormField
            control={form.control}
            name="idioma_default"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('campos.idioma_default')}</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="es">{t('idiomas.es')}</SelectItem>
                    <SelectItem value="en">{t('idiomas.en')}</SelectItem>
                    <SelectItem value="va">{t('idiomas.va')}</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-h3 mb-2">{t('curso')}</legend>
          <p className="text-muted-foreground text-sm">{t('curso_ayuda')}</p>
          {CAMPOS_CURSO.map(([campo, tipo]) => (
            <FormField
              key={campo}
              control={form.control}
              name={campo}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t(`campos.${campo}`)}</FormLabel>
                  <FormControl>
                    <Input type={tipo} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ))}
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-h3 mb-2">{t('admin')}</legend>
          <p className="text-muted-foreground text-sm">{t('admin_ayuda')}</p>
          <FormField
            control={form.control}
            name="email_admin"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t('campos.email_admin')}</FormLabel>
                <FormControl>
                  <Input type="email" autoComplete="off" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </fieldset>

        {error && (
          <p role="alert" className="text-destructive text-sm">
            {tRoot(error)}
          </p>
        )}
        <div className="flex gap-3">
          <Button type="submit" disabled={pending}>
            {t('crear')}
          </Button>
          <Link href={`/${locale}/plataforma`} className="self-center text-sm underline">
            {t('cancelar')}
          </Link>
        </div>
      </form>
    </Form>
  )
}
