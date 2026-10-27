import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import type { OrigenLecturaFicha } from './get-ninos'

/** Por qué pudo leer quien leyó (`lecturas_ficha_medica.rol_lector`, 20261128120000). */
export const ROLES_LECTOR = [
  'admin',
  'directora',
  'superusuario',
  'profe',
  'tutor_legal',
  'autorizado',
] as const
export type RolLector = (typeof ROLES_LECTOR)[number]

/** Los seis campos de la ficha, en el orden en que se enseñan. */
export const CAMPOS_FICHA = [
  'alergias_graves',
  'notas_emergencia',
  'medicacion_habitual',
  'alergias_leves',
  'medico_familia',
  'telefono_emergencia',
] as const
export type CampoFicha = (typeof CAMPOS_FICHA)[number]

/** Desde dónde se leyó (`lecturas_ficha_medica.origen`). */
export const ORIGENES_LECTURA = [
  'ficha',
  'alta',
  'export',
] as const satisfies readonly OrigenLecturaFicha[]

export interface LecturaFichaMedica {
  leidaEn: string
  /** El nombre de la cuenta; si se purgó, como la dejó la purga. NULL si ya no existe. */
  lector: string | null
  rol: RolLector
  origen: OrigenLecturaFicha
  campos: CampoFicha[]
}

/**
 * - `no_autorizado`: quien mira no es tutor legal del niño ni la titular (42501). La sección no se
 *   enseña.
 * - `error`: cualquier otro fallo. Se dice, y nunca se pinta como un registro vacío.
 */
export type RegistroLecturas =
  | { tipo: 'ok'; lecturas: LecturaFichaMedica[] }
  | { tipo: 'no_autorizado' }
  | { tipo: 'error' }

/** Quién ha leído la ficha médica del niño: lo ven sus tutores legales y la titular. */
export async function getLecturasFichaMedica(ninoId: string): Promise<RegistroLecturas> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('lecturas_ficha_medica', { p_nino_id: ninoId })
  if (error) {
    if (error.code === '42501') return { tipo: 'no_autorizado' }
    logger.warn('lecturas de la ficha médica', error.message)
    return { tipo: 'error' }
  }
  return {
    tipo: 'ok',
    lecturas: (data ?? []).map((l) => ({
      leidaEn: l.leida_en,
      lector: l.lector_nombre ?? null,
      rol: l.rol_lector as RolLector,
      origen: l.origen as OrigenLecturaFicha,
      campos: (l.campos ?? []) as CampoFicha[],
    })),
  }
}
