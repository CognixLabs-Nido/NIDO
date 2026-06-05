'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { Eraser } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface FirmaPadProps {
  /** Llamado con el data URL (PNG) del trazo, o `null` al borrar / quedar vacío. */
  onChange: (dataUrl: string | null) => void
  disabled?: boolean
  className?: string
}

/**
 * Pad de firma con el dedo (o ratón): captura el trazo en un `<canvas>` vía
 * Pointer Events (táctil + ratón + lápiz unificados) y lo exporta como **PNG
 * data URL** que se guarda en `firmas_autorizacion.firma_imagen`. Componente
 * **reutilizable** por todos los tipos de autorización (recogida/medicación/...).
 *
 * Decisión de encoding (F8-1): PNG base64 vía `canvas.toDataURL`, por robustez
 * cross-device; el CHECK de BD admite SVG/PNG ≤500 KB. Cambiar a SVG vectorial es
 * un swap localizado en este componente.
 */
export function FirmaPad({ onChange, disabled, className }: FirmaPadProps) {
  const t = useTranslations('autorizaciones')
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
  const dibujando = useRef(false)
  const ultimo = useRef<{ x: number; y: number } | null>(null)
  const [vacio, setVacio] = useState(true)

  // Inicializa el canvas a su tamaño real (devicePixelRatio) y fondo blanco.
  const initCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ratio = Math.max(1, Math.min(3, window.devicePixelRatio || 1))
    const rect = canvas.getBoundingClientRect()
    canvas.width = Math.round(rect.width * ratio)
    canvas.height = Math.round(rect.height * ratio)
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(ratio, ratio)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, rect.width, rect.height)
    ctx.lineWidth = 2.2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#1f2937'
    ctxRef.current = ctx
  }, [])

  useEffect(() => {
    initCanvas()
  }, [initCanvas])

  function posicion(e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dibujando.current = true
    ultimo.current = posicion(e)
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!dibujando.current || disabled) return
    const ctx = ctxRef.current
    const prev = ultimo.current
    if (!ctx || !prev) return
    const p = posicion(e)
    ctx.beginPath()
    ctx.moveTo(prev.x, prev.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    ultimo.current = p
    if (vacio) setVacio(false)
  }

  function finalizarTrazo() {
    if (!dibujando.current) return
    dibujando.current = false
    ultimo.current = null
    const canvas = canvasRef.current
    if (canvas && !vacio) onChange(canvas.toDataURL('image/png'))
  }

  function borrar() {
    initCanvas()
    setVacio(true)
    onChange(null)
  }

  return (
    <div className={cn('space-y-2', className)}>
      <canvas
        ref={canvasRef}
        aria-label={t('firma.aria_pad')}
        className={cn(
          'border-input bg-background h-40 w-full touch-none rounded-md border',
          disabled && 'pointer-events-none opacity-50'
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finalizarTrazo}
        onPointerLeave={finalizarTrazo}
        onPointerCancel={finalizarTrazo}
      />
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground text-xs">{t('firma.pad_ayuda')}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={borrar}
          disabled={disabled || vacio}
        >
          <Eraser className="mr-1 size-3.5" />
          {t('firma.borrar')}
        </Button>
      </div>
    </div>
  )
}
