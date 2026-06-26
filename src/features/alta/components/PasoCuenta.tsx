'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useTransition } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

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
import { acceptInvitationCore } from '@/features/auth/actions/accept-invitation'
import {
  acceptInvitationSchema,
  type AcceptInvitationInput,
} from '@/features/auth/schemas/invitation'
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
  ninoId: string
  nombreInicial: string
  requiereParentesco: boolean
}

/**
 * Paso 1 del alta de 8 (G-1) — creación de la cuenta del TUTOR 1, REUSANDO
 * `acceptInvitationCore` (crea usuario + rol + vínculo + login server-side). A
 * diferencia de `AcceptInvitationForm` (que redirige al panel por rol), aquí —tras el
 * login— navegamos a `/alta/[ninoId]`, donde el MISMO wizard reanuda en el paso 2 ya
 * autenticado (arquitectura A). Vive en `/invitation/[token]` (pre-login); el resto de
 * pasos viven en `/alta` (post-login). Sin avatar: la foto del niño es un paso posterior.
 */
export function PasoCuenta({
  locale,
  token,
  email,
  ninoId,
  nombreInicial,
  requiereParentesco,
}: Props) {
  const t = useTranslations()
  const router = useRouter()
  const [pending, startTransition] = useTransition()

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
    if (requiereParentesco && !values.parentesco) {
      form.setError('parentesco', { message: 'vinculo.validation.parentesco_requerido' })
      return
    }
    startTransition(async () => {
      const result = await acceptInvitationCore(values)
      if (!result.success) {
        form.setError('root', { message: result.error })
        return
      }
      // Cuenta creada + sesión activa: el mismo wizard reanuda en /alta (paso 2+).
      router.replace(`/${locale}/alta/${ninoId}`)
    })
  }

  const rootError = form.formState.errors.root?.message

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

        {rootError && (
          <p role="alert" className="text-destructive text-sm">
            {safeTranslateError(t, rootError)}
          </p>
        )}

        <div className="flex justify-end border-t pt-4">
          <Button type="submit" disabled={pending} aria-busy={pending}>
            {pending ? t('common.submitting') : t('alta.wizard.guardar_siguiente')}
          </Button>
        </div>
      </form>
    </Form>
  )
}
