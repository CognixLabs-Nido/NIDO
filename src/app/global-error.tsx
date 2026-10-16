'use client'

import * as Sentry from '@sentry/nextjs'
import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

import { localeDeRuta, TEXTOS_ERROR_GLOBAL } from '@/shared/lib/error-global/textos'

/**
 * Último recurso: un error que nadie más ha recogido. Sustituye al layout raíz (por eso
 * lleva su propio <html>) y manda el error a Sentry, que lo limpia antes de enviarlo
 * (ADR-0056). No enseña el mensaje del error: puede llevar datos.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const locale = localeDeRuta(usePathname())
  const t = TEXTOS_ERROR_GLOBAL[locale]

  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html lang={locale}>
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif',
          padding: '16px',
        }}
      >
        <main style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>{t.titulo}</h1>
          <button
            type="button"
            onClick={reset}
            style={{ padding: '0.5rem 1rem', borderRadius: '0.5rem', cursor: 'pointer' }}
          >
            {t.reintentar}
          </button>
        </main>
      </body>
    </html>
  )
}
