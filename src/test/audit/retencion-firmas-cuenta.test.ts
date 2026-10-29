import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  clientFor,
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

/**
 * Las firmas y la cuenta del tutor al vencer (F11-B, punto 6, PR-8, segunda pieza; 20261207120000).
 *
 * Íñigo está de baja desde 1990 y su expediente ya se purgó. Lo que se conservaba por obligación
 * (la autorización de medicación y las firmas de la madre y del padre, la medicación administrada,
 * el consentimiento y el acuse de la madre, una salida de ámbito niño) se destruye, sin copia en
 * audit_log. Retenido Íñigo, nada; retenido el padre, su firma y la autorización de la que cuelga
 * se quedan. El registro de accesos espera a que no quede nada que mirar, también las lecturas de
 * la ficha. Bea, viva, no se toca.
 *
 * La cuenta de la madre vence a los 5 años de la baja de su último hijo: con Bea viva no; con un
 * rol de profe, un recibo pendiente o retenida, tampoco. Vencida, la BD abre una petición «por
 * plazo» que la purga del olvido no coge (es del cron, sin correo), que la retención no devuelve a
 * pendiente y que la purga vuelve a mirar.
 */

const MOTIVO = 'Oficio 12/2027 del juzgado n.º 3'
const BAJA = '1990-01-01T10:00:00+00:00'

describe('Retención: las firmas y la cuenta del tutor al vencer', () => {
  let centro: { id: string }
  let admin: TestUser
  let madre: TestUser
  let padre: TestUser
  let inigo: string
  let bea: string
  let familia: string
  let autorizacion: string
  let firmaMadre: string
  let firmaPadre: string
  let consentimientoBea: string
  let evento: string

  const sujeto = (tipo: 'nino' | 'usuario', id: string) => ({ tipo, id })

  async function retener(tipo: 'nino' | 'usuario', id: string) {
    const c = await clientFor(admin)
    const r = await c.rpc('poner_retencion', {
      p_centro_id: centro.id,
      p_sujetos: [sujeto(tipo, id)] as never,
      p_motivo_tipo: 'juzgado',
      p_motivo: MOTIVO,
    })
    expect(r.error).toBeNull()
    return r.data as { puestas: number; deshechas: string[] }
  }

  async function soltar(tipo: 'nino' | 'usuario', id: string) {
    const c = await clientFor(admin)
    const r = await c.rpc('quitar_retencion', {
      p_centro_id: centro.id,
      p_sujetos: [sujeto(tipo, id)] as never,
      p_motivo: 'Archivado el procedimiento',
    })
    expect(r.error).toBeNull()
  }

  async function cuenta(tabla: string, columna: string, valor: string): Promise<number> {
    const { count, error } = await serviceClient
      .from(tabla as never)
      .select('id', { count: 'exact', head: true })
      .eq(columna, valor)
    expect(error).toBeNull()
    return count ?? 0
  }

  async function copias(tabla: string, id: string): Promise<number> {
    const { count, error } = await serviceClient
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('tabla', tabla)
      .eq('registro_id', id)
    expect(error).toBeNull()
    return count ?? 0
  }

  async function firmasVencidas(): Promise<string[]> {
    const { data, error } = await serviceClient.rpc('firmas_vencidas', { p_anios: 5 })
    expect(error).toBeNull()
    return (data ?? []).filter((v) => v.centro_id === centro.id).map((v) => v.nino_id)
  }

  async function cuentasVencidas(): Promise<string[]> {
    const { data, error } = await serviceClient.rpc('cuentas_vencidas', { p_anios: 5 })
    expect(error).toBeNull()
    return (data ?? [])
      .filter((v) => v.centro_id === centro.id)
      .map((v) => v.usuario_id)
      .sort()
  }

  async function destruir(): Promise<Record<string, number> | null> {
    const { data, error } = await serviceClient.rpc('destruir_firmas_nino', {
      p_nino_id: inigo,
      p_anios: 5,
    })
    expect(error).toBeNull()
    return data as Record<string, number> | null
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Retencion Firmas Cuenta')
    admin = await createTestUser({ nombre: 'Admin Retencion Firmas Cuenta' })
    madre = await createTestUser({ nombre: 'Madre Retencion Firmas Cuenta' })
    padre = await createTestUser({ nombre: 'Padre Retencion Firmas Cuenta' })
    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(madre.id, centro.id, 'tutor_legal')
    await asignarRol(padre.id, centro.id, 'tutor_legal')

    const a = await createTestNino(centro.id, 'Íñigo')
    inigo = a.id
    familia = a.familia_id
    bea = (await createTestNino(centro.id, 'Bea')).id
    const h = await serviceClient.from('ninos').update({ familia_id: familia }).eq('id', bea)
    expect(h.error).toBeNull()
    await crearFamiliaTutor(familia, madre.id, 'titular')
    await crearFamiliaTutor(familia, padre.id, 'segundo_tutor')
    await crearVinculo(inigo, padre.id, 'tutor_legal_secundario')

    // Lo que se conserva de Íñigo.
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
    autorizacion = aut!.id
    const firmas = await serviceClient
      .from('firmas_autorizacion')
      .insert(
        [madre, padre].map((u, i) => ({
          autorizacion_id: autorizacion,
          nino_id: inigo,
          firmante_id: u.id,
          rol_firmante:
            i === 0 ? ('tutor_legal_principal' as const) : ('tutor_legal_secundario' as const),
          decision: 'firmado' as const,
          texto_hash: 'a'.repeat(64),
          texto_version: 'v1',
          nombre_tecleado: 'Tutor Retencion Firmas Cuenta',
          firma_imagen: '<svg></svg>',
        }))
      )
      .select('id, firmante_id')
    expect(firmas.error).toBeNull()
    firmaMadre = firmas.data!.find((f) => f.firmante_id === madre.id)!.id
    firmaPadre = firmas.data!.find((f) => f.firmante_id === padre.id)!.id
    const am = await serviceClient.from('administraciones_medicacion').insert({
      autorizacion_id: autorizacion,
      nino_id: inigo,
      centro_id: centro.id,
      administrado_por: admin.id,
      medicamento: 'Apiretal',
      dosis: '2 ml',
    })
    expect(am.error).toBeNull()
    const co = await serviceClient
      .from('consentimientos')
      .insert([
        { usuario_id: madre.id, nino_id: inigo, tipo: 'privacidad' as const, version: 'v1' },
        { usuario_id: madre.id, nino_id: bea, tipo: 'privacidad' as const, version: 'v1' },
        // De la cuenta, sin niño: se va con la cuenta entera.
        { usuario_id: madre.id, nino_id: null, tipo: 'terminos' as const, version: 'v1' },
      ])
      .select('id, nino_id')
    expect(co.error).toBeNull()
    consentimientoBea = co.data!.find((c) => c.nino_id === bea)!.id
    const ac = await serviceClient
      .from('acuses_alta')
      .insert({ nino_id: inigo, centro_id: centro.id, tipo: 'normas', firmante_id: madre.id })
    expect(ac.error).toBeNull()
    const { data: ev, error: eErr } = await serviceClient
      .from('eventos')
      .insert({
        centro_id: centro.id,
        ambito: 'nino',
        nino_id: inigo,
        tipo: 'excursion',
        titulo: 'Salida Íñigo',
        fecha: '1989-06-01',
        creado_por: admin.id,
      })
      .select('id')
      .single()
    expect(eErr).toBeNull()
    evento = ev!.id
    const lec = await serviceClient.from('lecturas_ficha_medica').insert({
      centro_id: centro.id,
      nino_id: inigo,
      lector_id: admin.id,
      rol_lector: 'admin',
      origen: 'ficha',
    })
    expect(lec.error).toBeNull()
    const acc = await serviceClient.from('accesos_datos_bloqueados').insert({
      centro_id: centro.id,
      sujeto_tipo: 'nino',
      sujeto_id: inigo,
      lector_id: admin.id,
      motivo_tipo: 'juzgado',
      motivo: MOTIVO,
      accion: 'ver',
      apartados: ['firmas'],
    })
    expect(acc.error).toBeNull()

    // De baja en 1990, y su expediente purgado por plazo.
    const b = await serviceClient
      .from('ninos')
      .update({ deleted_at: BAJA, deleted_reason: 'baja_nino' })
      .eq('id', inigo)
    expect(b.error).toBeNull()
    const p = await serviceClient.rpc('purgar_expediente_nino', { p_nino_id: inigo, p_anios: 5 })
    expect(p.error).toBeNull()
    expect(p.data).toBe(true)
  })

  afterAll(async () => {
    await serviceClient.from('retenciones').delete().eq('centro_id', centro.id)
    await serviceClient.from('olvido_solicitudes').delete().eq('centro_id', centro.id)
    await serviceClient.from('recibos').delete().eq('centro_id', centro.id)
    await deleteTestCentro(centro.id)
    for (const u of [admin, madre, padre]) await deleteTestUser(u.id)
  })

  it('premisa: Íñigo purgado y con todo lo conservado; Bea viva; nadie retenido', async () => {
    expect(await firmasVencidas()).toEqual([inigo])
    expect(await cuenta('firmas_autorizacion', 'nino_id', inigo)).toBe(2)
    expect(await cuenta('administraciones_medicacion', 'nino_id', inigo)).toBe(1)
    expect(await cuenta('consentimientos', 'nino_id', inigo)).toBe(1)
    expect(await cuenta('acuses_alta', 'nino_id', inigo)).toBe(1)
    expect(await cuenta('eventos', 'id', evento)).toBe(1)
    expect(await cuenta('accesos_datos_bloqueados', 'sujeto_id', inigo)).toBe(1)
    expect(await copias('firmas_autorizacion', firmaMadre)).toBeGreaterThan(0)
    expect(await cuenta('retenciones', 'centro_id', centro.id)).toBe(0)
  })

  it('las funciones del cron no las abre nadie con sesión, tampoco la titular', async () => {
    for (const u of [admin, madre]) {
      const c = await clientFor(u)
      for (const r of [
        await c.rpc('firmas_vencidas', { p_anios: 5 }),
        await c.rpc('destruir_firmas_nino', { p_nino_id: inigo, p_anios: 5 }),
        await c.rpc('cuentas_vencidas', { p_anios: 5 }),
        await c.rpc('abrir_purga_cuenta', {
          p_usuario_id: madre.id,
          p_centro_id: centro.id,
          p_anios: 5,
        }),
        await c.rpc('destruir_consentimientos_cuenta', { p_anios: 5, p_simular: true }),
      ]) {
        expect(r.error?.code).toBe('42501')
      }
    }
    expect(await cuenta('firmas_autorizacion', 'nino_id', inigo)).toBe(2)
  })

  it('Íñigo retenido: no se destruye nada suyo', async () => {
    await retener('nino', inigo)
    expect(await firmasVencidas()).toEqual([])
    expect(await destruir()).toBeNull()
    expect(await cuenta('firmas_autorizacion', 'nino_id', inigo)).toBe(2)
    expect(await cuenta('eventos', 'id', evento)).toBe(1)
    await soltar('nino', inigo)
  })

  it('el padre retenido: su firma y la autorización se quedan; lo demás se va, sin copia', async () => {
    await retener('usuario', padre.id)
    const r = await destruir()
    expect(r).toMatchObject({
      medicacion_administrada: 1,
      firmas: 1,
      acuses_alta: 1,
      consentimientos: 1,
      autorizaciones: 0,
      eventos: 1,
      accesos_nino: 0,
    })
    expect(await cuenta('firmas_autorizacion', 'id', firmaMadre)).toBe(0)
    expect(await copias('firmas_autorizacion', firmaMadre)).toBe(0)
    expect(await cuenta('firmas_autorizacion', 'id', firmaPadre)).toBe(1)
    expect(await copias('firmas_autorizacion', firmaPadre)).toBeGreaterThan(0)
    expect(await cuenta('autorizaciones', 'id', autorizacion)).toBe(1)
    expect(await cuenta('eventos', 'id', evento)).toBe(0)
    expect(await copias('eventos', evento)).toBe(0)
    // Le queda algo que mirar: el registro de accesos se queda.
    expect(await cuenta('accesos_datos_bloqueados', 'sujeto_id', inigo)).toBe(1)
    await soltar('usuario', padre.id)
  })

  it('libre: la firma del padre y la autorización se van; el registro espera a las lecturas', async () => {
    const r = await destruir()
    expect(r).toMatchObject({ firmas: 1, autorizaciones: 1, accesos_nino: 0 })
    expect(await cuenta('autorizaciones', 'id', autorizacion)).toBe(0)
    expect(await copias('autorizaciones', autorizacion)).toBe(0)
    expect(await cuenta('accesos_datos_bloqueados', 'sujeto_id', inigo)).toBe(1)
    // Mientras quede la lectura no hay nada más que destruir: el cron no lo vuelve a listar.
    expect(await firmasVencidas()).toEqual([])

    // La lectura vence (su plazo, de 60 meses): el registro ya no mira nada y se va.
    const d = await serviceClient.from('lecturas_ficha_medica').delete().eq('nino_id', inigo)
    expect(d.error).toBeNull()
    expect(await firmasVencidas()).toEqual([inigo])
    expect(await destruir()).toMatchObject({ accesos_nino: 1 })
    expect(await cuenta('accesos_datos_bloqueados', 'sujeto_id', inigo)).toBe(0)
    expect(await firmasVencidas()).toEqual([])
  })

  it('lo de Bea, viva, sigue entero', async () => {
    expect(await cuenta('consentimientos', 'id', consentimientoBea)).toBe(1)
  })

  it('la cuenta: con Bea viva no vence; con la baja de Bea, la madre y el padre sí', async () => {
    expect(await cuentasVencidas()).toEqual([])
    const b = await serviceClient
      .from('ninos')
      .update({ deleted_at: BAJA, deleted_reason: 'baja_nino' })
      .eq('id', bea)
    expect(b.error).toBeNull()
    expect(await cuentasVencidas()).toEqual([madre.id, padre.id].sort())
  })

  it('un rol de profe vivo, un recibo pendiente o la retención la frenan', async () => {
    await asignarRol(padre.id, centro.id, 'profe')
    expect(await cuentasVencidas()).toEqual([madre.id])
    const q = await serviceClient
      .from('roles_usuario')
      .update({ deleted_at: new Date().toISOString(), deleted_reason: 'salida_centro' })
      .eq('usuario_id', padre.id)
      .eq('rol', 'profe')
    expect(q.error).toBeNull()

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
    expect(await cuentasVencidas()).toEqual([])
    const dr = await serviceClient.from('recibos').delete().eq('id', rc!.id)
    expect(dr.error).toBeNull()

    await retener('usuario', madre.id)
    expect(await cuentasVencidas()).toEqual([padre.id])
    await soltar('usuario', madre.id)
    expect(await cuentasVencidas()).toEqual([madre.id, padre.id].sort())
  })

  it('la petición por plazo: una sola, sin la purga del olvido, con su etiqueta, sin volver a pendiente', async () => {
    const abrir = () =>
      serviceClient.rpc('abrir_purga_cuenta', {
        p_usuario_id: madre.id,
        p_centro_id: centro.id,
        p_anios: 5,
      })
    const a = await abrir()
    expect(a.error).toBeNull()
    const sol = a.data as string
    expect(sol).toBeTruthy()
    expect((await abrir()).data).toBe(sol)

    const { data: fila } = await serviceClient
      .from('olvido_solicitudes')
      .select('estado, por_plazo, pedida_por_centro, solicitado_por, purgado_en')
      .eq('id', sol)
      .single()
    expect(fila).toEqual({
      estado: 'confirmada',
      por_plazo: true,
      pedida_por_centro: true,
      solicitado_por: null,
      purgado_en: null,
    })

    const pend = await serviceClient.rpc('olvido_pendientes')
    expect(pend.error).toBeNull()
    expect((pend.data ?? []).map((p) => p.solicitud_id)).not.toContain(sol)

    const c = await clientFor(admin)
    const lista = await c.rpc('peticiones_olvido_centro', { p_centro_id: centro.id })
    expect(lista.error).toBeNull()
    expect(lista.data!.find((p) => p.id === sol)?.por_plazo).toBe(true)

    // Retenida: no vuelve a pendiente (nadie la pidió) y la purga no la coge.
    expect(await retener('usuario', madre.id)).toEqual({ puestas: 1, deshechas: [] })
    const { data: tras } = await serviceClient
      .from('olvido_solicitudes')
      .select('estado')
      .eq('id', sol)
      .single()
    expect(tras?.estado).toBe('confirmada')
    const pr = await serviceClient.rpc('purgar_sujeto_db', { p_solicitud_id: sol })
    expect(pr.error?.code).toBe('55000')
    expect(pr.error?.hint).toBe('retenido')
    await soltar('usuario', madre.id)

    // Entre abrir y purgar le dan un rol: la purga lo vuelve a mirar.
    await asignarRol(madre.id, centro.id, 'profe')
    const pp = await serviceClient.rpc('purgar_sujeto_db', { p_solicitud_id: sol })
    expect(pp.error?.code).toBe('55000')
    expect(pp.error?.hint).toBe('plazo')
    const q = await serviceClient
      .from('roles_usuario')
      .update({ deleted_at: new Date().toISOString(), deleted_reason: 'salida_centro' })
      .eq('usuario_id', madre.id)
      .eq('rol', 'profe')
    expect(q.error).toBeNull()

    // Una petición por plazo pendiente no puede existir.
    const mal = await serviceClient.from('olvido_solicitudes').insert({
      sujeto_tipo: 'usuario',
      sujeto_id: padre.id,
      centro_id: centro.id,
      estado: 'pendiente',
      pedida_por_centro: true,
      por_plazo: true,
    })
    expect(mal.error?.code).toBe('23514')

    // Purgada: la cuenta queda olvidada, deja de estar vencida y su consentimiento de cuenta se va.
    const ok = await serviceClient.rpc('purgar_sujeto_db', { p_solicitud_id: sol })
    expect(ok.error).toBeNull()
    const { data: u } = await serviceClient
      .from('usuarios')
      .select('nombre_completo')
      .eq('id', madre.id)
      .single()
    expect(u?.nombre_completo).toBe('[borrado]')
    expect(await cuentasVencidas()).toEqual([padre.id])

    const sim = await serviceClient.rpc('destruir_consentimientos_cuenta', {
      p_anios: 5,
      p_simular: true,
    })
    expect(sim.error).toBeNull()
    expect(sim.data).toBeGreaterThanOrEqual(1)
    const real = await serviceClient.rpc('destruir_consentimientos_cuenta', {
      p_anios: 5,
      p_simular: false,
    })
    expect(real.error).toBeNull()
    const { count } = await serviceClient
      .from('consentimientos')
      .select('id', { count: 'exact', head: true })
      .eq('usuario_id', madre.id)
      .is('nino_id', null)
    expect(count).toBe(0)
    // El de Bea es de un niño: espera a las firmas de Bea, no a la cuenta.
    expect(await cuenta('consentimientos', 'id', consentimientoBea)).toBe(1)
  })
})
