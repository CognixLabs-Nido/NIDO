import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { logger } from '@/shared/lib/logger'

import { fichaMedicaBloqueadaDesde } from '../lib/ficha-medica-bloqueada'

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

/**
 * Quién leyó, tal como lo puede ver quien mira (20261217120000):
 *  - `nombre`: el nombre de la cuenta; si se purgó, como la dejó la purga;
 *  - `oculto`: quien mira es un tutor y quien leyó es del personal del centro o del soporte. Su
 *    nombre no se da (R4, decisión de Jose del 2026-11-01): se enseña el rol;
 *  - `cuenta_borrada`: la cuenta ya no existe.
 * Un nombre oculto y una cuenta borrada llegan los dos sin nombre: el tipo obliga a no confundirlos.
 */
export type LectorLectura =
  | { tipo: 'nombre'; nombre: string }
  | { tipo: 'oculto' }
  | { tipo: 'cuenta_borrada' }

export interface LecturaFichaMedica {
  leidaEn: string
  lector: LectorLectura
  rol: RolLector
  origen: OrigenLecturaFicha
  campos: CampoFicha[]
}

/**
 * - `no_autorizado`: quien mira no es tutor legal del niño ni Dirección de su centro (42501). La sección no se
 *   enseña.
 * - `bloqueado`: el niño está purgado y el registro se conserva bloqueado (20261205120000): 55000
 *   con la fecha en DETAIL, como la ficha bloqueada. Se dice desde cuándo.
 * - `error`: cualquier otro fallo. Se dice, y nunca se pinta como un registro vacío.
 */
export type RegistroLecturas =
  | { tipo: 'ok'; lecturas: LecturaFichaMedica[] }
  | { tipo: 'no_autorizado' }
  | { tipo: 'bloqueado'; desde: string }
  | { tipo: 'error' }

/** Quién ha leído la ficha médica del niño: lo ven sus tutores legales y la Dirección, siempre. */
export async function getLecturasFichaMedica(ninoId: string): Promise<RegistroLecturas> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc('lecturas_ficha_medica', { p_nino_id: ninoId })
  if (error) {
    if (error.code === '42501') return { tipo: 'no_autorizado' }
    const desde = fichaMedicaBloqueadaDesde(error)
    if (desde) return { tipo: 'bloqueado', desde }
    logger.warn('lecturas de la ficha médica', error.message)
    return { tipo: 'error' }
  }
  return {
    tipo: 'ok',
    lecturas: (data ?? []).map((l) => ({
      leidaEn: l.leida_en,
      lector: l.nombre_oculto
        ? { tipo: 'oculto' }
        : l.lector_nombre
          ? { tipo: 'nombre', nombre: l.lector_nombre }
          : { tipo: 'cuenta_borrada' },
      rol: l.rol_lector as RolLector,
      origen: l.origen as OrigenLecturaFicha,
      campos: (l.campos ?? []) as CampoFicha[],
    })),
  }
}
