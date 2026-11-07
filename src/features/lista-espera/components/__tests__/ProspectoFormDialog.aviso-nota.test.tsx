import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ProspectoFormDialog } from '../ProspectoFormDialog'

/**
 * 2c (decisión del responsable del 2026-11-02): la nota del prospecto sale en el export art. 15
 * del tutor, y quien la escribe lo ve AL escribirla: el aviso es la descripción del propio campo,
 * al crear y al editar.
 */

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('../../actions/crear-prospecto', () => ({ crearProspecto: vi.fn() }))
vi.mock('../../actions/editar-prospecto', () => ({ editarProspecto: vi.fn() }))
vi.mock('../../actions/resolver-tutor', () => ({ resolverTutorParaProspecto: vi.fn() }))

describe('ProspectoFormDialog — el aviso de la nota', () => {
  it.each([
    ['al crear', undefined],
    [
      'al editar',
      {
        id: 'p-1',
        nombre_nino: 'Lucía',
        apellidos_nino: 'Demo',
        primer_apellido_nino: 'Demo',
        segundo_apellido_nino: null,
        fecha_nacimiento: '2024-01-01',
        telefono_tutor: null,
        email_tutor: 'tutor@nido.test',
        nota: 'Una nota',
        posicion: 1,
        estado: 'en_espera' as const,
        tutor_usuario_id: null,
        nino_id: null,
        estado_matricula: null,
        necesita_parentesco: false,
      },
    ],
  ])('%s, el campo de la nota lleva el aviso como descripción', (_, prospecto) => {
    render(
      <ProspectoFormDialog
        cursoId="curso-1"
        prospecto={prospecto}
        trigger={<button type="button">abrir</button>}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'abrir' }))
    const nota = screen.getByLabelText('fields.nota')
    // Premisa: es el campo de la nota, no otro.
    expect(nota).toHaveAttribute('id', 'nota')
    expect(nota).toHaveAccessibleDescription('fields.nota_aviso')
  })
})
