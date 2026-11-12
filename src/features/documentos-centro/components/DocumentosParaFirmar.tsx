'use client'

import { useState, useTransition } from 'react'

import { CheckCircle2Icon, ExternalLinkIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useFormatter, useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FirmaPad } from '@/features/autorizaciones/components/FirmaPad'
import type { Database } from '@/types/db'

import { firmarDocumentoCentroAction } from '../actions/firmar'

/** Una fila de `documentos_firma_nino` (4a), lo que la pantalla necesita. */
export interface DocumentoParaFirmarFila {
  documento_id: string
  titulo: string
  obligatorio: boolean
  curso_academico_id: string | null
  curso_nombre: string | null
  estado: string
  version_id: string | null
  /**
   * La última firma de ese documento y curso, también si ya no vale: `por_firmar` con firma es que
   * el centro pidió volver a firmarlo (4d).
   */
  firma_id: string | null
  firmado_at: string | null
  metodo_firma: Database['public']['Enums']['firma_metodo'] | null
}

interface Props {
  locale: string
  ninoId: string
  documentos: DocumentoParaFirmarFila[]
  /** Modo Dirección: la firma se registra en persona, sin trazo. Lo vuelve a decidir el servidor. */
  modoDireccion: boolean
}

/**
 * Los documentos del centro para firmar (fase 4): en el alta (4b-1) y en la ficha del niño (4c). Cada uno con su estado: el que el centro no
 * ha subido todavía no se firma aquí ni frena nada (P-6: la familia lo firma cuando exista); el que
 * está por firmar se abre, y el botón de firmar sale después de abrirlo (decisión del 2026-11-06).
 * Abrirlo no prueba que se haya leído, y el texto no lo dice.
 */
export function DocumentosParaFirmar({ locale, ninoId, documentos, modoDireccion }: Props) {
  const t = useTranslations('firmar_documentos')
  if (documentos.length === 0) return null
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">{t('titulo')}</h3>
      <ul className="space-y-3">
        {documentos.map((d) => (
          <li
            key={`${d.documento_id}:${d.curso_academico_id ?? ''}`}
            className="space-y-2 rounded-lg border p-3"
          >
            <Documento locale={locale} ninoId={ninoId} doc={d} modoDireccion={modoDireccion} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function Documento({
  locale,
  ninoId,
  doc,
  modoDireccion,
}: {
  locale: string
  ninoId: string
  doc: DocumentoParaFirmarFila
  modoDireccion: boolean
}) {
  const t = useTranslations('firmar_documentos')
  const tErrors = useTranslations()
  const format = useFormatter()
  const router = useRouter()
  const [abierto, setAbierto] = useState(false)
  const [nombre, setNombre] = useState('')
  const [firma, setFirma] = useState<string | null>(null)
  const [pending, start] = useTransition()

  const cabecera = (
    <p className="text-sm font-medium">
      {doc.titulo}
      {doc.curso_nombre && (
        <span className="text-muted-foreground font-normal">
          {' · '}
          {t('curso', { curso: doc.curso_nombre })}
        </span>
      )}
      {!doc.obligatorio && (
        <span className="text-muted-foreground font-normal">
          {' · '}
          {t('opcional')}
        </span>
      )}
    </p>
  )

  if (doc.estado === 'firmado') {
    const fecha = doc.firmado_at
      ? format.dateTime(new Date(doc.firmado_at), { dateStyle: 'long', timeZone: 'Europe/Madrid' })
      : ''
    return (
      <>
        {cabecera}
        <p className="text-success-700 flex items-center gap-2 text-sm">
          <CheckCircle2Icon className="size-4" strokeWidth={2} aria-hidden />
          {doc.metodo_firma === 'presencial'
            ? t('firmado_papel', { fecha })
            : t('firmado', { fecha })}
        </p>
      </>
    )
  }

  if (doc.estado !== 'por_firmar' || !doc.version_id) {
    // `falta_documento`: el centro todavía no lo ha subido.
    return (
      <>
        {cabecera}
        <p className="text-muted-foreground text-sm">{t('falta', { titulo: doc.titulo })}</p>
      </>
    )
  }

  const versionId = doc.version_id
  const firmar = () =>
    start(async () => {
      const r = await firmarDocumentoCentroAction({
        ninoId,
        versionId,
        nombreTecleado: nombre,
        firmaImagen: modoDireccion ? null : firma,
      })
      if (r.success) {
        toast.success(t('firmado_ok'))
      } else {
        toast.error(tErrors(r.error))
      }
      // También con error: si otro tutor lo firmó o hay una versión nueva, la lista lo dice.
      router.refresh()
    })

  return (
    <>
      {cabecera}
      {doc.firma_id && doc.firmado_at && (
        <p className="text-accent-warm-800 text-sm" data-testid="refirma">
          {t('refirma', {
            titulo: doc.titulo,
            fecha: format.dateTime(new Date(doc.firmado_at), {
              dateStyle: 'long',
              timeZone: 'Europe/Madrid',
            }),
          })}
        </p>
      )}
      <a
        href={`/${locale}/documento-centro/${ninoId}/${versionId}`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => setAbierto(true)}
        className="text-primary inline-flex items-center gap-1 text-sm underline"
      >
        {t('abrir')}
        <ExternalLinkIcon className="size-3.5" aria-hidden />
      </a>
      {!abierto ? (
        <p className="text-muted-foreground text-xs">{t('antes_de_abrir')}</p>
      ) : (
        <div className="space-y-3 border-t pt-3">
          <p className="text-muted-foreground text-xs">{t('abierto')}</p>
          <div className="space-y-2">
            <Label htmlFor={`nombre-doc-${versionId}`}>{t('nombre')}</Label>
            <Input
              id={`nombre-doc-${versionId}`}
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              maxLength={200}
            />
          </div>
          {modoDireccion ? (
            <p className="border-accent-warm-300 bg-accent-warm-50 text-accent-warm-800 rounded-lg border p-3 text-sm">
              {t('presencial_aviso', { titulo: doc.titulo })}
            </p>
          ) : (
            <div className="space-y-1">
              <Label>{t('trazo')}</Label>
              <FirmaPad onChange={setFirma} disabled={pending} />
            </div>
          )}
          <Button
            type="button"
            onClick={firmar}
            disabled={pending || nombre.trim() === '' || (!modoDireccion && !firma)}
          >
            {modoDireccion
              ? t('firmar_presencial', { titulo: doc.titulo })
              : t('firmar', { titulo: doc.titulo })}
          </Button>
        </div>
      )}
    </>
  )
}
