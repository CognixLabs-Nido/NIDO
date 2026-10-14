import { randomUUID } from 'crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  anonClient,
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
  type TestAula,
  type TestCentro,
  type TestNino,
  type TestUser,
} from './setup'

import { recolectarNino, recolectarUsuario } from '@/features/export/lib/recolectar'

/**
 * Export RGPD (art. 15) completo — `export_datos_sujeto` (`20261014120000`).
 *
 * La función devuelve lo que el export añade sobre lo que la sesión ya lee. El control de
 * acceso vive en ella: el propio usuario, un tutor legal del niño (principal o secundario) o
 * el admin de su centro; la profe, el autorizado, otra familia y el admin de otro centro
 * reciben 42501. Además:
 *   · el consentimiento de imagen del niño sale por sujeto, también el que dio el otro tutor;
 *   · Dirección recibe las preferencias, los dispositivos y las lecturas del usuario;
 *   · el tutor con cuenta, de su prospecto en lista_espera, solo teléfono y email;
 *   · motivo_baja solo en el export de Dirección; del IBAN, solo los 4 últimos dígitos;
 *   · el admin solo recibe las filas de SU centro.
 */

type Fila = Record<string, unknown>

describe('export_datos_sujeto — export art. 15 completo', () => {
  let centro: TestCentro
  let centroB: TestCentro
  let aula: TestAula
  let admin: TestUser
  let adminB: TestUser
  let profe: TestUser
  let tutor: TestUser // principal; titular de la familia
  let tutorSec: TestUser // secundario, sin permisos de vínculo
  let autorizado: TestUser
  let tutorOtro: TestUser // otra familia del mismo centro
  let nino: TestNino
  let ninoOtro: TestNino
  let matriculaId: string
  let reciboId: string

  const rpc = async (u: TestUser, tipo: 'usuario' | 'nino', id: string) => {
    const c = await clientFor(u)
    return c.rpc('export_datos_sujeto', { p_sujeto_tipo: tipo, p_sujeto_id: id })
  }
  const filas = (v: unknown): Fila[] => (Array.isArray(v) ? (v as Fila[]) : [])

  beforeAll(async () => {
    centro = await createTestCentro('Centro Export Art15')
    centroB = await createTestCentro('Centro Export Art15 B')
    const curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id, 'Aula Export Art15')

    admin = await createTestUser({ nombre: 'Admin Art15' })
    adminB = await createTestUser({ nombre: 'Admin Art15 B' })
    profe = await createTestUser({ nombre: 'Profe Art15' })
    tutor = await createTestUser({ nombre: 'Tutor Art15' })
    tutorSec = await createTestUser({ nombre: 'Tutor Art15 Sec' })
    autorizado = await createTestUser({ nombre: 'Autorizado Art15' })
    tutorOtro = await createTestUser({ nombre: 'Tutor Art15 Otro' })
    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(adminB.id, centroB.id, 'admin')
    await asignarRol(profe.id, centro.id, 'profe')
    for (const u of [tutor, tutorSec, tutorOtro]) await asignarRol(u.id, centro.id, 'tutor_legal')
    await asignarRol(autorizado.id, centro.id, 'autorizado')

    nino = await createTestNino(centro.id, 'Nino Art15')
    ninoOtro = await createTestNino(centro.id, 'Nino Art15 Otro')
    matriculaId = await matricular(nino.id, aula.id, curso.id)

    await crearVinculo(nino.id, tutor.id, 'tutor_legal_principal', {
      puede_recibir_mensajes: true,
    })
    await crearVinculo(nino.id, tutorSec.id, 'tutor_legal_secundario', {})
    await crearVinculo(nino.id, autorizado.id, 'autorizado', {})
    await crearVinculo(ninoOtro.id, tutorOtro.id, 'tutor_legal_principal', {})
    await crearFamiliaTutor(nino.familia_id, tutor.id, 'titular')
    await crearFamiliaTutor(nino.familia_id, tutorSec.id, 'segundo_tutor')

    // Profe del aula del niño (es_profe_de_nino), para que la prueba de su 42501 tenga dientes.
    await asignarProfeAula(profe.id, aula.id, curso.id)

    // El consentimiento de imagen lo da el PRINCIPAL; el secundario tiene que verlo igual.
    const { error: cErr } = await serviceClient.rpc('otorgar_consentimiento_imagen', {
      p_nino_id: nino.id,
      p_tutor: tutor.id,
    })
    if (cErr) throw new Error(`otorgar: ${cErr.message}`)

    // Prospecto del niño (entero) con el tutor como tutor_usuario_id.
    const { data: le, error: leErr } = await serviceClient
      .from('lista_espera')
      .insert({
        centro_id: centro.id,
        curso_academico_id: curso.id,
        nombre_nino: 'Nino Art15',
        apellidos_nino: 'Apellido Test',
        fecha_nacimiento: '2024-03-15',
        telefono_tutor: '600000015',
        email_tutor: 'tutor-art15@correo.test',
        nota: 'Nota del prospecto',
        posicion: 1,
        tutor_usuario_id: tutor.id,
      })
      .select('id')
      .single()
    if (leErr || !le) throw new Error(`lista_espera: ${leErr?.message}`)
    await serviceClient
      .from('lista_espera')
      .update({ estado: 'invitado', nino_id: nino.id })
      .eq('id', le.id)

    // Cobros de la familia: un recibo con una línea del niño.
    const { data: rec, error: rErr } = await serviceClient
      .from('recibos')
      .insert({
        centro_id: centro.id,
        familia_id: nino.familia_id,
        anio: 2027,
        mes: 1,
        estado: 'borrador',
        total_centimos: 12345,
        es_esporadico: false,
      })
      .select('id')
      .single()
    if (rErr || !rec) throw new Error(`recibo: ${rErr?.message}`)
    reciboId = rec.id
    const { error: lErr } = await serviceClient.from('lineas_recibo').insert({
      centro_id: centro.id,
      recibo_id: reciboId,
      nino_id: nino.id,
      descripcion: 'Cuota Art15',
      cantidad: 1,
      precio_unitario_centimos: 12345,
      importe_centimos: 12345,
      origen: 'manual',
    })
    if (lErr) throw new Error(`línea: ${lErr.message}`)
    const { error: mpErr } = await serviceClient.from('metodo_pago_familia').insert({
      centro_id: centro.id,
      familia_id: nino.familia_id,
      anio: 2027,
      mes: 1,
      metodo: 'sepa',
    })
    if (mpErr) throw new Error(`método: ${mpErr.message}`)
    const { error: psErr } = await serviceClient.from('parte_servicio_diario').insert({
      centro_id: centro.id,
      nino_id: nino.id,
      fecha: '2027-01-15',
      servicio: 'comedor',
      presente: true,
    })
    if (psErr) throw new Error(`parte: ${psErr.message}`)

    // Mandato SEPA firmado por el tutor (el IBAN se cifra; solo salen los 4 últimos).
    const cTutor = await clientFor(tutor)
    const { error: mErr } = await cTutor.rpc('registrar_mandato_sepa', {
      p_familia_id: nino.familia_id,
      p_nino_id: null,
      p_iban: 'ES76 2077 0024 0031 0257 5766',
      p_titular: 'Titular Art15',
      p_identificador_mandato: 'NIDO-ART15-1',
      p_documento_path: '',
      p_firma_imagen: '',
      p_nombre_tecleado: 'Titular Art15',
      p_texto_hash: 'a'.repeat(64),
      p_ip_address: null,
      p_user_agent: 'test',
      p_fecha_firma: '2026-02-01T10:00:00Z',
    } as never)
    if (mErr) throw new Error(`mandato: ${mErr.message}`)

    // Telemetría del tutor: preferencia, dispositivo y lectura de su conversación.
    await serviceClient
      .from('preferencias_usuario')
      .insert({ usuario_id: tutor.id, clave: 'agenda_vista', valor: 'semana' })
    await serviceClient.from('push_subscriptions').insert({
      usuario_id: tutor.id,
      endpoint: 'https://push.test/art15',
      p256dh: 'clave-p256dh-art15',
      auth: 'auth-art15',
      user_agent: 'Navegador Art15',
    })
    const { data: conv } = await serviceClient
      .from('conversaciones')
      .insert({ nino_id: nino.id, centro_id: centro.id })
      .select('id')
      .single()
    await serviceClient.from('lectura_conversacion').insert({
      usuario_id: tutor.id,
      conversacion_id: conv!.id,
      last_read_at: new Date().toISOString(),
    })
  }, 240_000)

  afterAll(async () => {
    await serviceClient.from('mandatos_sepa').delete().eq('centro_id', centro.id)
    await serviceClient.from('lineas_recibo').delete().eq('recibo_id', reciboId)
    await serviceClient.from('recibos').delete().eq('centro_id', centro.id)
    await serviceClient.from('metodo_pago_familia').delete().eq('centro_id', centro.id)
    await serviceClient.from('parte_servicio_diario').delete().eq('centro_id', centro.id)
    await serviceClient.from('lista_espera').delete().eq('centro_id', centro.id)
    await serviceClient.from('consentimientos').delete().eq('nino_id', nino.id)
    await serviceClient.from('push_subscriptions').delete().eq('usuario_id', tutor.id)
    await serviceClient.from('preferencias_usuario').delete().eq('usuario_id', tutor.id)
    await serviceClient.from('profes_aulas').delete().eq('aula_id', aula.id)
    await serviceClient.from('vinculos_familiares').delete().in('nino_id', [nino.id, ninoOtro.id])
    await deleteTestCentro(centro.id)
    await deleteTestCentro(centroB.id)
    for (const u of [admin, adminB, profe, tutor, tutorSec, autorizado, tutorOtro]) {
      await deleteTestUser(u.id)
    }
  }, 120_000)

  describe('control de acceso', () => {
    it('niño: el tutor principal, el secundario y el admin del centro lo reciben', async () => {
      for (const u of [tutor, tutorSec, admin]) {
        const { data, error } = await rpc(u, 'nino', nino.id)
        expect(error, u.email).toBeNull()
        expect(filas((data as Fila).lista_espera), u.email).toHaveLength(1)
      }
    })

    it('niño: la profe del aula, el autorizado, otra familia y el admin de otro centro → 42501', async () => {
      for (const u of [profe, autorizado, tutorOtro, adminB]) {
        const { data, error } = await rpc(u, 'nino', nino.id)
        expect(error?.code, u.email).toBe('42501')
        expect(data, u.email).toBeNull()
      }
    })

    it('niño inexistente → 42501, también para un admin', async () => {
      const { error } = await rpc(admin, 'nino', randomUUID())
      expect(error?.code).toBe('42501')
    })

    it('usuario: él mismo y el admin de su centro; la profe, otro tutor y el admin de otro centro → 42501', async () => {
      for (const u of [tutor, admin]) {
        const { error } = await rpc(u, 'usuario', tutor.id)
        expect(error, u.email).toBeNull()
      }
      for (const u of [profe, tutorSec, tutorOtro, adminB]) {
        const { error } = await rpc(u, 'usuario', tutor.id)
        expect(error?.code, u.email).toBe('42501')
      }
    })

    it('sin sesión (anon) no puede ejecutarla', async () => {
      const { error } = await anonClient().rpc('export_datos_sujeto', {
        p_sujeto_tipo: 'nino',
        p_sujeto_id: nino.id,
      })
      expect(error).not.toBeNull()
    })

    it('tipo de sujeto inválido → error, no un jsonb vacío', async () => {
      const { data, error } = await rpc(tutor, 'otro' as never, tutor.id)
      expect(error).not.toBeNull()
      expect(data).toBeNull()
    })
  })

  describe('contenido', () => {
    it('el tutor secundario recibe EXACTAMENTE lo mismo que el principal', async () => {
      const a = await rpc(tutor, 'nino', nino.id)
      const b = await rpc(tutorSec, 'nino', nino.id)
      expect(a.error).toBeNull()
      expect(b.data).toEqual(a.data)
    })

    it('consentimiento de imagen: sale por sujeto, también al tutor que NO lo dio', async () => {
      const { data } = await rpc(tutorSec, 'nino', nino.id)
      const cons = filas((data as Fila).consentimientos)
      expect(cons.some((c) => c.tipo === 'imagen' && c.revocado_en === null)).toBe(true)
      // Ni la IP ni el navegador del otro tutor.
      expect(JSON.stringify(cons)).not.toMatch(/ip_address|user_agent/)
    })

    it('lista_espera: el niño, su prospecto entero; el tutor, solo teléfono y email', async () => {
      const n = await rpc(tutor, 'nino', nino.id)
      const [prospecto] = filas((n.data as Fila).lista_espera)
      expect(prospecto).toMatchObject({
        nombre_nino: 'Nino Art15',
        telefono_tutor: '600000015',
        email_tutor: 'tutor-art15@correo.test',
        nota: 'Nota del prospecto',
        estado: 'invitado',
      })

      const u = await rpc(tutor, 'usuario', tutor.id)
      const contacto = filas((u.data as Fila).lista_espera_contacto)
      expect(contacto).toEqual([
        { telefono_tutor: '600000015', email_tutor: 'tutor-art15@correo.test' },
      ])
    })

    it('cobros: recibo con su línea, método de pago y parte de comedor; del mandato, solo los 4 últimos', async () => {
      const u = await rpc(tutor, 'usuario', tutor.id)
      const [familia] = filas((u.data as Fila).cobros_familia)
      const [recibo] = filas(familia?.recibos)
      expect(recibo).toMatchObject({ anio: 2027, mes: 1, total_centimos: 12345 })
      expect(filas(recibo?.lineas)[0]).toMatchObject({ descripcion: 'Cuota Art15' })
      expect(filas(familia?.metodos_pago)).toEqual([{ anio: 2027, mes: 1, metodo: 'sepa' }])

      const [mandato] = filas((u.data as Fila).mandatos_sepa)
      expect(mandato).toMatchObject({
        iban_ultimos4: '5766',
        identificador_mandato: 'NIDO-ART15-1',
      })
      const todo = JSON.stringify(u.data)
      expect(todo).not.toContain('iban_cifrado')
      expect(todo).not.toContain('2077 0024')

      const n = await rpc(tutorSec, 'nino', nino.id)
      expect(filas((n.data as Fila).servicios_diarios)).toEqual([
        { fecha: '2027-01-15', servicio: 'comedor', presente: true },
      ])
      expect(filas((n.data as Fila).lineas_recibo)[0]).toMatchObject({
        descripcion: 'Cuota Art15',
        importe_centimos: 12345,
      })
    })

    it('el tutor secundario también recibe los cobros de la familia', async () => {
      const a = await rpc(tutor, 'usuario', tutor.id)
      const b = await rpc(tutorSec, 'usuario', tutorSec.id)
      expect((b.data as Fila).cobros_familia).toEqual((a.data as Fila).cobros_familia)
    })

    it('Dirección recibe las preferencias, los dispositivos y las lecturas del usuario', async () => {
      // Premisa: con la sesión del admin, esas tablas no se leen (son del propio usuario).
      const cAdmin = await clientFor(admin)
      const pref = await cAdmin
        .from('preferencias_usuario')
        .select('clave')
        .eq('usuario_id', tutor.id)
      expect(pref.data ?? []).toHaveLength(0)

      const { data, error } = await rpc(admin, 'usuario', tutor.id)
      expect(error).toBeNull()
      const d = data as Fila
      expect(filas(d.preferencias)).toEqual([
        expect.objectContaining({ clave: 'agenda_vista', valor: 'semana' }),
      ])
      expect(filas(d.dispositivos)).toEqual([
        expect.objectContaining({ navegador: 'Navegador Art15' }),
      ])
      expect(filas(d.lecturas_conversaciones)).toHaveLength(1)
      // Las claves del navegador no salen nunca.
      expect(JSON.stringify(d.dispositivos)).not.toMatch(/push\.test|p256dh|auth-art15/)
    })

    it('el admin solo recibe las filas de SU centro', async () => {
      // El tutor pasa a tener rol también en el centro B: su admin pasa el control de acceso…
      await asignarRol(tutor.id, centroB.id, 'tutor_legal')
      try {
        const { data, error } = await rpc(adminB, 'usuario', tutor.id)
        expect(error).toBeNull()
        const d = data as Fila
        // …pero la lista de espera, los cobros y el mandato son del centro A.
        expect(filas(d.lista_espera_contacto)).toHaveLength(0)
        expect(filas(d.cobros_familia)).toHaveLength(0)
        expect(filas(d.mandatos_sepa)).toHaveLength(0)
        expect(filas(d.perfiles_familia)).toHaveLength(0)
        // Lo del propio usuario sin centro sí sale (es su usuario).
        expect(filas(d.preferencias)).toHaveLength(1)
      } finally {
        await serviceClient
          .from('roles_usuario')
          .delete()
          .eq('usuario_id', tutor.id)
          .eq('centro_id', centroB.id)
      }
    })

    it('motivo_baja: nunca sale de la función, ni para el admin', async () => {
      await serviceClient
        .from('matriculas')
        .update({ motivo_baja: 'Nota interna Art15' } as never)
        .eq('id', matriculaId)
      const { data } = await rpc(admin, 'nino', nino.id)
      expect(JSON.stringify(data)).not.toContain('Nota interna Art15')
      expect(filas((data as Fila).matriculas)).toHaveLength(1)
    })
  })

  describe('recolectar: lo que llega al ZIP', () => {
    it('motivo_baja: sale en el export de Dirección, no en el del tutor ni en /export/me', async () => {
      const dir = await recolectarNino(await clientFor(admin), serviceClient, nino.id, {
        incluirMotivoBaja: true,
      })
      expect(JSON.stringify(dir!.data.matriculas)).toContain('Nota interna Art15')

      // La familia por la ruta de Dirección: la RPC del motivo le da 42501 y no sale.
      const fam = await recolectarNino(await clientFor(tutor), serviceClient, nino.id, {
        incluirMotivoBaja: true,
      })
      expect(JSON.stringify(fam!.data)).not.toContain('Nota interna Art15')

      // /export/me no lo pide nunca, aunque quien exporta sea admin.
      const me = await recolectarNino(await clientFor(admin), serviceClient, nino.id)
      expect(JSON.stringify(me!.data)).not.toContain('Nota interna Art15')
    })

    it('la profe exporta por sesión lo de antes y una nota en lugar de los datos ampliados', async () => {
      const rec = await recolectarNino(await clientFor(profe), serviceClient, nino.id)
      expect(rec).not.toBeNull()
      expect(rec!.data.lista_espera).toBeUndefined()
      expect(rec!.data.datos_ampliados).toEqual({ _nota: expect.any(String) })
    })

    it('el export del tutor lleva su perfil, sus cobros y su lista de espera', async () => {
      const rec = await recolectarUsuario(await clientFor(tutor), serviceClient, tutor.id)
      expect(filas(rec!.data.perfiles_familia)).toHaveLength(1)
      expect(filas(rec!.data.cobros_familia)).toHaveLength(1)
      expect(filas(rec!.data.lista_espera_contacto)).toHaveLength(1)
      expect(rec!.data.datos_ampliados).toBeUndefined()
    })
  })
})
