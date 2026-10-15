import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const { captureException, ruta } = vi.hoisted(() => ({
  captureException: vi.fn(),
  ruta: { actual: '/va/family' as string | null },
}))
vi.mock('@sentry/nextjs', () => ({ captureException }))
vi.mock('next/navigation', () => ({ usePathname: () => ruta.actual }))

import GlobalError from '../global-error'

/** La página de último recurso: avisa en el idioma de la ruta y manda el error a Sentry. */
describe('global-error', () => {
  it('manda el error a Sentry una vez y no enseña su mensaje', () => {
    const fallo = new Error('fallo con lucia.demo@correo.test')
    render(<GlobalError error={fallo} reset={() => {}} />)
    expect(captureException).toHaveBeenCalledTimes(1)
    expect(captureException).toHaveBeenCalledWith(fallo)
    expect(document.body.textContent).not.toContain('lucia.demo@correo.test')
  })

  it('habla el idioma de la ruta', () => {
    ruta.actual = '/va/family'
    render(<GlobalError error={new Error('x')} reset={() => {}} />)
    expect(screen.getByRole('heading').textContent).toBe("S'ha produït un error")
    expect(screen.getByRole('button').textContent).toBe('Tornar a intentar')
  })
})
