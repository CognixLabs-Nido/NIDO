'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslations } from 'next-intl'
import { useRouter, useSearchParams } from 'next/navigation'
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
import { signIn } from '@/features/auth/actions/sign-in'
import { signInSchema, type SignInInput } from '@/features/auth/schemas/sign-in'

interface LoginFormProps {
  locale: string
}

export function LoginForm({ locale }: LoginFormProps) {
  const t = useTranslations()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [pending, startTransition] = useTransition()
  const [serverErrorKey, setServerErrorKey] = useState<string | null>(null)

  const form = useForm<SignInInput>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
  })

  function onSubmit(values: SignInInput) {
    setServerErrorKey(null)
    startTransition(async () => {
      const result = await signIn(values)
      if (!result.success) {
        setServerErrorKey(result.error)
        return
      }
      const returnTo = searchParams.get('returnTo')
      router.push(returnTo ?? `/${locale}/select-role`)
      router.refresh()
    })
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
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t('auth.login.password')}</FormLabel>
              <FormControl>
                <Input type="password" autoComplete="current-password" {...field} />
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
          {pending ? t('common.submitting') : t('auth.login.submit')}
        </Button>
      </form>
    </Form>
  )
}
