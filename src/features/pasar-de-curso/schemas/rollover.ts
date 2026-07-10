import { z } from 'zod'

const uuid = z.string().uuid('rollover.validation.id_invalido')

export const copiarConfigSchema = z.object({
  curso_destino_id: uuid,
  incluir_personal: z.boolean().default(true),
})
export type CopiarConfigInput = z.infer<typeof copiarConfigSchema>

export const proponerMatriculasSchema = z.object({
  curso_destino_id: uuid,
})
export type ProponerMatriculasInput = z.infer<typeof proponerMatriculasSchema>

export const asignarAulaPropuestaSchema = z.object({
  curso_destino_id: uuid,
  nino_id: uuid,
  aula_id: uuid,
})
export type AsignarAulaPropuestaInput = z.infer<typeof asignarAulaPropuestaSchema>

/** F-3-A: marcar a un niño como destino "Finaliza" en el curso destino. */
export const marcarFinalizaSchema = z.object({
  curso_destino_id: uuid,
  nino_id: uuid,
})
export type MarcarFinalizaInput = z.infer<typeof marcarFinalizaSchema>

export const cursoDestinoSchema = z.object({
  curso_destino_id: uuid,
})
export type CursoDestinoInput = z.infer<typeof cursoDestinoSchema>
