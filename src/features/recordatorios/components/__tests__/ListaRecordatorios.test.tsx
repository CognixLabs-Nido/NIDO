import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { RecordatorioListItem } from '../../types'

// RecordatorioItem (hijo) arrastra actions/navigation/sonner/intl: los mockeamos.
vi.mock('../../actions/completar-recordatorio', () => ({ completarRecordatorio: vi.fn() }))
vi.mock('../../actions/anular-recordatorio', () => ({ anularRecordatorio: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { ListaRecordatorios } from '../ListaRecordatorios'

function item(id: string): RecordatorioListItem {
  return {
    id,
    destinatario: 'familia_individual',
    nino_id: null,
    nino_nombre: null,
    aula_id: null,
    aula_nombre: null,
    usuario_destinatario_nombre: null,
    titulo: `recordatorio ${id}`,
    descripcion: null,
    vencimiento: null,
    completado_en: null,
    completado_por: null,
    erroneo: false,
    creado_por: 'u',
    autor_nombre: null,
    created_at: new Date().toISOString(),
    es_propio: false,
  }
}

describe('ListaRecordatorios', () => {
  it('renderiza un item por recordatorio', () => {
    render(
      <ListaRecordatorios
        titulo="Pendientes"
        items={[item('a'), item('b')]}
        userId="u"
        locale="es"
        emptyLabel="vacío"
        testid="lista"
      />
    )
    expect(screen.getAllByTestId('recordatorio-item')).toHaveLength(2)
    expect(screen.queryByText('vacío')).not.toBeInTheDocument()
  })

  it('estado vacío: muestra emptyLabel y ningún item', () => {
    render(
      <ListaRecordatorios
        titulo="Pendientes"
        items={[]}
        userId="u"
        locale="es"
        emptyLabel="No hay nada"
        testid="lista"
      />
    )
    expect(screen.getByText('No hay nada')).toBeInTheDocument()
    expect(screen.queryByTestId('recordatorio-item')).not.toBeInTheDocument()
  })
})
