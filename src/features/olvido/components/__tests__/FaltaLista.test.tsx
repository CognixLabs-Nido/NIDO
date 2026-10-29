import { render, screen } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import { describe, expect, it } from 'vitest'

import es from '@/../messages/es.json'

import { FaltaLista } from '../FaltaLista'

/**
 * La petición retenida por un procedimiento abierto (20261206120000): la familia ve que está
 * retenida y por qué tipo de motivo, con los textos reales.
 */
function pinta(falta: Parameters<typeof FaltaLista>[0]['falta']) {
  return render(
    <NextIntlClientProvider locale="es" messages={es}>
      <FaltaLista falta={falta} />
    </NextIntlClientProvider>
  )
}

describe('FaltaLista: la retención', () => {
  it('dice que hay un procedimiento abierto y su tipo de motivo', () => {
    pinta({ bloqueos: [{ codigo: 'retenido', n: 1, motivo_tipo: 'juzgado' }], avisos: [] })
    expect(screen.getByText(es.olvido.falta.titulo_bloqueos)).toBeTruthy()
    const item = screen.getByRole('listitem')
    expect(item.textContent).toContain('procedimiento abierto')
    expect(item.textContent).toContain(es.datos_bloqueados.motivos.juzgado)
  })

  it('los demás códigos siguen con su número', () => {
    pinta({ bloqueos: [{ codigo: 'recibos_pendientes', n: 3 }], avisos: [] })
    expect(screen.getByRole('listitem').textContent).toContain('(3)')
  })
})
