// PR-13 — cargo puntual a varios niños de golpe (excursiones y similares). Puro y sin
// dependencias (Supabase queda en la acción): testeable como función.
//
// Cada niño elegido recibe una línea MANUAL en el recibo regular del mes de su familia
// (`anadir_cargo_puntual`, una sola transacción). Lo que devuelve la BD es una fila por niño
// con su resultado; aquí se agrupa para contárselo a Dirección.

import { z } from 'zod'

import { eurosACentimos } from '@/shared/lib/format-money'

import type { Database } from '@/types/database'

type EstadoRecibo = Database['public']['Enums']['estado_recibo']

/** Lo que pasó con cada niño. */
export const RESULTADOS_CARGO = ['incluido', 'recibo_nuevo', 'ya_incluido', 'no_incluido'] as const
export type ResultadoCargo = (typeof RESULTADOS_CARGO)[number]

const ESTADOS_RECIBO = [
  'borrador',
  'pendiente_procesar',
  'enviado_banco',
  'devuelto',
  'cobrado_manual',
] as const satisfies readonly EstadoRecibo[]

/** Tope de importe de un cargo: 100 000 € (el mismo que la línea manual). */
export const IMPORTE_MAX_CENTIMOS = 100_000_00

/** El importe tecleado en euros (coma o punto), en céntimos; null si no es un cargo válido. */
export function importeCargo(texto: string): number | null {
  const limpio = texto.trim().replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(limpio)) return null
  const centimos = eurosACentimos(Number(limpio))
  return centimos >= 1 && centimos <= IMPORTE_MAX_CENTIMOS ? centimos : null
}

export const cargoPuntualSchema = z.object({
  centroId: z.string().uuid(),
  anio: z.number().int().min(2024).max(2100),
  mes: z.number().int().min(1).max(12),
  ninoIds: z
    .array(z.string().uuid())
    .min(1, 'cargo_puntual.errors.sin_ninos')
    .max(1000)
    .refine((ids) => new Set(ids).size === ids.length),
  descripcion: z.string().trim().min(1, 'cargo_puntual.errors.sin_descripcion').max(200),
  importeCentimos: z
    .number()
    .int()
    .min(1, 'cargo_puntual.errors.importe_invalido')
    .max(IMPORTE_MAX_CENTIMOS, 'cargo_puntual.errors.importe_invalido'),
  conceptoId: z.string().uuid().nullable().optional(),
})
export type CargoPuntualInput = z.input<typeof cargoPuntualSchema>

/** Una fila de `anadir_cargo_puntual`, validada al llegar. */
export const filaCargoSchema = z.object({
  nino_id: z.string().uuid(),
  familia_id: z.string().uuid(),
  familia_etiqueta: z.string(),
  recibo_id: z.string().uuid(),
  resultado: z.enum(RESULTADOS_CARGO),
  estado: z.enum(ESTADOS_RECIBO),
})
export type FilaCargo = z.infer<typeof filaCargoSchema>

/** Un niño elegible, con su clase (null si no tiene matrícula con aula). */
export interface NinoCargo {
  id: string
  nombre: string
  aula: string | null
}

export interface GrupoAula {
  aula: string | null
  ninos: NinoCargo[]
}

const comparar = new Intl.Collator('es', { sensitivity: 'base' }).compare

/** Los niños por clase, en orden alfabético; los que no tienen clase, al final. */
export function agruparPorAula(ninos: NinoCargo[]): GrupoAula[] {
  const grupos = new Map<string | null, NinoCargo[]>()
  for (const n of ninos) {
    const lista = grupos.get(n.aula) ?? []
    lista.push(n)
    grupos.set(n.aula, lista)
  }
  return [...grupos]
    .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : comparar(a, b)))
    .map(([aula, lista]) => ({
      aula,
      ninos: [...lista].sort((x, y) => comparar(x.nombre, y.nombre)),
    }))
}

/** Cuántos niños de un grupo están elegidos: todos, algunos o ninguno. */
export function marcaGrupo(
  grupo: GrupoAula,
  elegidos: ReadonlySet<string>
): 'todos' | 'algunos' | 'ninguno' {
  const n = grupo.ninos.filter((x) => elegidos.has(x.id)).length
  if (n === 0) return 'ninguno'
  return n === grupo.ninos.length ? 'todos' : 'algunos'
}

/** Elige o quita a todos los niños de un grupo, sin tocar a los demás. */
export function alternarGrupo(
  grupo: GrupoAula,
  elegidos: ReadonlySet<string>,
  elegir: boolean
): Set<string> {
  const next = new Set<string>()
  for (const n of grupo.ninos) {
    if (elegir) next.add(n.id)
    else next.delete(n.id)
  }
  return next
}

export interface FamiliaNoIncluida {
  familia: string
  estado: EstadoRecibo
  ninos: string[]
}

export interface ResumenCargo {
  /** Niños a los que se añadió el cargo. */
  incluidos: number
  /** Familias distintas con el cargo añadido. */
  familias: number
  /** De esas, a cuántas se les creó el recibo del mes. */
  recibosNuevos: number
  /** Niños que ya tenían este mismo cargo: no se duplica. */
  yaIncluidos: string[]
  /** Familias con el recibo ya validado: no se tocan. */
  noIncluidas: FamiliaNoIncluida[]
}

/**
 * El resumen de un cargo, a partir de las filas de la BD. `nombres` traduce el id del niño a
 * su nombre; si falta, se usa el id (no debería pasar: los niños salen de la misma lista).
 */
export function resumirCargo(
  filas: FilaCargo[],
  nombres: ReadonlyMap<string, string>
): ResumenCargo {
  const nombre = (id: string) => nombres.get(id) ?? id
  const familias = new Set<string>()
  const nuevos = new Set<string>()
  const yaIncluidos: string[] = []
  const noIncluidas = new Map<string, FamiliaNoIncluida>()
  let incluidos = 0

  for (const f of filas) {
    if (f.resultado === 'incluido' || f.resultado === 'recibo_nuevo') {
      incluidos++
      familias.add(f.familia_id)
      if (f.resultado === 'recibo_nuevo') nuevos.add(f.familia_id)
    } else if (f.resultado === 'ya_incluido') {
      yaIncluidos.push(nombre(f.nino_id))
    } else {
      const fam = noIncluidas.get(f.familia_id) ?? {
        familia: f.familia_etiqueta,
        estado: f.estado,
        ninos: [],
      }
      fam.ninos.push(nombre(f.nino_id))
      noIncluidas.set(f.familia_id, fam)
    }
  }

  return {
    incluidos,
    familias: familias.size,
    recibosNuevos: nuevos.size,
    yaIncluidos: yaIncluidos.sort(comparar),
    noIncluidas: [...noIncluidas.values()].sort((a, b) => comparar(a.familia, b.familia)),
  }
}
