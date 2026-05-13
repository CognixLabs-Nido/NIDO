import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { createServiceRoleClient } from '@/features/auth/actions/_service-role'
import { PendingInvitationsList } from '@/features/auth/components/PendingInvitationsList'
import { createClient } from '@/lib/supabase/server'

interface PageProps {
  params: Promise<{ locale: string }>
}

export default async function PendingInvitationsPage({ params }: PageProps) {
  const { locale } = await params
  const t = await getTranslations('auth.invitation.pending')

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData.user?.email) redirect(`/${locale}/login`)

  // Buscamos invitaciones pendientes para el email del usuario usando service role
  // (las políticas RLS solo permiten ver al admin del centro, no al destinatario).
  const service = createServiceRoleClient()
  const { data: invitations } = await service
    .from('invitaciones')
    .select('id, rol_objetivo, centro_id, expires_at')
    .eq('email', userData.user.email)
    .is('accepted_at', null)
    .is('rejected_at', null)
    .gt('expires_at', new Date().toISOString())

  return (
    <div className="mx-auto max-w-xl px-6 py-12">
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <PendingInvitationsList invitations={invitations ?? []} />
        </CardContent>
      </Card>
    </div>
  )
}
