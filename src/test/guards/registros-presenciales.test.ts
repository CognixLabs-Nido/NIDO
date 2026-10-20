// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { sinComentarios } from '../../../scripts/check-centro-activo.mjs'

/**
 * Los registros presenciales en nombre de una familia (firma presencial, mandato SEPA
 * presencial, consentimientos del tutor registrados con la familia delante) los hace la
 * directora del centro, no el superusuario (ADR-0061). La BD cierra lo que puede: firmas_insert,
 * otorgar_consentimiento_imagen y registrar_/sustituir_mandato_sepa. Lo que va con service role
 * (crearTutorDirecto) solo lo puede cerrar la app.
 *
 * Este censo fija dónde escribe la app un método 'presencial': cada fichero que lo hace pregunta
 * `esSuperusuario`, o está en la lista con su motivo. Un sitio nuevo se pone rojo aquí.
 */

const RAIZ = path.resolve(__dirname, '../../..')
const RE_ESCRIBE_PRESENCIAL =
  /\b(p_metodo|metodo_firma|metodoFirma)\s*(:|=(?!=))[^,;|\n]*['"`]presencial['"`]/
const RE_PREGUNTA = /\besSuperusuario\s*\(/

const SIN_PREGUNTA: Record<string, string> = {
  'src/features/auth/lib/crear-tutor-directo.ts':
    'va con service role; lo cierra su único llamador (completar-direccion.ts, abajo)',
  'src/features/alta/actions/registrar-consentimiento-tutor.ts':
    'acuse médico de la PROPIA directora (auth.uid()), no en nombre de la familia',
}

function ficheros(dir: string): string[] {
  const res: string[] = []
  for (const nombre of readdirSync(dir)) {
    const abs = path.join(dir, nombre)
    if (statSync(abs).isDirectory()) {
      if (nombre === '__tests__' || nombre === 'test') continue
      res.push(...ficheros(abs))
    } else if (/\.(ts|tsx)$/.test(nombre) && !/\.test\.(ts|tsx)$/.test(nombre)) {
      res.push(path.relative(RAIZ, abs).split(path.sep).join('/'))
    }
  }
  return res
}

const codigo = (rel: string) => sinComentarios(readFileSync(path.join(RAIZ, rel), 'utf8'))

describe('registros presenciales: la directora sí, el superusuario no', () => {
  const todos = ficheros(path.join(RAIZ, 'src'))
  const escriben = todos.filter((rel) => RE_ESCRIBE_PRESENCIAL.test(codigo(rel)))

  it('cada fichero que escribe un método presencial pregunta esSuperusuario o está en la lista', () => {
    // Premisa: el censo encuentra los cinco de hoy (el patrón caza).
    expect(escriben).toHaveLength(5)
    const sinPregunta = escriben.filter((rel) => !RE_PREGUNTA.test(codigo(rel))).sort()
    expect(sinPregunta).toEqual(Object.keys(SIN_PREGUNTA).sort())
  })

  it('crearTutorDirecto: solo lo llama completar-direccion.ts, y ese pregunta esSuperusuario antes', () => {
    const llamadores = todos.filter(
      (rel) =>
        rel !== 'src/features/auth/lib/crear-tutor-directo.ts' &&
        /\bcrearTutorDirecto\s*\(/.test(codigo(rel))
    )
    expect(llamadores).toEqual(['src/features/lista-espera/actions/completar-direccion.ts'])
    const c = codigo(llamadores[0]!)
    const pregunta = c.search(RE_PREGUNTA)
    expect(pregunta).toBeGreaterThan(-1)
    expect(pregunta).toBeLessThan(c.search(/\bcrearTutorDirecto\s*\(/))
  })

  it('el patrón caza la escritura y no la lectura', () => {
    expect(RE_ESCRIBE_PRESENCIAL.test("p_metodo: esPresencial ? 'presencial' : 'digital',")).toBe(
      true
    )
    expect(RE_ESCRIBE_PRESENCIAL.test("    metodoFirma = 'presencial'")).toBe(true)
    expect(RE_ESCRIBE_PRESENCIAL.test("if (m.metodo_firma === 'presencial') {")).toBe(false)
    // Un tipo no es una escritura.
    expect(RE_ESCRIBE_PRESENCIAL.test("  metodo_firma: 'digital' | 'presencial'")).toBe(false)
  })
})
