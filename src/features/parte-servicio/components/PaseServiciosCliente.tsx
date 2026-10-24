'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { hoyMadrid } from '@/features/agenda-diaria/lib/fecha'

import { guardarPaseServicios } from '../actions/guardar-pase-servicios'
import {
  SERVICIOS_DEL_DIA,
  cambiosPase,
  casilla,
  clasesDe,
  filtrarFilas,
  type FilaPase,
} from '../lib/pase-servicios'

import { ServicioDayPicker, type ModoFechaServicio } from './ServicioDayPicker'

interface Props {
  centroId: string
  locale: string
  fecha: string
  filas: FilaPase[]
  /** Clase preseleccionada (el enlace desde un aula). */
  aulaInicial: string | null
}

function modoDeFecha(fecha: string, hoy: string): ModoFechaServicio {
  if (fecha === hoy) return 'hoy'
  if (fecha < hoy) return 'historico'
  return 'futuro'
}

/**
 * PR-12 — el listado único del pase de servicios: todos los niños del centro, con su clase, y los
 * tres servicios (mañana, comedor, tarde) marcables en la misma fila. Se marca a todos los que se
 * quedan: a quién se le cobra lo decide el motor (PR-4). Hoy y los días pasados se editan; el
 * futuro es solo lectura. Se guardan solo las casillas que cambian.
 */
export function PaseServiciosCliente({ centroId, locale, fecha, filas, aulaInicial }: Props) {
  const t = useTranslations('parte_servicio.listado')
  const tServicio = useTranslations('parte_servicio')
  const tRoot = useTranslations()
  const router = useRouter()
  const hoy = hoyMadrid()
  const modo = modoDeFecha(fecha, hoy)
  const editable = modo !== 'futuro'

  const clases = useMemo(() => clasesDe(filas), [filas])
  const [aula, setAula] = useState<string | null>(
    aulaInicial && clases.some((c) => c.id === aulaInicial) ? aulaInicial : null
  )
  const [texto, setTexto] = useState('')
  const [marcas, setMarcas] = useState<Record<string, boolean>>({})
  const [pending, startTransition] = useTransition()

  const visibles = filtrarFilas(filas, aula, texto)
  const cambios = cambiosPase(filas, marcas)

  function marcada(f: FilaPase, s: (typeof SERVICIOS_DEL_DIA)[number]): boolean {
    return marcas[casilla(f.ninoId, s)] ?? f.servicios[s] ?? false
  }

  function marcar(claves: string[], valor: boolean) {
    setMarcas((prev) => {
      const next = { ...prev }
      for (const k of claves) next[k] = valor
      return next
    })
  }

  function marcarTodos(s: (typeof SERVICIOS_DEL_DIA)[number]) {
    const todas = visibles.length > 0 && visibles.every((f) => marcada(f, s))
    marcar(
      visibles.map((f) => casilla(f.ninoId, s)),
      !todas
    )
  }

  function setFecha(nueva: string) {
    if (cambios.length > 0 && !window.confirm(t('descartar_cambios'))) return
    const url = new URL(window.location.href)
    url.searchParams.set('fecha', nueva)
    setMarcas({})
    router.push(url.pathname + url.search)
  }

  function guardar() {
    startTransition(async () => {
      const r = await guardarPaseServicios({ centro_id: centroId, fecha, items: cambios })
      if (r.success) {
        toast.success(t('guardado', { n: r.data.count }))
        setMarcas({})
        router.refresh()
      } else {
        toast.error(tRoot(r.error))
      }
    })
  }

  return (
    <div className="space-y-4">
      <ServicioDayPicker fecha={fecha} locale={locale} hoy={hoy} modo={modo} onChange={setFecha} />

      <p className="text-muted-foreground text-sm">{t('ayuda')}</p>

      {filas.length === 0 ? (
        <Card className="p-4">
          <p className="text-muted-foreground text-sm">{t('sin_alumnos')}</p>
        </Card>
      ) : (
        <Card className="space-y-3 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div role="group" aria-label={t('filtro_clase')} className="flex flex-wrap gap-2">
              {[{ id: null, nombre: t('todas') }, ...clases].map((c) => (
                <button
                  key={c.id ?? 'todas'}
                  type="button"
                  aria-pressed={aula === c.id}
                  onClick={() => setAula(c.id)}
                  className={[
                    'rounded-full border px-3 py-1 text-sm font-medium transition-colors',
                    aula === c.id
                      ? 'border-primary-500 bg-primary-100 text-primary-800'
                      : 'border-border bg-card text-foreground hover:bg-muted',
                  ].join(' ')}
                >
                  {c.nombre}
                </button>
              ))}
            </div>
            <Input
              type="search"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder={t('buscar')}
              aria-label={t('buscar')}
              className="sm:w-56"
            />
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('col_clase')}</TableHead>
                <TableHead>{t('col_alumno')}</TableHead>
                {SERVICIOS_DEL_DIA.map((s) => (
                  <TableHead key={s} className="text-center">
                    <div>{t(`col_${s}`)}</div>
                    {editable && visibles.length > 0 && (
                      <Button
                        type="button"
                        size="sm"
                        variant="link"
                        className="h-auto p-0 text-xs"
                        onClick={() => marcarTodos(s)}
                        aria-label={t('marcar_todos_aria', { servicio: t(`col_${s}`) })}
                      >
                        {t('marcar_todos')}
                      </Button>
                    )}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibles.map((f) => {
                const nombre = `${f.nombre} ${f.apellidos}`.trim()
                return (
                  <TableRow key={f.ninoId}>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {f.aulaNombre}
                    </TableCell>
                    <TableCell className="font-medium">{nombre}</TableCell>
                    {SERVICIOS_DEL_DIA.map((s) => (
                      <TableCell key={s} className="text-center">
                        <Checkbox
                          checked={marcada(f, s)}
                          disabled={!editable || pending}
                          onCheckedChange={(v) => marcar([casilla(f.ninoId, s)], v === true)}
                          aria-label={t('casilla_aria', { nombre, servicio: t(`col_${s}`) })}
                        />
                      </TableCell>
                    ))}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          {visibles.length === 0 && (
            <p className="text-muted-foreground text-sm">{t('sin_resultados')}</p>
          )}

          {editable && (
            <div className="flex items-center justify-end gap-3">
              {cambios.length > 0 && (
                <span className="text-muted-foreground text-xs">
                  {t('cambios', { n: cambios.length })}
                </span>
              )}
              <Button type="button" onClick={guardar} disabled={cambios.length === 0 || pending}>
                {tServicio('guardar')}
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
