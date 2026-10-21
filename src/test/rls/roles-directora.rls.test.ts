import { createHash, randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import {
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestNino,
  createTestUser,
  crearVinculo,
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestCentro,
  type TestNino,
  type TestUser,
} from './setup'

import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * PR 2 del modelo de roles — la directora en la base de datos (`20261030120000` y
 * `20261030130000`).
 *
 * Tres niveles: superusuario, admin (una por centro) y directora (una o varias). `es_admin` es
 * «Dirección» (admin o directora) y lo exclusivo de la admin va por `privado.es_responsable`. Aquí:
 *   - la directora hace el día a día;
 *   - no hace lo exclusivo de la admin;
 *   - no puede escalar: no crea admins ni directoras, ni las toca, ni se toca a sí misma;
 *   - una admin viva por centro.
 * Cada «no» tiene su ancla: la admin sí lo hace, o la directora sí hace lo de al lado.
 */

// Cliente sin tipar para las RPC con argumentos que los tipos no admiten.
type Client = SupabaseClient
type Tipado = SupabaseClient<Database>

const TEXTO = 'Texto legal de prueba, definitivo.'
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

let centroA: TestCentro
let centroB: TestCentro
let centroC: TestCentro
let admin: TestUser
let directora: TestUser
let directora2: TestUser
let profe: TestUser
let tutor: TestUser
let adminC: TestUser
let cAdmin: Tipado
let cDirectora: Tipado
let nino: TestNino
let aula: string
let cursoActivo: string
let cursoB: string
let plantillaImg: string
let instanciaImg: string
let plantillaNormas: string
const autorizaciones: string[] = []

beforeAll(async () => {
  centroA = await createTestCentro('Centro A Directora')
  centroB = await createTestCentro('Centro B Directora')
  centroC = await createTestCentro('Centro C Directora')
  cursoActivo = (await createTestCurso(centroA.id, 'activo')).id
  cursoB = (await createTestCurso(centroB.id, 'planificado')).id
  aula = (await createTestAula(centroA.id, cursoActivo, 'Aula Directora')).id
  nino = await createTestNino(centroA.id, 'Nino Directora')
  await matricular(nino.id, aula, cursoActivo)

  admin = await createTestUser({ nombre: 'Admin Directora' })
  directora = await createTestUser({ nombre: 'Directora Pruebas' })
  directora2 = await createTestUser({ nombre: 'Directora Dos Pruebas' })
  profe = await createTestUser({ nombre: 'Profe Directora' })
  tutor = await createTestUser({ nombre: 'Tutor Directora' })
  adminC = await createTestUser({ nombre: 'Admin C Directora' })
  await asignarRol(admin.id, centroA.id, 'admin')
  await asignarRol(directora.id, centroA.id, 'directora')
  await asignarRol(directora.id, centroB.id, 'directora')
  await asignarRol(directora2.id, centroA.id, 'directora')
  await asignarRol(profe.id, centroA.id, 'profe')
  await asignarRol(tutor.id, centroA.id, 'tutor_legal')
  await asignarRol(adminC.id, centroC.id, 'admin')
  await crearVinculo(nino.id, tutor.id, 'tutor_legal_principal', {
    puede_firmar_autorizaciones: true,
  })
  cAdmin = await clientFor(admin)
  cDirectora = await clientFor(directora)

  // El consentimiento de imagen: la plantilla (de la admin) y una instancia para el niño.
  const pl = await serviceClient
    .from('autorizaciones')
    .insert({
      centro_id: centroA.id,
      tipo: 'autorizacion_imagenes',
      es_plantilla: true,
      titulo: 'Consentimiento de imagen',
      texto: TEXTO,
      texto_version: 'v1',
      texto_definitivo: true,
      estado: 'publicada',
      creado_por: admin.id,
    })
    .select('id')
    .single()
  if (pl.error || !pl.data) throw new Error(`plantilla imagen: ${pl.error?.message}`)
  plantillaImg = pl.data.id
  const inst = await serviceClient
    .from('autorizaciones')
    .insert({
      centro_id: centroA.id,
      tipo: 'autorizacion_imagenes',
      es_plantilla: false,
      ambito: 'nino',
      nino_id: nino.id,
      plantilla_id: plantillaImg,
      titulo: 'Consentimiento de imagen',
      texto: TEXTO,
      texto_version: 'v1',
      texto_definitivo: true,
      estado: 'publicada',
      creado_por: admin.id,
    })
    .select('id')
    .single()
  if (inst.error || !inst.data) throw new Error(`instancia imagen: ${inst.error?.message}`)
  instanciaImg = inst.data.id

  // Las normas internas: la plantilla es de la admin.
  const normas = await serviceClient
    .from('autorizaciones')
    .insert({
      centro_id: centroA.id,
      tipo: 'reglas_regimen_interno',
      es_plantilla: true,
      titulo: 'Normas del centro',
      texto: TEXTO,
      texto_version: 'v1',
      texto_definitivo: true,
      estado: 'publicada',
      creado_por: admin.id,
    })
    .select('id')
    .single()
  if (normas.error || !normas.data) throw new Error(`plantilla normas: ${normas.error?.message}`)
  plantillaNormas = normas.data.id
}, 240_000)

afterAll(async () => {
  const usuarios = [admin, directora, directora2, profe, tutor, adminC]
    .filter(Boolean)
    .map((u) => u.id)
  await serviceClient.from('consentimientos').delete().in('usuario_id', usuarios)
  if (instanciaImg)
    await serviceClient.from('firmas_autorizacion').delete().eq('autorizacion_id', instanciaImg)
  for (const id of [...autorizaciones.reverse(), instanciaImg, plantillaImg, plantillaNormas])
    if (id) await serviceClient.from('autorizaciones').delete().eq('id', id)
  for (const c of [centroA, centroB, centroC].filter(Boolean)) {
    await serviceClient.from('plantillas_menu_mensual').delete().eq('centro_id', c.id)
    await serviceClient.from('invitaciones').delete().eq('centro_id', c.id)
  }
  if (nino) await serviceClient.from('vinculos_familiares').delete().eq('nino_id', nino.id)
  for (const u of usuarios) await deleteTestUser(u)
  for (const c of [centroA, centroB, centroC].filter(Boolean)) await deleteTestCentro(c.id)
}, 120_000)

it('premisa: la directora tiene el rol directora en A y en B, y ninguno de admin', async () => {
  const { data, error } = await serviceClient
    .from('roles_usuario')
    .select('centro_id, rol')
    .eq('usuario_id', directora.id)
    .is('deleted_at', null)
  expect(error).toBeNull()
  expect(data?.map((r) => `${r.centro_id === centroA.id ? 'A' : 'B'}:${r.rol}`).sort()).toEqual([
    'A:directora',
    'B:directora',
  ])
})

describe('hace el día a día', () => {
  it('lee su centro, y no uno donde no es nada', async () => {
    const { data } = await cDirectora
      .from('centros')
      .select('id')
      .in('id', [centroA.id, centroC.id])
    expect(data?.map((c) => c.id)).toEqual([centroA.id])
  })

  it('crea un aula', async () => {
    const { data, error } = await cDirectora
      .from('aulas')
      .insert({ centro_id: centroA.id, nombre: `Aula nueva ${randomUUID().slice(0, 6)}` })
      .select('id')
      .single()
    expect(error).toBeNull()
    expect(data?.id).toBeTruthy()
  })

  it('da de alta a una profe', async () => {
    const nueva = await createTestUser({ nombre: 'Profe Nueva Directora' })
    try {
      const { error } = await cDirectora
        .from('roles_usuario')
        .insert({ usuario_id: nueva.id, centro_id: centroA.id, rol: 'profe' })
      expect(error).toBeNull()
    } finally {
      await deleteTestUser(nueva.id)
    }
  })

  it('crea un curso, y activa el primero de un centro sin curso activo', async () => {
    const nuevo = await cDirectora
      .from('cursos_academicos')
      .insert({
        centro_id: centroA.id,
        nombre: `Curso ${randomUUID().slice(0, 6)}`,
        fecha_inicio: '2027-09-01',
        fecha_fin: '2028-07-31',
        estado: 'planificado',
      })
      .select('id')
      .single()
    expect(nuevo.error).toBeNull()

    const activar = await cDirectora
      .from('cursos_academicos')
      .update({ estado: 'activo' })
      .eq('id', cursoB)
      .select('estado')
      .single()
    expect(activar.error).toBeNull()
    expect(activar.data?.estado).toBe('activo')
  })

  it('prepara el menú del mes', async () => {
    const { error } = await cDirectora.from('plantillas_menu_mensual').insert({
      centro_id: centroA.id,
      mes: 11,
      anio: 2026,
      estado: 'borrador',
      creada_por: directora.id,
    })
    expect(error).toBeNull()
  })

  it('lee las cuotas, que necesita para la facturación', async () => {
    const { error: errIns } = await serviceClient.from('conceptos_cobro').insert({
      centro_id: centroA.id,
      nombre: 'Cuota Directora',
      tipo_concepto: 'mensual',
      tipo_valor: 'fijo',
      signo: 1,
      ambito: 'nino',
      importe_centimos: 20000,
    })
    expect(errIns).toBeNull()
    const { data, error } = await cDirectora
      .from('conceptos_cobro')
      .select('nombre')
      .eq('centro_id', centroA.id)
    expect(error).toBeNull()
    expect(data?.map((c) => c.nombre)).toContain('Cuota Directora')
  })

  it('envía las normas al aula desde la plantilla de la admin', async () => {
    const { data, error } = await cDirectora
      .from('autorizaciones')
      .insert({
        centro_id: centroA.id,
        tipo: 'reglas_regimen_interno',
        es_plantilla: false,
        ambito: 'aula',
        aula_id: aula,
        plantilla_id: plantillaNormas,
        titulo: 'Normas para el aula',
        texto: TEXTO,
        texto_version: 'v1',
        texto_definitivo: true,
        estado: 'publicada',
        creado_por: directora.id,
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    if (data) autorizaciones.push(data.id)
  })

  it('su firma presencial del consentimiento de imagen lo registra (firma_imagen_sync)', async () => {
    const { error } = await cDirectora.from('firmas_autorizacion').insert({
      autorizacion_id: instanciaImg,
      nino_id: nino.id,
      firmante_id: directora.id,
      rol_firmante: 'admin',
      decision: 'firmado',
      metodo_firma: 'presencial',
      texto_hash: sha256(TEXTO),
      texto_version: 'v1',
      nombre_tecleado: 'Directora Pruebas',
    })
    expect(error).toBeNull()
    const { data } = await serviceClient
      .from('consentimientos')
      .select('id')
      .eq('usuario_id', directora.id)
      .eq('nino_id', nino.id)
      .eq('tipo', 'imagen')
      .is('revocado_en', null)
    expect(data).toHaveLength(1)
  })
})

describe('no hace lo exclusivo de la admin', () => {
  it('no cambia los datos del centro (la admin sí)', async () => {
    const dir = await cDirectora
      .from('centros')
      .update({ telefono: '600000001' })
      .eq('id', centroA.id)
      .select('id')
    expect(dir.error).toBeNull()
    expect(dir.data).toHaveLength(0)
    const adm = await cAdmin
      .from('centros')
      .update({ telefono: '600000002' })
      .eq('id', centroA.id)
      .select('id')
    expect(adm.data).toHaveLength(1)
  })

  it('no sube el logo (la admin sí)', async () => {
    const ruta = `${centroA.id}/logo-${randomUUID().slice(0, 6)}.png`
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    const opciones = { contentType: 'image/png', upsert: true }
    try {
      // El rechazo tiene que venir de la policy, no del tipo de fichero ni de la ruta.
      const dir = await cDirectora.storage.from('centro-assets').upload(ruta, png, opciones)
      expect(dir.error?.message).toMatch(/row-level security/)
      const adm = await cAdmin.storage.from('centro-assets').upload(ruta, png, opciones)
      expect(adm.error).toBeNull()
    } finally {
      await serviceClient.storage.from('centro-assets').remove([ruta])
    }
  })

  it('no escribe los datos de acreedor SEPA', async () => {
    const { error } = await (cDirectora as unknown as Client).rpc('set_datos_acreedor', {
      p_centro_id: centroA.id,
      p_identificador_acreedor: 'ES00ZZZ00000000',
      p_bic_acreedor: 'CAIXESBBXXX',
      p_iban: '',
    })
    expect(error?.message).toBe('No autorizado')
  })

  it('no crea un concepto de cobro ni un tipo de beca', async () => {
    const concepto = await cDirectora.from('conceptos_cobro').insert({
      centro_id: centroA.id,
      nombre: 'Concepto de la directora',
      tipo_concepto: 'mensual',
      tipo_valor: 'fijo',
      signo: 1,
      ambito: 'nino',
      importe_centimos: 1000,
    })
    expect(concepto.error?.code).toBe('42501')
    const beca = await cDirectora
      .from('tipos_beca')
      .insert({ centro_id: centroA.id, nombre: 'Beca de la directora' })
    expect(beca.error?.code).toBe('42501')
  })

  it('no cierra el curso (sí lo edita)', async () => {
    const editar = await cDirectora
      .from('cursos_academicos')
      .update({ nombre: `Curso activo ${randomUUID().slice(0, 6)}` })
      .eq('id', cursoActivo)
      .select('id')
    expect(editar.data).toHaveLength(1)
    const { error } = await cDirectora
      .from('cursos_academicos')
      .update({ estado: 'cerrado' })
      .eq('id', cursoActivo)
      .select('id')
    expect(error?.code).toBe('42501')
    const { data } = await serviceClient
      .from('cursos_academicos')
      .select('estado')
      .eq('id', cursoActivo)
      .single()
    expect(data?.estado).toBe('activo')
  })

  it('no crea la plantilla de las normas ni del consentimiento de imagen', async () => {
    for (const tipo of ['reglas_regimen_interno', 'autorizacion_imagenes'] as const) {
      const { error } = await cDirectora.from('autorizaciones').insert({
        centro_id: centroB.id,
        tipo,
        es_plantilla: true,
        titulo: 'Plantilla de la directora',
        texto: TEXTO,
        texto_version: 'v1',
        texto_definitivo: true,
        estado: 'borrador',
        creado_por: directora.id,
      })
      expect(error?.code, tipo).toBe('42501')
    }
  })

  it('no edita la plantilla de las normas (la admin sí)', async () => {
    const dir = await cDirectora
      .from('autorizaciones')
      .update({ titulo: 'Normas cambiadas por la directora' })
      .eq('id', plantillaNormas)
      .select('id')
    expect(dir.error).toBeNull()
    expect(dir.data).toHaveLength(0)
    const adm = await cAdmin
      .from('autorizaciones')
      .update({ titulo: 'Normas del centro (revisadas)' })
      .eq('id', plantillaNormas)
      .select('id')
    expect(adm.data).toHaveLength(1)
  })

  it('no lee la auditoría del centro (la admin sí)', async () => {
    const adm = await cAdmin.from('audit_log').select('id').eq('centro_id', centroA.id).limit(1)
    expect(adm.data?.length).toBe(1)
    const dir = await cDirectora.from('audit_log').select('id').eq('centro_id', centroA.id)
    expect(dir.error).toBeNull()
    expect(dir.data).toHaveLength(0)
  })

  it('no exporta los datos de un niño como Dirección', async () => {
    const { error } = await cDirectora.rpc('export_datos_sujeto', {
      p_sujeto_tipo: 'nino',
      p_sujeto_id: nino.id,
    })
    expect(error?.code).toBe('42501')
  })

  it('no ejerce el derecho al olvido', async () => {
    const { error } = await cDirectora.rpc('solicitar_olvido_nino', {
      p_nino_id: nino.id,
      p_inmediato: false,
    })
    expect(error?.message).toBe('no autorizado a ejercer el olvido en este centro')
  })
})

describe('no puede escalar', () => {
  it('no crea una admin ni otra directora', async () => {
    const nueva = await createTestUser({ nombre: 'Escalada Directora' })
    try {
      for (const rol of ['admin', 'directora'] as const) {
        const { error } = await cDirectora
          .from('roles_usuario')
          .insert({ usuario_id: nueva.id, centro_id: centroA.id, rol })
        expect(error?.code, rol).toBe('42501')
      }
    } finally {
      await deleteTestUser(nueva.id)
    }
  })

  it('no asciende a la profe a directora', async () => {
    const { error } = await cDirectora
      .from('roles_usuario')
      .update({ rol: 'directora' })
      .eq('usuario_id', profe.id)
      .eq('centro_id', centroA.id)
      .select('id')
    expect(error?.code).toBe('42501')
  })

  it('ancla: sí retira a una profe', async () => {
    const otra = await createTestUser({ nombre: 'Profe Retirada Directora' })
    try {
      await asignarRol(otra.id, centroA.id, 'profe')
      const { data, error } = await cDirectora
        .from('roles_usuario')
        .update({ deleted_at: new Date().toISOString(), deleted_reason: 'baja_nino' })
        .eq('usuario_id', otra.id)
        .eq('centro_id', centroA.id)
        .select('id')
      expect(error).toBeNull()
      expect(data).toHaveLength(1)
    } finally {
      await deleteTestUser(otra.id)
    }
  })

  it('no quita a la admin ni a la otra directora, ni se quita a sí misma', async () => {
    for (const u of [admin, directora2, directora]) {
      const { data, error } = await cDirectora
        .from('roles_usuario')
        .update({ deleted_at: new Date().toISOString(), deleted_reason: 'baja_nino' })
        .eq('usuario_id', u.id)
        .eq('centro_id', centroA.id)
        .select('id')
      expect(error).toBeNull()
      expect(data, u.id).toHaveLength(0)
    }
    const { data } = await serviceClient
      .from('roles_usuario')
      .select('usuario_id')
      .eq('centro_id', centroA.id)
      .in('usuario_id', [admin.id, directora2.id, directora.id])
      .is('deleted_at', null)
    expect(data).toHaveLength(3)
  })

  it('no borra una invitación de directora (la admin sí)', async () => {
    const { data: inv, error: errInv } = await serviceClient
      .from('invitaciones')
      .insert({
        email: `directora-${randomUUID().slice(0, 8)}@nido.test`,
        centro_id: centroA.id,
        rol_objetivo: 'directora',
        token: randomUUID(),
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        invitado_por: admin.id,
      })
      .select('id')
      .single()
    expect(errInv).toBeNull()
    const { data, error } = await cDirectora
      .from('invitaciones')
      .delete()
      .eq('id', inv!.id)
      .select('id')
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
    const adm = await cAdmin.from('invitaciones').delete().eq('id', inv!.id).select('id')
    expect(adm.data).toHaveLength(1)
  })

  it('ancla: la admin sí nombra a una directora', async () => {
    const nueva = await createTestUser({ nombre: 'Directora Nombrada' })
    try {
      const { error } = await cAdmin
        .from('roles_usuario')
        .insert({ usuario_id: nueva.id, centro_id: centroA.id, rol: 'directora' })
      expect(error).toBeNull()
    } finally {
      await deleteTestUser(nueva.id)
    }
  })
})

describe('una admin viva por centro', () => {
  it('una segunda admin viva en el mismo centro no cabe', async () => {
    const otra = await createTestUser({ nombre: 'Segunda Admin' })
    try {
      const { error } = await serviceClient
        .from('roles_usuario')
        .insert({ usuario_id: otra.id, centro_id: centroA.id, rol: 'admin' })
      expect(error?.code).toBe('23505')
    } finally {
      await deleteTestUser(otra.id)
    }
  })

  it('ancla: una admin retirada no cuenta', async () => {
    const ex = await createTestUser({ nombre: 'Admin Retirada' })
    try {
      const { error } = await serviceClient.from('roles_usuario').insert({
        usuario_id: ex.id,
        centro_id: centroA.id,
        rol: 'admin',
        deleted_at: new Date().toISOString(),
        deleted_reason: 'paso_a_superusuario',
      })
      expect(error).toBeNull()
    } finally {
      await deleteTestUser(ex.id)
    }
  })
})
