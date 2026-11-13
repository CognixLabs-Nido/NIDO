/**
 * Fase 7 (2026-11-13): los buckets que EXISTEN, contra lo que hace con ellos el olvido.
 *
 * Contra `storage.buckets` de la base efímera, que crean las migraciones de verdad: un bucket nuevo
 * que nadie añada a `FUENTES_ADJUNTOS` (lo borra el olvido) ni a `BUCKETS_FUERA_DEL_OLVIDO` (con su
 * motivo y quién lo borra) pone esto rojo. Así el de la tarjeta sanitaria queda cubierto y el del
 * justificante de gastos de gestión (fase 9) también, antes de existir.
 *
 * Control positivo: el unitario (`catalogo-buckets.test.ts`) con un bucket de mentira, y la rama
 * sonda con una migración que crea uno (este test, rojo).
 */
import { describe, expect, it } from 'vitest'

import { FUENTES_ADJUNTOS } from '@/features/olvido/lib/fuentes-adjuntos'
import {
  BUCKETS_BORRADOS_EN_PRODUCCION,
  BUCKETS_FUERA_DEL_OLVIDO,
  compararCatalogoBuckets,
} from '@/features/olvido/lib/catalogo-buckets'

import { serviceClient } from './setup'

describe('catálogo de buckets frente al olvido', () => {
  it('todo bucket que existe lo borra el olvido o está fuera con su motivo', async () => {
    const { data, error } = await serviceClient.storage.listBuckets()
    expect(error).toBeNull()
    const reales = (data ?? []).map((b) => b.id)
    // Premisa: la lectura trae los buckets de las migraciones (denominador), con dos conocidos.
    expect(reales.length).toBeGreaterThanOrEqual(10)
    expect(reales).toEqual(expect.arrayContaining(['dni-tutores', 'sip-ninos']))

    // Los que producción ya no tiene: siguen aquí (si no, la lista se pudre) y vacíos.
    const borrados = Object.keys(BUCKETS_BORRADOS_EN_PRODUCCION)
    expect(reales).toEqual(expect.arrayContaining(borrados))
    for (const b of borrados) {
      const { data: objs, error: e } = await serviceClient.storage.from(b).list()
      expect.soft(e, b).toBeNull()
      expect.soft(objs ?? [], b).toHaveLength(0)
    }

    const r = compararCatalogoBuckets(
      reales.filter((b) => !borrados.includes(b)),
      FUENTES_ADJUNTOS.map((f) => f.bucket),
      Object.keys(BUCKETS_FUERA_DEL_OLVIDO)
    )
    expect(r).toEqual({ sinDueno: [], inexistentes: [], enLosDos: [] })
  })
})
