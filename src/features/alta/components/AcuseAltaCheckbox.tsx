'use client'

import { useState, useTransition } from 'react'

import { CheckCircle2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Checkbox } from '@/components/ui/checkbox'

import { otorgarConsentimientoImagenAlta } from '../actions/otorgar-imagen-alta'
import { registrarAcuseAlta } from '../actions/registrar-acuse-alta'

interface Props {
  ninoId: string
  tipo: 'normas' | 'imagen'
  /** ¿Ya está aceptado? (lo deriva la ruta server-side: `acuses_alta` en normas; consent de
   *  imagen del niño en imagen — IU-2). */
  aceptadoInicial: boolean
  /**
   * Aviso al padre de que acaba de aceptarse, para lo que dependa del acuse en la MISMA
   * pantalla (la foto del niño, que necesita el consent de imagen). Sin esto habría que
   * recargar para que el resto se enterase.
   */
  onAceptado?: () => void
}

/**
 * Vía B — acuse por checkbox de NORMAS / IMAGEN, compartido por los pasos `acuses` (normas)
 * y `menor` (imagen). SIEMPRE visible y funcional, exista o no el documento. Backends
 * distintos por tipo: `normas` escribe una fila en `acuses_alta`; `imagen` OTORGA el
 * consentimiento de imagen del niño (fuente de verdad, IU-2) igual que la firma. Es un
 * ACUSE monótono: una vez aceptado queda marcado y fijo (no se desmarca). Si además hay
 * documento publicado, el paso lo muestra aparte para abrir/leer/firmar.
 */
export function AcuseAltaCheckbox({ ninoId, tipo, aceptadoInicial, onAceptado }: Props) {
  const t = useTranslations('alta')
  const tErrors = useTranslations()
  const [aceptado, setAceptado] = useState(aceptadoInicial)
  const [pending, startTransition] = useTransition()

  function onMarcar(v: boolean) {
    if (!v || aceptado || pending) return // solo registra al marcar; un acuse no se desmarca
    startTransition(async () => {
      // imagen → otorga el consent por-niño (fuente de verdad, IU-2); normas → acuse.
      const r =
        tipo === 'imagen'
          ? await otorgarConsentimientoImagenAlta({ nino_id: ninoId })
          : await registrarAcuseAlta({ nino_id: ninoId, tipo: 'normas' })
      if (r.success) {
        setAceptado(true)
        onAceptado?.()
        toast.success(t('acuses.aceptado'))
      } else {
        toast.error(tErrors(r.error))
      }
    })
  }

  if (aceptado) {
    return (
      <p className="text-success-700 flex items-center gap-2 text-sm font-medium">
        <CheckCircle2Icon className="size-4" strokeWidth={2} aria-hidden />
        {t(`acuses.${tipo}_aceptado`)}
      </p>
    )
  }

  return (
    <label className="flex items-start gap-2 text-sm">
      <Checkbox checked={false} disabled={pending} onCheckedChange={(v) => onMarcar(v === true)} />
      <span>{t(`acuses.${tipo}_acepto`)}</span>
    </label>
  )
}
