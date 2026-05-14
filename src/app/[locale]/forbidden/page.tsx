import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { LockIcon } from 'lucide-react'

import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AuthShell } from '@/shared/components/AuthShell'

interface PageProps {
  params: Promise<{ locale: string }>
}

export default async function ForbiddenPage({ params }: PageProps) {
  const { locale } = await params
  return <Content locale={locale} />
}

function Content({ locale }: { locale: string }) {
  const t = useTranslations('auth.forbidden')
  return (
    <AuthShell locale={locale}>
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader>
          <div className="bg-coral-100 text-coral-700 mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full">
            <LockIcon className="size-6" />
          </div>
          <CardTitle className="text-center">{t('title')}</CardTitle>
          <CardDescription className="text-center">{t('description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Link
            href={`/${locale}`}
            className={buttonVariants({ className: 'h-11 w-full text-base' })}
          >
            {t('back_to_home')}
          </Link>
        </CardContent>
      </Card>
    </AuthShell>
  )
}
