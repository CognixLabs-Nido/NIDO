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
import type { CambioPendienteItem } from '../queries/get-cola'

interface Props {
  items: CambioPendienteItem[]
}

/**
 * F11-G-3 (decisión J) — cola de cambios pendientes de validación por la dirección.
 * Lista cada edición encolada (niño, solicitante, qué cambia) con botones aprobar/rechazar.
 * Al decidir, la fila desaparece optimistamente; un error la restaura. SIN push ni email
 * (solo el badge in-app del sidebar). El detalle del valor propuesto no se muestra aquí: la
 * dirección revisa el dato real en la ficha; la cola es la lista de "qué falta aprobar".
 */
export function ColaCambiosPendientes({ items }: Props) {
  const t = useTranslations('admin.pendientes')
  const tErrors = useTranslations()
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
      toast.success(accion === 'aprobar' ? t('aprobado') : t('rechazado'))
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
                <p className="text-muted-foreground text-xs">
                  {t(`entidad.${f.entidad}`)}
                  {f.resumen ? ` · ${f.resumen}` : ''}
                </p>
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
