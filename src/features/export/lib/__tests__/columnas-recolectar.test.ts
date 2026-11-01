import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'

import type { Database } from '@/types/database'

import {
  SECCIONES_RECOLECTAR,
  type DecisionColumnaApp,
  type RutaRecolectar,
} from '../columnas-recolectar'
import { recolectarNino, recolectarUsuario } from '../recolectar'
import { SALE_SIN_REPASAR_2026_11_01 } from './sale-sin-repasar-2026-11-01'

/**
 * La red del export art. 15, la mitad de la app: `recolectar.ts` pide a cada tabla exactamente las
 * columnas que el catálogo decide (`columnas-recolectar.ts`), ninguna lectura pide `*`, entrega solo
 * lo que sale (y el rol en lugar del uuid de quien hizo algo), un fallo de lectura rompe el export, y
 * lo que sale sin repasar solo mengua.
 *
 * Se mide lo que HACE, no lo que pone el fichero: un cliente de mentira apunta a qué tabla va cada
 * lectura y qué columnas pide, devuelve filas con TODAS las columnas del catálogo, y los dos
 * recolectores corren enteros contra él. Que las columnas del catálogo son las de la base de verdad
 * lo prueba `export-columnas.rls.test.ts`.
 */

type Client = SupabaseClient<Database>
type Fila = Record<string, unknown>

interface Llamada {
  tabla: string
  select: string | null
}

interface Respuesta {
  data: unknown
  error: { message: string } | null
}

interface Constructor {
  select(columnas: string): Constructor
  eq(): Constructor
  in(): Constructor
  or(): Constructor
  is(): Constructor
  maybeSingle(): Promise<Respuesta>
  then<A, B = never>(
    ok?: ((r: Respuesta) => A | PromiseLike<A>) | null,
    ko?: ((e: unknown) => B | PromiseLike<B>) | null
  ): Promise<A | B>
}

const catalogo = SECCIONES_RECOLECTAR as Record<
  RutaRecolectar,
  { tabla: string; columnas: Record<string, DecisionColumnaApp> }
>
const rutas = Object.keys(catalogo) as RutaRecolectar[]
const HIJAS = ['comidas', 'biberones', 'suenos', 'deposiciones'] as const

/** Una fila con todas las columnas que el catálogo da a la tabla, en todas sus secciones. */
function filaCompleta(tabla: string, encima: Fila = {}): Fila {
  const f: Fila = {}
  for (const r of rutas)
    if (catalogo[r].tabla === tabla)
      for (const c of Object.keys(catalogo[r].columnas)) f[c] = `v:${c}`
  for (const c of Object.keys(f))
    if (c.endsWith('_at') || c.endsWith('_en')) f[c] = '2026-10-15T10:00:00Z'
  return { ...f, ...encima }
}

/** Filas que hacen recorrer todos los caminos: un hijo, su hilo, una foto suya y gente que actúa. */
const FILAS: Record<string, Fila[]> = {
  usuarios: [filaCompleta('usuarios', { id: 'u1' })],
  roles_usuario: [
    filaCompleta('roles_usuario', { centro_id: 'k1', usuario_id: 'u1' }),
    // Una profe con rol vivo desde septiembre, coordinadora del aula del niño.
    filaCompleta('roles_usuario', {
      centro_id: 'k1',
      usuario_id: 'p2',
      rol: 'profe',
      created_at: '2026-09-01T08:00:00Z',
      deleted_at: null,
    }),
  ],
  matriculas: [{ nino_id: 'n1', aula_id: 'a1', fecha_alta: '2026-09-01', fecha_baja: null }],
  profes_aulas: [
    {
      profe_id: 'p2',
      aula_id: 'a1',
      tipo_personal_aula: 'coordinadora',
      fecha_inicio: '2026-09-01',
      fecha_fin: null,
    },
  ],
  vinculos_familiares: [
    filaCompleta('vinculos_familiares', { tipo_vinculo: 'tutor_legal_principal', nino_id: 'n1' }),
  ],
  conversaciones: [{ id: 'c1', centro_id: 'k1', nino_id: 'n1' }],
  mensajes: [filaCompleta('mensajes', { conversacion_id: 'c1', autor_id: 'u1' })],
  recordatorios: [
    filaCompleta('recordatorios', { centro_id: 'k1', nino_id: null, creado_por: 'p1' }),
  ],
  ninos: [
    filaCompleta('ninos', { id: 'n1', foto_url: null, deleted_reason: null, centro_id: 'k1' }),
  ],
  agendas_diarias: [
    filaCompleta('agendas_diarias', Object.fromEntries(HIJAS.map((h) => [h, [filaCompleta(h)]]))),
  ],
  administraciones_medicacion: [
    filaCompleta('administraciones_medicacion', { administrado_por: 'p1', confirmado_por: 'p2' }),
  ],
  ausencias: [filaCompleta('ausencias', { reportada_por: 'p1' })],
  informes_evolucion: [filaCompleta('informes_evolucion', { creado_por: 'p1' })],
  media_etiquetas: [{ media_id: 'm1', nino_id: 'n1' }],
  media: [{ id: 'm1', bucket: 'aula-fotos', path: 'p', publicacion_id: 'p1', created_at: 'x' }],
  publicaciones: [{ id: 'p1', texto: 't', created_at: 'x' }],
}
for (const t of [
  'consentimientos',
  'cita_invitados',
  'firmas_autorizacion',
  'datos_pedagogicos_nino',
  'asistencias',
  'autorizaciones',
])
  FILAS[t] = [filaCompleta(t)]

function clienteDeMentira(fallaEn?: string) {
  const llamadas: Llamada[] = []
  const client = {
    from(tabla: string) {
      const llamada: Llamada = { tabla, select: null }
      llamadas.push(llamada)
      const respuesta = (): Respuesta =>
        tabla === fallaEn
          ? { data: null, error: { message: 'columna inexistente' } }
          : { data: structuredClone(FILAS[tabla] ?? []), error: null }
      const b: Constructor = {
        select(columnas) {
          llamada.select = columnas
          return b
        },
        eq: () => b,
        in: () => b,
        or: () => b,
        is: () => b,
        maybeSingle: async () => {
          const r = respuesta()
          return r.error ? r : { data: (r.data as Fila[])[0] ?? null, error: null }
        },
        then: (ok, ko) => Promise.resolve(respuesta()).then(ok, ko),
      }
      return b
    },
    rpc: async () => ({ data: null, error: null }),
    storage: {
      from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: 'https://x' } }) }),
    },
  }
  return { client: client as unknown as Client, llamadas }
}

async function recolectarTodo(fallaEn?: string) {
  const { client, llamadas } = clienteDeMentira(fallaEn)
  const u = await recolectarUsuario(client, client, 'u1')
  const n = await recolectarNino(client, client, 'n1')
  return { llamadas, usuario: u!.data, nino: n!.data }
}

/**
 * Lo que pide un `select`, como conjunto: `a, b, hija(c, d)` → `a`, `b`, `hija.c`, `hija.d`. Se
 * calcula aquí, sin las funciones del catálogo: el test no se fía de lo que comprueba.
 */
function pedidas(select: string): string[] {
  const out: string[] = []
  let resto = select
  for (const m of select.matchAll(/(\w+)\(([^()]*)\)/g)) {
    for (const c of m[2].split(',')) out.push(`${m[1]}.${c.trim()}`)
    resto = resto.replace(m[0], '')
  }
  for (const c of resto.split(',')) if (c.trim()) out.push(c.trim())
  return out.sort()
}

/** Se pide lo que sale, lo que el código usa (`seLee`) y el uuid de quien hizo algo (`rol`). */
function seDebenPedir(r: RutaRecolectar, prefijo = ''): string[] {
  return Object.entries(catalogo[r].columnas)
    .filter(([, d]) => !('noSale' in d) || d.seLee !== undefined)
    .map(([c]) => prefijo + c)
}

/** Se entrega lo que sale (`sale` o `saleSinRepasar`) y la clave de cada rol. */
function seDebenEntregar(r: RutaRecolectar): string[] {
  return Object.entries(catalogo[r].columnas)
    .flatMap(([c, d]) => ('rol' in d ? [d.rol] : 'noSale' in d ? [] : [c]))
    .sort()
}

function esperadas(): Array<{ rutas: RutaRecolectar[]; tabla: string; columnas: string[] }> {
  const agenda = rutas.filter((r) => r.startsWith('nino.agendas_diarias.'))
  return [
    ...rutas
      .filter((r) => !agenda.includes(r) && r !== 'nino.agendas_diarias')
      .map((r) => ({ rutas: [r], tabla: catalogo[r].tabla, columnas: seDebenPedir(r).sort() })),
    {
      rutas: ['nino.agendas_diarias', ...agenda],
      tabla: 'agendas_diarias',
      columnas: [
        ...seDebenPedir('nino.agendas_diarias'),
        ...agenda.flatMap((r) => seDebenPedir(r, `${catalogo[r].tabla}.`)),
      ].sort(),
    },
  ]
}

/**
 * Las lecturas que no son una sección del catálogo, cada una con su porqué: no entregan la fila,
 * solo encuentran otras, sacan un dato que se escribe aparte o dan el rol a la fecha. Cualquier otra
 * lectura es un rojo.
 */
const APARTE: Record<string, string> = {
  'conversaciones|centro_id, id, nino_id':
    'encuentra los hilos del sujeto, y su centro y su niño para el rol del autor',
  'media_etiquetas|media_id': 'solo encuentra las fotos del blog donde sale el niño',
  'media_etiquetas|media_id, nino_id': 'cuenta con cuántos niños más sale cada foto',
  'media|bucket, created_at, id, path, publicacion_id':
    'la foto exclusiva sale como enlace firmado; la compartida, como metadata escrita aparte',
  'publicaciones|created_at, id, texto': 'el texto y la fecha de la publicación de la foto',
  'platform_admins|usuario_id':
    'el rol a la fecha: si quien lo hizo es el soporte de la plataforma',
  'roles_usuario|centro_id, created_at, deleted_at, rol, usuario_id':
    'el rol a la fecha: su historia en el centro',
  'vinculos_familiares|created_at, deleted_at, nino_id, tipo_vinculo, usuario_id':
    'el rol a la fecha: su vínculo con el niño ese día',
  'matriculas|aula_id, fecha_alta, fecha_baja, nino_id':
    'el rol a la fecha: el aula del niño ese día',
  'profes_aulas|aula_id, fecha_fin, fecha_inicio, profe_id, tipo_personal_aula':
    'el rol a la fecha: la asignación de la profe al aula del niño ese día',
}

/** Las filas que el export entrega de una sección (la ficha, un objeto; lo demás, listas). */
function entregadas(datos: { usuario: Fila; nino: Fila }, r: RutaRecolectar): Fila[] {
  const [sujeto, clave, hija] = r.split('.')
  const v = datos[sujeto as 'usuario' | 'nino'][clave]
  const lista = (Array.isArray(v) ? v : [v]) as Fila[]
  return hija ? lista.flatMap((a) => a[hija] as Fila[]) : lista
}

describe('la red del export: lo que recolectar.ts pide a cada tabla y lo que entrega', () => {
  it('premisa: los dos recolectores recorren todos sus caminos, también el de los roles', async () => {
    const { llamadas } = await recolectarTodo()
    const tablas = new Set(llamadas.map((l) => l.tabla))
    for (const t of ['mensajes', 'media', 'agendas_diarias', 'platform_admins', 'profes_aulas'])
      expect(tablas, t).toContain(t)
    expect(llamadas.length).toBeGreaterThan(25)
  })

  it('premisa: el cálculo de lo que pide un select lee las embebidas', () => {
    expect(pedidas('a, b, hija(c, d), otra(e)')).toEqual(['a', 'b', 'hija.c', 'hija.d', 'otra.e'])
  })

  it('ninguna lectura pide todas las columnas', async () => {
    for (const l of (await recolectarTodo()).llamadas) {
      expect(l.select, l.tabla).not.toBeNull()
      expect(l.select!, l.tabla).not.toMatch(/\*/)
    }
  })

  it('cada lectura pide a su tabla exactamente lo que el catálogo decide, y cada sección se lee', async () => {
    const { llamadas } = await recolectarTodo()
    const todas = esperadas()
    const leidas = new Set<RutaRecolectar>()
    for (const l of llamadas) {
      const p = pedidas(l.select!)
      const casa = todas.filter((e) => e.tabla === l.tabla && p.join() === e.columnas.join())
      if (casa.length === 0) {
        expect(
          APARTE[`${l.tabla}|${p.join(', ')}`],
          `${l.tabla} se lee con «${p.join(', ')}», que no es ninguna sección del catálogo`
        ).toBeDefined()
      }
      for (const e of casa) for (const r of e.rutas) leidas.add(r)
    }
    expect([...leidas].sort()).toEqual([...rutas].sort())
  })

  it('cada sección entrega exactamente lo que sale y el rol, nunca lo que no sale', async () => {
    const datos = await recolectarTodo()
    for (const r of rutas) {
      const filas = entregadas(datos, r)
      // Premisa: la sección trae al menos una fila, con todas sus columnas.
      expect(filas.length, r).toBeGreaterThan(0)
      for (const f of filas) {
        const claves = Object.keys(f)
          .filter((k) => !HIJAS.includes(k as (typeof HIJAS)[number]))
          .sort()
        expect(claves, r).toEqual(seDebenEntregar(r))
      }
    }
  })

  it('el rol sale en lugar del uuid, y es el de la fecha y no una etiqueta inventada', async () => {
    const { usuario, nino } = await recolectarTodo()
    // El autor del mensaje es la propia persona interesada; el resto, gente sin historia aquí.
    expect((usuario.mensajes as Fila[])[0].autor_rol).toBe('tú')
    expect((usuario.recordatorios_recibidos as Fila[])[0].creado_por_rol).toBe('no consta')
    expect((nino.administraciones_medicacion as Fila[])[0].administrado_por_rol).toBe('no consta')
    expect((nino.administraciones_medicacion as Fila[])[0].confirmado_por_rol).toBe(
      'coordinadora del aula'
    )
    expect(JSON.stringify({ usuario, nino })).not.toMatch(/"p1"|"p2"/)
  })

  it('un fallo de lectura rompe el export, en cada tabla que lee', async () => {
    const tablas = new Set((await recolectarTodo()).llamadas.map((l) => l.tabla))
    // Premisa: sin fallo, los dos terminan.
    await expect(recolectarTodo()).resolves.toBeDefined()
    for (const t of tablas) await expect(recolectarTodo(t), t).rejects.toThrow(/falló/)
  })

  it('lo que sale, sale con su nombre de columna', () => {
    for (const r of rutas)
      for (const [col, d] of Object.entries(catalogo[r].columnas))
        if ('sale' in d) expect(d.sale, `${r}.${col}`).toBe(true)
  })

  it('cada columna que no sale a propósito lleva su porqué, y lo que se lee dice para qué', () => {
    let n = 0
    for (const r of rutas)
      for (const [col, d] of Object.entries(catalogo[r].columnas))
        if ('noSale' in d) {
          n++
          expect(d.noSale.trim().length, `${r}.${col}`).toBeGreaterThanOrEqual(40)
          // El marcador de relleno es «TODO» en mayúsculas y como palabra: «todos» es castellano.
          expect(d.noSale, `${r}.${col}`).not.toMatch(/\bTODO\b/)
          expect(d.noSale, `${r}.${col}`).not.toMatch(/por decidir|sin repasar/i)
          if (d.seLee !== undefined)
            expect(d.seLee.trim().length, `${r}.${col}`).toBeGreaterThan(15)
        }
    // Premisa: las reglas del trozo 2 ya han decidido columnas que no salen.
    expect(n).toBeGreaterThan(50)
  })

  it('el rol se da con la fecha de su propia fila', () => {
    for (const r of rutas)
      for (const [col, d] of Object.entries(catalogo[r].columnas))
        if ('rol' in d) {
          const f = catalogo[r].columnas[d.fecha]
          expect(f, `${r}.${col}: la fecha ${d.fecha} no es de la tabla`).toBeDefined()
          expect('noSale' in f!, `${r}.${col}: la fecha ${d.fecha} no se pide`).toBe(false)
        }
  })

  it('las reglas R1-R7 se cumplen en todo el catálogo, también en las columnas que lleguen', () => {
    // La clase se saca aquí del nombre, sin mirar el catálogo: así una decisión cambiada a mano
    // contra su regla se pone roja, y una columna nueva de una clase técnica hereda su regla.
    const PERSONA = /(^|_)(autor|firmante|usuario|usuario_destinatario)_id$|_por$/
    const tipo = (d: DecisionColumnaApp) =>
      'rol' in d ? 'rol' : 'noSale' in d ? 'noSale' : 'sale' in d ? 'sale' : 'sinRepasar'
    let n = 0
    for (const r of rutas)
      for (const [c, d] of Object.entries(catalogo[r].columnas)) {
        const t = tipo(d)
        const donde = `${r}.${c}`
        if (c === 'created_at' || c === 'updated_at' || c === 'deleted_at') {
          expect(t, `R1/R2 ${donde}`).toBe('sale')
        } else if (c === 'deleted_reason') {
          expect(t, `R2 ${donde}`).toBe(r === 'nino.vinculos_familiares' ? 'noSale' : 'sale')
        } else if (c === 'centro_id') {
          expect(t, `R3 ${donde}`).toBe('noSale')
        } else if (PERSONA.test(c)) {
          expect(['noSale', 'rol'], `R4 ${donde}`).toContain(t)
        } else if (c === 'id' || c.endsWith('_id')) {
          expect(['sale', 'noSale'], `R5 ${donde}`).toContain(t)
        } else if (c === 'ip_address' || c === 'user_agent') {
          expect(t, `R7 ${donde}`).toBe(r === 'nino.firmas' ? 'noSale' : 'sale')
        } else if (c === 'texto_hash' || c === 'texto_version' || c === 'metodo_firma') {
          expect(t, `R7 ${donde}`).toBe('sale')
        } else continue
        n++
      }
    // Premisa: las reglas alcanzan las 146 columnas técnicas que decidieron (2026-11-01).
    expect(n).toBe(146)
  })

  it('lo que sale sin repasar es lo del 2026-11-01, y solo mengua', () => {
    const sinRepasar = rutas.flatMap((r) =>
      Object.entries(catalogo[r].columnas).flatMap(([col, d]) =>
        'saleSinRepasar' in d ? [`${r}.${col}`] : []
      )
    )
    console.warn(`export (app): ${sinRepasar.length} columnas salen sin repasar`)
    expect(sinRepasar.sort()).toEqual([...SALE_SIN_REPASAR_2026_11_01].sort())
  })
})
