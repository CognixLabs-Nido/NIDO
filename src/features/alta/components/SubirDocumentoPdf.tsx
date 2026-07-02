'use client'

import { useState, useTransition } from 'react'

import { CheckCircle2Icon, FileTextIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { safeTranslateError } from '@/shared/lib/safe-translate'

import { ImagenesAPdfError, MAX_PAGINAS_PDF, imagenesAPdf } from '../lib/imagenes-a-pdf'

interface Props {
  locale: string
  ninoId: string
  /** Segmento de ruta del handler: `libro-familia` | `dni`. */
  endpoint: 'libro-familia' | 'dni'
  /** Campos extra del FormData (p. ej. `{ tipo_vinculo }` para el DNI). */
  extraFields?: Record<string, string>
  /** URL firmada del documento ya subido (preview), o null. */
  initialUrl?: string | null
  /** Etiqueta/ayuda ya traducidas por el padre. */
  titulo: string
  ayuda: string
}

interface RespuestaSubida {
  success: boolean
  error?: string
  documento?: { path: string; url: string | null }
  /** Alta ya validada (decisión J): el documento quedó en cola de validación de dirección. */
  pendienteValidacion?: boolean
}

/**
 * F11-G — subida de un documento PDF construido en cliente a partir de varias imágenes
 * (`imagenesAPdf`). Reutilizable: libro de familia (varias hojas) y DNI de un tutor (2
 * caras). Envía el PDF como multipart al route handler de subida, que aplica la RLS y
 * fija la ruta en BD. Tras subir, muestra el estado y un enlace de previsualización.
 */
export function SubirDocumentoPdf({
  locale,
  ninoId,
  endpoint,
  extraFields,
  initialUrl,
  titulo,
  ayuda,
}: Props) {
  const t = useTranslations('alta.documentos')
  const tErrors = useTranslations()
  const router = useRouter()
  const [files, setFiles] = useState<File[]>([])
  const [previewUrl, setPreviewUrl] = useState<string | null>(initialUrl ?? null)
  const [subido, setSubido] = useState<boolean>(Boolean(initialUrl))
  const [pending, startTransition] = useTransition()

  function subir() {
    if (files.length === 0) {
      toast.error(t('errors.sin_imagenes'))
      return
    }
    startTransition(async () => {
      let pdf: Blob
      try {
        pdf = await imagenesAPdf(files)
      } catch (e) {
        const clave = e instanceof ImagenesAPdfError ? e.clave : 'alta.documentos.errors.procesado'
        toast.error(safeTranslateError(tErrors, clave))
        return
      }

      const body = new FormData()
      body.append('file', new File([pdf], `${endpoint}.pdf`, { type: 'application/pdf' }))
      for (const [k, v] of Object.entries(extraFields ?? {})) body.append(k, v)

      let json: RespuestaSubida
      try {
        const res = await fetch(`/${locale}/alta/${ninoId}/${endpoint}`, {
          method: 'POST',
          body,
        })
        json = (await res.json()) as RespuestaSubida
      } catch {
        toast.error(t('errors.subida'))
        return
      }

      if (!json.success) {
        toast.error(safeTranslateError(tErrors, json.error ?? 'alta.documentos.errors.subida'))
        return
      }
      setSubido(true)
      setPreviewUrl(json.documento?.url ?? null)
      setFiles([])
      toast.success(json.pendienteValidacion ? t('validacion.enviado') : t('subido'))
      // El handler ya persistió (Storage + ruta en BD) ANTES de responder, así que la
      // fuente server refleja el documento aquí. Refrescamos el RSC para que `initialUrl`
      // deje de estar rancio: al re-montarse el paso tras navegar, muestra "subido" con su
      // preview sin re-subir (rehidratación, BUG 1 / PR-4a-1).
      router.refresh()
    })
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="space-y-1">
        <h4 className="text-sm font-semibold">{titulo}</h4>
        <p className="text-muted-foreground text-xs">{ayuda}</p>
      </div>

      {subido && (
        <p className="text-success-700 flex items-center gap-2 text-sm font-medium">
          <CheckCircle2Icon className="size-4" strokeWidth={2} aria-hidden />
          {t('subido')}
          {previewUrl && (
            <a
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary inline-flex items-center gap-1 underline"
            >
              <FileTextIcon className="size-4" aria-hidden />
              {t('ver')}
            </a>
          )}
        </p>
      )}

      <Input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        disabled={pending}
        onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
      />
      <p className="text-muted-foreground text-xs">{t('max_imagenes', { max: MAX_PAGINAS_PDF })}</p>

      <Button type="button" onClick={subir} disabled={pending || files.length === 0}>
        {pending ? t('subiendo') : subido ? t('reemplazar') : t('subir')}
      </Button>
    </div>
  )
}
