'use client'

import { DownloadIcon, Loader2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'

import type { MediaFamiliaItem, PublicacionFamiliaItem } from '../types'

interface Props {
  locale: string
  publicaciones: PublicacionFamiliaItem[]
}

/**
 * Feed de SOLO LECTURA del blog del aula para la familia (F10-2). Miniaturas en la
 * rejilla; al pulsar una foto abre el original (enlace firmado) en un visor con botón
 * de **descarga** (P4). La familia no publica/edita/etiqueta y no ve quién está
 * etiquetado. La visibilidad (aula actual + histórico) la decide la RLS aguas arriba.
 */
export function FotosFamiliaFeed({ locale, publicaciones }: Props) {
  const t = useTranslations('fotos')
  const [abierta, setAbierta] = useState<MediaFamiliaItem | null>(null)
  const [descargando, setDescargando] = useState(false)

  async function descargar(media: MediaFamiliaItem) {
    if (!media.url) return
    setDescargando(true)
    try {
      // fetch→blob para forzar descarga (el enlace firmado es cross-origin a Storage).
      const res = await fetch(media.url)
      if (!res.ok) throw new Error('fetch')
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = `foto-${media.id}.jpg`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(objectUrl)
    } catch {
      toast.error(t('family.descarga_fallo'))
    } finally {
      setDescargando(false)
    }
  }

  return (
    <>
      <ul className="space-y-5">
        {publicaciones.map((pub) => (
          <li key={pub.id} className="bg-card border-border/60 space-y-3 rounded-2xl border p-4">
            {pub.texto && <p className="text-foreground text-sm break-words">{pub.texto}</p>}
            <p className="text-muted-foreground text-xs">
              {pub.autorNombre ?? ''} · {formatearFecha(pub.createdAt, locale)}
            </p>
            {pub.media.length > 0 && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                {pub.media.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setAbierta(m)}
                    className="focus-visible:ring-ring overflow-hidden rounded-lg focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                    aria-label={t('family.abrir')}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- enlace firmado de Storage; next/image no aporta */}
                    <img
                      src={m.urlMiniatura ?? m.url ?? ''}
                      alt={pub.texto ?? t('foto_alt')}
                      className="aspect-square w-full object-cover transition-transform hover:scale-105"
                    />
                  </button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>

      <Dialog open={abierta !== null} onOpenChange={(o) => !o && setAbierta(null)}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-[760px]">
          <DialogTitle className="sr-only">{t('family.foto_titulo')}</DialogTitle>
          {abierta && (
            <div className="space-y-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- enlace firmado de Storage */}
              <img
                src={abierta.url ?? abierta.urlMiniatura ?? ''}
                alt={t('foto_alt')}
                className="max-h-[70dvh] w-full rounded-lg object-contain"
              />
              <div className="flex justify-end">
                <Button type="button" onClick={() => descargar(abierta)} disabled={descargando}>
                  {descargando ? (
                    <Loader2Icon className="size-4 animate-spin" />
                  ) : (
                    <DownloadIcon className="size-4" />
                  )}
                  {t('family.descargar')}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

function formatearFecha(iso: string, locale: string): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(iso)
    )
  } catch {
    return iso
  }
}
