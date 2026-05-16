import { z } from 'zod'

import type { CantidadComida, EstadoPlantilla, MomentoComida, TipoPlatoComida } from '../types'

const fechaSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'menus.validation.fecha_invalida')

const campoMenuSchema = z.string().max(300, 'menus.validation.campo_largo').nullable()

export const estadoPlantillaEnum = z.enum([
  'borrador',
  'publicada',
  'archivada',
]) satisfies z.ZodType<EstadoPlantilla>

export const momentoComidaEnum = z.enum([
  'desayuno',
  'media_manana',
  'comida',
  'merienda',
]) satisfies z.ZodType<MomentoComida>

export const tipoPlatoEnum = z.enum([
  'primer_plato',
  'segundo_plato',
  'postre',
  'unico',
]) satisfies z.ZodType<TipoPlatoComida>

export const cantidadComidaEnum = z.enum([
  'nada',
  'poco',
  'mitad',
  'mayoria',
  'todo',
]) satisfies z.ZodType<CantidadComida>

export const crearPlantillaMensualSchema = z.object({
  centro_id: z.string().uuid(),
  mes: z.number().int().min(1).max(12),
  anio: z.number().int().min(2024).max(2100),
})

export const menuDiaInputSchema = z.object({
  fecha: fechaSchema,
  desayuno: campoMenuSchema,
  media_manana: campoMenuSchema,
  comida_primero: campoMenuSchema,
  comida_segundo: campoMenuSchema,
  comida_postre: campoMenuSchema,
  merienda: campoMenuSchema,
})

export const guardarMenuMesSchema = z.object({
  plantilla_id: z.string().uuid(),
  menus: z.array(menuDiaInputSchema).min(0).max(40),
})

export const filaPaseDeListaComidaSchema = z.object({
  nino_id: z.string().uuid(),
  tipo_plato: tipoPlatoEnum,
  cantidad: cantidadComidaEnum,
  descripcion: z.string().max(500).nullable(),
})

export const batchRegistrarComidasPlatosSchema = z.object({
  fecha: fechaSchema,
  momento: momentoComidaEnum,
  menu_dia_id: z.string().uuid(),
  filas: z.array(filaPaseDeListaComidaSchema).min(1).max(100),
})

export type CrearPlantillaMensualInput = z.infer<typeof crearPlantillaMensualSchema>
export type MenuDiaInput = z.infer<typeof menuDiaInputSchema>
export type GuardarMenuMesInput = z.infer<typeof guardarMenuMesSchema>
export type FilaPaseDeListaComidaInput = z.infer<typeof filaPaseDeListaComidaSchema>
export type BatchRegistrarComidasPlatosInput = z.infer<typeof batchRegistrarComidasPlatosSchema>
