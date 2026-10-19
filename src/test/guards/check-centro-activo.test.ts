// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { revisar, sinComentarios } from '../../../scripts/check-centro-activo.mjs'

/**
 * El guard de multicentro (como `check-club-activo` de MisterFC). Corre en la CI con el resto de
 * unit tests: el primer bloque mira el árbol de verdad; el segundo demuestra que caza, con un
 * árbol de mentira donde cada caso tiene que ponerse rojo. Desde el PR6 no hay ninguna lista:
 * `roles_usuario` solo se toca en `features/centros/contexto/`.
 */

const RAIZ = path.resolve(__dirname, '../../..')

describe('el árbol real cumple', () => {
  it('sin problemas, y con el recuento impreso', () => {
    const { problemas, recuento } = revisar(RAIZ)
    expect(problemas).toEqual([])
    // Premisa: el guard ha mirado el árbol de verdad y su patrón caza (dentro del módulo hay
    // usos). Sin esto, «0 fuera» podría ser un guard que no mira nada.
    expect(recuento.ficherosRevisados).toBeGreaterThan(100)
    expect(recuento.usosEnElModulo).toBeGreaterThan(0)
    expect(recuento.lecturasRoles).toBe(0)
    expect(recuento.usosDeprecadas).toBe(0)
  })

  it('no queda fichero de lista de excepciones', () => {
    expect(existsSync(path.join(RAIZ, 'scripts/check-centro-activo.lista.mjs'))).toBe(false)
  })
})

describe('caza lo que tiene que cazar (árbol de mentira)', () => {
  let raiz: string

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

  it('control: un árbol sin roles_usuario ni deprecadas pasa', () => {
    nuevoArbol()
    expect(revisar(raiz).problemas).toEqual([])
  })

  it('una lectura de roles_usuario fuera del contexto → rojo', () => {
    nuevoArbol()
    fichero(
      'src/features/x/centro-a-mano.ts',
      "const r = await supabase\n  .from('roles_usuario')\n  .select('centro_id').limit(1)\n"
    )
    expect(revisar(raiz).problemas).toEqual([
      expect.stringContaining('src/features/x/centro-a-mano.ts: toca roles_usuario 1 vez'),
    ])
  })

  it('una lectura de OTRO usuario fuera del contexto → rojo también (ya no hay lista)', () => {
    nuevoArbol()
    fichero(
      'src/features/x/otro-usuario.ts',
      "await service.from(\"roles_usuario\").select('usuario_id').eq('usuario_id', otroId)\n"
    )
    expect(revisar(raiz).problemas).toEqual([
      expect.stringContaining('src/features/x/otro-usuario.ts: toca roles_usuario'),
    ])
  })

  it('una lista de excepciones pasada al guard no se respeta: sigue en rojo', () => {
    nuevoArbol()
    fichero('src/features/x/con-motivo.ts', "await client.from('roles_usuario').select('rol')\n")
    const conLista = {
      LECTURAS_PERMITIDAS: { 'src/features/x/con-motivo.ts': { n: 1, motivo: 'otro usuario' } },
    }
    // Se le pasa como segundo argumento, como hacía la versión con lista.
    const revisarConLista = revisar as unknown as (
      r: string,
      l: unknown
    ) => ReturnType<typeof revisar>
    expect(revisarConLista(raiz, conLista).problemas).toEqual([
      expect.stringContaining('src/features/x/con-motivo.ts: toca roles_usuario'),
    ])
  })

  it('una escritura de roles_usuario fuera del contexto → rojo', () => {
    nuevoArbol()
    fichero('src/features/x/escribe.ts', "await service.from('roles_usuario').insert(fila)\n")
    expect(revisar(raiz).problemas).toEqual([
      expect.stringContaining('src/features/x/escribe.ts: toca roles_usuario'),
    ])
  })

  it('la misma lectura DENTRO del módulo de contexto → pasa, y se cuenta', () => {
    nuevoArbol()
    fichero('src/features/centros/contexto/leer.ts', "supabase.from('roles_usuario')\n")
    const { problemas, recuento } = revisar(raiz)
    expect(problemas).toEqual([])
    expect(recuento.usosEnElModulo).toBe(1)
  })

  it('una lectura solo en un comentario NO es una lectura', () => {
    nuevoArbol()
    fichero(
      'src/app/comentado.ts',
      "/* supabase.from('roles_usuario') */\nconst url = 'http://x'\n"
    )
    expect(revisar(raiz).problemas).toEqual([])
  })

  it('getCentroActualId (también en import multilínea) → rojo', () => {
    nuevoArbol()
    fichero(
      'src/app/pagina.tsx',
      "import {\n  getCentroActualId,\n} from '@/features/centros/queries/get-centro-actual'\n"
    )
    expect(revisar(raiz).problemas).toEqual([
      expect.stringContaining('src/app/pagina.tsx: nombra getCentroActualId/getRolEnCentro 1 vez'),
    ])
  })

  it('getRolEnCentro nombrada solo en un comentario → rojo (ninguna mención)', () => {
    nuevoArbol()
    fichero('src/app/comentario.ts', '// el rol lo da getRolEnCentro(c)\nexport const y = 1\n')
    expect(revisar(raiz).problemas).toEqual([
      expect.stringContaining('src/app/comentario.ts: nombra getCentroActualId/getRolEnCentro'),
    ])
  })
})

describe('sinComentarios', () => {
  it('quita comentarios y respeta cadenas con // dentro', () => {
    expect(sinComentarios("a // x\nb /* y */ c 'http://z' `//t`")).toBe("a \nb  c 'http://z' `//t`")
  })
})
