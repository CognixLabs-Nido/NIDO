'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { useForm } from 'react-hook-form'

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
import { acceptInvitation } from '@/features/auth/actions/accept-invitation'
import {
  acceptInvitationSchema,
  type AcceptInvitationInput,
} from '@/features/auth/schemas/invitation'

interface Props {
  locale: string
  token: string
  email: string
}

export function AcceptInvitationForm({ locale, token, email }: Props) {
  const t = useTranslations()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [serverErrorKey, setServerErrorKey] = useState<string | null>(null)

  const form = useForm<AcceptInvitationInput>({
    resolver: zodResolver(acceptInvitationSchema),
    defaultValues: {
      token,
      nombreCompleto: '',
      password: '',
      idiomaPreferido: locale as 'es' | 'en' | 'va',
      aceptaTerminos: false as unknown as true,
      aceptaPrivacidad: false as unknown as true,
    },
  })

  function onSubmit(values: AcceptInvitationInput) {
    setServerErrorKey(null)
    startTransition(async () => {
      const result = await acceptInvitation(values)
      if (!result.success) {
        setServerErrorKey(result.error)
        return
      }
      const dashboard =
        result.data.primaryRole === 'admin'
          ? `/${locale}/admin`
          : result.data.primaryRole === 'profe'
            ? `/${locale}/teacher`
            : `/${locale}/family`
      router.push(dashboard)
      router.refresh()
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

        <FormField
          control={form.control}
          name="aceptaTerminos"
          render={({ field }) => (
            <FormItem className="flex flex-row items-start space-y-0 space-x-3">
              <FormControl>
                <Checkbox checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
              <FormLabel>{t('auth.invitation.fields.terms')}</FormLabel>
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
              <FormMessage />
            </FormItem>
          )}
        />

        {serverErrorKey && (
          <p role="alert" className="text-destructive text-sm">
            {t(serverErrorKey)}
          </p>
        )}

        <Button type="submit" disabled={pending} aria-busy={pending} className="w-full">
          {pending ? t('common.submitting') : t('auth.invitation.submit')}
        </Button>
      </form>
    </Form>
  )
}
