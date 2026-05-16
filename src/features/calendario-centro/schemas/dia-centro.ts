import { z } from 'zod'

import type { Database } from '@/types/database'

export type TipoDiaCentro = Database['public']['Enums']['tipo_dia_centro']

const fechaSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'calendario.validation.fecha_invalida')

const observacionesSchema = z.string().max(500, 'calendario.validation.observaciones_largas')

export const tipoDiaCentroEnum = z.enum([
  'lectivo',
  'festivo',
  'vacaciones',
  'escuela_verano',
  'escuela_navidad',
  'jornada_reducida',
  'cerrado',
]) satisfies z.ZodType<TipoDiaCentro>

export const upsertDiaCentroSchema = z.object({
  centro_id: z.string().uuid(),
  fecha: fechaSchema,
  tipo: tipoDiaCentroEnum,
  observaciones: observacionesSchema.nullable(),
})

export const aplicarTipoARangoSchema = z
  .object({
    centro_id: z.string().uuid(),
    desde: fechaSchema,
    hasta: fechaSchema,
    tipo: tipoDiaCentroEnum,
    observaciones: observacionesSchema.nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.hasta < v.desde) {
      ctx.addIssue({
        code: 'custom',
        path: ['hasta'],
        message: 'calendario.validation.rango_invertido',
      })
      return
    }
    const desde = new Date(`${v.desde}T00:00:00Z`)
    const hasta = new Date(`${v.hasta}T00:00:00Z`)
    const dias = Math.round((hasta.getTime() - desde.getTime()) / 86400000) + 1
    if (dias > 366) {
      ctx.addIssue({
        code: 'custom',
        path: ['hasta'],
        message: 'calendario.validation.rango_demasiado_grande',
      })
    }
  })

export const eliminarDiaCentroSchema = z.object({
  centro_id: z.string().uuid(),
  fecha: fechaSchema,
})

export type UpsertDiaCentroInput = z.infer<typeof upsertDiaCentroSchema>
export type AplicarTipoARangoInput = z.infer<typeof aplicarTipoARangoSchema>
export type EliminarDiaCentroInput = z.infer<typeof eliminarDiaCentroSchema>
