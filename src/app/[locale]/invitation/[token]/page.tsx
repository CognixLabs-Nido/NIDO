import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AcceptInvitationForm } from '@/features/auth/components/AcceptInvitationForm'
import { notifyExistingAccountInvitation } from '@/features/auth/actions/accept-invitation'
import { createServiceRoleClient } from '@/features/auth/actions/_service-role'
import { AuthShell } from '@/shared/components/AuthShell'

interface PageProps {
  params: Promise<{ locale: string; token: string }>
}

export default async function InvitationPage({ params }: PageProps) {
  const { locale, token } = await params

  // Validar formato UUID antes de pegar DB.
  if (!/^[0-9a-f-]{36}$/i.test(token)) {
    redirect(`/${locale}/invitation/expired`)
  }

  const service = createServiceRoleClient()
  const { data: invitation } = await service
    .from('invitaciones')
    .select('email, expires_at, accepted_at, rejected_at')
    .eq('token', token)
    .maybeSingle()

  if (
    !invitation ||
    invitation.accepted_at ||
    invitation.rejected_at ||
    new Date(invitation.expires_at) < new Date()
  ) {
    redirect(`/${locale}/invitation/expired`)
  }

  // ¿Email ya existe en auth.users?
  const { data: usersList } = await service.auth.admin.listUsers()
  const emailExists = usersList?.users.some(
    (u) => u.email?.toLowerCase() === invitation.email.toLowerCase()
  )

  if (emailExists) {
    // Dispara aviso (best-effort). Render flujo B8.
    await notifyExistingAccountInvitation(token).catch(() => {})
    return <ExistingAccountNotice locale={locale} email={invitation.email} />
  }

  return <NewAccountFlow locale={locale} token={token} email={invitation.email} />
}

function NewAccountFlow({
  locale,
  token,
  email,
}: {
  locale: string
  token: string
  email: string
}) {
  const t = useTranslations('auth.invitation')
  return (
    <AuthShell locale={locale}>
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('subtitle_new')}</CardDescription>
        </CardHeader>
        <CardContent>
          <AcceptInvitationForm locale={locale} token={token} email={email} />
        </CardContent>
      </Card>
    </AuthShell>
  )
}

function ExistingAccountNotice({ locale, email }: { locale: string; email: string }) {
  const t = useTranslations('auth.invitation')
  const obfuscated = obfuscateEmail(email)
  return (
    <AuthShell locale={locale}>
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('subtitle_existing')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-sm">
            {t('existing_email_notice', { email: obfuscated })}
          </p>
          <Link
            href={`/${locale}/login?returnTo=/${locale}/profile/invitations`}
            className={buttonVariants({ className: 'h-11 w-full text-base' })}
          >
            {t('go_to_login')}
          </Link>
          <p className="text-center text-sm">
            <Link
              href={`/${locale}/forgot-password`}
              className="text-primary hover:text-primary-800 font-medium hover:underline"
            >
              {t('forgot_password_hint')}
            </Link>
          </p>
        </CardContent>
      </Card>
    </AuthShell>
  )
}

function obfuscateEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain || !local) return email
  const visible = local.slice(0, 2)
  return `${visible}${'*'.repeat(Math.max(local.length - 2, 1))}@${domain}`
}
