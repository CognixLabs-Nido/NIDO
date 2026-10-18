import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { RoleSelector } from '@/features/auth/components/RoleSelector'
import { requireContextoCentro } from '@/features/centros/contexto/get-contexto-centro'

type Role = 'admin' | 'profe' | 'tutor_legal' | 'autorizado'

const DASHBOARD_BY_ROLE: Record<Role, string> = {
  admin: 'admin',
  profe: 'teacher',
  tutor_legal: 'family',
  autorizado: 'family',
}

interface PageProps {
  params: Promise<{ locale: string }>
}

export default async function SelectRolePage({ params }: PageProps) {
  const { locale } = await params
  const t = await getTranslations('auth.select_role')

  // Los roles del centro ACTIVO (multicentro · Fase 1). Con varios centros y ninguno elegido,
  // `requireContextoCentro` manda antes al selector de centro; sin sesión, a login.
  const { roles } = await requireContextoCentro(locale)

  if (roles.length === 0) redirect(`/${locale}/forbidden`)
  if (roles.length === 1) redirect(`/${locale}/${DASHBOARD_BY_ROLE[roles[0]]}`)

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('subtitle')}</CardDescription>
        </CardHeader>
        <CardContent>
          <RoleSelector locale={locale} roles={roles} />
        </CardContent>
      </Card>
    </div>
  )
}
