'use client'

import { DownloadIcon, Loader2Icon } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

interface Props {
  remesaId: string
  disabled?: boolean
}

/**
 * Descarga el XML pain.008 de la remesa vía el route handler (generación bajo
 * demanda). Traduce los errores 422 del servidor (sin mandato / acreedor incompleto
 * / remesa vacía) a un toast claro; no genera ficheros a medias.
 */
export function RemesaXmlButton({ remesaId, disabled }: Props) {
  const t = useTranslations('remesas')
  const locale = useLocale()
  const [loading, setLoading] = useState(false)

  async function descargar() {
    setLoading(true)
    try {
      const res = await fetch(`/${locale}/admin/remesas/${remesaId}/xml`)
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string
          ninos?: string[]
        } | null
        const motivo = body?.error
        if (motivo === 'sin_mandato') {
          toast.error(t('errors.sin_mandato', { num: body?.ninos?.length ?? 0 }))
        } else if (motivo === 'acreedor_incompleto') {
          toast.error(t('errors.acreedor_incompleto'))
        } else if (motivo === 'remesa_vacia') {
          toast.error(t('errors.remesa_vacia'))
        } else if (motivo === 'no_autorizado') {
          toast.error(t('errors.no_autorizado'))
        } else {
          toast.error(t('errors.xml_failed'))
        }
        return
      }

      const blob = await res.blob()
      const cd = res.headers.get('Content-Disposition')
      const match = cd?.match(/filename="?([^"]+)"?/)
      const nombre = match?.[1] ?? `remesa-${remesaId.slice(0, 8)}.xml`

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = nombre
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success(t('xml_ok'))
    } catch {
      toast.error(t('errors.xml_failed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={descargar} disabled={disabled || loading}>
      {loading ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />}
      {t('descargar_xml')}
    </Button>
  )
}
