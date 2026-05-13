import { useTranslations } from 'next-intl'
import Link from 'next/link'

import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

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
    <div className="flex min-h-[80vh] items-center justify-center p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {contactEmail && (
            <a
              href={`mailto:${contactEmail}`}
              className={buttonVariants({ variant: 'outline', className: 'w-full' })}
            >
              {t('contact')}
            </a>
          )}
          <Link href={`/${locale}/login`} className={buttonVariants({ className: 'w-full' })}>
            {t('go_to_login')}
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
