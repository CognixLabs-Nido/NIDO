import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { NinoAgendaResumen } from '../../types'
import { NinoAgendaCard } from '../NinoAgendaCard'

/**
 * Censo C (B1, 2026-11-26): la tarjeta del niño en la agenda del aula, con la agenda sin leer. Antes la
 * acción devolvía la agenda vacía y la tarjeta enseñaba los formularios en blanco: guardar ahí pisaba lo
 * que no se había leído. Ahora la acción da `null` y la tarjeta dice «no se ha podido leer», con
 * «Reintentar», en vez del panel. Fixtures ficticios.
 */
const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('../../actions/fetch-agenda-del-dia', () => ({ fetchAgendaDelDia: fetchMock }))
vi.mock('../NinoAgendaPanel', () => ({
  NinoAgendaPanel: ({ agenda }: { agenda: unknown }) => (
    <div data-testid="panel-agenda" data-cargada={agenda ? 'si' : 'no'} />
  ),
}))
vi.mock('@/features/ninos/components/TarjetaSanitariaButton', () => ({
  TarjetaSanitariaButton: () => null,
}))
vi.mock('@/features/familias/components/LlamarFamiliaButton', () => ({
  LlamarFamiliaButton: () => null,
}))

const RESUMEN = {
  nino: {
    id: 'n-1',
    nombre: 'Niño',
    apellidos: 'Demo',
    fecha_nacimiento: '2025-01-01',
    foto_url: null,
  },
  agenda_id: 'ag-1',
  counts: { comidas: 1, biberones: 0, suenos: 0, deposiciones: 0 },
  alertas: { alergia_grave: false, medicacion: false },
} as unknown as NinoAgendaResumen

const AGENDA = { cabecera: null, comidas: [], biberones: [], suenos: [], deposiciones: [] }

function pintar() {
  render(
    <NinoAgendaCard
      resumen={RESUMEN}
      fecha="2026-11-26"
      locale="es"
      diaCerrado={false}
      expanded
      onToggle={() => {}}
      refreshKey={0}
      rol="profe"
    />
  )
}

beforeEach(() => {
  fetchMock.mockReset()
})

describe('NinoAgendaCard: la agenda sin leer', () => {
  it('premisa: con la agenda leída, el panel con ella', async () => {
    fetchMock.mockResolvedValue(AGENDA)
    pintar()
    await waitFor(() =>
      expect(screen.getByTestId('panel-agenda')).toHaveAttribute('data-cargada', 'si')
    )
    expect(screen.queryByTestId('no-se-pudo-leer-seccion')).not.toBeInTheDocument()
  })

  it('sin leerla: «no se ha podido leer» en vez del panel, y «Reintentar» la vuelve a pedir', async () => {
    fetchMock.mockResolvedValueOnce(null).mockResolvedValueOnce(AGENDA)
    pintar()
    const aviso = await screen.findByTestId('no-se-pudo-leer-seccion')
    expect(screen.queryByTestId('panel-agenda')).not.toBeInTheDocument()
    fireEvent.click(aviso.querySelector('button')!)
    await waitFor(() =>
      expect(screen.getByTestId('panel-agenda')).toHaveAttribute('data-cargada', 'si')
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('si la acción no contesta (red): lo mismo', async () => {
    fetchMock.mockImplementation(() => Promise.reject(new Error('red')))
    pintar()
    expect(await screen.findByTestId('no-se-pudo-leer-seccion')).toBeInTheDocument()
    expect(screen.queryByTestId('panel-agenda')).not.toBeInTheDocument()
  })
})
