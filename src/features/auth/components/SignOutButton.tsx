'use client'

import { useTranslations } from 'next-intl'
import { useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { signOut } from '@/features/auth/actions/sign-out'

interface Props {
  locale: string
}

export function SignOutButton({ locale }: Props) {
  const t = useTranslations('auth.common')
  const [pending, startTransition] = useTransition()

  function handle() {
    startTransition(async () => {
      await signOut(locale)
    })
  }

  return (
    <Button onClick={handle} disabled={pending} variant="outline">
      {pending ? '...' : t('sign_out')}
    </Button>
  )
}
