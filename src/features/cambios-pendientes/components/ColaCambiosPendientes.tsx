'use client'

import { useState, useTransition } from 'react'

import { CheckIcon, FileTextIcon, XIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { EmptyState } from '@/shared/components/EmptyState'
import { safeTranslateError } from '@/shared/lib/safe-translate'

import { aprobarCambio, rechazarCambio } from '../actions/decidir'
import type { CambioPendienteItem, LineaCambio } from '../queries/get-cola'

interface Props {
  items: CambioPendienteItem[]
}

/**
 * F11-G-3 (decisión J) — cola de cambios pendientes de validación por la dirección.
 * Lista cada edición encolada (niño, solicitante, qué cambia) con botones aprobar/rechazar.
 * Al decidir, la fila desaparece optimistamente; un error la restaura. SIN push ni email
 * (solo el badge in-app del sidebar).
 *
 * Cada entrada enseña lo guardado y lo propuesto de cada campo que cambia (2026-11-08, sustituye a
 * «el valor propuesto no se muestra aquí; la dirección revisa el dato real en la ficha»): una cola
 * que solo dice el nombre del campo se aprueba sin mirar. Todas las entradas igual, para que
 * ninguna se apruebe a ciegas. Si no se pudo leer lo guardado, lo dice: no enseña un «antes» falso.
 */
export function ColaCambiosPendientes({ items }: Props) {
  const t = useTranslations('admin.pendientes')
  const tNino = useTranslations('admin.ninos')
  const tAlta = useTranslations('alta')
  const tErrors = useTranslations()

  function valor(l: LineaCambio, v: string | null, lado: 'antes' | 'despues') {
    if (l.campo === 'documento')
      return lado === 'despues'
        ? t('documento_nuevo')
        : v
          ? t('documento_hay')
          : t('documento_no_hay')
    if (v === null) return t('sin_valor')
    if (l.campo === 'sexo') return tNino(`sexo_opciones.${v}`)
    if (l.campo === 'estado_civil_familia') return tAlta(`tutor.estado_civil_opciones.${v}`)
    return v
  }
  const [filas, setFilas] = useState(items)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  function decidir(id: string, accion: 'aprobar' | 'rechazar') {
    setPendingId(id)
    startTransition(async () => {
      const r = accion === 'aprobar' ? await aprobarCambio(id) : await rechazarCambio(id)
      setPendingId(null)
      if (!r.success) {
        toast.error(safeTranslateError(tErrors, r.error))
        return
      }
      setFilas((prev) => prev.filter((f) => f.id !== id))
      if (accion === 'rechazar') toast.success(t('rechazado'))
      else if ('tutor2' in r.data && r.data.tutor2 === 'no_salio')
        toast.warning(t('aprobado_tutor2_no_salio'))
      else if ('tutor2' in r.data && r.data.tutor2 === 'invitado')
        toast.success(t('aprobado_tutor2_invitado'))
      else toast.success(t('aprobado'))
    })
  }

  if (filas.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={<FileTextIcon strokeWidth={1.75} />}
          title={t('vacio')}
          description={t('vacio_desc')}
        />
      </Card>
    )
  }

  return (
    <ul className="space-y-3">
      {filas.map((f) => (
        <li key={f.id}>
          <Card>
            <CardContent className="flex flex-wrap items-center gap-4 p-4">
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-foreground text-sm font-semibold">
                  {f.ninoNombre || t('nino_desconocido')}
                </p>
                <p className="text-muted-foreground text-xs">{t(`entidad.${f.entidad}`)}</p>
                {f.lineas === null ? (
                  <p className="text-accent-warm-800 text-xs" data-testid={`sin-lectura-${f.id}`}>
                    {t('sin_lectura')}
                  </p>
                ) : f.lineas.length === 0 ? (
                  <p className="text-muted-foreground text-xs">{t('sin_cambios')}</p>
                ) : (
                  <dl className="space-y-0.5 text-xs" data-testid={`cambios-${f.id}`}>
                    {f.lineas.map((l) => (
                      <div key={l.campo} className="flex flex-wrap gap-x-1">
                        <dt className="text-muted-foreground">{t(`campos.${l.campo}`)}:</dt>
                        <dd className="text-foreground">
                          {valor(l, l.antes, 'antes')} → {valor(l, l.despues, 'despues')}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
                <p className="text-muted-foreground text-xs">
                  {t('solicitado_por', { nombre: f.solicitante || t('solicitante_desconocido') })}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pendingId === f.id}
                  onClick={() => decidir(f.id, 'rechazar')}
                  data-testid={`rechazar-${f.id}`}
                >
                  <XIcon className="size-4" />
                  <span className="ml-1">{t('rechazar')}</span>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={pendingId === f.id}
                  onClick={() => decidir(f.id, 'aprobar')}
                  data-testid={`aprobar-${f.id}`}
                >
                  <CheckIcon className="size-4" />
                  <span className="ml-1">{t('aprobar')}</span>
                </Button>
              </div>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  )
}
