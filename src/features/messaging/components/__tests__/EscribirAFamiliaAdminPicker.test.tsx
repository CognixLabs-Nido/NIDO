import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { EscribirAFamiliaAdminPicker } from '../EscribirAFamiliaAdminPicker'
import type { VinculoTutorMin } from '../../queries/get-vinculos-tutores-aula'

/**
 * Tests unitarios de `EscribirAFamiliaAdminPicker` (F5B-#33).
 *
 * Cubre los tres modos discriminados por número de vínculos:
 *  - 0 tutores → render disabled con sr-only del motivo.
 *  - 1 tutor   → `<Link>` directo al SplitView con `?tutor=<id>`.
 *  - ≥2        → Dialog se abre al click; cada fila navega al elegirla.
 *
 * Y la ordenación: principal antes que secundario antes que autorizado,
 * alfabético dentro de cada grupo.
 */

const pushMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

const NINO_ID = 'nino-1'
const LOCALE = 'es'

function tutor(
  usuario_id: string,
  nombre: string,
  tipo: VinculoTutorMin['tipo_vinculo']
): VinculoTutorMin {
  return { usuario_id, nombre_completo: nombre, tipo_vinculo: tipo }
}

describe('EscribirAFamiliaAdminPicker', () => {
  it('0 tutores: render disabled con aria-disabled y sr-only del motivo', () => {
    render(<EscribirAFamiliaAdminPicker ninoId={NINO_ID} vinculos={[]} locale={LOCALE} />)
    const btn = screen.getByTestId('escribir-familia-button')
    expect(btn.getAttribute('aria-disabled')).toBe('true')
    expect(btn.getAttribute('href')).toBeNull()
    // El motivo está en sr-only (lo localiza por la clave i18n mocked).
    expect(screen.queryByText('picker_sin_tutores')).not.toBeNull()
  })

  it('1 tutor: render Link directo al SplitView con ese tutor', () => {
    render(
      <EscribirAFamiliaAdminPicker
        ninoId={NINO_ID}
        vinculos={[tutor('u-100', 'Marisol Pérez', 'tutor_legal_principal')]}
        locale={LOCALE}
      />
    )
    const link = screen.getByTestId('escribir-familia-button') as HTMLAnchorElement
    expect(link.tagName.toLowerCase()).toBe('a')
    expect(link.getAttribute('href')).toBe('/es/messages?tab=mensajeria&tutor=u-100')
  })

  it('1 tutor autorizado: igual usa Link directo con su id', () => {
    render(
      <EscribirAFamiliaAdminPicker
        ninoId={NINO_ID}
        vinculos={[tutor('u-200', 'Tía Carmen', 'autorizado')]}
        locale={LOCALE}
      />
    )
    const link = screen.getByTestId('escribir-familia-button') as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/es/messages?tab=mensajeria&tutor=u-200')
  })

  it('≥2 tutores: click abre Dialog y las filas aparecen ordenadas (principal → secundario → autorizado)', () => {
    render(
      <EscribirAFamiliaAdminPicker
        ninoId={NINO_ID}
        vinculos={[
          tutor('u-c', 'Carmen Cuidadora', 'autorizado'),
          tutor('u-b', 'Juan Pérez', 'tutor_legal_secundario'),
          tutor('u-a', 'Marisol Pérez', 'tutor_legal_principal'),
        ]}
        locale={LOCALE}
      />
    )

    // Click en el trigger abre el dialog.
    const trigger = screen.getByTestId('escribir-familia-button')
    fireEvent.click(trigger)

    const dialog = screen.getByTestId('picker-tutor-dialog')
    expect(dialog).not.toBeNull()

    // Las 3 filas deben aparecer en orden: principal, secundario, autorizado.
    const filas = screen.getAllByTestId(/^picker-tutor-item-/)
    expect(filas.map((f) => f.getAttribute('data-testid'))).toEqual([
      'picker-tutor-item-u-a',
      'picker-tutor-item-u-b',
      'picker-tutor-item-u-c',
    ])
  })

  it('≥2 tutores: click en una fila navega al SplitView con ese tutor', () => {
    render(
      <EscribirAFamiliaAdminPicker
        ninoId={NINO_ID}
        vinculos={[
          tutor('u-a', 'Marisol Pérez', 'tutor_legal_principal'),
          tutor('u-b', 'Juan Pérez', 'tutor_legal_secundario'),
        ]}
        locale={LOCALE}
      />
    )
    fireEvent.click(screen.getByTestId('escribir-familia-button'))
    fireEvent.click(screen.getByTestId('picker-tutor-item-u-b'))
    expect(pushMock).toHaveBeenCalledWith('/es/messages?tab=mensajeria&tutor=u-b')
  })

  it('2 tutores del mismo tipo: orden alfabético por nombre', () => {
    render(
      <EscribirAFamiliaAdminPicker
        ninoId={NINO_ID}
        vinculos={[
          tutor('u-z', 'Zoe Z', 'tutor_legal_principal'),
          tutor('u-a', 'Ana A', 'tutor_legal_principal'),
        ]}
        locale={LOCALE}
      />
    )
    fireEvent.click(screen.getByTestId('escribir-familia-button'))
    const filas = screen.getAllByTestId(/^picker-tutor-item-/)
    expect(filas.map((f) => f.getAttribute('data-testid'))).toEqual([
      'picker-tutor-item-u-a',
      'picker-tutor-item-u-z',
    ])
  })
})
