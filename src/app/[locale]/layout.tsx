import { hasLocale, NextIntlClientProvider } from 'next-intl'
import { Plus_Jakarta_Sans } from 'next/font/google'
import { notFound } from 'next/navigation'

import { routing } from '@/i18n/routing'

import type { Metadata } from 'next'

import '../globals.css'

const jakarta = Plus_Jakarta_Sans({
  variable: '--font-jakarta',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'NIDO',
  description: 'Agenda digital para escuelas infantiles 0-3 años',
  manifest: '/manifest.json',
  // iOS Safari 16.4+: estos meta tags + el manifest permiten que la web
  // pueda añadirse a pantalla de inicio y, una vez instalada, recibir push
  // notifications. Ver docs/specs/push-notifications.md y ADR-0028.
  appleWebApp: {
    capable: true,
    title: 'NIDO',
    statusBarStyle: 'default',
  },
  icons: {
    icon: '/brand/icon-192.png',
    apple: '/brand/icon-192.png',
  },
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }))
}

export default async function LocaleLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode
  params: Promise<{ locale: string }>
}>) {
  const { locale } = await params

  if (!hasLocale(routing.locales, locale)) {
    notFound()
  }

  return (
    <html lang={locale} className={`${jakarta.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  )
}
