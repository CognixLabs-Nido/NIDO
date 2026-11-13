import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Database } from '@/types/db'

import {
  asignarProfeAula,
  asignarRol,
  clientFor,
  completarDatosAlta,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestNino,
  createTestUser,
  crearFamiliaTutor,
  crearVinculo,
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestCentro,
  type TestUser,
} from './setup'

type Cliente = SupabaseClient<Database>
type Quien = 'titular' | 'segundo' | 'admin' | 'profe' | 'autorizado'

/**
 * Fase 6, paso 2 (`20270118120000`, 2026-11-13): los datos del tutor y su puerta. Medido ABIERTO en
 * producción antes (ensayos terminados en RAISE): con el alta validada, el tutor escribía directo
 * sus datos y los del otro tutor aunque tuviera cuenta; por el alta de un hermano sin validar, la app
 * no encolaba; el tutor 2 abría el DNI del tutor 1; la Dirección no podía exportar a un tutor sin
 * cuenta. Aquí, cerrado:
 *
 *  - UNA REGLA: mientras el tutor 2 no tiene cuenta, sus datos los gestiona el tutor 1; en cuanto la
 *    tiene, el tutor 1 deja de ver sus datos personales salvo el teléfono. La Dirección, todo.
 *  - La cola, en la base y POR FAMILIA (HINT `cola_validacion`).
 *  - El teléfono, también para la profe del aula; el autorizado, nada.
 *  - El cierre del alta exige los datos de los tutores (HINT `datos_tutor_por_completar`).
 *
 * Fixtures ficticios. Una familia F con dos hijos: Lucas (alta validada) y Mía (alta en curso).
 */
describe('Los datos del tutor y su puerta (fase 6, paso 2)', () => {
  let centro: TestCentro
  let familia: string
  let lucas: string
  let mia: string
  let filaSegundo: string
  const u = {} as Record<Quien, TestUser>
  const sesion = {} as Record<Quien, Cliente>

  const guardar = (
    quien: Quien,
    rol: 'titular' | 'segundo_tutor',
    datos: Record<string, unknown>
  ) =>
    sesion[quien].rpc('guardar_tutor', {
      p_familia_id: familia,
      p_rol_familia: rol,
      p_datos: datos as Database['public']['Functions']['guardar_tutor']['Args']['p_datos'],
    })
  const fila = async (rol: 'titular' | 'segundo_tutor') =>
    (
      await serviceClient
        .from('familia_tutores')
        .select('telefono, fecha_nacimiento, dni_numero, direccion_calle, nombre_completo, email')
        .eq('familia_id', familia)
        .eq('rol_familia', rol)
        .is('deleted_at', null)
        .single()
    ).data
  const estadoMatricula = async (nino: string, estado: 'activa' | 'pendiente') => {
    const { error } = await serviceClient.from('matriculas').update({ estado }).eq('nino_id', nino)
    if (error) throw new Error(error.message)
  }
  // Sin cuenta: lo que es el segundo tutor antes de aceptar la invitación (solo service_role la quita).
  const cuentaSegundo = async (usuario_id: string | null) => {
    const { error } = await serviceClient
      .from('familia_tutores')
      .update({ usuario_id })
      .eq('id', filaSegundo)
    if (error) throw new Error(error.message)
  }
  const COMPLETO = {
    nombre_completo: 'Nombre Completo Demo',
    email: 'tutor.demo@correo.test',
    telefono: '+34600000001',
    fecha_nacimiento: '1985-01-01',
    dni_numero: '12345678Z',
    direccion_calle: 'Calle Demo',
    direccion_cp: '46001',
    direccion_ciudad: 'Ciudad Demo',
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Puerta Tutores')
    const curso = (await createTestCurso(centro.id, 'activo')).id
    const aula = (await createTestAula(centro.id, curso)).id
    const otraAula = (await createTestAula(centro.id, curso)).id
    for (const q of ['titular', 'segundo', 'admin', 'profe', 'autorizado'] as Quien[])
      u[q] = await createTestUser({ nombre: `${q} Puerta Tutores` })
    const n = await createTestNino(centro.id, 'Lucas')
    lucas = n.id
    familia = n.familia_id
    const { data: m, error } = await serviceClient
      .from('ninos')
      .insert({
        centro_id: centro.id,
        familia_id: familia,
        nombre: 'Mía',
        primer_apellido: 'Apellido Test',
        fecha_nacimiento: '2025-01-10',
      })
      .select('id')
      .single()
    if (error || !m) throw new Error(`Mía: ${error?.message}`)
    mia = m.id
    await matricular(lucas, aula, curso)
    await matricular(mia, aula, curso)
    await estadoMatricula(mia, 'pendiente')
    await crearFamiliaTutor(familia, u.titular.id, 'titular')
    filaSegundo = await crearFamiliaTutor(familia, u.segundo.id, 'segundo_tutor')
    for (const nino of [lucas, mia]) {
      await crearVinculo(nino, u.titular.id, 'tutor_legal_principal')
      await crearVinculo(nino, u.segundo.id, 'tutor_legal_secundario')
      await crearVinculo(nino, u.autorizado.id, 'autorizado')
    }
    await asignarRol(u.admin.id, centro.id, 'admin')
    await asignarRol(u.profe.id, centro.id, 'profe')
    await asignarProfeAula(u.profe.id, aula, curso)
    void otraAula
    for (const q of Object.keys(u) as Quien[]) sesion[q] = await clientFor(u[q])
  }, 120_000)

  afterAll(async () => {
    if (centro) await deleteTestCentro(centro.id)
    for (const x of Object.values(u)) if (x) await deleteTestUser(x.id)
  })

  it('premisa: Lucas validado y Mía en curso, de la misma familia; los dos tutores con cuenta', async () => {
    const { data } = await serviceClient
      .from('matriculas')
      .select('nino_id, estado')
      .in('nino_id', [lucas, mia])
    expect(Object.fromEntries((data ?? []).map((r) => [r.nino_id, r.estado]))).toEqual({
      [lucas]: 'activa',
      [mia]: 'pendiente',
    })
    const { data: t } = await serviceClient
      .from('familia_tutores')
      .select('rol_familia, usuario_id')
      .eq('familia_id', familia)
      .order('rol_familia')
    expect(t).toEqual([
      { rol_familia: 'segundo_tutor', usuario_id: u.segundo.id },
      { rol_familia: 'titular', usuario_id: u.titular.id },
    ])
  })

  describe('la cola, en la base y por familia', () => {
    it('con un hijo validado, el cambio del tutor va a la cola aunque el otro hijo esté en alta', async () => {
      const { error } = await guardar('titular', 'titular', { direccion_calle: 'Calle Hermano' })
      expect(error?.code).toBe('42501')
      expect(error?.hint).toBe('cola_validacion')
      expect((await fila('titular'))?.direccion_calle).toBeNull()
    })

    it('mandar lo mismo no es un cambio: pasa sin escribir', async () => {
      const { error } = await guardar('titular', 'titular', { direccion_calle: null })
      expect(error).toBeNull()
    })

    it('la puerta de atrás está cerrada: el UPDATE directo del tutor no toca ninguna fila', async () => {
      const { data, error } = await sesion.titular
        .from('familia_tutores')
        .update({ direccion_calle: 'Directa' })
        .eq('familia_id', familia)
        .eq('rol_familia', 'titular')
        .select('id')
      expect(error).toBeNull()
      expect(data).toEqual([])
      expect((await fila('titular'))?.direccion_calle).toBeNull()
    })

    it('la Dirección escribe con el alta validada: es quien aprueba la cola', async () => {
      const { error } = await guardar('admin', 'titular', { direccion_calle: 'Calle Admin' })
      expect(error).toBeNull()
      expect((await fila('titular'))?.direccion_calle).toBe('Calle Admin')
    })
  })

  describe('la regla única', () => {
    it('con cuenta los dos, ninguno escribe los datos del otro', async () => {
      await estadoMatricula(lucas, 'pendiente')
      try {
        const a = await guardar('titular', 'segundo_tutor', { nombre_completo: 'Otro Nombre' })
        const b = await guardar('segundo', 'titular', { email: 'x@correo.test' })
        expect(a.error?.code).toBe('42501')
        expect(b.error?.code).toBe('42501')
        // Control positivo: cada uno, lo suyo.
        expect(
          (await guardar('segundo', 'segundo_tutor', { telefono: '611 22 33 44' })).error
        ).toBeNull()
        expect((await fila('segundo_tutor'))?.telefono).toBe('611223344')
      } finally {
        await estadoMatricula(lucas, 'activa')
      }
    })

    it('sin cuenta el segundo, el titular escribe y lee sus datos; con cuenta, solo ve su teléfono', async () => {
      await estadoMatricula(lucas, 'pendiente')
      await cuentaSegundo(null)
      try {
        const { error } = await guardar('titular', 'segundo_tutor', {
          dni_numero: '12345678Z',
          fecha_nacimiento: '1990-06-01',
        })
        expect(error).toBeNull()
        const { data: sin } = await sesion.titular.rpc('tutores_de_familia', {
          p_familia_id: familia,
        })
        expect(sin?.find((r) => r.rol_familia === 'segundo_tutor')).toMatchObject({
          ve_personales: true,
          dni_numero: '12345678Z',
          fecha_nacimiento: '1990-06-01',
        })
      } finally {
        await cuentaSegundo(u.segundo.id)
        await estadoMatricula(lucas, 'activa')
      }
      const { data: con } = await sesion.titular.rpc('tutores_de_familia', {
        p_familia_id: familia,
      })
      expect(con?.find((r) => r.rol_familia === 'segundo_tutor')).toMatchObject({
        ve_personales: false,
        ve_telefono: true,
        telefono: '611223344',
        dni_numero: null,
        fecha_nacimiento: null,
      })
      // Y el segundo ve los suyos.
      const { data: suyo } = await sesion.segundo.rpc('tutores_de_familia', {
        p_familia_id: familia,
      })
      expect(suyo?.find((r) => r.rol_familia === 'segundo_tutor')).toMatchObject({
        ve_personales: true,
        dni_numero: '12345678Z',
      })
    })
  })

  describe('las validaciones no dejan fuera a una familia real', () => {
    beforeAll(async () => estadoMatricula(lucas, 'pendiente'))
    afterAll(async () => estadoMatricula(lucas, 'activa'))

    const casos: [string, Record<string, unknown>, string | null][] = [
      ['teléfono internacional con 00 y guiones', { telefono: '0044 20-7946-0958' }, null],
      ['teléfono español sin prefijo', { telefono: '600 11 22 33' }, null],
      ['teléfono de 5 cifras', { telefono: '12345' }, '23514'],
      ['DNI con su letra', { dni_numero: '12345678Z' }, null],
      ['DNI con la letra mal', { dni_numero: '12345678A' }, '23514'],
      ['NIE con la letra mal', { dni_numero: 'X1234567A' }, '23514'],
      ['pasaporte extranjero', { dni_numero: 'P1234567' }, null],
      ['menor de edad', { fecha_nacimiento: '2012-05-01' }, null],
      ['1850', { fecha_nacimiento: '1850-01-01' }, '23514'],
      ['clave desconocida', { iban: 'ES00' }, '22023'],
    ]
    for (const [que, datos, codigo] of casos)
      it(`${que} → ${codigo ?? 'pasa'}`, async () => {
        const { error } = await guardar('titular', 'titular', datos)
        expect(error?.code ?? null).toBe(codigo)
      })

    it('el teléfono se guarda normalizado: sin espacios ni guiones, el 00 como +', async () => {
      expect(
        (await guardar('titular', 'titular', { telefono: '0034 600-11-22-33' })).error
      ).toBeNull()
      expect((await fila('titular'))?.telefono).toBe('+34600112233')
    })

    it('mañana no es una fecha de nacimiento', async () => {
      const manana = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
      const { error } = await guardar('titular', 'titular', { fecha_nacimiento: manana })
      expect(error?.hint).toBe('fecha_nacimiento_fuera_de_rango')
    })
  })

  describe('quién ve qué', () => {
    it('la sesión no lee las columnas nuevas directamente', async () => {
      const { error } = await sesion.titular
        .from('familia_tutores')
        .select('telefono')
        .eq('familia_id', familia)
      expect(error?.code).toBe('42501')
    })

    it('la profe del aula ve el teléfono de los dos tutores; la fila entera, no', async () => {
      const { data: premisa } = await sesion.profe.rpc('es_profe_de_nino', { p_nino_id: lucas })
      expect(premisa).toBe(true)
      const { data } = await sesion.profe.rpc('telefonos_familia_de_nino', { p_nino_id: lucas })
      expect(data?.map((r) => r.rol_familia)).toEqual(['titular', 'segundo_tutor'])
      expect(data?.every((r) => r.telefono !== null)).toBe(true)
      const { data: filas } = await sesion.profe.rpc('tutores_de_familia', {
        p_familia_id: familia,
      })
      expect(filas).toEqual([])
    })

    it('el autorizado no ve ningún teléfono', async () => {
      const { data: premisa } = await sesion.autorizado.rpc('es_tutor_de', { p_nino_id: lucas })
      expect(premisa).toBe(true)
      const { data } = await sesion.autorizado.rpc('telefonos_familia_de_nino', {
        p_nino_id: lucas,
      })
      expect(data).toEqual([])
    })

    it('la Dirección ve los datos personales de los dos', async () => {
      const { data } = await sesion.admin.rpc('tutores_de_familia', { p_familia_id: familia })
      expect(data?.map((r) => r.ve_personales)).toEqual([true, true])
    })
  })

  describe('el bucket dni-tutores, con la misma regla', () => {
    let dniTitular: string
    let dniSegundo: string
    beforeAll(async () => {
      dniTitular = `${centro.id}/${lucas}/dni-tutor_legal_principal-demo.pdf`
      dniSegundo = `${centro.id}/${lucas}/dni-tutor_legal_secundario-demo.pdf`
      for (const p of [dniTitular, dniSegundo]) {
        const { error } = await serviceClient.storage
          .from('dni-tutores')
          .upload(p, new Blob(['%PDF-1.4 demo'], { type: 'application/pdf' }), { upsert: true })
        if (error) throw new Error(error.message)
      }
      await serviceClient
        .from('familia_tutores')
        .update({ dni_documento_path: dniTitular })
        .eq('familia_id', familia)
        .eq('rol_familia', 'titular')
      await serviceClient
        .from('familia_tutores')
        .update({ dni_documento_path: dniSegundo })
        .eq('id', filaSegundo)
    })
    const abre = async (quien: Quien, p: string) =>
      (await sesion[quien].storage.from('dni-tutores').download(p)).error === null

    it('cada tutor abre el suyo; el otro tutor con cuenta, no', async () => {
      expect(await abre('titular', dniTitular)).toBe(true)
      expect(await abre('segundo', dniSegundo)).toBe(true)
      expect(await abre('segundo', dniTitular)).toBe(false)
      expect(await abre('titular', dniSegundo)).toBe(false)
    })

    it('sin cuenta el segundo, el titular abre su DNI', async () => {
      await cuentaSegundo(null)
      try {
        expect(await abre('titular', dniSegundo)).toBe(true)
      } finally {
        await cuentaSegundo(u.segundo.id)
      }
    })

    it('ni la profe ni el autorizado abren ninguno; la Dirección, los dos', async () => {
      for (const q of ['profe', 'autorizado'] as const) {
        expect(await abre(q, dniTitular), q).toBe(false)
        expect(await abre(q, dniSegundo), q).toBe(false)
      }
      expect(await abre('admin', dniTitular)).toBe(true)
      expect(await abre('admin', dniSegundo)).toBe(true)
    })
  })

  describe('el cierre del alta exige los tutores', () => {
    const cierra = () => sesion.admin.rpc('marcar_matricula_lista', { p_nino_id: mia })
    const estado = async () =>
      (await serviceClient.from('matriculas').select('estado').eq('nino_id', mia).single()).data
        ?.estado

    beforeAll(async () => {
      await completarDatosAlta(mia)
      const { error } = await serviceClient.from('consentimientos').insert({
        usuario_id: u.admin.id,
        tipo: 'datos_medicos',
        version: 'v2.0',
        metodo_firma: 'digital',
        nino_id: mia,
      })
      if (error) throw new Error(error.message)
    })

    const completar = async (rol: 'titular' | 'segundo_tutor') => {
      const { error } = await serviceClient
        .from('familia_tutores')
        .update(COMPLETO)
        .eq('familia_id', familia)
        .eq('rol_familia', rol)
      if (error) throw new Error(error.message)
    }

    it('con los tutores a medias, frena con datos_tutor_por_completar', async () => {
      const { error } = await cierra()
      expect(error?.hint).toBe('datos_tutor_por_completar')
      expect(await estado()).toBe('pendiente')
    })

    it('cada dato exigido del titular, quitado solo, frena; el número de la calle y los voluntarios, no', async () => {
      await completar('titular')
      await completar('segundo_tutor')
      const exigidos = [
        'telefono',
        'fecha_nacimiento',
        'dni_numero',
        'direccion_calle',
        'direccion_cp',
        'direccion_ciudad',
        'nombre_completo',
        'email',
        'dni_documento_path',
      ]
      for (const c of exigidos) {
        const antes = await serviceClient
          .from('familia_tutores')
          .select(c)
          .eq('familia_id', familia)
          .eq('rol_familia', 'titular')
          .single()
        await serviceClient
          .from('familia_tutores')
          .update({ [c]: null } as Database['public']['Tables']['familia_tutores']['Update'])
          .eq('familia_id', familia)
          .eq('rol_familia', 'titular')
        const { error } = await cierra()
        expect.soft(error?.hint, c).toBe('datos_tutor_por_completar')
        await serviceClient
          .from('familia_tutores')
          .update(antes.data as unknown as Database['public']['Tables']['familia_tutores']['Update'])
          .eq('familia_id', familia)
          .eq('rol_familia', 'titular')
      }
      expect(await estado()).toBe('pendiente')
    })

    it('el DNI del segundo tutor, si lo hay, también frena', async () => {
      await serviceClient
        .from('familia_tutores')
        .update({ dni_documento_path: null })
        .eq('id', filaSegundo)
      const { error } = await cierra()
      expect(error?.hint).toBe('datos_tutor_por_completar')
      await serviceClient
        .from('familia_tutores')
        .update({ dni_documento_path: `${centro.id}/${lucas}/dni-tutor_legal_secundario-demo.pdf` })
        .eq('id', filaSegundo)
    })

    it('control positivo: con todo, sin número de calle ni estudios ni empresa, cierra', async () => {
      await serviceClient
        .from('familia_tutores')
        .update({ direccion_numero: null, estudios: null, empresa: null })
        .eq('familia_id', familia)
      const { error } = await cierra()
      expect(error).toBeNull()
      expect(await estado()).toBe('lista')
    })

    it('no es retroactivo: Lucas, validado, no se toca aunque su familia estuviera incompleta', async () => {
      const { error } = await sesion.admin.rpc('marcar_matricula_lista', { p_nino_id: lucas })
      expect(error).toBeNull()
      const { data } = await serviceClient
        .from('matriculas')
        .select('estado')
        .eq('nino_id', lucas)
        .single()
      expect(data?.estado).toBe('activa')
    })
  })

  describe('el export art. 15 del tutor sin cuenta', () => {
    it('la Dirección lo exporta por su fila, con sus cinco datos; un tutor, no', async () => {
      await cuentaSegundo(null)
      try {
        const { data, error } = await sesion.admin.rpc('export_datos_sujeto', {
          p_sujeto_tipo: 'tutor',
          p_sujeto_id: filaSegundo,
        })
        expect(error).toBeNull()
        const perfil = (data as { perfiles_familia: Record<string, unknown>[] }).perfiles_familia
        expect(perfil).toHaveLength(1)
        expect(perfil[0]).toMatchObject({
          rol_familia: 'segundo_tutor',
          telefono: COMPLETO.telefono,
          dni_numero: COMPLETO.dni_numero,
        })
        const t = await sesion.titular.rpc('export_datos_sujeto', {
          p_sujeto_tipo: 'tutor',
          p_sujeto_id: filaSegundo,
        })
        expect(t.error?.code).toBe('42501')
      } finally {
        await cuentaSegundo(u.segundo.id)
      }
    })

    it('en el export de un usuario, cada tutor lleva sus cinco datos y no los del otro', async () => {
      const { data } = await sesion.segundo.rpc('export_datos_sujeto', {
        p_sujeto_tipo: 'usuario',
        p_sujeto_id: u.segundo.id,
      })
      const perfiles = (data as { perfiles_familia: Record<string, unknown>[] }).perfiles_familia
      expect(perfiles).toHaveLength(1)
      expect(perfiles[0]).toMatchObject({
        rol_familia: 'segundo_tutor',
        telefono: COMPLETO.telefono,
      })
    })
  })
})
