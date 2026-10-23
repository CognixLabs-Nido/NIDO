import { readFileSync } from 'fs'
import { join } from 'path'

import { describe, expect, it } from 'vitest'

import en from '@/../messages/en.json'
import es from '@/../messages/es.json'
import va from '@/../messages/va.json'

import type { MotivoBloqueo } from '@/features/recibos/lib/acceso-modificar'
import type { Database } from '@/types/database'

/**
 * Recibos · PR-3 — no se valida con el desborde de beca pendiente.
 *
 * Las claves del panel del mes y del diálogo del desborde se LEEN de sus componentes (`t('…')`
 * y `t(`…${x}`)` con sus valores), no se enumeran: el aviso al validar, la lista del lote y el
 * error de la action, y cualquier clave nueva sin traducir, se ponen rojos solos. Y cada
 * traducción lleva los mismos `{marcadores}` que la castellana: un `{importe}` que faltara en
 * un idioma escondería justo el dato que la directora tiene que comprobar.
 */
type EstadoRecibo = Database['public']['Enums']['estado_recibo']
type MetodoPago = Database['public']['Enums']['metodo_pago']

const ESTADOS: readonly EstadoRecibo[] = [
  'borrador',
  'pendiente_procesar',
  'enviado_banco',
  'devuelto',
  'cobrado_manual',
]
const METODOS: readonly MetodoPago[] = ['sepa', 'efectivo', 'cheque_guarderia', 'transferencia']
const MOTIVOS: readonly MotivoBloqueo[] = ['en_remesa', 'cobro_avanzado', 'no_confirmado']

const FUENTES: ReadonlyArray<{
  ruta: string
  namespace: string
  plantillas: Record<string, readonly string[]>
}> = [
  {
    ruta: 'src/features/recibos/components/PanelMesRecibos.tsx',
    namespace: 'recibos_panel',
    plantillas: {
      'estado_recibo.': ESTADOS,
      'metodos.': METODOS,
      'modificar_bloqueado.': MOTIVOS,
    },
  },
  {
    ruta: 'src/features/beca-comedor/components/ResolverDesbordeDialog.tsx',
    namespace: 'admin.cuotas.beca_comedor.desborde',
    plantillas: {},
  },
]

const CLAVES = new Set<string>()
for (const { ruta, namespace, plantillas } of FUENTES) {
  const src = readFileSync(join(process.cwd(), ruta), 'utf8')
  for (const m of src.matchAll(/\bt\(\s*'([\w.]+)'/g)) CLAVES.add(`${namespace}.${m[1]!}`)
  for (const m of src.matchAll(/\bt\(\s*`([\w.]+\.)\$\{/g)) {
    const valores = plantillas[m[1]!]
    if (!valores) throw new Error(`plantilla sin valores en el test: ${ruta} ${m[1]}`)
    for (const v of valores) CLAVES.add(`${namespace}.${m[1]!}${v}`)
  }
}
// Los errores que devuelve la action de confirmar (se pintan con tErrors).
const accion = readFileSync(
  join(process.cwd(), 'src/features/recibos/actions/confirmar-recibo.ts'),
  'utf8'
)
for (const m of accion.matchAll(/'(recibos_panel\.errors\.\w+)'/g)) CLAVES.add(m[1]!)

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

describe('i18n — validar con el desborde de beca pendiente (PR-3)', () => {
  it('premisa: la lectura encuentra el aviso, la lista del lote y el error', () => {
    expect(CLAVES.size).toBeGreaterThan(40)
    expect(CLAVES).toContain('admin.cuotas.beca_comedor.desborde.aviso_validar')
    expect(CLAVES).toContain('recibos_panel.lote_saltados')
    expect(CLAVES).toContain('recibos_panel.lote_saltado_fila')
    expect(CLAVES).toContain('recibos_panel.errors.desborde_pendiente')
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

  it('el aviso y la fila del lote enseñan el importe', () => {
    expect(
      marcadores(hoja(es, 'admin.cuotas.beca_comedor.desborde.aviso_validar') as string)
    ).toEqual(['importe'])
    expect(marcadores(hoja(es, 'recibos_panel.lote_saltado_fila') as string)).toEqual([
      'familia',
      'importe',
    ])
  })
})
