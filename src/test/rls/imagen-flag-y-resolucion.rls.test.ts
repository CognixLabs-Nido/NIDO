import { randomUUID } from 'crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestFamilia,
  createTestNino,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestAula,
  type TestCentro,
  type TestNino,
  type TestUser,
} from './setup'

/**
 * Consentimiento de imagen por niño (serie IU, ADR-0054): los dos blindajes que solo se
 * habían probado con ensayos en transacción revertida.
 *
 * IU-1b — `20260821150000_phase_imagen_iu1b_flag_solo_derivado`. El trigger BEFORE
 * `ninos_flag_imagen_derivado_trg` ignora el valor que llega de `puede_aparecer_en_fotos` y
 * fuerza el derivado del consentimiento (`tiene_consentimiento_imagen`). Ni Dirección con
 * sesión ni `service_role` pueden escribirlo a mano, ni al insertar ni al actualizar.
 *
 * IU-5 — `20260821180000_phase_imagen_iu5_resolucion_etiquetas`. `resolver_etiqueta_imagen`
 * marca una etiqueta foto×niño como resuelta (`resuelta_en`, `resuelta_por`). Solo la ejecuta
 * el admin del centro de la etiqueta, es idempotente y una etiqueta inexistente devuelve 0.
 * `media_etiquetas` no tiene policy UPDATE: la RPC es la única vía.
 */

describe('Imagen — el flag solo se deriva (IU-1b) y la resolución de etiquetas (IU-5)', () => {
  let centro: TestCentro
  let centroB: TestCentro
  let aula: TestAula
  let admin: TestUser
  let adminB: TestUser
  let profe: TestUser
  let tutor: TestUser
  let nino: TestNino
  const ninosExtra: string[] = []

  const flag = async (ninoId: string): Promise<boolean> => {
    const { data, error } = await serviceClient
      .from('ninos')
      .select('puede_aparecer_en_fotos')
      .eq('id', ninoId)
      .single()
    if (error || !data) throw new Error(`leer flag falló: ${error?.message}`)
    return data.puede_aparecer_en_fotos
  }
  const otorgar = async (ninoId: string): Promise<void> => {
    const { error } = await serviceClient.rpc('otorgar_consentimiento_imagen', {
      p_nino_id: ninoId,
      p_tutor: tutor.id,
    })
    if (error) throw new Error(`otorgar falló: ${error.message}`)
  }
  const revocar = async (ninoId: string): Promise<void> => {
    const { error } = await serviceClient.rpc('revocar_consentimiento_imagen', {
      p_nino_id: ninoId,
    })
    if (error) throw new Error(`revocar falló: ${error.message}`)
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Imagen Flag')
    centroB = await createTestCentro('Centro Imagen Flag B')
    const curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id, 'Aula Imagen Flag')
    admin = await createTestUser({ nombre: 'Admin Imagen' })
    adminB = await createTestUser({ nombre: 'Admin Imagen B' })
    profe = await createTestUser({ nombre: 'Profe Imagen' })
    tutor = await createTestUser({ nombre: 'Tutor Imagen' })
    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(adminB.id, centroB.id, 'admin')
    await asignarRol(profe.id, centro.id, 'profe')
    await asignarRol(tutor.id, centro.id, 'tutor_legal')
    nino = await createTestNino(centro.id, 'Nino Imagen Flag')
  }, 120_000)

  afterAll(async () => {
    await serviceClient.from('publicaciones').delete().eq('centro_id', centro.id)
    for (const id of [nino.id, ...ninosExtra]) {
      await serviceClient.from('consentimientos').delete().eq('nino_id', id)
      await serviceClient.from('ninos').delete().eq('id', id)
    }
    await deleteTestCentro(centro.id)
    await deleteTestCentro(centroB.id)
    for (const u of [admin, adminB, profe, tutor]) await deleteTestUser(u.id)
  }, 120_000)

  describe('IU-1b — el flag no se escribe a mano', () => {
    it('premisa: sin consentimiento el flag es false', async () => {
      expect(await flag(nino.id)).toBe(false)
    })

    it('Dirección con sesión no lo enciende sin consentimiento', async () => {
      const c = await clientFor(admin)
      const { data, error } = await c
        .from('ninos')
        .update({ puede_aparecer_en_fotos: true })
        .eq('id', nino.id)
        .select('id')
      expect(error).toBeNull()
      // Premisa: el UPDATE sí llegó a la fila (la RLS de admin la deja); lo que no pasa es el valor.
      expect(data).toHaveLength(1)
      expect(await flag(nino.id)).toBe(false)
    })

    it('service_role tampoco: el trigger se aplica a todos', async () => {
      const { error } = await serviceClient
        .from('ninos')
        .update({ puede_aparecer_en_fotos: true })
        .eq('id', nino.id)
      expect(error).toBeNull()
      expect(await flag(nino.id)).toBe(false)
    })

    it('al insertar un niño con el flag a true, queda en false', async () => {
      const familiaId = await createTestFamilia(centro.id)
      const { data, error } = await serviceClient
        .from('ninos')
        .insert({
          centro_id: centro.id,
          familia_id: familiaId,
          nombre: 'Nino Insert Flag',
          apellidos: 'Apellido Test',
          fecha_nacimiento: '2024-03-15',
          puede_aparecer_en_fotos: true,
        })
        .select('id, puede_aparecer_en_fotos')
        .single()
      expect(error).toBeNull()
      ninosExtra.push(data!.id)
      expect(data!.puede_aparecer_en_fotos).toBe(false)
    })

    it('con consentimiento el flag es true y nadie lo apaga a mano', async () => {
      await otorgar(nino.id)
      expect(await flag(nino.id)).toBe(true)

      const c = await clientFor(admin)
      const { data } = await c
        .from('ninos')
        .update({ puede_aparecer_en_fotos: false })
        .eq('id', nino.id)
        .select('id')
      expect(data).toHaveLength(1)
      expect(await flag(nino.id)).toBe(true)

      await serviceClient.from('ninos').update({ puede_aparecer_en_fotos: false }).eq('id', nino.id)
      expect(await flag(nino.id)).toBe(true)
    })

    it('cambiar otra columna no toca el flag, y revocar el consentimiento lo apaga', async () => {
      const c = await clientFor(admin)
      await c.from('ninos').update({ apellidos: 'Apellido Cambiado' }).eq('id', nino.id)
      expect(await flag(nino.id)).toBe(true)

      await revocar(nino.id)
      expect(await flag(nino.id)).toBe(false)
    })
  })

  describe('IU-5 — resolver_etiqueta_imagen', () => {
    let etiqueta: string

    const estado = async (id: string) => {
      const { data, error } = await serviceClient
        .from('media_etiquetas')
        .select('resuelta_en, resuelta_por')
        .eq('id', id)
        .single()
      if (error || !data) throw new Error(`leer etiqueta falló: ${error?.message}`)
      return data
    }

    beforeAll(async () => {
      // Foto del blog con el niño etiquetado mientras tenía consentimiento; después se revoca y
      // la etiqueta queda pendiente de resolver (es lo que lista /admin/fotos-revocadas).
      await otorgar(nino.id)
      const { data: pub, error: pubErr } = await serviceClient
        .from('publicaciones')
        .insert({ centro_id: centro.id, aula_id: aula.id, autor_id: admin.id, texto: 'Excursión' })
        .select('id')
        .single()
      if (pubErr || !pub) throw new Error(`publicación falló: ${pubErr?.message}`)
      const { data: media, error: mediaErr } = await serviceClient
        .from('media')
        .insert({
          publicacion_id: pub.id,
          centro_id: centro.id,
          bucket: 'aula-fotos',
          path: `${centro.id}/${aula.id}/${pub.id}/${randomUUID()}.jpg`,
          mime: 'image/jpeg',
        })
        .select('id')
        .single()
      if (mediaErr || !media) throw new Error(`media falló: ${mediaErr?.message}`)
      const { data: eti, error: etiErr } = await serviceClient
        .from('media_etiquetas')
        .insert({ media_id: media.id, nino_id: nino.id, centro_id: centro.id })
        .select('id')
        .single()
      if (etiErr || !eti) throw new Error(`etiqueta falló: ${etiErr?.message}`)
      etiqueta = eti.id
      await revocar(nino.id)
    }, 120_000)

    it('premisa: la etiqueta está pendiente', async () => {
      expect(await estado(etiqueta)).toEqual({ resuelta_en: null, resuelta_por: null })
    })

    it('la profe del centro, el tutor y el admin de otro centro reciben 42501', async () => {
      for (const u of [profe, tutor, adminB]) {
        const c = await clientFor(u)
        const { error } = await c.rpc('resolver_etiqueta_imagen', {
          p_media_etiqueta_id: etiqueta,
        })
        expect(error?.code, u.email).toBe('42501')
      }
      expect((await estado(etiqueta)).resuelta_en).toBeNull()
    })

    it('ni el admin puede marcarla con un UPDATE directo: no hay policy UPDATE', async () => {
      const c = await clientFor(admin)
      const { data } = await c
        .from('media_etiquetas')
        .update({ resuelta_en: new Date().toISOString(), resuelta_por: admin.id })
        .eq('id', etiqueta)
        .select('id')
      expect(data ?? []).toHaveLength(0)
      expect((await estado(etiqueta)).resuelta_en).toBeNull()
    })

    it('el admin del centro la resuelve: 1 fila, con su id y en audit_log como actor', async () => {
      const c = await clientFor(admin)
      const { data, error } = await c.rpc('resolver_etiqueta_imagen', {
        p_media_etiqueta_id: etiqueta,
      })
      expect(error).toBeNull()
      expect(data).toBe(1)
      const e = await estado(etiqueta)
      expect(e.resuelta_en).not.toBeNull()
      expect(e.resuelta_por).toBe(admin.id)

      const { data: audit } = await serviceClient
        .from('audit_log')
        .select('accion, usuario_id')
        .eq('tabla', 'media_etiquetas')
        .eq('registro_id', etiqueta)
        .eq('accion', 'UPDATE')
      expect(audit).toEqual([{ accion: 'UPDATE', usuario_id: admin.id }])
    })

    it('es idempotente: una segunda llamada devuelve 0 y no cambia la fecha', async () => {
      const antes = await estado(etiqueta)
      const c = await clientFor(admin)
      const { data, error } = await c.rpc('resolver_etiqueta_imagen', {
        p_media_etiqueta_id: etiqueta,
      })
      expect(error).toBeNull()
      expect(data).toBe(0)
      expect(await estado(etiqueta)).toEqual(antes)
    })

    it('una etiqueta inexistente devuelve 0, sin error', async () => {
      const c = await clientFor(admin)
      const { data, error } = await c.rpc('resolver_etiqueta_imagen', {
        p_media_etiqueta_id: randomUUID(),
      })
      expect(error).toBeNull()
      expect(data).toBe(0)
    })
  })
})
