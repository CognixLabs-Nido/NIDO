import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { requireContextoCentro } from '@/features/centros/contexto/get-contexto-centro'
import {
  confirmarPeticionOlvido,
  darDeudaPorPerdida,
  deshacerConfirmacionOlvido,
  guardarNotaPeticionOlvido,
  rechazarPeticionOlvido,
} from '@/features/olvido/actions/peticiones'
import { DialogoOlvido } from '@/features/olvido/components/DialogoOlvido'
import { FaltaLista } from '@/features/olvido/components/FaltaLista'
import {
  diasDesde,
  getPeticionesCentro,
  leerDeuda,
  leerFalta,
  type PeticionCentro,
} from '@/features/olvido/queries/get-peticiones'
import { localeIntl } from '@/shared/lib/locale-intl'

interface PageProps {
  params: Promise<{ locale: string }>
}

/** A partir de estos días abierta, la petición se marca: el plazo legal de respuesta es un mes. */
const DIAS_AVISO = 25

/**
 * Peticiones de borrado (docs/specs/olvido-peticiones.md), solo para la titular, como Auditoría.
 * Las abiertas primero, y entre ellas las listas para confirmar; después las cerradas de los
 * últimos 90 días. Lo que falta se calcula en el momento, también de las confirmadas que esperan
 * en la purga. Cuando lo único que falta es la deuda de la familia, la admin puede renunciar a ella
 * (PR-B1); el superusuario no: a él la BD le contesta 42501, así que no se le enseña el botón.
 */
export default async function OlvidoPage({ params }: PageProps) {
  const { locale } = await params
  const t = await getTranslations('olvido.admin')
  const tEstado = await getTranslations('olvido.estado')
  const { centroId, esResponsable, esSuperusuario } = await requireContextoCentro(locale)
  if (!esResponsable) redirect(`/${locale}/forbidden`)
  const esAdmin = !esSuperusuario

  const peticiones = await getPeticionesCentro(centroId)
  const fecha = new Intl.DateTimeFormat(localeIntl(locale), { dateStyle: 'medium' })
  const euros = new Intl.NumberFormat(localeIntl(locale), { style: 'currency', currency: 'EUR' })
  const f = (iso: string | null) => (iso ? fecha.format(new Date(iso)) : '')
  const ahora = new Date()

  const abierta = (p: PeticionCentro) =>
    p.purgado_en === null && (p.estado === 'pendiente' || p.estado === 'confirmada')
  const lista = (p: PeticionCentro) =>
    p.estado === 'pendiente' && leerFalta(p.falta).bloqueos.length === 0
  const abiertas = (peticiones ?? [])
    .filter(abierta)
    .sort((a, b) => Number(lista(b)) - Number(lista(a)))
  const cerradas = (peticiones ?? []).filter((p) => !abierta(p)).reverse()

  function Tarjeta({ p }: { p: PeticionCentro }) {
    const falta = leerFalta(p.falta)
    const deuda = leerDeuda(p.deuda)
    const importe = deuda ? euros.format(deuda.centimos / 100) : ''
    const estado = p.purgado_en ? 'borrada' : p.estado
    const dias = diasDesde(p.solicitado_en, ahora)
    return (
      <div className="space-y-2 p-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="space-y-0.5">
            <p className="text-foreground font-medium">
              {p.sujeto_nombre ?? ''}{' '}
              <span className="text-muted-foreground font-normal">
                · {p.sujeto_tipo === 'nino' ? t('nino') : t('cuenta')}
              </span>
            </p>
            <p className="text-muted-foreground text-xs">
              {p.por_plazo
                ? t('por_plazo', { fecha: f(p.solicitado_en) })
                : p.pedida_por_centro
                  ? t('pedida_por_centro', { fecha: f(p.solicitado_en) })
                  : t('pedida_por', {
                      nombre: p.solicitado_por_nombre ?? '',
                      fecha: f(p.solicitado_en),
                    })}
              {p.inmediato ? ` · ${t('inmediato_marca')}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {estado === 'pendiente' && (
              <Badge variant={dias >= DIAS_AVISO ? 'warning' : 'outline'}>
                {t('dias', { dias })}
              </Badge>
            )}
            {lista(p) && <Badge variant="success">{t('lista')}</Badge>}
            <Badge variant={estado === 'rechazada' ? 'destructive' : 'secondary'}>
              {tEstado(estado)}
            </Badge>
          </div>
        </div>

        {estado === 'pendiente' && (
          <>
            <FaltaLista falta={falta} />
            {deuda && (
              <div className="space-y-1">
                <p>{t('deuda', { importe, n: deuda.n })}</p>
                {!deuda.perdible && deuda.noPerdible && (
                  <p className="text-muted-foreground">
                    {t(`deuda_no_perdible.${deuda.noPerdible}`)}
                  </p>
                )}
              </div>
            )}
            {p.nota_centro && (
              <p className="text-muted-foreground">{t('nota_actual', { nota: p.nota_centro })}</p>
            )}
            <div className="flex flex-wrap gap-2">
              {falta.bloqueos.length === 0 && (
                <DialogoOlvido
                  cta={t('confirmar')}
                  titulo={t('confirmar_titulo')}
                  explicacion={p.inmediato ? t('confirmar_inmediato_texto') : t('confirmar_texto')}
                  confirmar={t('confirmar')}
                  destructiva
                  variante="default"
                  accion={confirmarPeticionOlvido.bind(null, p.id)}
                />
              )}
              {deuda?.perdible && esAdmin && (
                <DialogoOlvido
                  cta={t('dar_por_perdida')}
                  titulo={t('dar_por_perdida_titulo')}
                  explicacion={t('dar_por_perdida_texto', {
                    importe,
                    n: deuda.n,
                    nombre: p.sujeto_nombre ?? '',
                  })}
                  confirmar={t('dar_por_perdida_confirmar', { importe })}
                  destructiva
                  variante="default"
                  accion={darDeudaPorPerdida.bind(null, p.id, deuda.centimos)}
                />
              )}
              <DialogoOlvido
                cta={t('rechazar')}
                titulo={t('rechazar_titulo')}
                explicacion={t('rechazar_texto')}
                confirmar={t('rechazar')}
                texto={{ etiqueta: t('motivo'), obligatorio: true }}
                accion={rechazarPeticionOlvido.bind(null, p.id)}
              />
              <DialogoOlvido
                cta={t('nota')}
                titulo={t('nota')}
                explicacion={t('nota_texto')}
                confirmar={t('guardar')}
                variante="ghost"
                texto={{ etiqueta: t('nota'), inicial: p.nota_centro ?? '' }}
                accion={guardarNotaPeticionOlvido.bind(null, p.id)}
              />
            </div>
          </>
        )}

        {estado === 'confirmada' && falta.bloqueos.length > 0 && (
          <div className="space-y-1">
            <p>{t('espera_purga')}</p>
            <FaltaLista falta={falta} />
          </div>
        )}
        {estado === 'confirmada' && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p>{t('se_borra', { fecha: f(p.gracia_hasta) })}</p>
            {p.gracia_hasta && new Date(p.gracia_hasta) > ahora && (
              <DialogoOlvido
                cta={t('deshacer')}
                titulo={t('deshacer')}
                explicacion={t('deshacer_texto', { fecha: f(p.gracia_hasta) })}
                confirmar={t('deshacer')}
                accion={deshacerConfirmacionOlvido.bind(null, p.id)}
              />
            )}
          </div>
        )}
        {estado === 'rechazada' && (
          <p className="text-muted-foreground">
            {t('rechazada', { fecha: f(p.rechazada_en), motivo: p.motivo_rechazo ?? '' })}
          </p>
        )}
        {estado === 'retirada' && (
          <p className="text-muted-foreground">{t('retirada', { fecha: f(p.retirada_en) })}</p>
        )}
        {estado === 'borrada' && (
          <p className="text-muted-foreground">{t('borrada', { fecha: f(p.purgado_en) })}</p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-h1 text-foreground">{t('titulo')}</h1>
        <p className="text-muted-foreground max-w-2xl text-sm">{t('descripcion')}</p>
      </header>

      {peticiones === null ? (
        <Card className="text-muted-foreground p-6 text-sm">{t('error_lectura')}</Card>
      ) : peticiones.length === 0 ? (
        <Card className="text-muted-foreground p-6 text-sm">{t('vacio')}</Card>
      ) : (
        <>
          {abiertas.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-h3 text-foreground">{t('abiertas')}</h2>
              <Card className="divide-y">
                {abiertas.map((p) => (
                  <Tarjeta key={p.id} p={p} />
                ))}
              </Card>
            </section>
          )}
          {cerradas.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-h3 text-foreground">{t('cerradas')}</h2>
              <Card className="divide-y">
                {cerradas.map((p) => (
                  <Tarjeta key={p.id} p={p} />
                ))}
              </Card>
            </section>
          )}
        </>
      )}
    </div>
  )
}
