import 'server-only'

import { esStaff, segmentoRol, type RolNotif } from '../lib/helpers'
import { recolectarNovedades } from '../lib/recolectar'
import type { NovedadItem } from '../types'

/**
 * Feed de novedades por rol: recolecta las novedades del ámbito (RLS por tabla,
 * ignorando las acciones propias del usuario) y añade el `href` según el rol —
 * staff a la ruta admin de autorizaciones, familia a la suya; eventos al calendario.
 * Comparte el recolector con el badge para que **lista y contador cuadren**.
 */
export async function getNovedades(rol: RolNotif, locale: string): Promise<NovedadItem[]> {
  const raw = await recolectarNovedades()

  const autBase = esStaff(rol)
    ? `/${locale}/admin/autorizaciones`
    : `/${locale}/family/autorizaciones`
  const calHref = `/${locale}/${segmentoRol(rol)}/calendario`

  return raw.map((n) => ({
    key: `${n.tipo}-${n.refId}-${n.fecha}`,
    tipo: n.tipo,
    titulo: n.titulo,
    subtitulo: n.subtitulo,
    fecha: n.fecha,
    href: n.tipo === 'evento' ? calHref : `${autBase}/${n.refId}`,
    nuevo: n.nuevo,
    pendienteConfirmacion: n.pendienteConfirmacion,
  }))
}
