import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Censo C, clase 1 (BlogAulaCliente:200, 2026-11-26): al cerrar una publicación nueva sin fotos ni texto se borra,
 * para no dejar un post vacío en el blog. Ese borrado se tiraba: si fallaba, el post vacío quedaba a la vista de
 * las familias y nadie lo sabía. Ahora se dice.
 */
const m = vi.hoisted(() => ({
  crear: vi.fn(),
  eliminar: vi.fn(),
  toastError: vi.fn(),
  refresh: vi.fn(),
}))
vi.mock('next-intl', () => ({
  useTranslations: (ns?: string) => (k: string) => (ns ? `${ns}.${k}` : k),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: m.refresh }) }))
vi.mock('sonner', () => ({ toast: { error: m.toastError, success: vi.fn() } }))
vi.mock('../../actions/etiquetar', () => ({ etiquetarNino: vi.fn(), desetiquetarNino: vi.fn() }))
vi.mock('../../actions/gestionar-publicacion', () => ({
  crearPublicacion: m.crear,
  editarPublicacion: vi.fn(),
  eliminarMedia: vi.fn(),
  eliminarPublicacion: m.eliminar,
}))

const { BlogAulaCliente } = await import('../BlogAulaCliente')

const AULA = '11111111-1111-4111-8111-111111111111'
const PUB = '22222222-2222-4222-8222-222222222222'

beforeEach(() => {
  vi.clearAllMocks()
  m.crear.mockResolvedValue({ success: true, data: { publicacion_id: PUB } })
})

async function abrirYCerrarVacia() {
  render(<BlogAulaCliente locale="es" aulaId={AULA} ninos={[]} puedePublicar publicaciones={[]} />)
  fireEvent.click(screen.getByRole('button', { name: /fotos\.composer\.nueva/ }))
  const cerrar = await screen.findByRole('button', { name: 'fotos.composer.cerrar' })
  // Premisa: el editor de la nueva está abierto y ya no espera a crearla (el botón se deshabilita mientras).
  await waitFor(() => expect(cerrar).not.toBeDisabled())
  fireEvent.click(cerrar)
  await waitFor(() => expect(m.eliminar).toHaveBeenCalledWith({ publicacion_id: PUB }))
  await waitFor(() => expect(m.refresh).toHaveBeenCalled())
}

describe('blog del aula · la publicación vacía que no se pudo descartar', () => {
  it('control: si se borra, no hay aviso', async () => {
    m.eliminar.mockResolvedValue({ success: true, data: undefined })
    await abrirYCerrarVacia()
    expect(m.toastError).not.toHaveBeenCalled()
  })

  it('si el borrado falla, se dice que sigue en el blog', async () => {
    m.eliminar.mockResolvedValue({ success: false, error: 'fotos.errors.borrar_fallo' })
    await abrirYCerrarVacia()
    expect(m.toastError).toHaveBeenCalledWith('fotos.composer.vacia_no_borrada')
  })
})
