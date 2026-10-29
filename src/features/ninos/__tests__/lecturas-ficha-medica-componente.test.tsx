import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import es from '@/../messages/es.json'

import type { RegistroLecturas } from '../queries/get-lecturas-ficha-medica'

/**
 * El registro de lecturas en la ficha del niño y su botón de descarga: la familia lo descarga para
 * guardarlo (es su derecho de acceso, art. 15) y la Dirección, para entregárselo al tutor que ya no
 * entra. Sin registro leído no hay botón: no se descarga un documento que no se ha podido leer.
 */

vi.mock('server-only', () => ({}))
vi.mock('next-intl/server', () => ({
  getLocale: async () => 'es',
  getTranslations: async () => (key: string) => {
    let v: unknown = es.ficha_medica_lecturas
    for (const parte of key.split('.')) v = (v as Record<string, unknown> | undefined)?.[parte]
    if (typeof v !== 'string') throw new Error(`falta ficha_medica_lecturas.${key}`)
    return v
  },
}))
vi.mock('@/features/export/components/ExportButton', () => ({
  ExportButton: ({ href, label }: { href: string; label: string }) => <a href={href}>{label}</a>,
}))

const { LecturasFichaMedica } = await import('../components/LecturasFichaMedica')

const HREF = '/es/export/lecturas-ficha-medica/nino-1'
const OK: RegistroLecturas = {
  tipo: 'ok',
  lecturas: [
    {
      leidaEn: '2026-07-15T10:30:00Z',
      lector: 'Profe Demo',
      rol: 'profe',
      origen: 'ficha',
      campos: ['alergias_graves'],
    },
  ],
}

async function pintar(
  registro: RegistroLecturas,
  descarga?: { href: string; para: 'guardar' | 'entregar' }
) {
  const el = await LecturasFichaMedica({ registro, descarga })
  return render(<>{el}</>)
}

describe('LecturasFichaMedica', () => {
  it('la familia lo descarga para guardarlo', async () => {
    await pintar(OK, { href: HREF, para: 'guardar' })
    // Premisa: el registro se ha pintado.
    expect(screen.getByText('Profe Demo')).toBeTruthy()
    const boton = screen.getByRole('link', { name: 'Descargar el registro' })
    expect(boton.getAttribute('href')).toBe(HREF)
    expect(screen.queryByText('Descargar el registro para entregarlo')).toBeNull()
  })

  it('la Dirección lo descarga para entregarlo', async () => {
    await pintar(OK, { href: HREF, para: 'entregar' })
    const boton = screen.getByRole('link', { name: 'Descargar el registro para entregarlo' })
    expect(boton.getAttribute('href')).toBe(HREF)
  })

  it('sin descarga pedida no hay botón', async () => {
    await pintar(OK)
    expect(screen.getByText('Profe Demo')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('con el registro sin leer no hay botón, y sin permiso no hay sección', async () => {
    await pintar({ tipo: 'error' }, { href: HREF, para: 'guardar' })
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()

    const { container } = await pintar({ tipo: 'no_autorizado' }, { href: HREF, para: 'guardar' })
    expect(container.innerHTML).toBe('')
  })

  it('bloqueado (el niño está purgado): dice desde cuándo y por qué, sin lecturas ni botón', async () => {
    await pintar({ tipo: 'bloqueado', desde: '2027-03-01' }, { href: HREF, para: 'entregar' })
    expect(screen.getByText(/^Bloqueado desde el/)).toBeTruthy()
    expect(screen.getByText(/art\. 32 LOPDGDD/)).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })
})
