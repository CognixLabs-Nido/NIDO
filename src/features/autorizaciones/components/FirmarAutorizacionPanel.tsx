'use client'

import { useState, useTransition } from 'react'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import {
  firmarAutorizacion,
  rechazarAutorizacion,
  revocarFirma,
} from '../actions/firmar-autorizacion'
import type { RosterFirmaNino } from '../types'
import { EstadoFirmaBadge } from './EstadoFirmaBadge'
import { FirmaPad } from './FirmaPad'

interface Props {
  autorizacionId: string
  firmable: boolean
  /** Roster ya filtrado por RLS a los niños del tutor. */
  roster: RosterFirmaNino[]
  currentUserId: string
  currentUserNombre: string
}

/**
 * Panel de firma del tutor: una fila por cada niño suyo en la autorización. Lee
 * el texto (arriba, en la página), confirma con checkbox + nombre tecleado +
 * trazo del dedo, y firma/rechaza. Si ya firmó, puede revocar (fila nueva).
 */
export function FirmarAutorizacionPanel({
  autorizacionId,
  firmable,
  roster,
  currentUserId,
  currentUserNombre,
}: Props) {
  const t = useTranslations('autorizaciones')

  if (roster.length === 0) {
    return <p className="text-muted-foreground text-sm">{t('roster.sin_ninos')}</p>
  }

  return (
    <div className="space-y-6">
      {roster.map((r) => (
        <NinoFirmaRow
          key={r.nino_id}
          autorizacionId={autorizacionId}
          firmable={firmable}
          roster={r}
          miDecision={r.firmantes.find((f) => f.firmante_id === currentUserId)?.decision ?? null}
          nombrePerfil={currentUserNombre}
        />
      ))}
    </div>
  )
}

function NinoFirmaRow({
  autorizacionId,
  firmable,
  roster,
  miDecision,
  nombrePerfil,
}: {
  autorizacionId: string
  firmable: boolean
  roster: RosterFirmaNino
  miDecision: 'firmado' | 'rechazado' | 'revocado' | null
  nombrePerfil: string
}) {
  const t = useTranslations('autorizaciones')
  const tRoot = useTranslations()
  const router = useRouter()
  const [confirmo, setConfirmo] = useState(false)
  const [nombre, setNombre] = useState(nombrePerfil)
  const [firma, setFirma] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const yaFirmado = miDecision === 'firmado'

  function firmar() {
    if (!confirmo) {
      toast.error(t('errors.confirma_requerido'))
      return
    }
    if (!firma) {
      toast.error(t('validation.firma_requerida'))
      return
    }
    startTransition(async () => {
      const res = await firmarAutorizacion({
        autorizacion_id: autorizacionId,
        nino_id: roster.nino_id,
        nombre_tecleado: nombre.trim(),
        firma_imagen: firma,
      })
      if (!res.success) {
        toast.error(tRoot(res.error))
        return
      }
      toast.success(t('acciones.firmada_toast'))
      router.refresh()
    })
  }

  function rechazar() {
    startTransition(async () => {
      const res = await rechazarAutorizacion({
        autorizacion_id: autorizacionId,
        nino_id: roster.nino_id,
      })
      if (!res.success) {
        toast.error(tRoot(res.error))
        return
      }
      toast.success(t('acciones.rechazada_toast'))
      router.refresh()
    })
  }

  function revocar() {
    startTransition(async () => {
      const res = await revocarFirma({
        autorizacion_id: autorizacionId,
        nino_id: roster.nino_id,
      })
      if (!res.success) {
        toast.error(tRoot(res.error))
        return
      }
      toast.success(t('acciones.revocada_toast'))
      router.refresh()
    })
  }

  return (
    <div className="rounded-lg border p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="font-medium">{roster.nino_nombre}</span>
        <EstadoFirmaBadge estado={roster.estado} />
      </div>

      {!firmable && <p className="text-muted-foreground text-sm">{t('firma.no_firmable')}</p>}

      {firmable && yaFirmado && (
        <div className="space-y-3">
          <p className="text-success-700 text-sm">{t('firma.ya_firmado')}</p>
          <Button variant="outline" onClick={revocar} disabled={pending}>
            {t('acciones.revocar')}
          </Button>
        </div>
      )}

      {firmable && !yaFirmado && (
        <div className="space-y-4">
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={confirmo} onCheckedChange={(v) => setConfirmo(v === true)} />
            <span>{t('firma.confirmo')}</span>
          </label>
          <div className="space-y-2">
            <Label htmlFor={`nombre-${roster.nino_id}`}>{t('firma.nombre')}</Label>
            <Input
              id={`nombre-${roster.nino_id}`}
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              maxLength={200}
            />
            <p className="text-muted-foreground text-xs">{t('firma.nombre_ayuda')}</p>
          </div>
          <div className="space-y-1">
            <Label>{t('firma.trazo')}</Label>
            <FirmaPad onChange={setFirma} disabled={pending} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={firmar} disabled={pending || !confirmo || !firma}>
              {t('acciones.firmar')}
            </Button>
            <Button variant="outline" onClick={rechazar} disabled={pending}>
              {t('acciones.rechazar')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
