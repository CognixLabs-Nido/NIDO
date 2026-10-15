import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MedicacionDatos, RosterFirmaNino } from '../../types'
import { FirmarAutorizacionPanel } from '../FirmarAutorizacionPanel'

/**
 * El botón de firmar no se deshabilita por lo que falta: al pulsarlo, firmar() dice qué falta
 * con un aviso por cada cosa (las claves ya existían). Antes se deshabilitaba con las mismas
 * condiciones y esos avisos no se veían nunca: el tutor tenía un botón muerto sin explicación.
 */

const { toastError, firmarMock } = vi.hoisted(() => ({
  toastError: vi.fn(),
  firmarMock: vi.fn(),
}))

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: toastError } }))
vi.mock('../../actions/firmar-autorizacion', () => ({
  firmarAutorizacion: firmarMock,
  rechazarAutorizacion: vi.fn(),
  revocarFirma: vi.fn(),
}))
// El trazo real es un canvas; aquí un botón que «firma».
vi.mock('../FirmaPad', () => ({
  FirmaPad: ({ onChange }: { onChange: (v: string | null) => void }) => (
    <button type="button" onClick={() => onChange('data:image/png;base64,trazo')}>
      trazar
    </button>
  ),
}))
vi.mock('../PersonasAutorizadasEditor', () => ({ PersonasAutorizadasEditor: () => null }))
vi.mock('../MedicacionFicha', () => ({ MedicacionFicha: () => null }))

const ROSTER: RosterFirmaNino[] = [
  { nino_id: 'n-1', nino_nombre: 'Niño Demo 1', estado: 'pendiente', firmantes: [] },
] as unknown as RosterFirmaNino[]

function pintar(props: Partial<Parameters<typeof FirmarAutorizacionPanel>[0]> = {}) {
  render(
    <FirmarAutorizacionPanel
      autorizacionId="a-1"
      tipo="reglas_regimen_interno"
      firmable
      roster={ROSTER}
      currentUserId="u-1"
      currentUserNombre="Tutor Pruebas"
      {...props}
    />
  )
  return screen.getByRole('button', { name: 'acciones.firmar' })
}

describe('FirmarAutorizacionPanel — el botón de firmar explica lo que falta', () => {
  beforeEach(() => {
    toastError.mockReset()
    firmarMock.mockReset()
    firmarMock.mockResolvedValue({ success: true, data: null })
  })

  it('sin casilla ni trazo, el botón está activo y al pulsarlo pide la casilla', () => {
    const boton = pintar()
    expect(boton).toBeEnabled()
    fireEvent.click(boton)
    expect(toastError).toHaveBeenCalledWith('errors.confirma_requerido')
    expect(firmarMock).not.toHaveBeenCalled()
  })

  it('con la casilla y sin trazo, pide la firma', () => {
    const boton = pintar()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(boton)
    expect(toastError).toHaveBeenCalledWith('validation.firma_requerida')
    expect(firmarMock).not.toHaveBeenCalled()
  })

  it('recogida sin personas válidas: pide la lista', () => {
    const boton = pintar({ tipo: 'recogida' })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'trazar' }))
    fireEvent.click(boton)
    expect(toastError).toHaveBeenCalledWith('validation.personas_vacio')
    expect(firmarMock).not.toHaveBeenCalled()
  })

  it('medicación sin datos vigentes: lo dice', () => {
    const boton = pintar({ tipo: 'medicacion', medicacionInicial: null })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'trazar' }))
    fireEvent.click(boton)
    expect(toastError).toHaveBeenCalledWith('errors.medicacion_requerida')
    expect(firmarMock).not.toHaveBeenCalled()
  })

  it('con todo puesto, firma sin avisos', () => {
    const boton = pintar({
      tipo: 'medicacion',
      medicacionInicial: { medicamento: 'Demo' } as unknown as MedicacionDatos,
    })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'trazar' }))
    fireEvent.click(boton)
    expect(toastError).not.toHaveBeenCalled()
    expect(firmarMock).toHaveBeenCalledTimes(1)
  })
})
