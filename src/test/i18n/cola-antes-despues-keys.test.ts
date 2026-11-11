import { readFileSync } from 'fs'
import { join } from 'path'

import { describe, expect, it } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'
import { CAMPOS_IDENTIDAD_COLA } from '@/features/cambios-pendientes/lib/diff'
import {
  entidadCambioEnum,
  payloadDatosTutorSchema,
  payloadNinosFamiliaSchema,
} from '@/features/cambios-pendientes/schemas'

/**
 * La puerta de identidad y el antes → después de la cola (2026-11-08).
 *
 * Las claves se LEEN del código: los `t('…')` de la cola y de los dos pasos que encolan, una
 * etiqueta por cada campo que la cola puede enseñar (de los esquemas de cada entrada, no de una
 * lista a mano) y una por cada entidad (del enum). Un campo o una entidad nuevos sin traducir se
 * ponen rojos solos: la directora vería la clave en vez del nombre del campo que va a aprobar.
 */
const FUENTES: ReadonlyArray<[string, string]> = [
  ['src/features/cambios-pendientes/components/ColaCambiosPendientes.tsx', 'admin.pendientes'],
  ['src/features/alta/components/PasoMenor.tsx', 'alta'],
]

const CLAVES = new Set<string>(['alta.edicion_validada_aviso'])
for (const [ruta, namespace] of FUENTES) {
  const src = readFileSync(join(process.cwd(), ruta), 'utf8')
  for (const m of src.matchAll(/\bt\(\s*'((?:validacion|documento|sin|campos|entidad)[\w.]*)'/g))
    CLAVES.add(`${namespace}.${m[1]!}`)
}
const CAMPOS = new Set<string>([
  ...CAMPOS_IDENTIDAD_COLA,
  ...Object.keys(payloadNinosFamiliaSchema.shape),
  ...Object.keys(payloadDatosTutorSchema.shape).filter((k) => k !== 'tipo_vinculo'),
  'documento',
])
for (const c of CAMPOS) CLAVES.add(`admin.pendientes.campos.${c}`)
for (const e of entidadCambioEnum.options) CLAVES.add(`admin.pendientes.entidad.${e}`)

const LOCALES: ReadonlyArray<[string, Record<string, unknown>]> = [
  ['es', es as Record<string, unknown>],
  ['en', en as Record<string, unknown>],
  ['va', va as Record<string, unknown>],
]

function hoja(msgs: Record<string, unknown>, clave: string): unknown {
  return clave
    .split('.')
    .reduce<unknown>(
      (o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined),
      msgs
    )
}

describe('la cola con antes → después y la puerta: claves en los tres idiomas', () => {
  it('premisa: se leen las claves de los mensajes de después de guardar y de la cola', () => {
    expect(CLAVES).toContain('alta.validacion.enviado_identidad')
    expect(CLAVES).toContain('alta.validacion.enviado_identidad_domicilio')
    expect(CLAVES).toContain('admin.pendientes.sin_lectura')
    expect(CLAVES).toContain('admin.pendientes.campos.dni')
    expect(CLAVES).toContain('admin.pendientes.campos.direccion_ciudad')
    expect(CLAVES).toContain('admin.pendientes.campos.nombre_completo')
    expect(CLAVES).toContain('admin.pendientes.entidad.ninos_identidad')
  })

  for (const [locale, msgs] of LOCALES) {
    it(`${locale}: cada clave existe y es un texto`, () => {
      for (const c of CLAVES) {
        const v = hoja(msgs, c)
        expect.soft(typeof v, `${locale}: ${c}`).toBe('string')
        expect.soft((v as string)?.length ?? 0, `${locale}: ${c}`).toBeGreaterThan(0)
      }
    })
  }
})
