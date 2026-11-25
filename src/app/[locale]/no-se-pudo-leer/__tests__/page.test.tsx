import { render } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it, vi } from 'vitest'

import es from '../../../../../messages/es.json'

// Si la página leyera algo de quien entra, esto lo pondría rojo: ningún cliente se puede crear.
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => {
    throw new Error('la página pública no lee la sesión')
  },
}))
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => {
    throw new Error('la página pública no lee nada con el servicio')
  },
}))
vi.mock('next/headers', () => ({
  cookies: () => {
    throw new Error('la página pública no lee cookies')
  },
  headers: () => {
    throw new Error('la página pública no lee cabeceras')
  },
}))

const { default: NoSePudoLeerPage } = await import('../page')

/**
 * Censo C (decisión de Jose del 2026-11-25): la página es pública, así que «que no revele NADA. Ni si el
 * usuario existe, ni si tiene roles, ni el nombre del centro […] El mismo texto para todo el mundo, sin
 * datos dentro, y sin dar acceso a ninguna parte».
 */
describe('/no-se-pudo-leer', () => {
  it('el mismo texto para todo el mundo, sin datos, y un solo enlace: al inicio', async () => {
    const nodo = await NoSePudoLeerPage({ params: Promise.resolve({ locale: 'es' }) })
    const { container } = render(
      <NextIntlClientProvider locale="es" messages={es}>
        {nodo}
      </NextIntlClientProvider>
    )
    const t = es.auth.no_se_pudo_leer
    const tarjeta = container.querySelector('[data-testid="no-se-pudo-leer-proxy"]')
    expect(tarjeta?.textContent).toBe(`${t.title}${t.description}${t.back_to_home}`)
    const enlaces = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'))
    expect(enlaces).toContain('/es')
    expect(enlaces.every((h) => h === '/es' || h === '/' || h === '/es/')).toBe(true)
  })
})
