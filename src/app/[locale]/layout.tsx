import { hasLocale, NextIntlClientProvider } from 'next-intl'
import localFont from 'next/font/local'
import { notFound } from 'next/navigation'

import { Toaster } from '@/components/ui/sonner'
import { ServiceWorkerRegister } from '@/features/push/components/ServiceWorkerRegister'
import { routing } from '@/i18n/routing'

import type { Metadata } from 'next'

import '../globals.css'

// Plus Jakarta Sans servida desde el repo (OFL 1.1, `src/app/fonts/plus-jakarta-sans/`): con
// `next/font/google` el build la descargaba de Google y caía de forma intermitente
// (`docs/dev-setup.md`). Los cinco pesos que usa la app, ficheros estáticos sin tocar.
const jakarta = localFont({
  variable: '--font-jakarta',
  display: 'swap',
  src: [
    {
      path: '../fonts/plus-jakarta-sans/PlusJakartaSans-Regular.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: '../fonts/plus-jakarta-sans/PlusJakartaSans-Medium.woff2',
      weight: '500',
      style: 'normal',
    },
    {
      path: '../fonts/plus-jakarta-sans/PlusJakartaSans-SemiBold.woff2',
      weight: '600',
      style: 'normal',
    },
    {
      path: '../fonts/plus-jakarta-sans/PlusJakartaSans-Bold.woff2',
      weight: '700',
      style: 'normal',
    },
    {
      path: '../fonts/plus-jakarta-sans/PlusJakartaSans-ExtraBold.woff2',
      weight: '800',
      style: 'normal',
    },
  ],
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
        <ServiceWorkerRegister />
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
        {/* Sin esto ningún toast de la app se ve. Claro a la fuerza: no hay ThemeProvider ni modo
            oscuro, y sin tema el Toaster seguiría al sistema y saldría oscuro sobre la app clara. */}
        <Toaster theme="light" />
      </body>
    </html>
  )
}
