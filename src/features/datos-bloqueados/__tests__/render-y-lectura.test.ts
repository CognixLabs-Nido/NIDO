// @vitest-environment node
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'

import { leerContenido } from '../lib/leer-contenido'
import { renderDatosBloqueadosHtml, valorHtml } from '../lib/render-datos-bloqueados'
import { APARTADOS, MOTIVOS_TIPO, VerDatosBloqueadosSchema } from '../types'

const MIGRACION_FICHA = readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20261211120000_feat_estado_retencion_nino.sql'),
  'utf8'
)
const MIGRACION = readFileSync(
  path.resolve(
    __dirname,
    '../../../../supabase/migrations/20261205120000_feat_retencion_bloqueo.sql'
  ),
  'utf8'
)

const TEXTOS = {
  titulo: 'Datos bloqueados',
  sujeto: 'Sujeto',
  motivo: 'Motivo',
  generado: 'Generado',
  bloqueadoDesde: 'Bloqueado desde',
  sinFilas: 'Sin datos',
  apartados: { firmas: 'Firmas' },
}

describe('datos bloqueados: la lectura de la respuesta', () => {
  it('coge los apartados que son listas y la fecha', () => {
    expect(
      leerContenido({
        bloqueado_desde: '2027-01-02',
        apartados: { firmas: [{ id: 'f1' }], raro: 'no', lecturas_ficha_medica: [] },
      })
    ).toEqual({
      bloqueadoDesde: '2027-01-02',
      apartados: { firmas: [{ id: 'f1' }], lecturas_ficha_medica: [] },
    })
  })

  it('sin forma, NULL: no se pinta como vacío', () => {
    expect(leerContenido(null)).toBeNull()
    expect(leerContenido({ bloqueado_desde: '2027-01-02' })).toBeNull()
  })
})

describe('datos bloqueados: el HTML para entregar', () => {
  it('lleva el sujeto, el motivo, la fecha y cada fila, escapado', () => {
    const html = renderDatosBloqueadosHtml(
      { bloqueadoDesde: '2027-01-02', apartados: { firmas: [{ nombre_tecleado: '<b>Ana</b>' }] } },
      {
        sujeto: 'Familia Demo',
        motivo: 'Juzgado · Oficio 12/2027',
        generadoEn: '2027-03-04T10:00:00Z',
      },
      TEXTOS
    )
    expect(html).toContain('Familia Demo')
    expect(html).toContain('Juzgado · Oficio 12/2027')
    expect(html).toContain('Bloqueado desde: 2027-01-02')
    expect(html).toContain('<h2>Firmas</h2>')
    expect(html).toContain('&lt;b&gt;Ana&lt;/b&gt;')
    expect(html).not.toContain('<b>Ana</b>')
  })

  it('la firma solo se pinta si es una imagen en base64', () => {
    expect(valorHtml('firma_imagen', 'data:image/png;base64,AAAA')).toContain('<img src=')
    expect(valorHtml('firma_imagen', 'javascript:alert(1)')).toBe('javascript:alert(1)')
    expect(valorHtml('firma_imagen', '<svg onload=x>')).toBe('&lt;svg onload=x&gt;')
    expect(valorHtml('datos', { a: '<x>' })).toContain('&lt;x&gt;')
  })

  it('un apartado vacío lo dice', () => {
    const html = renderDatosBloqueadosHtml(
      { bloqueadoDesde: null, apartados: { firmas: [] } },
      { sujeto: 's', motivo: 'm', generadoEn: 'g' },
      TEXTOS
    )
    expect(html).toContain('<p>Sin datos</p>')
  })
})

describe('datos bloqueados: lo que pide la app es lo que acepta la BD', () => {
  it('los tipos de motivo son los del CHECK', () => {
    const check = MIGRACION.match(/motivo_tipo text NOT NULL CHECK \(motivo_tipo IN \(([^)]*)\)/)
    expect(check).not.toBeNull()
    const tipos = [...check![1]!.matchAll(/'(\w+)'/g)].map((m) => m[1]!)
    expect([...tipos].sort()).toEqual([...MOTIVOS_TIPO].sort())
  })

  it('los apartados son los de contenido_bloqueado', () => {
    const desde = MIGRACION.indexOf('CREATE FUNCTION privado.contenido_bloqueado(')
    const cuerpo = MIGRACION.slice(desde, MIGRACION.indexOf('$function$;', desde))
    expect(desde).toBeGreaterThan(0)
    const claves = [...new Set([...cuerpo.matchAll(/\n    '(\w+)', COALESCE/g)].map((m) => m[1]!))]
    expect(claves.length).toBeGreaterThan(0)
    // Y la ficha médica del niño de baja, que entrega `ver_datos_bloqueados` (20261211120000).
    const ver = MIGRACION_FICHA.slice(
      MIGRACION_FICHA.indexOf('CREATE OR REPLACE FUNCTION public.ver_datos_bloqueados(')
    )
    const ficha = [
      ...ver.matchAll(/jsonb_build_object\('(\w+)', (?:jsonb_build_array|'\[\]')/g),
    ].map((m) => m[1]!)
    expect(new Set(ficha)).toEqual(new Set(['ficha_medica']))
    expect([...claves, ...new Set(ficha)].sort()).toEqual([...APARTADOS].sort())
  })

  it('el motivo tiene de 10 a 1000 caracteres, sin contar los espacios de los lados', () => {
    const base = {
      centroId: '11111111-1111-4111-8111-111111111111',
      sujetoTipo: 'nino',
      sujetoId: '22222222-2222-4222-8222-222222222222',
      motivoTipo: 'juzgado',
      accion: 'ver',
    }
    expect(VerDatosBloqueadosSchema.safeParse({ ...base, motivo: '   corto   ' }).success).toBe(
      false
    )
    expect(VerDatosBloqueadosSchema.safeParse({ ...base, motivo: 'Oficio 12/2027' }).success).toBe(
      true
    )
    expect(VerDatosBloqueadosSchema.safeParse({ ...base, motivo: 'x'.repeat(1001) }).success).toBe(
      false
    )
    expect(
      VerDatosBloqueadosSchema.safeParse({ ...base, motivo: 'Oficio 12/2027', motivoTipo: 'nada' })
        .success
    ).toBe(false)
  })

  it('cada motivo y cada apartado tienen su texto en es, en y va', () => {
    for (const m of [es, en, va]) {
      const ns = (m as unknown as Record<string, Record<string, Record<string, string>>>)
        .datos_bloqueados!
      for (const t of MOTIVOS_TIPO) expect(ns.motivos![t]).toBeTruthy()
      for (const a of APARTADOS) expect(ns.apartados![a]).toBeTruthy()
    }
  })
})
