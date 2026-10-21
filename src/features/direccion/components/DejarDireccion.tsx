'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

import { dejarLaDireccion } from '../actions/gestionar-direccion'

import { ConfirmarDireccionDialog } from './ConfirmarDireccionDialog'

/**
 * «Dejar la dirección» de un centro. Una directora la deja (confirmando). La admin no puede: el
 * botón le explica que antes tiene que traspasar la administración a una directora.
 */
export function DejarDireccion({
  centroId,
  locale,
  administra,
}: {
  centroId: string
  locale: string
  /** Tiene la fila de admin de este centro. */
  administra: boolean
}) {
  const t = useTranslations('admin.direccion.dejar')
  const router = useRouter()
  const [open, setOpen] = useState(false)

  if (!administra) {
    return (
      <ConfirmarDireccionDialog
        cta={t('cta')}
        titulo={t('title')}
        texto={t('texto')}
        confirmar={t('confirmar')}
        destructiva
        accion={() => dejarLaDireccion(centroId)}
        alTerminar={() => router.push(`/${locale}`)}
      />
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="ghost" size="sm" className="text-destructive">
            {t('cta')}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">{t('aviso_admin')}</p>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            {t('entendido')}
          </Button>
          <Button render={<Link href={`/${locale}/admin/direccion`} />}>{t('ir')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
