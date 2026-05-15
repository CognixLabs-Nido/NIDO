import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createTestCentro, createTestNino, deleteTestCentro, serviceClient } from './setup'

/**
 * Tests de las funciones SQL de Fase 4.5:
 *  - `menu_del_dia(centro, fecha)`: devuelve la plantilla publicada vigente
 *    para el día de la semana correspondiente. Lunes-viernes con datos,
 *    sábado/domingo vacío, fuera de rango de vigencia también vacío.
 *  - `nino_toma_comida_solida(nino_id)`: filtra del pase de lista a los
 *    niños con lactancia exclusiva ('materna' o 'biberon'). 'mixta' SÍ
 *    toma sólida (matiz Checkpoint A). Sin datos pedagógicos asume TRUE.
 */

describe('menu_del_dia', () => {
  let centro: { id: string }
  let plantillaId: string

  // Fechas fijas en 2026 cuya ISODOW es conocida sin depender de Date:
  //  - 2026-02-02 → lunes (ISODOW = 1)
  //  - 2026-02-07 → sábado (ISODOW = 6)
  //  - 2026-02-08 → domingo (ISODOW = 7)
  const lunes = '2026-02-02'
  const sabado = '2026-02-07'
  const domingo = '2026-02-08'

  beforeAll(async () => {
    centro = await createTestCentro('Centro menu_del_dia')
    const ins = await serviceClient
      .from('plantillas_menu')
      .insert({
        centro_id: centro.id,
        nombre: 'Plantilla F4.5 vigente',
        estado: 'publicada',
        vigente_desde: '2026-02-01',
        vigente_hasta: '2026-02-28',
      })
      .select('id')
      .single()
    if (ins.error || !ins.data) throw new Error(`seed failed: ${ins.error?.message}`)
    plantillaId = ins.data.id

    await serviceClient.from('plantilla_menu_dia').insert([
      {
        plantilla_id: plantillaId,
        dia_semana: 'lunes',
        desayuno: 'Tostadas',
        media_manana: 'Fruta',
        comida: 'Lentejas',
        merienda: 'Yogur',
      },
      {
        plantilla_id: plantillaId,
        dia_semana: 'martes',
        comida: 'Macarrones',
      },
    ])
  }, 60_000)

  afterAll(async () => {
    await serviceClient.from('plantilla_menu_dia').delete().eq('plantilla_id', plantillaId)
    await serviceClient.from('plantillas_menu').delete().eq('id', plantillaId)
    await deleteTestCentro(centro.id)
  }, 60_000)

  it('devuelve el menú correcto para un lunes dentro del rango', async () => {
    const { data, error } = await serviceClient.rpc('menu_del_dia', {
      p_centro_id: centro.id,
      p_fecha: lunes,
    })
    expect(error).toBeNull()
    expect(data?.length).toBe(1)
    expect(data?.[0]?.desayuno).toBe('Tostadas')
    expect(data?.[0]?.comida).toBe('Lentejas')
  })

  it('devuelve cero filas para un sábado (sin menú definido)', async () => {
    const { data, error } = await serviceClient.rpc('menu_del_dia', {
      p_centro_id: centro.id,
      p_fecha: sabado,
    })
    expect(error).toBeNull()
    expect(data?.length ?? 0).toBe(0)
  })

  it('devuelve cero filas para un domingo', async () => {
    const { data, error } = await serviceClient.rpc('menu_del_dia', {
      p_centro_id: centro.id,
      p_fecha: domingo,
    })
    expect(error).toBeNull()
    expect(data?.length ?? 0).toBe(0)
  })

  it('devuelve cero filas si la plantilla está fuera del rango de vigencia', async () => {
    // 2026-03-02 también es lunes pero está fuera del rango Feb.
    const { data, error } = await serviceClient.rpc('menu_del_dia', {
      p_centro_id: centro.id,
      p_fecha: '2026-03-02',
    })
    expect(error).toBeNull()
    expect(data?.length ?? 0).toBe(0)
  })

  it('NO devuelve nada si la plantilla está archivada aunque la vigencia incluya la fecha', async () => {
    // Archivar y reintentar para el mismo lunes.
    await serviceClient
      .from('plantillas_menu')
      .update({ estado: 'archivada' })
      .eq('id', plantillaId)
    const { data } = await serviceClient.rpc('menu_del_dia', {
      p_centro_id: centro.id,
      p_fecha: lunes,
    })
    expect(data?.length ?? 0).toBe(0)
    // Revert para el resto de tests del archivo.
    await serviceClient
      .from('plantillas_menu')
      .update({ estado: 'publicada' })
      .eq('id', plantillaId)
  })
})

describe('nino_toma_comida_solida', () => {
  let centro: { id: string }
  const ninosCreados: string[] = []

  async function ninoConLactancia(
    estado: 'materna' | 'biberon' | 'mixta' | 'finalizada' | 'no_aplica'
  ): Promise<string> {
    const n = await createTestNino(centro.id)
    ninosCreados.push(n.id)
    const { error } = await serviceClient.from('datos_pedagogicos_nino').insert({
      nino_id: n.id,
      lactancia_estado: estado,
      control_esfinteres: 'panal_completo',
      tipo_alimentacion: 'omnivora',
      idiomas_casa: ['es'],
      tiene_hermanos_en_centro: false,
    })
    if (error) throw new Error(`insert datos pedagogicos: ${error.message}`)
    return n.id
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro toma solida')
  }, 60_000)

  afterAll(async () => {
    if (ninosCreados.length > 0) {
      await serviceClient.from('datos_pedagogicos_nino').delete().in('nino_id', ninosCreados)
      await serviceClient.from('ninos').delete().in('id', ninosCreados)
    }
    await deleteTestCentro(centro.id)
  }, 60_000)

  it('devuelve FALSE para lactancia_estado="materna"', async () => {
    const ninoId = await ninoConLactancia('materna')
    const { data, error } = await serviceClient.rpc('nino_toma_comida_solida', {
      p_nino_id: ninoId,
    })
    expect(error).toBeNull()
    expect(data).toBe(false)
  })

  it('devuelve FALSE para lactancia_estado="biberon"', async () => {
    const ninoId = await ninoConLactancia('biberon')
    const { data } = await serviceClient.rpc('nino_toma_comida_solida', {
      p_nino_id: ninoId,
    })
    expect(data).toBe(false)
  })

  it('devuelve TRUE para lactancia_estado="mixta" (matiz Checkpoint A)', async () => {
    const ninoId = await ninoConLactancia('mixta')
    const { data } = await serviceClient.rpc('nino_toma_comida_solida', {
      p_nino_id: ninoId,
    })
    expect(data).toBe(true)
  })

  it('devuelve TRUE para lactancia_estado="finalizada"', async () => {
    const ninoId = await ninoConLactancia('finalizada')
    const { data } = await serviceClient.rpc('nino_toma_comida_solida', {
      p_nino_id: ninoId,
    })
    expect(data).toBe(true)
  })

  it('devuelve TRUE para lactancia_estado="no_aplica"', async () => {
    const ninoId = await ninoConLactancia('no_aplica')
    const { data } = await serviceClient.rpc('nino_toma_comida_solida', {
      p_nino_id: ninoId,
    })
    expect(data).toBe(true)
  })

  it('devuelve TRUE si no existe fila datos_pedagogicos_nino', async () => {
    const sinPedagogicos = await createTestNino(centro.id, 'Sin datos pedagógicos')
    ninosCreados.push(sinPedagogicos.id)
    const { data } = await serviceClient.rpc('nino_toma_comida_solida', {
      p_nino_id: sinPedagogicos.id,
    })
    expect(data).toBe(true)
  })
})
