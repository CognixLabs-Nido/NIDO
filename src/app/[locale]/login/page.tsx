import { useTranslations } from 'next-intl'
import Link from 'next/link'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { LoginForm } from '@/features/auth/components/LoginForm'

interface PageProps {
  params: Promise<{ locale: string }>
}

export default async function LoginPage({ params }: PageProps) {
  const { locale } = await params
  return <LoginPageContent locale={locale} />
}

function LoginPageContent({ locale }: { locale: string }) {
  const t = useTranslations('auth.login')
  return (
    <div className="flex min-h-[80vh] items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('subtitle')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <LoginForm locale={locale} />
          <p className="text-muted-foreground text-center text-sm">
            <Link href={`/${locale}/forgot-password`} className="underline">
              {t('forgot')}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
