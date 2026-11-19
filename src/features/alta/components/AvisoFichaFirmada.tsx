'use client'

import { useState } from 'react'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

import { Button, buttonVariants } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import { PasoFirma } from './PasoFirma'

/**
 * El aviso de la ficha firmada (fase 10b-2): un cambio en un dato firmado entre firmar y validar deja
 * la firma sin valor y hay que volver a firmar (decisión del 2026-11-17). Literal: «Que la pantalla
 * lo diga antes de dejar cambiar nada, no después.»
 */
export function AvisoFichaFirmada({ className }: { className?: string }) {
  const t = useTranslations('alta.firma')
  return (
    <p
      role="note"
      data-testid="aviso-ficha-firmada"
      className={
        className ??
        'border-accent-warm-300 bg-accent-warm-50 text-accent-warm-800 rounded-xl border p-3 text-sm'
      }
    >
      {t('aviso_editar')}
    </p>
  )
}

/**
 * «Revisar o editar» con la ficha firmada y la firma vigente: antes de abrir el asistente pide
 * confirmar, con el aviso. Sin firma vigente es el enlace de siempre.
 */
export function EditarAltaFirmada({
  href,
  firmaVigente,
  etiqueta,
}: {
  href: string
  firmaVigente: boolean
  etiqueta: string
}) {
  const t = useTranslations('alta.firma')
  const router = useRouter()
  const [open, setOpen] = useState(false)
  if (!firmaVigente) {
    return (
      <Link href={href} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
        {etiqueta}
      </Link>
    )
  }
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        data-testid="editar-alta-firmada"
      >
        {etiqueta}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('confirmar_editar_titulo')}</DialogTitle>
            <DialogDescription>{t('aviso_editar')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t('confirmar_editar_no')}
            </Button>
            <Button type="button" onClick={() => router.push(href)}>
              {t('confirmar_editar_si')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * Volver a firmar la ficha fuera del asistente: en la pantalla del alta terminada (la firma dejó de
 * valer, o el alta se cerró antes de la firma) y en la ficha del niño (Dirección pidió la refirma).
 */
export function RefirmaFicha({
  ninoId,
  puedeLeerFichaMedica,
  nombreInicial,
  motivo,
}: {
  ninoId: string
  puedeLeerFichaMedica: boolean
  nombreInicial: string
  motivo: 'invalidada' | 'sin_firma' | 'pedida'
}) {
  const t = useTranslations('alta.firma')
  const router = useRouter()
  return (
    <div className="space-y-3 text-left" data-testid={`refirma-ficha-${motivo}`}>
      <p className="border-accent-warm-300 bg-accent-warm-50 text-accent-warm-800 rounded-xl border p-3 text-sm">
        {t(`motivo_refirma.${motivo}`)}
      </p>
      <PasoFirma
        ninoId={ninoId}
        contexto="refirma"
        puedeLeerFichaMedica={puedeLeerFichaMedica}
        nombreInicial={nombreInicial}
        onFirmado={() => router.refresh()}
      />
    </div>
  )
}
