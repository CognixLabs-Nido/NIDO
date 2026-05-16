import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createTestCentro, createTestNino, deleteTestCentro, serviceClient } from './setup'

/**
 * Tests de los helpers SQL `nino_toma_comida_solida` y `menu_del_dia`
 * (Fase 4.5b).
 *
 * `nino_toma_comida_solida` se recreó tras el revert de F4.5 (que lo
 * había introducido en un PR cerrado sin merge). Verifica:
 *  - lactancia materna/biberon → FALSE (no come sólidos)
 *  - lactancia mixta → TRUE (matiz importante: come sólidos parciales)
 *  - lactancia finalizada / no_aplica → TRUE
 *  - niño sin datos pedagógicos → TRUE (COALESCE seguro)
 *
 * `menu_del_dia` busca por mes/año y solo considera plantillas
 * `publicada` (no borrador / no archivada).
 */
describe('nino_toma_comida_solida — helper SQL', () => {
  let centro: { id: string }
  const ninos: { id: string; lactancia: string }[] = []
  const ninosCreadosIds: string[] = []

  beforeAll(async () => {
    centro = await createTestCentro('Centro Menus Helpers')

    // 4 niños distintos para cubrir todos los casos.
    const casos = [
      { lactancia: 'materna' as const },
      { lactancia: 'biberon' as const },
      { lactancia: 'mixta' as const },
      { lactancia: 'finalizada' as const },
    ]
    for (const c of casos) {
      const n = await createTestNino(centro.id, `Niño ${c.lactancia}`)
      ninosCreadosIds.push(n.id)
      const { error } = await serviceClient.from('datos_pedagogicos_nino').insert({
        nino_id: n.id,
        lactancia_estado: c.lactancia,
        control_esfinteres: 'panal_completo',
        tipo_alimentacion: 'omnivora',
        idiomas_casa: ['es'],
        tiene_hermanos_en_centro: false,
      })
      if (error) throw new Error(`seed datos_pedagogicos ${c.lactancia}: ${error.message}`)
      ninos.push({ id: n.id, lactancia: c.lactancia })
    }

    // Quinto niño SIN datos_pedagogicos_nino (caso COALESCE).
    const sinDatos = await createTestNino(centro.id, 'Niño sin datos pedagógicos')
    ninosCreadosIds.push(sinDatos.id)
    ninos.push({ id: sinDatos.id, lactancia: 'SIN_DATOS' })
  }, 120_000)

  afterAll(async () => {
    await serviceClient.from('datos_pedagogicos_nino').delete().in('nino_id', ninosCreadosIds)
    await serviceClient.from('ninos').delete().in('id', ninosCreadosIds)
    await deleteTestCentro(centro.id)
  }, 90_000)

  it('lactancia materna → FALSE (no come sólidos)', async () => {
    const ninoMaterna = ninos.find((n) => n.lactancia === 'materna')!
    const { data, error } = await serviceClient.rpc('nino_toma_comida_solida', {
      p_nino_id: ninoMaterna.id,
    })
    expect(error).toBeNull()
    expect(data).toBe(false)
  })

  it('lactancia biberon → FALSE', async () => {
    const ninoBiberon = ninos.find((n) => n.lactancia === 'biberon')!
    const { data, error } = await serviceClient.rpc('nino_toma_comida_solida', {
      p_nino_id: ninoBiberon.id,
    })
    expect(error).toBeNull()
    expect(data).toBe(false)
  })

  it('lactancia mixta → TRUE (matiz: comen sólidos parciales)', async () => {
    const ninoMixta = ninos.find((n) => n.lactancia === 'mixta')!
    const { data, error } = await serviceClient.rpc('nino_toma_comida_solida', {
      p_nino_id: ninoMixta.id,
    })
    expect(error).toBeNull()
    expect(data).toBe(true)
  })

  it('lactancia finalizada → TRUE', async () => {
    const ninoFinalizada = ninos.find((n) => n.lactancia === 'finalizada')!
    const { data, error } = await serviceClient.rpc('nino_toma_comida_solida', {
      p_nino_id: ninoFinalizada.id,
    })
    expect(error).toBeNull()
    expect(data).toBe(true)
  })

  it('niño sin datos pedagógicos → TRUE (COALESCE de seguridad)', async () => {
    const ninoSinDatos = ninos.find((n) => n.lactancia === 'SIN_DATOS')!
    const { data, error } = await serviceClient.rpc('nino_toma_comida_solida', {
      p_nino_id: ninoSinDatos.id,
    })
    expect(error).toBeNull()
    expect(data).toBe(true)
  })
})

describe('menu_del_dia — helper SQL', () => {
  let centro: { id: string }
  const plantillasCreadas: string[] = []

  beforeAll(async () => {
    centro = await createTestCentro('Centro menu_del_dia')
  }, 60_000)

  afterAll(async () => {
    // El CASCADE del centro limpia plantillas y menu_dia.
    await deleteTestCentro(centro.id)
  }, 60_000)

  it('devuelve NULL si no hay plantilla publicada para el mes', async () => {
    const { data, error } = await serviceClient.rpc('menu_del_dia', {
      p_centro_id: centro.id,
      p_fecha: '2026-07-15',
    })
    expect(error).toBeNull()
    // RPC que devuelve SETOF/record vacío → supabase-js entrega null
    // como objeto con campos null o array vacío según versión. Aceptamos
    // ambos comportamientos: el contrato útil es "no hay menú aplicable".
    if (Array.isArray(data)) {
      expect(data.length).toBe(0)
    } else if (data && typeof data === 'object') {
      expect((data as { id: string | null }).id).toBeNull()
    } else {
      expect(data).toBeNull()
    }
  })

  it('devuelve el menú correcto cuando hay plantilla publicada con menu_dia', async () => {
    // Crear plantilla publicada para julio 2026.
    const { data: p, error: pErr } = await serviceClient
      .from('plantillas_menu_mensual')
      .insert({ centro_id: centro.id, mes: 7, anio: 2026, estado: 'publicada' })
      .select('id')
      .single()
    expect(pErr).toBeNull()
    plantillasCreadas.push(p!.id)

    const { error: mdErr } = await serviceClient.from('menu_dia').insert({
      plantilla_id: p!.id,
      fecha: '2026-07-20',
      comida_primero: 'Lentejas',
      comida_segundo: 'Filete con patatas',
      comida_postre: 'Fruta',
    })
    expect(mdErr).toBeNull()

    const { data, error } = await serviceClient.rpc('menu_del_dia', {
      p_centro_id: centro.id,
      p_fecha: '2026-07-20',
    })
    expect(error).toBeNull()
    expect(data).toBeTruthy()
    // El RPC RETURNS public.menu_dia → supabase-js devuelve el row
    // como objeto en `data` (no array). Si fuera array, tomamos primero.
    const row = Array.isArray(data) ? data[0] : data
    expect(row).toBeTruthy()
    expect((row as { comida_primero: string }).comida_primero).toBe('Lentejas')
  })

  it('devuelve NULL si la plantilla está en borrador (no publicada)', async () => {
    const { data: p } = await serviceClient
      .from('plantillas_menu_mensual')
      .insert({ centro_id: centro.id, mes: 8, anio: 2026, estado: 'borrador' })
      .select('id')
      .single()
    plantillasCreadas.push(p!.id)
    await serviceClient.from('menu_dia').insert({
      plantilla_id: p!.id,
      fecha: '2026-08-15',
      comida_primero: 'Sopa',
    })

    const { data, error } = await serviceClient.rpc('menu_del_dia', {
      p_centro_id: centro.id,
      p_fecha: '2026-08-15',
    })
    expect(error).toBeNull()
    if (Array.isArray(data)) {
      expect(data.length).toBe(0)
    } else if (data && typeof data === 'object') {
      expect((data as { id: string | null }).id).toBeNull()
    } else {
      expect(data).toBeNull()
    }
  })
})
