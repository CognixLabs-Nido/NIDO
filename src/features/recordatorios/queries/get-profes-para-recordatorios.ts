import 'server-only'

import { getProfesCandidatos } from '@/features/profes-aulas/queries/get-profes-candidatos'

export interface ProfeParaRecordatorio {
  id: string
  nombre: string
}

/**
 * Profesoras que un admin puede destinar en un recordatorio `profe_individual`:
 * todo el personal con rol `profe` del centro. Reutiliza `getProfesCandidatos`
 * (mismo pool que el gestor de personal de aula). Solo lo usa el form de admin
 * (la matriz D9 no da `profe_individual` a profe).
 */
export async function getProfesParaRecordatorios(
  centroId: string
): Promise<ProfeParaRecordatorio[]> {
  const candidatos = await getProfesCandidatos(centroId)
  return candidatos.map((c) => ({ id: c.id, nombre: c.nombre_completo }))
}
