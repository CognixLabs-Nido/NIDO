'use client'

import { useState, useTransition } from 'react'
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from 'lucide-react'
import { usePathname, useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'

import { getCitaDetalleAction } from '../actions/get-cita-detalle'
import { setPreferenciaVistaAgenda } from '../actions/set-preferencia-vista'
import { navegar, parseYmd, rangoDeVista, ymd } from '../lib/fechas'
import type { CitaAgenda, CitaDetalle, VistaAgenda } from '../types'

import { AgendaDia } from './AgendaDia'
import { AgendaMes } from './AgendaMes'
import { CitaChip } from './CitaChip'
import { CitaDetalleDialog } from './CitaDetalleDialog'
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
  const esAdmin = rol === 'admin'

  const [formOpen, setFormOpen] = useState(false)
  const [fechaForm, setFechaForm] = useState(fecha)
  const [horaForm, setHoraForm] = useState<string | undefined>(undefined)
  const [diaSel, setDiaSel] = useState<string | null>(null)
  const [detalle, setDetalle] = useState<CitaDetalle | null>(null)
  const [detalleOpen, setDetalleOpen] = useState(false)
  const [, startTransition] = useTransition()

  function irA(v: VistaAgenda, f: string) {
    router.push(`${pathname}?vista=${v}&fecha=${f}`)
  }

  function cambiarVista(v: VistaAgenda) {
    void setPreferenciaVistaAgenda({ vista: v })
    irA(v, fecha)
  }

  function abrirAlta(f: string, hora?: number) {
    setFechaForm(f)
    setHoraForm(hora === undefined ? undefined : `${String(hora).padStart(2, '0')}:00`)
    setFormOpen(true)
  }

  function abrirDetalle(citaId: string) {
    startTransition(async () => {
      const d = await getCitaDetalleAction(citaId)
      if (!d) return
      setDetalle(d)
      setDetalleOpen(true)
    })
  }

  /** Recarga el detalle abierto + la vista tras responder/gestionar. */
  function recargarDetalle() {
    if (!detalle) return
    const id = detalle.cita.id
    startTransition(async () => {
      const d = await getCitaDetalleAction(id)
      setDetalle(d)
      router.refresh()
    })
  }

  const citasDelDia = diaSel
    ? citas
        .filter((c) => c.fecha === diaSel)
        .sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio))
    : []

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
        <>
          <AgendaMes
            fecha={fecha}
            citas={citas}
            locale={locale}
            onCambioMes={(f) => {
              setDiaSel(null)
              irA('mes', f)
            }}
            onClickDia={(f) => setDiaSel(f)}
          />

          {diaSel && (
            <div className="space-y-2" data-testid="citas-del-dia">
              <div className="flex items-center justify-between gap-2">
                <p className="text-muted-foreground text-sm font-medium capitalize">
                  {new Intl.DateTimeFormat(tag, {
                    weekday: 'long',
                    day: 'numeric',
                    month: 'long',
                  }).format(parseYmd(diaSel))}
                </p>
                {esStaff && (
                  <Button size="sm" variant="outline" onClick={() => abrirAlta(diaSel)}>
                    <PlusIcon className="mr-1 h-4 w-4" />
                    {t('alta.nueva')}
                  </Button>
                )}
              </div>
              {citasDelDia.length === 0 ? (
                <p className="text-muted-foreground text-sm">{t('vacio')}</p>
              ) : (
                <ul className="space-y-1">
                  {citasDelDia.map((c) => (
                    <li key={c.id}>
                      <CitaChip cita={c} onClick={() => abrirDetalle(c.id)} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      ) : (
        <AgendaDia
          vista={vista}
          fecha={fecha}
          citas={citas}
          locale={locale}
          onClickCita={(c) => abrirDetalle(c.id)}
          onClickFranja={esStaff ? (f, hora) => abrirAlta(f, hora) : undefined}
        />
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
          horaInicial={horaForm}
        />
      )}

      <CitaDetalleDialog
        open={detalleOpen}
        onOpenChange={setDetalleOpen}
        detalle={detalle}
        esAdmin={esAdmin}
        profes={profes}
        onChanged={recargarDetalle}
      />
    </div>
  )
}
