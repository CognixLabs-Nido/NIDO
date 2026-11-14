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
import { expectColumnasDecididas } from '../rls/columnas-vivas'

import {
  NO_PERSONALES_INFO_MEDICA,
  PERSONALES_INFO_MEDICA,
  columnas,
  todasA,
} from './columnas-personales'

/**
 * Purga RGPD del niño: la tabla real Y su copia en audit_log.
 *
 * - `purgar_sujeto_db` (rama del niño) no borraba de `ninos` la dirección, el libro de familia,
 *   el idioma ni el estado civil, y su redacción de audit_log no conocía esas claves ni las
 *   observaciones pedagógicas, el motivo de baja, la firma o el invitado externo de una cita.
 *
 * Cada test siembra un niño con marcadores únicos en todas sus columnas personales, ejecuta
 * la purga y vuelca las filas de audit_log que conservan algo.
 */

const BORRADO = '[borrado]'

// Columnas personales por tabla: tras la purga, en audit_log solo pueden valer NULL o
// '[borrado]'. No es una foto de un día: el test «cada columna está decidida» las compara con las
// columnas vivas, junto con NO_PERSONALES, y una columna nueva lo pone rojo hasta decidirla.
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
    // Fase 5a (2026-11-07): los dos apellidos, y los campos nuevos de la ficha.
    'primer_apellido',
    'segundo_apellido',
    'lugar_nacimiento',
    'dni',
    'hermanos_total',
    'hermanos_lugar',
    'direccion_provincia',
    'observaciones_familia',
    'como_nos_conocio',
    'como_nos_conocio_otro',
    // Fase 7 (2026-11-13): la tarjeta sanitaria, el número y la ruta de la imagen.
    'sip',
    'sip_documento_path',
    // Fase 8a (2026-11-14): el día en que empezó a venir.
    'fecha_incorporacion',
  ],
  info_medica_emergencia: PERSONALES_INFO_MEDICA,
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

// Las demás columnas de cada tabla de CLAVES, con su porqué: lo que la purga conserva porque no
// identifica a nadie (ids, fechas técnicas, categóricos sin texto libre). Descrito como lo hace la
// purga hoy (`privado.purgar_nino`, `_claves_pii_nino`); cambiarlo es cambiar la purga, no esto.
const ID = 'identificador de la fila, sin dato de nadie'
const FECHA = 'fecha técnica de la fila'
const SEUDONIMO = 'id de otra fila: la purga lo conserva, seudónimo'
const NO_PERSONALES: Record<string, Readonly<Record<string, string>>> = {
  ninos: {
    id: ID,
    centro_id: SEUDONIMO,
    familia_id: SEUDONIMO,
    created_at: FECHA,
    updated_at: FECHA,
    deleted_at: 'la baja de la fila; la purga la pone',
    deleted_reason: 'motivo del borrado (enum); la purga pone purga_rgpd',
    purgado_en: 'el sello de la purga',
    puede_aparecer_en_fotos: 'flag derivado del consentimiento de imagen, sin texto',
    requiere_ambos_firmantes: 'flag de configuración de las firmas, sin texto',
  },
  info_medica_emergencia: NO_PERSONALES_INFO_MEDICA,
  datos_pedagogicos_nino: {
    id: ID,
    nino_id: SEUDONIMO,
    created_at: FECHA,
    updated_at: FECHA,
    deleted_at: 'la baja de la fila; la purga la pone',
    lactancia_estado: 'categórico (enum), sin texto libre; la purga lo conserva',
    control_esfinteres: 'categórico (enum), sin texto libre; la purga lo conserva',
    siesta_numero_diario: 'número de 0 a 5, sin texto libre; la purga lo conserva',
    tipo_alimentacion: 'categórico sin valores religiosos (20261125120000); lo que come va en otra',
    tiene_hermanos_en_centro: 'flag, sin texto; la purga lo conserva',
  },
  matriculas: {
    id: ID,
    nino_id: SEUDONIMO,
    aula_id: SEUDONIMO,
    curso_academico_id: SEUDONIMO,
    estado: 'estado de la matrícula (enum)',
    fecha_alta: 'fecha administrativa de la matrícula, no del niño',
    fecha_baja: 'fecha administrativa de la matrícula, no del niño',
    activada_at: 'sello técnico de la activación',
    created_at: FECHA,
    deleted_at: 'la baja de la fila',
  },
  vinculos_familiares: {
    id: ID,
    nino_id: SEUDONIMO,
    usuario_id: SEUDONIMO,
    tipo_vinculo: 'categórico (enum)',
    parentesco: 'categórico (enum); el texto libre va en descripcion_parentesco',
    permisos: 'flags de permisos (jsonb de booleanos)',
    created_at: FECHA,
    updated_at: FECHA,
    deleted_at: 'la baja de la fila',
    deleted_reason: 'motivo del borrado (enum)',
  },
  firmas_autorizacion: {
    id: ID,
    autorizacion_id: SEUDONIMO,
    nino_id: SEUDONIMO,
    firmante_id: SEUDONIMO,
    rol_firmante: 'categórico (snapshot del tipo de vínculo)',
    decision: 'categórico (firmado, rechazado, revocado)',
    metodo_firma: 'categórico (digital o presencial)',
    texto_hash: 'huella SHA-256 del texto firmado, no lo contiene',
    texto_version: 'etiqueta de la versión del texto',
    firmado_at: 'cuándo se firmó; prueba legal que se conserva',
    created_at: FECHA,
  },
  autorizaciones: {
    id: ID,
    centro_id: SEUDONIMO,
    nino_id: SEUDONIMO,
    aula_id: SEUDONIMO,
    evento_id: SEUDONIMO,
    plantilla_id: SEUDONIMO,
    creado_por: SEUDONIMO,
    archivada_por: SEUDONIMO,
    tipo: 'categórico (enum)',
    ambito: 'categórico (enum)',
    estado: 'categórico (enum)',
    es_plantilla: 'flag (boolean): documento de catálogo o instancia firmable',
    texto_definitivo: 'flag (boolean): el texto está cerrado',
    texto_version: 'etiqueta de la versión del texto',
    firmantes_requeridos: 'categórico (política de firmantes)',
    vigencia_desde: 'fecha de vigencia del documento, no de la persona',
    vigencia_hasta: 'fecha de vigencia del documento, no de la persona',
    archivada_at: FECHA,
    created_at: FECHA,
    updated_at: FECHA,
  },
  cita_invitados: {
    id: ID,
    cita_id: SEUDONIMO,
    centro_id: SEUDONIMO,
    usuario_id: SEUDONIMO,
    respondido_por: SEUDONIMO,
    estado: 'categórico (RSVP)',
    respondido_at: FECHA,
    created_at: FECHA,
    updated_at: FECHA,
  },
  invitaciones: {
    id: ID,
    centro_id: SEUDONIMO,
    nino_id: SEUDONIMO,
    aula_id: SEUDONIMO,
    invitado_por: SEUDONIMO,
    rol_objetivo: 'categórico (enum)',
    tipo_vinculo: 'categórico (enum)',
    tipo_personal_aula: 'categórico (enum)',
    token: 'secreto de un solo uso, no entra en audit_log (20261011130000)',
    expires_at: FECHA,
    accepted_at: FECHA,
    rejected_at: FECHA,
    created_at: FECHA,
  },
}

// Lo que deja la purga en cada columna personal de la ficha que no queda a NULL.
const NINO_TRAS_LA_PURGA: Record<string, unknown> = {
  nombre: BORRADO,
  primer_apellido: BORRADO,
  apellidos: BORRADO,
  fecha_nacimiento: '1900-01-01',
  // Ítem 9 (20261015120000): el centinela 'zz', no el 'es' inventado.
  idioma_principal: 'zz',
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

describe('Purga RGPD del niño — tabla y audit_log', () => {
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
  // Plantilla de medicación del centro (una activa por centro y tipo): la instancia del niño
  // es de forma B2, la que crea la app (la forma legacy sin plantilla ya no cabe en el CHECK).
  let plantillaMedicacion: string | null = null
  async function plantillaDeMedicacion(): Promise<string> {
    if (plantillaMedicacion) return plantillaMedicacion
    const { data, error } = await serviceClient
      .from('autorizaciones')
      .insert({
        centro_id: centro.id,
        tipo: 'medicacion',
        es_plantilla: true,
        titulo: 'Formato medicación',
        texto: 'Texto del formato',
        texto_version: 'v1',
        texto_definitivo: true,
        estado: 'publicada',
        creado_por: admin.id,
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`plantilla de medicación: ${error?.message}`)
    plantillaMedicacion = data.id
    return data.id
  }

  async function sembrar(): Promise<Sembrado> {
    const s = randomUUID().slice(0, 8)
    const m = (campo: string) => `MK-${campo}-${s}`
    const marcas: string[] = []
    const marca = (campo: string) => {
      const v = m(campo)
      marcas.push(v)
      return v
    }

    const nino = await createTestNino(centro.id, marca('nombre'))
    const marcaSip = `MKSIP${s}`.toUpperCase()
    marcas.push(marcaSip)
    const { error: nErr } = await serviceClient
      .from('ninos')
      .update({
        primer_apellido: marca('apellidos'),
        segundo_apellido: marca('segundo'),
        sexo: 'F',
        foto_url: `${centro.id}/${nino.id}/${marca('foto')}.jpg`,
        nacionalidad: marca('nacionalidad'),
        lugar_nacimiento: marca('lugar'),
        dni: '12345678Z', // el CHECK exige la letra buena: no cabe una marca, lo cubre CLAVES
        hermanos_total: 3,
        hermanos_lugar: 2,
        direccion_provincia: marca('prov'),
        observaciones_familia: marca('obs'),
        como_nos_conocio: 'otro',
        como_nos_conocio_otro: marca('como'),
        notas_admin: marca('notas'),
        idioma_principal: 'va',
        direccion_calle: marca('calle'),
        direccion_numero: marca('num'),
        direccion_cp: m('cp').slice(0, 12),
        direccion_ciudad: marca('ciudad'),
        libro_familia_path: `${centro.id}/${nino.id}/${marca('libro')}.pdf`,
        estado_civil_familia: 'casados',
        // Fase 7: el CHECK solo admite letras y cifras en mayúscula; la marca, sin guiones.
        sip: marcaSip,
        sip_documento_path: `${centro.id}/${nino.id}/${marca('sip')}.pdf`,
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

    // Vínculo con parentesco.
    const vinculoId = await crearVinculo(nino.id, tutor.id, 'tutor_legal_principal')
    const { error: vErr } = await serviceClient
      .from('vinculos_familiares')
      .update({ descripcion_parentesco: marca('parentesco') })
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
        plantilla_id: await plantillaDeMedicacion(),
        ambito: 'nino',
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

  it('cada columna de las tablas de la purga está decidida: personal (CLAVES) o no, con su porqué', async () => {
    // Premisa: las dos listas cubren las mismas tablas.
    expect(Object.keys(NO_PERSONALES).sort()).toEqual(Object.keys(CLAVES).sort())
    for (const [tabla, personales] of Object.entries(CLAVES)) {
      await expectColumnasDecididas(tabla, personales, NO_PERSONALES[tabla]!, personales[0]!)
    }
  })

  it('purgar_sujeto_db (niño): borra la dirección y el resto de la tabla, y redacta audit_log', async () => {
    const sem = await sembrar()

    const { data: solicitud, error: sErr } = await serviceClient.rpc('solicitar_olvido_nino', {
      p_nino_id: sem.ninoId,
      p_inmediato: true,
    })
    expect(sErr).toBeNull()
    solicitudes.push(solicitud as string)
    // Premisa: cada columna personal tiene valor antes de purgar. Si no, «NULL después» saldría
    // verde sin haber borrado nada.
    const { data: imAntes } = await serviceClient
      .from('info_medica_emergencia')
      .select(columnas(PERSONALES_INFO_MEDICA))
      .eq('nino_id', sem.ninoId)
      .single()
    expect(imAntes).not.toBeNull()
    for (const c of PERSONALES_INFO_MEDICA) {
      expect(
        (imAntes as Record<string, unknown> | null)?.[c],
        `info_medica.${c} antes`
      ).not.toBeNull()
    }
    const { data: ninoAntes } = await serviceClient
      .from('ninos')
      .select(columnas(CLAVES.ninos))
      .eq('id', sem.ninoId)
      .single()
    for (const c of CLAVES.ninos) {
      expect((ninoAntes as Record<string, unknown> | null)?.[c], `ninos.${c} antes`).not.toBeNull()
    }
    const { error: pErr } = await serviceClient.rpc('purgar_sujeto_db', {
      p_solicitud_id: solicitud as string,
    })
    expect(pErr).toBeNull()

    const filas = await filasDe(sem)
    const fugas = fugasEn(filas, sem.marcas)
    volcar('purgar_sujeto_db', filas, fugas)

    // La tabla real: cada columna personal de la ficha, desde CLAVES (no una lista aparte).
    const { data: n } = await serviceClient
      .from('ninos')
      .select(columnas(CLAVES.ninos))
      .eq('id', sem.ninoId)
      .single()
    expect(n).toEqual({ ...todasA(CLAVES.ninos, null), ...NINO_TRAS_LA_PURGA })
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
      .select(columnas(PERSONALES_INFO_MEDICA))
      .eq('nino_id', sem.ninoId)
      .single()
    expect(im).toEqual(todasA(PERSONALES_INFO_MEDICA, null))

    // Y su copia en audit_log.
    expect(filas.length).toBeGreaterThan(0)
    expect(fugas).toEqual([])
  })

  it('retroactiva: redacta la auditoría de un niño que ya no existe y no toca la de uno vivo', async () => {
    const borrado = await sembrar()
    const vivo = await sembrar()

    // Un borrado anterior a esta migración: DELETE a mano, sin purga (FK-safe, como los fixtures).
    for (const tabla of [
      'info_medica_emergencia',
      'datos_pedagogicos_nino',
      'matriculas',
    ] as const) {
      const { error } = await serviceClient.from(tabla).delete().eq('nino_id', borrado.ninoId)
      expect(error).toBeNull()
    }
    const { error: dErr } = await serviceClient.from('ninos').delete().eq('id', borrado.ninoId)
    expect(dErr).toBeNull()
    expect(fugasEn(await filasDe(borrado), borrado.marcas).length).toBeGreaterThan(0)

    const { data: n, error } = await serviceClient.rpc('_redactar_auditoria_ninos_borrados')
    expect(error).toBeNull()
    expect(n).toBeGreaterThan(0)

    const filas = await filasDe(borrado)
    const fugas = fugasEn(filas, borrado.marcas)
    volcar('retroactiva', filas, fugas)
    expect(fugas).toEqual([])

    // El vivo conserva su auditoría tal cual.
    expect(fugasEn(await filasDe(vivo), vivo.marcas).length).toBeGreaterThan(0)
  })
})

function corto(v: unknown): string {
  const t = typeof v === 'string' ? v : JSON.stringify(v)
  return t.length > 60 ? `${t.slice(0, 57)}...` : t
}
