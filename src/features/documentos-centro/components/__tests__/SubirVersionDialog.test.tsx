import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Subir una versión (3c) y pedir que vuelvan a firmar (4d). Lo que tiene que aguantar: pedirlo solo
 * se ofrece si ese documento y ese curso ya tienen una versión (en la primera no hay nada que volver
 * a firmar), dice a cuántos niños se pediría, y lo que se manda está siempre dicho: «true» o «false».
 */
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, v?: Record<string, string | number>) =>
    v ? `${key}:${Object.values(v).join('|')}` : key,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { SubirVersionDialog } from '../SubirVersionDialog'

const CENTRO = '11111111-1111-4111-8111-111111111111'
const DOC = '22222222-2222-4222-8222-222222222222'
const ACTIVO = {
  id: '33333333-3333-4333-8333-333333333333',
  nombre: '2026/27',
  estado: 'activo' as const,
}

const enviado: FormData[] = []
beforeEach(() => {
  enviado.length = 0
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init: { body: FormData }) => {
      enviado.push(init.body)
      return { json: async () => ({ success: true }) }
    })
  )
})

async function abreYSube(
  props: { deCurso: boolean; anteriores: Record<string, number> },
  marcar = false
) {
  render(
    <SubirVersionDialog
      locale="es"
      centroId={CENTRO}
      documentoId={DOC}
      deCurso={props.deCurso}
      cursos={[ACTIVO]}
      anteriores={props.anteriores}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: /subir/ }))
  const input = await screen.findByLabelText('campos.fichero')
  fireEvent.change(input, {
    target: { files: [new File(['%PDF-1.4'], 'v.pdf', { type: 'application/pdf' })] },
  })
  if (marcar) fireEvent.click(screen.getByRole('checkbox'))
}

const enviar = async () => {
  const botones = screen.getAllByRole('button', { name: /subir/ })
  fireEvent.click(botones[botones.length - 1]!)
  await waitFor(() => expect(enviado).toHaveLength(1))
  return enviado[0]!
}

describe('SubirVersionDialog: pedir que vuelvan a firmar (4d)', () => {
  it('sin una versión anterior no se ofrece, y se manda «false»', async () => {
    await abreYSube({ deCurso: false, anteriores: {} })
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect((await enviar()).get('pide_refirma')).toBe('false')
  })

  it('con una anterior se ofrece, dice a cuántos niños, y marcado manda «true»', async () => {
    await abreYSube({ deCurso: false, anteriores: { '': 3 } }, true)
    expect(screen.getByTestId('pedir-refirma-ayuda').textContent).toBe('pedir_refirma_ayuda:3')
    const f = await enviar()
    expect(f.get('pide_refirma')).toBe('true')
    expect(f.get('curso_academico_id')).toBe('')
  })

  it('con una anterior y sin marcar, «false»: no pedirlo es decirlo', async () => {
    await abreYSube({ deCurso: false, anteriores: { '': 3 } })
    expect(screen.getByRole('checkbox')).toBeTruthy()
    expect((await enviar()).get('pide_refirma')).toBe('false')
  })

  it('en un documento de curso mira el curso elegido: con versión en otro curso, no se ofrece', async () => {
    await abreYSube({ deCurso: true, anteriores: { 'otro-curso': 5 } })
    expect(screen.queryByRole('checkbox')).toBeNull()
    const f = await enviar()
    expect(f.get('curso_academico_id')).toBe(ACTIVO.id)
    expect(f.get('pide_refirma')).toBe('false')
  })

  it('en un documento de curso con versión en el curso elegido, se ofrece', async () => {
    await abreYSube({ deCurso: true, anteriores: { [ACTIVO.id]: 1 } }, true)
    expect((await enviar()).get('pide_refirma')).toBe('true')
  })
})
