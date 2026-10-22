import { readFileSync } from 'fs'
import { join } from 'path'

import { act, render, screen } from '@testing-library/react'
import { toast } from 'sonner'
import { describe, expect, it } from 'vitest'

import { Toaster } from '../sonner'

/**
 * Sin un <Toaster /> montado, `toast.*` no pinta nada y no da error: los avisos de toda la app
 * (más de 300 llamadas) fueron invisibles desde la Fase 0 hasta que se montó en el layout del
 * locale. Se mide el MONTAJE, no el nombre: el import solo, o un `<Toaster />` dentro de un
 * comentario, no lo cumplen.
 */
const LAYOUT = 'src/app/[locale]/layout.tsx'

function sinComentarios(src: string): string {
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
}

describe('Toaster montado', () => {
  const fuente = sinComentarios(readFileSync(join(process.cwd(), LAYOUT), 'utf8'))

  it('el layout del locale renderiza <Toaster> una vez, dentro del <body>', () => {
    const cuerpo = fuente.slice(fuente.indexOf('<body'), fuente.indexOf('</body>'))
    expect(cuerpo.length).toBeGreaterThan(0)
    expect(cuerpo.match(/<Toaster\b/g)).toHaveLength(1)
    expect(fuente.match(/<Toaster\b/g)).toHaveLength(1)
  })

  it('claro a la fuerza: la app no tiene ThemeProvider ni modo oscuro', () => {
    expect(fuente).toMatch(/<Toaster\b[^>]*\btheme="light"/)
  })

  it('con el Toaster montado, un toast se ve', async () => {
    render(<Toaster theme="light" />)
    act(() => {
      toast.error('Aviso de prueba')
    })
    expect(await screen.findByText('Aviso de prueba')).toBeTruthy()
  })
})
