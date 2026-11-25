import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  crearFamiliaTutor,
  crearVinculo,
  createTestCentro,
  createTestNino,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from '../rls/setup'

import { purgarUno } from '@/features/olvido/actions/purgar-vencidos'
import {
  BUCKET_DNI_TUTORES,
  BUCKET_LIBRO_FAMILIA,
  BUCKET_NINOS_FOTOS,
  BUCKET_SIP_NINOS,
  BUCKET_USUARIOS_FOTOS,
} from '@/shared/lib/adjuntos/storage'

/**
 * ¿La purga del art. 17 recoge un HUÉRFANO? (decisión del 2026-11-25, spec fallos-leidos-c).
 *
 * Un huérfano es lo que deja una sustitución cuyo borrado del fichero viejo falló: las rutas de
 * subida hacen `borrarObjetosBucket(…, [anterior]).catch(() => undefined)`. Queda en la MISMA
 * carpeta y con la misma forma de ruta que el vigente, pero ninguna fila lo nombra.
 *
 * Por bucket: un fichero VIGENTE (el que nombra la fila) y un HUÉRFANO al lado. La purga es la de
 * verdad (`solicitar_olvido_* inmediato` + `purgarUno`: ficheros primero, después la base).
 * - Premisa: los dos están antes de purgar.
 * - Control positivo: el vigente ya no está (la purga corrió y borró en ese bucket).
 * - Lo medido: el huérfano tampoco está. Si sigue, es un borrado que decimos haber hecho y no.
 */

const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0])
const PDF = Buffer.from('%PDF-1.4\n%%EOF\n')

async function subir(bucket: string, ruta: string) {
  const esJpg = ruta.endsWith('.jpg')
  const { error } = await serviceClient.storage
    .from(bucket)
    .upload(ruta, esJpg ? JPG : PDF, { contentType: esJpg ? 'image/jpeg' : 'application/pdf' })
  if (error) throw new Error(`subir ${bucket}/${ruta}: ${error.message}`)
}

/** ¿Sigue el objeto? Por el listado de su carpeta (el mismo camino que usa la purga). */
async function existe(bucket: string, ruta: string): Promise<boolean> {
  const corte = ruta.lastIndexOf('/')
  const carpeta = ruta.slice(0, corte)
  const nombre = ruta.slice(corte + 1)
  const { data, error } = await serviceClient.storage
    .from(bucket)
    .list(carpeta, { limit: 1000, search: nombre })
  if (error) throw new Error(`listar ${bucket}/${carpeta}: ${error.message}`)
  return (data ?? []).some((o) => o.name === nombre)
}

describe('la purga del art. 17 y un fichero huérfano', () => {
  let centro: { id: string }
  const usuarios: TestUser[] = []
  const solicitudes: string[] = []
  const subidos: [string, string][] = []

  async function subirYApuntar(bucket: string, ruta: string) {
    await subir(bucket, ruta)
    subidos.push([bucket, ruta])
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Huerfano Olvido')
  }, 120_000)

  afterAll(async () => {
    for (const [bucket, ruta] of subidos) {
      await serviceClient.storage.from(bucket).remove([ruta])
    }
    if (solicitudes.length) {
      await serviceClient.from('olvido_solicitudes').delete().in('id', solicitudes)
    }
    await deleteTestCentro(centro.id)
    for (const u of usuarios) await deleteTestUser(u.id)
  }, 120_000)

  describe('purga del niño', () => {
    const casos: {
      bucket: string
      columna: 'foto_url' | 'libro_familia_path' | 'sip_documento_path'
      ext: string
    }[] = [
      { bucket: BUCKET_NINOS_FOTOS, columna: 'foto_url', ext: 'jpg' },
      { bucket: BUCKET_LIBRO_FAMILIA, columna: 'libro_familia_path', ext: 'pdf' },
      { bucket: BUCKET_SIP_NINOS, columna: 'sip_documento_path', ext: 'pdf' },
    ]
    const vigente: Record<string, string> = {}
    const huerfano: Record<string, string> = {}
    let antes: Record<string, [boolean, boolean]> = {}

    beforeAll(async () => {
      const nino = await createTestNino(centro.id)
      const carpeta = `${centro.id}/${nino.id}`
      for (const c of casos) {
        vigente[c.bucket] = `${carpeta}/${randomUUID()}.${c.ext}`
        huerfano[c.bucket] = `${carpeta}/${randomUUID()}.${c.ext}`
        await subirYApuntar(c.bucket, vigente[c.bucket])
        await subirYApuntar(c.bucket, huerfano[c.bucket])
        const { error } = await serviceClient
          .from('ninos')
          .update({ [c.columna]: vigente[c.bucket] })
          .eq('id', nino.id)
        if (error) throw new Error(`apuntar ${c.columna}: ${error.message}`)
      }
      antes = Object.fromEntries(
        await Promise.all(
          casos.map(async (c) => [
            c.bucket,
            [await existe(c.bucket, vigente[c.bucket]), await existe(c.bucket, huerfano[c.bucket])],
          ])
        )
      )

      const { data: sol, error: sErr } = await serviceClient.rpc('solicitar_olvido_nino', {
        p_nino_id: nino.id,
        p_inmediato: true,
      })
      if (sErr) throw new Error(`solicitar_olvido_nino: ${sErr.message}`)
      solicitudes.push(sol as string)
      await purgarUno(serviceClient, {
        solicitud_id: sol as string,
        sujeto_tipo: 'nino',
        sujeto_id: nino.id,
        centro_id: centro.id,
        gracia_hasta: new Date().toISOString(),
      })
    }, 120_000)

    for (const c of casos) {
      it(`${c.bucket}: el huérfano no sobrevive a la purga`, async () => {
        expect(antes[c.bucket], 'premisa: vigente y huérfano están antes de purgar').toEqual([
          true,
          true,
        ])
        expect(
          await existe(c.bucket, vigente[c.bucket]),
          'control: el vigente ya no está (la purga borró en este bucket)'
        ).toBe(false)
        expect(await existe(c.bucket, huerfano[c.bucket]), 'el huérfano sigue').toBe(false)
      })
    }
  })

  describe('purga del usuario (tutor)', () => {
    let dniVigente: string
    let dniHuerfano: string
    let avatarVigente: string
    let avatarHuerfano: string
    let antes: boolean[] = []

    beforeAll(async () => {
      const nino = await createTestNino(centro.id)
      const tutor = await createTestUser({ nombre: 'Tutor Huerfano Olvido' })
      usuarios.push(tutor)
      await asignarRol(tutor.id, centro.id, 'tutor_legal')
      await crearVinculo(nino.id, tutor.id, 'tutor_legal_principal')
      const fila = await crearFamiliaTutor(nino.familia_id, tutor.id, 'titular')

      // La forma de ruta de la subida real del DNI (alta/[ninoId]/dni/route.ts).
      const carpeta = `${centro.id}/${nino.id}`
      dniVigente = `${carpeta}/dni-titular-${randomUUID()}.pdf`
      dniHuerfano = `${carpeta}/dni-titular-${randomUUID()}.pdf`
      await subirYApuntar(BUCKET_DNI_TUTORES, dniVigente)
      await subirYApuntar(BUCKET_DNI_TUTORES, dniHuerfano)
      const { error: fErr } = await serviceClient
        .from('familia_tutores')
        .update({ dni_documento_path: dniVigente })
        .eq('id', fila)
      if (fErr) throw new Error(`apuntar DNI: ${fErr.message}`)

      avatarVigente = `${tutor.id}/${randomUUID()}.jpg`
      avatarHuerfano = `${tutor.id}/${randomUUID()}.jpg`
      await subirYApuntar(BUCKET_USUARIOS_FOTOS, avatarVigente)
      await subirYApuntar(BUCKET_USUARIOS_FOTOS, avatarHuerfano)
      const { error: uErr } = await serviceClient
        .from('usuarios')
        .update({ foto_url: avatarVigente })
        .eq('id', tutor.id)
      if (uErr) throw new Error(`apuntar avatar: ${uErr.message}`)

      antes = [
        await existe(BUCKET_DNI_TUTORES, dniVigente),
        await existe(BUCKET_DNI_TUTORES, dniHuerfano),
        await existe(BUCKET_USUARIOS_FOTOS, avatarVigente),
        await existe(BUCKET_USUARIOS_FOTOS, avatarHuerfano),
      ]

      const { data: sol, error: sErr } = await serviceClient.rpc('solicitar_olvido_usuario', {
        p_usuario_id: tutor.id,
        p_centro_id: centro.id,
        p_inmediato: true,
      })
      if (sErr) throw new Error(`solicitar_olvido_usuario: ${sErr.message}`)
      solicitudes.push(sol as string)
      await purgarUno(serviceClient, {
        solicitud_id: sol as string,
        sujeto_tipo: 'usuario',
        sujeto_id: tutor.id,
        centro_id: centro.id,
        gracia_hasta: new Date().toISOString(),
      })
    }, 120_000)

    it('dni-tutores: el DNI huérfano del tutor no sobrevive a la purga', async () => {
      expect(antes.slice(0, 2), 'premisa: vigente y huérfano están antes de purgar').toEqual([
        true,
        true,
      ])
      expect(await existe(BUCKET_DNI_TUTORES, dniVigente), 'control: el vigente ya no está').toBe(
        false
      )
      expect(await existe(BUCKET_DNI_TUTORES, dniHuerfano), 'el DNI huérfano sigue').toBe(false)
    })

    it('usuarios-fotos: el avatar huérfano no sobrevive a la purga', async () => {
      expect(antes.slice(2), 'premisa: vigente y huérfano están antes de purgar').toEqual([
        true,
        true,
      ])
      expect(
        await existe(BUCKET_USUARIOS_FOTOS, avatarVigente),
        'control: el vigente ya no está'
      ).toBe(false)
      expect(await existe(BUCKET_USUARIOS_FOTOS, avatarHuerfano), 'el avatar huérfano sigue').toBe(
        false
      )
    })
  })
})
