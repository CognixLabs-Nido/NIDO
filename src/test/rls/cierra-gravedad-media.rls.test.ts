import type { SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { recolectarNino, recolectarUsuario } from '@/features/export/lib/recolectar'
import type { Database } from '@/types/db'

import {
  borrarDocumentosDe,
  comoPostgres,
  creaDocumento,
  subeVersion,
} from './documentos-centro-fixture'
import {
  asignarProfeAula,
  asignarRol,
  clientFor,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestNino,
  createTestUser,
  crearFamiliaTutor,
  crearVinculo,
  deleteTestUser,
  matricular,
  serviceClient,
  type TestUser,
} from './setup'

/**
 * Las cuatro de gravedad media y baja, segunda de dos (`20270125130000`, 2026-11-17). Medido
 * ABIERTO en producción el 2026-11-16 (21/21): el autorizado leía el trazo, la IP, el navegador y
 * el nombre tecleado de las firmas de los documentos del centro, los acuses del alta y las
 * confirmaciones de los eventos, y confirmaba.
 *
 *   - firmas de los documentos (opción b): la fila sí, las cuatro columnas no, para nadie con sesión;
 *     el contenido, por `contenido_firmas_documentos`, y la exportación lo sigue entregando;
 *   - confirmaciones (C, «solo confirman los padres», Jose, 2026-11-13): el autorizado ni confirma
 *     ni lee; el tutor legal, la profe del niño y la Dirección, como antes;
 *   - acuses del alta (decisión del responsable del 2026-11-16): el tutor legal y la Dirección.
 */
const TRAZO = 'data:image/png;base64,TUFSQ0EtQ0lFUlJF'
const UA = 'MARCA-UA-CIERRE'
const NOMBRE = 'Legal Cierre Gravedad Media'
// Lo tecleado, distinto del nombre de la cuenta: el export del niño ya lleva el nombre del tutor
// por otro lado, y un aserto sobre él acertaría sin pasar por la función.
const TECLEADO = 'MARCA-TECLEADO-CIERRE'

describe('cierra las cuatro de gravedad media (segunda de dos)', () => {
  let centro: { id: string }
  let nino: { id: string; familia_id: string }
  let legal: TestUser
  let autorizado: TestUser
  let profe: TestUser
  let admin: TestUser
  let firma: string
  let evento: string
  const usuarios: string[] = []
  const sesiones = new Map<string, SupabaseClient<Database>>()
  const como = async (u: TestUser) => {
    if (!sesiones.has(u.id)) sesiones.set(u.id, await clientFor(u))
    return sesiones.get(u.id)!
  }

  beforeAll(async () => {
    centro = await createTestCentro('Centro Cierre Gravedad Media')
    const curso = await createTestCurso(centro.id)
    const aula = await createTestAula(centro.id, curso.id)
    nino = await createTestNino(centro.id, 'Nino Cierre Gravedad Media')
    await matricular(nino.id, aula.id, curso.id)

    legal = await createTestUser({ nombre: NOMBRE })
    autorizado = await createTestUser({ nombre: 'Autorizado Cierre Gravedad Media' })
    profe = await createTestUser({ nombre: 'Profe Cierre Gravedad Media' })
    admin = await createTestUser({ nombre: 'Admin Cierre Gravedad Media' })
    usuarios.push(legal.id, autorizado.id, profe.id, admin.id)
    await asignarRol(admin.id, centro.id, 'admin')
    await asignarRol(profe.id, centro.id, 'profe')
    await asignarProfeAula(profe.id, aula.id, curso.id)
    await asignarRol(legal.id, centro.id, 'tutor_legal')
    await asignarRol(autorizado.id, centro.id, 'autorizado')
    await crearFamiliaTutor(nino.familia_id, legal.id, 'titular')
    await crearVinculo(nino.id, legal.id, 'tutor_legal_principal', {})
    await crearVinculo(nino.id, autorizado.id, 'autorizado', {})

    const doc = await creaDocumento(await como(admin), centro.id, 'Normas cierre')
    const version = await subeVersion(await como(admin), centro.id, doc, null, 'normas cierre v1')
    const f = await (
      await como(legal)
    ).rpc('firmar_documento_centro', {
      p_version_id: version,
      p_nino_id: nino.id,
      p_nombre_tecleado: TECLEADO,
      p_firma_imagen: TRAZO,
      p_ip_address: '10.9.8.6',
      p_user_agent: UA,
    })
    if (f.error || !f.data) throw new Error(`firma: ${f.error?.message}`)
    firma = f.data

    const ev = await serviceClient
      .from('eventos')
      .insert({
        ambito: 'aula',
        centro_id: centro.id,
        aula_id: aula.id,
        tipo: 'excursion',
        titulo: 'Excursión cierre',
        fecha: '2027-06-01',
        requiere_confirmacion: true,
        creado_por: admin.id,
      })
      .select('id')
      .single()
    if (ev.error || !ev.data) throw new Error(`evento: ${ev.error?.message}`)
    evento = ev.data.id

    const a = await serviceClient
      .from('acuses_alta')
      .insert({ nino_id: nino.id, centro_id: centro.id, tipo: 'imagen', firmante_id: legal.id })
    if (a.error) throw new Error(`acuse: ${a.error.message}`)
  })

  afterAll(async () => {
    await serviceClient.from('acuses_alta').delete().eq('nino_id', nino.id)
    await serviceClient.from('confirmaciones_evento').delete().eq('evento_id', evento)
    await serviceClient.from('eventos').delete().eq('id', evento)
    await borrarDocumentosDe(centro.id)
    for (const u of usuarios) await deleteTestUser(u)
  })

  it('premisas: quién es quién con el niño, la firma con su trazo, el evento le aplica y el acuse está', async () => {
    const { data: v } = await serviceClient
      .from('vinculos_familiares')
      .select('usuario_id, tipo_vinculo')
      .eq('nino_id', nino.id)
      .is('deleted_at', null)
    const tipo = new Map((v ?? []).map((x) => [x.usuario_id, x.tipo_vinculo]))
    expect(tipo.get(legal.id)).toBe('tutor_legal_principal')
    expect(tipo.get(autorizado.id)).toBe('autorizado')
    expect(tipo.has(profe.id)).toBe(false)
    const { data: esProfe } = await (
      await como(profe)
    ).rpc('es_profe_de_nino', { p_nino_id: nino.id })
    expect(esProfe).toBe(true)
    expect(
      comoPostgres(
        `SELECT firma_imagen || '|' || user_agent FROM public.firmas_documentos_centro WHERE id = '${firma}'`
      )
    ).toBe(`${TRAZO}|${UA}`)
    expect(
      comoPostgres(
        `SELECT privado.evento_aplica_a_nino('${evento}', '${nino.id}')::text || '|' || (SELECT count(*) FROM public.acuses_alta WHERE nino_id = '${nino.id}')`
      )
    ).toBe('true|1')
  })

  describe('firmas de los documentos del centro', () => {
    it('la fila (quién firmó y cuándo) la siguen leyendo el tutor legal, el autorizado y la Dirección', async () => {
      for (const u of [legal, autorizado, admin]) {
        const { data, error } = await (await como(u))
          .from('firmas_documentos_centro')
          .select('id, firmante_id, rol_firmante, firmado_at, titulo')
          .eq('id', firma)
        expect.soft(error, u.id).toBeNull()
        expect.soft(data?.[0]?.firmante_id, u.id).toBe(legal.id)
      }
    })

    it('nadie con sesión lee de la tabla el trazo, la IP, el navegador ni el nombre tecleado (42501)', async () => {
      for (const u of [legal, autorizado, admin]) {
        for (const col of ['firma_imagen', 'ip_address', 'user_agent', 'nombre_tecleado']) {
          const { data, error } = await (await como(u))
            .from('firmas_documentos_centro')
            .select(col)
            .eq('id', firma)
          expect.soft(error?.code, `${u.id} ${col}`).toBe('42501')
          expect.soft(data, `${u.id} ${col}`).toBeNull()
        }
      }
    })

    it('control: el contenido sale por la función, al tutor legal y a la Dirección; al autorizado no', async () => {
      for (const u of [legal, admin]) {
        const { data, error } = await (
          await como(u)
        ).rpc('contenido_firmas_documentos', { p_firma_ids: [firma] })
        expect.soft(error, u.id).toBeNull()
        expect.soft(data?.[0]?.firma_imagen, u.id).toBe(TRAZO)
      }
      const { data, error } = await (
        await como(autorizado)
      ).rpc('contenido_firmas_documentos', { p_firma_ids: [firma] })
      expect(error).toBeNull()
      expect(data).toEqual([])
    })

    it('la exportación del usuario entrega su firma con el trazo y el navegador, por la función', async () => {
      const rec = await recolectarUsuario(await como(legal), serviceClient, legal.id)
      const json = JSON.stringify(rec?.data ?? null)
      expect(json).toContain(TRAZO)
      expect(json).toContain(UA)
    })

    it('la exportación del niño (Dirección) entrega la firma con el nombre tecleado, sin el trazo', async () => {
      const rec = await recolectarNino(await como(admin), serviceClient, nino.id)
      const json = JSON.stringify(rec?.data ?? null)
      expect(json).toContain(TECLEADO)
      expect(json).not.toContain(TRAZO)
    })
  })

  describe('confirmaciones de los eventos: solo confirman los padres', () => {
    it('el tutor legal confirma', async () => {
      const { data, error } = await (await como(legal))
        .from('confirmaciones_evento')
        .upsert(
          { evento_id: evento, nino_id: nino.id, estado: 'confirmado', confirmado_por: legal.id },
          { onConflict: 'evento_id,nino_id' }
        )
        .select('id')
        .maybeSingle()
      expect(error).toBeNull()
      expect(data?.id).toBeTruthy()
    })

    it('el autorizado no confirma ni cambia la del tutor legal', async () => {
      const c = await como(autorizado)
      const nueva = await c
        .from('confirmaciones_evento')
        .insert({
          evento_id: evento,
          nino_id: nino.id,
          estado: 'rechazado',
          confirmado_por: autorizado.id,
        })
        .select('id')
        .maybeSingle()
      expect.soft(nueva.error?.code).toBe('42501')
      const cambia = await c
        .from('confirmaciones_evento')
        .update({ estado: 'rechazado', confirmado_por: autorizado.id })
        .eq('evento_id', evento)
        .select('id')
      expect.soft(cambia.data ?? []).toEqual([])
      expect(
        comoPostgres(
          `SELECT estado || '|' || confirmado_por FROM public.confirmaciones_evento WHERE evento_id = '${evento}'`
        )
      ).toBe(`confirmado|${legal.id}`)
    })

    it('el autorizado no lee la confirmación; el tutor legal, la profe y la Dirección sí', async () => {
      const { data: a, error } = await (await como(autorizado))
        .from('confirmaciones_evento')
        .select('estado')
        .eq('evento_id', evento)
      expect(error).toBeNull()
      expect(a).toEqual([])
      for (const u of [legal, profe, admin]) {
        const { data } = await (await como(u))
          .from('confirmaciones_evento')
          .select('estado')
          .eq('evento_id', evento)
        expect.soft(data, u.id).toEqual([{ estado: 'confirmado' }])
      }
    })
  })

  describe('acuses del alta', () => {
    it('los leen el tutor legal y la Dirección; el autorizado, no', async () => {
      for (const u of [legal, admin]) {
        const { data } = await (await como(u))
          .from('acuses_alta')
          .select('tipo')
          .eq('nino_id', nino.id)
        expect.soft(data, u.id).toEqual([{ tipo: 'imagen' }])
      }
      const { data, error } = await (await como(autorizado))
        .from('acuses_alta')
        .select('tipo')
        .eq('nino_id', nino.id)
      expect(error).toBeNull()
      expect(data).toEqual([])
    })
  })
})
