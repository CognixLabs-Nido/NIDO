'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { ArchiveIcon, CheckIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

import { archivarPlantilla } from '../actions/archivar-plantilla'
import { publicarPlantilla } from '../actions/publicar-plantilla'
import type { EstadoPlantillaMenu } from '../schemas/menu'

/**
 * Botones de Publicar y Archivar para la lista de plantillas. Los labels
 * se inyectan localizados desde el server (la página /admin/menus es un
 * RSC; este componente solo se hidrata para los dialogs).
 */
interface Labels {
  publicar: string
  publicarConfirmTitle: string
  publicarConfirmDesc: string
  publicarConfirmSi: string
  archivar: string
  archivarConfirmTitle: string
  archivarConfirmDesc: string
  archivarConfirmSi: string
  cancelar: string
}

interface Props {
  plantillaId: string
  estado: EstadoPlantillaMenu
  labels: Labels
}

export function AccionesPlantilla({ plantillaId, estado, labels }: Props) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [confirm, setConfirm] = useState<'publicar' | 'archivar' | null>(null)
  const [error, setError] = useState<string | null>(null)

  function confirmar() {
    if (!confirm) return
    setError(null)
    startTransition(async () => {
      const result =
        confirm === 'publicar'
          ? await publicarPlantilla(plantillaId)
          : await archivarPlantilla(plantillaId)
      if (result.success) {
        setConfirm(null)
        router.refresh()
      } else {
        setError(result.error)
      }
    })
  }

  return (
    <div className="flex items-center justify-end gap-1">
      {estado === 'borrador' && (
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={() => setConfirm('publicar')}
          data-testid={`publicar-${plantillaId}`}
        >
          <CheckIcon className="size-3.5" />
          {labels.publicar}
        </Button>
      )}
      {estado !== 'archivada' && (
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={() => setConfirm('archivar')}
          data-testid={`archivar-${plantillaId}`}
        >
          <ArchiveIcon className="size-3.5" />
          {labels.archivar}
        </Button>
      )}

      <Dialog open={confirm !== null} onOpenChange={(v) => !v && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm === 'publicar' ? labels.publicarConfirmTitle : labels.archivarConfirmTitle}
            </DialogTitle>
            <DialogDescription>
              {confirm === 'publicar' ? labels.publicarConfirmDesc : labels.archivarConfirmDesc}
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirm(null)}
              disabled={pending}
            >
              {labels.cancelar}
            </Button>
            <Button
              type="button"
              variant={confirm === 'archivar' ? 'destructive' : 'default'}
              onClick={confirmar}
              disabled={pending}
              data-testid={`confirmar-${confirm}-${plantillaId}`}
            >
              {confirm === 'publicar' ? labels.publicarConfirmSi : labels.archivarConfirmSi}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
