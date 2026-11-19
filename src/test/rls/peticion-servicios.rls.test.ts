import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hoyMadrid } from '@/features/agenda-diaria/lib/fecha'
import { filasServicios } from '@/features/peticion-servicios/lib/peticion'
import { centroOfreceServicios } from '@/features/peticion-servicios/queries/leer-peticion-servicios'
import type { Database } from '@/types/db'

import { comoPostgres } from './documentos-centro-fixture'
import { dejarListaParaCerrar, firmarFichaDeFixture } from './ficha-para-cerrar'
import {
  asignarRol,
  clientFor,
  completarDatosAlta,
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

type Cliente = SupabaseClient<Database>

/**
 * Fase 8b — la petición de servicios del alta (`20270122120000` y `20270122130000`; spec
 * `docs/specs/altas-serie.md`, «8b»). Decidido el 2026-11-14:
 *
 *  - una fila por servicio que el centro tenga en Cuotas, con No / Todos los meses / Días sueltos,
 *    y solo las opciones que existen, con el precio del concepto; la petición guarda el concepto;
 *  - es una PETICIÓN: la familia nunca escribe en la facturación;
 *  - contestar cada fila es obligatorio para cerrar el alta, también en la base;
 *  - Dirección la ve al validar, la corrige y no le bloquea; validar aplica las mensuales desde el
 *    día 1 del mes siguiente al de la incorporación (el mes de entrada va por días, por el parte);
 *  - después del alta, por la cola: una mensual nueva, desde el día 1 del mes siguiente a
 *    aplicarla; una que se quita, hasta el último día del mes en curso;
 *  - la profe ve en su pase quién tiene la mensual; sale en el export y se purga con el niño.
 *
 * Fixtures ficticios. Los recibos de la validación se generan para septiembre del año que viene,
 * antes de la incorporación (se cobra por adelantado); los de la cola, contra hoy en Madrid.
 */

const COMEDOR_MENSUAL = 15_000
const COMEDOR_5 = 17_500
const COMEDOR_DIA = 1_200
const MATINERA_DIA = 500
const ANIO = Number(hoyMadrid().slice(0, 4)) + 1
const SEPT = (dia: number) => `${ANIO}-09-${String(dia).padStart(2, '0')}`

/** El día 1 del mes siguiente, y el último del mes, de una fecha `AAAA-MM-DD`. */
function mesSiguiente(dia: string): string {
  const [a, m] = dia.split('-').map(Number) as [number, number]
  return m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, '0')}-01`
}
function finDeMes(dia: string): string {
  const s = mesSiguiente(dia)
  const d = new Date(`${s}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

describe('La petición de servicios del alta (8b)', () => {
  let centro: { id: string }
  let otro: { id: string }
  /** Un tercer centro, solo para tener un concepto de servicio que no es del de la familia. */
  let ajeno: { id: string }
  let curso: { id: string }
  let aula: { id: string }
  let admin: TestUser
  let madre: TestUser
  let tio: TestUser
  let profe: TestUser
  let adminOtro: TestUser
  const s = {} as Record<'admin' | 'madre' | 'tio' | 'profe' | 'adminOtro', Cliente>
  const c: Record<string, string> = {}

  async function concepto(clave: string, centroId: string, fila: Record<string, unknown>) {
    const { data, error } = await serviceClient
      .from('conceptos_cobro')
      .insert({
        centro_id: centroId,
        tipo_concepto: 'mensual',
        tipo_valor: 'fijo',
        signo: 1,
        ambito: 'nino',
        aplicacion: 'manual',
        ...fila,
      } as never)
      .select('id')
      .single()
    if (error || !data) throw new Error(`concepto ${clave}: ${error?.message}`)
    c[clave] = data.id
  }

  /** Un niño de la familia de la madre, con su alta pendiente y completa salvo los servicios. */
  async function ninoEnAlta(nombre: string) {
    const n = await createTestNino(centro.id, nombre)
    await matricular(n.id, aula.id, curso.id)
    await crearVinculo(n.id, madre.id, 'tutor_legal_principal')
    await crearVinculo(n.id, tio.id, 'autorizado')
    await completarDatosAlta(n.id)
    for (const u of [madre, admin]) {
      const { error } = await serviceClient.from('consentimientos').insert({
        usuario_id: u.id,
        tipo: 'datos_medicos',
        version: 'v2.0',
        metodo_firma: 'digital',
        nino_id: n.id,
      })
      if (error) throw new Error(`acuse: ${error.message}`)
    }
    // La matrícula pendiente: lo que hay antes de cerrar el alta. (Ya trae una fecha de
    // incorporación de test; validar la pone de verdad.)
    const m = await serviceClient
      .from('matriculas')
      .update({ estado: 'pendiente' })
      .eq('nino_id', n.id)
    if (m.error) throw new Error(m.error.message)
    return n.id
  }

  const resp = (servicio: string, respuesta: string, concepto: string | null) => ({
    servicio,
    respuesta,
    concepto_id: concepto,
  })
  const guardar = (quien: keyof typeof s, nino: string, r: ReturnType<typeof resp>[]) =>
    s[quien].rpc('guardar_peticion_servicios', { p_nino_id: nino, p_respuestas: r })
  const estado = async (nino: string) =>
    (await serviceClient.from('matriculas').select('estado').eq('nino_id', nino).single()).data
      ?.estado
  const asignaciones = async (nino: string) =>
    (
      await serviceClient
        .from('asignacion_concepto')
        .select(
          'concepto_id, vigencia_desde, vigencia_hasta, deleted_at, origen, conceptos_cobro(nombre)'
        )
        .eq('nino_id', nino)
        .order('created_at')
    ).data ?? []
  const vivas = async (nino: string) => (await asignaciones(nino)).filter((a) => !a.deleted_at)
  // Si un aserto sobre las vivas cae, el log dice qué concepto es cada fila (el nombre, leído de la
  // base, no deducido del id): [valor, mensaje] para expect(...).
  type Viva = Awaited<ReturnType<typeof vivas>>[number]
  const vivasCon = async <T>(nino: string, f: (a: Viva) => T) => {
    const v = await vivas(nino)
    const leyenda = v.map((a) => `${a.conceptos_cobro?.nombre ?? '?'} = ${a.concepto_id}`)
    return [v.map(f), `vivas: ${leyenda.join('; ') || 'ninguna'}`] as const
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Servicios 8b')
    otro = await createTestCentro('Centro Sin Servicios 8b')
    ajeno = await createTestCentro('Centro Ajeno 8b')
    curso = await createTestCurso(centro.id, 'activo')
    aula = await createTestAula(centro.id, curso.id)
    admin = await createTestUser({ nombre: 'Admin 8b' })
    madre = await createTestUser({ nombre: 'Madre 8b' })
    tio = await createTestUser({ nombre: 'Tío 8b' })
    profe = await createTestUser({ nombre: 'Profe 8b' })
    adminOtro = await createTestUser({ nombre: 'Admin Otro 8b' })
    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(profe.id, centro.id, 'profe')
    await asignarRol(adminOtro.id, otro.id, 'admin')
    const pa = await serviceClient.from('profes_aulas').insert({
      profe_id: profe.id,
      aula_id: aula.id,
      curso_academico_id: curso.id,
      tipo_personal_aula: 'profesora',
    } as never)
    if (pa.error) throw new Error(`profe del aula: ${pa.error.message}`)

    // Lo que ofrece el centro: comedor con dos mensuales (3 y 5 días) y su diario; matinera solo
    // diario. Lo que NO se ofrece: la escolaridad (sin servicio), un descuento con servicio, una
    // mensual automática y una desactivada. Vespertina, nada.
    await concepto('comedor3', centro.id, {
      nombre: 'Comedor 3 días',
      servicio: 'comedor',
      importe_centimos: COMEDOR_MENSUAL,
    })
    await concepto('comedor5', centro.id, {
      nombre: 'Comedor 5 días',
      servicio: 'comedor',
      importe_centimos: COMEDOR_5,
    })
    await concepto('comedorDia', centro.id, {
      nombre: 'Comedor día',
      tipo_concepto: 'diario',
      servicio: 'comedor',
      importe_centimos: COMEDOR_DIA,
      aplicacion: 'automatico',
    })
    await concepto('matineraDia', centro.id, {
      nombre: 'Matinera día',
      tipo_concepto: 'diario',
      servicio: 'matinera',
      importe_centimos: MATINERA_DIA,
      aplicacion: 'automatico',
    })
    await concepto('escolaridad', centro.id, { nombre: 'Escolaridad 8b', importe_centimos: 40_000 })
    // Un descuento con servicio solo puede ser diario (CHECK `conceptos_cobro_modelo_valor`: una
    // mensual con servicio es de cobro, fija y por niño), y un diario es automático.
    await concepto('dtoComedor', centro.id, {
      nombre: 'Descuento comedor',
      tipo_concepto: 'diario',
      aplicacion: 'automatico',
      servicio: 'comedor',
      signo: -1,
      importe_centimos: 1_000,
    })
    await concepto('comedorAuto', centro.id, {
      nombre: 'Comedor automático',
      servicio: 'comedor',
      aplicacion: 'automatico',
      importe_centimos: 9_000,
    })
    await concepto('comedorApagado', centro.id, {
      nombre: 'Comedor apagado',
      servicio: 'comedor',
      importe_centimos: 9_000,
      activo: false,
    })
    await concepto('otroComedor', ajeno.id, {
      nombre: 'Comedor de otro centro',
      servicio: 'comedor',
      importe_centimos: 9_000,
    })

    s.admin = await clientFor(admin)
    s.madre = await clientFor(madre)
    s.tio = await clientFor(tio)
    s.profe = await clientFor(profe)
    s.adminOtro = await clientFor(adminOtro)
  }, 120_000)

  afterAll(async () => {
    for (const id of [centro?.id, otro?.id, ajeno?.id].filter(Boolean) as string[]) {
      await serviceClient.from('lineas_recibo').delete().eq('centro_id', id)
      await serviceClient.from('recibos').delete().eq('centro_id', id)
      await serviceClient.from('parte_servicio_diario').delete().eq('centro_id', id)
      await serviceClient.from('cambios_pendientes').delete().eq('centro_id', id)
      await serviceClient.from('peticion_servicio').delete().eq('centro_id', id)
      await serviceClient.from('asignacion_concepto').delete().eq('centro_id', id)
      await serviceClient.from('conceptos_cobro').delete().eq('centro_id', id)
      await deleteTestCentro(id)
    }
    for (const u of [admin, madre, tio, profe, adminOtro]) if (u) await deleteTestUser(u.id)
  }, 90_000)

  it('lo que se ofrece: solo las opciones que existen, con su precio, y nada más', async () => {
    const n = await ninoEnAlta('Ofrece')
    const { data, error } = await s.madre.rpc('servicios_alta', { p_nino_id: n })
    expect(error).toBeNull()
    expect(
      (data ?? []).map((o) => [o.servicio, o.tipo_concepto, o.concepto_id, o.importe_centimos])
    ).toEqual([
      ['comedor', 'mensual', c.comedor3, COMEDOR_MENSUAL],
      ['comedor', 'mensual', c.comedor5, COMEDOR_5],
      ['comedor', 'diario', c.comedorDia, COMEDOR_DIA],
      ['matinera', 'diario', c.matineraDia, MATINERA_DIA],
    ])
    // Matinera solo tiene diario: su fila no ofrece «todos los meses». Vespertina no sale.
    const filas = filasServicios(
      (data ?? []).map((o) => ({
        conceptoId: o.concepto_id,
        servicio: o.servicio,
        tipo: o.tipo_concepto as 'mensual' | 'diario',
        nombre: o.nombre,
        importeCentimos: o.importe_centimos,
      }))
    )
    expect(filas.map((f) => [f.servicio, f.mensuales.length, f.diarios.length])).toEqual([
      ['comedor', 2, 1],
      ['matinera', 0, 1],
    ])
    // Dirección del centro lo ve; el autorizado, la profe y la Dirección de otro centro, no.
    expect((await s.admin.rpc('servicios_alta', { p_nino_id: n })).data).toHaveLength(4)
    for (const q of ['tio', 'profe', 'adminOtro'] as const)
      expect.soft((await s[q].rpc('servicios_alta', { p_nino_id: n })).error?.code, q).toBe('42501')
  })

  it('el precio de una tarifa por año es el del año del niño', async () => {
    const n = await ninoEnAlta('Tarifa')
    const { data: nino } = await serviceClient
      .from('ninos')
      .select('fecha_nacimiento')
      .eq('id', n)
      .single()
    expect(nino?.fecha_nacimiento).toMatch(/^\d{4}-/) // premisa: el niño tiene año
    const anio = Number((nino?.fecha_nacimiento ?? '').slice(0, 4))
    await concepto('comedorTarifa', centro.id, {
      nombre: 'Comedor por edad',
      servicio: 'comedor',
      importe_centimos: 10_000,
      tarifa_por_anio_nacimiento: true,
    })
    const t = await serviceClient.from('tarifa_concepto_anio').insert({
      concepto_id: c.comedorTarifa!,
      centro_id: centro.id,
      anio_nacimiento: anio,
      importe_centimos: 12_345,
    })
    expect(t.error).toBeNull()
    const { data } = await s.madre.rpc('servicios_alta', { p_nino_id: n })
    expect(data?.find((o) => o.concepto_id === c.comedorTarifa)?.importe_centimos).toBe(12_345)
    const off = await serviceClient
      .from('conceptos_cobro')
      .update({ activo: false })
      .eq('id', c.comedorTarifa!)
    expect(off.error).toBeNull()
  })

  it('la invitación cuenta los pasos con la misma regla que la base', async () => {
    const n = await ninoEnAlta('Cuenta')
    // La base, de verdad, como postgres: hay algo que ofrecer en un centro y nada en el otro.
    const otroNino = await createTestNino(otro.id, 'Sin servicios')
    const base = (id: string) =>
      Number(comoPostgres(`SELECT count(*) FROM privado.servicios_ofrecidos('${id}')`))
    expect(base(n)).toBeGreaterThan(0)
    expect(base(otroNino.id)).toBe(0)
    expect(await centroOfreceServicios(serviceClient, centro.id)).toBe(true)
    expect(await centroOfreceServicios(serviceClient, otro.id)).toBe(false)
  })

  it('la familia guarda la petición; nadie más, y nunca una opción que no se ofrece', async () => {
    const n = await ninoEnAlta('Guarda')
    // El autorizado, la profe y otra Dirección: 42501.
    for (const q of ['tio', 'profe', 'adminOtro'] as const)
      expect.soft((await guardar(q, n, [resp('comedor', 'no', null)])).error?.code, q).toBe('42501')
    // Una opción que no existe, de cuatro maneras: el diario como mensual, un concepto de otro
    // centro, un descuento, una mensual automática, una apagada y un servicio sin conceptos.
    for (const [que, r] of [
      ['diario como mensual', resp('comedor', 'mensual', c.comedorDia!)],
      ['de otro centro', resp('comedor', 'mensual', c.otroComedor!)],
      ['descuento', resp('comedor', 'dias_sueltos', c.dtoComedor!)],
      ['automática', resp('comedor', 'mensual', c.comedorAuto!)],
      ['apagada', resp('comedor', 'mensual', c.comedorApagado!)],
      ['sin conceptos', resp('vespertina', 'no', null)],
    ] as const)
      expect.soft((await guardar('madre', n, [r])).error?.hint, que).toBe('opcion_no_ofrecida')
    // Directa a la tabla, ni con su sesión.
    const directa = await s.madre
      .from('peticion_servicio')
      .insert({ centro_id: centro.id, nino_id: n, servicio: 'comedor', respuesta: 'no' })
    expect(directa.error?.code).toBe('42501')
    // Premisa del rechazo: hasta aquí no hay nada guardado.
    expect(
      (await serviceClient.from('peticion_servicio').select('id').eq('nino_id', n)).data
    ).toEqual([])

    const ok = await guardar('madre', n, [
      resp('comedor', 'mensual', c.comedor5!),
      resp('matinera', 'dias_sueltos', c.matineraDia!),
    ])
    expect(ok.error).toBeNull()
    expect(ok.data).toBe(2)
    // La lee la madre y la Dirección; el autorizado y la profe, no (la profe, en su pase).
    for (const [q, n2] of [
      ['madre', 2],
      ['admin', 2],
      ['tio', 0],
      ['profe', 0],
    ] as const) {
      const { data } = await s[q].from('peticion_servicio').select('servicio').eq('nino_id', n)
      expect.soft(data ?? [], q).toHaveLength(n2)
    }
    // No escribe en la facturación.
    expect(await asignaciones(n)).toEqual([])
  })

  it('el trigger para un concepto que no casa, aunque escriba quien se salta las funciones', async () => {
    // Nadie escribe la tabla con su sesión; quien la escribe como definidor (las funciones, postgres)
    // pasa igual por el trigger. Control positivo delante: una fila que casa entra.
    const n = await ninoEnAlta('Trigger')
    comoPostgres(
      `INSERT INTO public.peticion_servicio (centro_id, nino_id, servicio, respuesta, concepto_id)
       VALUES ('${otro.id}', '${n}', 'comedor', 'mensual', '${c.comedor3}')`
    )
    const { data } = await serviceClient
      .from('peticion_servicio')
      .select('centro_id')
      .eq('nino_id', n)
      .single()
    expect(data?.centro_id).toBe(centro.id) // el centro lo pone el trigger, no quien escribe
    for (const [que, servicio, respuesta, concepto] of [
      ['otro servicio', 'matinera', 'mensual', c.comedor3],
      ['otro tipo', 'comedor', 'dias_sueltos', c.comedor3],
      ['otro centro', 'comedor', 'mensual', c.otroComedor],
    ] as const)
      expect(
        () =>
          comoPostgres(
            `UPDATE public.peticion_servicio SET servicio = '${servicio}', respuesta = '${respuesta}',
               concepto_id = '${concepto}' WHERE nino_id = '${n}'`
          ),
        que
      ).toThrow(/no casa con su concepto/)
  })

  it('cerrar el alta exige contestar cada servicio, en la base', async () => {
    const n = await ninoEnAlta('Cierra')
    const cierra = () => s.madre.rpc('marcar_matricula_lista', { p_nino_id: n })
    let r = await cierra()
    expect(r.error?.hint).toBe('servicios_por_contestar')
    expect(r.error?.message).toContain('comedor,matinera')
    await guardar('madre', n, [resp('comedor', 'no', null)])
    r = await cierra()
    expect(r.error?.hint).toBe('servicios_por_contestar')
    expect(await estado(n)).toBe('pendiente')
    await guardar('madre', n, [resp('matinera', 'no', null)])
    // 10b-3: el cierre exige también el libro, la ficha firmada y la respuesta de imagen.
    await dejarListaParaCerrar(n, madre.id)
    r = await cierra()
    expect(r.error).toBeNull()
    expect(await estado(n)).toBe('lista')
  })

  it('un centro sin conceptos de servicio no pide nada para cerrar', async () => {
    const curso2 = await createTestCurso(otro.id, 'activo')
    const aula2 = await createTestAula(otro.id, curso2.id)
    const n = (await createTestNino(otro.id, 'Sin servicios cierra')).id
    await matricular(n, aula2.id, curso2.id)
    await crearVinculo(n, madre.id, 'tutor_legal_principal')
    await completarDatosAlta(n)
    await serviceClient.from('consentimientos').insert({
      usuario_id: madre.id,
      tipo: 'datos_medicos',
      version: 'v2.0',
      metodo_firma: 'digital',
      nino_id: n,
    })
    await serviceClient.from('matriculas').update({ estado: 'pendiente' }).eq('nino_id', n)
    await dejarListaParaCerrar(n, madre.id)
    const r = await s.madre.rpc('marcar_matricula_lista', { p_nino_id: n })
    expect(r.error).toBeNull()
    expect(await estado(n)).toBe('lista')
  })

  it('validar: Dirección corrige, no le bloquea, y la mensual empieza el mes siguiente', async () => {
    const n = await ninoEnAlta('Valida')
    await guardar('madre', n, [
      resp('comedor', 'mensual', c.comedor3!),
      resp('matinera', 'dias_sueltos', c.matineraDia!),
    ])
    await dejarListaParaCerrar(n, madre.id)
    expect((await s.madre.rpc('marcar_matricula_lista', { p_nino_id: n })).error).toBeNull()
    // Dirección corrige antes de validar: el de 5 días. Queda a su nombre en la auditoría.
    const corrige = await guardar('admin', n, [resp('comedor', 'mensual', c.comedor5!)])
    expect(corrige.data).toBe(1)
    const { data: fila } = await serviceClient
      .from('peticion_servicio')
      .select('id')
      .eq('nino_id', n)
      .eq('servicio', 'comedor')
      .single()
    const audit = await serviceClient
      .from('audit_log')
      .select('accion, usuario_id')
      .eq('tabla', 'peticion_servicio')
      .eq('registro_id', fila!.id)
      .eq('accion', 'UPDATE')
    expect(audit.data).toEqual([{ accion: 'UPDATE', usuario_id: admin.id }])
    // Lo que pidió la familia está en la ficha firmada: la corrección de Dirección invalida la firma
    // (10b, «un cambio entre firmar y validar INVALIDA la firma»), y la familia vuelve a firmar.
    firmarFichaDeFixture(n, madre.id)

    const { data: mat } = await serviceClient
      .from('matriculas')
      .select('id')
      .eq('nino_id', n)
      .single()
    const v = await s.admin.rpc('validar_alta', {
      p_matricula_id: mat!.id,
      p_fecha_incorporacion: SEPT(15),
    })
    expect(v.error).toBeNull()
    expect(await estado(n)).toBe('activa')
    // Una sola asignación, la corregida, desde el día 1 del mes siguiente; días sueltos, nada.
    expect(
      ...(await vivasCon(n, (a) => [a.concepto_id, a.vigencia_desde, a.vigencia_hasta, a.origen]))
    ).toEqual([[c.comedor5, `${ANIO}-10-01`, null, 'manual']])
    // Con la petición ya validada, la familia no la toca: va por la cola.
    expect((await guardar('madre', n, [resp('comedor', 'no', null)])).error?.hint).toBe(
      'alta_validada'
    )

    // Septiembre: los días del parte, sin mensual. Octubre: la mensual.
    await serviceClient.from('asignacion_concepto').insert({
      centro_id: centro.id,
      nino_id: n,
      concepto_id: c.comedorDia!,
      origen: 'automatico',
    })
    const parte = await serviceClient.from('parte_servicio_diario').insert(
      [SEPT(15), SEPT(16)].map((fecha) => ({
        centro_id: centro.id,
        nino_id: n,
        fecha,
        servicio: 'comedor' as const,
        presente: true,
      }))
    )
    expect(parte.error).toBeNull()
    for (const mes of [9, 10]) {
      const g = await s.admin.rpc('generar_recibos_mes', {
        p_centro_id: centro.id,
        p_anio: ANIO,
        p_mes: mes,
      })
      expect(g.error).toBeNull()
    }
    const lineas = async (mes: number) => {
      const r = await serviceClient
        .from('recibos')
        .select('id')
        .eq('centro_id', centro.id)
        .eq('anio', ANIO)
        .eq('mes', mes)
        .eq('es_esporadico', false)
      const { data } = await serviceClient
        .from('lineas_recibo')
        .select('concepto_id, importe_centimos')
        .eq('nino_id', n)
        .in(
          'recibo_id',
          (r.data ?? []).map((x) => x.id)
        )
      return (data ?? []).filter((l) => [c.comedor5, c.comedorDia].includes(l.concepto_id!))
    }
    expect(await lineas(9)).toEqual([
      { concepto_id: c.comedorDia, importe_centimos: 2 * COMEDOR_DIA },
    ])
    expect(await lineas(10)).toEqual([{ concepto_id: c.comedor5, importe_centimos: COMEDOR_5 }])
  })

  it('validar sin la petición contestada no bloquea, y no pone nada', async () => {
    const n = await ninoEnAlta('Sin petición')
    // Un alta de antes de la 8b: se cierra como postgres, sin pasar por la regla nueva.
    const m = await serviceClient.from('matriculas').update({ estado: 'lista' }).eq('nino_id', n)
    expect(m.error).toBeNull()
    // 10b-3: validar exige la ficha firmada.
    firmarFichaDeFixture(n, madre.id)
    const { data: mat } = await serviceClient
      .from('matriculas')
      .select('id')
      .eq('nino_id', n)
      .single()
    const v = await s.admin.rpc('validar_alta', {
      p_matricula_id: mat!.id,
      p_fecha_incorporacion: SEPT(15),
    })
    expect(v.error).toBeNull()
    expect(v.data).toBe(mat!.id)
    expect(await asignaciones(n)).toEqual([])
  })

  describe('después del alta, por la cola', () => {
    let n: string
    const hoy = hoyMadrid()
    const aplicar = (quien: keyof typeof s, r: ReturnType<typeof resp>[]) =>
      s[quien].rpc('aplicar_peticion_servicios', { p_nino_id: n, p_respuestas: r })

    beforeAll(async () => {
      // Validado e incorporado hace tiempo: lo que manda es hoy.
      n = await ninoEnAlta('Cola')
      await serviceClient.from('matriculas').update({ estado: 'activa' }).eq('nino_id', n)
    })

    it('la familia encola; Dirección aplica; nadie más', async () => {
      const cola = await s.madre.from('cambios_pendientes').insert({
        centro_id: centro.id,
        nino_id: n,
        entidad: 'peticion_servicios',
        registro_id: n,
        payload: { respuestas: [resp('comedor', 'mensual', c.comedor3!)] },
        solicitado_por: madre.id,
      })
      expect(cola.error).toBeNull()
      for (const q of ['madre', 'tio', 'profe', 'adminOtro'] as const)
        expect
          .soft((await aplicar(q, [resp('comedor', 'mensual', c.comedor3!)])).error?.code, q)
          .toBe('42501')
      expect(await asignaciones(n)).toEqual([])
    })

    it('una mensual nueva empieza el día 1 del mes siguiente a aplicarla', async () => {
      expect((await aplicar('admin', [resp('comedor', 'mensual', c.comedor3!)])).error).toBeNull()
      expect(
        ...(await vivasCon(n, (a) => [a.concepto_id, a.vigencia_desde, a.vigencia_hasta]))
      ).toEqual([[c.comedor3, mesSiguiente(hoy), null]])
    })

    it('la que se quita termina el último día del mes en curso; si aún no empezó, se borra', async () => {
      // La de este mes: empezó (se adelanta para medirlo) y termina a fin de mes.
      await serviceClient
        .from('asignacion_concepto')
        .update({ vigencia_desde: `${hoy.slice(0, 7)}-01` })
        .eq('nino_id', n)
        .eq('concepto_id', c.comedor3!)
      expect((await aplicar('admin', [resp('comedor', 'no', null)])).error).toBeNull()
      expect(...(await vivasCon(n, (a) => [a.concepto_id, a.vigencia_hasta]))).toEqual([
        [c.comedor3, finDeMes(hoy)],
      ])
      // Volver a pedirla seguida: la misma fila, otra vez sin fin.
      expect((await aplicar('admin', [resp('comedor', 'mensual', c.comedor3!)])).error).toBeNull()
      expect(...(await vivasCon(n, (a) => [a.concepto_id, a.vigencia_hasta]))).toEqual([
        [c.comedor3, null],
      ])
      // Cambiar a la de 5 días: la de 3 termina a fin de mes, la de 5 empieza el mes siguiente.
      expect((await aplicar('admin', [resp('comedor', 'mensual', c.comedor5!)])).error).toBeNull()
      expect(
        ...(await vivasCon(n, (a) => [a.concepto_id, a.vigencia_desde, a.vigencia_hasta]))
      ).toEqual([
        [c.comedor3, `${hoy.slice(0, 7)}-01`, finDeMes(hoy)],
        [c.comedor5, mesSiguiente(hoy), null],
      ])
      // Quitar la de 5, que aún no ha empezado: se borra.
      expect((await aplicar('admin', [resp('comedor', 'no', null)])).error).toBeNull()
      expect(...(await vivasCon(n, (a) => a.concepto_id))).toEqual([c.comedor3])
      const peticion = await serviceClient
        .from('peticion_servicio')
        .select('respuesta')
        .eq('nino_id', n)
        .eq('servicio', 'comedor')
        .single()
      expect(peticion.data?.respuesta).toBe('no')
    })

    it('volver a pedir con un hueco: si la vieja tiene un borrador, para; si no, otra fila', async () => {
      // La de 3 terminó hace meses (enero de este año), con un recibo en borrador de enero.
      const enero = `${hoy.slice(0, 4)}-01-31`
      await serviceClient
        .from('asignacion_concepto')
        .update({ vigencia_desde: `${hoy.slice(0, 4)}-01-01`, vigencia_hasta: enero })
        .eq('nino_id', n)
        .eq('concepto_id', c.comedor3!)
        .is('deleted_at', null)
      const { data: nino } = await serviceClient
        .from('ninos')
        .select('familia_id')
        .eq('id', n)
        .single()
      const rec = await serviceClient
        .from('recibos')
        .insert({
          centro_id: centro.id,
          familia_id: nino!.familia_id,
          anio: Number(hoy.slice(0, 4)),
          mes: 1,
          estado: 'borrador',
        } as never)
        .select('id')
        .single()
      expect(rec.error).toBeNull()
      // Premisa: hay hueco entre el fin de la vieja (31 de enero) y el inicio de la nueva (el día 1
      // del mes siguiente a hoy). Solo no lo hay si hoy es enero.
      expect(mesSiguiente(hoy) > mesSiguiente(enero)).toBe(true)
      const para = await aplicar('admin', [resp('comedor', 'mensual', c.comedor3!)])
      expect(para.error?.hint).toBe('mensual_anterior_en_borrador')
      await serviceClient.from('recibos').delete().eq('id', rec.data!.id)
      expect((await aplicar('admin', [resp('comedor', 'mensual', c.comedor3!)])).error).toBeNull()
      const todas = (await asignaciones(n)).filter((a) => a.concepto_id === c.comedor3)
      expect(
        todas.filter((a) => !a.deleted_at).map((a) => [a.vigencia_desde, a.vigencia_hasta])
      ).toEqual([[mesSiguiente(hoy), null]])
      expect(todas.filter((a) => a.deleted_at).map((a) => a.vigencia_hasta)).toContain(enero)
    })

    it('la profe ve en su pase quién tiene la mensual ese día, y lo que pidió la familia', async () => {
      const { data, error } = await s.profe.rpc('listado_pase_servicios', {
        p_centro_id: centro.id,
        p_fecha: mesSiguiente(hoy),
      })
      expect(error).toBeNull()
      const fila = (data ?? []).find((r) => r.nino_id === n)
      expect(fila).toMatchObject({ mensuales: ['comedor'], pedidos: { comedor: 'mensual' } })
      // Hoy todavía no la tiene (empieza el mes siguiente).
      const hoyPase = await s.profe.rpc('listado_pase_servicios', {
        p_centro_id: centro.id,
        p_fecha: hoy,
      })
      expect((hoyPase.data ?? []).find((r) => r.nino_id === n)?.mensuales).toEqual([])
    })

    it('sale en el export del niño, y la purga del niño se la lleva', async () => {
      const { data, error } = await s.admin.rpc('export_datos_sujeto', {
        p_sujeto_tipo: 'nino',
        p_sujeto_id: n,
      })
      expect(error).toBeNull()
      const pedidos = (data as { servicios_pedidos?: unknown[] }).servicios_pedidos
      expect(pedidos).toEqual([
        expect.objectContaining({
          servicio: 'comedor',
          respuesta: 'mensual',
          concepto: 'Comedor 3 días',
        }),
      ])
      comoPostgres(`SELECT privado.purgar_nino('${n}')`)
      const queda = await serviceClient.from('peticion_servicio').select('id').eq('nino_id', n)
      expect(queda.data).toEqual([])
    })
  })
})
