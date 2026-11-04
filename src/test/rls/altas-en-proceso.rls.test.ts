import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { LineaAvance } from '@/features/matriculas/lib/avance-alta'
import {
  getAltasEnProceso,
  type AltaEnProceso,
} from '@/features/matriculas/queries/get-altas-en-proceso'

import { borrarMandatos, insertarMandato } from './mandatos-como-postgres'
import {
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestUser,
  crearVinculo,
  deleteTestCentro,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestCentro,
  type TestUser,
} from './setup'

/**
 * «Altas en proceso» (decisión de Jose, 2026-11-04: «la lista es todo de todo»), con la sesión de
 * Dirección contra la RLS real. Lo que se mide:
 *  - cada clase del embudo sale con su estado: la invitación sin aceptar (Leo), la caducada (Mar),
 *    la que la familia empezó (Ona), la terminada que falta validar (Pau) y el segundo tutor que no
 *    ha entrado en un alta ya validada (Nil, que hasta ahora no salía en ninguna parte);
 *  - lo que lleva hecho Ona sale de lo que hizo la familia: recién aceptada, con el nombre del niño
 *    y el del tutor ya puestos por la invitación, no tiene nada hecho; y cada cosa que hace la
 *    familia se ve hecha con la sesión de la directora (el control positivo de cada lectura);
 *  - la lista es de Dirección: la profe y la directora de otro centro no la leen (NULL, nunca una
 *    lista vacía que diga «no hay»).
 * Fixtures ficticios, fechados el 2026-11-04.
 */

const DIA = 86_400_000
const enDias = (n: number) => new Date(Date.now() + n * DIA).toISOString()

describe('Altas en proceso: el embudo de la directora', () => {
  let centro: TestCentro
  let otro: TestCentro
  let admin: TestUser
  let directora: TestUser
  let directoraOtro: TestUser
  let profe: TestUser
  let tutora: TestUser
  let aula: string
  let curso: string
  const ninos: Record<'leo' | 'mar' | 'ona' | 'pau' | 'nil', { nino: string; familia: string }> =
    {} as never
  const sufijo = Date.now()

  async function alta(nombre: string, email: string) {
    const c = await clientFor(admin)
    const { data, error } = await c.rpc('crear_o_anadir_a_familia', {
      p_nombre_nino: nombre,
      p_apellidos_nino: 'Embudo Ensayo',
      p_fecha_nacimiento: '2025-03-01',
      p_centro_id: centro.id,
      p_aula_id: aula,
      p_tutor_email: email,
      p_tutor_nombre_completo: '',
      p_parentesco: '',
      p_descripcion_parentesco: '',
      p_usuario_id: null as unknown as string,
      p_permisos: {},
    })
    expect(error).toBeNull()
    const r = data as { nino_id: string; familia_id: string }
    return { nino: r.nino_id, familia: r.familia_id }
  }

  async function invitar(
    nino: string,
    email: string,
    expira: string,
    tipo: 'tutor_legal_principal' | 'tutor_legal_secundario' = 'tutor_legal_principal'
  ) {
    const { error } = await serviceClient.from('invitaciones').insert({
      centro_id: centro.id,
      email,
      rol_objetivo: 'tutor_legal',
      nino_id: nino,
      tipo_vinculo: tipo,
      expires_at: expira,
    })
    expect(error).toBeNull()
  }

  async function lista(u: TestUser): Promise<AltaEnProceso[] | null> {
    return getAltasEnProceso(await clientFor(u), centro.id)
  }

  const fila = (altas: AltaEnProceso[], nino: string) => altas.find((a) => a.ninoId === nino)
  const estados = (avance: LineaAvance[]) =>
    Object.fromEntries(avance.map((l) => [l.item, l.estado]))
  const avanceDe = async (nino: string) => {
    const a = fila((await lista(directora))!, nino)
    expect(a && a.clase !== 'tutor2').toBe(true)
    return estados((a as Exclude<AltaEnProceso, { clase: 'tutor2' }>).avance)
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Embudo')
    otro = await createTestCentro('Centro Embudo Otro')
    curso = (await createTestCurso(centro.id)).id
    aula = (await createTestAula(centro.id, curso, 'Patitos Embudo', [2025])).id
    admin = await createTestUser({ nombre: 'Admin Embudo' })
    directora = await createTestUser({ nombre: 'Directora Embudo' })
    directoraOtro = await createTestUser({ nombre: 'Directora Embudo Otro' })
    profe = await createTestUser({ nombre: 'Profe Embudo' })
    tutora = await createTestUser({ nombre: 'Tutora Embudo' })
    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(directora.id, centro.id, 'directora')
    await asignarRol(directoraOtro.id, otro.id, 'directora')
    await asignarRol(profe.id, centro.id, 'profe')

    // Leo: invitado, sin aceptar, la invitación abierta.
    ninos.leo = await alta('Leo', `embudo-leo-${sufijo}@nido.test`)
    await invitar(ninos.leo.nino, `embudo-leo-${sufijo}@nido.test`, enDias(7))
    // Mar: la invitación caducó hace 40 días.
    ninos.mar = await alta('Mar', `embudo-mar-${sufijo}@nido.test`)
    await invitar(ninos.mar.nino, `embudo-mar-${sufijo}@nido.test`, enDias(-40))

    // Ona: la tutora aceptó, como lo hace la aceptación: su cuenta en el perfil del titular, con su
    // nombre, su rol en el centro y su vínculo con la niña.
    ninos.ona = await alta('Ona', tutora.email)
    await invitar(ninos.ona.nino, tutora.email, enDias(5))
    expect(
      (
        await serviceClient
          .from('invitaciones')
          .update({ accepted_at: enDias(-2) })
          .eq('nino_id', ninos.ona.nino)
      ).error
    ).toBeNull()
    expect(
      (
        await serviceClient
          .from('familia_tutores')
          .update({ usuario_id: tutora.id, nombre_completo: 'Tutora Embudo' })
          .eq('familia_id', ninos.ona.familia)
          .eq('rol_familia', 'titular')
      ).error
    ).toBeNull()
    await asignarRol(tutora.id, centro.id, 'tutor_legal')
    await crearVinculo(ninos.ona.nino, tutora.id, 'tutor_legal_principal')

    // Pau: la familia terminó (`lista`), falta validar.
    ninos.pau = await alta('Pau', `embudo-pau-${sufijo}@nido.test`)
    expect(
      (
        await serviceClient
          .from('matriculas')
          .update({ estado: 'lista' })
          .eq('nino_id', ninos.pau.nino)
          .eq('estado', 'pendiente')
      ).error
    ).toBeNull()

    // Nil: alta ya validada (matrícula activa) y su segundo tutor, sin cuenta, no ha aceptado la
    // invitación que salió al validar; caducó.
    ninos.nil = await alta('Nil', `embudo-nil-${sufijo}@nido.test`)
    expect(
      (
        await serviceClient
          .from('matriculas')
          .delete()
          .eq('nino_id', ninos.nil.nino)
          .eq('estado', 'pendiente')
      ).error
    ).toBeNull()
    const mat = await matricular(ninos.nil.nino, aula, curso)
    expect(
      (
        await serviceClient
          .from('matriculas')
          .update({ estado: 'activa', activada_at: enDias(-20) })
          .eq('id', mat)
      ).error
    ).toBeNull()
    expect(
      (
        await serviceClient.from('familia_tutores').insert({
          familia_id: ninos.nil.familia,
          rol_familia: 'segundo_tutor',
          email: `embudo-nil-dos-${sufijo}@nido.test`,
          nombre_completo: 'Segundo Tutor Embudo',
        })
      ).error
    ).toBeNull()
    await invitar(
      ninos.nil.nino,
      `embudo-nil-dos-${sufijo}@nido.test`,
      enDias(-3),
      'tutor_legal_secundario'
    )
  })

  afterAll(async () => {
    if (centro) borrarMandatos('centro_id', centro.id)
    await deleteTestCentro(centro.id)
    await deleteTestCentro(otro.id)
    for (const u of [admin, directora, directoraOtro, profe, tutora]) {
      if (u) await deleteTestUser(u.id)
    }
  })

  it('cada clase del embudo sale con su estado, y el segundo tutor también', async () => {
    const altas = await lista(directora)
    expect(altas).not.toBeNull()
    const por = (n: keyof typeof ninos) => fila(altas!, ninos[n].nino)

    const leo = por('leo')
    expect.soft(leo?.clase === 'sin_terminar' && leo.alta.estado).toBe('invitacion_abierta')
    expect.soft(leo?.clase === 'sin_terminar' && leo.dias).toBeNull()
    const mar = por('mar')
    expect.soft(mar?.clase === 'sin_terminar' && mar.alta.estado).toBe('sin_invitacion')
    expect.soft(mar?.clase === 'sin_terminar' && mar.alta.propuesta).toBe(true)
    expect.soft(mar?.clase === 'sin_terminar' && mar.dias).toBeGreaterThanOrEqual(40)
    const ona = por('ona')
    expect.soft(ona?.clase === 'sin_terminar' && ona.alta.estado).toBe('iniciada')
    expect.soft(por('pau')?.clase).toBe('por_validar')
    const nil = por('nil')
    expect.soft(nil?.clase).toBe('tutor2')
    expect.soft(nil?.clase === 'tutor2' && nil.estado).toBe('caducada')
    expect.soft(nil?.clase === 'tutor2' && nil.email).toBe(`embudo-nil-dos-${sufijo}@nido.test`)
    // Ninguna sale dos veces.
    expect(altas!.length).toBe(new Set(altas!.map((a) => a.ninoId)).size)
  })

  it('el segundo tutor que ya tiene cuenta no espera nada y sale de la lista', async () => {
    const segundo = await createTestUser({ nombre: 'Segundo Con Cuenta Embudo' })
    try {
      expect(
        (
          await serviceClient
            .from('familia_tutores')
            .update({ usuario_id: segundo.id })
            .eq('familia_id', ninos.nil.familia)
            .eq('rol_familia', 'segundo_tutor')
        ).error
      ).toBeNull()
      const altas = await lista(directora)
      expect(altas).not.toBeNull()
      expect(fila(altas!, ninos.nil.nino)).toBeUndefined()
    } finally {
      await serviceClient
        .from('familia_tutores')
        .update({ usuario_id: null })
        .eq('familia_id', ninos.nil.familia)
        .eq('rol_familia', 'segundo_tutor')
      await deleteTestUser(segundo.id)
    }
    // Y vuelve a salir: la fila dependía de eso y no de otra cosa.
    expect(fila((await lista(directora))!, ninos.nil.nino)?.clase).toBe('tutor2')
  })

  it('recién aceptada no tiene nada hecho, aunque la invitación ya puso los nombres', async () => {
    // Premisa: lo que pone la invitación y aceptarla está puesto. Es lo que hacía que la ficha
    // marcara «Datos del niño» hecho desde el principio.
    const { data: n } = await serviceClient
      .from('ninos')
      .select('apellidos, fecha_nacimiento')
      .eq('id', ninos.ona.nino)
      .single()
    expect(n?.apellidos).toBeTruthy()
    expect(n?.fecha_nacimiento).toBeTruthy()
    const { data: t } = await serviceClient
      .from('familia_tutores')
      .select('nombre_completo')
      .eq('familia_id', ninos.ona.familia)
      .eq('rol_familia', 'titular')
      .single()
    expect(t?.nombre_completo).toBe('Tutora Embudo')

    expect(await avanceDe(ninos.ona.nino)).toEqual({
      normas: 'falta',
      nino: 'falta',
      imagen: 'falta',
      tutor1: 'falta',
      tutor2: 'sin_hacer_opcional',
      medico: 'falta',
      sepa: 'sin_hacer_opcional',
    })
  })

  it('cada cosa que hace la familia se ve hecha con la sesión de la directora', async () => {
    const ona = ninos.ona
    // Normas, por casilla (`acuses_alta`).
    expect(
      (
        await serviceClient.from('acuses_alta').insert({
          nino_id: ona.nino,
          centro_id: centro.id,
          tipo: 'normas',
          firmante_id: tutora.id,
        })
      ).error
    ).toBeNull()
    expect.soft((await avanceDe(ona.nino)).normas).toBe('hecho')

    // El libro de familia, en el paso del niño.
    expect(
      (
        await serviceClient
          .from('ninos')
          .update({ libro_familia_path: `${centro.id}/${ona.nino}/libro.pdf` })
          .eq('id', ona.nino)
      ).error
    ).toBeNull()
    expect.soft((await avanceDe(ona.nino)).nino).toBe('hecho')

    // La imagen y el médico, sus consentimientos.
    for (const tipo of ['imagen', 'datos_medicos'] as const) {
      expect(
        (
          await serviceClient.from('consentimientos').insert({
            usuario_id: tutora.id,
            nino_id: ona.nino,
            tipo,
            version: 'v1',
          })
        ).error
      ).toBeNull()
    }
    const tras = await avanceDe(ona.nino)
    expect.soft(tras.imagen).toBe('hecho')
    expect.soft(tras.medico).toBe('hecho')

    // El DNI del tutor 1, en su paso.
    expect(
      (
        await serviceClient
          .from('familia_tutores')
          .update({ dni_documento_path: `${centro.id}/${ona.nino}/dni.pdf` })
          .eq('familia_id', ona.familia)
          .eq('rol_familia', 'titular')
      ).error
    ).toBeNull()
    expect.soft((await avanceDe(ona.nino)).tutor1).toBe('hecho')

    // El segundo tutor, con su nombre.
    expect(
      (
        await serviceClient.from('familia_tutores').insert({
          familia_id: ona.familia,
          rol_familia: 'segundo_tutor',
          email: `embudo-ona-dos-${sufijo}@nido.test`,
          nombre_completo: 'Segunda Tutora Embudo',
        })
      ).error
    ).toBeNull()
    expect.soft((await avanceDe(ona.nino)).tutor2).toBe('hecho')

    // El mandato SEPA de la familia.
    const m = insertarMandato({
      centro_id: centro.id,
      familia_id: ona.familia,
      usuario_id: tutora.id,
      titular: 'Tutora Embudo',
      iban_cifrado: '\\x00',
      metodo_firma: 'digital',
      identificador_mandato: `NIDO-EMBUDO-${sufijo}`,
    })
    expect(m.error).toBeNull()
    expect(await avanceDe(ona.nino)).toEqual({
      normas: 'hecho',
      nino: 'hecho',
      imagen: 'hecho',
      tutor1: 'hecho',
      tutor2: 'hecho',
      medico: 'hecho',
      sepa: 'hecho',
    })
  })

  it('la lista es de Dirección: la profe y la directora de otro centro no la leen', async () => {
    // Control positivo: la directora del centro sí.
    expect(await lista(directora)).not.toBeNull()
    expect(await lista(admin)).not.toBeNull()
    expect(await lista(profe)).toBeNull()
    expect(await lista(directoraOtro)).toBeNull()
  })
})
