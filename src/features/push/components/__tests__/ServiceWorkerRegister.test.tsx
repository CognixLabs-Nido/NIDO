import { render, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ServiceWorkerRegister } from '../ServiceWorkerRegister'

/**
 * El SW no se ejerce de verdad en jsdom (ni en Playwright sin setup específico
 * de PWA), así que aquí solo verificamos el contrato del componente: al montar
 * llama `navigator.serviceWorker.register('/sw.js')` y nunca rompe la app
 * cuando el SW no está disponible o el registro falla. La entrega real de push
 * se valida manualmente en dispositivo (ver body del PR).
 */
describe('ServiceWorkerRegister', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('registra /sw.js al montar', async () => {
    const register = vi.fn().mockResolvedValue({})
    vi.stubGlobal('navigator', { serviceWorker: { register } })

    render(<ServiceWorkerRegister />)

    await waitFor(() => expect(register).toHaveBeenCalledWith('/sw.js'))
  })

  it('no rompe si el navegador no soporta serviceWorker', () => {
    vi.stubGlobal('navigator', {})
    expect(() => render(<ServiceWorkerRegister />)).not.toThrow()
  })

  it('no rompe si register rechaza (catch silencioso)', async () => {
    const register = vi.fn().mockRejectedValue(new Error('boom'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('navigator', { serviceWorker: { register } })

    expect(() => render(<ServiceWorkerRegister />)).not.toThrow()
    await waitFor(() => expect(register).toHaveBeenCalled())
  })
})
