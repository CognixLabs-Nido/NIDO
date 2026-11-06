import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

/**
 * Los avisos de los inicios (fase 4, 4c). Lo que tiene que aguantar: una lectura fallida se dice
 * (callar diría «nada pendiente»), lo sin subir no se pinta como por firmar, cada niño lleva a su
 * ficha, y el enlace para subir solo lo ve la admin del centro (J1).
 */

vi.mock('next-intl/server', () => ({
  getTranslations: async (ns: string) => (k: string, v?: Record<string, string | number>) =>
    v ? `${ns}.${k}|${Object.values(v).join('|')}` : `${ns}.${k}`,
  getFormatter: async () => ({ dateTime: (d: Date) => d.toISOString().slice(0, 10) }),
}))

const { PendientesDocumentosDireccion } = await import('../PendientesDocumentosDireccion')
const { AvisoDocumentosFamilia } = await import('../AvisoDocumentosFamilia')

const LUCIA = '11111111-1111-4111-8111-111111111111'
const PABLO = '22222222-2222-4222-8222-222222222222'

const pendientes = {
  ok: true as const,
  data: {
    porFirmar: [
      {
        documentoId: 'normas',
        titulo: 'Normas',
        cursoNombre: null,
        ninos: [
          { ninoId: PABLO, nombre: 'Pablo Demo', desde: '2026-11-03T09:00:00Z' },
          { ninoId: LUCIA, nombre: 'Lucía Demo', desde: '2026-11-05T09:00:00Z' },
        ],
      },
    ],
    sinSubir: [{ documentoId: 'presu', titulo: 'Presupuesto', cursoNombre: '2026-2027', ninos: 2 }],
  },
}

describe('PendientesDocumentosDireccion', () => {
  it('lo por firmar y lo sin subir, cada uno en su sitio y con su texto', async () => {
    render(
      (await PendientesDocumentosDireccion({
        pendientes,
        esResponsable: true,
        locale: 'es',
      }))!
    )
    const porFirmar = screen.getByTestId('documento-por-firmar')
    expect(porFirmar.textContent).toContain(
      'firmar_documentos.inicio_direccion.por_firmar|«Normas»|2|2026-11-03'
    )
    const enlaces = [...porFirmar.querySelectorAll('a')].map((a) => a.getAttribute('href'))
    expect(enlaces).toEqual([
      `/es/admin/ninos/${PABLO}?tab=documentacion`,
      `/es/admin/ninos/${LUCIA}?tab=documentacion`,
    ])
    const sinSubir = screen.getByTestId('documento-sin-subir')
    expect(sinSubir.textContent).toContain(
      'firmar_documentos.inicio_direccion.sin_subir|«Presupuesto» · firmar_documentos.curso|2026-2027|2'
    )
    expect(sinSubir.querySelector('a')?.getAttribute('href')).toBe('/es/admin/documentos-centro')
  })

  it('la directora no ve el enlace para subir: la pantalla de documentos es de la admin', async () => {
    render(
      (await PendientesDocumentosDireccion({ pendientes, esResponsable: false, locale: 'es' }))!
    )
    // Premisa: la línea sale; lo que falta es solo el enlace.
    expect(screen.getByTestId('documento-sin-subir')).toBeTruthy()
    expect(screen.getByTestId('documento-sin-subir').querySelector('a')).toBeNull()
  })

  it('si la lectura falla, lo dice; no se calla', async () => {
    const el = await PendientesDocumentosDireccion({
      pendientes: { ok: false, error: 'firmar_documentos.errors.leer' },
      esResponsable: true,
      locale: 'es',
    })
    expect(el).not.toBeNull()
    render(el!)
    expect(screen.getByRole('status').textContent).toBe(
      'firmar_documentos.inicio_direccion.no_comprobado'
    )
  })

  it('sin nada pendiente, nada', async () => {
    expect(
      await PendientesDocumentosDireccion({
        pendientes: { ok: true, data: { porFirmar: [], sinSubir: [] } },
        esResponsable: true,
        locale: 'es',
      })
    ).toBeNull()
  })
})

describe('AvisoDocumentosFamilia', () => {
  it('una línea por hijo a su ficha, y la lectura fallida dicha', async () => {
    render(
      (await AvisoDocumentosFamilia({
        hijos: [
          { ninoId: LUCIA, nombre: 'Lucía', n: 2 },
          { ninoId: PABLO, nombre: 'Pablo', n: null },
        ],
        locale: 'es',
      }))!
    )
    const enlace = screen.getByRole('link')
    expect(enlace.getAttribute('href')).toBe(`/es/family/nino/${LUCIA}#documentos-centro`)
    expect(enlace.textContent).toBe('firmar_documentos.inicio_familia.por_firmar|Lucía|2')
    expect(screen.getByRole('status').textContent).toBe(
      'firmar_documentos.inicio_familia.no_comprobado|Pablo'
    )
  })

  it('sin hijos con algo debido, nada', async () => {
    expect(await AvisoDocumentosFamilia({ hijos: [], locale: 'es' })).toBeNull()
  })
})
