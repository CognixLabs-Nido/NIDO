import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  clientFor,
  createTestCentro,
  createTestCurso,
  createTestNino,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from '../rls/setup'

/**
 * La lista de espera a 1 año (F11-B, punto 6, PR-3; 20261130120000).
 *
 * Un prospecto que no llegó a alta se borra cuando su fin de vida (el descarte o el final de su
 * curso, lo que pase antes) tiene más del plazo; el que llegó a alta (`nino_id`) sigue al
 * expediente. Se borra sin dejar copia en audit_log.
 *
 * Los prospectos que vencen son de hace 30 años y la purga real se pide con 20: así solo alcanza
 * a los de este fichero aunque la BD la compartan otros tests.
 */

const HACE_30_ANIOS = new Date(Date.now() - 30 * 365 * 864e5).toISOString()

type Prospecto = { id: string }

describe('Retención de la lista de espera', () => {
  let centro: { id: string }
  let admin: TestUser
  let cursoViejo: string
  let cursoVivo: string

  beforeAll(async () => {
    centro = await createTestCentro('Centro Retencion Lista Espera')
    admin = await createTestUser({ nombre: 'Admin Retencion Lista Espera' })
    await asignarRol(admin.id, centro.id, 'admin')
    cursoViejo = (await createTestCurso(centro.id, 'cerrado')).id
    const { error } = await serviceClient
      .from('cursos_academicos')
      .update({ fecha_inicio: '1995-09-01', fecha_fin: '1996-07-31' })
      .eq('id', cursoViejo)
    expect(error).toBeNull()
    cursoVivo = (await createTestCurso(centro.id)).id
  }, 120_000)

  afterAll(async () => {
    await serviceClient.from('lista_espera').delete().eq('centro_id', centro.id)
    await deleteTestUser(admin.id)
    await deleteTestCentro(centro.id)
  }, 120_000)

  async function prospecto(opts: {
    curso: string
    estado?: 'en_espera' | 'descartado'
    ninoId?: string
  }): Promise<Prospecto> {
    const { data, error } = await serviceClient
      .from('lista_espera')
      .insert({
        centro_id: centro.id,
        curso_academico_id: opts.curso,
        nombre_nino: 'Prospecto Retencion',
        posicion: 1,
        estado: opts.estado ?? 'en_espera',
        nino_id: opts.ninoId ?? null,
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    return data!
  }

  async function fila(id: string) {
    const { data } = await serviceClient
      .from('lista_espera')
      .select('estado, descartado_at')
      .eq('id', id)
      .maybeSingle()
    return data
  }

  async function copias(id: string): Promise<string[]> {
    const { data, error } = await serviceClient
      .from('audit_log')
      .select('accion')
      .eq('tabla', 'lista_espera')
      .eq('registro_id', id)
    expect(error).toBeNull()
    return (data ?? []).map((f) => f.accion as string)
  }

  it('descartar fija la fecha; volver a la lista la quita; el CHECK las ata', async () => {
    const p = await prospecto({ curso: cursoVivo })
    expect((await fila(p.id))?.descartado_at).toBeNull()

    const antes = Date.now()
    const { error } = await serviceClient
      .from('lista_espera')
      .update({ estado: 'descartado' })
      .eq('id', p.id)
    expect(error).toBeNull()
    const descartada = await fila(p.id)
    expect(descartada?.estado).toBe('descartado')
    expect(new Date(descartada!.descartado_at!).getTime()).toBeGreaterThanOrEqual(antes - 60_000)

    const { error: eVuelta } = await serviceClient
      .from('lista_espera')
      .update({ estado: 'en_espera' })
      .eq('id', p.id)
    expect(eVuelta).toBeNull()
    expect((await fila(p.id))?.descartado_at).toBeNull()

    // Descartado sin fecha, o fecha sin descartar: el CHECK no lo deja.
    const sinDescartar = await serviceClient
      .from('lista_espera')
      .update({ descartado_at: new Date().toISOString() })
      .eq('id', p.id)
    expect(sinDescartar.error?.code).toBe('23514')
  })

  it('borra los vencidos sin niño, sin copia; conserva el resto con la suya', async () => {
    const nino = await createTestNino(centro.id, 'Nino Retencion Lista Espera')
    const cursoTerminado = await prospecto({ curso: cursoViejo })
    const descartadoViejo = await prospecto({ curso: cursoVivo, estado: 'descartado' })
    const { error: eFecha } = await serviceClient
      .from('lista_espera')
      .update({ descartado_at: HACE_30_ANIOS })
      .eq('id', descartadoViejo.id)
    expect(eFecha).toBeNull()
    const descartadoHoy = await prospecto({ curso: cursoVivo, estado: 'descartado' })
    const conNino = await prospecto({ curso: cursoViejo, ninoId: nino.id })
    const enEspera = await prospecto({ curso: cursoVivo })
    const vencen = [cursoTerminado, descartadoViejo]
    const quedan = [descartadoHoy, conNino, enEspera]

    // Premisa: todos tienen su copia del alta en audit_log.
    for (const p of [...vencen, ...quedan]) expect(await copias(p.id)).toContain('INSERT')

    const sim = await serviceClient.rpc('purgar_lista_espera_vencida', {
      p_anios: 20,
      p_simular: true,
    })
    expect(sim.error).toBeNull()
    expect(sim.data).toBeGreaterThanOrEqual(2)
    for (const p of vencen) expect(await fila(p.id)).not.toBeNull()

    const real = await serviceClient.rpc('purgar_lista_espera_vencida', {
      p_anios: 20,
      p_simular: false,
    })
    expect(real.error).toBeNull()
    expect(real.data).toBeGreaterThanOrEqual(2)

    for (const p of vencen) {
      expect(await fila(p.id)).toBeNull()
      expect(await copias(p.id)).toEqual([])
    }
    for (const p of quedan) {
      expect(await fila(p.id)).not.toBeNull()
      expect(await copias(p.id)).toContain('INSERT')
    }
  })

  it('con sesión no se ejecuta', async () => {
    const c = await clientFor(admin)
    const { error } = await c.rpc('purgar_lista_espera_vencida', { p_anios: 1, p_simular: true })
    expect(error?.code).toBe('42501')
  })
})
