import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import type { SesionConFallos } from './lectura-fallida'
import {
  asignarRol,
  clientFor,
  createTestCentro,
  createTestCurso,
  createTestNino,
  createTestUser,
  crearVinculo,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * Los dos duplicados de C (2026-11-23; censo por helper del 2026-11-12). Dos acciones deciden
 * leyendo «¿ya existe?» y después insertan, sin un índice único detrás:
 *
 * 1. `crearProspecto`: la posición es «la última del curso + 1». Dos altas de prospecto a la vez
 *    leen la misma última y salen con la misma posición.
 * 2. `crearImagenAutorizacion`: si no hay instancia de imagen publicada del niño, la crea. Dos a la
 *    vez (un doble clic, los dos tutores) crean dos.
 *
 * Se mide lanzando CINCO llamadas a la vez, no dos: con dos, un verde podría salir por azar si no
 * coinciden en el tiempo. Lo que se afirma es la tabla.
 */
const sesion = vi.hoisted(
  (): SesionConFallos => ({ actual: null, fallaTabla: null, fallaRpc: null, fallidas: 0 })
)
vi.mock('@/lib/supabase/server', async () => {
  const { clienteConFallos } = await import('./lectura-fallida')
  return { createClient: async () => clienteConFallos(sesion) }
})
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

const { crearProspecto } = await import('@/features/lista-espera/actions/crear-prospecto')
const { crearImagenAutorizacion } = await import('@/features/autorizaciones/actions/crear-imagen')

const A_LA_VEZ = 5

describe('dos a la vez no crean un duplicado', () => {
  let centroId: string
  let cursoId: string
  let ninoId: string
  let admin: TestUser
  let tutor: TestUser

  beforeAll(async () => {
    const centro = await createTestCentro('Centro Sin Duplicados')
    centroId = centro.id
    cursoId = (await createTestCurso(centro.id)).id
    admin = await createTestUser({ nombre: 'Admin Sin Duplicados' })
    await asignarRol(admin.id, centro.id, 'admin')
    ninoId = (await createTestNino(centro.id, 'Nino Sin Duplicados')).id
    tutor = await createTestUser({ nombre: 'Tutor Sin Duplicados' })
    // Sin el rol del centro la RLS no deja leer la plantilla y la acción contesta «sin plantilla».
    await asignarRol(tutor.id, centro.id, 'tutor_legal')
    await crearVinculo(ninoId, tutor.id, 'tutor_legal_principal', {
      puede_firmar_autorizaciones: true,
    })
    const p = await serviceClient.from('autorizaciones').insert({
      centro_id: centro.id,
      tipo: 'autorizacion_imagenes',
      es_plantilla: true,
      estado: 'publicada',
      texto_definitivo: true,
      titulo: 'Autorización de imagen',
      texto: 'Texto de la autorización de imagen.',
      texto_version: 'v1.0',
      creado_por: admin.id,
    })
    if (p.error) throw new Error(`plantilla imagen: ${p.error.message}`)
  }, 60_000)

  afterAll(async () => {
    sesion.actual = null
    await serviceClient.from('lista_espera').delete().eq('curso_academico_id', cursoId)
    await serviceClient
      .from('autorizaciones')
      .delete()
      .eq('centro_id', centroId)
      .eq('es_plantilla', false)
    await serviceClient.from('autorizaciones').delete().eq('centro_id', centroId)
    await deleteTestCentro(centroId)
    if (admin) await deleteTestUser(admin.id)
    if (tutor) await deleteTestUser(tutor.id)
  }, 60_000)

  it('1 · cinco prospectos a la vez: cinco posiciones distintas', async () => {
    sesion.actual = await clientFor(admin)
    const r = await Promise.all(
      Array.from({ length: A_LA_VEZ }, (_, i) =>
        crearProspecto({
          curso_academico_id: cursoId,
          nombre_nino: `Prospecto ${i}`,
          primer_apellido_nino: 'A La Vez',
        })
      )
    )
    const { data, error } = await serviceClient
      .from('lista_espera')
      .select('posicion')
      .eq('curso_academico_id', cursoId)
    if (error) throw new Error(`leer la lista: ${error.message}`)
    const creados = r.filter((x) => x.success).length
    expect(creados, 'premisa: al menos uno entró').toBeGreaterThan(0)
    // Las cinco entran: la base las pone en fila (cerrojo por curso), no rechaza a cuatro.
    expect(creados, `entraron las cinco (${JSON.stringify(r.map((x) => x.success))})`).toBe(
      A_LA_VEZ
    )
    expect(data!.length, 'filas = las que dijeron que sí').toBe(creados)
    const posiciones = data!.map((d) => d.posicion)
    expect(new Set(posiciones).size, `posiciones: ${posiciones.join(',')}`).toBe(posiciones.length)
  })

  it('2 · cinco «crear la autorización de imagen» a la vez: una sola instancia', async () => {
    sesion.actual = await clientFor(tutor)
    const r = await Promise.all(
      Array.from({ length: A_LA_VEZ }, () => crearImagenAutorizacion({ nino_id: ninoId }))
    )
    // Premisa: ninguna contesta «sin plantilla» (la forma regla, que dejaría esto en 0 instancias
    // sin medir nada: pasó el 2026-11-23 con un montaje sin rol) y al menos una la dejó lista.
    const estados = r.map((x) => (x.success ? x.data.estado : `fallo:${x.error}`))
    expect(estados, 'premisa: ninguna «sin plantilla»').not.toContain('sin_plantilla')
    expect(estados, 'premisa: al menos una lista').toContain('lista')
    const { data, error } = await serviceClient
      .from('autorizaciones')
      .select('id')
      .eq('nino_id', ninoId)
      .eq('tipo', 'autorizacion_imagenes')
      .eq('es_plantilla', false)
    if (error) throw new Error(`leer las instancias: ${error.message}`)
    expect(data!.length, 'instancias de imagen del niño').toBe(1)
    // Cinco clics son UN consentimiento: las cinco contestan «lista» con la MISMA instancia. Sin esto,
    // cuatro que fallaran con `creacion_fallo` dejarían también una sola fila.
    const ids = r.map((x) =>
      x.success && x.data.estado === 'lista' ? x.data.autorizacionId : null
    )
    expect(ids, 'las cinco contestan con la instancia que quedó').toEqual(
      Array(A_LA_VEZ).fill(data![0]!.id)
    )
  })
})
