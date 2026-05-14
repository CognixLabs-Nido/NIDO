import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { ClockIcon } from 'lucide-react'

import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AuthShell } from '@/shared/components/AuthShell'

interface PageProps {
  params: Promise<{ locale: string }>
}

export default async function InvitationExpiredPage({ params }: PageProps) {
  const { locale } = await params
  const contactEmail = process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? ''
  return <Content locale={locale} contactEmail={contactEmail} />
}

function Content({ locale, contactEmail }: { locale: string; contactEmail: string }) {
  const t = useTranslations('auth.invitation.invalid')
  return (
    <AuthShell locale={locale}>
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader>
          <div className="bg-accent-warm-100 text-accent-warm-700 mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full">
            <ClockIcon className="size-6" />
          </div>
          <CardTitle className="text-center">{t('title')}</CardTitle>
          <CardDescription className="text-center">{t('description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Link
            href={`/${locale}/login`}
            className={buttonVariants({ className: 'h-11 w-full text-base' })}
          >
            {t('go_to_login')}
          </Link>
          {contactEmail && (
            <a
              href={`mailto:${contactEmail}`}
              className={buttonVariants({
                variant: 'outline',
                className: 'h-11 w-full text-base',
              })}
            >
              {t('contact')}
            </a>
          )}
        </CardContent>
      </Card>
    </AuthShell>
  )
}
