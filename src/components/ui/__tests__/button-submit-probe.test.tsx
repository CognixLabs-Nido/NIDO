import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Button } from '../button'

/**
 * Probe empírico: ¿el <Button> de NIDO (wrapper de @base-ui/react/button)
 * propaga `type="submit"` al DOM real o lo sobrescribe a `type="button"`?
 *
 * Resultado decide si la regla "no usar <Button type='submit'>" aplica
 * a TODO el proyecto o solo al composer de mensajería.
 */
describe('probe: <Button type="submit"> propagation', () => {
  it('renders the type attribute that the caller passes', () => {
    render(
      <Button type="submit" data-testid="probe-button">
        Probe
      </Button>
    )
    const btn = screen.getByTestId('probe-button') as HTMLButtonElement
    // Lee el atributo DOM: si es 'submit' → patrón sano; si es 'button' →
    // base-ui sobrescribe y la regla "no usar <Button type='submit'>" es
    // universal.
    expect(btn.getAttribute('type')).toBe('submit')
    expect(btn.type).toBe('submit')
  })

  it('default type with no `type` prop is "button"', () => {
    render(<Button data-testid="probe-default">Default</Button>)
    const btn = screen.getByTestId('probe-default') as HTMLButtonElement
    expect(btn.getAttribute('type')).toBe('button')
  })
})
