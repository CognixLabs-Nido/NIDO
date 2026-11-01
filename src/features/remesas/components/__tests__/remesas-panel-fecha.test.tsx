import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it, vi } from 'vitest'

import es from '@/../messages/es.json'

import { RemesasPanel } from '../RemesasPanel'

/**
 * El panel de remesas entero, con los textos de verdad: cada recibo por marcar dice cuándo se
 * cobra, el campo de fecha está debajo con su explicación a la vista, y cada remesa dice su fecha
 * y si se puede cambiar. Los hijos que no son de la fecha se sustituyen por dobles.
 */

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('../../actions/crear-remesa', () => ({ crearRemesa: vi.fn() }))
vi.mock('../../actions/anadir-a-remesa', () => ({ anadirARemesa: vi.fn() }))
vi.mock('../../actions/marcar-remesa-enviada', () => ({ marcarRemesaEnviada: vi.fn() }))
vi.mock('../../actions/fijar-fecha-cobro', () => ({ fijarFechaCobro: vi.fn() }))
vi.mock('@/features/cuotas-config/components/MesSelector', () => ({ MesSelector: () => null }))
vi.mock('@/features/beca-comedor/components/TransferenciasBecaPanel', () => ({
  TransferenciasBecaPanel: () => null,
}))
vi.mock('../DevolucionesPanel', () => ({ DevolucionesPanel: () => null }))
vi.mock('../DatosAcreedorDialog', () => ({ DatosAcreedorDialog: () => null }))
vi.mock('../RemesaXmlButton', () => ({ RemesaXmlButton: () => null }))

const recibo = (id: string, familia: string, fechaCobro: string | null) => ({
  id,
  familiaId: `f-${id}`,
  familiaEtiqueta: familia,
  tutores: [],
  totalCentimos: 10000,
  esEsporadico: false,
  tieneMandato: true,
  fechaCobro,
})

function pintar() {
  return render(
    <NextIntlClientProvider locale="es" messages={es} timeZone="Europe/Madrid">
      <RemesasPanel
        centroId="11111111-1111-4111-8111-111111111111"
        anio={2026}
        mes={11}
        acreedor={{
          identificadorAcreedor: 'ES00ZZZ00000000000',
          bicAcreedor: null,
          ibanConfigurado: true,
        }}
        recibos={[
          recibo('22222222-2222-4222-8222-222222222222', 'Familia Demo Uno', null),
          recibo('33333333-3333-4333-8333-333333333333', 'Familia Demo Dos', '2026-11-05'),
        ]}
        remesas={[
          {
            id: 'r1',
            estado: 'borrador',
            fechaEnvioBanco: null,
            ficheroGenerado: false,
            createdAt: '2026-11-01T10:00:00Z',
            numRecibos: 1,
            totalCentimos: 5000,
            recibos: [
              {
                id: 'x1',
                familiaEtiqueta: 'Familia Demo Tres',
                totalCentimos: 5000,
                fechaCobro: null,
              },
            ],
          },
          {
            id: 'r2',
            estado: 'enviada',
            fechaEnvioBanco: '2026-10-20',
            ficheroGenerado: true,
            createdAt: '2026-10-15T10:00:00Z',
            numRecibos: 1,
            totalCentimos: 7000,
            recibos: [
              {
                id: 'x2',
                familiaEtiqueta: 'Familia Demo Cuatro',
                totalCentimos: 7000,
                fechaCobro: '2026-10-25',
              },
            ],
          },
        ]}
        recibosGestion={[]}
        transferenciasBeca={{} as never}
        editarAcreedor={false}
      />
    </NextIntlClientProvider>
  )
}

describe('RemesasPanel · la fecha de cobro', () => {
  it('cada recibo por marcar dice cuándo se cobra, también el que no tiene fecha', () => {
    pintar()
    // Premisa: los dos recibos están en la lista.
    expect(screen.getByText('Familia Demo Uno')).toBeVisible()
    expect(screen.getByText('Familia Demo Dos')).toBeVisible()
    expect(screen.getByText('En cuanto el banco pueda')).toBeVisible()
    expect(screen.getByText('El 5 nov 2026')).toBeVisible()
  })

  it('el campo de fecha está a la vista con lo que pasa sin fecha', () => {
    pintar()
    expect(screen.getByLabelText('Fecha de cobro')).toHaveAccessibleDescription(
      es.remesas.fecha_cobro.explicacion
    )
  })

  it('la remesa en borrador se cambia; la enviada dice por qué no', () => {
    pintar()
    expect(screen.getByRole('button', { name: 'Cambiar fecha de cobro' })).toBeEnabled()
    expect(screen.getAllByRole('button', { name: 'Cambiar fecha de cobro' })).toHaveLength(1)
    expect(screen.getByText(/ya no se puede cambiar: la remesa ya se envió al banco/)).toBeVisible()
    expect(screen.getByText('Se cobra: El 25 oct 2026 (1)')).toBeVisible()
  })
})
