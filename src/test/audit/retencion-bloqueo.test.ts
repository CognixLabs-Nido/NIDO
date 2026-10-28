import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { recolectarNino, recolectarUsuario } from '@/features/export/lib/recolectar'

import {
  asignarProfeAula,
  asignarRol,
  clientFor,
  crearFamiliaTutor,
  crearVinculo,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestNino,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestUser,
} from '../rls/setup'

/**
 * El bloqueo de lo que se conserva por obligación legal (F11-B, punto 6, PR-7; 20261205120000).
 *
 * Dos hermanos, Íñigo y Bea, en una familia con un recibo ya enviado al banco hace meses (cerrado,
 * sin dinero vivo). Al purgar a Íñigo, lo suyo (su firma, el consentimiento que dio su madre, el
 * registro de quién leyó su ficha) se conserva y nadie lo ve en la app: ni Dirección, ni la profe.
 * El recibo de la familia sigue a la vista, entero, con «[borrado]» donde ponía su nombre. Al
 * purgar a Bea la familia se queda sin niños y el recibo también se bloquea. La exportación lo
 * deja fuera y dice que existe.
 *
 * Y el olvido del tutor: el segundo tutor está en la familia sin vínculo con los niños, que
 * siguen matriculados; su olvido no se confirma ni se purga.
 *
 * El curso termina en 2099, para que «matriculado» no dependa del día en que corra el test.
 */

const FICHA = {
  p_alergias_graves: 'Frutos secos',
  p_notas_emergencia: 'Llamar a la madre',
  p_medicacion_habitual: 'Ninguna',
  p_alergias_leves: '',
  p_medico_familia: 'Dra. Demo',
  p_telefono_emergencia: '600000000',
}

describe('Retención: el bloqueo de lo que se conserva', () => {
  let centro: { id: string }
  let admin: TestUser
  let profe: TestUser
  let madre: TestUser
  let segundo: TestUser
  let familia: string
  let inigo: string
  let bea: string
  let recibo: string
  let lineaInigo: string
  let lineaBea: string
  let firma: string
  let consentimiento: string
  const solicitudes: string[] = []

  async function purgar(nino: string) {
    const { data: solicitud, error: sErr } = await serviceClient.rpc('solicitar_olvido_nino', {
      p_nino_id: nino,
      p_inmediato: true,
    })
    expect(sErr).toBeNull()
    solicitudes.push(solicitud as string)
    const { error } = await serviceClient.rpc('purgar_sujeto_db', {
      p_solicitud_id: solicitud as string,
    })
    expect(error).toBeNull()
  }

  async function ve(user: TestUser, tabla: 'firmas_autorizacion' | 'consentimientos', id: string) {
    const c = await clientFor(user)
    const { data, error } = await c.from(tabla).select('id').eq('id', id)
    expect(error).toBeNull()
    return (data ?? []).length === 1
  }

  async function lineasQueVe(user: TestUser): Promise<string[]> {
    const c = await clientFor(user)
    const { data, error } = await c
      .from('lineas_recibo')
      .select('descripcion')
      .eq('recibo_id', recibo)
      .order('descripcion')
    expect(error).toBeNull()
    return (data ?? []).map((l) => l.descripcion)
  }

  async function veRecibo(user: TestUser): Promise<boolean> {
    const c = await clientFor(user)
    const { data, error } = await c.from('recibos').select('id').eq('id', recibo)
    expect(error).toBeNull()
    return (data ?? []).length === 1
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Retencion Bloqueo')
    admin = await createTestUser({ nombre: 'Admin Retencion Bloqueo' })
    profe = await createTestUser({ nombre: 'Profe Retencion Bloqueo' })
    madre = await createTestUser({ nombre: 'Madre Retencion Bloqueo' })
    segundo = await createTestUser({ nombre: 'Segundo Retencion Bloqueo' })
    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(profe.id, centro.id, 'profe')
    await asignarRol(madre.id, centro.id, 'tutor_legal')
    await asignarRol(segundo.id, centro.id, 'tutor_legal')

    const curso = (await createTestCurso(centro.id)).id
    const r = await serviceClient
      .from('cursos_academicos')
      .update({ fecha_fin: '2099-07-31' })
      .eq('id', curso)
    expect(r.error).toBeNull()
    const aula = (await createTestAula(centro.id, curso)).id
    await asignarProfeAula(profe.id, aula, curso)

    const a = await createTestNino(centro.id, 'Íñigo')
    inigo = a.id
    familia = a.familia_id
    bea = (await createTestNino(centro.id, 'Bea')).id
    const h = await serviceClient.from('ninos').update({ familia_id: familia }).eq('id', bea)
    expect(h.error).toBeNull()
    for (const n of [inigo, bea]) {
      await matricular(n, aula, curso)
      await crearVinculo(n, madre.id, 'tutor_legal_principal')
    }
    await crearFamiliaTutor(familia, madre.id, 'titular')
    // El segundo tutor: en la familia, sin vínculo con los niños.
    await crearFamiliaTutor(familia, segundo.id, 'segundo_tutor')

    // Su autorización, firmada por la madre, y el consentimiento de imagen que dio.
    const { data: plantilla, error: pErr } = await serviceClient
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
    expect(pErr).toBeNull()
    const { data: aut, error: aErr } = await serviceClient
      .from('autorizaciones')
      .insert({
        centro_id: centro.id,
        tipo: 'medicacion',
        titulo: 'Medicación Íñigo',
        texto: 'Texto',
        texto_version: 'v1',
        texto_definitivo: true,
        estado: 'publicada',
        firmantes_requeridos: 'uno_principal',
        creado_por: admin.id,
        nino_id: inigo,
        plantilla_id: plantilla!.id,
        ambito: 'nino',
      })
      .select('id')
      .single()
    expect(aErr).toBeNull()
    const { data: f, error: fErr } = await serviceClient
      .from('firmas_autorizacion')
      .insert({
        autorizacion_id: aut!.id,
        nino_id: inigo,
        firmante_id: madre.id,
        rol_firmante: 'tutor_legal_principal',
        decision: 'firmado',
        texto_hash: 'a'.repeat(64),
        texto_version: 'v1',
        nombre_tecleado: 'Madre Retencion Bloqueo',
        firma_imagen: '<svg></svg>',
      })
      .select('id')
      .single()
    expect(fErr).toBeNull()
    firma = f!.id
    const { data: co, error: coErr } = await serviceClient
      .from('consentimientos')
      .insert({ usuario_id: madre.id, nino_id: inigo, tipo: 'imagen', version: 'v1' })
      .select('id')
      .single()
    expect(coErr).toBeNull()
    consentimiento = co!.id

    // Su ficha, y una lectura de Dirección.
    const c = await clientFor(admin)
    const { error: mErr } = await c.rpc('set_info_medica_emergencia_cifrada', {
      p_nino_id: inigo,
      ...FICHA,
    })
    expect(mErr).toBeNull()
    const { error: lErr } = await c.rpc('get_info_medica_emergencia', {
      p_nino_id: inigo,
      p_origen: 'ficha',
    })
    expect(lErr).toBeNull()

    // El recibo de enero, con las líneas viejas que llevaban el nombre, enviado al banco en enero:
    // cerrado y sin dinero vivo.
    const { data: rc, error: rErr } = await serviceClient
      .from('recibos')
      .insert({
        centro_id: centro.id,
        familia_id: familia,
        anio: 2026,
        mes: 1,
        total_centimos: 10000,
        estado: 'borrador',
      })
      .select('id')
      .single()
    expect(rErr).toBeNull()
    recibo = rc!.id
    const lineas = await serviceClient
      .from('lineas_recibo')
      .insert([
        {
          centro_id: centro.id,
          recibo_id: recibo,
          nino_id: inigo,
          descripcion: 'Escolaridad · Íñigo',
          cantidad: 1,
          precio_unitario_centimos: 5000,
          importe_centimos: 5000,
        },
        {
          centro_id: centro.id,
          recibo_id: recibo,
          nino_id: bea,
          descripcion: 'Comedor · Bea (5 días)',
          cantidad: 1,
          precio_unitario_centimos: 5000,
          importe_centimos: 5000,
        },
      ])
      .select('id, nino_id')
    expect(lineas.error).toBeNull()
    lineaInigo = lineas.data!.find((l) => l.nino_id === inigo)!.id
    lineaBea = lineas.data!.find((l) => l.nino_id === bea)!.id
    for (const cambio of [
      { estado: 'pendiente_procesar' as const },
      { estado: 'enviado_banco' as const, fecha_envio_banco: '2026-01-05' },
    ]) {
      const { error } = await serviceClient.from('recibos').update(cambio).eq('id', recibo)
      expect(error).toBeNull()
    }
  }, 120_000)

  afterAll(async () => {
    if (solicitudes.length) {
      await serviceClient.from('olvido_solicitudes').delete().in('id', solicitudes)
    }
    await serviceClient.from('olvido_solicitudes').delete().eq('centro_id', centro.id)
    await serviceClient.from('consentimientos').delete().eq('usuario_id', madre.id)
    await deleteTestCentro(centro.id)
    for (const u of [admin, profe, madre, segundo]) await deleteTestUser(u.id)
  }, 120_000)

  it('premisa: antes de la purga lo ven quienes lo veían', async () => {
    expect(await ve(admin, 'firmas_autorizacion', firma)).toBe(true)
    expect(await ve(profe, 'firmas_autorizacion', firma)).toBe(true)
    expect(await ve(madre, 'firmas_autorizacion', firma)).toBe(true)
    expect(await ve(admin, 'consentimientos', consentimiento)).toBe(true)
    expect(await veRecibo(admin)).toBe(true)
    expect(await lineasQueVe(madre)).toEqual(['Comedor · Bea (5 días)', 'Escolaridad · Íñigo'])
  })

  it('el segundo tutor, sin vínculo con sus hijos matriculados, no se olvida', async () => {
    const cAdmin = await clientFor(admin)
    const { data: id, error } = await cAdmin.rpc('pedir_olvido_usuario', {
      p_usuario_id: segundo.id,
      p_centro_id: centro.id,
    })
    expect(error).toBeNull()
    solicitudes.push(id as string)
    const { data: lista } = await cAdmin.rpc('peticiones_olvido_centro', { p_centro_id: centro.id })
    const fila = (lista ?? []).find((p) => p.id === id)
    expect(JSON.stringify(fila?.falta ?? null)).toContain('"hijos_matriculados"')
    const conf = await cAdmin.rpc('confirmar_peticion_olvido', { p_solicitud_id: id as string })
    expect(conf.error?.code).toBe('55000')
    expect(conf.error?.details ?? '').toContain('hijos_matriculados')
    const { error: rErr } = await cAdmin.rpc('retirar_peticion_olvido', {
      p_solicitud_id: id as string,
    })
    expect(rErr).toBeNull()
  })

  it('confirmado por otro camino, tampoco se purga: no sale en la lista y la purga lo rechaza', async () => {
    const { data: id, error } = await serviceClient.rpc('solicitar_olvido_usuario', {
      p_usuario_id: segundo.id,
      p_centro_id: centro.id,
      p_inmediato: true,
    })
    expect(error).toBeNull()
    solicitudes.push(id as string)
    // Premisa: está confirmada y su gracia ha vencido.
    const { data: sol } = await serviceClient
      .from('olvido_solicitudes')
      .select('estado, gracia_hasta')
      .eq('id', id as string)
      .single()
    expect(sol?.estado).toBe('confirmada')
    expect(new Date(sol!.gracia_hasta!).getTime()).toBeLessThanOrEqual(Date.now())

    const { data: pendientes, error: pErr } = await serviceClient.rpc('olvido_pendientes')
    expect(pErr).toBeNull()
    expect((pendientes ?? []).map((p) => p.solicitud_id)).not.toContain(id)
    const purga = await serviceClient.rpc('purgar_sujeto_db', { p_solicitud_id: id as string })
    expect(purga.error?.code).toBe('55000')
    expect(purga.error?.details ?? '').toContain('hijos_matriculados')
    const { data: despues } = await serviceClient
      .from('olvido_solicitudes')
      .select('purgado_en')
      .eq('id', id as string)
      .single()
    expect(despues?.purgado_en).toBeNull()
    // Que no estorbe al resto: se borra la petición y se le devuelve el rol.
    await serviceClient
      .from('olvido_solicitudes')
      .delete()
      .eq('id', id as string)
    await serviceClient
      .from('roles_usuario')
      .update({ deleted_at: null, deleted_reason: null })
      .eq('usuario_id', segundo.id)
      .eq('centro_id', centro.id)
    await serviceClient.from('usuarios').update({ deleted_at: null }).eq('id', segundo.id)
  })

  describe('purgado Íñigo', () => {
    beforeAll(async () => {
      await purgar(inigo)
    }, 120_000)

    it('su firma y su consentimiento se conservan, y nadie los ve en la app', async () => {
      const { data: f } = await serviceClient
        .from('firmas_autorizacion')
        .select('id')
        .eq('id', firma)
      expect(f).toHaveLength(1)
      const { data: c } = await serviceClient
        .from('consentimientos')
        .select('id')
        .eq('id', consentimiento)
      expect(c).toHaveLength(1)
      for (const u of [admin, profe, madre]) {
        expect(await ve(u, 'firmas_autorizacion', firma)).toBe(false)
      }
      expect(await ve(admin, 'consentimientos', consentimiento)).toBe(false)
    })

    it('el recibo de la familia sigue entero y a la vista, sin su nombre; tampoco en audit_log', async () => {
      expect(await veRecibo(admin)).toBe(true)
      expect(await lineasQueVe(madre)).toEqual([
        'Comedor · Bea (5 días)',
        'Escolaridad · [borrado]',
      ])
      const { data: copias, error } = await serviceClient
        .from('audit_log')
        .select('valores_antes, valores_despues')
        .eq('tabla', 'lineas_recibo')
        .eq('registro_id', lineaInigo)
      expect(error).toBeNull()
      // Premisa: hay copias (el INSERT y el cambio de la purga).
      expect((copias ?? []).length).toBeGreaterThanOrEqual(2)
      expect(JSON.stringify(copias)).not.toContain('Íñigo')
      expect(JSON.stringify(copias)).toContain('Escolaridad · [borrado]')
    })

    it('el registro de quién leyó su ficha se conserva, bloqueado', async () => {
      const { count } = await serviceClient
        .from('lecturas_ficha_medica')
        .select('id', { count: 'exact', head: true })
        .eq('nino_id', inigo)
      expect(count).toBe(1)
      const c = await clientFor(admin)
      const { data, error } = await c.rpc('lecturas_ficha_medica', { p_nino_id: inigo })
      expect(data).toBeNull()
      expect(error?.code).toBe('55000')
      expect(error?.details).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    it('el export de Dirección no lo entrega, y dice qué hay bloqueado', async () => {
      const rec = await recolectarNino(await clientFor(admin), serviceClient, inigo)
      expect(rec).not.toBeNull()
      const data = rec!.data
      expect(data.firmas).toEqual([])
      expect(data.consentimientos).toEqual([])
      expect(data.lecturas_ficha_medica).toEqual([])
      const nota = (data.datos_bloqueados as Record<string, string> | undefined)?._nota ?? ''
      expect(nota).toContain('firmas de autorizaciones (1, desde el')
      expect(nota).toContain('consentimientos (1, desde el')
      expect(nota).toContain('registro de consultas de la ficha médica (1, desde el')
      expect(nota).toContain('art. 32 LOPDGDD')
      // Su línea de recibo no: el recibo de la familia no está bloqueado, sale con «[borrado]».
      expect(nota).not.toContain('líneas de recibo')
      expect(JSON.stringify(data.lineas_recibo)).toContain('Escolaridad · [borrado]')
    })
  })

  describe('purgada también Bea: la familia se queda sin niños', () => {
    beforeAll(async () => {
      await purgar(bea)
    }, 120_000)

    it('el recibo y sus líneas se conservan, y nadie los ve en la app', async () => {
      const { data: r } = await serviceClient.from('recibos').select('id').eq('id', recibo)
      expect(r).toHaveLength(1)
      const { data: l } = await serviceClient
        .from('lineas_recibo')
        .select('descripcion')
        .in('id', [lineaInigo, lineaBea])
        .order('descripcion')
      expect((l ?? []).map((x) => x.descripcion)).toEqual([
        'Comedor · [borrado] (5 días)',
        'Escolaridad · [borrado]',
      ])
      for (const u of [admin, madre]) {
        expect(await veRecibo(u)).toBe(false)
        expect(await lineasQueVe(u)).toEqual([])
      }
    })

    it('el export de la madre no entrega los cobros de esa familia, y dice que existen', async () => {
      const rec = await recolectarUsuario(await clientFor(madre), serviceClient, madre.id)
      expect(rec).not.toBeNull()
      const data = rec!.data
      expect(data.firmas_realizadas).toEqual([])
      expect(JSON.stringify(data.cobros_familia ?? [])).not.toContain('[borrado]')
      const nota = (data.datos_bloqueados as Record<string, string> | undefined)?._nota ?? ''
      expect(nota).toContain('recibos (1, desde el')
      expect(nota).toContain('firmas de autorizaciones (1, desde el')
    })
  })
})
