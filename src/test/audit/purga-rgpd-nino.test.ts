import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

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
  serviceClient,
  type TestUser,
} from '../rls/setup'

/**
 * Purga RGPD del niño: la tabla real Y su copia en audit_log.
 *
 * - `purgar_sujeto_db` (rama del niño) no borraba de `ninos` la dirección, el libro de familia,
 *   el idioma ni el estado civil, y su redacción de audit_log no conocía esas claves ni las
 *   observaciones pedagógicas, el motivo de baja, la firma o el invitado externo de una cita.
 * - `purgar_esqueleto_huerfano_nino` borra el niño y lo que cuelga de él, pero no redactaba
 *   nada del niño en audit_log: el DELETE deja la fila entera en `valores_antes`.
 *
 * Cada test siembra un niño con marcadores únicos en todas sus columnas personales, ejecuta
 * la purga y vuelca las filas de audit_log que conservan algo.
 */
const APPLIED = process.env.PURGA_RGPD_NINO_APPLIED === '1'

const BORRADO = '[borrado]'

// Columnas personales por tabla: tras la purga, en audit_log solo pueden valer NULL o
// '[borrado]'. Salen de las columnas reales de cada tabla (information_schema, 2026-10-11).
const CLAVES: Record<string, readonly string[]> = {
  ninos: [
    'nombre',
    'apellidos',
    'fecha_nacimiento',
    'sexo',
    'nacionalidad',
    'foto_url',
    'notas_admin',
    'idioma_principal',
    'direccion_calle',
    'direccion_numero',
    'direccion_cp',
    'direccion_ciudad',
    'libro_familia_path',
    'estado_civil_familia',
  ],
  info_medica_emergencia: [
    'alergias_graves',
    'notas_emergencia',
    'medicacion_habitual',
    'alergias_leves',
    'medico_familia',
    'telefono_emergencia',
  ],
  datos_pedagogicos_nino: [
    'lactancia_observaciones',
    'control_esfinteres_observaciones',
    'siesta_horario_habitual',
    'siesta_observaciones',
    'alimentacion_observaciones',
    'idiomas_casa',
  ],
  matriculas: ['motivo_baja'],
  vinculos_familiares: ['descripcion_parentesco'],
  firmas_autorizacion: [
    'nombre_tecleado',
    'firma_imagen',
    'comentario',
    'ip_address',
    'user_agent',
    'datos',
  ],
  autorizaciones: ['titulo', 'texto', 'datos'],
  cita_invitados: ['nombre_externo', 'comentario'],
  invitaciones: ['email', 'nombre_completo'],
}

type FilaAudit = {
  tabla: string
  accion: string
  registro_id: string | null
  valores_antes: Record<string, unknown> | null
  valores_despues: Record<string, unknown> | null
}

type Fuga = { tabla: string; accion: string; lado: string; campo: string; valor: string }

interface Sembrado {
  ninoId: string
  invitadoCitaId: string
  marcas: string[]
}

describe.skipIf(!APPLIED)('Purga RGPD del niño — tabla y audit_log', () => {
  let centro: { id: string }
  let curso: { id: string }
  let aula: { id: string }
  let admin: TestUser
  let tutor: TestUser
  const solicitudes: string[] = []

  beforeAll(async () => {
    centro = await createTestCentro('Centro Purga Nino')
    curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id)
    admin = await createTestUser({ nombre: 'Admin Purga Nino' })
    await asignarRol(admin.id, centro.id, 'admin')
    tutor = await createTestUser({ nombre: 'Tutor Purga Nino' })
    await asignarRol(tutor.id, centro.id, 'tutor_legal')
  }, 120_000)

  afterAll(async () => {
    if (solicitudes.length) {
      await serviceClient.from('olvido_solicitudes').delete().in('id', solicitudes)
    }
    await deleteTestCentro(centro.id)
    for (const u of [admin, tutor]) await deleteTestUser(u.id)
  }, 120_000)

  /** Un niño con TODAS sus columnas personales marcadas y lo que cuelga de él. */
  async function sembrar(opts: { esqueleto: boolean }): Promise<Sembrado> {
    const s = randomUUID().slice(0, 8)
    const m = (campo: string) => `MK-${campo}-${s}`
    const marcas: string[] = []
    const marca = (campo: string) => {
      const v = m(campo)
      marcas.push(v)
      return v
    }

    const nino = await createTestNino(centro.id, marca('nombre'))
    const { error: nErr } = await serviceClient
      .from('ninos')
      .update({
        apellidos: marca('apellidos'),
        nacionalidad: marca('nacionalidad'),
        notas_admin: marca('notas'),
        idioma_principal: 'va',
        direccion_calle: marca('calle'),
        direccion_numero: marca('num'),
        direccion_cp: m('cp').slice(0, 12),
        direccion_ciudad: marca('ciudad'),
        libro_familia_path: `${centro.id}/${nino.id}/${marca('libro')}.pdf`,
        estado_civil_familia: 'casados',
      })
      .eq('id', nino.id)
    expect(nErr).toBeNull()

    // Ficha médica por el setter cifrado (como la app): alergias_graves y notas_emergencia
    // quedan en bytea; su texto cifrado también es un dato a borrar.
    const cAdmin = await clientFor(admin)
    const { error: imErr } = await cAdmin.rpc('set_info_medica_emergencia_cifrada', {
      p_nino_id: nino.id,
      p_alergias_graves: marca('alergias-graves'),
      p_notas_emergencia: marca('notas-emergencia'),
      p_medicacion_habitual: marca('medicacion'),
      p_alergias_leves: marca('alergias-leves'),
      p_medico_familia: marca('medico'),
      p_telefono_emergencia: marca('telefono'),
    })
    expect(imErr).toBeNull()
    const { data: im } = await serviceClient
      .from('info_medica_emergencia')
      .select('alergias_graves, notas_emergencia')
      .eq('nino_id', nino.id)
      .single()
    marcas.push(String(im?.alergias_graves), String(im?.notas_emergencia))

    const { error: dpErr } = await serviceClient.from('datos_pedagogicos_nino').insert({
      nino_id: nino.id,
      lactancia_estado: 'materna',
      lactancia_observaciones: marca('lactancia'),
      control_esfinteres: 'panal_completo',
      control_esfinteres_observaciones: marca('esfinteres'),
      siesta_horario_habitual: marca('siesta-horario'),
      siesta_observaciones: marca('siesta'),
      tipo_alimentacion: 'otra',
      alimentacion_observaciones: marca('alimentacion'),
      idiomas_casa: ['va'],
      tiene_hermanos_en_centro: false,
    })
    expect(dpErr).toBeNull()

    const { error: mErr } = await serviceClient.from('matriculas').insert({
      nino_id: nino.id,
      aula_id: aula.id,
      curso_academico_id: curso.id,
      estado: 'pendiente',
      motivo_baja: marca('motivo-baja'),
    })
    expect(mErr).toBeNull()

    // Vínculo con parentesco. En el esqueleto, ya borrado (un huérfano no tiene vínculos vivos).
    const vinculoId = await crearVinculo(nino.id, tutor.id, 'tutor_legal_principal')
    const { error: vErr } = await serviceClient
      .from('vinculos_familiares')
      .update({
        descripcion_parentesco: marca('parentesco'),
        ...(opts.esqueleto
          ? { deleted_at: new Date().toISOString(), deleted_reason: 'revocacion_familia' as const }
          : {}),
      })
      .eq('id', vinculoId)
    expect(vErr).toBeNull()

    // Autorización del niño y su firma (trazo, comentario, nombre tecleado, datos con terceros).
    const texto = `Texto ${marca('texto-autorizacion')}`
    const { data: aut, error: aErr } = await serviceClient
      .from('autorizaciones')
      .insert({
        centro_id: centro.id,
        tipo: 'medicacion',
        titulo: marca('titulo-autorizacion'),
        texto,
        texto_version: 'v1',
        texto_definitivo: true,
        estado: 'publicada',
        firmantes_requeridos: 'uno_principal',
        creado_por: admin.id,
        nino_id: nino.id,
      })
      .select('id')
      .single()
    expect(aErr).toBeNull()
    const { error: fErr } = await serviceClient.from('firmas_autorizacion').insert({
      autorizacion_id: aut!.id,
      nino_id: nino.id,
      firmante_id: tutor.id,
      rol_firmante: 'tutor_legal_principal',
      decision: 'firmado',
      texto_hash: 'a'.repeat(64),
      texto_version: 'v1',
      nombre_tecleado: marca('nombre-tecleado'),
      firma_imagen: `<svg>${marca('firma-imagen')}</svg>`,
      comentario: marca('comentario-firma'),
      user_agent: marca('user-agent'),
      datos: { personas: [{ nombre: marca('persona-recogida'), dni: marca('dni') }] },
    })
    expect(fErr).toBeNull()

    // Cita del niño con un invitado externo.
    const { data: cita, error: cErr } = await serviceClient
      .from('citas')
      .insert({
        centro_id: centro.id,
        tipo: 'reunion_familia',
        organizador_id: admin.id,
        nino_id: nino.id,
        titulo: 'Cita Purga Nino',
        fecha: '2026-09-10',
        hora_inicio: '17:00',
      })
      .select('id')
      .single()
    expect(cErr).toBeNull()
    const { data: inv, error: ciErr } = await serviceClient
      .from('cita_invitados')
      .insert({
        cita_id: cita!.id,
        centro_id: centro.id,
        nombre_externo: marca('invitado-externo'),
        comentario: marca('comentario-cita'),
      })
      .select('id')
      .single()
    expect(ciErr).toBeNull()

    if (opts.esqueleto) {
      const { error: iErr } = await serviceClient.from('invitaciones').insert({
        email: `${m('email')}@nido.test`.toLowerCase(),
        nombre_completo: marca('invitado'),
        rol_objetivo: 'tutor_legal',
        centro_id: centro.id,
        nino_id: nino.id,
        tipo_vinculo: 'tutor_legal_principal',
        expires_at: new Date(Date.now() - 40 * 864e5).toISOString(),
      })
      expect(iErr).toBeNull()
      marcas.push(`${m('email')}@nido.test`.toLowerCase())
    }

    return { ninoId: nino.id, invitadoCitaId: inv!.id, marcas }
  }

  /** Las filas de audit_log del niño (las que lo nombran) y la del invitado de su cita. */
  async function filasDe(sem: Sembrado): Promise<FilaAudit[]> {
    const id = sem.ninoId
    const { data: delNino, error } = await serviceClient
      .from('audit_log')
      .select('tabla, accion, registro_id, valores_antes, valores_despues')
      .or(
        `registro_id.eq.${id},valores_antes->>nino_id.eq.${id},valores_despues->>nino_id.eq.${id}`
      )
    expect(error).toBeNull()
    const { data: invitado } = await serviceClient
      .from('audit_log')
      .select('tabla, accion, registro_id, valores_antes, valores_despues')
      .eq('tabla', 'cita_invitados')
      .eq('registro_id', sem.invitadoCitaId)
    return [...(delNino ?? []), ...(invitado ?? [])] as FilaAudit[]
  }

  function fugasEn(filas: FilaAudit[], marcas: string[]): Fuga[] {
    const fugas: Fuga[] = []
    for (const f of filas) {
      for (const [lado, valores] of [
        ['antes', f.valores_antes],
        ['despues', f.valores_despues],
      ] as const) {
        if (!valores) continue
        for (const campo of CLAVES[f.tabla] ?? []) {
          const v = valores[campo]
          if (v !== undefined && v !== null && v !== BORRADO) {
            fugas.push({ tabla: f.tabla, accion: f.accion, lado, campo, valor: corto(v) })
          }
        }
        for (const [campo, v] of Object.entries(valores)) {
          const t = JSON.stringify(v)
          if (marcas.some((mk) => t.includes(mk)) && !(CLAVES[f.tabla] ?? []).includes(campo)) {
            fugas.push({ tabla: f.tabla, accion: f.accion, lado, campo, valor: corto(v) })
          }
        }
      }
    }
    return fugas
  }

  function volcar(nombre: string, filas: FilaAudit[], fugas: Fuga[]) {
    const porTabla: Record<string, number> = {}
    for (const f of filas)
      porTabla[`${f.tabla} ${f.accion}`] = (porTabla[`${f.tabla} ${f.accion}`] ?? 0) + 1
    console.warn(`${nombre}: ${filas.length} filas de audit_log`, JSON.stringify(porTabla))
    if (fugas.length > 0) console.warn(`FUGA ${nombre} (${fugas.length}):`, JSON.stringify(fugas))
    else console.warn(`CIERRE ${nombre}: ninguna clave personal sin redactar`)
  }

  it('purgar_sujeto_db (niño): borra la dirección y el resto de la tabla, y redacta audit_log', async () => {
    const sem = await sembrar({ esqueleto: false })

    const { data: solicitud, error: sErr } = await serviceClient.rpc('solicitar_olvido_nino', {
      p_nino_id: sem.ninoId,
      p_inmediato: true,
    })
    expect(sErr).toBeNull()
    solicitudes.push(solicitud as string)
    const { error: pErr } = await serviceClient.rpc('purgar_sujeto_db', {
      p_solicitud_id: solicitud as string,
    })
    expect(pErr).toBeNull()

    const filas = await filasDe(sem)
    const fugas = fugasEn(filas, sem.marcas)
    volcar('purgar_sujeto_db', filas, fugas)

    // La tabla real.
    const { data: n } = await serviceClient
      .from('ninos')
      .select(
        'idioma_principal, direccion_calle, direccion_numero, direccion_cp, direccion_ciudad, libro_familia_path, estado_civil_familia'
      )
      .eq('id', sem.ninoId)
      .single()
    expect(n).toEqual({
      idioma_principal: 'es',
      direccion_calle: null,
      direccion_numero: null,
      direccion_cp: null,
      direccion_ciudad: null,
      libro_familia_path: null,
      estado_civil_familia: null,
    })
    const { data: dp } = await serviceClient
      .from('datos_pedagogicos_nino')
      .select('idiomas_casa')
      .eq('nino_id', sem.ninoId)
      .single()
    expect(dp?.idiomas_casa).toEqual(['zz'])
    const { data: mat } = await serviceClient
      .from('matriculas')
      .select('motivo_baja')
      .eq('nino_id', sem.ninoId)
      .single()
    expect(mat?.motivo_baja).toBeNull()
    const { data: im } = await serviceClient
      .from('info_medica_emergencia')
      .select('alergias_graves, notas_emergencia, medicacion_habitual, telefono_emergencia')
      .eq('nino_id', sem.ninoId)
      .single()
    expect(im).toEqual({
      alergias_graves: null,
      notas_emergencia: null,
      medicacion_habitual: null,
      telefono_emergencia: null,
    })

    // Y su copia en audit_log.
    expect(filas.length).toBeGreaterThan(0)
    expect(fugas).toEqual([])
  })

  it('purgar_esqueleto_huerfano_nino: no deja en audit_log nada del niño que borra', async () => {
    const sem = await sembrar({ esqueleto: true })

    const { error } = await serviceClient.rpc('purgar_esqueleto_huerfano_nino', {
      p_nino_id: sem.ninoId,
      p_cutoff: new Date(Date.now() - 30 * 864e5).toISOString(),
    })
    expect(error).toBeNull()
    const { data: sigue } = await serviceClient
      .from('ninos')
      .select('id')
      .eq('id', sem.ninoId)
      .maybeSingle()
    expect(sigue).toBeNull()

    const filas = await filasDe(sem)
    const fugas = fugasEn(filas, sem.marcas)
    volcar('purgar_esqueleto_huerfano_nino', filas, fugas)

    expect(filas.some((f) => f.tabla === 'ninos' && f.accion === 'DELETE')).toBe(true)
    expect(fugas).toEqual([])
  })
})

function corto(v: unknown): string {
  const t = typeof v === 'string' ? v : JSON.stringify(v)
  return t.length > 60 ? `${t.slice(0, 57)}...` : t
}
