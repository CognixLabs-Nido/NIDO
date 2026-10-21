import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { Constants, type Database } from '@/types/database'

import {
  anonClient,
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestFamilia,
  createTestNino,
  createTestUser,
  crearVinculo,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * Lo que hace una invitación (o un alta) con una fila retirada (`20261102120000`).
 *
 * La unicidad de `roles_usuario` y `vinculos_familiares` cuenta solo las filas vivas, y qué se
 * hace con la última retirada lo decide su motivo en UN sitio de la BD
 * (`privado.decision_ante_retirada`), para roles y vínculos. El mapa de abajo es la decisión del
 * responsable; su TIPO obliga a clasificar todo el enum (un motivo nuevo no compila hasta que se
 * decida), y los tests recorren el catálogo, no una lista escrita a mano.
 */

type Motivo = Database['public']['Enums']['motivo_borrado']
type Decision = 'reactivar' | 'nueva' | 'falla'

const DECISION: Record<Motivo, Decision> = {
  revocacion_familia: 'reactivar',
  baja_direccion: 'reactivar',
  traspaso_admin: 'reactivar',
  paso_a_superusuario: 'reactivar',
  baja_nino: 'reactivar',
  purga_rgpd: 'nueva',
  salida_centro: 'nueva',
  solicitud_olvido: 'falla',
  baja_temporal: 'falla',
}

const MOTIVOS = Constants.public.Enums.motivo_borrado

const AYER = '2026-10-01T10:00:00Z'
const ANTEAYER = '2026-09-01T10:00:00Z'

describe('invitaciones: la tabla de motivos', () => {
  let persona: TestUser
  let directora: TestUser
  let profe: TestUser
  let adminB: TestUser
  const centros: string[] = []
  const centroDe = new Map<Motivo, string>()
  const ninoDe = new Map<Motivo, string>()
  let centroA: string

  beforeAll(async () => {
    persona = await createTestUser({ nombre: 'Persona Motivos' })
    directora = await createTestUser({ nombre: 'Admin Motivos' })
    profe = await createTestUser({ nombre: 'Profe Motivos' })
    adminB = await createTestUser({ nombre: 'Admin Motivos B' })
    centroA = (await createTestCentro('Centro Motivos A')).id
    const centroB = (await createTestCentro('Centro Motivos B')).id
    centros.push(centroA, centroB)
    await asignarRol(directora.id, centroA, 'admin')
    await asignarRol(profe.id, centroA, 'profe')
    await asignarRol(adminB.id, centroB, 'admin')
    // Un centro por motivo para los roles (la clave es persona+centro+rol) y un niño por
    // motivo para los vínculos (persona+niño).
    for (const m of MOTIVOS) {
      const c = (await createTestCentro(`Centro Motivo ${m}`)).id
      centros.push(c)
      centroDe.set(m, c)
      ninoDe.set(m, (await createTestNino(centroA)).id)
    }
  }, 180_000)

  afterAll(async () => {
    for (const c of centros) await deleteTestCentro(c)
    for (const u of [persona, directora, profe, adminB]) if (u) await deleteTestUser(u.id)
  }, 180_000)

  async function filasRol(centroId: string) {
    const { data, error } = await serviceClient
      .from('roles_usuario')
      .select('id, deleted_at, deleted_reason')
      .eq('usuario_id', persona.id)
      .eq('centro_id', centroId)
      .eq('rol', 'profe')
      .order('created_at')
    if (error) throw new Error(error.message)
    return data
  }

  async function filasVinculo(ninoId: string) {
    const { data, error } = await serviceClient
      .from('vinculos_familiares')
      .select('id, deleted_at, deleted_reason, tipo_vinculo')
      .eq('usuario_id', persona.id)
      .eq('nino_id', ninoId)
      .order('created_at')
    if (error) throw new Error(error.message)
    return data
  }

  const darRol = (centroId: string, soloComprobar = false) =>
    serviceClient.rpc('dar_rol_de_invitacion', {
      p_usuario_id: persona.id,
      p_centro_id: centroId,
      p_rol: 'profe',
      p_solo_comprobar: soloComprobar,
    })

  const darVinculo = (ninoId: string, soloComprobar = false) =>
    serviceClient.rpc('dar_vinculos_de_invitacion', {
      p_usuario_id: persona.id,
      p_nino_ids: [ninoId],
      p_tipo: 'autorizado',
      p_parentesco: 'otro',
      p_descripcion_parentesco: 'vecina',
      p_permisos: {},
      p_solo_comprobar: soloComprobar,
    })

  it('premisa: el mapa cubre todo el enum y hay una fila retirada de cada motivo', async () => {
    expect(Object.keys(DECISION).sort()).toEqual([...MOTIVOS].sort())
    for (const m of MOTIVOS) {
      const c = centroDe.get(m)!
      const r = await serviceClient.from('roles_usuario').insert({
        usuario_id: persona.id,
        centro_id: c,
        rol: 'profe',
        deleted_at: AYER,
        deleted_reason: m,
      })
      expect(r.error).toBeNull()
      const v = await serviceClient.from('vinculos_familiares').insert({
        nino_id: ninoDe.get(m)!,
        usuario_id: persona.id,
        tipo_vinculo: 'tutor_legal_principal',
        parentesco: 'madre',
        permisos: {},
        deleted_at: AYER,
        deleted_reason: m,
      })
      expect(v.error).toBeNull()
      expect(await filasRol(c)).toEqual([
        expect.objectContaining({ deleted_reason: m, deleted_at: expect.any(String) }),
      ])
    }
  })

  for (const m of MOTIVOS) {
    it(`rol, ${m}: ${DECISION[m]}`, async () => {
      const c = centroDe.get(m)!
      const [antes] = await filasRol(c)
      const comprobado = await darRol(c, true)
      const dado = await darRol(c)
      const despues = await filasRol(c)
      if (DECISION[m] === 'falla') {
        expect(comprobado.error).toMatchObject({ code: '55000', hint: m })
        expect(dado.error).toMatchObject({ code: '55000', hint: m })
        expect(despues).toEqual([antes])
      } else if (DECISION[m] === 'reactivar') {
        expect(comprobado).toMatchObject({ data: 'reactivar', error: null })
        expect(dado).toMatchObject({ data: 'reactivada', error: null })
        expect(despues).toEqual([{ id: antes!.id, deleted_at: null, deleted_reason: null }])
      } else {
        expect(comprobado).toMatchObject({ data: 'crear', error: null })
        expect(dado).toMatchObject({ data: 'creada', error: null })
        // La vieja intacta, y una nueva viva.
        expect(despues).toEqual([
          antes,
          expect.objectContaining({ deleted_at: null, deleted_reason: null }),
        ])
      }
    })

    it(`vínculo, ${m}: ${DECISION[m]}`, async () => {
      const n = ninoDe.get(m)!
      const [antes] = await filasVinculo(n)
      const comprobado = await darVinculo(n, true)
      const dado = await darVinculo(n)
      const despues = await filasVinculo(n)
      if (DECISION[m] === 'falla') {
        expect(comprobado.error).toMatchObject({ code: '55000', hint: m })
        expect(dado.error).toMatchObject({ code: '55000', hint: m })
        expect(despues).toEqual([antes])
      } else if (DECISION[m] === 'reactivar') {
        expect(comprobado.error).toBeNull()
        expect(dado.error).toBeNull()
        // Vuelve tal cual: conserva su tipo, no toma el de la invitación.
        expect(despues).toEqual([
          {
            id: antes!.id,
            deleted_at: null,
            deleted_reason: null,
            tipo_vinculo: 'tutor_legal_principal',
          },
        ])
      } else {
        expect(comprobado.error).toBeNull()
        expect(dado.error).toBeNull()
        expect(despues).toEqual([
          antes,
          expect.objectContaining({ deleted_at: null, tipo_vinculo: 'autorizado' }),
        ])
      }
    })
  }

  it('con una fila viva, dar el rol no cambia nada (viva)', async () => {
    const c = centroDe.get('baja_direccion')!
    const antes = await filasRol(c)
    expect(antes.filter((f) => f.deleted_at === null)).toHaveLength(1)
    expect(await darRol(c)).toMatchObject({ data: 'viva', error: null })
    expect(await filasRol(c)).toEqual(antes)
  })

  describe('manda la última fila retirada', () => {
    let c1: string
    let c2: string

    beforeAll(async () => {
      c1 = (await createTestCentro('Centro Orden 1')).id
      c2 = (await createTestCentro('Centro Orden 2')).id
      centros.push(c1, c2)
      // c1: salió hace tiempo y después estuvo de baja temporal → falla.
      // c2: estuvo de baja temporal y después salió → fila nueva.
      for (const [c, viejo, nuevo] of [
        [c1, 'salida_centro', 'baja_temporal'],
        [c2, 'baja_temporal', 'salida_centro'],
      ] as const) {
        for (const [cuando, motivo] of [
          [ANTEAYER, viejo],
          [AYER, nuevo],
        ] as const) {
          const { error } = await serviceClient.from('roles_usuario').insert({
            usuario_id: persona.id,
            centro_id: c,
            rol: 'profe',
            deleted_at: cuando,
            deleted_reason: motivo,
          })
          if (error) throw new Error(error.message)
        }
      }
    }, 60_000)

    it('premisa: dos filas retiradas de la misma clave caben (la unicidad es de las vivas)', async () => {
      expect(await filasRol(c1)).toHaveLength(2)
      expect(await filasRol(c2)).toHaveLength(2)
    })

    it('la última es una baja temporal: falla aunque la anterior fuera una salida', async () => {
      const { error } = await darRol(c1)
      expect(error).toMatchObject({ code: '55000', hint: 'baja_temporal' })
      expect((await filasRol(c1)).every((f) => f.deleted_at !== null)).toBe(true)
    })

    it('la última es una salida: fila nueva, y las dos viejas intactas', async () => {
      expect(await darRol(c2)).toMatchObject({ data: 'creada', error: null })
      const filas = await filasRol(c2)
      expect(filas.map((f) => f.deleted_reason)).toEqual(['baja_temporal', 'salida_centro', null])
    })

    it('Dirección reactiva la baja temporal más reciente, no la salida de antes', async () => {
      const otro = (await createTestCentro('Centro Orden 3')).id
      centros.push(otro)
      await asignarRol(directora.id, otro, 'admin')
      for (const [cuando, motivo] of [
        [ANTEAYER, 'salida_centro'],
        [AYER, 'baja_temporal'],
      ] as const) {
        const { error } = await serviceClient.from('roles_usuario').insert({
          usuario_id: persona.id,
          centro_id: otro,
          rol: 'profe',
          deleted_at: cuando,
          deleted_reason: motivo,
        })
        expect(error).toBeNull()
      }
      const c = await clientFor(directora)
      const { error } = await c.rpc('reactivar_profe', {
        p_centro_id: otro,
        p_usuario_id: persona.id,
      })
      expect(error).toBeNull()
      expect((await filasRol(otro)).map((f) => f.deleted_reason)).toEqual(['salida_centro', null])
    })
  })

  describe('la unicidad cuenta solo las vivas', () => {
    it('dos roles vivos de la misma clave no caben (23505)', async () => {
      const c = centroDe.get('salida_centro')!
      const { error } = await serviceClient
        .from('roles_usuario')
        .insert({ usuario_id: persona.id, centro_id: c, rol: 'profe' })
      expect(error?.code).toBe('23505')
    })

    it('dos vínculos vivos de la misma clave no caben (23505)', async () => {
      const { error } = await serviceClient.from('vinculos_familiares').insert({
        nino_id: ninoDe.get('purga_rgpd')!,
        usuario_id: persona.id,
        tipo_vinculo: 'autorizado',
        parentesco: 'otro',
        permisos: {},
      })
      expect(error?.code).toBe('23505')
    })
  })

  describe('las puertas', () => {
    const vinculoDeDireccion = (ninoId: string) => ({
      p_nino_id: ninoId,
      p_usuario_id: persona.id,
      p_tipo: 'autorizado' as const,
      p_parentesco: 'otro' as const,
      p_descripcion_parentesco: 'vecina',
      p_permisos: {},
    })

    it('las de la invitación son solo del servidor: ni Dirección ni anon (42501)', async () => {
      for (const cliente of [await clientFor(directora), anonClient()]) {
        const r = await cliente.rpc('dar_rol_de_invitacion', {
          p_usuario_id: persona.id,
          p_centro_id: centroA,
          p_rol: 'directora',
        })
        expect(r.error?.code).toBe('42501')
        const v = await cliente.rpc('dar_vinculos_de_invitacion', {
          p_usuario_id: persona.id,
          p_nino_ids: [ninoDe.get('solicitud_olvido')!],
          p_tipo: 'autorizado',
          p_parentesco: 'otro',
          p_descripcion_parentesco: 'x',
          p_permisos: {},
        })
        expect(v.error?.code).toBe('42501')
      }
      const { data } = await serviceClient
        .from('roles_usuario')
        .select('id')
        .eq('usuario_id', persona.id)
        .eq('centro_id', centroA)
      expect(data).toEqual([])
    })

    it('crear_vinculo: una profe, la admin de otro centro y anon no (42501)', async () => {
      const n = (await createTestNino(centroA)).id
      for (const cliente of [await clientFor(profe), await clientFor(adminB), anonClient()]) {
        const { error } = await cliente.rpc('crear_vinculo', vinculoDeDireccion(n))
        expect(error?.code).toBe('42501')
      }
      expect(await filasVinculo(n)).toEqual([])
    })

    it('crear_vinculo: Dirección lo crea; uno vivo sigue siendo duplicado (23505)', async () => {
      const n = (await createTestNino(centroA)).id
      const c = await clientFor(directora)
      const creado = await c.rpc('crear_vinculo', vinculoDeDireccion(n))
      expect(creado.error).toBeNull()
      expect(await filasVinculo(n)).toEqual([expect.objectContaining({ id: creado.data })])
      const otra = await c.rpc('crear_vinculo', vinculoDeDireccion(n))
      expect(otra.error?.code).toBe('23505')
      expect(await filasVinculo(n)).toHaveLength(1)
    })

    it('crear_vinculo: con uno retirado decide la tabla (purga → nuevo; olvido → 55000)', async () => {
      const c = await clientFor(directora)
      const n = (await createTestNino(centroA)).id
      const { error: errPurga } = await serviceClient.from('vinculos_familiares').insert({
        nino_id: n,
        usuario_id: persona.id,
        tipo_vinculo: 'autorizado',
        parentesco: 'otro',
        permisos: {},
        deleted_at: AYER,
        deleted_reason: 'purga_rgpd',
      })
      expect(errPurga).toBeNull()
      const nuevo = await c.rpc('crear_vinculo', vinculoDeDireccion(n))
      expect(nuevo.error).toBeNull()
      expect((await filasVinculo(n)).map((f) => f.deleted_reason)).toEqual(['purga_rgpd', null])

      const olvido = await c.rpc(
        'crear_vinculo',
        vinculoDeDireccion(ninoDe.get('solicitud_olvido')!)
      )
      expect(olvido.error).toMatchObject({ code: '55000', hint: 'solicitud_olvido' })
    })
  })
})

describe('invitaciones: los sitios de la BD que pasan por la tabla', () => {
  let admin: TestUser
  let tutor: TestUser
  let centroId: string
  let aulaId: string
  let familiaId: string
  let primerHijo: string

  beforeAll(async () => {
    admin = await createTestUser({ nombre: 'Admin Sitios' })
    tutor = await createTestUser({ nombre: 'Tutor Sitios' })
    centroId = (await createTestCentro('Centro Sitios')).id
    await asignarRol(admin.id, centroId, 'admin')
    const curso = await createTestCurso(centroId, 'activo')
    aulaId = (await createTestAula(centroId, curso.id)).id
    familiaId = await createTestFamilia(centroId)
    await serviceClient
      .from('familia_tutores')
      .insert({ familia_id: familiaId, usuario_id: tutor.id, rol_familia: 'titular' })
    const { data: nino } = await serviceClient
      .from('ninos')
      .insert({
        centro_id: centroId,
        familia_id: familiaId,
        nombre: 'Primer Hijo',
        apellidos: 'Sitios',
        fecha_nacimiento: '2024-03-15',
      })
      .select('id')
      .single()
    primerHijo = nino!.id
    await crearVinculo(primerHijo, tutor.id, 'tutor_legal_principal')
  }, 120_000)

  afterAll(async () => {
    await deleteTestCentro(centroId)
    for (const u of [admin, tutor]) if (u) await deleteTestUser(u.id)
  }, 120_000)

  async function anadirHijo() {
    const c = await clientFor(admin)
    return c.rpc('crear_o_anadir_a_familia', {
      p_nombre_nino: 'Otro Hijo',
      p_apellidos_nino: 'Sitios',
      p_fecha_nacimiento: '2024-03-15',
      p_centro_id: centroId,
      p_aula_id: aulaId,
      p_tutor_email: tutor.email,
      p_tutor_nombre_completo: 'Tutor Sitios',
      p_parentesco: 'madre',
      p_descripcion_parentesco: '',
      p_usuario_id: tutor.id,
      p_permisos: {},
    })
  }

  async function hijos(): Promise<number> {
    const { count } = await serviceClient
      .from('ninos')
      .select('id', { count: 'exact', head: true })
      .eq('familia_id', familiaId)
    return count ?? 0
  }

  async function motivosRol(): Promise<(string | null)[]> {
    const { data } = await serviceClient
      .from('roles_usuario')
      .select('deleted_reason')
      .eq('usuario_id', tutor.id)
      .eq('centro_id', centroId)
      .order('created_at')
    return (data ?? []).map((f) => f.deleted_reason)
  }

  it('alta de hermano con el olvido en curso: falla con el motivo y no deja nada', async () => {
    const { error: errFila } = await serviceClient.from('roles_usuario').insert({
      usuario_id: tutor.id,
      centro_id: centroId,
      rol: 'tutor_legal',
      deleted_at: AYER,
      deleted_reason: 'solicitud_olvido',
    })
    expect(errFila).toBeNull()
    expect(await hijos()).toBe(1)
    const { error } = await anadirHijo()
    expect(error).toMatchObject({ code: '55000', hint: 'solicitud_olvido' })
    expect(await hijos()).toBe(1)
    expect(await motivosRol()).toEqual(['solicitud_olvido'])
  })

  it('alta de hermano tras una purga: rol nuevo, el purgado intacto', async () => {
    await serviceClient
      .from('roles_usuario')
      .update({ deleted_reason: 'purga_rgpd' })
      .eq('usuario_id', tutor.id)
      .eq('centro_id', centroId)
    const { error } = await anadirHijo()
    expect(error).toBeNull()
    expect(await motivosRol()).toEqual(['purga_rgpd', null])
    expect(await hijos()).toBe(2)
  })

  it('familia revocada con una fila retirada y otra viva: no choca, la viva se queda', async () => {
    // Antes, la reactivación revivía la retirada `revocacion_familia` aunque hubiera una viva;
    // con la unicidad de solo las vivas, eso choca.
    await serviceClient
      .from('roles_usuario')
      .update({ deleted_reason: 'revocacion_familia' })
      .eq('usuario_id', tutor.id)
      .eq('centro_id', centroId)
      .not('deleted_at', 'is', null)
    await serviceClient
      .from('familias')
      .update({ deleted_at: AYER, deleted_reason: 'revocacion_familia' })
      .eq('id', familiaId)
    expect(await motivosRol()).toEqual(['revocacion_familia', null])
    const { error } = await anadirHijo()
    expect(error).toBeNull()
    expect(await motivosRol()).toEqual(['revocacion_familia', null])
    expect(await hijos()).toBe(3)
  })

  it('desarchivar: un vínculo de baja con otro vivo de la misma persona no choca', async () => {
    // El primer hijo, archivado por baja: su vínculo retirado por la baja, y otro vivo.
    await serviceClient
      .from('vinculos_familiares')
      .update({ deleted_at: AYER, deleted_reason: 'baja_nino' })
      .eq('nino_id', primerHijo)
    await crearVinculo(primerHijo, tutor.id, 'tutor_legal_principal')
    await serviceClient
      .from('ninos')
      .update({ deleted_at: AYER, deleted_reason: 'baja_nino' })
      .eq('id', primerHijo)
    const c = await clientFor(admin)
    const { error } = await c.rpc('desarchivar_nino', { p_nino_id: primerHijo, p_aula_id: aulaId })
    expect(error).toBeNull()
    const { data } = await serviceClient
      .from('vinculos_familiares')
      .select('deleted_reason')
      .eq('nino_id', primerHijo)
      .eq('usuario_id', tutor.id)
      .order('created_at')
    expect(data?.map((f) => f.deleted_reason)).toEqual(['baja_nino', null])
  })
})
