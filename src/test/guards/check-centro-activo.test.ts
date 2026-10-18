// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { revisar, sinComentarios } from '../../../scripts/check-centro-activo.mjs'

/**
 * El guard de multicentro · Fase 1 (como `check-club-activo` de MisterFC). Corre en la CI con el
 * resto de unit tests: el primer bloque mira el árbol de verdad; el segundo demuestra que caza,
 * con un árbol de mentira donde cada caso tiene que ponerse rojo.
 */

const RAIZ = path.resolve(__dirname, '../../..')

describe('el árbol real cumple', () => {
  it('sin problemas, y con el recuento impreso', () => {
    const { problemas, recuento } = revisar(RAIZ)
    expect(problemas).toEqual([])
    // Premisa: el guard ha mirado el árbol de verdad (si no encontrara nada, no mediría nada).
    expect(recuento.lecturasRoles).toBeGreaterThan(0)
    expect(recuento.ficherosConDeprecadas).toBeGreaterThan(0)
    expect(recuento.usosDeprecadas).toBeGreaterThanOrEqual(2 * recuento.ficherosConDeprecadas)
  })
})

describe('caza lo que tiene que cazar (árbol de mentira)', () => {
  let raiz: string
  const VACIA = { LECTURAS_PERMITIDAS: {}, LECTURAS_PENDIENTES: {}, PENDIENTES_GET_CENTRO: {} }

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

  it('un uso nuevo de getCentroActualId (también en import multilínea) → rojo', () => {
    nuevoArbol()
    fichero(
      'src/app/pagina.tsx',
      "import {\n  getCentroActualId,\n} from '@/features/centros/queries/get-centro-actual'\n"
    )
    expect(revisar(raiz, VACIA).problemas).toEqual([
      expect.stringContaining('src/app/pagina.tsx: nombra getCentroActualId'),
    ])
  })

  it('un nombre solo en un comentario NO es un uso', () => {
    nuevoArbol()
    fichero(
      'src/app/comentado.ts',
      "// antes: getCentroActualId()\n/* supabase.from('roles_usuario') */\nconst url = 'http://x'\n"
    )
    expect(revisar(raiz, VACIA).problemas).toEqual([])
  })

  it('la lista rancia también es rojo: una entrada que ya no hace falta', () => {
    nuevoArbol()
    const lista = {
      LECTURAS_PERMITIDAS: {},
      LECTURAS_PENDIENTES: { 'src/features/x/ok.ts': 1 },
      PENDIENTES_GET_CENTRO: { 'src/features/x/ok.ts': 2 },
    }
    const { problemas } = revisar(raiz, lista)
    expect(problemas).toHaveLength(2)
    expect(problemas.join('\n')).toContain('Bórrala de la lista')
    expect(problemas.join('\n')).toContain(
      'PENDIENTES_GET_CENTRO admite 2 uso(s) de las deprecadas y hay 0'
    )
  })

  const PAGINA_PENDIENTE =
    "import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'\n" +
    'const c = await getCentroActualId()\n'

  it('un fichero de la lista con sus usos justos → pasa', () => {
    nuevoArbol()
    fichero('src/app/pendiente.tsx', PAGINA_PENDIENTE)
    const lista = { ...VACIA, PENDIENTES_GET_CENTRO: { 'src/app/pendiente.tsx': 2 } }
    expect(revisar(raiz, lista).problemas).toEqual([])
  })

  it('una llamada NUEVA en un fichero que ya estaba en la lista → rojo', () => {
    nuevoArbol()
    fichero('src/app/pendiente.tsx', PAGINA_PENDIENTE + 'const otra = await getRolEnCentro(c)\n')
    const lista = { ...VACIA, PENDIENTES_GET_CENTRO: { 'src/app/pendiente.tsx': 2 } }
    expect(revisar(raiz, lista).problemas).toEqual([
      expect.stringContaining('3 vez/veces y la lista admite 2'),
    ])
  })

  it('migrar parte de un fichero sin bajar su número → rojo (la lista solo baja)', () => {
    nuevoArbol()
    fichero('src/app/pendiente.tsx', PAGINA_PENDIENTE)
    const lista = { ...VACIA, PENDIENTES_GET_CENTRO: { 'src/app/pendiente.tsx': 3 } }
    expect(revisar(raiz, lista).problemas).toEqual([expect.stringContaining('Bájalo a 2')])
  })

  it('una lectura de más en un fichero con lecturas permitidas → rojo', () => {
    nuevoArbol()
    fichero('src/features/x/mixto.ts', 'a.from(\'roles_usuario\')\nb.from("roles_usuario")\n')
    const lista = {
      ...VACIA,
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
