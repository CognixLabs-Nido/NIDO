import { CoinsIcon, LandmarkIcon, PencilIcon } from 'lucide-react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { familiaDelUsuarioActual } from '@/features/alta/queries/get-familia-usuario'
import { familiaTieneMandatoActivo } from '@/features/alta/queries/get-mandato-familia'
import { MarcarRecibosVistosOnMount } from '@/features/notificaciones/components/MarcarRecibosVistosOnMount'
import { DomiciliacionTutorDialog } from '@/features/recibos/components/DomiciliacionTutorDialog'
import { ESTADO_BADGE_VARIANT, formatPeriodo } from '@/features/recibos/lib/formato'
import { getRecibosFamilia, idsDeRecibos } from '@/features/recibos/queries/get-recibos-familia'
import { createClient } from '@/lib/supabase/server'
import { EmptyState } from '@/shared/components/EmptyState'
import { formatEuros } from '@/shared/lib/format-money'

interface PageProps {
  params: Promise<{ locale: string }>
}

/**
 * Recibos — vista de familia (F12-B-7). Lista los recibos PASADOS de cada hijo del tutor
 * legal, agrupados por niño y ordenados por período (más reciente primero). Solo lectura:
 * cada recibo enlaza a su detalle con el desglose de líneas. La RLS garantiza que nunca
 * aparecen recibos de otros niños. Al montar, marca todos como vistos (baja el aviso de
 * "recibos nuevos" del inicio).
 */
export default async function FamilyRecibosPage({ params }: PageProps) {
  const { locale } = await params
  const t = await getTranslations('recibos')
  const tDom = await getTranslations('family.domiciliacion')
  const grupos = await getRecibosFamilia()
  const ids = idsDeRecibos(grupos)

  // F-2c-4: domiciliación SEPA de la FAMILIA del tutor (ver + registrar/sustituir con firma
  // digital). La familia + el centro se resuelven server-side desde auth.uid() (1:1).
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const familia = await familiaDelUsuarioActual()
  let dom: {
    centroNombre: string
    centroDireccion: string
    userId: string
    mandato: Awaited<ReturnType<typeof familiaTieneMandatoActivo>>
  } | null = null
  if (familia && user) {
    const [{ data: centro }, mandato] = await Promise.all([
      supabase.from('centros').select('nombre, direccion').eq('id', familia.centroId).maybeSingle(),
      familiaTieneMandatoActivo(familia.familiaId),
    ])
    dom = {
      centroNombre: centro?.nombre ?? '',
      centroDireccion: centro?.direccion ?? '',
      userId: user.id,
      mandato,
    }
  }
  const fechaFirmaLegible = dom?.mandato?.fecha_firma
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(
        new Date(dom.mandato.fecha_firma)
      )
    : null

  return (
    <div className="space-y-8">
      <MarcarRecibosVistosOnMount reciboIds={ids} />
      <header className="space-y-2">
        <h1 className="text-h1 text-foreground flex items-center gap-2">
          <CoinsIcon className="text-primary-600 size-7" />
          {t('title')}
        </h1>
        <p className="text-muted-foreground text-sm">{t('family_intro')}</p>
      </header>

      {/* Domiciliación SEPA (F-2c-4) — mandato de la familia + registrar/sustituir con firma digital. */}
      {dom && (
        <section className="space-y-3">
          <h2 className="text-h3 text-foreground flex items-center gap-2">
            <LandmarkIcon className="text-muted-foreground size-4" />
            {tDom('titulo')}
          </h2>
          <Card>
            <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1 text-sm">
              {dom.mandato ? (
                <>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-foreground font-medium">
                      {dom.mandato.ultimos4
                        ? `••••${dom.mandato.ultimos4}`
                        : tDom('cuenta_registrada')}
                      {dom.mandato.titular
                        ? ` · ${tDom('a_nombre_de', { titular: dom.mandato.titular })}`
                        : ''}
                    </p>
                    {fechaFirmaLegible && (
                      <p className="text-muted-foreground text-xs">
                        {tDom('desde', { fecha: fechaFirmaLegible })}
                      </p>
                    )}
                  </div>
                  <DomiciliacionTutorDialog
                    locale={locale}
                    centroId={familia!.centroId}
                    centroNombre={dom.centroNombre}
                    centroDireccion={dom.centroDireccion}
                    currentUserId={dom.userId}
                    titularInicial={dom.mandato.titular}
                    trigger={
                      <Button variant="outline" size="sm">
                        <PencilIcon className="size-4" />
                        {tDom('cambiar')}
                      </Button>
                    }
                  />
                </>
              ) : (
                <>
                  <p className="text-muted-foreground min-w-0 flex-1">{tDom('sin')}</p>
                  <DomiciliacionTutorDialog
                    locale={locale}
                    centroId={familia!.centroId}
                    centroNombre={dom.centroNombre}
                    centroDireccion={dom.centroDireccion}
                    currentUserId={dom.userId}
                    trigger={
                      <Button variant="outline" size="sm">
                        <LandmarkIcon className="size-4" />
                        {tDom('configurar')}
                      </Button>
                    }
                  />
                </>
              )}
            </CardContent>
          </Card>
        </section>
      )}

      {grupos.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={<CoinsIcon strokeWidth={1.75} />}
              title={t('family_sin_recibos')}
              description={t('family_sin_recibos_desc')}
            />
          </CardContent>
        </Card>
      ) : (
        grupos.map((nino) => (
          <section key={nino.ninoId} className="space-y-3">
            <h2 className="text-h2 text-foreground">{nino.nombre}</h2>
            <div className="divide-y rounded-md border">
              {nino.recibos.map((r) => (
                <Link
                  key={r.id}
                  href={`/${locale}/family/recibos/${r.id}`}
                  className="hover:bg-muted/50 focus-visible:ring-ring flex flex-wrap items-center justify-between gap-3 p-3 text-sm transition focus-visible:ring-2 focus-visible:outline-none"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {r.esEsporadico && r.conceptoEsporadico
                        ? r.conceptoEsporadico
                        : formatPeriodo(r.anio, r.mes, locale)}
                    </span>
                    <Badge variant={ESTADO_BADGE_VARIANT[r.estado]}>
                      {t(`estado_recibo.${r.estado}`)}
                    </Badge>
                    {r.esEsporadico && <Badge variant="outline">{t('esporadico_badge')}</Badge>}
                    {r.esRegiro && <Badge variant="outline">{t('regiro_badge')}</Badge>}
                  </div>
                  <span className="font-medium tabular-nums">{formatEuros(r.totalCentimos)}</span>
                </Link>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  )
}
