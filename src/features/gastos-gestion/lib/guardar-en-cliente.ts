import { declararGastosGestion } from '../actions/declarar-gastos-gestion'
import type { FormaGastos } from './gastos'

export type GuardadoGastos =
  | { ok: true; pendienteValidacion: boolean }
  | { ok: false; error: string }

/**
 * Fase 9 — guarda cómo paga la familia un curso, desde el navegador. Con justificante, por la ruta
 * (`/alta/[ninoId]/justificante-gastos`, que sube con la sesión y declara transferencia); sin él,
 * por la acción. Las dos encolan cuando la base dice que el alta ya está validada.
 */
export async function guardarGastosEnCliente(input: {
  locale: string
  ninoId: string
  cursoId: string
  forma: FormaGastos
  justificante: File | null
}): Promise<GuardadoGastos> {
  if (input.forma === 'transferencia' && input.justificante) {
    const form = new FormData()
    form.append('file', input.justificante)
    form.append('curso_academico_id', input.cursoId)
    let r: Response
    try {
      r = await fetch(`/${input.locale}/alta/${input.ninoId}/justificante-gastos`, {
        method: 'POST',
        body: form,
      })
    } catch {
      return { ok: false, error: 'gastos_gestion.errors.subida' }
    }
    const body = (await r.json().catch(() => null)) as
      | { success: true; pendienteValidacion?: boolean }
      | { success: false; error: string }
      | null
    if (!body) return { ok: false, error: 'gastos_gestion.errors.subida' }
    if (!body.success) return { ok: false, error: body.error }
    return { ok: true, pendienteValidacion: body.pendienteValidacion === true }
  }
  const r = await declararGastosGestion({
    nino_id: input.ninoId,
    curso_academico_id: input.cursoId,
    forma: input.forma,
  })
  if (!r.success) return { ok: false, error: r.error }
  return { ok: true, pendienteValidacion: r.data.pendienteValidacion }
}
