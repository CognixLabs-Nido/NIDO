import { UserIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { Card, CardContent } from '@/components/ui/card'
import { SignOutButton } from '@/features/auth/components/SignOutButton'
import { AuthShell } from '@/shared/components/AuthShell'
import { createClient } from '@/lib/supabase/server'

interface PageProps {
  params: Promise<{ locale: string }>
}

export default async function ProfilePage({ params }: PageProps) {
  const { locale } = await params
  const t = await getTranslations('auth.profile')

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const user = userData.user

  let nombre = ''
  let idioma = ''
  if (user) {
    const { data: usuario } = await supabase
      .from('usuarios')
      .select('nombre_completo, idioma_preferido')
      .eq('id', user.id)
      .maybeSingle()
    nombre = usuario?.nombre_completo ?? ''
    idioma = usuario?.idioma_preferido ?? locale
  }

  const initials = (nombre.charAt(0) || user?.email?.charAt(0) || '?').toUpperCase()

  return (
    <AuthShell locale={locale}>
      <Card className="w-full max-w-md shadow-lg">
        <CardContent className="space-y-6">
          <div className="flex flex-col items-center gap-3">
            <div className="bg-primary-100 text-primary-700 flex h-16 w-16 items-center justify-center rounded-full text-2xl font-bold">
              {initials}
            </div>
            <div className="text-center">
              <h1 className="text-h2 text-foreground">{nombre || t('title')}</h1>
              <p className="text-muted-foreground text-sm">{user?.email ?? ''}</p>
            </div>
          </div>
          <div className="space-y-3 border-t border-dashed border-neutral-200 pt-4 text-sm">
            <Row icon={<UserIcon className="size-4" />} k={t('language')} v={idioma} />
          </div>
          <SignOutButton locale={locale} />
        </CardContent>
      </Card>
    </AuthShell>
  )
}

function Row({ icon, k, v }: { icon: React.ReactNode; k: string; v: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{k}</span>
      <span className="text-foreground ml-auto">{v}</span>
    </div>
  )
}
