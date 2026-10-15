import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
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
  serviceClient,
  type TestNino,
  type TestUser,
} from '../rls/setup'

import { anonimizarCuentaAuth } from '@/features/olvido/actions/purgar-vencidos'
import { recolectarAdjuntosDe } from '@/features/olvido/lib/fuentes-adjuntos'

/**
 * Cierre del frente de la purga RGPD (`20261015120000`).
 *
 * - Ítem 9: la purga del niño deja `idioma_principal = 'zz'` (no inventa 'es'), y el CHECK solo
 *   admite 'zz' en un niño purgado.
 * - Ítem 10: `_redactar_jsonb` conserva el null de JSON.
 * - Purga del usuario: su perfil en `familia_tutores` (y su copia en audit_log), su foto de
 *   perfil, preferencias y lecturas, los cambios pendientes sobre sus datos de tutor y su
 *   comentario en las citas. Purga del niño: sus cambios pendientes.
 * - Manifiesto de adjuntos: el DNI del tutor por ruta exacta, nunca el del otro tutor.
 * - Familia sin titular: la directora asciende al segundo tutor (`promover_a_titular`).
 * - Auth: la anonimización vacía los metadatos y no deja el email original en las identidades.
 */

const BORRADO = '[borrado]'

describe('Purga RGPD — cierre del frente', () => {
  let centro: { id: string }
  let centroB: { id: string }
  let curso: { id: string }
  let aula: { id: string }
  let admin: TestUser
  let adminB: TestUser
  const usuarios: TestUser[] = []
  const solicitudes: string[] = []

  const s = randomUUID().slice(0, 8)
  const marca = (campo: string) => `PC-${campo}-${s}`

  async function nuevoUsuario(nombre: string, rol: 'tutor_legal' | 'admin' | 'profe') {
    const u = await createTestUser({ nombre })
    usuarios.push(u)
    await asignarRol(u.id, centro.id, rol)
    return u
  }

  async function purgar(tipo: 'usuario' | 'nino', id: string) {
    const { data: solicitud, error: sErr } =
      tipo === 'usuario'
        ? await serviceClient.rpc('solicitar_olvido_usuario', {
            p_usuario_id: id,
            p_inmediato: true,
          })
        : await serviceClient.rpc('solicitar_olvido_nino', { p_nino_id: id, p_inmediato: true })
    expect(sErr).toBeNull()
    solicitudes.push(solicitud as string)
    const { error } = await serviceClient.rpc('purgar_sujeto_db', {
      p_solicitud_id: solicitud as string,
    })
    expect(error).toBeNull()
  }

  async function encolar(
    ninoId: string,
    entidad: string,
    payload: Record<string, unknown>,
    solicitadoPor: string
  ) {
    const { data, error } = await serviceClient
      .from('cambios_pendientes')
      .insert({
        centro_id: centro.id,
        nino_id: ninoId,
        entidad,
        registro_id: ninoId,
        payload: payload as never,
        solicitado_por: solicitadoPor,
      })
      .select('id')
      .single()
    if (error || !data) throw new Error(`encolar ${entidad}: ${error?.message}`)
    return data.id
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Purga Cierre')
    centroB = await createTestCentro('Centro Purga Cierre B')
    curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id)
    admin = await nuevoUsuario('Admin Purga Cierre', 'admin')
    adminB = await createTestUser({ nombre: 'Admin Purga Cierre B' })
    usuarios.push(adminB)
    await asignarRol(adminB.id, centroB.id, 'admin')
  }, 120_000)

  afterAll(async () => {
    if (solicitudes.length) {
      await serviceClient.from('olvido_solicitudes').delete().in('id', solicitudes)
    }
    await serviceClient.from('cambios_pendientes').delete().eq('centro_id', centro.id)
    await serviceClient.from('citas').delete().eq('centro_id', centro.id)
    await serviceClient.from('anuncios').delete().eq('centro_id', centro.id)
    await deleteTestCentro(centro.id)
    await deleteTestCentro(centroB.id)
    for (const u of usuarios) {
      await serviceClient.from('preferencias_usuario').delete().eq('usuario_id', u.id)
      await deleteTestUser(u.id)
    }
  }, 120_000)

  describe('ítem 10 — _redactar_jsonb', () => {
    it('un null sigue siendo null; un valor pasa a [borrado]; una clave ausente no aparece', async () => {
      const { data, error } = await serviceClient.rpc('_redactar_jsonb', {
        j: { a: null, b: 'x', c: 1 },
        claves: ['a', 'b', 'z'],
      })
      expect(error).toBeNull()
      expect(data).toEqual({ a: null, b: BORRADO, c: 1 })
    })
  })

  describe('ítem 9 — idioma_principal', () => {
    it('el CHECK no admite zz en un niño vivo, y sí es/en/va', async () => {
      const nino = await createTestNino(centro.id)
      const ok = await serviceClient
        .from('ninos')
        .update({ idioma_principal: 'va' })
        .eq('id', nino.id)
      expect(ok.error).toBeNull()
      const zz = await serviceClient
        .from('ninos')
        .update({ idioma_principal: 'zz' })
        .eq('id', nino.id)
      expect(zz.error?.code).toBe('23514')
    })

    it('la purga del niño deja zz y borra sus cambios pendientes; los de otro niño se quedan', async () => {
      const nino = await createTestNino(centro.id)
      const otro = await createTestNino(centro.id)
      const tutor = await nuevoUsuario('Tutor Purga Cierre Nino', 'tutor_legal')
      await serviceClient.from('ninos').update({ idioma_principal: 'va' }).eq('id', nino.id)
      await encolar(nino.id, 'ninos_familia', { direccion_calle: marca('calle-nino') }, tutor.id)
      await encolar(
        nino.id,
        'datos_tutor_dni',
        { path: `${centro.id}/${nino.id}/${randomUUID()}.pdf` },
        tutor.id
      )
      const delOtro = await encolar(otro.id, 'ninos_familia', { direccion_calle: 'x' }, tutor.id)

      // El DNI pendiente sin aplicar del niño entra en el manifiesto (antes de la purga SQL).
      const adjuntos = await recolectarAdjuntosDe(serviceClient, 'nino', nino.id)
      expect(adjuntos.get('dni-tutores')).toHaveLength(1)

      await purgar('nino', nino.id)

      const { data: n } = await serviceClient
        .from('ninos')
        .select('idioma_principal, deleted_reason')
        .eq('id', nino.id)
        .single()
      expect(n).toEqual({ idioma_principal: 'zz', deleted_reason: 'purga_rgpd' })
      const { data: cambios } = await serviceClient
        .from('cambios_pendientes')
        .select('id')
        .in('nino_id', [nino.id, otro.id])
      expect((cambios ?? []).map((c) => c.id)).toEqual([delOtro])
    })
  })

  describe('purga del usuario', () => {
    let nino: TestNino
    let tutor: TestUser // titular, el que se purga
    let tutor2: TestUser // segundo tutor, el que se queda
    let profe: TestUser
    let filaTutor: string
    let filaTutor2: string
    let invitadoId: string
    let dniTutor: string
    let dniTutor2: string
    let dniPendiente: string
    let cambioNino: string

    beforeAll(async () => {
      nino = await createTestNino(centro.id)
      tutor = await nuevoUsuario('Tutor Purga Cierre', 'tutor_legal')
      tutor2 = await nuevoUsuario('Tutor2 Purga Cierre', 'tutor_legal')
      profe = await nuevoUsuario('Profe Purga Cierre', 'profe')
      await crearVinculo(nino.id, tutor.id, 'tutor_legal_principal')
      await crearVinculo(nino.id, tutor2.id, 'tutor_legal_secundario')
      filaTutor = await crearFamiliaTutor(nino.familia_id, tutor.id, 'titular')
      filaTutor2 = await crearFamiliaTutor(nino.familia_id, tutor2.id, 'segundo_tutor')

      dniTutor = `${centro.id}/${nino.id}/${randomUUID()}.pdf`
      dniTutor2 = `${centro.id}/${nino.id}/${randomUUID()}.pdf`
      dniPendiente = `${centro.id}/${nino.id}/${randomUUID()}.pdf`
      // Perfil con datos marcados. Con una sesión de admin, como en la app: deja auditoría.
      const cAdmin = await clientFor(admin)
      const { error: pErr } = await cAdmin
        .from('familia_tutores')
        .update({
          nombre_completo: marca('nombre'),
          email: `${marca('email')}@correo.test`,
          direccion_calle: marca('calle'),
          direccion_numero: '7',
          direccion_cp: '46001',
          direccion_ciudad: marca('ciudad'),
        })
        .eq('id', filaTutor)
      expect(pErr).toBeNull()
      await serviceClient
        .from('familia_tutores')
        .update({ dni_documento_path: dniTutor })
        .eq('id', filaTutor)
      await serviceClient
        .from('familia_tutores')
        .update({ nombre_completo: 'Segundo Tutor Queda', dni_documento_path: dniTutor2 })
        .eq('id', filaTutor2)

      await serviceClient
        .from('usuarios')
        .update({ foto_url: `${centro.id}/${tutor.id}/avatar.jpg` })
        .eq('id', tutor.id)
      await serviceClient
        .from('preferencias_usuario')
        .insert({ usuario_id: tutor.id, clave: 'agenda_vista', valor: 'semana' })
      const { data: anuncio } = await serviceClient
        .from('anuncios')
        .insert({
          centro_id: centro.id,
          autor_id: admin.id,
          ambito: 'centro',
          titulo: 'Anuncio Purga Cierre',
          contenido: 'x',
        })
        .select('id')
        .single()
      await serviceClient
        .from('lectura_anuncio')
        .insert({ usuario_id: tutor.id, anuncio_id: anuncio!.id })
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
      const { data: cita } = await serviceClient
        .from('citas')
        .insert({
          centro_id: centro.id,
          tipo: 'reunion_familia',
          organizador_id: admin.id,
          nino_id: nino.id,
          titulo: 'Cita Purga Cierre',
          fecha: '2026-11-10',
          hora_inicio: '17:00',
        })
        .select('id')
        .single()
      const { data: inv } = await serviceClient
        .from('cita_invitados')
        .insert({ cita_id: cita!.id, centro_id: centro.id, usuario_id: tutor.id })
        .select('id')
        .single()
      invitadoId = inv!.id
      // El comentario, con su sesión: queda en audit_log con él como actor.
      const cTutor = await clientFor(tutor)
      const { error: cErr } = await cTutor
        .from('cita_invitados')
        .update({ comentario: marca('comentario'), estado: 'aceptado' } as never)
        .eq('id', invitadoId)
      expect(cErr).toBeNull()

      await encolar(nino.id, 'datos_tutor', { email: `${marca('email-cola')}@x.test` }, tutor.id)
      await encolar(nino.id, 'datos_tutor_dni', { path: dniPendiente }, tutor.id)
      cambioNino = await encolar(nino.id, 'ninos_familia', { direccion_calle: 'x' }, tutor.id)
    }, 180_000)

    it('manifiesto: su DNI, su DNI pendiente y su avatar; nunca el DNI del otro tutor', async () => {
      const porBucket = await recolectarAdjuntosDe(serviceClient, 'usuario', tutor.id)
      expect([...(porBucket.get('dni-tutores') ?? [])].sort()).toEqual(
        [dniTutor, dniPendiente].sort()
      )
      expect(porBucket.get('dni-tutores')).not.toContain(dniTutor2)
      expect(porBucket.get('usuarios-fotos')).toEqual(
        expect.arrayContaining([`${centro.id}/${tutor.id}/avatar.jpg`])
      )
    })

    it('purga: perfil anonimizado y de baja, ids conservados; el del otro tutor intacto', async () => {
      await purgar('usuario', tutor.id)

      const { data: fila } = await serviceClient
        .from('familia_tutores')
        .select(
          'usuario_id, familia_id, rol_familia, nombre_completo, email, direccion_calle, direccion_numero, direccion_cp, direccion_ciudad, dni_documento_path, deleted_at'
        )
        .eq('id', filaTutor)
        .single()
      expect(fila).toMatchObject({
        usuario_id: tutor.id,
        familia_id: nino.familia_id,
        rol_familia: 'titular',
        nombre_completo: null,
        email: null,
        direccion_calle: null,
        direccion_numero: null,
        direccion_cp: null,
        direccion_ciudad: null,
        dni_documento_path: null,
      })
      expect(fila?.deleted_at).not.toBeNull()

      const { data: otra } = await serviceClient
        .from('familia_tutores')
        .select('nombre_completo, dni_documento_path, deleted_at')
        .eq('id', filaTutor2)
        .single()
      expect(otra).toEqual({
        nombre_completo: 'Segundo Tutor Queda',
        dni_documento_path: dniTutor2,
        deleted_at: null,
      })
    })

    it('su copia en audit_log no conserva el nombre, el email, la dirección ni la ruta del DNI', async () => {
      const { data } = await serviceClient
        .from('audit_log')
        .select('accion, valores_antes, valores_despues')
        .eq('tabla', 'familia_tutores')
        .eq('registro_id', filaTutor)
      // Premisa: hay auditoría de esa fila (el UPDATE con datos y el de la purga).
      expect((data ?? []).length).toBeGreaterThanOrEqual(2)
      const texto = JSON.stringify(data)
      expect(texto).not.toContain(s)
      expect(texto).not.toContain(dniTutor)
    })

    it('foto de perfil, preferencias y lecturas fuera', async () => {
      const { data: u } = await serviceClient
        .from('usuarios')
        .select('foto_url')
        .eq('id', tutor.id)
        .single()
      expect(u?.foto_url).toBeNull()
      for (const tabla of [
        'preferencias_usuario',
        'lectura_anuncio',
        'lectura_conversacion',
      ] as const) {
        const { data } = await serviceClient
          .from(tabla)
          .select('usuario_id')
          .eq('usuario_id', tutor.id)
        expect(data ?? [], tabla).toHaveLength(0)
      }
    })

    it('cita: su comentario a NULL, en la tabla y en audit_log', async () => {
      const { data: inv } = await serviceClient
        .from('cita_invitados')
        .select('comentario')
        .eq('id', invitadoId)
        .single()
      expect(inv?.comentario).toBeNull()
      const { data: audit } = await serviceClient
        .from('audit_log')
        .select('valores_antes, valores_despues')
        .eq('tabla', 'cita_invitados')
        .eq('registro_id', invitadoId)
      expect((audit ?? []).length).toBeGreaterThan(0)
      expect(JSON.stringify(audit)).not.toContain(marca('comentario'))
    })

    it('cambios pendientes: los de sus datos de tutor, fuera; los del niño que pidió, se quedan', async () => {
      const { data } = await serviceClient
        .from('cambios_pendientes')
        .select('id, entidad')
        .eq('solicitado_por', tutor.id)
        .eq('nino_id', nino.id)
      expect(data).toEqual([{ id: cambioNino, entidad: 'ninos_familia' }])
    })

    describe('familia sin titular: promover_a_titular', () => {
      it('premisa: tras la purga la familia no tiene titular activo', async () => {
        const { data } = await serviceClient
          .from('familia_tutores')
          .select('id')
          .eq('familia_id', nino.familia_id)
          .eq('rol_familia', 'titular')
          .is('deleted_at', null)
        expect(data ?? []).toHaveLength(0)
      })

      it('ni el segundo tutor, ni la profe, ni el admin de otro centro → 42501', async () => {
        for (const u of [tutor2, profe, adminB]) {
          const c = await clientFor(u)
          const { error } = await c.rpc('promover_a_titular', { p_familia_tutor_id: filaTutor2 })
          expect(error?.code, u.email).toBe('42501')
        }
      })

      it('el rol sigue congelado fuera de la RPC: ni el admin lo cambia con un UPDATE', async () => {
        const c = await clientFor(admin)
        const { error } = await c
          .from('familia_tutores')
          .update({ rol_familia: 'titular' })
          .eq('id', filaTutor2)
        expect(error?.code).toBe('42501')
      })

      it('la directora lo asciende: fila y vínculos, con ella como actor en audit_log', async () => {
        const c = await clientFor(admin)
        const { error } = await c.rpc('promover_a_titular', { p_familia_tutor_id: filaTutor2 })
        expect(error).toBeNull()

        const { data: fila } = await serviceClient
          .from('familia_tutores')
          .select('rol_familia')
          .eq('id', filaTutor2)
          .single()
        expect(fila?.rol_familia).toBe('titular')
        const { data: v } = await serviceClient
          .from('vinculos_familiares')
          .select('tipo_vinculo')
          .eq('nino_id', nino.id)
          .eq('usuario_id', tutor2.id)
          .single()
        expect(v?.tipo_vinculo).toBe('tutor_legal_principal')
        const { data: audit } = await serviceClient
          .from('audit_log')
          .select('usuario_id, valores_despues')
          .eq('tabla', 'familia_tutores')
          .eq('registro_id', filaTutor2)
          .eq('accion', 'UPDATE')
        expect(
          (audit ?? []).some(
            (a) =>
              a.usuario_id === admin.id &&
              (a.valores_despues as { rol_familia?: string } | null)?.rol_familia === 'titular'
          )
        ).toBe(true)
      })

      it('con titular ya activo, otra llamada falla (23514) y no cambia nada', async () => {
        const c = await clientFor(admin)
        const { error } = await c.rpc('promover_a_titular', { p_familia_tutor_id: filaTutor2 })
        expect(error?.code).toBe('23514')
      })
    })
  })

  describe('auth: anonimizarCuentaAuth contra el GoTrue real', () => {
    it('email ficticio, metadatos vacíos y sin el email original en las identidades', async () => {
      const u = await createTestUser({ nombre: marca('nombre-auth') })
      usuarios.push(u)
      const { data: antes } = await serviceClient.auth.admin.getUserById(u.id)
      // Premisa: el nombre está en los metadatos y el email en las identidades.
      expect(antes.user?.user_metadata?.nombre_completo).toBe(marca('nombre-auth'))
      expect(JSON.stringify(antes.user?.identities ?? [])).toContain(u.email)

      await anonimizarCuentaAuth(serviceClient, u.id, antes.user?.user_metadata ?? {})

      const { data: despues, error } = await serviceClient.auth.admin.getUserById(u.id)
      expect(error).toBeNull()
      expect(despues.user?.email).toBe(`borrado+${u.id}@borrado.invalid`)
      const meta = despues.user?.user_metadata ?? {}
      expect(Object.values(meta).filter((v) => v !== null && v !== undefined)).toEqual([])
      expect(JSON.stringify(despues.user?.identities ?? [])).not.toContain(u.email)
      expect(JSON.stringify(despues.user ?? {})).not.toContain(marca('nombre-auth'))
    })
  })
})
