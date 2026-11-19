import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { PLANTILLAS_FICHA_PDF } from '..'

/**
 * Lo que sostiene que una versión de la plantilla compone siempre el mismo documento (fase 10c,
 * spec «10c: … la condición de la (C)»), leído en los ficheros:
 *  1. la versión con la que firma la base (`privado.ficha_plantilla_pdf_version`, la última migración
 *     que la define) existe en el registro;
 *  2. ninguna plantilla lee nada vivo (traducciones, `Intl`, la hora, el entorno, la red, otros
 *     módulos de la casa): solo pdf-lib y sus tipos;
 *  3. la copia no tiene URL pública: ni la ruta ni la lectura ni las plantillas tocan Storage.
 */
const RAIZ = process.cwd()
const DIR = join(RAIZ, 'src/features/alta/lib/ficha-pdf')
const plantillas = readdirSync(DIR).filter((f) => /^v\d+\.ts$/.test(f))

describe('las plantillas del PDF de la ficha firmada', () => {
  it('la versión con la que firma la base tiene su plantilla', () => {
    const mig = join(RAIZ, 'supabase/migrations')
    const define = readdirSync(mig)
      .sort()
      .map((f) => readFileSync(join(mig, f), 'utf8'))
      .filter((t) => /FUNCTION privado\.ficha_plantilla_pdf_version\(\)/.test(t))
    // Premisa: la define alguna migración.
    expect(define.length).toBeGreaterThan(0)
    const ultima = define[define.length - 1]
    const v = /ficha_plantilla_pdf_version\(\)[\s\S]*?SELECT (\d+)::smallint/.exec(ultima)
    expect(v, 'la versión de la base').not.toBeNull()
    expect(Object.keys(PLANTILLAS_FICHA_PDF)).toContain(v![1])
  })

  it('cada plantilla registrada tiene su fichero, y cada fichero está registrado', () => {
    expect(plantillas.length).toBeGreaterThan(0)
    expect(plantillas.map((f) => f.slice(1, -3)).sort()).toEqual(
      Object.keys(PLANTILLAS_FICHA_PDF).sort()
    )
  })

  it('ninguna plantilla lee nada vivo', () => {
    for (const f of plantillas) {
      const t = readFileSync(join(DIR, f), 'utf8')
      const imports = [...t.matchAll(/^import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1])
      expect(imports, `${f}: imports`).toContain('pdf-lib')
      expect(
        imports.filter((i) => i !== 'pdf-lib' && i !== './tipos'),
        `${f}: importa algo vivo`
      ).toEqual([])
      expect(t, `${f}: el import de tipos, solo de tipos`).not.toMatch(
        /^import\s+\{[^}]*\}\s+from\s+'\.\/tipos'/m
      )
      const codigo = t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
      for (const vivo of [
        /\bIntl\b/,
        /toLocale\w*/,
        /Date\.now/,
        /new Date\(\s*\)/,
        /process\.env/,
        /\bfetch\(/,
        /Math\.random/,
        /\brequire\(/,
      ]) {
        expect(codigo, `${f}: ${vivo}`).not.toMatch(vivo)
      }
      expect(codigo, `${f}: la fecha de los metadatos, apagada`).toMatch(/updateMetadata:\s*false/)
    }
  })

  it('la copia no tiene URL pública: nada de Storage en la ruta, la lectura ni las plantillas', () => {
    const ficheros = [
      'src/app/[locale]/ficha-firmada/[firmaId]/route.ts',
      'src/features/alta/lib/leer-ficha-firmada.ts',
      ...readdirSync(DIR)
        .filter((f) => f.endsWith('.ts'))
        .map((f) => `src/features/alta/lib/ficha-pdf/${f}`),
    ]
    for (const f of ficheros) {
      const codigo = readFileSync(join(RAIZ, f), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '')
      expect(codigo, f).not.toMatch(
        /\.storage\b|createSignedUrl|getPublicUrl|\.upload\(|createServiceRoleClient/
      )
    }
    // Premisa del barrido: la ruta es la que entrega el PDF.
    expect(readFileSync(join(RAIZ, ficheros[0]), 'utf8')).toMatch(
      /'Cache-Control': 'private, no-store'/
    )
  })
})
