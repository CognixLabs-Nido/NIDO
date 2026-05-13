'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslations } from 'next-intl'
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
import { requestPasswordReset } from '@/features/auth/actions/request-password-reset'
import {
  requestPasswordResetSchema,
  type RequestPasswordResetInput,
} from '@/features/auth/schemas/reset-password'

interface Props {
  locale: string
}

export function ForgotPasswordForm({ locale }: Props) {
  const t = useTranslations()
  const [pending, startTransition] = useTransition()
  const [done, setDone] = useState(false)

  const form = useForm<RequestPasswordResetInput>({
    resolver: zodResolver(requestPasswordResetSchema),
    defaultValues: { email: '' },
  })

  function onSubmit(values: RequestPasswordResetInput) {
    startTransition(async () => {
      await requestPasswordReset(values, locale)
      setDone(true)
    })
  }

  if (done) {
    return (
      <p role="status" className="text-muted-foreground text-sm">
        {t('auth.forgot.success')}
      </p>
    )
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('auth.login.email')}</FormLabel>
              <FormControl>
                <Input type="email" autoComplete="email" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={pending} aria-busy={pending} className="w-full">
          {pending ? t('common.submitting') : t('auth.forgot.submit')}
        </Button>
      </form>
    </Form>
  )
}
