'use server'

import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'

import { getRequestContext } from '@/features/autorizaciones/lib/request-context'
import { createClient } from '@/lib/supabase/server'

import type { BloqueAlta } from '../lib/gate-alta'
import { firmarFichaNino, leerFichaParaFirmar, pedirRefirmaFicha } from '../lib/ficha-firmada'
import { fichaLegible, type SeccionLegible } from '../lib/ficha-legible'
import { leerTutoresDeNino } from '../lib/tutores-familia'

const ninoIdSchema = z.string().uuid()

export type AbrirFichaResult =
  | { success: true; data: { hash: string; secciones: SeccionLegible[] } }
  | { success: false; error: string }

/**
 * Abre la ficha para firmarla (10b-2): la foto que compone la base, en palabras, y su sello. Deja la
 * fila de la lectura en `lecturas_ficha_medica` (origen `alta`): por eso la pide quien va a firmar,
 * con un botón, y no se lee al pintar el paso.
 */
export async function abrirFichaParaFirmar(ninoId: string): Promise<AbrirFichaResult> {
  const parsed = ninoIdSchema.safeParse(ninoId)
  if (!parsed.success) return { success: false, error: 'alta.firma.errors.invalido' }
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'alta.firma.errors.no_autorizado' }

  const r = await leerFichaParaFirmar(supabase, parsed.data)
  if (!r.ok) return { success: false, error: r.error }
  // Los nombres, para decir de quién es cada respuesta de imagen (la foto la guarda por cuenta).
  const { tutores } = await leerTutoresDeNino(supabase, parsed.data)
  const nombres = new Map(
    tutores.filter((t) => t.usuario_id).map((t) => [t.usuario_id as string, t.nombre_completo])
  )
  const t = await getTranslations()
  return {
    success: true,
    data: {
      hash: r.data.hash,
      secciones: fichaLegible(
        r.data.ficha,
        (k) => t(k),
        (id) => nombres.get(id) ?? null
      ),
    },
  }
}

export type FirmarFichaResult =
  | { success: true; data: { firmaId: string } }
  | { success: false; error: string; faltan?: BloqueAlta[] }

/** Firma la ficha (el tutor legal, con el dedo). Con el alta pendiente, firmar es finalizar. */
export async function firmarFicha(input: unknown): Promise<FirmarFichaResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'alta.firma.errors.no_autorizado' }
  const r = await firmarFichaNino(supabase, user.id, input, await getRequestContext())
  if (!r.ok) return { success: false, error: r.error, faltan: r.faltan }
  revalidatePath('/[locale]/alta/[ninoId]', 'page')
  revalidatePath('/[locale]/family/nino/[id]', 'page')
  return { success: true, data: r.data }
}

/** Dirección pide que se vuelva a firmar la ficha. Nada automático: lo pide una persona. */
export async function pedirRefirmaFichaAction(
  ninoId: string
): Promise<{ success: true; data: { id: string } } | { success: false; error: string }> {
  const parsed = ninoIdSchema.safeParse(ninoId)
  if (!parsed.success) return { success: false, error: 'alta.firma.errors.invalido' }
  const supabase = await createClient()
  const r = await pedirRefirmaFicha(supabase, parsed.data)
  if (!r.ok) return { success: false, error: r.error }
  revalidatePath('/[locale]/admin/ninos/[id]', 'page')
  return { success: true, data: r.data }
}
