import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import es from '@/../messages/es.json'

import type { AvisoReabrir, ResumenReabrir } from '../../lib/aviso-reabrir'
import { ReabrirRemesaDialog } from '../ReabrirRemesaDialog'

/**
 * El aviso de reabrir, con los textos de verdad: ANTES de que la admin pueda confirmar, dice a
 * cuántas familias afecta y por cuánto, el riesgo de cobrar dos veces según el caso, y por su nombre
 * a las familias que no se tocan. Confirmar manda los números que se enseñaron.
 */

const { leer, reabrir, toastOk } = vi.hoisted(() => ({
  leer: vi.fn(),
  reabrir: vi.fn(),
  toastOk: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success: toastOk, error: vi.fn() } }))
vi.mock('../../actions/leer-aviso-reabrir', () => ({ leerAvisoReabrir: leer }))
vi.mock('../../actions/reabrir-remesa', () => ({ reabrirRemesa: reabrir }))

const ID = '11111111-1111-4111-8111-111111111111'

function resumen(cambios: Partial<ResumenReabrir> = {}): ResumenReabrir {
  return {
    estado: 'enviada',
    fecha_envio_banco: '2026-10-20',
    fichero_generado_at: '2026-10-19T09:00:00+00:00',
    fichero_guardado: true,
    n_recibos: 3,
    n_familias: 2,
    total_centimos: 34500,
    n_enviados: 3,
    n_devueltos: 0,
    n_cobrados: 0,
    ...cambios,
  }
}

function aviso(cambios: Partial<AvisoReabrir> = {}): AvisoReabrir {
  return { remesaId: ID, resumen: resumen(), caso: 'enviada', noSeTocan: [], ...cambios }
}

function abrir() {
  render(
    <NextIntlClientProvider locale="es" messages={es} timeZone="Europe/Madrid">
      <ReabrirRemesaDialog remesaId={ID} />
    </NextIntlClientProvider>
  )
  fireEvent.click(screen.getByRole('button', { name: 'Reabrir' }))
}

const confirmar = () => screen.queryByRole('button', { name: 'Reabrir la remesa' })

/** El botón de confirmar, ya pulsable: sale con el aviso y se habilita al acabar la lectura. */
async function confirmarListo() {
  const b = await screen.findByRole('button', { name: 'Reabrir la remesa' })
  await waitFor(() => expect(b).toBeEnabled())
  return b
}

beforeEach(() => {
  leer.mockReset()
  reabrir.mockReset()
  toastOk.mockReset()
})

describe('ReabrirRemesaDialog', () => {
  it('mientras no tiene el aviso, no se puede confirmar', async () => {
    let soltar: (v: unknown) => void = () => {}
    leer.mockReturnValue(new Promise((r) => (soltar = r)))
    abrir()
    expect(await screen.findByText('Leyendo la remesa…')).toBeInTheDocument()
    expect(confirmar()).toBeNull()
    soltar({ success: true, data: aviso() })
    // Premisa del «no»: con el aviso, el botón sí sale.
    expect(await screen.findByRole('button', { name: 'Reabrir la remesa' })).toBeInTheDocument()
    expect(leer).toHaveBeenCalledWith({ remesaId: ID })
  })

  it('enviada: la fecha, el riesgo de cobrar dos veces, las familias y el importe', async () => {
    leer.mockResolvedValue({ success: true, data: aviso() })
    abrir()
    expect(
      await screen.findByText(/Esta remesa se marcó enviada al banco el 2026-10-20\./)
    ).toBeInTheDocument()
    expect(screen.getByText(/se cobraría dos veces/)).toBeInTheDocument()
    expect(
      screen.getByText(/Afecta a 2 familias, por 345,00\s€ \(3 recibos\)\./)
    ).toBeInTheDocument()
    expect(confirmar()).toBeInTheDocument()
  })

  it('enviada sin marca de descarga: dice que NIDO no tiene constancia, no que no se envió', async () => {
    leer.mockResolvedValue({
      success: true,
      data: aviso({
        resumen: resumen({
          fichero_generado_at: null,
          fichero_guardado: false,
          n_familias: 1,
          n_recibos: 1,
          total_centimos: 1200,
        }),
        caso: 'enviada_sin_constancia',
      }),
    })
    abrir()
    expect(
      await screen.findByText(/NIDO no tiene constancia de que su fichero se descargara/)
    ).toBeInTheDocument()
    expect(screen.getByText(/Afecta a 1 familia, por 12,00\s€ \(1 recibo\)\./)).toBeInTheDocument()
  })

  it('con el fichero descargado y en borrador: si lo subiste al banco, anúlalo', async () => {
    leer.mockResolvedValue({
      success: true,
      data: aviso({
        resumen: resumen({ estado: 'borrador', fecha_envio_banco: null }),
        caso: 'fichero_descargado',
      }),
    })
    abrir()
    expect(
      await screen.findByText(/El fichero de esta remesa ya se descargó.*Si lo subiste al banco/)
    ).toBeInTheDocument()
  })

  it('nombra a los devueltos y cobrados a mano, con su importe, antes de confirmar', async () => {
    leer.mockResolvedValue({
      success: true,
      data: aviso({
        resumen: resumen({ n_devueltos: 1, n_cobrados: 1 }),
        noSeTocan: [
          {
            id: 'r3',
            familiaEtiqueta: 'Familia Demo Alba',
            totalCentimos: 5000,
            estado: 'devuelto',
          },
          {
            id: 'r2',
            familiaEtiqueta: 'Familia Demo Beta',
            totalCentimos: 7000,
            estado: 'cobrado_manual',
          },
        ],
      }),
    })
    abrir()
    expect(await screen.findByText(/Estos 2 recibos no se tocan/)).toBeInTheDocument()
    const alba = screen.getByText('Familia Demo Alba').closest('li')!
    expect(alba).toHaveTextContent('Devuelto por el banco')
    expect(alba).toHaveTextContent('50,00')
    const beta = screen.getByText('Familia Demo Beta').closest('li')!
    expect(beta).toHaveTextContent('Cobrado a mano')
    expect(beta).toHaveTextContent('70,00')
    // Y todo eso está a la vista con el botón de confirmar todavía sin pulsar.
    expect(confirmar()).toBeInTheDocument()
    expect(reabrir).not.toHaveBeenCalled()
  })

  it('sin devueltos ni cobrados no pinta la lista', async () => {
    leer.mockResolvedValue({ success: true, data: aviso() })
    abrir()
    await screen.findByText(/Afecta a 2 familias/)
    expect(screen.queryByText(/no se tocan/)).toBeNull()
  })

  it('confirmar manda los números que se enseñaron, y avisa de cuántos vuelven', async () => {
    // Un borrador con el fichero descargado: 3 cobrables y ninguno enviado. Con números distintos,
    // mandar los enviados en vez de los que se enseñaron se pone rojo.
    leer.mockResolvedValue({
      success: true,
      data: aviso({
        resumen: resumen({ estado: 'borrador', fecha_envio_banco: null, n_enviados: 0 }),
        caso: 'fichero_descargado',
      }),
    })
    reabrir.mockResolvedValue({ success: true, data: { nAPendiente: 3 } })
    abrir()
    fireEvent.click(await confirmarListo())
    await waitFor(() =>
      expect(reabrir).toHaveBeenCalledWith({ remesaId: ID, nRecibos: 3, totalCentimos: 34500 })
    )
    await waitFor(() =>
      expect(toastOk).toHaveBeenCalledWith(
        'Remesa reabierta: 3 recibos vuelven a pendientes de cobro.'
      )
    )
  })

  it('si la remesa cambió, no la da por reabierta y enseña los números de ahora', async () => {
    leer.mockResolvedValueOnce({ success: true, data: aviso() }).mockResolvedValueOnce({
      success: true,
      data: aviso({ resumen: resumen({ n_familias: 3, n_recibos: 4, total_centimos: 46000 }) }),
    })
    reabrir.mockResolvedValue({ success: false, error: 'remesas.errors.remesa_cambiada' })
    abrir()
    fireEvent.click(await confirmarListo())
    expect(await screen.findByRole('alert')).toHaveTextContent(/no se ha reabierto/)
    expect(
      await screen.findByText(/Afecta a 3 familias, por 460,00\s€ \(4 recibos\)\./)
    ).toBeInTheDocument()
    expect(toastOk).not.toHaveBeenCalled()
    expect(leer).toHaveBeenCalledTimes(2)
  })

  it('si el aviso no se puede leer, lo dice y no hay botón de confirmar', async () => {
    leer.mockResolvedValue({ success: false, error: 'remesas.errors.aviso_incompleto' })
    abrir()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /no podemos enseñarte a quién no se toca/
    )
    expect(confirmar()).toBeNull()
  })
})
