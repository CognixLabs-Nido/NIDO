import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { leerFichaGestionDe } from '@/features/ninos/lib/ficha-gestion'
import { leerTarjetaSanitariaDe } from '@/features/ninos/lib/tarjeta-sanitaria'
import { leerDocumentosNino } from '@/features/documentos-centro/lib/firmar-documentos'
import { filasServicios, sinContestar } from '@/features/peticion-servicios/lib/peticion'
import { leerPeticionServicios } from '@/features/peticion-servicios/queries/leer-peticion-servicios'
import { porContestar } from '@/features/gastos-gestion/lib/gastos'
import { leerGastosGestion } from '@/features/gastos-gestion/queries/leer-gastos-gestion'
import type { Database } from '@/types/db'

import { tutorCompleto } from './datos-tutor'
import { frenaElAlta } from './regla-documentos-alta'
import { leerRespuestaImagen } from './respuesta-imagen'
import { leerTutoresDeNino } from './tutores-familia'

type Client = SupabaseClient<Database>

/**
 * Bloques OBLIGATORIOS del alta que el gate de completitud exige antes de cerrar (con «Finalizar»
 * o, desde la 10b-2, al firmar la ficha). El orden de la lista es el del checklist «qué falta».
 *
 * - `tutor2` es OPCIONAL: solo cuenta si hay segundo tutor y está a medias.
 * - El mandato SEPA no frena (D10): sin él, la familia paga en efectivo.
 * - `imagen`: la RESPUESTA, «sí» o «no», no un «sí» (10a-2, art. 7.4). Con la familia, la de quien
 *   cierra. En el alta en papel, la del tutor legal que firmó el papel, anotada por Dirección: nunca
 *   la de la persona de Dirección (decisión del responsable del 2026-11-18, «Las dos de la 10b-2,
 *   resueltas»). Antes de registrar la firma aquí basta la de uno de los tutores legales del niño:
 *   el que firmó el papel se dice al registrarla, y desde la 10b-3 la base mira la suya.
 * - `tutor_sin_cuenta` (alta en papel): ningún tutor legal tiene todavía cuenta vinculada al niño
 *   (su email era de otra cuenta y está invitado, o falta que acepte). La respuesta de imagen es de
 *   una cuenta (`consentimientos.usuario_id`), así que el alta espera a que acepte la invitación: la
 *   (b) del 2026-11-18, «que la pantalla lo diga con nombre».
 * - `documentos_centro`, `servicios` y `gastos`: con la regla de la base.
 */
export type BloqueAlta =
  | 'identidad'
  | 'tutor1'
  | 'tutor2'
  | 'medico'
  | 'documentos'
  | 'tutor_sin_cuenta'
  | 'imagen'
  | 'documentos_centro'
  | 'servicios'
  | 'gastos'

export const ORDEN_BLOQUES: readonly BloqueAlta[] = [
  'identidad',
  'tutor1',
  'tutor2',
  'medico',
  'documentos',
  'tutor_sin_cuenta',
  'imagen',
  'documentos_centro',
  'servicios',
  'gastos',
]

export type ResultadoGate = { ok: true; faltan: BloqueAlta[] } | { ok: false }

/**
 * Lo que falta para cerrar el alta, leído con la sesión de quien cierra. `{ ok: false }` si algo no
 * se pudo leer: lo que no se leyó no es «falta» ni «está», y no se cierra.
 *
 * `modoPapel`: quien cierra es la Dirección cargando el alta en papel (sin vínculo con el niño); lo
 * decide el servidor (`modoFirmaDocumento`), nunca el navegador.
 */
export async function comprobarAlta(
  supabase: Client,
  ninoId: string,
  usuarioId: string,
  modoPapel: boolean
): Promise<ResultadoGate> {
  const faltan: BloqueAlta[] = []

  // Identidad del menor de la tabla; los hermanos y el libro de familia son de gestión y salen por
  // `ficha_gestion_ninos` (`20270115120000`), que al tutor legal y a la Dirección les contesta.
  const [{ data: identidad }, gestion, tarjeta] = await Promise.all([
    supabase
      .from('ninos')
      .select('apellidos, fecha_nacimiento, lugar_nacimiento, nacionalidad, familia_id, centro_id')
      .eq('id', ninoId)
      .is('deleted_at', null)
      .maybeSingle(),
    leerFichaGestionDe(supabase, ninoId),
    leerTarjetaSanitariaDe(supabase, ninoId),
  ])
  if (!identidad || !gestion || !tarjeta) return { ok: false }
  // Fase 5b y 7: la misma regla que la base (`datos_nino_por_completar`).
  if (
    !identidad.apellidos ||
    !identidad.fecha_nacimiento ||
    !identidad.lugar_nacimiento?.trim() ||
    !identidad.nacionalidad?.trim() ||
    gestion.hermanos_total == null ||
    !tarjeta.sip
  )
    faltan.push('identidad')

  // Tutor 1 y su DNI, del perfil compartido `familia_tutores` (F-2b-3). Un fallo no es «falta».
  const { tutores, leidos, personalesLeidos } = await leerTutoresDeNino(supabase, ninoId)
  // Si falló la función de los personales, un `ve_personales` en falso no es la regla: no se sabe.
  if (!leidos || !personalesLeidos) return { ok: false }
  const tutor1 = tutores.find((t) => t.tipo_vinculo === 'tutor_legal_principal')
  const tutor2 = tutores.find((t) => t.tipo_vinculo === 'tutor_legal_secundario')
  // Fase 6: la regla de la base (`privado.tutor_completo`). Lo que no se pudo leer no es «falta».
  // Pero el tutor con cuenta PROPIA que no es quien cierra no se lee POR LA REGLA de la fase 6 («en
  // cuanto tiene cuenta, el tutor 1 deja de ver sus datos personales»): eso no es un fallo, es que
  // aquí no se puede juzgar. Ese lo juzga la base (`tutor_completo`, SECURITY DEFINER), que frena con
  // `datos_tutor_por_completar` y `faltanDeHint` lo dice. Antes daba `{ ok: false }` siempre que los
  // dos tutores tenían cuenta: ninguna de esas familias podía cerrar desde la app (desde la fase 6,
  // #526; lo destapó el test de la 10b-2 el 2026-11-18).
  const ajeno = (t: (typeof tutores)[number] | undefined) =>
    !!t && !t.ve_personales && t.tiene_cuenta && t.usuario_id !== usuarioId
  if ([tutor1, tutor2].some((t) => t && !t.ve_personales && !ajeno(t))) return { ok: false }
  if (!tutor1 || (!ajeno(tutor1) && !tutorCompleto(tutor1, { conPdf: false })))
    faltan.push('tutor1')
  if (tutor2 && !ajeno(tutor2) && !tutorCompleto(tutor2)) faltan.push('tutor2')

  // El acuse de confidencialidad médica de quien cierra, POR NIÑO (U-3), como la base
  // (`marcar_matricula_lista`, `auth.uid()`).
  const { data: acuse, error: acuseError } = await supabase
    .from('consentimientos')
    .select('id')
    .eq('usuario_id', usuarioId)
    .eq('tipo', 'datos_medicos')
    .eq('nino_id', ninoId)
    .is('revocado_en', null)
    .limit(1)
    .maybeSingle()
  if (acuseError) return { ok: false }
  if (!acuse) faltan.push('medico')

  // Libro de familia (niño) y DNI del tutor 1. El del tutor 2 no se exige.
  if (!gestion.libro_familia_path || !tutor1?.dni_documento_path) faltan.push('documentos')

  // IMAGEN: la respuesta de quien cierra; en papel, la de un tutor legal con cuenta (arriba).
  if (modoPapel) {
    const imagen = await respuestaImagenPapel(supabase, ninoId)
    if (imagen === null) return { ok: false }
    if (imagen === 'sin_cuenta') faltan.push('tutor_sin_cuenta')
    else if (imagen === 'sin_respuesta') faltan.push('imagen')
  } else {
    const imagen = await leerRespuestaImagen(supabase, ninoId, usuarioId)
    if (!imagen.ok) return { ok: false }
    if (imagen.respuesta === null) faltan.push('imagen')
  }

  // Los documentos del centro (4b-2): la lista de la pantalla y la regla de la base.
  const documentosCentro = await leerDocumentosNino(supabase, ninoId)
  if (!documentosCentro.ok) return { ok: false }
  if (documentosCentro.data.some(frenaElAlta)) faltan.push('documentos_centro')

  // Fase 8b y 9, con la regla de la base.
  const peticion = await leerPeticionServicios(supabase, ninoId)
  if (!peticion.ok) return { ok: false }
  if (sinContestar(filasServicios(peticion.opciones), peticion.respuestas).length > 0)
    faltan.push('servicios')
  const gastos = await leerGastosGestion(supabase, ninoId)
  if (!gastos.ok) return { ok: false }
  if (porContestar(gastos.gastos).length > 0) faltan.push('gastos')

  faltan.sort((a, b) => ORDEN_BLOQUES.indexOf(a) - ORDEN_BLOQUES.indexOf(b))
  return { ok: true, faltan }
}

/** Un tutor legal del niño con cuenta: el titular posible de la respuesta en papel. */
export interface TutorLegalConCuenta {
  usuarioId: string
  tipoVinculo: 'tutor_legal_principal' | 'tutor_legal_secundario'
}

/**
 * Los tutores legales del niño con vínculo vivo, que son los que tienen cuenta (el vínculo la exige).
 * Con la sesión de la Dirección, que los lee por `vinculos_admin_all`. `null` si la lectura falla.
 */
export async function leerTutoresLegalesConCuenta(
  supabase: Client,
  ninoId: string
): Promise<TutorLegalConCuenta[] | null> {
  const { data, error } = await supabase
    .from('vinculos_familiares')
    .select('usuario_id, tipo_vinculo')
    .eq('nino_id', ninoId)
    .in('tipo_vinculo', ['tutor_legal_principal', 'tutor_legal_secundario'])
    .is('deleted_at', null)
  if (error || !data) return null
  return data
    .filter((v) => v.usuario_id)
    .map((v) => ({
      usuarioId: v.usuario_id as string,
      tipoVinculo: v.tipo_vinculo as TutorLegalConCuenta['tipoVinculo'],
    }))
    .sort((a, b) => a.tipoVinculo.localeCompare(b.tipoVinculo))
}

/**
 * En el alta en papel: ¿hay respuesta de imagen de algún tutor legal con cuenta? `sin_cuenta` si no
 * hay ninguno; `null` si algo no se pudo leer.
 */
async function respuestaImagenPapel(
  supabase: Client,
  ninoId: string
): Promise<'contestada' | 'sin_respuesta' | 'sin_cuenta' | null> {
  const tutores = await leerTutoresLegalesConCuenta(supabase, ninoId)
  if (tutores === null) return null
  if (tutores.length === 0) return 'sin_cuenta'
  const respuestas = await Promise.all(
    tutores.map((t) => leerRespuestaImagen(supabase, ninoId, t.usuarioId))
  )
  if (respuestas.some((r) => !r.ok)) return null
  return respuestas.some((r) => r.ok && r.respuesta !== null) ? 'contestada' : 'sin_respuesta'
}

/**
 * Lo que falta según el HINT con el que la base frena el cierre (`marcar_matricula_lista`, y
 * `firmar_ficha`, que lo llama). Un bloque que se vació entre el gate y la llamada se dice, no se
 * convierte en «no se pudo». `null` si el HINT no es de completitud.
 */
export function faltanDeHint(hint: string | null | undefined): BloqueAlta[] | null {
  switch (hint) {
    case 'datos_nino_por_completar':
      return ['identidad']
    case 'datos_tutor_por_completar':
      return ['tutor1', 'tutor2']
    // 10b-3 (`20270130120000`): el libro de familia, que hasta entonces solo miraba la app.
    case 'libro_familia_por_subir':
      return ['documentos']
    case 'servicios_por_contestar':
      return ['servicios']
    case 'gastos_por_contestar':
      return ['gastos']
    case 'documentos_por_firmar':
      return ['documentos_centro']
    case 'imagen_sin_respuesta':
      return ['imagen']
    default:
      return null
  }
}
