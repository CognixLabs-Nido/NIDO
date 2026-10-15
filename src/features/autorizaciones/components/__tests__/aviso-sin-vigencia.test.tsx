import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { MedicacionFicha } from '../MedicacionFicha'
import { RecogidaLista } from '../RecogidaLista'

/**
 * Sin autorización vigente porque la familia revocó o rechazó, la pantalla lo DICE.
 * Un hueco en blanco («Aún sin firmar») se leería como «no hay datos», no como «nadie
 * de esta lista puede recoger» o «esta medicación no se da».
 */

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))

describe('RecogidaLista — sin lista vigente', () => {
  it('control: sin firma, el texto de siempre y ningún aviso', () => {
    render(<RecogidaLista personas={[]} estadoFirma="pendiente" />)
    expect(screen.getByText('recogida.sin_firmar')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it.each(['revocado', 'rechazado'] as const)('%s: aviso de que nadie puede recoger', (estado) => {
    render(<RecogidaLista personas={[]} estadoFirma={estado} />)
    expect(screen.getByRole('alert').textContent).toBe(`recogida.sin_vigencia_${estado}`)
    expect(screen.queryByText('recogida.sin_firmar')).toBeNull()
  })
})

describe('MedicacionFicha — sin ficha vigente', () => {
  it('control: sin firma, el texto de siempre y ningún aviso', () => {
    render(<MedicacionFicha medicacion={null} estadoFirma="pendiente" />)
    expect(screen.getByText('recogida.sin_firmar')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it.each(['revocado', 'rechazado'] as const)('%s: aviso de que no se debe dar', (estado) => {
    render(<MedicacionFicha medicacion={null} estadoFirma={estado} />)
    expect(screen.getByRole('alert').textContent).toBe(`medicacion.sin_vigencia_${estado}`)
  })
})
