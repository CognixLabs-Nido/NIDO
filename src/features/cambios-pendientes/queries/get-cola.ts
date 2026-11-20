import 'server-only'

import { rolFamiliaDeVinculo, tipoVinculoLegalEnum } from '@/features/alta/schemas/alta-documentos'
import { createClient } from '@/lib/supabase/server'
import { leerFichaGestion } from '@/features/ninos/lib/ficha-gestion'
import { leerTarjetasSanitarias } from '@/features/ninos/lib/tarjeta-sanitaria'
import { logger } from '@/shared/lib/logger'

import {
  payloadGastosGestionSchema,
  payloadMandatoSepaSchema,
  payloadPeticionServiciosSchema,
  type EntidadCambio,
} from '../schemas'

/** Un campo que cambia: lo guardado hoy y lo que se propone. */
export interface LineaCambio {
  campo: string
  antes: string | null
  despues: string | null
}

export interface CambioPendienteItem {
  id: string
  entidad: EntidadCambio
  ninoNombre: string
  solicitante: string
  createdAt: string
  /**
   * Antes → después de cada campo que cambia (2026-11-08, para TODAS las entradas: si unas
   * enseñaran los valores y otras solo el nombre del campo, se aprendería a aprobar las segundas
   * sin mirar). `null`: no se ha podido leer lo guardado, y la pantalla lo dice en vez de enseñar
   * un «antes» que no es.
   */
  lineas: LineaCambio[] | null
}

// La identidad sale de la tabla; el DNI, la dirección, el estado civil y el libro de familia son de
// gestión y salen por `ficha_gestion_ninos` (`20270115120000`), que a la Dirección le contesta.
const CAMPOS_NINO =
  'id, familia_id, nombre, primer_apellido, segundo_apellido, fecha_nacimiento, sexo, nacionalidad, lugar_nacimiento'
const DATOS_TUTOR = [
  'nombre_completo',
  'email',
  'direccion_calle',
  'direccion_numero',
  'direccion_cp',
  'direccion_ciudad',
  // Fase 6 (`20270118120000`): los cinco nuevos, leídos por `tutores_de_familia` (la sesión no los lee).
  'telefono',
  'fecha_nacimiento',
  'dni_numero',
  'estudios',
  'empresa',
] as const

type Fila = Record<string, unknown>

const texto = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))

/** Las claves del parche que cambian, con su valor guardado al lado. */
function lineasDeParche(
  payload: Fila,
  guardado: Fila | null,
  claves: readonly string[] = Object.keys(payload)
) {
  const lineas: LineaCambio[] = []
  for (const campo of claves) {
    if (!(campo in payload)) continue
    const antes = texto(guardado?.[campo])
    const despues = texto(payload[campo])
    if (antes !== despues) lineas.push({ campo, antes, despues })
  }
  return lineas
}

/**
 * F11-G-3 — cola de cambios PENDIENTES para la cola `/admin/pendientes`, del centro de la
 * página (`centroId`): la RLS de `cambios_pendientes` deja ver los de todos los centros donde
 * el usuario es admin. Se ordena y se enriquece con el nombre del niño y del solicitante, y con
 * lo guardado hoy de cada campo que cambia, leído con la misma sesión (la Dirección lee la ficha
 * del niño y los tutores de su centro: aquí no ve nada que no pudiera ver ya).
 * Devuelve [] ante cualquier fallo de la lista (la página no debe romperse por un join).
 */
export async function listarCambiosPendientes(centroId: string): Promise<CambioPendienteItem[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('cambios_pendientes')
    .select(
      'id, entidad, nino_id, payload, created_at, nino:ninos(nombre), solicitante:usuarios!cambios_pendientes_solicitado_por_fkey(nombre_completo)'
    )
    .eq('centro_id', centroId)
    .eq('estado', 'pendiente')
    .order('created_at', { ascending: true })
  if (error) {
    logger.warn('listarCambiosPendientes', error.code ?? 'sin_codigo')
    return []
  }
  const filas = data ?? []

  // Lo guardado hoy: la ficha de cada niño de la cola y los tutores de sus familias. Si una de las
  // dos lecturas falla, sus entradas salen sin «antes» (`lineas: null`), nunca con uno inventado.
  const ninoIds = [...new Set(filas.map((r) => r.nino_id))]
  const ninos = new Map<string, Fila>()
  let ninosOk = true
  if (ninoIds.length > 0) {
    const [r, gestion, tarjetas] = await Promise.all([
      supabase.from('ninos').select(CAMPOS_NINO).in('id', ninoIds),
      leerFichaGestion(supabase, ninoIds),
      // Fase 7: la tarjeta sanitaria, por `sip_de_ninos`.
      leerTarjetasSanitarias(supabase, ninoIds),
    ])
    if (r.error || !gestion || !tarjetas) {
      ninosOk = false
      logger.warn('listarCambiosPendientes: lo guardado del niño', r.error?.code ?? 'gestion')
    } else
      for (const n of r.data ?? []) {
        const g = gestion.get(n.id)
        ninos.set(n.id, {
          ...n,
          dni: g?.dni ?? null,
          direccion_calle: g?.direccion_calle ?? null,
          direccion_numero: g?.direccion_numero ?? null,
          direccion_cp: g?.direccion_cp ?? null,
          direccion_ciudad: g?.direccion_ciudad ?? null,
          direccion_provincia: g?.direccion_provincia ?? null,
          estado_civil_familia: g?.estado_civil_familia ?? null,
          libro_familia_path: g?.libro_familia_path ?? null,
          sip: tarjetas.get(n.id)?.sip ?? null,
          sip_documento_path: tarjetas.get(n.id)?.sip_documento_path ?? null,
        } as Fila)
      }
  }
  const familiaIds = [...new Set([...ninos.values()].map((n) => n.familia_id as string))]
  const tutores = new Map<string, Fila>()
  let tutoresOk = ninosOk
  if (ninosOk && familiaIds.length > 0) {
    // Por `tutores_de_familia`: las cinco columnas de la fase 6 no se leen con la sesión. Sin poder
    // leer lo guardado (`ve_personales`), la cola no enseña un «antes» vacío: dice que no lo sabe.
    const leidas = await Promise.all(
      familiaIds.map(async (f) => ({
        f,
        r: await supabase.rpc('tutores_de_familia', { p_familia_id: f }),
      }))
    )
    for (const { f, r } of leidas) {
      if (r.error || (r.data ?? []).some((t) => !t.ve_personales)) {
        tutoresOk = false
        logger.warn(
          'listarCambiosPendientes: lo guardado del tutor',
          r.error?.code ?? 'sin_permiso'
        )
      } else for (const t of r.data ?? []) tutores.set(`${f}:${t.rol_familia}`, t as Fila)
    }
  }

  // Fase 8b: la petición de servicios guardada de los niños con una entrada suya, y el nombre de
  // cada concepto (la Dirección lee `peticion_servicio` y `conceptos_cobro` de su centro).
  const servicios = await leerServiciosDeLaCola(
    supabase,
    filas.filter((r) => r.entidad === 'peticion_servicios')
  )

  // Fase 9: lo guardado de los gastos de gestión de esos niños (Dirección lee `gastos_gestion`).
  const gastos = await leerGastosDeLaCola(
    supabase,
    filas.filter((r) => r.entidad === 'gastos_gestion')
  )

  // 2026-11-20: los mandatos propuestos y el activo de cada familia (Dirección los lee por
  // `mandatos_sepa_select`). El IBAN sale enmascarado: solo sus cuatro últimas cifras.
  const mandatos = await leerMandatosDeLaCola(
    supabase,
    filas.filter((r) => r.entidad === 'mandato_sepa')
  )

  return filas.map((r) => {
    const entidad = r.entidad as EntidadCambio
    const payload = (r.payload && typeof r.payload === 'object' ? r.payload : {}) as Fila
    const nino = ninos.get(r.nino_id) ?? null
    let lineas: LineaCambio[] | null
    if (!ninosOk || !nino) {
      lineas = null
    } else if (entidad === 'ninos_familia' || entidad === 'ninos_identidad') {
      lineas = lineasDeParche(payload, nino)
    } else if (entidad === 'peticion_servicios') {
      lineas = servicios ? lineasDeServicios(payload, r.nino_id, servicios) : null
    } else if (entidad === 'gastos_gestion') {
      lineas = gastos ? lineasDeGastos(payload, r.nino_id, gastos) : null
    } else if (entidad === 'mandato_sepa') {
      lineas = mandatos ? lineasDeMandato(payload, mandatos) : null
    } else if (entidad === 'ninos_libro_familia') {
      lineas = [{ campo: 'documento', antes: texto(nino.libro_familia_path), despues: 'nuevo' }]
    } else if (entidad === 'ninos_sip_documento') {
      lineas = [{ campo: 'documento', antes: texto(nino.sip_documento_path), despues: 'nuevo' }]
    } else {
      const vinculo = tipoVinculoLegalEnum.safeParse(payload.tipo_vinculo)
      if (!tutoresOk || !vinculo.success) {
        lineas = null
      } else {
        const tutor = tutores.get(`${nino.familia_id}:${rolFamiliaDeVinculo(vinculo.data)}`) ?? null
        lineas =
          entidad === 'datos_tutor'
            ? // Al aprobar se escriben todos los campos (`aplicar.ts`): se enseñan los que cambian.
              lineasDeParche(payload, tutor, DATOS_TUTOR)
            : [{ campo: 'documento', antes: texto(tutor?.dni_documento_path), despues: 'nuevo' }]
      }
    }
    return {
      id: r.id,
      entidad,
      ninoNombre: r.nino?.nombre ?? '',
      solicitante: r.solicitante?.nombre_completo ?? '',
      createdAt: r.created_at,
      lineas,
    }
  })
}

interface MandatoLeido {
  id: string
  familia_id: string | null
  estado: string
  titular: string
  iban_ultimos4: string | null
  documento_path: string | null
}
interface MandatosDeLaCola {
  porId: Map<string, MandatoLeido>
  activoDeFamilia: Map<string, MandatoLeido>
}

/** Los propuestos de la cola y el activo de sus familias; `null` si la lectura falla. */
async function leerMandatosDeLaCola(
  supabase: Awaited<ReturnType<typeof createClient>>,
  filas: { payload: unknown }[]
): Promise<MandatosDeLaCola | null> {
  const vacio: MandatosDeLaCola = { porId: new Map(), activoDeFamilia: new Map() }
  const ids = filas.flatMap((r) => {
    const ok = payloadMandatoSepaSchema.safeParse(r.payload)
    return ok.success ? [ok.data.mandato_id] : []
  })
  if (ids.length === 0) return vacio
  const COLUMNAS = 'id, familia_id, estado, titular, iban_ultimos4, documento_path'
  const p = await supabase.from('mandatos_sepa').select(COLUMNAS).in('id', ids)
  if (p.error) {
    logger.warn('listarCambiosPendientes: los mandatos propuestos', p.error.code ?? 'sin_codigo')
    return null
  }
  for (const m of p.data ?? []) vacio.porId.set(m.id, m)
  const familias = [
    ...new Set((p.data ?? []).map((m) => m.familia_id).filter((f): f is string => f !== null)),
  ]
  if (familias.length > 0) {
    const a = await supabase
      .from('mandatos_sepa')
      .select(COLUMNAS)
      .in('familia_id', familias)
      .eq('estado', 'activo')
      .is('deleted_at', null)
    if (a.error) {
      logger.warn('listarCambiosPendientes: los mandatos activos', a.error.code ?? 'sin_codigo')
      return null
    }
    for (const m of a.data ?? []) if (m.familia_id) vacio.activoDeFamilia.set(m.familia_id, m)
  }
  return vacio
}

const enmascarado = (ultimos4: string | null | undefined) => (ultimos4 ? `••••${ultimos4}` : null)

/**
 * El mandato que se propone frente al activo: el titular, la cuenta (enmascarada) y el documento,
 * siempre (un mandato nuevo es otra firma aunque la cuenta no cambie). `null` si la propuesta no se
 * ha podido leer o ya no está esperando: la pantalla dice que no lo sabe.
 */
function lineasDeMandato(payload: Fila, m: MandatosDeLaCola): LineaCambio[] | null {
  const ok = payloadMandatoSepaSchema.safeParse(payload)
  if (!ok.success) return null
  const propuesto = m.porId.get(ok.data.mandato_id)
  if (!propuesto || propuesto.estado !== 'propuesto') return null
  const activo = propuesto.familia_id ? m.activoDeFamilia.get(propuesto.familia_id) : undefined
  return [
    { campo: 'mandato_titular', antes: activo?.titular ?? null, despues: propuesto.titular },
    {
      campo: 'mandato_iban',
      antes: enmascarado(activo?.iban_ultimos4),
      despues: enmascarado(propuesto.iban_ultimos4),
    },
    { campo: 'documento', antes: texto(activo?.documento_path ?? null), despues: 'nuevo' },
  ]
}

type GastosDeLaCola = Map<string, { forma: string | null; justificante_path: string | null }>

/** `niño:curso` → lo guardado; `null` si la lectura falla (la cola no enseña un «antes» falso). */
async function leerGastosDeLaCola(
  supabase: Awaited<ReturnType<typeof createClient>>,
  filas: { nino_id: string }[]
): Promise<GastosDeLaCola | null> {
  const guardados: GastosDeLaCola = new Map()
  if (filas.length === 0) return guardados
  const g = await supabase
    .from('gastos_gestion')
    .select('nino_id, curso_academico_id, forma, justificante_path')
    .in('nino_id', [...new Set(filas.map((r) => r.nino_id))])
  if (g.error) {
    logger.warn('listarCambiosPendientes: los gastos guardados', g.error.code ?? 'sin_codigo')
    return null
  }
  for (const x of g.data ?? []) guardados.set(`${x.nino_id}:${x.curso_academico_id}`, x)
  return guardados
}

/**
 * Fase 9: la forma, si cambia (`gastos_forma`), y el justificante, si viene (`documento`). Un
 * payload que no valida no se enseña como si estuviera bien: `null`.
 */
function lineasDeGastos(payload: Fila, ninoId: string, g: GastosDeLaCola): LineaCambio[] | null {
  const ok = payloadGastosGestionSchema.safeParse(payload)
  if (!ok.success) return null
  const antes = g.get(`${ninoId}:${ok.data.curso_academico_id}`)
  const lineas: LineaCambio[] = []
  if ((antes?.forma ?? null) !== ok.data.forma)
    lineas.push({ campo: 'gastos_forma', antes: antes?.forma ?? null, despues: ok.data.forma })
  if (ok.data.path !== undefined)
    lineas.push({
      campo: 'documento',
      antes: texto(antes?.justificante_path ?? null),
      despues: 'nuevo',
    })
  return lineas
}

interface ServiciosDeLaCola {
  /** `niño:servicio` → la respuesta guardada, como en `lineasDeServicios`. */
  guardadas: Map<string, { respuesta: string; concepto_id: string | null }>
  nombres: Map<string, string>
}

/** Lo guardado y los nombres de los conceptos; `null` si una lectura falla. */
async function leerServiciosDeLaCola(
  supabase: Awaited<ReturnType<typeof createClient>>,
  filas: { nino_id: string; payload: unknown }[]
): Promise<ServiciosDeLaCola | null> {
  if (filas.length === 0) return { guardadas: new Map(), nombres: new Map() }
  const ninoIds = [...new Set(filas.map((r) => r.nino_id))]
  const pet = await supabase
    .from('peticion_servicio')
    .select('nino_id, servicio, respuesta, concepto_id')
    .in('nino_id', ninoIds)
  if (pet.error) {
    logger.warn('listarCambiosPendientes: la petición guardada', pet.error.code ?? 'sin_codigo')
    return null
  }
  const ids = new Set<string>()
  for (const p of pet.data ?? []) if (p.concepto_id) ids.add(p.concepto_id)
  for (const r of filas) {
    const ok = payloadPeticionServiciosSchema.safeParse(r.payload)
    if (ok.success) for (const x of ok.data.respuestas) if (x.concepto_id) ids.add(x.concepto_id)
  }
  const nombres = new Map<string, string>()
  if (ids.size > 0) {
    const c = await supabase
      .from('conceptos_cobro')
      .select('id, nombre')
      .in('id', [...ids])
    if (c.error) {
      logger.warn('listarCambiosPendientes: los conceptos', c.error.code ?? 'sin_codigo')
      return null
    }
    for (const x of c.data ?? []) nombres.set(x.id, x.nombre)
  }
  const guardadas = new Map<string, { respuesta: string; concepto_id: string | null }>()
  for (const p of pet.data ?? []) guardadas.set(`${p.nino_id}:${p.servicio}`, p)
  return { guardadas, nombres }
}

/**
 * Una línea por servicio que cambia, `servicio_<servicio>`, con el valor como `no`, o
 * `mensual|<concepto>` / `dias_sueltos|<concepto>` (la pantalla lo traduce). Un payload que no
 * valida no se enseña como si estuviera bien: `null`, «no se ha podido leer».
 */
function lineasDeServicios(
  payload: Fila,
  ninoId: string,
  s: ServiciosDeLaCola
): LineaCambio[] | null {
  const ok = payloadPeticionServiciosSchema.safeParse(payload)
  if (!ok.success) return null
  const valor = (r: { respuesta: string; concepto_id: string | null } | undefined) =>
    !r
      ? null
      : r.respuesta === 'no' || !r.concepto_id
        ? r.respuesta
        : `${r.respuesta}|${s.nombres.get(r.concepto_id) ?? ''}`
  return ok.data.respuestas.flatMap((x) => {
    const antes = valor(s.guardadas.get(`${ninoId}:${x.servicio}`))
    const despues = valor(x)
    return antes === despues ? [] : [{ campo: `servicio_${x.servicio}`, antes, despues }]
  })
}

/**
 * Contador de cambios pendientes para el badge del sidebar admin, del centro de la página (la
 * RLS deja ver los de todos sus centros); `head: true` + `count: 'exact'` evita traer filas.
 * 0 ante cualquier fallo.
 */
export async function contarCambiosPendientes(centroId: string): Promise<number> {
  const supabase = await createClient()
  const { count, error } = await supabase
    .from('cambios_pendientes')
    .select('id', { count: 'exact', head: true })
    .eq('centro_id', centroId)
    .eq('estado', 'pendiente')
  if (error) {
    logger.warn('contarCambiosPendientes', error.message)
    return 0
  }
  return count ?? 0
}
