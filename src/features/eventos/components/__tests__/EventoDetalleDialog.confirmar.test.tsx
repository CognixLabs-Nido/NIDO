import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { EventoDetalle, RosterConfirmacion } from '../../types'

vi.mock('../../actions/confirmar-asistencia', () => ({ confirmarAsistencia: vi.fn() }))
vi.mock('../../actions/cancelar-evento', () => ({ cancelarEvento: vi.fn() }))
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { EventoDetalleDialog } from '../EventoDetalleDialog'

/**
 * Solo confirman los padres (Jose, 2026-11-13; `20270125130000`). En la vista de familia, el roster
 * sale con los niños de los que quien mira es tutor legal (`puede_confirmar`); al autorizado que solo
 * lo es no le sale el bloque de confirmaciones, y el evento sí. El staff ve el roster entero.
 */
function fila(nino_id: string, puede_confirmar: boolean): RosterConfirmacion {
  return {
    nino_id,
    nino_nombre: `Niño ${nino_id}`,
    estado: 'pendiente',
    comentario: null,
    confirmado_at: null,
    puede_confirmar,
  }
}

function detalle(roster: RosterConfirmacion[], confirmaciones_leidas = true): EventoDetalle {
  return {
    evento: {
      id: 'ev-1',
      ambito: 'aula',
      tipo: 'excursion',
      titulo: 'Excursión Demo',
      descripcion: null,
      lugar: null,
      fecha: '2099-06-01',
      fecha_fin: null,
      hora_inicio: null,
      hora_fin: null,
      requiere_confirmacion: true,
      estado: 'programado',
      aula_id: 'aula-1',
      nino_id: null,
    },
    roster,
    es_autor: false,
    confirmaciones_leidas,
  }
}

function pinta(d: EventoDetalle, esFamilia: boolean) {
  render(
    <EventoDetalleDialog
      open
      onOpenChange={() => {}}
      detalle={d}
      esAdmin={false}
      esFamilia={esFamilia}
      hoyYmd="2099-01-01"
      onChanged={() => {}}
      onEditar={() => {}}
    />
  )
}

describe('EventoDetalleDialog: solo confirman los padres', () => {
  it('el tutor legal ve y confirma a su hijo, y no al niño del que solo es autorizado', () => {
    pinta(detalle([fila('legal', true), fila('autorizado', false)]), true)
    expect(screen.getByTestId('confirmar-legal')).toBeTruthy()
    expect(screen.queryByText('Niño autorizado')).toBeNull()
    expect(screen.queryByTestId('confirmar-autorizado')).toBeNull()
  })

  it('el autorizado que solo lo es ve el evento, sin el bloque de confirmaciones', () => {
    pinta(detalle([fila('autorizado', false)]), true)
    expect(screen.getByText('Excursión Demo')).toBeTruthy()
    expect(screen.queryByTestId('evento-roster')).toBeNull()
    expect(screen.queryByText('detalle.sin_ninos')).toBeNull()
  })

  it('censo C: si no se pudo leer de qué niños es tutor legal, la familia lo ve dicho, no un evento sin confirmar', () => {
    pinta(detalle([fila('legal', false)], false), true)
    expect(screen.getByText('detalle.confirmaciones_no_leidas')).toBeTruthy()
    expect(screen.queryByTestId('confirmar-legal')).toBeNull()
  })

  it('control: leído, al autorizado no se le dice nada de lecturas', () => {
    pinta(detalle([fila('autorizado', false)]), true)
    expect(screen.queryByText('detalle.confirmaciones_no_leidas')).toBeNull()
  })

  it('control: el staff ve el roster entero, sin botones', () => {
    pinta(detalle([fila('legal', false), fila('otro', false)]), false)
    expect(screen.getByText('Niño legal')).toBeTruthy()
    expect(screen.getByText('Niño otro')).toBeTruthy()
    expect(screen.queryByTestId('confirmar-legal')).toBeNull()
  })
})
