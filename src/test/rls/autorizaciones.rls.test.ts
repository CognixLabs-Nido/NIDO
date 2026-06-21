import { createHash } from 'crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import {
  asignarProfeAula,
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
  type TestUser,
} from './setup'

/**
 * RLS + integridad de `autorizaciones` y `firmas_autorizacion` (F8-0). **Gated**
 * por `F8_MIGRATION_APPLIED=1`: la migración
 * `20260603120000_phase8_autorizaciones.sql` se aplica manualmente vía Supabase
 * SQL Editor (CLI con bug SIGILL en Penguin). Hasta entonces estos tests se
 * omiten para no romper la suite.
 *
 * Comando tras aplicar la migración:
 *   F8_MIGRATION_APPLIED=1 npm run test:rls -- autorizaciones.rls
 *
 * Cubre los invariantes legales/seguridad del modelo:
 *  - INSERT de autorizaciones por rol (admin cualquier tipo; profe solo 'salida'
 *    de un evento de su aula; tutor denegado) + gotcha MVCC `.insert().select()`.
 *  - SELECT por audiencia con aislamiento por centro.
 *  - **Aislamiento del firmante**: un tutor NO firma por un niño ajeno.
 *  - **Placeholder no firmable**: texto PENDIENTE (texto_definitivo=false /
 *    borrador) rechaza la firma en los tipos por-niño (guard del hash).
 *  - **Fuera de vigencia**: una autorización caducada no es firmable.
 *  - **firma_imagen obligatoria al firmar** (CHECK) y opcional al rechazar.
 *  - **Inmutabilidad** de firmas: UPDATE/DELETE denegados (append-only).
 *  - DELETE de autorizaciones denegado (se anula con estado).
 *  - MVCC en `firmas_autorizacion` (`.insert().select()` con helper que lee
 *    otras tablas).
 */
const MIGRATION_APPLIED = process.env.F8_MIGRATION_APPLIED === '1'

const TEXTO_REAL = 'Autorizo la salida de mi hijo/a en las condiciones descritas. Texto legal real.'
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')
const SVG_TRAZO = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L10 10"/></svg>'

type AutorizacionInsert = Database['public']['Tables']['autorizaciones']['Insert']
type FirmaInsert = Database['public']['Tables']['firmas_autorizacion']['Insert']
type TipoAutorizacion = Database['public']['Enums']['tipo_autorizacion']

describe.skipIf(!MIGRATION_APPLIED)('RLS autorizaciones + firmas — F8-0', () => {
  let centro: { id: string }
  let centroB: { id: string }
  let aula: { id: string }
  let admin: TestUser
  let profe: TestUser
  let tutor: TestUser // tutor de `nino` en `centro`
  let tutorB: TestUser // tutor de `ninoB` en `centroB`
  let nino: { id: string }
  let ninoB: { id: string }
  let eventoSalida: string // evento ámbito aula del que cuelga la 'salida'

  const autorizacionesCreadas: string[] = []
  const firmasCreadas: string[] = []
  const eventosCreados: string[] = []

  beforeAll(async () => {
    centro = await createTestCentro('Centro Autoriz')
    centroB = await createTestCentro('Centro Autoriz B')
    const curso = await createTestCurso(centro.id)
    const cursoB = await createTestCurso(centroB.id)
    aula = await createTestAula(centro.id, curso.id, 'Aula Autoriz')
    const aulaB = await createTestAula(centroB.id, cursoB.id, 'Aula Autoriz B')
    nino = await createTestNino(centro.id, 'Autoriz Nino')
    ninoB = await createTestNino(centroB.id, 'Autoriz Nino B')
    await matricular(nino.id, aula.id, curso.id)
    await matricular(ninoB.id, aulaB.id, cursoB.id)

    admin = await createTestUser({ nombre: 'Admin Au' })
    profe = await createTestUser({ nombre: 'Profe Au' })
    tutor = await createTestUser({ nombre: 'Tutor Au' })
    tutorB = await createTestUser({ nombre: 'Tutor Au B' })

    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(profe.id, centro.id, 'profe')
    await asignarRol(tutor.id, centro.id, 'tutor_legal')
    await asignarRol(tutorB.id, centroB.id, 'tutor_legal')
    await asignarProfeAula(profe.id, aula.id)
    await crearVinculo(nino.id, tutor.id, 'tutor_legal_principal', {
      puede_recibir_mensajes: true,
      puede_firmar_autorizaciones: true,
    })
    await crearVinculo(ninoB.id, tutorB.id, 'tutor_legal_principal', {
      puede_recibir_mensajes: true,
      puede_firmar_autorizaciones: true,
    })

    // Evento ámbito aula (para autorizaciones tipo 'salida').
    const { data: ev, error: evErr } = await serviceClient
      .from('eventos')
      .insert({
        ambito: 'aula',
        centro_id: centro.id,
        aula_id: aula.id,
        tipo: 'excursion',
        titulo: 'Excursión Autoriz',
        fecha: '2026-10-15',
        creado_por: admin.id,
      })
      .select('id')
      .single()
    if (evErr || !ev) throw new Error(`crear evento salida falló: ${evErr?.message}`)
    eventoSalida = ev.id
    eventosCreados.push(ev.id)
  })

  afterAll(async () => {
    for (const id of firmasCreadas)
      await serviceClient.from('firmas_autorizacion').delete().eq('id', id)
    for (const id of autorizacionesCreadas)
      await serviceClient.from('autorizaciones').delete().eq('id', id)
    for (const id of eventosCreados) await serviceClient.from('eventos').delete().eq('id', id)
    await deleteTestCentro(centro.id)
    await deleteTestCentro(centroB.id)
    for (const u of [admin, profe, tutor, tutorB]) await deleteTestUser(u.id)
  })

  // --- helpers de creación (service role, bypass RLS) -----------------------

  async function crearAutorizacion(opts: {
    tipo: TipoAutorizacion
    nino_id?: string
    evento_id?: string
    estado?: 'borrador' | 'publicada' | 'anulada'
    texto_definitivo?: boolean
    vigencia_desde?: string | null
    vigencia_hasta?: string | null
    firmantes_requeridos?: Database['public']['Enums']['politica_firmantes']
  }): Promise<string> {
    const esPublicada = opts.estado === 'publicada' || opts.estado === undefined
    const payload: AutorizacionInsert = {
      centro_id: centro.id,
      tipo: opts.tipo,
      titulo: 'Autorización Test',
      texto: esPublicada ? TEXTO_REAL : 'PENDIENTE',
      texto_version: esPublicada ? 'v1' : 'v0-pendiente',
      texto_definitivo: opts.texto_definitivo ?? esPublicada,
      estado: opts.estado ?? 'publicada',
      firmantes_requeridos: opts.firmantes_requeridos ?? 'uno_principal',
      vigencia_desde: opts.vigencia_desde ?? null,
      vigencia_hasta: opts.vigencia_hasta ?? null,
      creado_por: admin.id,
      ...(opts.evento_id ? { evento_id: opts.evento_id } : { nino_id: opts.nino_id }),
    }
    const { data, error } = await serviceClient
      .from('autorizaciones')
      .insert(payload)
      .select('id')
      .single()
    if (error || !data) throw new Error(`crearAutorizacion falló: ${error?.message}`)
    autorizacionesCreadas.push(data.id)
    return data.id
  }

  async function firmarComo(
    user: TestUser,
    opts: {
      autorizacion_id: string
      nino_id: string
      decision?: Database['public']['Enums']['firma_decision']
      conImagen?: boolean
    }
  ): Promise<{ id?: string; error: unknown }> {
    const c = await clientFor(user)
    const decision = opts.decision ?? 'firmado'
    const payload: FirmaInsert = {
      autorizacion_id: opts.autorizacion_id,
      nino_id: opts.nino_id,
      firmante_id: user.id,
      rol_firmante: 'tutor_legal_principal',
      decision,
      texto_hash: sha256(TEXTO_REAL),
      texto_version: 'v1',
      nombre_tecleado: 'Firmante Test',
      firma_imagen: (opts.conImagen ?? decision === 'firmado') ? SVG_TRAZO : null,
    }
    const { data, error } = await c
      .from('firmas_autorizacion')
      .insert(payload)
      .select('id')
      .maybeSingle()
    if (data?.id) firmasCreadas.push(data.id)
    return { id: data?.id, error }
  }

  // --- autorizaciones: INSERT por rol + MVCC --------------------------------

  it('admin crea autorización por niño y de salida (.insert().select() — MVCC)', async () => {
    const c = await clientFor(admin)
    const med = await c
      .from('autorizaciones')
      .insert({
        centro_id: centro.id,
        tipo: 'medicacion',
        nino_id: nino.id,
        titulo: 'Medicación',
        texto: TEXTO_REAL,
        texto_version: 'v1',
        texto_definitivo: true,
        estado: 'publicada',
        creado_por: admin.id,
      })
      .select('id')
      .maybeSingle()
    expect(med.error).toBeNull()
    expect(med.data?.id).toBeTruthy()
    if (med.data?.id) autorizacionesCreadas.push(med.data.id)

    const sal = await c
      .from('autorizaciones')
      .insert({
        centro_id: centro.id,
        tipo: 'salida',
        evento_id: eventoSalida,
        titulo: 'Salida',
        texto: TEXTO_REAL,
        texto_version: 'v1',
        texto_definitivo: true,
        estado: 'publicada',
        creado_por: admin.id,
      })
      .select('id')
      .maybeSingle()
    expect(sal.error).toBeNull()
    expect(sal.data?.id).toBeTruthy()
    if (sal.data?.id) autorizacionesCreadas.push(sal.data.id)
  })

  it('profe crea solo salida de un evento de su aula; no medicación', async () => {
    const c = await clientFor(profe)
    const sal = await c
      .from('autorizaciones')
      .insert({
        centro_id: centro.id,
        tipo: 'salida',
        evento_id: eventoSalida,
        titulo: 'Salida profe',
        texto: TEXTO_REAL,
        texto_version: 'v1',
        texto_definitivo: true,
        estado: 'publicada',
        creado_por: profe.id,
      })
      .select('id')
      .maybeSingle()
    expect(sal.data?.id).toBeTruthy()
    if (sal.data?.id) autorizacionesCreadas.push(sal.data.id)

    const med = await c
      .from('autorizaciones')
      .insert({
        centro_id: centro.id,
        tipo: 'medicacion',
        nino_id: nino.id,
        titulo: 'Medicación profe',
        texto: TEXTO_REAL,
        texto_version: 'v1',
        texto_definitivo: true,
        estado: 'publicada',
        creado_por: profe.id,
      })
      .select('id')
      .maybeSingle()
    expect(med.data?.id).toBeFalsy()
  })

  it('tutor no puede crear autorizaciones', async () => {
    const c = await clientFor(tutor)
    const r = await c
      .from('autorizaciones')
      .insert({
        centro_id: centro.id,
        tipo: 'medicacion',
        nino_id: nino.id,
        titulo: 'Tutor intenta',
        texto: TEXTO_REAL,
        texto_version: 'v1',
        texto_definitivo: true,
        estado: 'publicada',
        creado_por: tutor.id,
      })
      .select('id')
      .maybeSingle()
    expect(r.data?.id).toBeFalsy()
  })

  // --- autorizaciones: SELECT por audiencia + aislamiento por centro --------

  it('tutor ve la autorización de su niño; un tutor de otro centro no', async () => {
    const autId = await crearAutorizacion({ tipo: 'recogida', nino_id: nino.id })

    const cTutor = await clientFor(tutor)
    const { data: visto } = await cTutor.from('autorizaciones').select('id').eq('id', autId)
    expect(visto?.length).toBe(1)

    const cOtro = await clientFor(tutorB)
    const { data: noVisto } = await cOtro.from('autorizaciones').select('id').eq('id', autId)
    expect(noVisto?.length ?? 0).toBe(0)
  })

  it('DELETE de autorizaciones está denegado a todos (incl. admin)', async () => {
    const autId = await crearAutorizacion({ tipo: 'medicacion', nino_id: nino.id })
    const cAdmin = await clientFor(admin)
    await cAdmin.from('autorizaciones').delete().eq('id', autId)
    const { data: sigue } = await serviceClient.from('autorizaciones').select('id').eq('id', autId)
    expect(sigue?.length).toBe(1)
  })

  // --- firmas: aislamiento del firmante + MVCC ------------------------------

  it('un tutor firma por su niño (.insert().select() — MVCC), no por un niño ajeno', async () => {
    const autId = await crearAutorizacion({ tipo: 'recogida', nino_id: nino.id })
    const ok = await firmarComo(tutor, { autorizacion_id: autId, nino_id: nino.id })
    expect(ok.error).toBeNull()
    expect(ok.id).toBeTruthy()

    // tutor de centro intenta firmar por el niño de otro centro → es_tutor_de=false.
    const autB = await crearAutorizacion({ tipo: 'recogida', nino_id: ninoB.id })
    const ajeno = await firmarComo(tutor, { autorizacion_id: autB, nino_id: ninoB.id })
    expect(ajeno.id).toBeFalsy()
  })

  it('un tutor no firma una autorización que no aplica a su niño', async () => {
    // autorización de ninoB; tutor pasa nino_id de su propio niño → no aplica.
    const autB = await crearAutorizacion({ tipo: 'medicacion', nino_id: ninoB.id })
    const r = await firmarComo(tutor, { autorizacion_id: autB, nino_id: nino.id })
    expect(r.id).toBeFalsy()
  })

  // --- firmas: placeholder no firmable (guard del hash) ---------------------

  it('una autorización en borrador / con texto PENDIENTE no es firmable (todos los tipos por niño)', async () => {
    const tiposPorNino: TipoAutorizacion[] = [
      'medicacion',
      'recogida',
      'reglas_regimen_interno',
      'autorizacion_imagenes',
    ]
    for (const tipo of tiposPorNino) {
      const borrador = await crearAutorizacion({
        tipo,
        nino_id: nino.id,
        estado: 'borrador',
        texto_definitivo: false,
      })
      const r = await firmarComo(tutor, { autorizacion_id: borrador, nino_id: nino.id })
      expect(r.id, `tipo=${tipo} no debería ser firmable en borrador`).toBeFalsy()
    }
  })

  // --- firmas: fuera de vigencia -------------------------------------------

  it('una autorización publicada pero fuera de vigencia no es firmable', async () => {
    const caducada = await crearAutorizacion({
      tipo: 'recogida',
      nino_id: nino.id,
      vigencia_desde: '2020-01-01',
      vigencia_hasta: '2020-12-31',
    })
    const r = await firmarComo(tutor, { autorizacion_id: caducada, nino_id: nino.id })
    expect(r.id).toBeFalsy()
  })

  // --- firmas: firma_imagen obligatoria al firmar (CHECK BD) ----------------

  it('firma con decision=firmado exige firma_imagen (CHECK); rechazado no la exige', async () => {
    const autId = await crearAutorizacion({ tipo: 'recogida', nino_id: nino.id })

    // CHECK a nivel BD: service role bypassa RLS pero NO los CHECK constraints.
    const sinImagen = await serviceClient
      .from('firmas_autorizacion')
      .insert({
        autorizacion_id: autId,
        nino_id: nino.id,
        firmante_id: tutor.id,
        rol_firmante: 'tutor_legal_principal',
        decision: 'firmado',
        texto_hash: sha256(TEXTO_REAL),
        texto_version: 'v1',
        nombre_tecleado: 'Sin Trazo',
        firma_imagen: null,
      })
      .select('id')
      .maybeSingle()
    expect(sinImagen.error).not.toBeNull()
    expect(sinImagen.data?.id).toBeFalsy()

    // Rechazo sin imagen: válido (no hay trazo que dibujar). Vía tutor (RLS).
    const rechazo = await firmarComo(tutor, {
      autorizacion_id: autId,
      nino_id: nino.id,
      decision: 'rechazado',
      conImagen: false,
    })
    expect(rechazo.error).toBeNull()
    expect(rechazo.id).toBeTruthy()
  })

  // --- firmas: inmutabilidad (append-only) ----------------------------------

  it('una firma es inmutable: UPDATE y DELETE están denegados', async () => {
    const autId = await crearAutorizacion({ tipo: 'recogida', nino_id: nino.id })
    const firma = await firmarComo(tutor, { autorizacion_id: autId, nino_id: nino.id })
    expect(firma.id).toBeTruthy()
    const firmaId = firma.id!

    // UPDATE por el propio firmante → 0 filas (sin policy UPDATE → USING deniega).
    const cTutor = await clientFor(tutor)
    const upd = await cTutor
      .from('firmas_autorizacion')
      .update({ comentario: 'editado' })
      .eq('id', firmaId)
      .select('id')
      .maybeSingle()
    expect(upd.data?.id).toBeFalsy()

    // UPDATE por admin → también denegado.
    const cAdmin = await clientFor(admin)
    await cAdmin.from('firmas_autorizacion').update({ comentario: 'admin edita' }).eq('id', firmaId)

    // DELETE por admin → denegado, la fila sigue.
    await cAdmin.from('firmas_autorizacion').delete().eq('id', firmaId)
    const { data: sigue } = await serviceClient
      .from('firmas_autorizacion')
      .select('id, comentario')
      .eq('id', firmaId)
      .maybeSingle()
    expect(sigue?.id).toBe(firmaId)
    expect(sigue?.comentario ?? null).toBeNull()
  })

  // --- firmas: SELECT (firmante / tutor / aislamiento) ----------------------

  it('un tutor ve sus firmas; un tutor de otro centro no las ve', async () => {
    const autId = await crearAutorizacion({ tipo: 'recogida', nino_id: nino.id })
    const firma = await firmarComo(tutor, { autorizacion_id: autId, nino_id: nino.id })
    expect(firma.id).toBeTruthy()

    const cTutor = await clientFor(tutor)
    const { data: visto } = await cTutor
      .from('firmas_autorizacion')
      .select('id')
      .eq('id', firma.id!)
    expect(visto?.length).toBe(1)

    const cOtro = await clientFor(tutorB)
    const { data: noVisto } = await cOtro
      .from('firmas_autorizacion')
      .select('id')
      .eq('id', firma.id!)
    expect(noVisto?.length ?? 0).toBe(0)
  })
})
