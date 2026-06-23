'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import {
  acceptInvitation,
  acceptInvitationCore,
  redirigirAlPanel,
} from '@/features/auth/actions/accept-invitation'
import {
  acceptInvitationSchema,
  type AcceptInvitationInput,
} from '@/features/auth/schemas/invitation'
import { subirAvatar } from '@/features/usuarios/lib/subir-avatar'
import { safeTranslateError } from '@/shared/lib/safe-translate'

const PARENTESCO_OPCIONES = [
  'madre',
  'padre',
  'abuela',
  'abuelo',
  'tia',
  'tio',
  'hermana',
  'hermano',
  'cuidadora',
  'otro',
] as const

interface Props {
  locale: string
  token: string
  email: string
  /**
   * Nombre que fijó la dirección en la invitación (decisión C de onboarding-profe):
   * prefill EDITABLE, no read-only — el invitado puede corregirlo al aceptar. Vacío
   * para invitaciones sin nombre preasignado (p. ej. familia).
   */
  nombreInicial?: string
  requiereParentesco?: boolean
}

export function AcceptInvitationForm({
  locale,
  token,
  email,
  nombreInicial = '',
  requiereParentesco = false,
}: Props) {
  const t = useTranslations()
  const [pending, startTransition] = useTransition()
  const [serverErrorKey, setServerErrorKey] = useState<string | null>(null)
  // Avatar OPCIONAL (decisión D): no bloquea el alta. Se sube TRAS crear la cuenta
  // (ya hay sesión), por eso solo guardamos el File aquí y lo enviamos en onSubmit.
  const [fotoFile, setFotoFile] = useState<File | null>(null)

  const form = useForm<AcceptInvitationInput>({
    resolver: zodResolver(acceptInvitationSchema),
    defaultValues: {
      token,
      nombreCompleto: nombreInicial,
      password: '',
      idiomaPreferido: locale as 'es' | 'en' | 'va',
      aceptaTerminos: false as unknown as true,
      aceptaPrivacidad: false as unknown as true,
      parentesco: undefined,
      descripcionParentesco: '',
    },
  })

  const parentescoSel = useWatch({ control: form.control, name: 'parentesco' })

  function onSubmit(values: AcceptInvitationInput) {
    setServerErrorKey(null)
    if (requiereParentesco && !values.parentesco) {
      // La clave i18n la traduce FormMessage (safe-translate); no pre-traducir aquí.
      form.setError('parentesco', { message: 'vinculo.validation.parentesco_requerido' })
      return
    }
    startTransition(async () => {
      // Sin avatar: el wrapper redirige server-side en ÉXITO (el proxy con updateSession
      // propaga la cookie al destino → el gate P3c de /family reenvía a /alta), así que el
      // código de aquí solo se ejecuta en caso de error. Camino histórico, sin cambios.
      if (!fotoFile) {
        const result = await acceptInvitation(values, locale)
        if (!result.success) setServerErrorKey(result.error)
        return
      }
      // Con avatar: crear la cuenta SIN redirigir (ya hay sesión), subir la foto (best-
      // effort, decisión D: no bloquea el alta) y redirigir server-side al panel.
      const result = await acceptInvitationCore(values)
      if (!result.success) {
        setServerErrorKey(result.error)
        return
      }
      const sub = await subirAvatar(locale, result.data.usuarioId, fotoFile)
      if (!sub.ok) toast.warning(safeTranslateError(t, 'auth.avatar.opcional_fallo'))
      await redirigirAlPanel(locale, result.data.rol)
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormItem>
          <FormLabel>{t('auth.login.email')}</FormLabel>
          <FormControl>
            <Input value={email} readOnly disabled />
          </FormControl>
        </FormItem>

        <FormField
          control={form.control}
          name="nombreCompleto"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('auth.invitation.fields.name')}</FormLabel>
              <FormControl>
                <Input autoComplete="name" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('auth.login.password')}</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="new-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="idiomaPreferido"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('auth.invitation.fields.language')}</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
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

        <FormItem>
          <FormLabel>{t('auth.avatar.campo_label')}</FormLabel>
          <FormControl>
            <Input
              type="file"
              accept="image/jpeg,image/png"
              disabled={pending}
              onChange={(e) => setFotoFile(e.target.files?.[0] ?? null)}
            />
          </FormControl>
          <p className="text-muted-foreground text-xs">{t('auth.avatar.campo_ayuda')}</p>
        </FormItem>

        {requiereParentesco && (
          <>
            <FormField
              control={form.control}
              name="parentesco"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('vinculo.fields.parentesco')}</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? undefined}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t('vinculo.fields.parentesco_placeholder')} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {PARENTESCO_OPCIONES.map((p) => (
                        <SelectItem key={p} value={p}>
                          {t(`vinculo.parentesco.${p}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {parentescoSel === 'otro' && (
              <FormField
                control={form.control}
                name="descripcionParentesco"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('vinculo.fields.descripcion_parentesco')}</FormLabel>
                    <FormControl>
                      <Input {...field} value={field.value ?? ''} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
          </>
        )}

        <FormField
          control={form.control}
          name="aceptaTerminos"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start space-y-0 space-x-3">
              <FormControl>
                <Checkbox checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
              <FormLabel>{t('auth.invitation.fields.terms')}</FormLabel>
              <Link
                href={`/${locale}/terms`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary text-sm underline"
              >
                {t('auth.invitation.fields.leer')}
              </Link>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="aceptaPrivacidad"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start space-y-0 space-x-3">
              <FormControl>
                <Checkbox checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
              <FormLabel>{t('auth.invitation.fields.privacy')}</FormLabel>
              <Link
                href={`/${locale}/privacy`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary text-sm underline"
              >
                {t('auth.invitation.fields.leer')}
              </Link>
              <FormMessage />
            </FormItem>
          )}
        />

        {serverErrorKey && (
          <p role="alert" className="text-destructive text-sm">
            {safeTranslateError(t, serverErrorKey)}
          </p>
        )}

        <Button type="submit" disabled={pending} aria-busy={pending} className="w-full">
          {pending ? t('common.submitting') : t('auth.invitation.submit')}
        </Button>
      </form>
    </Form>
  )
}
