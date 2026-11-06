'use client'

import { useState, useTransition } from 'react'

import { CheckCircle2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Checkbox } from '@/components/ui/checkbox'

import { otorgarConsentimientoImagenAlta } from '../actions/otorgar-imagen-alta'

interface Props {
  ninoId: string
  /** ¿Ya está aceptada? (lo deriva la ruta server-side: el consent de imagen del niño, IU-2). */
  aceptadoInicial: boolean
  /**
   * Aviso al padre de que acaba de aceptarse, para lo que dependa del acuse en la MISMA
   * pantalla (la foto del niño, que necesita el consent de imagen). Sin esto habría que
   * recargar para que el resto se enterase.
   */
  onAceptado?: () => void
}

/**
 * La casilla de la autorización de IMAGEN del paso `menor`: OTORGA el consentimiento de imagen del
 * niño (fuente de verdad, IU-2), igual que la firma. SIEMPRE visible y funcional, exista o no el
 * documento. Es un acuse monótono: una vez aceptado queda marcado y fijo (no se desmarca). Si además
 * hay documento publicado, el paso lo muestra aparte para abrir y firmar.
 *
 * Hasta el 4b-2 la compartía la casilla de las NORMAS (una fila en `acuses_alta`). Se quitó el
 * 2026-11-06: las normas son un documento del centro y se firman en el paso `acuses`. «No mantengas
 * la casilla con una condición: un camino viejo que sobrevive "solo mientras" no se quita nunca.»
 */
export function AcuseAltaCheckbox({ ninoId, aceptadoInicial, onAceptado }: Props) {
  const t = useTranslations('alta')
  const tErrors = useTranslations()
  const [aceptado, setAceptado] = useState(aceptadoInicial)
  const [pending, startTransition] = useTransition()

  function onMarcar(v: boolean) {
    if (!v || aceptado || pending) return // solo registra al marcar; un acuse no se desmarca
    startTransition(async () => {
      const r = await otorgarConsentimientoImagenAlta({ nino_id: ninoId })
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
        {t('acuses.imagen_aceptado')}
      </p>
    )
  }

  return (
    <label className="flex items-start gap-2 text-sm">
      <Checkbox checked={false} disabled={pending} onCheckedChange={(v) => onMarcar(v === true)} />
      <span>{t('acuses.imagen_acepto')}</span>
    </label>
  )
}
