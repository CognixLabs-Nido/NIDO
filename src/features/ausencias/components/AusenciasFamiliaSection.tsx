'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarOffIcon, PlusIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { hoyMadrid } from '@/features/agenda-diaria/lib/fecha'

import { cancelarAusencia } from '../actions/cancelar-ausencia'
import { crearAusencia } from '../actions/crear-ausencia'
import { esCancelada, motivoAusenciaEnum, type MotivoAusencia } from '../schemas/ausencia'
import type { AusenciaRow } from '../types'

interface Props {
  ninoId: string
  ausencias: AusenciaRow[]
  puedeReportar: boolean
}

export function AusenciasFamiliaSection({ ninoId, ausencias, puedeReportar }: Props) {
  const t = useTranslations('ausencia')
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null)
  const hoy = hoyMadrid()

  const [form, setForm] = useState<{
    fecha_inicio: string
    fecha_fin: string
    motivo: MotivoAusencia
    descripcion: string
  }>({
    fecha_inicio: hoy,
    fecha_fin: hoy,
    motivo: 'enfermedad',
    descripcion: '',
  })

  async function onSubmit() {
    setSubmitting(true)
    setError(null)
    const result = await crearAusencia({
      nino_id: ninoId,
      fecha_inicio: form.fecha_inicio,
      fecha_fin: form.fecha_fin,
      motivo: form.motivo,
      descripcion: form.descripcion.trim() === '' ? null : form.descripcion.trim(),
    })
    setSubmitting(false)
    if (result.success) {
      setOpen(false)
      setForm({ fecha_inicio: hoy, fecha_fin: hoy, motivo: 'enfermedad', descripcion: '' })
      router.refresh()
    } else {
      setError(result.error)
    }
  }

  async function onCancelarConfirmado(id: string) {
    setSubmitting(true)
    const result = await cancelarAusencia(id)
    setSubmitting(false)
    setConfirmCancelId(null)
    if (result.success) router.refresh()
  }

  if (!puedeReportar && ausencias.length === 0) {
    return (
      <Card>
        <CardContent className="space-y-2 text-sm">
          <p className="text-foreground font-medium">{t('sin_permiso.title')}</p>
          <p className="text-muted-foreground">{t('sin_permiso.description')}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      {puedeReportar && (
        <Button
          type="button"
          size="sm"
          onClick={() => setOpen(true)}
          data-testid="ausencia-reportar-boton"
        >
          <PlusIcon className="size-4" />
          {t('reportar')}
        </Button>
      )}

      {ausencias.length === 0 ? (
        <Card>
          <CardContent className="flex items-center gap-3 text-sm">
            <CalendarOffIcon className="text-muted-foreground size-5" />
            <p className="text-muted-foreground">{t('ninguna')}</p>
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-2" data-testid="ausencias-list">
          {ausencias.map((a) => {
            const cancelada = esCancelada(a.descripcion)
            return (
              <li key={a.id}>
                <Card>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge variant="info">{t(`motivo_opciones.${a.motivo}`)}</Badge>
                        {cancelada && (
                          <Badge variant="outline" data-testid={`ausencia-cancelada-${a.id}`}>
                            {t('cancelada')}
                          </Badge>
                        )}
                      </div>
                      {!cancelada && puedeReportar && a.fecha_inicio >= hoy && (
                        <Button
                          type="button"
                          size="xs"
                          variant="outline"
                          onClick={() => setConfirmCancelId(a.id)}
                          data-testid={`ausencia-cancelar-${a.id}`}
                        >
                          {t('cancelar')}
                        </Button>
                      )}
                    </div>
                    <p className="text-foreground">
                      {a.fecha_inicio === a.fecha_fin
                        ? a.fecha_inicio
                        : `${a.fecha_inicio} → ${a.fecha_fin}`}
                    </p>
                    {a.descripcion && !cancelada && (
                      <p className="text-muted-foreground">{a.descripcion}</p>
                    )}
                  </CardContent>
                </Card>
              </li>
            )
          })}
        </ul>
      )}

      {puedeReportar && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('reportar_dialog_title')}</DialogTitle>
              <DialogDescription>{t('reportar_dialog_desc')}</DialogDescription>
            </DialogHeader>

            <div className="space-y-3">
              <div>
                <Label htmlFor="fi">{t('fields.fecha_inicio')}</Label>
                <Input
                  id="fi"
                  type="date"
                  value={form.fecha_inicio}
                  min={hoy}
                  onChange={(e) => setForm((f) => ({ ...f, fecha_inicio: e.target.value }))}
                  data-testid="ausencia-fecha-inicio"
                />
              </div>
              <div>
                <Label htmlFor="ff">{t('fields.fecha_fin')}</Label>
                <Input
                  id="ff"
                  type="date"
                  value={form.fecha_fin}
                  min={form.fecha_inicio}
                  onChange={(e) => setForm((f) => ({ ...f, fecha_fin: e.target.value }))}
                  data-testid="ausencia-fecha-fin"
                />
              </div>
              <div>
                <Label htmlFor="motivo">{t('fields.motivo')}</Label>
                <Select
                  value={form.motivo}
                  onValueChange={(v) => setForm((f) => ({ ...f, motivo: v as MotivoAusencia }))}
                >
                  <SelectTrigger id="motivo" data-testid="ausencia-motivo">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {motivoAusenciaEnum.options.map((opt) => (
                      <SelectItem key={opt} value={opt}>
                        {t(`motivo_opciones.${opt}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="desc">{t('fields.descripcion')}</Label>
                <Textarea
                  id="desc"
                  maxLength={500}
                  value={form.descripcion}
                  onChange={(e) => setForm((f) => ({ ...f, descripcion: e.target.value }))}
                  data-testid="ausencia-descripcion"
                />
              </div>
              {error && (
                <p className="text-destructive text-sm" role="alert">
                  {error}
                </p>
              )}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={submitting}
              >
                {t('cancelar')}
              </Button>
              <Button
                type="button"
                onClick={onSubmit}
                disabled={submitting}
                data-testid="ausencia-guardar"
              >
                {submitting ? t('guardando') : t('guardar')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={confirmCancelId !== null} onOpenChange={(v) => !v && setConfirmCancelId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('confirmar_cancelar_title')}</DialogTitle>
            <DialogDescription>{t('confirmar_cancelar_desc')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmCancelId(null)}
              disabled={submitting}
            >
              {t('cancelar')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => confirmCancelId && onCancelarConfirmado(confirmCancelId)}
              disabled={submitting}
              data-testid="ausencia-confirmar-cancelar"
            >
              {t('confirmar_cancelar_si')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
