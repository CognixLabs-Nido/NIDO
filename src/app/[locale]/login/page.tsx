import { useTranslations } from 'next-intl'
import Link from 'next/link'

import { Card, CardContent } from '@/components/ui/card'
import { LoginForm } from '@/features/auth/components/LoginForm'
import { Logo } from '@/shared/components/brand/Logo'

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
    <div className="from-primary-100 via-background to-accent-warm-100 relative isolate flex min-h-[100dvh] flex-col items-center justify-center bg-gradient-to-br px-4 py-10">
      <Logo priority width={220} height={244} className="mb-4" />
      <Card className="w-full max-w-md shadow-lg">
        <CardContent className="space-y-5 pt-2">
          <div className="space-y-1.5">
            <h1 className="text-h2 text-foreground">{t('title')}</h1>
            <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
          </div>
          <LoginForm locale={locale} />
          <p className="text-center text-sm">
            <Link
              href={`/${locale}/forgot-password`}
              className="text-primary hover:text-primary-800 font-medium hover:underline"
            >
              {t('forgot')}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
