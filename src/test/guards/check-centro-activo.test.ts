// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { revisar, sinComentarios } from '../../../scripts/check-centro-activo.mjs'

import * as LISTA from '../../../scripts/check-centro-activo.lista.mjs'

/**
 * El guard de multicentro (como `check-club-activo` de MisterFC). Corre en la CI con el resto de
 * unit tests: el primer bloque mira el árbol de verdad; el segundo demuestra que caza, con un
 * árbol de mentira donde cada caso tiene que ponerse rojo. Desde el PR5 no hay lista de
 * pendientes: la única lista es la de lecturas de `roles_usuario` que miran a otro usuario.
 */

const RAIZ = path.resolve(__dirname, '../../..')

describe('el árbol real cumple', () => {
  it('sin problemas, y con el recuento impreso', () => {
    const { problemas, recuento } = revisar(RAIZ)
    expect(problemas).toEqual([])
    // Premisa: el guard ha mirado el árbol de verdad (si no encontrara nada, no mediría nada).
    expect(recuento.lecturasRoles).toBeGreaterThan(0)
    expect(recuento.usosDeprecadas).toBe(0)
  })

  it('no queda sitio para excepciones: la lista solo exporta LECTURAS_PERMITIDAS', () => {
    expect(Object.keys(LISTA)).toEqual(['LECTURAS_PERMITIDAS'])
  })
})

describe('caza lo que tiene que cazar (árbol de mentira)', () => {
  let raiz: string
  const VACIA = { LECTURAS_PERMITIDAS: {} }

  function fichero(rel: string, contenido: string) {
    const abs = path.join(raiz, rel)
    mkdirSync(path.dirname(abs), { recursive: true })
    writeFileSync(abs, contenido)
  }

  function nuevoArbol() {
    raiz = mkdtempSync(path.join(tmpdir(), 'guard-centro-'))
    fichero('src/features/x/ok.ts', 'export const x = 1\n')
  }

  afterEach(() => rmSync(raiz, { recursive: true, force: true }))

  it('control: un árbol sin lecturas ni deprecadas pasa', () => {
    nuevoArbol()
    expect(revisar(raiz, VACIA).problemas).toEqual([])
  })

  it('una lectura nueva de roles_usuario fuera del contexto → rojo', () => {
    nuevoArbol()
    fichero(
      'src/features/x/centro-a-mano.ts',
      "const r = await supabase\n  .from('roles_usuario')\n  .select('centro_id').limit(1)\n"
    )
    expect(revisar(raiz, VACIA).problemas).toEqual([
      expect.stringContaining('src/features/x/centro-a-mano.ts: 1 lectura(s) de roles_usuario'),
    ])
  })

  it('la misma lectura DENTRO del módulo de contexto → pasa', () => {
    nuevoArbol()
    fichero('src/features/centros/contexto/leer.ts', "supabase.from('roles_usuario')\n")
    expect(revisar(raiz, VACIA).problemas).toEqual([])
  })

  it('una lectura solo en un comentario NO es una lectura', () => {
    nuevoArbol()
    fichero(
      'src/app/comentado.ts',
      "/* supabase.from('roles_usuario') */\nconst url = 'http://x'\n"
    )
    expect(revisar(raiz, VACIA).problemas).toEqual([])
  })

  it('getCentroActualId (también en import multilínea) → rojo', () => {
    nuevoArbol()
    fichero(
      'src/app/pagina.tsx',
      "import {\n  getCentroActualId,\n} from '@/features/centros/queries/get-centro-actual'\n"
    )
    expect(revisar(raiz, VACIA).problemas).toEqual([
      expect.stringContaining('src/app/pagina.tsx: nombra getCentroActualId/getRolEnCentro 1 vez'),
    ])
  })

  it('getRolEnCentro nombrada solo en un comentario → rojo (ninguna mención)', () => {
    nuevoArbol()
    fichero('src/app/comentario.ts', '// el rol lo da getRolEnCentro(c)\nexport const y = 1\n')
    expect(revisar(raiz, VACIA).problemas).toEqual([
      expect.stringContaining('src/app/comentario.ts: nombra getCentroActualId/getRolEnCentro'),
    ])
  })

  it('una lista con pendientes no las admite: el guard no tiene sitio para ellas', () => {
    nuevoArbol()
    fichero(
      'src/app/pendiente.tsx',
      "import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'\n"
    )
    const conPendientes = {
      ...VACIA,
      PENDIENTES_GET_CENTRO: { 'src/app/pendiente.tsx': 1 },
      LECTURAS_PENDIENTES: { 'src/app/pendiente.tsx': 1 },
    }
    expect(revisar(raiz, conPendientes).problemas).toEqual([
      expect.stringContaining('src/app/pendiente.tsx: nombra getCentroActualId/getRolEnCentro'),
    ])
  })

  it('la lista rancia también es rojo: una lectura permitida que ya no existe', () => {
    nuevoArbol()
    const lista = { LECTURAS_PERMITIDAS: { 'src/features/x/ok.ts': { n: 1, motivo: 'otro' } } }
    expect(revisar(raiz, lista).problemas).toEqual([expect.stringContaining('Bórrala de la lista')])
  })

  it('una lectura de más en un fichero con lecturas permitidas → rojo', () => {
    nuevoArbol()
    fichero('src/features/x/mixto.ts', 'a.from(\'roles_usuario\')\nb.from("roles_usuario")\n')
    const lista = {
      LECTURAS_PERMITIDAS: { 'src/features/x/mixto.ts': { n: 1, motivo: 'otro usuario' } },
    }
    expect(revisar(raiz, lista).problemas).toEqual([
      expect.stringContaining('2 lectura(s) de roles_usuario y la lista admite 1'),
    ])
  })
})

describe('sinComentarios', () => {
  it('quita comentarios y respeta cadenas con // dentro', () => {
    expect(sinComentarios("a // x\nb /* y */ c 'http://z' `//t`")).toBe("a \nb  c 'http://z' `//t`")
  })
})
