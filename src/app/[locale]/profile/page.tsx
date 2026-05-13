import { getTranslations } from 'next-intl/server'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SignOutButton } from '@/features/auth/components/SignOutButton'
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

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-muted-foreground text-xs">{t('name')}</p>
            <p>{nombre}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">{t('email')}</p>
            <p>{user?.email ?? ''}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">{t('language')}</p>
            <p>{idioma}</p>
          </div>
          <SignOutButton locale={locale} />
        </CardContent>
      </Card>
    </div>
  )
}
