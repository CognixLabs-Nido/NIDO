import { useTranslations } from 'next-intl'
import Link from 'next/link'

import { buttonVariants } from '@/components/ui/button'

interface PageProps {
  params: Promise<{ locale: string }>
}

export default async function HomePage({ params }: PageProps) {
  const { locale } = await params
  return <Content locale={locale} />
}

function Content({ locale }: { locale: string }) {
  const t = useTranslations('home')
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-6 py-16 dark:bg-black">
      <main className="flex w-full max-w-2xl flex-col items-center gap-6 text-center">
        <h1 className="text-5xl font-semibold tracking-tight text-black dark:text-zinc-50">
          {t('title')}
        </h1>
        <p className="text-lg text-zinc-600 dark:text-zinc-400">{t('subtitle')}</p>
        <p className="rounded-full bg-zinc-200 px-4 py-1 text-sm text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          {t('phase')}
        </p>
        <Link href={`/${locale}/login`} className={buttonVariants()}>
          {t('cta_login')}
        </Link>
      </main>
    </div>
  )
}
