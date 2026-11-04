import { ChevronRightIcon, ClipboardListIcon } from 'lucide-react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { requireContextoCentro } from '@/features/centros/contexto/get-contexto-centro'
import { AltaSinTerminarAcciones } from '@/features/matriculas/components/AltaSinTerminarAcciones'
import { ChecklistAvance } from '@/features/matriculas/components/ChecklistAvance'
import {
  getAltasEnProceso,
  type AltaEnProceso,
} from '@/features/matriculas/queries/get-altas-en-proceso'
import { createClient } from '@/lib/supabase/server'
import { EmptyState } from '@/shared/components/EmptyState'
import { localeIntl } from '@/shared/lib/locale-intl'

interface PageProps {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ estado?: string; mas30?: string }>
}

/** Los estados por los que se acota la lista, en el orden del embudo. */
const FILTROS = [
  'invitacion_abierta',
  'sin_invitacion',
  'iniciada',
  'por_validar',
  'tutor2',
] as const
type Filtro = (typeof FILTROS)[number]

function filtroDe(a: AltaEnProceso): Filtro {
  return a.clase === 'sin_terminar' ? a.alta.estado : a.clase
}

/**
 * «Altas en proceso» (decisión de Jose, 2026-11-04): el embudo entero de la directora en una
 * pantalla, «todo de todo». Filtra por estado y por las que llevan más de 30 días para VER y
 * acotar; ninguna acción opera sobre varias a la vez: cada alta se cancela o se borra en su fila,
 * con su confirmación, como en la ficha.
 */
export default async function AdminAltasPage({ params, searchParams }: PageProps) {
  const { locale } = await params
  const { estado, mas30 } = await searchParams
  const t = await getTranslations('admin.altas')
  const tS = await getTranslations('admin.ninos.sin_terminar')
  const { centroId } = await requireContextoCentro(locale)

  const altas = await getAltasEnProceso(await createClient(), centroId)

  const fecha = (iso: string) =>
    new Intl.DateTimeFormat(localeIntl(locale), {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Europe/Madrid',
    }).format(new Date(iso))
  const filtro = FILTROS.includes(estado as Filtro) ? (estado as Filtro) : null
  const soloMas30 = mas30 === '1'
  const href = (e: Filtro | null, m: boolean) => {
    const q = new URLSearchParams()
    if (e) q.set('estado', e)
    if (m) q.set('mas30', '1')
    const s = q.toString()
    return `/${locale}/admin/altas${s ? `?${s}` : ''}`
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-h1 text-foreground">{t('titulo')}</h1>
        <p className="text-muted-foreground text-sm">{t('subtitulo')}</p>
      </header>

      {altas === null ? (
        <Card>
          <CardContent className="py-6">
            <p className="text-sm">{t('no_se_pudo_leer')}</p>
          </CardContent>
        </Card>
      ) : (
        <ListaAltas
          altas={altas}
          filtro={filtro}
          soloMas30={soloMas30}
          href={href}
          fecha={fecha}
          locale={locale}
          t={t}
          tS={tS}
        />
      )}
    </div>
  )
}

type T = Awaited<ReturnType<typeof getTranslations>>

function ListaAltas({
  altas,
  filtro,
  soloMas30,
  href,
  fecha,
  locale,
  t,
  tS,
}: {
  altas: AltaEnProceso[]
  filtro: Filtro | null
  soloMas30: boolean
  href: (e: Filtro | null, m: boolean) => string
  fecha: (iso: string) => string
  locale: string
  t: T
  tS: T
}) {
  const mas30 = (a: AltaEnProceso) => a.clase === 'sin_terminar' && a.alta.propuesta
  const visibles = altas.filter(
    (a) => (!filtro || filtroDe(a) === filtro) && (!soloMas30 || mas30(a))
  )
  const cuenta = (f: Filtro) =>
    altas.filter((a) => filtroDe(a) === f && (!soloMas30 || mas30(a))).length
  const chip = (activo: boolean) =>
    `inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium ${
      activo
        ? 'border-primary bg-primary text-primary-foreground'
        : 'text-muted-foreground hover:text-foreground'
    }`

  return (
    <div className="space-y-4">
      <nav aria-label={t('filtros.titulo')} className="flex flex-wrap gap-2">
        <Link href={href(null, soloMas30)} className={chip(filtro === null)}>
          {t('filtros.todas', { n: altas.filter((a) => !soloMas30 || mas30(a)).length })}
        </Link>
        {FILTROS.map((f) => (
          <Link key={f} href={href(f, soloMas30)} className={chip(filtro === f)}>
            {t(`filtros.${f}`, { n: cuenta(f) })}
          </Link>
        ))}
        <Link href={href(filtro, !soloMas30)} className={chip(soloMas30)} aria-pressed={soloMas30}>
          {t('filtros.mas30', { n: altas.filter(mas30).length })}
        </Link>
      </nav>

      {visibles.length === 0 ? (
        <Card>
          <EmptyState
            icon={<ClipboardListIcon strokeWidth={1.75} />}
            title={altas.length === 0 ? t('vacia') : t('vacia_filtro')}
          />
        </Card>
      ) : (
        <ul className="space-y-3">
          {visibles.map((a) => (
            <li key={`${a.clase}-${a.ninoId}`}>
              <Card>
                <CardContent className="space-y-3 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <Link
                        href={`/${locale}/admin/ninos/${a.ninoId}`}
                        className="text-foreground hover:text-primary inline-flex items-center gap-1 font-medium hover:underline"
                      >
                        {[a.nombre, a.apellidos].filter(Boolean).join(' ')}
                        <ChevronRightIcon className="size-4" />
                      </Link>
                      <p className="text-sm">{frase(a, fecha, t, tS)}</p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Badge variant={a.clase === 'por_validar' ? 'success' : 'info'}>
                        {t(`filtros.${filtroDe(a)}_corto`)}
                      </Badge>
                      {a.clase === 'sin_terminar' && a.dias !== null && (
                        <Badge variant="outline">{t('dias', { n: a.dias })}</Badge>
                      )}
                      {mas30(a) && <Badge variant="warning">{tS('propuesta')}</Badge>}
                    </div>
                  </div>

                  {a.clase !== 'tutor2' && <ChecklistAvance avance={a.avance} />}

                  {a.clase === 'sin_terminar' && (
                    <div className="border-t pt-3">
                      <AltaSinTerminarAcciones
                        ninoId={a.ninoId}
                        estado={a.alta.estado}
                        email={a.alta.email}
                        familiaNueva={a.alta.familiaNueva}
                        locale={locale}
                        alBorrar="quedarse"
                      />
                    </div>
                  )}
                  {a.clase === 'por_validar' && (
                    <div className="border-t pt-3">
                      <Link
                        href={`/${locale}/admin/ninos/${a.ninoId}`}
                        className="text-primary hover:text-primary-800 inline-flex items-center gap-1 text-sm font-medium hover:underline"
                      >
                        {t('validar')}
                        <ChevronRightIcon className="size-4" />
                      </Link>
                    </div>
                  )}
                  {a.clase === 'tutor2' && (
                    <p className="text-muted-foreground border-t pt-3 text-xs">
                      {t('tutor2.sin_botones')}
                    </p>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function frase(a: AltaEnProceso, fecha: (iso: string) => string, t: T, tS: T): string {
  if (a.clase === 'por_validar') return t('estado.por_validar')
  if (a.clase === 'tutor2')
    return t(`tutor2.${a.estado}`, { email: a.email, fecha: fecha(a.desde) })
  const s = a.alta
  if (s.estado === 'invitacion_abierta')
    return tS('estado.invitacion_abierta', { email: s.email ?? '—' })
  if (s.estado === 'sin_invitacion')
    return tS('estado.sin_invitacion', {
      email: s.email ?? '—',
      fecha: s.desde ? fecha(s.desde) : '—',
    })
  return tS('estado.iniciada', { fecha: s.desde ? fecha(s.desde) : '—' })
}
