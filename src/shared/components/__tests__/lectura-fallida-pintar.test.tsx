// @vitest-environment jsdom
import { render, screen, fireEvent } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it, vi } from 'vitest'

import es from '../../../../messages/es.json'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { ContadorNoLeido } from '../ContadorNoLeido'
import { ErrorDeSeccion } from '../ErrorDeSeccion'
import { LimiteSeccion } from '../LimiteSeccion'

/**
 * Censo C (decisión de Jose del 2026-11-25): las formas de pintar «no se ha podido leer». Cada una tiene su
 * mutación por GRUPO (no por sitio): la página entera (`error.tsx` → ErrorDeSeccion), una sección
 * (`LimiteSeccion`) y un contador del menú (`ContadorNoLeido`).
 */
const conIntl = (ui: React.ReactNode) =>
  render(
    <NextIntlClientProvider locale="es" messages={es}>
      {ui}
    </NextIntlClientProvider>
  )

function Revienta(): React.ReactNode {
  throw new Error('LecturaFallida de prueba')
}

describe('pintar «no se ha podido leer»', () => {
  it('la página entera: el error.tsx común lo dice y «Reintentar» vuelve a renderizar', () => {
    const reset = vi.fn()
    conIntl(<ErrorDeSeccion error={new Error('x')} reset={reset} />)
    expect(screen.getByTestId('no-se-pudo-leer-pagina')).toBeTruthy()
    expect(screen.getByText(es.common.lectura.pagina)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: es.common.lectura.reintentar }))
    expect(reset).toHaveBeenCalledTimes(1)
  })

  it('una sección: lo que falla lo dice, y lo de al lado se sigue viendo', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    conIntl(
      <div>
        <p>el pase de lista sigue</p>
        <LimiteSeccion>
          <Revienta />
        </LimiteSeccion>
      </div>
    )
    expect(screen.getByText('el pase de lista sigue'), 'premisa: lo de al lado está').toBeTruthy()
    expect(screen.getByTestId('no-se-pudo-leer-seccion')).toBeTruthy()
    expect(screen.getByText(es.common.lectura.seccion)).toBeTruthy()
  })

  it('una sección que lee bien no pinta ningún aviso', () => {
    conIntl(
      <LimiteSeccion>
        <p>contenido</p>
      </LimiteSeccion>
    )
    expect(screen.getByText('contenido')).toBeTruthy()
    expect(screen.queryByTestId('no-se-pudo-leer-seccion')).toBeNull()
  })

  it('un contador que no se pudo leer: «?», nunca un 0', () => {
    conIntl(<ContadorNoLeido />)
    const b = screen.getByTestId('contador-no-leido')
    expect(b.textContent).toBe('?')
    expect(b.getAttribute('aria-label')).toBe(es.common.lectura.contador)
  })
})
