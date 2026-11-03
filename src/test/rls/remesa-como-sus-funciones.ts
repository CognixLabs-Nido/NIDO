import { execFileSync } from 'node:child_process'

/**
 * La marca y el envío de una remesa, y el recibo enviado al banco, puestos como los ponen sus
 * funciones (FICCIÓN DE LOS TESTS).
 *
 * Desde `20261221120000` dos cosas de una remesa solo las pone su función, con un marcador local,
 * y ni la sesión ni service_role pueden por otro camino:
 *  - la marca del fichero (`fichero_generado_at`), `registrar_fichero_remesa` con
 *    `app.registrar_fichero` (trigger `remesas_marca_solo_registro`);
 *  - el paso a enviada, `marcar_remesa_enviada` con `app.marcar_remesa_enviada` (trigger
 *    `remesas_enviada_solo_por_marcar`).
 * Y desde `20261222120000`, una del recibo: el paso a `enviado_banco`, que solo da
 * `marcar_remesa_enviada`, recibo a recibo, con `app.marcar_recibo_enviado` = el id del recibo
 * (trigger `recibos_dinero_solo_por_funcion`).
 *
 * Los tests que necesitan una remesa o un recibo así sin pasar por la función entera (subir el
 * fichero, los adeudos con su mandato), con una marca de hace años o con un recibo enviado fuera de
 * toda remesa, lo preparan aquí: como `postgres`, sin JWT, por psql
 * contra la BD efímera del CI (`DB_URL`, que `rls-local.yml` exporta con `supabase status -o env`),
 * con el mismo marcador. La app no tiene este camino.
 *
 * Fuera del CI no hay `DB_URL` y falla: estos tests solo corren contra la BD efímera.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function comoPostgres(remesaId: string, marcador: string, set: string): void {
  const url = process.env.DB_URL
  if (!url) throw new Error('DB_URL: la remesa solo se prepara así en la BD efímera del CI')
  if (!UUID.test(remesaId)) throw new Error(`remesa-como-sus-funciones: id no válido: ${remesaId}`)
  const sql = [
    'BEGIN;',
    `SELECT set_config('${marcador}', '${remesaId}', true);`,
    `UPDATE public.remesas SET ${set} WHERE id = '${remesaId}' RETURNING 'hecho';`,
    'COMMIT;',
  ].join('\n')
  // Por la entrada estándar y no con `-c`: con `-c` psql solo imprime el resultado del último
  // comando (el COMMIT), y no se vería si el UPDATE tocó la fila.
  const salida = execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-qAt', '-f', '-'], {
    input: sql,
    encoding: 'utf8',
  })
  // El UPDATE tiene que haber tocado la remesa: sin fila, el test no mediría nada.
  if (!salida.split('\n').includes('hecho')) {
    throw new Error(`remesa-como-sus-funciones: la remesa no cambió: ${salida}`)
  }
}

function fechaValida(v: string, que: string): string {
  if (Number.isNaN(new Date(v).getTime()) || !/^[0-9T:.+\-Z ]+$/.test(v))
    throw new Error(`remesa-como-sus-funciones: ${que} no válida: ${v}`)
  return v
}

/**
 * `enviada_at` del fichero de la versión vigente, que ninguna sesión lee (la tabla no tiene
 * privilegios para nadie): en solo lectura, como `postgres`. NULL si no la tiene; `'sin_fichero'`
 * si la remesa no tiene fichero de su marca.
 */
export function enviadaAtDelFichero(remesaId: string): string | null {
  const url = process.env.DB_URL
  if (!url) throw new Error('DB_URL: solo en la BD efímera del CI')
  if (!UUID.test(remesaId)) throw new Error(`remesa-como-sus-funciones: id no válido: ${remesaId}`)
  const sql = [
    'BEGIN READ ONLY;',
    `SELECT coalesce((SELECT coalesce(f.enviada_at::text, 'null') FROM public.remesa_ficheros f
       JOIN public.remesas r ON r.id = f.remesa_id AND f.generado_at = r.fichero_generado_at
      WHERE r.id = '${remesaId}'), 'sin_fichero');`,
    'COMMIT;',
  ].join('\n')
  const salida = execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-qAt', '-f', '-'], {
    input: sql,
    encoding: 'utf8',
  })
  const v = salida.split('\n').find((l) => l.trim() !== '')
  if (v === undefined) throw new Error(`enviadaAtDelFichero: sin salida`)
  return v === 'null' ? null : v
}

/** La marca del fichero, como la pone `registrar_fichero_remesa` (sin el registro). */
export function ponerMarcaComoElRegistro(remesaId: string, marca: string): void {
  comoPostgres(
    remesaId,
    'app.registrar_fichero',
    `fichero_generado_at = '${fechaValida(marca, 'marca')}'`
  )
}

/** La remesa enviada, como la pasa `marcar_remesa_enviada` (sin tocar sus recibos). */
export function marcarEnviadaComoLaFuncion(remesaId: string, fecha: string): void {
  comoPostgres(
    remesaId,
    'app.marcar_remesa_enviada',
    `estado = 'enviada', fecha_envio_banco = '${fechaValida(fecha, 'fecha')}'`
  )
}

/**
 * Los recibos, en `enviado_banco` con su fecha, como los pasa `marcar_remesa_enviada`: uno a uno,
 * cada uno con su marcador. Sin JWT el congelado de mes cerrado actúa igual que dentro de la función
 * llamada con sesión (`auth.role()` no es service_role). Ni la remesa ni su fichero se tocan: los
 * fixtures de un recibo enviado fuera de toda remesa no los tienen.
 */
export function pasarAEnviadoComoMarcar(reciboIds: string[], fecha: string): void {
  const url = process.env.DB_URL
  if (!url) throw new Error('DB_URL: el recibo solo se prepara así en la BD efímera del CI')
  if (reciboIds.length === 0) throw new Error('pasarAEnviadoComoMarcar: sin recibos')
  for (const id of reciboIds)
    if (!UUID.test(id)) throw new Error(`remesa-como-sus-funciones: id no válido: ${id}`)
  const dia = fechaValida(fecha, 'fecha')
  const sql = [
    'BEGIN;',
    ...reciboIds.flatMap((id) => [
      `SELECT set_config('app.marcar_recibo_enviado', '${id}', true);`,
      `UPDATE public.recibos SET estado = 'enviado_banco', fecha_envio_banco = '${dia}' WHERE id = '${id}' RETURNING 'hecho';`,
    ]),
    "SELECT set_config('app.marcar_recibo_enviado', '', true);",
    'COMMIT;',
  ].join('\n')
  const salida = execFileSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-qAt', '-f', '-'], {
    input: sql,
    encoding: 'utf8',
  })
  // Cada UPDATE tiene que haber tocado su recibo: sin fila, el test no mediría nada.
  const hechos = salida.split('\n').filter((l) => l === 'hecho').length
  if (hechos !== reciboIds.length) {
    throw new Error(`pasarAEnviadoComoMarcar: ${hechos} de ${reciboIds.length} recibos: ${salida}`)
  }
}

/**
 * Para los fixtures que crean un recibo ya enviado: la fila sin el envío (pendiente, sin fecha),
 * para insertarla, y la fecha con la que después pasa a enviado por `pasarAEnviadoComoMarcar`.
 * Un INSERT directo en `enviado_banco` lo rechaza `recibos_dinero_solo_por_funcion`.
 */
export function sinEnviado<T extends object>(fila: T): { fila: T; envio: string | null } {
  const { estado, fecha_envio_banco: envio } = fila as {
    estado?: unknown
    fecha_envio_banco?: unknown
  }
  if (estado !== 'enviado_banco') return { fila, envio: null }
  if (typeof envio !== 'string') throw new Error('sinEnviado: un recibo enviado lleva su fecha')
  return { fila: { ...fila, estado: 'pendiente_procesar', fecha_envio_banco: null }, envio }
}
