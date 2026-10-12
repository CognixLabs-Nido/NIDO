import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  asignarRol,
  createTestAula,
  createTestCentro,
  createTestCurso,
  createTestNino,
  createTestUser,
  deleteTestCentro,
  deleteTestUser,
  serviceClient,
  type TestUser,
} from '../rls/setup'

/**
 * Purga RGPD y `lista_espera`: la tabla real Y su copia en audit_log.
 *
 * - `purgar_sujeto_db` (rama del niño) no tocaba `lista_espera`: el prospecto del niño purgado
 *   seguía con su nombre, apellidos, fecha de nacimiento y el teléfono y el email del tutor.
 * - `purgar_sujeto_db` (rama del usuario) no limpiaba el teléfono ni el email del tutor en sus
 *   prospectos (`tutor_usuario_id`).
 * - La copia en audit_log: `_claves_pii_nino` no tenía rama para `lista_espera` y el INSERT del
 *   prospecto (que nace con `nino_id` NULL) no lo alcanzaba ninguna redacción.
 * - `purgar_esqueleto_huerfano_nino` conserva el prospecto a propósito (U-4): no se toca.
 *
 * Cada caso siembra prospectos con marcadores únicos, ejecuta la purga y vuelca lo que queda.
 */

const BORRADO = '[borrado]'

// Columnas personales de lista_espera (information_schema, 2026-10-12).
const CLAVES_NINO = [
  'nombre_nino',
  'apellidos_nino',
  'fecha_nacimiento',
  'telefono_tutor',
  'email_tutor',
  'nota',
] as const
const CLAVES_TUTOR = ['telefono_tutor', 'email_tutor'] as const

type FilaAudit = {
  accion: string
  registro_id: string | null
  valores_antes: Record<string, unknown> | null
  valores_despues: Record<string, unknown> | null
}

type Fuga = { accion: string; lado: string; campo: string; valor: string }

interface Prospecto {
  id: string
  marcas: string[]
}

describe('Purga RGPD — lista_espera, tabla y audit_log', () => {
  let centro: { id: string }
  let curso: { id: string }
  let aula: { id: string }
  let otroCentro: { id: string }
  let otroCurso: { id: string }
  const usuarios: TestUser[] = []
  const solicitudes: string[] = []

  beforeAll(async () => {
    centro = await createTestCentro('Centro Purga Lista Espera')
    curso = await createTestCurso(centro.id)
    aula = await createTestAula(centro.id, curso.id)
    otroCentro = await createTestCentro('Centro Purga Lista Espera Otro')
    otroCurso = await createTestCurso(otroCentro.id)
  }, 120_000)

  afterAll(async () => {
    if (solicitudes.length) {
      await serviceClient.from('olvido_solicitudes').delete().in('id', solicitudes)
    }
    await deleteTestCentro(centro.id)
    await deleteTestCentro(otroCentro.id)
    for (const u of usuarios) await deleteTestUser(u.id)
  }, 120_000)

  /**
   * Un prospecto con todas sus columnas personales marcadas. Nace sin `nino_id`, como en la app,
   * y se enlaza después (la promoción de U-4 hace UPDATE): su INSERT en audit_log no lleva niño.
   */
  async function prospecto(opts: {
    cursoId: string
    ninoId?: string
    tutorUsuarioId?: string
  }): Promise<Prospecto> {
    const s = randomUUID().slice(0, 8)
    const marcas: string[] = []
    const marca = (campo: string) => {
      const v = `LE-${campo}-${s}`
      marcas.push(v)
      return v
    }
    const { data, error } = await serviceClient
      .from('lista_espera')
      .insert({
        centro_id: centro.id, // lo reescribe el trigger desde el curso
        curso_academico_id: opts.cursoId,
        nombre_nino: marca('nombre'),
        apellidos_nino: marca('apellidos'),
        fecha_nacimiento: '2024-03-15',
        telefono_tutor: marca('tel'),
        email_tutor: `${marca('email')}@correo.test`,
        nota: marca('nota'),
        posicion: 1,
        tutor_usuario_id: opts.tutorUsuarioId ?? null,
      })
      .select('id')
      .single()
    expect(error).toBeNull()
    if (opts.ninoId) {
      const { error: uErr } = await serviceClient
        .from('lista_espera')
        .update({ estado: 'invitado', nino_id: opts.ninoId })
        .eq('id', data!.id)
      expect(uErr).toBeNull()
    }
    return { id: data!.id, marcas }
  }

  async function filaDe(p: Prospecto) {
    const { data, error } = await serviceClient
      .from('lista_espera')
      .select(
        'nino_id, nombre_nino, apellidos_nino, fecha_nacimiento, telefono_tutor, email_tutor, nota'
      )
      .eq('id', p.id)
      .maybeSingle()
    expect(error).toBeNull()
    return data
  }

  async function auditDe(p: Prospecto): Promise<FilaAudit[]> {
    const { data, error } = await serviceClient
      .from('audit_log')
      .select('accion, registro_id, valores_antes, valores_despues')
      .eq('tabla', 'lista_espera')
      .eq('registro_id', p.id)
    expect(error).toBeNull()
    return (data ?? []) as FilaAudit[]
  }

  /** Lo que sigue legible: una clave de la lista con valor, o un marcador en cualquier campo. */
  function fugasEn(filas: FilaAudit[], marcas: string[], claves: readonly string[]): Fuga[] {
    const fugas: Fuga[] = []
    for (const f of filas) {
      for (const [lado, valores] of [
        ['antes', f.valores_antes],
        ['despues', f.valores_despues],
      ] as const) {
        if (!valores) continue
        for (const [campo, v] of Object.entries(valores)) {
          const enLista = claves.includes(campo)
          const legible = v !== null && v !== BORRADO
          const t = JSON.stringify(v)
          const conMarca = marcas.some((mk) => t.includes(mk))
          if ((enLista && legible) || (!enLista && conMarca)) {
            fugas.push({ accion: f.accion, lado, campo, valor: corto(v) })
          }
        }
      }
    }
    return fugas
  }

  function volcar(nombre: string, fila: unknown, filas: FilaAudit[], fugas: Fuga[]) {
    const porAccion: Record<string, number> = {}
    for (const f of filas) porAccion[f.accion] = (porAccion[f.accion] ?? 0) + 1
    console.warn(`${nombre}: fila en lista_espera =`, JSON.stringify(fila))
    console.warn(`${nombre}: ${filas.length} filas de audit_log`, JSON.stringify(porAccion))
    if (fugas.length > 0) console.warn(`FUGA ${nombre} (${fugas.length}):`, JSON.stringify(fugas))
    else console.warn(`CIERRE ${nombre}: ninguna clave personal sin redactar`)
  }

  async function nuevoUsuario(nombre: string, rol: 'tutor_legal' | 'admin') {
    const u = await createTestUser({ nombre })
    usuarios.push(u)
    await asignarRol(u.id, centro.id, rol)
    return u
  }

  it('purgar_sujeto_db (niño): borra su prospecto y redacta su copia en audit_log, también el INSERT', async () => {
    const nino = await createTestNino(centro.id)
    const suyo = await prospecto({ cursoId: curso.id, ninoId: nino.id })
    // Controles: el prospecto de OTRO niño del mismo centro y uno de OTRO centro.
    const otroNino = await createTestNino(centro.id)
    const deOtro = await prospecto({ cursoId: curso.id, ninoId: otroNino.id })
    const ninoAjeno = await createTestNino(otroCentro.id)
    const ajeno = await prospecto({ cursoId: otroCurso.id, ninoId: ninoAjeno.id })

    const { data: solicitud, error: sErr } = await serviceClient.rpc('solicitar_olvido_nino', {
      p_nino_id: nino.id,
      p_inmediato: true,
    })
    expect(sErr).toBeNull()
    solicitudes.push(solicitud as string)
    const { error: pErr } = await serviceClient.rpc('purgar_sujeto_db', {
      p_solicitud_id: solicitud as string,
    })
    expect(pErr).toBeNull()

    const fila = await filaDe(suyo)
    const filas = await auditDe(suyo)
    const fugas = fugasEn(filas, suyo.marcas, CLAVES_NINO)
    volcar('purga niño', fila, filas, fugas)

    // La tabla real: la fila entera fuera.
    expect(fila).toBeNull()
    // Su copia en audit_log: el INSERT (sin nino_id), la promoción y el DELETE de la purga.
    expect(filas.map((f) => f.accion).sort()).toEqual(['DELETE', 'INSERT', 'UPDATE'])
    expect(fugas).toEqual([])

    // Los controles, intactos en la tabla y en audit_log.
    for (const p of [deOtro, ajeno]) {
      const f = await filaDe(p)
      expect(f?.nombre_nino).toBe(p.marcas[0])
      expect(f?.telefono_tutor).toBe(p.marcas[2])
      expect(fugasEn(await auditDe(p), p.marcas, CLAVES_NINO).length).toBeGreaterThan(0)
    }
  })

  it('purgar_sujeto_db (usuario): limpia el teléfono y el email del tutor en sus prospectos', async () => {
    const tutor = await nuevoUsuario('Tutor Purga Lista Espera', 'tutor_legal')
    const otroTutor = await nuevoUsuario('Otro Tutor Purga Lista Espera', 'tutor_legal')
    const delTutor = await prospecto({ cursoId: curso.id, tutorUsuarioId: tutor.id })
    const deOtroTutor = await prospecto({ cursoId: curso.id, tutorUsuarioId: otroTutor.id })

    const { data: solicitud, error: sErr } = await serviceClient.rpc('solicitar_olvido_usuario', {
      p_usuario_id: tutor.id,
      p_inmediato: true,
    })
    expect(sErr).toBeNull()
    solicitudes.push(solicitud as string)
    const { error: pErr } = await serviceClient.rpc('purgar_sujeto_db', {
      p_solicitud_id: solicitud as string,
    })
    expect(pErr).toBeNull()

    const fila = await filaDe(delTutor)
    const filas = await auditDe(delTutor)
    const marcasTutor = delTutor.marcas.filter((m) => m.includes('-tel-') || m.includes('-email-'))
    const fugas = fugasEn(filas, marcasTutor, CLAVES_TUTOR)
    volcar('purga tutor', fila, filas, fugas)

    // La tabla real: el prospecto sigue (es del niño, no del tutor), sin su teléfono ni su email.
    expect(fila).not.toBeNull()
    expect(fila?.telefono_tutor).toBeNull()
    expect(fila?.email_tutor).toBeNull()
    expect(fila?.nombre_nino).toBe(delTutor.marcas[0])
    // Su copia en audit_log, sin el teléfono ni el email del tutor.
    expect(filas.length).toBeGreaterThan(0)
    expect(fugas).toEqual([])

    // El prospecto de otro tutor, intacto.
    const otra = await filaDe(deOtroTutor)
    expect(otra?.telefono_tutor).toBe(deOtroTutor.marcas[2])
    expect(otra?.email_tutor).toBe(`${deOtroTutor.marcas[3]}@correo.test`)
  })

  it('purgar_esqueleto_huerfano_nino: conserva el prospecto en la tabla (U-4)', async () => {
    const nino = await createTestNino(centro.id)
    const { error: mErr } = await serviceClient.from('matriculas').insert({
      nino_id: nino.id,
      aula_id: aula.id,
      curso_academico_id: curso.id,
      estado: 'pendiente',
    })
    expect(mErr).toBeNull()
    const { error: iErr } = await serviceClient.from('invitaciones').insert({
      email: `le-esq-${randomUUID().slice(0, 8)}@nido.test`,
      rol_objetivo: 'tutor_legal',
      centro_id: centro.id,
      nino_id: nino.id,
      tipo_vinculo: 'tutor_legal_principal',
      expires_at: new Date(Date.now() - 40 * 864e5).toISOString(),
    })
    expect(iErr).toBeNull()
    const suyo = await prospecto({ cursoId: curso.id, ninoId: nino.id })

    const { error } = await serviceClient.rpc('purgar_esqueleto_huerfano_nino', {
      p_nino_id: nino.id,
      p_cutoff: new Date(Date.now() - 30 * 864e5).toISOString(),
    })
    expect(error).toBeNull()

    const fila = await filaDe(suyo)
    console.warn('esqueleto: fila en lista_espera =', JSON.stringify(fila))
    // El prospecto se queda en admisiones, sin enlace al niño borrado (ON DELETE SET NULL).
    expect(fila?.nino_id).toBeNull()
    expect(fila?.nombre_nino).toBe(suyo.marcas[0])
    expect(fila?.telefono_tutor).toBe(suyo.marcas[2])
  })

  it('retroactiva: redacta la auditoría de los prospectos de niños que ya no existen o ya purgados', async () => {
    // Un niño borrado antes de esta migración, sin purga: el prospecto pierde el enlace.
    const borrado = await createTestNino(centro.id)
    const deBorrado = await prospecto({ cursoId: curso.id, ninoId: borrado.id })
    const { error: dErr } = await serviceClient.from('ninos').delete().eq('id', borrado.id)
    expect(dErr).toBeNull()
    // Un niño purgado antes de esta migración (marcado como la purga, sin pasar por ella).
    const purgado = await createTestNino(centro.id)
    const dePurgado = await prospecto({ cursoId: curso.id, ninoId: purgado.id })
    const { error: pErr } = await serviceClient
      .from('ninos')
      .update({ deleted_at: new Date().toISOString(), deleted_reason: 'purga_rgpd' })
      .eq('id', purgado.id)
    expect(pErr).toBeNull()
    // Un niño vivo: su prospecto no se toca.
    const vivo = await createTestNino(centro.id)
    const deVivo = await prospecto({ cursoId: curso.id, ninoId: vivo.id })

    for (const p of [deBorrado, dePurgado]) {
      expect(fugasEn(await auditDe(p), p.marcas, CLAVES_NINO).length).toBeGreaterThan(0)
    }

    const { data: n, error } = await serviceClient.rpc('_redactar_auditoria_lista_espera_retro')
    expect(error).toBeNull()
    expect(n).toBeGreaterThan(0)

    for (const [nombre, p] of [
      ['retro niño borrado', deBorrado],
      ['retro niño purgado', dePurgado],
    ] as const) {
      const filas = await auditDe(p)
      const fugas = fugasEn(filas, p.marcas, CLAVES_NINO)
      volcar(nombre, await filaDe(p), filas, fugas)
      expect(filas.some((f) => f.accion === 'INSERT')).toBe(true)
      expect(fugas).toEqual([])
    }

    // El vivo conserva su auditoría tal cual.
    expect(fugasEn(await auditDe(deVivo), deVivo.marcas, CLAVES_NINO).length).toBeGreaterThan(0)
  })
})

function corto(v: unknown): string {
  const t = typeof v === 'string' ? v : JSON.stringify(v)
  return t.length > 60 ? `${t.slice(0, 57)}...` : t
}
