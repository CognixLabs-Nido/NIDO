'use client'

import { useState, useTransition } from 'react'

import { CheckCircle2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Checkbox } from '@/components/ui/checkbox'

import { registrarAcuseAlta } from '../actions/registrar-acuse-alta'

interface Props {
  ninoId: string
  tipo: 'normas' | 'imagen'
  /** ¿Ya hay fila en `acuses_alta` para este niño+tipo? (lo deriva la ruta server-side). */
  aceptadoInicial: boolean
}

/**
 * Vía B — acuse por checkbox de NORMAS / IMAGEN, compartido por los pasos `acuses` (normas)
 * y `menor` (imagen). SIEMPRE visible y funcional, exista o no el documento: al marcar,
 * escribe una fila en `acuses_alta` (sin firma, sin trazo, sin documento) que satisface el
 * gate de finalizar. Es un ACUSE (hecho puntual): una vez aceptado queda marcado y fijo.
 * Si además hay documento publicado, el paso lo muestra aparte para abrir/leer/firmar.
 */
export function AcuseAltaCheckbox({ ninoId, tipo, aceptadoInicial }: Props) {
  const t = useTranslations('alta')
  const tErrors = useTranslations()
  const [aceptado, setAceptado] = useState(aceptadoInicial)
  const [pending, startTransition] = useTransition()

  function onMarcar(v: boolean) {
    if (!v || aceptado || pending) return // solo registra al marcar; un acuse no se desmarca
    startTransition(async () => {
      const r = await registrarAcuseAlta({ nino_id: ninoId, tipo })
      if (r.success) {
        setAceptado(true)
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
