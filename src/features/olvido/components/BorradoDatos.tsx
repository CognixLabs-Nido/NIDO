import { getTranslations } from 'next-intl/server'

import { Badge } from '@/components/ui/badge'
import { localeIntl } from '@/shared/lib/locale-intl'

import { pedirOlvidoNino, pedirOlvidoUsuario, retirarPeticionOlvido } from '../actions/peticiones'
import { getMisPeticiones, getOpcionesOlvido, leerFalta } from '../queries/get-peticiones'

import { DialogoOlvido } from './DialogoOlvido'
import { FaltaLista } from './FaltaLista'

/**
 * «Borrado de datos» en el perfil (docs/specs/olvido-peticiones.md). El perfil es la única página
 * abierta a cualquier cuenta, tenga rol o no: con la baja del niño la familia pierde el resto de la
 * app, y aquí sigue viendo su petición.
 */
export async function BorradoDatos({ locale, usuarioId }: { locale: string; usuarioId: string }) {
  const t = await getTranslations('olvido.perfil')
  const tEstado = await getTranslations('olvido.estado')
  const [peticiones, opciones] = await Promise.all([getMisPeticiones(), getOpcionesOlvido()])
  const fecha = new Intl.DateTimeFormat(localeIntl(locale), { dateStyle: 'medium' })
  const f = (iso: string | null) => (iso ? fecha.format(new Date(iso)) : '')

  if ((peticiones ?? []).length === 0 && opciones.length === 0) return null

  return (
    <div className="space-y-3 border-t border-dashed border-neutral-200 pt-4">
      <p className="text-muted-foreground text-xs">{t('descripcion')}</p>

      {peticiones === null && <p className="text-muted-foreground text-sm">{t('error_lectura')}</p>}

      {(peticiones ?? []).map((p) => {
        const estado = p.purgado_en ? 'borrada' : p.estado
        const nombre = p.sujeto_tipo === 'nino' ? (p.sujeto_nombre ?? '') : t('cuenta')
        return (
          <div key={p.id} className="space-y-2 rounded-lg border p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-foreground font-medium">
                {nombre} · {p.centro_nombre ?? ''}
              </span>
              <Badge variant={estado === 'rechazada' ? 'destructive' : 'secondary'}>
                {tEstado(estado)}
              </Badge>
            </div>
            <p className="text-muted-foreground text-xs">
              {t('pedida', { fecha: f(p.solicitado_en) })}
              {p.por_plazo
                ? ` · ${t('por_plazo')}`
                : p.pedida_por_centro
                  ? ` · ${t('pedida_por_centro')}`
                  : !p.pedida_por_mi
                    ? ` · ${t('pedida_por_otro')}`
                    : ''}
            </p>
            {estado === 'pendiente' && (
              <>
                <p>{t('en_revision')}</p>
                <FaltaLista falta={leerFalta(p.falta)} />
                {p.nota_centro && (
                  <p className="text-muted-foreground">
                    {t('nota_centro', { nota: p.nota_centro })}
                  </p>
                )}
                {p.puede_retirar && (
                  <DialogoOlvido
                    cta={t('retirar')}
                    titulo={t('retirar')}
                    explicacion={t('retirar_texto')}
                    confirmar={t('retirar')}
                    destructiva
                    variante="ghost"
                    accion={retirarPeticionOlvido.bind(null, p.id)}
                  />
                )}
              </>
            )}
            {estado === 'confirmada' && (
              <p>{t('confirmada', { fecha: f(p.confirmada_en), borrado: f(p.gracia_hasta) })}</p>
            )}
            {estado === 'rechazada' && (
              <p>
                {p.motivo_rechazo
                  ? t('rechazada', { fecha: f(p.rechazada_en), motivo: p.motivo_rechazo })
                  : t('rechazada_sin_motivo', { fecha: f(p.rechazada_en) })}
              </p>
            )}
            {estado === 'retirada' && <p>{t('retirada', { fecha: f(p.retirada_en) })}</p>}
            {estado === 'borrada' && <p>{t('borrada', { fecha: f(p.purgado_en) })}</p>}
          </div>
        )
      })}

      {opciones.map((o) => (
        <div
          key={`${o.sujeto_tipo}-${o.sujeto_id}-${o.centro_id}`}
          className="flex items-center justify-between gap-2"
        >
          <span className="text-foreground text-sm">
            {o.sujeto_tipo === 'nino' ? o.nombre : t('cuenta')} · {o.centro_nombre}
          </span>
          <DialogoOlvido
            cta={t('pedir')}
            titulo={
              o.sujeto_tipo === 'nino'
                ? t('pedir_nino', { nombre: o.nombre })
                : t('pedir_cuenta', { centro: o.centro_nombre })
            }
            explicacion={t('dialogo_texto')}
            confirmar={t('enviar')}
            casilla={{ etiqueta: t('inmediato') }}
            accion={
              o.sujeto_tipo === 'nino'
                ? pedirOlvidoNino.bind(null, o.sujeto_id)
                : pedirOlvidoUsuario.bind(null, usuarioId, o.centro_id)
            }
          />
        </div>
      ))}
    </div>
  )
}
