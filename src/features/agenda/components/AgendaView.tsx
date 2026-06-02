'use client'

import { useState } from 'react'
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'

import { setPreferenciaVistaAgenda } from '../actions/set-preferencia-vista'
import { navegar, parseYmd, rangoDeVista, ymd } from '../lib/fechas'
import type { CitaAgenda, VistaAgenda } from '../types'

import { AgendaDia } from './AgendaDia'
import { AgendaMes } from './AgendaMes'
import { CitaFormDialog, type AulaOpt, type NinoOpt, type ProfeOpt } from './CitaFormDialog'
import { VistaToggle } from './VistaToggle'

interface Props {
  locale: string
  rol: 'admin' | 'profe' | 'tutor_legal' | 'autorizado'
  vista: VistaAgenda
  fecha: string
  citas: CitaAgenda[]
  ninos: NinoOpt[]
  aulas: AulaOpt[]
  profes: ProfeOpt[]
}

export function AgendaView({ locale, rol, vista, fecha, citas, ninos, aulas, profes }: Props) {
  const t = useTranslations('citas')
  const router = useRouter()
  const pathname = usePathname()
  const esStaff = rol === 'admin' || rol === 'profe'

  const [formOpen, setFormOpen] = useState(false)
  const [fechaForm, setFechaForm] = useState(fecha)

  function irA(v: VistaAgenda, f: string) {
    router.push(`${pathname}?vista=${v}&fecha=${f}`)
  }

  function cambiarVista(v: VistaAgenda) {
    void setPreferenciaVistaAgenda({ vista: v })
    irA(v, fecha)
  }

  function abrirAlta(f: string) {
    setFechaForm(f)
    setFormOpen(true)
  }

  const { desde, hasta } = rangoDeVista(vista, fecha)
  const tag = locale === 'en' ? 'en-GB' : locale === 'va' ? 'ca-ES' : 'es-ES'
  const titulo =
    vista === 'mes'
      ? new Intl.DateTimeFormat(tag, { month: 'long', year: 'numeric' }).format(parseYmd(fecha))
      : vista === 'semana'
        ? `${new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'short' }).format(parseYmd(desde))} – ${new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'short' }).format(parseYmd(hasta))}`
        : new Intl.DateTimeFormat(tag, { weekday: 'long', day: 'numeric', month: 'long' }).format(
            parseYmd(fecha)
          )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">{t('titulo')}</h1>
        {esStaff && (
          <Button size="sm" onClick={() => abrirAlta(fecha)}>
            <PlusIcon className="mr-1 h-4 w-4" />
            {t('alta.nueva')}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label={t('nav.anterior')}
            onClick={() => irA(vista, navegar(vista, fecha, -1))}
          >
            <ChevronLeftIcon className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => irA(vista, ymd(new Date()))}>
            {t('nav.hoy')}
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label={t('nav.siguiente')}
            onClick={() => irA(vista, navegar(vista, fecha, 1))}
          >
            <ChevronRightIcon className="h-4 w-4" />
          </Button>
          <span className="text-foreground ml-1 text-sm font-medium capitalize">{titulo}</span>
        </div>
        <VistaToggle vista={vista} onChange={cambiarVista} />
      </div>

      {vista === 'mes' ? (
        <AgendaMes
          fecha={fecha}
          citas={citas}
          locale={locale}
          onCambioMes={(f) => irA('mes', f)}
          onClickDia={esStaff ? (f) => abrirAlta(f) : undefined}
        />
      ) : (
        <AgendaDia vista={vista} fecha={fecha} citas={citas} locale={locale} />
      )}

      {esStaff && (
        <CitaFormDialog
          rol={rol as 'admin' | 'profe'}
          ninos={ninos}
          aulas={aulas}
          profes={profes}
          open={formOpen}
          onOpenChange={setFormOpen}
          fechaInicial={fechaForm}
        />
      )}
    </div>
  )
}
