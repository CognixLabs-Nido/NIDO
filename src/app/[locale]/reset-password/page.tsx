import { useTranslations } from 'next-intl'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ResetPasswordForm } from '@/features/auth/components/ResetPasswordForm'
import { AuthShell } from '@/shared/components/AuthShell'

interface PageProps {
  params: Promise<{ locale: string }>
}

export default async function ResetPasswordPage({ params }: PageProps) {
  const { locale } = await params
  return <Content locale={locale} />
}

function Content({ locale }: { locale: string }) {
  const t = useTranslations('auth.reset')
  return (
    <AuthShell locale={locale}>
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <ResetPasswordForm locale={locale} />
        </CardContent>
      </Card>
    </AuthShell>
  )
}
