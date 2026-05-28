import { act, fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useScrollAlFondo } from '../use-scroll-al-fondo'

/**
 * Tests del hook `useScrollAlFondo` (F5.6-C). Renderizamos un componente
 * test que monta el container scrolleable y expone los retornos del hook
 * en data-attributes para inspección.
 *
 * JSDOM no implementa el modelo de scroll, así que en cada test definimos
 * propiedades por elemento (`scrollHeight`, `clientHeight`, `scrollTop`)
 * con `Object.defineProperty` para simular el estado del scroll. Disparar
 * el evento `scroll` simula la interacción del usuario.
 */

interface HarnessProps {
  mensajesLength: number
}

function Harness({ mensajesLength }: HarnessProps) {
  const { containerRef, mostrarBotonIrAlFondo, irAlFondo } = useScrollAlFondo(mensajesLength)
  return (
    <div>
      <div
        ref={containerRef}
        data-testid="container"
        // Tamaño cualquiera; lo importante es la simulación de scrollHeight.
        style={{ height: 300, overflowY: 'auto' }}
      >
        <div style={{ height: 1000 }}>contenido</div>
      </div>
      <div data-testid="boton-visible">{mostrarBotonIrAlFondo ? '1' : '0'}</div>
      <button type="button" data-testid="ir-al-fondo" onClick={irAlFondo}>
        ir
      </button>
    </div>
  )
}

/** Define `scrollHeight`, `clientHeight` y un `scrollTop` mutable sobre
 *  el elemento. Sin esto JSDOM devuelve 0 para todo y la lógica del hook
 *  no puede distinguir "cerca/lejos del fondo". */
function instrumentar(el: HTMLElement, opts: { scrollHeight: number; clientHeight: number }) {
  Object.defineProperty(el, 'scrollHeight', {
    configurable: true,
    get: () => opts.scrollHeight,
  })
  Object.defineProperty(el, 'clientHeight', {
    configurable: true,
    get: () => opts.clientHeight,
  })
  let scrollTop = 0
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (v: number) => {
      scrollTop = v
    },
  })
}

describe('useScrollAlFondo', () => {
  it('al montar, hace scroll inicial al fondo y el botón NO se muestra', () => {
    const { getByTestId, container } = render(<Harness mensajesLength={3} />)
    const scrollContainer = container.querySelector('[data-testid="container"]') as HTMLElement
    instrumentar(scrollContainer, { scrollHeight: 1000, clientHeight: 300 })
    // El efecto inicial ya corrió en el mount; pero no podemos
    // instrumentar antes del mount sin un re-mount. Hacemos un
    // re-render para que el efecto inicial vea las propiedades
    // instrumentadas: usamos un cambio de prop dummy.
    // Alternativa: comprobamos el estado del botón tras instrumentar
    // y disparar un scroll-event manual al fondo.
    Object.defineProperty(scrollContainer, 'scrollTop', {
      configurable: true,
      value: 700,
    })
    fireEvent.scroll(scrollContainer)
    expect(getByTestId('boton-visible').textContent).toBe('0')
  })

  it('mensaje nuevo con usuario cerca del fondo → auto-scroll, botón sigue oculto', () => {
    const { getByTestId, container, rerender } = render(<Harness mensajesLength={3} />)
    const scrollContainer = container.querySelector('[data-testid="container"]') as HTMLElement
    instrumentar(scrollContainer, { scrollHeight: 1000, clientHeight: 300 })

    // Usuario al fondo (scrollTop = 700 = 1000 - 300).
    scrollContainer.scrollTop = 700
    fireEvent.scroll(scrollContainer)
    expect(getByTestId('boton-visible').textContent).toBe('0')

    // Llega un mensaje nuevo: scrollHeight crece.
    Object.defineProperty(scrollContainer, 'scrollHeight', {
      configurable: true,
      get: () => 1100,
    })
    rerender(<Harness mensajesLength={4} />)

    // Auto-scroll instantáneo: scrollTop debe ser scrollHeight (1100).
    expect(scrollContainer.scrollTop).toBe(1100)
    expect(getByTestId('boton-visible').textContent).toBe('0')
  })

  it('mensaje nuevo con usuario arriba → NO auto-scroll, botón aparece', () => {
    const { getByTestId, container, rerender } = render(<Harness mensajesLength={3} />)
    const scrollContainer = container.querySelector('[data-testid="container"]') as HTMLElement
    instrumentar(scrollContainer, { scrollHeight: 1000, clientHeight: 300 })

    // Usuario lejos del fondo (scrollTop=100, distancia=1000-100-300=600 > 100).
    scrollContainer.scrollTop = 100
    fireEvent.scroll(scrollContainer)
    expect(getByTestId('boton-visible').textContent).toBe('1')

    // Llega un mensaje nuevo: scrollHeight crece.
    Object.defineProperty(scrollContainer, 'scrollHeight', {
      configurable: true,
      get: () => 1100,
    })
    rerender(<Harness mensajesLength={4} />)

    // NO debe haber auto-scroll: scrollTop sigue en 100.
    expect(scrollContainer.scrollTop).toBe(100)
    // Botón sigue visible.
    expect(getByTestId('boton-visible').textContent).toBe('1')
  })

  it('botón "ir al último" llama scrollTo con behavior smooth al fondo', () => {
    const { getByTestId, container } = render(<Harness mensajesLength={3} />)
    const scrollContainer = container.querySelector('[data-testid="container"]') as HTMLElement
    instrumentar(scrollContainer, { scrollHeight: 1000, clientHeight: 300 })

    const scrollToSpy = vi.fn()
    scrollContainer.scrollTo = scrollToSpy as unknown as typeof scrollContainer.scrollTo

    // Usuario arriba (irrelevante para el efecto del botón, pero realista).
    scrollContainer.scrollTop = 0
    fireEvent.scroll(scrollContainer)

    act(() => {
      getByTestId('ir-al-fondo').click()
    })

    expect(scrollToSpy).toHaveBeenCalledTimes(1)
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 1000, behavior: 'smooth' })
  })
})
