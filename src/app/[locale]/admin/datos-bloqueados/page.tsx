import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { Card } from '@/components/ui/card'
import { requireContextoCentro } from '@/features/centros/contexto/get-contexto-centro'
import {
  getAccesosBloqueados,
  getSujetosBloqueados,
} from '@/features/datos-bloqueados/queries/get-datos-bloqueados'
import { localeIntl } from '@/shared/lib/locale-intl'

interface PageProps {
  params: Promise<{ locale: string }>
}

/**
 * Lo bloqueado tras la purga (20261205120000), para cuando hay un requerimiento: solo la titular.
 * La lista solo dice quién tiene algo bloqueado (con lo que ya se ve de él: su familia y su última
 * matrícula); para ver nada hay que entrar y dar un motivo. Debajo, quién ha mirado qué y por qué.
 */
export default async function DatosBloqueadosPage({ params }: PageProps) {
  const { locale } = await params
  const t = await getTranslations('datos_bloqueados')
  const { centroId, esResponsable, esSuperusuario } = await requireContextoCentro(locale)
  // Solo la admin del centro (`privado.es_titular`): el superusuario tampoco (PR-B1).
  if (!esResponsable || esSuperusuario) redirect(`/${locale}/forbidden`)

  const sujetos = await getSujetosBloqueados(centroId)
  // El superusuario es responsable en la app, pero no titular: la BD le contesta 42501.
  if (sujetos.tipo === 'no_autorizado') redirect(`/${locale}/forbidden`)
  const accesos = await getAccesosBloqueados(centroId)

  const fecha = new Intl.DateTimeFormat(localeIntl(locale), { dateStyle: 'medium' })
  const fechaHora = new Intl.DateTimeFormat(localeIntl(locale), {
    timeZone: 'Europe/Madrid',
    dateStyle: 'medium',
    timeStyle: 'short',
  })
  // Una fecha sin hora: se lee en UTC para que no cambie de día.
  const dia = (d: string | null) => (d ? fecha.format(new Date(`${d}T00:00:00Z`)) : '')

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-h1 text-foreground">{t('titulo')}</h1>
        <p className="text-muted-foreground max-w-2xl text-sm">{t('descripcion')}</p>
        <Link
          href={`/${locale}/admin/datos-bloqueados/retencion`}
          className="text-primary text-sm underline-offset-4 hover:underline"
        >
          {t('retencion.enlace')}
        </Link>
      </header>

      <section className="space-y-2">
        <h2 className="text-h3 text-foreground">{t('lista_titulo')}</h2>
        {sujetos.tipo === 'error' ? (
          <Card className="text-destructive p-6 text-sm" role="alert">
            {t('error_lectura')}
          </Card>
        ) : sujetos.filas.length === 0 ? (
          <Card className="text-muted-foreground p-6 text-sm">{t('lista_vacia')}</Card>
        ) : (
          <Card className="divide-y">
            {sujetos.filas.map((s) => (
              <div
                key={`${s.sujeto_tipo}-${s.sujeto_id}`}
                className="flex flex-wrap items-center justify-between gap-2 p-4 text-sm"
              >
                <div className="space-y-0.5">
                  <p className="text-foreground font-medium">
                    {s.sujeto_tipo === 'nino' ? t('sujeto_nino') : t('sujeto_usuario')}
                    {s.familia ? ` · ${t('familia', { familia: s.familia })}` : ''}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {t('desde', { fecha: dia(s.bloqueado_desde) })}
                    {s.aula ? ` · ${t('matricula', { aula: s.aula, curso: s.curso ?? '' })}` : ''}
                  </p>
                </div>
                <Link
                  href={`/${locale}/admin/datos-bloqueados/${s.sujeto_tipo}/${s.sujeto_id}`}
                  className="text-primary text-sm underline-offset-4 hover:underline"
                >
                  {t('abrir')}
                </Link>
              </div>
            ))}
          </Card>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-h3 text-foreground">{t('registro_titulo')}</h2>
        {accesos.tipo !== 'ok' ? (
          <Card className="text-destructive p-6 text-sm" role="alert">
            {t('error_lectura')}
          </Card>
        ) : accesos.filas.length === 0 ? (
          <Card className="text-muted-foreground p-6 text-sm">{t('registro_vacio')}</Card>
        ) : (
          <Card className="divide-y">
            {accesos.filas.map((a, i) => (
              <div key={i} className="space-y-0.5 p-4 text-sm">
                <p className="text-foreground">
                  {fechaHora.format(new Date(a.leido_en))} ·{' '}
                  {a.lector_nombre ?? t('cuenta_borrada')} ·{' '}
                  {t(`acciones.${a.accion === 'descargar' ? 'descargar' : 'ver'}`)}
                </p>
                <p className="text-muted-foreground text-xs">
                  {a.sujeto_tipo === 'nino' ? t('sujeto_nino') : t('sujeto_usuario')} ·{' '}
                  {t(`motivos.${a.motivo_tipo}`)}: {a.motivo}
                </p>
              </div>
            ))}
          </Card>
        )}
      </section>
    </div>
  )
}
