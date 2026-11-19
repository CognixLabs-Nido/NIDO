import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }))
vi.mock('../AutorizarImagenNinoButton', () => ({
  AutorizarImagenNinoButton: () => <i data-testid="b-autorizar" />,
}))
vi.mock('../DenegarImagenNinoButton', () => ({
  DenegarImagenNinoButton: () => <i data-testid="b-denegar" />,
}))
vi.mock('../RetirarNoImagenNinoButton', () => ({
  RetirarNoImagenNinoButton: () => <i data-testid="b-retirar-no" />,
}))
vi.mock('../RevocarImagenNinoButton', () => ({
  RevocarImagenNinoButton: () => <i data-testid="b-revocar" />,
}))

import type { EstadoImagenNino } from '../../queries/get-estado-imagen-nino'
import { estadoImagenClave, ImagenAutorizacionTutor } from '../ImagenAutorizacionTutor'

const e = (p: Partial<EstadoImagenNino>): EstadoImagenNino => ({
  visible: false,
  hayVigente: false,
  miVigente: false,
  miNo: false,
  hayOposicion: false,
  ...p,
})
const NINO = '22222222-2222-4222-8222-222222222222'
const botones = () =>
  ['b-autorizar', 'b-denegar', 'b-retirar-no', 'b-revocar'].filter((id) => screen.queryByTestId(id))

/**
 * La ficha del niño de la familia (fase 10, 10a-2): cada tutor responde por sí (decisión del
 * responsable del 2026-11-17). Qué estado ve y qué puede hacer con su respuesta.
 */
describe('ImagenAutorizacionTutor', () => {
  it('estadoImagenClave: visible, mi «no», un «sí» sin salir en fotos, y nada', () => {
    expect(estadoImagenClave(e({ visible: true, hayVigente: true, miVigente: true }))).toBe(
      'concedida'
    )
    expect(estadoImagenClave(e({ miNo: true }))).toBe('denegada_por_mi')
    // Mi «sí» y un «no» vigente de otro (lo dice `oposicion_imagen`): hay una oposición.
    expect(estadoImagenClave(e({ miVigente: true, hayOposicion: true }))).toBe('oposicion')
    // 10b-3: sin respuesta mía, la base distingue «otro se ha opuesto» de «nadie ha dicho que sí».
    expect(estadoImagenClave(e({ hayOposicion: true }))).toBe('oposicion_sin_respuesta')
    expect(estadoImagenClave(e({}))).toBe('no_autorizada')
    // Mi «sí» y un consentimiento que vale, y aun así no sale: falta el «sí» del otro (los dos firmantes).
    expect(estadoImagenClave(e({ miVigente: true, hayVigente: true }))).toBe('pendiente_otro')
    // Mi «no» manda sobre la oposición de otro: lo que se le dice es lo suyo.
    expect(estadoImagenClave(e({ miNo: true, hayOposicion: true }))).toBe('denegada_por_mi')
  })

  it('sin respuesta: autorizar y no autorizar', () => {
    render(<ImagenAutorizacionTutor ninoId={NINO} nombreCompleto="Niño Demo 1" estado={e({})} />)
    expect(botones()).toEqual(['b-autorizar', 'b-denegar'])
  })

  it('con mi «no»: autorizar y retirar mi «no», sin repetir el «no»', () => {
    render(
      <ImagenAutorizacionTutor
        ninoId={NINO}
        nombreCompleto="Niño Demo 1"
        estado={e({ miNo: true })}
      />
    )
    expect(screen.getByTestId('imagen-estado-denegada_por_mi')).toBeInTheDocument()
    expect(botones()).toEqual(['b-autorizar', 'b-retirar-no'])
  })

  it('con mi «sí» y el niño oculto: no autorizar y revocar', () => {
    render(
      <ImagenAutorizacionTutor
        ninoId={NINO}
        nombreCompleto="Niño Demo 1"
        estado={e({ miVigente: true })}
      />
    )
    expect(botones()).toEqual(['b-denegar', 'b-revocar'])
  })
})
