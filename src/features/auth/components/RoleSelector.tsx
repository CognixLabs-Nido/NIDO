'use client'

import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'

import { Button } from '@/components/ui/button'

type Role = 'admin' | 'profe' | 'tutor_legal' | 'autorizado'

interface Props {
  locale: string
  roles: ReadonlyArray<Role>
}

const DASHBOARD_BY_ROLE: Record<Role, string> = {
  admin: 'admin',
  profe: 'teacher',
  tutor_legal: 'family',
  autorizado: 'family',
}

export function RoleSelector({ locale, roles }: Props) {
  const t = useTranslations('auth.select_role')
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function pick(role: Role) {
    startTransition(() => {
      document.cookie = `nido_active_role=${role}; Path=/; SameSite=Lax`
      router.push(`/${locale}/${DASHBOARD_BY_ROLE[role]}`)
      router.refresh()
    })
  }

  return (
    <div className="space-y-2">
      {roles.map((rol) => (
        <Button
          key={rol}
          variant="outline"
          disabled={pending}
          className="w-full justify-start"
          onClick={() => pick(rol)}
        >
          {t(`roles.${rol}`)}
        </Button>
      ))}
    </div>
  )
}
