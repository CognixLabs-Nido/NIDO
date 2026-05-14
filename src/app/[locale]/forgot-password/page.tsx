import { useTranslations } from 'next-intl'
import Link from 'next/link'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ForgotPasswordForm } from '@/features/auth/components/ForgotPasswordForm'
import { AuthShell } from '@/shared/components/AuthShell'

interface PageProps {
  params: Promise<{ locale: string }>
}

export default async function ForgotPasswordPage({ params }: PageProps) {
  const { locale } = await params
  return <Content locale={locale} />
}

function Content({ locale }: { locale: string }) {
  const t = useTranslations('auth.forgot')
  return (
    <AuthShell locale={locale}>
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ForgotPasswordForm locale={locale} />
          <p className="text-center text-sm">
            <Link
              href={`/${locale}/login`}
              className="text-primary hover:text-primary-800 font-medium hover:underline"
            >
              {t('back_to_login')}
            </Link>
          </p>
        </CardContent>
      </Card>
    </AuthShell>
  )
}
