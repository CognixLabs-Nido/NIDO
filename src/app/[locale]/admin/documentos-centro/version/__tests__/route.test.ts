// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Subir una versión (3a) y pedir que vuelvan a firmar (4d). Lo que tiene que aguantar la ruta: pedirlo
 * llega dicho, «true» o «false». Lo que falte o sea otra cosa no se lee como «no pedir»: se rechaza
 * antes de subir nada. El diálogo lo manda siempre; esto es lo que pasa si algo no lo manda.
 */

const CENTRO = '11111111-1111-4111-8111-111111111111'
const DOC = '22222222-2222-4222-8222-222222222222'

vi.mock('@/lib/supabase/server', () => ({ createClient: () => Promise.resolve({}) }))
vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: () => ({}) }))

const subir = vi.fn()
vi.mock('@/features/documentos-centro/lib/versiones', () => ({
  MAX_PDF_BYTES: 10 * 1024 * 1024,
  subirVersionDocumento: (...a: unknown[]) => subir(...a),
}))

import { POST } from '@/app/[locale]/admin/documentos-centro/version/route'

function peticion(pide: string | null): Request {
  const form = new FormData()
  form.append('centro_id', CENTRO)
  form.append('documento_id', DOC)
  form.append('curso_academico_id', '')
  if (pide !== null) form.append('pide_refirma', pide)
  form.append('file', new Blob(['%PDF-1.4'], { type: 'application/pdf' }), 'v.pdf')
  return new Request('http://localhost/es/admin/documentos-centro/version', {
    method: 'POST',
    body: form,
  })
}

beforeEach(() => {
  subir.mockReset()
  subir.mockResolvedValue({ ok: true, data: { versionId: 'v', numero: 2 } })
})

describe('POST /admin/documentos-centro/version: pedir que vuelvan a firmar (4d)', () => {
  it.each([
    ['true', true],
    ['false', false],
  ])('«%s» llega a la subida como %s', async (pide, esperado) => {
    const r = await POST(peticion(pide))
    expect(r.status).toBe(200)
    expect(subir).toHaveBeenCalledTimes(1)
    expect(subir.mock.calls[0]![2]).toMatchObject({
      centroId: CENTRO,
      documentoId: DOC,
      cursoId: null,
      pideRefirma: esperado,
    })
  })

  it.each([
    ['sin el campo', null],
    ['con otra cosa', 'si'],
  ])('%s, se rechaza y no se sube nada', async (_caso, pide) => {
    const r = await POST(peticion(pide))
    expect(r.status).toBe(400)
    expect(await r.json()).toEqual({ success: false, error: 'documentos_centro.errors.invalido' })
    expect(subir).not.toHaveBeenCalled()
  })
})
