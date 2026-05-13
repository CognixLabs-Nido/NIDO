'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
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
import { resetPassword } from '@/features/auth/actions/reset-password'
import {
  resetPasswordSchema,
  type ResetPasswordInput,
} from '@/features/auth/schemas/reset-password'
import { createClient } from '@/lib/supabase/client'

interface Props {
  locale: string
}

export function ResetPasswordForm({ locale }: Props) {
  const t = useTranslations()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [serverErrorKey, setServerErrorKey] = useState<string | null>(null)
  const [sessionReady, setSessionReady] = useState(false)

  // El token llega en URL hash. Supabase lo procesa automáticamente al inicializar el cliente.
  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(({ data }) => {
      setSessionReady(!!data.session)
    })
  }, [])

  const form = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: '', confirmPassword: '' },
  })

  function onSubmit(values: ResetPasswordInput) {
    setServerErrorKey(null)
    startTransition(async () => {
      const result = await resetPassword(values)
      if (!result.success) {
        setServerErrorKey(result.error)
        return
      }
      router.push(`/${locale}/login`)
      router.refresh()
    })
  }

  if (!sessionReady) {
    return (
      <p role="status" className="text-muted-foreground text-sm">
        {t('common.loading')}
      </p>
    )
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('auth.reset.new_password')}</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="new-password" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="confirmPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('auth.reset.confirm_password')}</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="new-password" {...field} />
              </FormControl>
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
          {pending ? t('common.submitting') : t('auth.reset.submit')}
        </Button>
      </form>
    </Form>
  )
}
