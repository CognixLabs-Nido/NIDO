import { readFileSync } from 'fs'
import { join } from 'path'

import { describe, expect, it } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'

import {
  AMBITOS,
  APLICACIONES,
  SERVICIOS_DIARIOS,
  TIPOS_CONCEPTO,
  TIPOS_VALOR,
} from '@/features/conceptos-cobro/schemas/concepto-cobro'

/**
 * Recibos · PR-4 — el mensual de un servicio excluye los días.
 *
 * Las claves del formulario y del catálogo de conceptos y de la asignación por alumno se LEEN de
 * sus componentes (`t('…')` y `t(`…${x}`)` con sus valores), no se enumeran: el servicio de un
 * mensual, el aviso de mensual y diario a la vez, y cualquier clave nueva sin traducir, se ponen
 * rojos solos. Cada traducción lleva los mismos `{marcadores}` que la castellana: un
 * `{servicios}` que faltara en un idioma dejaría el aviso sin decir de qué servicio es.
 */
const ESTADOS_ASIGNACION = ['no_asignado', 'asignado'] as const

const PLANTILLAS: Record<string, readonly string[]> = {
  'tipos.': TIPOS_CONCEPTO,
  'servicios.': SERVICIOS_DIARIOS,
  'valores.': TIPOS_VALOR,
  'ambitos.': AMBITOS,
  'aplicaciones.': APLICACIONES,
  'aplicacion_hint.': APLICACIONES,
  'aplicaciones_badge.': APLICACIONES,
  'estado_asignacion.': ESTADOS_ASIGNACION,
}

const RUTAS = [
  'src/features/conceptos-cobro/components/ConceptoFormDialog.tsx',
  'src/features/conceptos-cobro/components/ConceptosCatalogo.tsx',
  'src/features/cuotas-config/components/ConfigurarModalidadDialog.tsx',
  'src/features/cuotas-config/components/AsignacionPermanentePanel.tsx',
]

const CLAVES = new Set<string>()
for (const ruta of RUTAS) {
  const src = readFileSync(join(process.cwd(), ruta), 'utf8')
  for (const m of src.matchAll(/\bt\(\s*'([\w.]+)'/g)) CLAVES.add(`admin.cuotas.${m[1]!}`)
  for (const m of src.matchAll(/\bt\(\s*`([\w.]+\.)\$\{/g)) {
    const valores = PLANTILLAS[m[1]!]
    if (!valores) throw new Error(`plantilla sin valores en el test: ${ruta} ${m[1]}`)
    for (const v of valores) CLAVES.add(`admin.cuotas.${m[1]!}${v}`)
  }
}

const LOCALES: ReadonlyArray<[string, Record<string, unknown>]> = [
  ['es', es as Record<string, unknown>],
  ['en', en as Record<string, unknown>],
  ['va', va as Record<string, unknown>],
]

function hoja(msgs: Record<string, unknown>, clave: string): unknown {
  return clave
    .split('.')
    .reduce<unknown>(
      (o, p) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[p] : undefined),
      msgs
    )
}

function marcadores(texto: string): string[] {
  return [...texto.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort()
}

describe('i18n — el mensual de un servicio excluye los días (PR-4)', () => {
  it('premisa: la lectura encuentra el servicio del mensual y los dos avisos', () => {
    expect(CLAVES.size).toBeGreaterThan(40)
    expect(CLAVES).toContain('admin.cuotas.fields.servicio_mensual')
    expect(CLAVES).toContain('admin.cuotas.servicio_ninguno')
    expect(CLAVES).toContain('admin.cuotas.servicio_mensual_hint')
    expect(CLAVES).toContain('admin.cuotas.tipo_con_servicio')
    expect(CLAVES).toContain('admin.cuotas.aviso_mensual_y_diario')
    expect(CLAVES).toContain('admin.cuotas.solape_fila')
  })

  for (const [locale, msgs] of LOCALES) {
    describe(`locale=${locale}`, () => {
      it.each([...CLAVES])('%s', (k) => {
        const v = hoja(msgs, k)
        expect(typeof v, k).toBe('string')
        expect((v as string).trim()).not.toBe('')
        expect(marcadores(v as string), k).toEqual(marcadores(hoja(es, k) as string))
      })
    })
  }

  it('los dos avisos dicen de qué servicio son', () => {
    expect(marcadores(hoja(es, 'admin.cuotas.aviso_mensual_y_diario') as string)).toEqual([
      'servicios',
    ])
    expect(marcadores(hoja(es, 'admin.cuotas.solape_fila') as string)).toEqual(['servicios'])
  })
})
