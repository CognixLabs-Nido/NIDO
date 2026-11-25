import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { logger } from '@/shared/lib/logger'
import type { Database } from '@/types/db'

/** Por qué no se sabe si el niño toma sólidos. */
export type CasoSinDatosPedagogicos = 'sin_registro' | 'registro_borrado' | 'lactancia_vacia'

export interface NinoSinDatosPedagogicos {
  id: string
  nombre: string
  apellidos: string | null
  caso: CasoSinDatosPedagogicos
}

/**
 * C (2026-11-23 y 2026-11-24): los niños matriculados (matrícula activa) de los que nadie sabe si
 * toman sólidos, para que la Dirección se lo pida a su familia, como la lista de los que están sin
 * tarjeta sanitaria. Tres casos, los mismos en los que `nino_toma_comida_solida` contesta NULL y el
 * pase de comidas pinta «sin datos pedagógicos»: sin registro, con el registro borrado y con la
 * lactancia sin contestar. Los datos pedagógicos siguen siendo opcionales (Jose, opción B): la lista
 * no obliga a nada, dice a quién pedírselos.
 *
 * `null` si algo no se lee: una lista vacía diría «todos los tienen».
 */
export async function getNinosSinDatosPedagogicos(
  supabase: SupabaseClient<Database>,
  centroId: string
): Promise<NinoSinDatosPedagogicos[] | null> {
  const { data: mats, error } = await supabase
    .from('matriculas')
    .select('nino_id, ninos!inner(id, nombre, apellidos, centro_id, deleted_at)')
    .eq('estado', 'activa')
    .is('fecha_baja', null)
    .is('deleted_at', null)
    .eq('ninos.centro_id', centroId)
    .is('ninos.deleted_at', null)
  if (error || !mats) {
    logger.warn('getNinosSinDatosPedagogicos', error?.code ?? 'sin_respuesta')
    return null
  }
  const ninos = new Map(mats.map((m) => [m.ninos.id, m.ninos]))
  if (ninos.size === 0) return []

  // Todas las filas, también las borradas: la Dirección del centro las ve (`dp_admin_all`), y un
  // registro borrado es uno de los tres casos, no «sin registro».
  const { data: filas, error: errFilas } = await supabase
    .from('datos_pedagogicos_nino')
    .select('nino_id, lactancia_estado, deleted_at')
    .in('nino_id', [...ninos.keys()])
  if (errFilas || !filas) {
    logger.warn('getNinosSinDatosPedagogicos', errFilas?.code ?? 'sin_respuesta')
    return null
  }
  const porNino = new Map(filas.map((f) => [f.nino_id, f]))

  const sin: NinoSinDatosPedagogicos[] = []
  for (const n of ninos.values()) {
    const f = porNino.get(n.id)
    const caso: CasoSinDatosPedagogicos | null = !f
      ? 'sin_registro'
      : f.deleted_at !== null
        ? 'registro_borrado'
        : f.lactancia_estado === null
          ? 'lactancia_vacia'
          : null
    if (caso) sin.push({ id: n.id, nombre: n.nombre, apellidos: n.apellidos, caso })
  }
  return sin.sort((a, b) =>
    `${a.nombre} ${a.apellidos ?? ''}`.localeCompare(`${b.nombre} ${b.apellidos ?? ''}`, 'es')
  )
}
