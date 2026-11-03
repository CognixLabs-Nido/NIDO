import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it, vi } from 'vitest'

import es from '@/../messages/es.json'

import type { RemesaListItem } from '../../queries/get-remesas-mes'
import { RemesasPanel } from '../RemesasPanel'

/**
 * Quién ve «Reabrir» y en qué remesas: solo la admin del centro (`reabrir`, que la página calcula
 * como responsable y no superusuario, igual que `privado.es_titular`), y solo donde hay algo que
 * reabrir: la enviada y la que tiene el fichero descargado. Un borrador sin fichero no lo enseña: se
 * edita sin reabrir, y la BD lo rechazaría (`nada_que_reabrir`). El diálogo se sustituye por un
 * doble que dice de qué remesa es.
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
vi.mock('../RemesaFechaCobro', () => ({ RemesaFechaCobro: () => null }))
vi.mock('../ReabrirRemesaDialog', () => ({
  ReabrirRemesaDialog: ({ remesaId }: { remesaId: string }) => (
    <span data-testid="reabrir">{remesaId}</span>
  ),
}))

const remesa = (
  id: string,
  estado: RemesaListItem['estado'],
  ficheroGenerado: boolean
): RemesaListItem => ({
  id,
  estado,
  fechaEnvioBanco: estado === 'enviada' ? '2026-10-20' : null,
  ficheroGenerado,
  createdAt: '2026-10-15T10:00:00Z',
  numRecibos: 1,
  totalCentimos: 5000,
  recibos: [],
})

const REMESAS = [
  remesa('borrador-sin-fichero', 'borrador', false),
  remesa('borrador-con-fichero', 'borrador', true),
  remesa('enviada', 'enviada', true),
  remesa('enviada-sin-marca', 'enviada', false),
]

function pintar(reabrir: boolean) {
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
        recibos={[]}
        remesas={REMESAS}
        recibosGestion={[]}
        transferenciasBeca={{} as never}
        editarAcreedor={reabrir}
        reabrir={reabrir}
      />
    </NextIntlClientProvider>
  )
}

const conBoton = () => screen.queryAllByTestId('reabrir').map((e) => e.textContent)

describe('RemesasPanel · reabrir', () => {
  it('la admin lo ve en la enviada (con y sin marca) y en el borrador con fichero; no en el borrador sin él', () => {
    pintar(true)
    expect(conBoton()).toEqual(['borrador-con-fichero', 'enviada', 'enviada-sin-marca'])
  })

  it('nadie más lo ve, en ninguna remesa', () => {
    pintar(false)
    // Premisa: las cuatro remesas están pintadas.
    expect(screen.getAllByText(/1 recibos · 50,00/)).toHaveLength(4)
    expect(conBoton()).toEqual([])
  })
})
