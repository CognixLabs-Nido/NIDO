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
import { adjuntosDeEdicion } from '../lib/datos-firma'
import type {
  MedicacionDatos,
  PersonaAutorizada,
  PersonaAutorizadaEdit,
  RosterFirmaNino,
  TipoAutorizacion,
} from '../types'
import { EstadoFirmaBadge } from './EstadoFirmaBadge'
import { FirmaPad } from './FirmaPad'
import { MedicacionFicha } from './MedicacionFicha'
import { PersonasAutorizadasEditor } from './PersonasAutorizadasEditor'

interface Props {
  autorizacionId: string
  tipo: TipoAutorizacion
  firmable: boolean
  /** Roster ya filtrado por RLS a los niños del tutor. */
  roster: RosterFirmaNino[]
  currentUserId: string
  currentUserNombre: string
  /** Recogida: lista vigente para prefill (multi-tutor parte de la del 1º). */
  personasIniciales?: PersonaAutorizada[]
  /** Medicación: datos vigentes (el 2.º tutor firma los mismos, read-only). */
  medicacionInicial?: MedicacionDatos | null
  /**
   * PR-3b-2 · B2 — variante PRESENCIAL (modo "Completa Dirección"): sin trazo (canvas),
   * la Directora deja constancia de que tiene el papel firmado. **Estrictamente opt-in**:
   * por defecto `false` → el panel se comporta EXACTAMENTE igual que hoy (las pantallas
   * que no lo pasan no cambian). El servidor RE-DERIVA metodo_firma; este prop es solo la UI.
   */
  presencial?: boolean
}

/**
 * Panel de firma del tutor: una fila por cada niño suyo en la autorización. Lee
 * el texto (arriba, en la página), confirma con checkbox + nombre tecleado +
 * trazo del dedo, y firma/rechaza. Si ya firmó, puede revocar (fila nueva). En
 * recogida añade el editor de personas autorizadas (prefill multi-tutor).
 */
export function FirmarAutorizacionPanel({
  autorizacionId,
  tipo,
  firmable,
  roster,
  currentUserId,
  currentUserNombre,
  personasIniciales,
  medicacionInicial,
  presencial = false,
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
          tipo={tipo}
          firmable={firmable}
          roster={r}
          miDecision={r.firmantes.find((f) => f.firmante_id === currentUserId)?.decision ?? null}
          nombrePerfil={currentUserNombre}
          personasIniciales={personasIniciales}
          medicacionInicial={medicacionInicial}
          presencial={presencial}
        />
      ))}
    </div>
  )
}

function NinoFirmaRow({
  autorizacionId,
  tipo,
  firmable,
  roster,
  miDecision,
  nombrePerfil,
  personasIniciales,
  medicacionInicial,
  presencial,
}: {
  autorizacionId: string
  tipo: TipoAutorizacion
  firmable: boolean
  roster: RosterFirmaNino
  miDecision: 'firmado' | 'rechazado' | 'revocado' | null
  nombrePerfil: string
  personasIniciales?: PersonaAutorizada[]
  medicacionInicial?: MedicacionDatos | null
  presencial: boolean
}) {
  const t = useTranslations('autorizaciones')
  const tRoot = useTranslations()
  const router = useRouter()
  const [confirmo, setConfirmo] = useState(false)
  const [nombre, setNombre] = useState(nombrePerfil)
  const [firma, setFirma] = useState<string | null>(null)
  const [personas, setPersonas] = useState<PersonaAutorizadaEdit[]>(
    personasIniciales && personasIniciales.length > 0
      ? personasIniciales
      : [{ nombre: '', dni: '', parentesco: '' }]
  )
  const [pending, startTransition] = useTransition()

  const yaFirmado = miDecision === 'firmado'
  const esRecogida = tipo === 'recogida'
  const esMedicacion = tipo === 'medicacion'
  // Revocar es self-service SOLO en recogida y medicación (info de seguridad
  // reversible). Reglas/salida: contactar al centro (que «anula»).
  const puedeRevocar = esRecogida || esMedicacion
  // Personas válidas (nombre + DNI no vacíos); el server revalida con Zod.
  const personasValidas = personas
    .map((p) => ({ ...p, nombre: p.nombre.trim(), dni: p.dni.trim() }))
    .filter((p) => p.nombre.length > 0 && p.dni.length > 0)
  // Medicación: el 2.º tutor firma los datos vigentes (read-only); sin ellos no
  // se puede firmar la misma instancia (crearla es el flujo de la familia).
  const medOk = !esMedicacion || !!medicacionInicial
  const listaOk = (!esRecogida || personasValidas.length > 0) && medOk

  function firmar() {
    if (!confirmo) {
      toast.error(t('errors.confirma_requerido'))
      return
    }
    // Presencial (modo Dirección): sin trazo (decisión A). Digital: trazo obligatorio.
    if (!presencial && !firma) {
      toast.error(t('validation.firma_requerida'))
      return
    }
    if (esRecogida && personasValidas.length === 0) {
      toast.error(t('validation.personas_vacio'))
      return
    }
    if (esMedicacion && !medicacionInicial) {
      toast.error(t('errors.medicacion_requerida'))
      return
    }
    startTransition(async () => {
      const res = await firmarAutorizacion({
        autorizacion_id: autorizacionId,
        nino_id: roster.nino_id,
        nombre_tecleado: nombre.trim(),
        firma_imagen: presencial ? null : firma,
        ...(esRecogida ? { personas: personasValidas, adjuntos: adjuntosDeEdicion(personas) } : {}),
        ...(esMedicacion && medicacionInicial ? { medicacion: medicacionInicial } : {}),
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
          {puedeRevocar ? (
            // Recogida/medicación: revocar es self-service (avisa a admin + profes).
            <div className="space-y-1">
              <Button variant="outline" onClick={revocar} disabled={pending}>
                {t('acciones.revocar')}
              </Button>
              <p className="text-muted-foreground text-xs">{t('firma.revocar_aviso')}</p>
            </div>
          ) : (
            // Reglas/salida: no self-service → contactar al centro (que «anula»).
            <p className="text-muted-foreground text-xs">{t('firma.revocar_contactar')}</p>
          )}
        </div>
      )}

      {firmable && !yaFirmado && (
        <div className="space-y-4">
          {esRecogida && (
            <PersonasAutorizadasEditor
              value={personas}
              onChange={setPersonas}
              disabled={pending}
              ninoId={roster.nino_id}
            />
          )}
          {esMedicacion && <MedicacionFicha medicacion={medicacionInicial ?? null} />}
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
          {presencial ? (
            // Modo Dirección: sin canvas — constancia de firma en papel (decisión A).
            <p className="border-accent-warm-300 bg-accent-warm-50 text-accent-warm-800 rounded-lg border p-3 text-sm">
              {t('firma.presencial_aviso')}
            </p>
          ) : (
            <div className="space-y-1">
              <Label>{t('firma.trazo')}</Label>
              <FirmaPad onChange={setFirma} disabled={pending} />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={firmar}
              disabled={pending || !confirmo || (!presencial && !firma) || !listaOk}
            >
              {presencial ? t('acciones.firmar_presencial') : t('acciones.firmar')}
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
