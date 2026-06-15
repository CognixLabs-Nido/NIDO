'use client'

import { DownloadIcon, Loader2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { toast } from 'sonner'

import type { VariantProps } from 'class-variance-authority'

import { Button, buttonVariants } from '@/components/ui/button'

type ButtonVariant = VariantProps<typeof buttonVariants>['variant']
type ButtonSize = VariantProps<typeof buttonVariants>['size']

interface ExportButtonProps {
  /** Ruta de la route de export (incluye locale), p. ej. `/es/export/me`. */
  href: string
  /** Texto del botón (lo aporta cada vista según su contexto). */
  label: string
  /** Nombre de fallback si la respuesta no trae Content-Disposition. */
  filename?: string
  variant?: ButtonVariant
  size?: ButtonSize
}

/**
 * Dispara la descarga del ZIP de export (F11-A5) vía fetch, con estado de carga
 * (la generación puede tardar) y feedback por toast. Reusa las routes existentes
 * (`/export/me`, `/export/{tipo}/{id}`) sin tocar backend.
 */
export function ExportButton({
  href,
  label,
  filename = 'nido-export.zip',
  variant = 'outline',
  size = 'default',
}: ExportButtonProps) {
  const t = useTranslations('export')
  const [loading, setLoading] = useState(false)

  async function handleClick() {
    setLoading(true)
    try {
      const res = await fetch(href)
      if (!res.ok) throw new Error(String(res.status))
      const blob = await res.blob()

      const cd = res.headers.get('Content-Disposition')
      const match = cd?.match(/filename="?([^"]+)"?/)
      const nombre = match?.[1] ?? filename

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = nombre
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success(t('exito'))
    } catch {
      toast.error(t('error'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button variant={variant} size={size} onClick={handleClick} disabled={loading}>
      {loading ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />}
      {loading ? t('generando') : label}
    </Button>
  )
}
