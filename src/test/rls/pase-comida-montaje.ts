import {
  asignarProfeAula,
  asignarRol,
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
} from './setup'

/**
 * Montaje del pase de comidas de HOY para un aula: centro abierto, plantilla publicada con menú del
 * día y los niños matriculados, cada uno con la fila de `datos_pedagogicos_nino` que se le pida
 * (`null` = sin fila). Lo comparten las medidas de los niños sin datos pedagógicos (C, 2026-11-24).
 */
export interface NinoDelPase {
  nombre: string
  /** Columnas de la fila de datos pedagógicos; `null` = el niño no tiene fila. */
  datos: { lactancia_estado: string | null; deleted_at?: string | null } | null
}

export interface PaseMontado {
  centroId: string
  aulaId: string
  profe: TestUser
  admin: TestUser
  ids: string[]
  desmontar: () => Promise<void>
}

export async function montarPaseComida(
  nombreCentro: string,
  hoy: string,
  ninos: NinoDelPase[]
): Promise<PaseMontado> {
  const [anio, mes] = hoy.split('-').map(Number)
  const centro = await createTestCentro(nombreCentro)
  const curso = await createTestCurso(centro.id)
  const aula = await createTestAula(centro.id, curso.id)
  const ids: string[] = []
  for (const n of ninos) {
    const id = (await createTestNino(centro.id, n.nombre)).id
    ids.push(id)
    await matricular(id, aula.id, curso.id)
    if (n.datos) {
      const d = await serviceClient.from('datos_pedagogicos_nino').insert({
        nino_id: id,
        // El tipo generado puede no admitir NULL todavía: la medida pide lo que pide la base.
        lactancia_estado: n.datos.lactancia_estado as 'materna',
        control_esfinteres: 'panal_completo',
        tipo_alimentacion: 'omnivora',
        idiomas_casa: ['es'],
        tiene_hermanos_en_centro: false,
        deleted_at: n.datos.deleted_at ?? null,
      })
      if (d.error) throw new Error(`datos pedagógicos de ${n.nombre}: ${d.error.message}`)
    }
  }
  const admin = await createTestUser({ nombre: `Admin ${nombreCentro}` })
  await asignarRol(admin.id, centro.id, 'admin')
  const profe = await createTestUser({ nombre: `Profe ${nombreCentro}` })
  await asignarRol(profe.id, centro.id, 'profe')
  await asignarProfeAula(profe.id, aula.id, curso.id)
  const dia = await serviceClient
    .from('dias_centro')
    .insert({ centro_id: centro.id, fecha: hoy, tipo: 'lectivo' })
  if (dia.error) throw new Error(`día: ${dia.error.message}`)
  const p = await serviceClient
    .from('plantillas_menu_mensual')
    .insert({ centro_id: centro.id, anio, mes, estado: 'publicada', creada_por: admin.id })
    .select('id')
    .single()
  if (p.error || !p.data) throw new Error(`plantilla: ${p.error?.message}`)
  const m = await serviceClient
    .from('menu_dia')
    .insert({ plantilla_id: p.data.id, fecha: hoy, comida_primero: 'Crema de calabaza' })
  if (m.error) throw new Error(`menú: ${m.error.message}`)

  return {
    centroId: centro.id,
    aulaId: aula.id,
    profe,
    admin,
    ids,
    desmontar: async () => {
      await serviceClient.from('datos_pedagogicos_nino').delete().in('nino_id', ids)
      await serviceClient.from('plantillas_menu_mensual').delete().eq('centro_id', centro.id)
      await serviceClient.from('dias_centro').delete().eq('centro_id', centro.id)
      await deleteTestCentro(centro.id)
      await deleteTestUser(profe.id)
      await deleteTestUser(admin.id)
    },
  }
}
