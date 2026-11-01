import { fireEvent, render, screen, within } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it, vi } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'

import { FechaCobroForm } from '../FechaCobroForm'
import { RemesaFechaCobro } from '../RemesaFechaCobro'

/**
 * La fecha de cobro en pantalla (F3 de «La fecha de cobro», `docs/specs/altas-serie.md`). Con los
 * textos de verdad, no con las claves: lo que se prueba es lo que lee la directora.
 *
 *  - Qué pasa sin fecha está escrito junto al campo, sin abrir ni pasar el ratón por nada.
 *  - Con el fichero generado o la remesa enviada no hay botón: se dice por qué no se deja.
 */

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('../../actions/fijar-fecha-cobro', () => ({ fijarFechaCobro: vi.fn() }))

const C = '11111111-1111-4111-8111-111111111111'
const R1 = '22222222-2222-4222-8222-222222222222'
const R2 = '33333333-3333-4333-8333-333333333333'

function conTextos(ui: React.ReactNode, locale = 'es', messages: object = es) {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="Europe/Madrid">
      {ui}
    </NextIntlClientProvider>
  )
}

const recibos = [
  { id: R1, familiaEtiqueta: 'Familia Demo Uno', totalCentimos: 12000, fechaCobro: null },
  { id: R2, familiaEtiqueta: 'Familia Demo Dos', totalCentimos: 8050, fechaCobro: '2026-11-05' },
]

describe('la fecha de cobro en pantalla', () => {
  it('junto al campo, a la vista, dice qué pasa sin fecha', () => {
    conTextos(<FechaCobroForm centroId={C} reciboIds={[R1]} />)
    const campo = screen.getByLabelText('Fecha de cobro')
    // Premisa: el campo está vacío y el texto no depende de abrir nada.
    expect(campo).toHaveValue('')
    const explicacion = screen.getByText(/Si no pones fecha, el banco lo cobra en cuanto pueda/)
    expect(explicacion).toBeVisible()
    // Y es la descripción del campo: un lector de pantalla la lee con él.
    expect(campo).toHaveAccessibleDescription(explicacion.textContent!)
  })

  it('en los tres idiomas, el texto de «sin fecha» se pinta junto al campo', () => {
    for (const [locale, messages] of [
      ['es', es],
      ['en', en],
      ['va', va],
    ] as const) {
      const textos = messages.remesas.fecha_cobro
      const { unmount } = conTextos(
        <FechaCobroForm centroId={C} reciboIds={[R1]} />,
        locale,
        messages
      )
      expect(screen.getByLabelText(textos.label)).toHaveAccessibleDescription(textos.explicacion)
      expect(screen.getByText(textos.explicacion)).toBeVisible()
      unmount()
    }
  })

  it('cada recibo de la remesa dice su fecha, y el de sin fecha, «en cuanto el banco pueda»', () => {
    conTextos(
      <RemesaFechaCobro
        centroId={C}
        remesa={{ estado: 'borrador', ficheroGenerado: false, recibos }}
      />
    )
    expect(
      screen.getByText('Se cobra: En cuanto el banco pueda (1) · El 5 nov 2026 (1)')
    ).toBeVisible()
  })

  it('en borrador sin fichero se puede cambiar, a todos o a los que se marquen', () => {
    conTextos(
      <RemesaFechaCobro
        centroId={C}
        remesa={{ estado: 'borrador', ficheroGenerado: false, recibos }}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar fecha de cobro' }))
    const dialogo = screen.getByRole('dialog')
    // Al abrir, todos marcados.
    expect(
      within(dialogo)
        .getAllByRole('checkbox')
        .every((c) => c.getAttribute('aria-checked') === 'true')
    ).toBe(true)
    expect(
      within(dialogo).getByRole('button', { name: 'Dejar sin fecha los 2 marcados' })
    ).toBeEnabled()
    // Uno solo.
    fireEvent.click(within(dialogo).getAllByRole('checkbox')[0])
    expect(
      within(dialogo).getByRole('button', { name: 'Dejar sin fecha el recibo marcado' })
    ).toBeEnabled()
    // Y la explicación también aquí.
    expect(within(dialogo).getByText(/el banco lo cobra en cuanto pueda/)).toBeVisible()
  })

  it('con el fichero generado no hay botón: dice por qué', () => {
    conTextos(
      <RemesaFechaCobro
        centroId={C}
        remesa={{ estado: 'borrador', ficheroGenerado: true, recibos }}
      />
    )
    expect(screen.queryByRole('button', { name: 'Cambiar fecha de cobro' })).toBeNull()
    expect(
      screen.getByText(/ya no se puede cambiar: el fichero de esta remesa ya está generado/)
    ).toBeVisible()
    // Premisa: la fecha se sigue viendo.
    expect(screen.getByText(/^Se cobra:/)).toBeVisible()
  })

  it('enviada no hay botón: dice que ya se envió al banco', () => {
    conTextos(
      <RemesaFechaCobro
        centroId={C}
        remesa={{ estado: 'enviada', ficheroGenerado: true, recibos }}
      />
    )
    expect(screen.queryByRole('button', { name: 'Cambiar fecha de cobro' })).toBeNull()
    expect(screen.getByText(/ya no se puede cambiar: la remesa ya se envió al banco/)).toBeVisible()
  })
})
