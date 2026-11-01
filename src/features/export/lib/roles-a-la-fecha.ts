import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/types/database'
import { historialDeRolesParaExport } from '@/features/centros/contexto/roles-de-otros'
import { fechaMadrid } from '@/features/inicio/lib/ventana-semana'

/**
 * El rol a la fecha de quien hizo algo, para el export art. 15 (R4, decisión de Jose del
 * 2026-11-01): en el fichero que se entrega a la familia va el rol, nunca el nombre de la
 * trabajadora, y el rol que tenía ESE día, no el de hoy: el de hoy sería falso para quien cambió
 * de puesto o se fue, y entregar un dato falso es peor que no entregarlo.
 *
 * De dónde sale cada uno, en este orden:
 *  1. La propia persona interesada del export (el export del usuario): «tú».
 *  2. Su vínculo con el niño vivo ese día (`vinculos_familiares`, de `created_at` a `deleted_at`):
 *     tutor/a legal principal o secundario/a, o persona autorizada.
 *  3. Su rol vivo ese día en el centro (`roles_usuario`, de `created_at` a `deleted_at`):
 *     - admin o directora: «Dirección»;
 *     - profe: su asignación al aula del niño ese día (`profes_aulas`, de `fecha_inicio` a
 *       `fecha_fin`, con su tipo), cruzada con la matrícula del niño en esa aula ese día
 *       (`matriculas`, de `fecha_alta` a `fecha_baja`); sin ella, «personal docente del centro»;
 *     - tutor legal o autorizado sin vínculo con el niño: «familia del centro».
 *  4. El superusuario, que no tiene rol en el centro: «soporte de la plataforma» (decisión del
 *     responsable: que no deje dudas de que es alguien de fuera). Se reconoce por su ENTRADA a
 *     ese centro antes de ese momento (`audit_log`, tabla `entrada_superusuario`): la app la
 *     escribe antes de dejarle elegir el centro (`elegir-centro.ts`), así que no hay nada suyo en
 *     un centro sin una entrada anterior. No se lee `platform_admins`: la app no la toca
 *     (ADR-0061, `platform-admins.test.ts`), y además diría quién es superusuario HOY.
 *  5. Si nada de eso consta: «no consta». Nunca una etiqueta inventada.
 *
 * Una fila de `roles_usuario` que se reactiva no guarda el hueco entre la baja y la vuelta, pero
 * eso no cambia nada aquí: en ese hueco esa persona no tenía rol, y la RLS no le dejaba escribir
 * nada de lo que se etiqueta.
 */

type Client = SupabaseClient<Database>

export const NO_CONSTA = 'no consta'
export const SOPORTE_PLATAFORMA = 'soporte de la plataforma'
export const LA_PERSONA_INTERESADA = 'tú'

const POR_VINCULO: Record<string, string> = {
  tutor_legal_principal: 'tutor/a legal principal',
  tutor_legal_secundario: 'tutor/a legal secundario/a',
  autorizado: 'persona autorizada',
}

const POR_TIPO_EN_AULA: Record<Database['public']['Enums']['tipo_personal_aula'], string> = {
  coordinadora: 'coordinadora del aula',
  profesora: 'profesora del aula',
  tecnico: 'técnico/a del aula',
  apoyo: 'personal de apoyo del aula',
}

interface Periodo {
  desde: string
  hasta: string | null
}

export interface Historia {
  /** Las entradas del superusuario a cada centro (`audit_log`, `entrada_superusuario`). */
  entradasSoporte: Array<{ usuario_id: string; centro_id: string; en: string }>
  roles: Array<{ usuario_id: string; centro_id: string; rol: string } & Periodo>
  vinculos: Array<{ usuario_id: string; nino_id: string; tipo_vinculo: string } & Periodo>
  matriculas: Array<{ nino_id: string; aula_id: string } & Periodo>
  aulas: Array<{ profe_id: string; aula_id: string; tipo_personal_aula: string } & Periodo>
}

export interface PreguntaRol {
  usuarioId: unknown
  fecha: unknown
  centroId: string | null
  ninoId: string | null
  /** La persona interesada del export del usuario; en el del niño, null. */
  sujetoId: string | null
}

/** ¿Estaba vivo ese día? Instantes (timestamptz) o fechas (date), comparados como texto ISO. */
function vivo(p: Periodo, instante: string, dia: string): boolean {
  const corto = p.desde.length === 10
  const t = corto ? dia : instante
  return p.desde <= t && (p.hasta === null || (corto ? t <= p.hasta : t < p.hasta))
}

export function rolALaFecha(h: Historia, q: PreguntaRol): string {
  if (typeof q.usuarioId !== 'string' || typeof q.fecha !== 'string') return NO_CONSTA
  const u = q.usuarioId
  const instante = new Date(q.fecha).toISOString()
  const dia = fechaMadrid(new Date(q.fecha))
  if (q.sujetoId !== null && u === q.sujetoId) return LA_PERSONA_INTERESADA

  if (q.ninoId !== null) {
    const v = h.vinculos.find(
      (x) => x.usuario_id === u && x.nino_id === q.ninoId && vivo(x, instante, dia)
    )
    if (v && POR_VINCULO[v.tipo_vinculo]) return POR_VINCULO[v.tipo_vinculo]
  }

  const roles = h.roles.filter(
    (r) => r.usuario_id === u && r.centro_id === q.centroId && vivo(r, instante, dia)
  )
  if (roles.some((r) => r.rol === 'admin' || r.rol === 'directora')) return 'Dirección'
  if (roles.some((r) => r.rol === 'profe')) {
    if (q.ninoId !== null) {
      const aulasDelNino = new Set(
        h.matriculas
          .filter((m) => m.nino_id === q.ninoId && vivo(m, instante, dia))
          .map((m) => m.aula_id)
      )
      const a = h.aulas.find(
        (x) => x.profe_id === u && aulasDelNino.has(x.aula_id) && vivo(x, instante, dia)
      )
      if (a) return POR_TIPO_EN_AULA[a.tipo_personal_aula as keyof typeof POR_TIPO_EN_AULA]
    }
    return 'personal docente del centro'
  }
  if (roles.some((r) => r.rol === 'tutor_legal' || r.rol === 'autorizado')) {
    return 'familia del centro'
  }
  if (
    h.entradasSoporte.some(
      (e) => e.usuario_id === u && e.centro_id === q.centroId && e.en <= instante
    )
  )
    return SOPORTE_PLATAFORMA
  return NO_CONSTA
}

function falla(que: string, error: { message: string } | null): void {
  if (error)
    throw new Error(`export: la lectura de ${que} (roles a la fecha) falló: ${error.message}`)
}

/**
 * Lo que hace falta para dar los roles, con el cliente de servicio: la sesión de una familia no
 * lee los roles ni las aulas del personal, y el export solo entrega el rol, nunca la fila. Un fallo
 * de lectura rompe el export, como las demás lecturas: un rol mal dado sería un dato falso.
 */
export async function cargarHistoria(
  service: Client,
  p: { usuarioIds: string[]; centroIds: string[]; ninoIds: string[] }
): Promise<Historia> {
  const usuarioIds = [...new Set(p.usuarioIds)]
  const ninoIds = [...new Set(p.ninoIds)]
  const vacia: Historia = {
    entradasSoporte: [],
    roles: [],
    vinculos: [],
    matriculas: [],
    aulas: [],
  }
  if (usuarioIds.length === 0) return vacia

  const centroIds = [...new Set(p.centroIds)]
  const [entradas, roles, vinculos, matriculas] = await Promise.all([
    service
      .from('audit_log')
      .select('usuario_id, centro_id, ts')
      .eq('tabla', 'entrada_superusuario')
      .in('usuario_id', usuarioIds)
      .in('centro_id', centroIds),
    historialDeRolesParaExport(service, centroIds, usuarioIds),
    ninoIds.length
      ? service
          .from('vinculos_familiares')
          .select('usuario_id, nino_id, tipo_vinculo, created_at, deleted_at')
          .in('nino_id', ninoIds)
          .in('usuario_id', usuarioIds)
      : Promise.resolve({ data: [], error: null }),
    ninoIds.length
      ? service
          .from('matriculas')
          .select('nino_id, aula_id, fecha_alta, fecha_baja')
          .in('nino_id', ninoIds)
          .is('deleted_at', null)
      : Promise.resolve({ data: [], error: null }),
  ])
  falla('las entradas del superusuario', entradas.error)
  falla('vinculos_familiares', vinculos.error)
  falla('matriculas', matriculas.error)

  const aulaIds = [...new Set((matriculas.data ?? []).map((m) => m.aula_id))]
  const aulas = aulaIds.length
    ? await service
        .from('profes_aulas')
        .select('profe_id, aula_id, tipo_personal_aula, fecha_inicio, fecha_fin')
        .in('aula_id', aulaIds)
        .in('profe_id', usuarioIds)
        .is('deleted_at', null)
    : { data: [], error: null }
  falla('profes_aulas', aulas.error)

  return {
    entradasSoporte: (entradas.data ?? []).flatMap((e) =>
      e.usuario_id && e.centro_id
        ? [{ usuario_id: e.usuario_id, centro_id: e.centro_id, en: new Date(e.ts).toISOString() }]
        : []
    ),
    roles: roles.map((r) => ({
      usuario_id: r.usuario_id,
      centro_id: r.centro_id,
      rol: r.rol,
      desde: new Date(r.created_at).toISOString(),
      hasta: r.deleted_at ? new Date(r.deleted_at).toISOString() : null,
    })),
    vinculos: (vinculos.data ?? []).map((v) => ({
      usuario_id: v.usuario_id,
      nino_id: v.nino_id,
      tipo_vinculo: v.tipo_vinculo,
      desde: new Date(v.created_at).toISOString(),
      hasta: v.deleted_at ? new Date(v.deleted_at).toISOString() : null,
    })),
    matriculas: (matriculas.data ?? []).map((m) => ({
      nino_id: m.nino_id,
      aula_id: m.aula_id,
      desde: m.fecha_alta,
      hasta: m.fecha_baja,
    })),
    aulas: (aulas.data ?? []).map((a) => ({
      profe_id: a.profe_id,
      aula_id: a.aula_id,
      tipo_personal_aula: a.tipo_personal_aula,
      desde: a.fecha_inicio,
      hasta: a.fecha_fin,
    })),
  }
}
