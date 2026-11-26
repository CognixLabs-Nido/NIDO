import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { AvisosInicio } from '../../types'

/**
 * Censo C, clase 1 (2026-11-26): `getAltasSinTerminar` contesta `null` si no pudo leer, y el inicio de Dirección lo
 * convertía en 0 (`?? []`): el aviso de las altas sin terminar desaparecía como si no hubiera ninguna. Ahora el
 * aviso lleva `null` y la pantalla dice que no se pudo leer.
 */
vi.mock('next-intl/server', () => ({
  getTranslations: async (ns: string) => (k: string, v?: Record<string, unknown>) =>
    `${ns}.${k}${v ? `(${Object.values(v).join(',')})` : ''}`,
}))
vi.mock('next/link', () => ({
  default: (p: { href: string; children: React.ReactNode }) => <a href={p.href}>{p.children}</a>,
}))

const { AvisosInicioContenido } = await import('../AvisosInicio')

const VACIO: AvisosInicio = {
  pendientesConfirmar: 0,
  pendientesFirma: 0,
  confirmadas: 0,
  firmadas: 0,
  medicacionesActivas: 0,
  nuevasFirmas: 0,
  revocaciones: 0,
  medicacionesPorArchivar: 0,
  informesNuevos: 0,
  fotosNuevas: 0,
  recibosNuevos: 0,
  campanaPendientes: null,
  altasPendientesValidar: 0,
  altasSinTerminar: 0,
  familiasDomiciliacionNueva: [],
}

async function pinta(altasSinTerminar: number | null) {
  const el = await AvisosInicioContenido({
    avisos: { ...VACIO, altasSinTerminar },
    rol: 'admin',
    locale: 'es',
  })
  return el ? render(el) : null
}

describe('inicio de Dirección · altas sin terminar', () => {
  it('control: con 2 propuestas, el aviso con el número', async () => {
    await pinta(2)
    expect(screen.getByText('notificaciones.avisos.altas_sin_terminar(2)')).toBeInTheDocument()
    expect(screen.queryByText('notificaciones.avisos.altas_sin_terminar_no_leido')).toBeNull()
  })

  it('con 0, nada (no hay nada que avisar)', async () => {
    expect(await pinta(0)).toBeNull()
  })

  it('sin leer (null): lo dice, no desaparece como un 0', async () => {
    await pinta(null)
    expect(
      screen.getByText('notificaciones.avisos.altas_sin_terminar_no_leido')
    ).toBeInTheDocument()
  })
})
