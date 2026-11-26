import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * El aviso al volver a autorizar la imagen (censo C, B1, 2026-11-26): si la acción no pudo leer si el
 * niño ya se ve (`visible: null`), el aviso no dice «falta la del otro tutor»: dice solo que queda
 * registrada. Fixtures ficticios.
 */
const { accion, toastSuccess } = vi.hoisted(() => ({
  accion: { visible: true as boolean | null },
  toastSuccess: vi.fn(),
}))
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('sonner', () => ({ toast: { success: toastSuccess, error: vi.fn() } }))
vi.mock('../../actions/otorgar-imagen-nino', () => ({
  otorgarImagenNino: async () => ({ success: true, data: { visible: accion.visible } }),
}))

import { AutorizarImagenNinoButton } from '../AutorizarImagenNinoButton'

beforeEach(() => toastSuccess.mockClear())

async function autorizar() {
  render(<AutorizarImagenNinoButton ninoId="n-1" nombreCompleto="Niño Demo" />)
  fireEvent.click(screen.getByTestId('autorizar-imagen-button'))
  fireEvent.click(await screen.findByTestId('autorizar-imagen-confirm'))
  await waitFor(() => expect(toastSuccess).toHaveBeenCalledTimes(1))
  return toastSuccess.mock.calls[0]?.[0]
}

describe('AutorizarImagenNinoButton: el aviso tras autorizar', () => {
  it.each([
    [true, 'exito'],
    [false, 'exito_pendiente'],
    [null, 'exito_sin_estado'],
  ] as const)('visible=%s → «%s»', async (visible, clave) => {
    accion.visible = visible
    expect(await autorizar()).toBe(clave)
  })
})
