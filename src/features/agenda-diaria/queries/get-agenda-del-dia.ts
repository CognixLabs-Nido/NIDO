import 'server-only'

import { createClient } from '@/lib/supabase/server'

import type { AgendaCompleta, AgendaRow } from '../types'

/**
 * Lee la agenda completa de un niño en una fecha concreta:
 *  - cabecera (`agendas_diarias`) — puede ser null si nadie la ha tocado aún.
 *  - eventos hijo (comidas, biberones, sueños, deposiciones).
 * RLS decide qué filas se devuelven. Si el rol no puede ver nada, la
 * cabecera queda null y los arrays vacíos.
 */
export async function getAgendaDelDia(ninoId: string, fecha: string): Promise<AgendaCompleta> {
  const supabase = await createClient()

  const { data: cabecera } = await supabase
    .from('agendas_diarias')
    .select('id, nino_id, fecha, estado_general, humor, observaciones_generales, updated_at')
    .eq('nino_id', ninoId)
    .eq('fecha', fecha)
    .maybeSingle()

  const empty: AgendaCompleta = {
    cabecera: (cabecera as AgendaRow | null) ?? null,
    comidas: [],
    biberones: [],
    suenos: [],
    deposiciones: [],
  }
  if (!cabecera) return empty

  const agendaId = cabecera.id

  const [{ data: comidas }, { data: biberones }, { data: suenos }, { data: deposiciones }] =
    await Promise.all([
      supabase
        .from('comidas')
        .select(
          'id, agenda_id, momento, hora, cantidad, descripcion, observaciones, tipo_plato, menu_dia_id, updated_at'
        )
        .eq('agenda_id', agendaId)
        .order('hora', { ascending: true, nullsFirst: true }),
      supabase
        .from('biberones')
        .select(
          'id, agenda_id, hora, cantidad_ml, tipo, tomado_completo, observaciones, updated_at'
        )
        .eq('agenda_id', agendaId)
        .order('hora', { ascending: true }),
      supabase
        .from('suenos')
        .select('id, agenda_id, hora_inicio, hora_fin, calidad, observaciones, updated_at')
        .eq('agenda_id', agendaId)
        .order('hora_inicio', { ascending: true }),
      supabase
        .from('deposiciones')
        .select('id, agenda_id, hora, tipo, consistencia, cantidad, observaciones, updated_at')
        .eq('agenda_id', agendaId)
        .order('hora', { ascending: true, nullsFirst: true }),
    ])

  return {
    cabecera: cabecera as AgendaRow,
    comidas: (comidas ?? []) as AgendaCompleta['comidas'],
    biberones: (biberones ?? []) as AgendaCompleta['biberones'],
    suenos: (suenos ?? []) as AgendaCompleta['suenos'],
    deposiciones: (deposiciones ?? []) as AgendaCompleta['deposiciones'],
  }
}
