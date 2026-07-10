import { UserIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { Card, CardContent } from '@/components/ui/card'
import { SignOutButton } from '@/features/auth/components/SignOutButton'
import { ExportButton } from '@/features/export/components/ExportButton'
import { PushSettings } from '@/features/push/components/PushSettings'
import { AvatarUploader } from '@/features/usuarios/components/AvatarUploader'
import { BUCKET_USUARIOS_FOTOS, firmarRuta } from '@/shared/lib/adjuntos/storage'
import { AuthShell } from '@/shared/components/AuthShell'
import { createClient } from '@/lib/supabase/server'

interface PageProps {
  params: Promise<{ locale: string }>
}

export default async function ProfilePage({ params }: PageProps) {
  const { locale } = await params
  const t = await getTranslations('auth.profile')
  const tExport = await getTranslations('export')

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const user = userData.user

  let nombre = ''
  let idioma = ''
  let fotoUrl: string | null = null
  if (user) {
    const { data: usuario } = await supabase
      .from('usuarios')
      .select('nombre_completo, idioma_preferido, foto_url')
      .eq('id', user.id)
      .maybeSingle()
    nombre = usuario?.nombre_completo ?? ''
    idioma = usuario?.idioma_preferido ?? locale
    // La RLS de `usuarios-fotos` deja al propio usuario firmar su avatar.
    fotoUrl = await firmarRuta(supabase, BUCKET_USUARIOS_FOTOS, usuario?.foto_url)
  }

  const initials = (nombre.charAt(0) || user?.email?.charAt(0) || '?').toUpperCase()

  return (
    <AuthShell locale={locale}>
      <Card className="w-full max-w-md shadow-lg">
        <CardContent className="space-y-6">
          <div className="flex flex-col items-center gap-3">
            <AvatarUploader
              locale={locale}
              usuarioId={user?.id ?? ''}
              initialUrl={fotoUrl}
              initials={initials}
            />
            <div className="text-center">
              <h1 className="text-h2 text-foreground">{nombre || t('title')}</h1>
              <p className="text-muted-foreground text-sm">{user?.email ?? ''}</p>
            </div>
          </div>
          <div className="space-y-3 border-t border-dashed border-neutral-200 pt-4 text-sm">
            <Row icon={<UserIcon className="size-4" />} k={t('language')} v={idioma} />
          </div>
          <div className="border-t border-dashed border-neutral-200 pt-4">
            <PushSettings />
          </div>
          <div className="space-y-2 border-t border-dashed border-neutral-200 pt-4">
            <p className="text-muted-foreground text-xs">{tExport('perfil_descripcion')}</p>
            <ExportButton
              href={`/${locale}/export/me`}
              label={tExport('descargar_mis_datos')}
              filename="nido-mis-datos.zip"
            />
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
