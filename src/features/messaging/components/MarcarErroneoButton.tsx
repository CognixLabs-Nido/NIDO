'use client'

import { AlertTriangleIcon } from 'lucide-react'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

import { marcarAnuncioErroneo } from '../actions/marcar-anuncio-erroneo'
import { marcarMensajeErroneo } from '../actions/marcar-mensaje-erroneo'
import { VENTANA_ANULACION_MS } from '../lib/constants'

interface Props {
  target: 'mensaje' | 'anuncio'
  id: string
  /** ISO timestamp del `created_at` de la fila. F5.6-B: si han pasado
   *  más de 5 min, el botón no se renderiza (early-return null). El
   *  snapshot se hace al montar con un lazy initializer
   *  (`react-hooks/purity` prohíbe `Date.now()` en render). */
  createdAt: string
  /** Si true, renderiza un botón ghost pequeño junto a la burbuja del mensaje. */
  inline?: boolean
}

/**
 * Patrón único para "marcar como erróneo" en mensajes y anuncios. Mismo
 * confirm dialog para ambos targets; el server action enforza autoría,
 * idempotencia y ventana de 5 min (F5.6-B).
 */
export function MarcarErroneoButton({ target, id, createdAt, inline = false }: Props) {
  const t = useTranslations('messages.anular')
  const tErr = useTranslations('messages.errors')
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  // Snapshot al montar (no countdown: spec dice que recálculo por render
  // basta; si la pantalla se queda abierta y se cruza la ventana, el
  // server devuelve `ventana_anulacion_expirada` y mostramos el toast).
  const [nowMs] = useState(() => Date.now())
  const fueraDeVentana = Date.parse(createdAt) <= nowMs - VENTANA_ANULACION_MS

  if (fueraDeVentana) return null

  function onConfirm() {
    startTransition(async () => {
      const res =
        target === 'mensaje'
          ? await marcarMensajeErroneo({ mensaje_id: id })
          : await marcarAnuncioErroneo({ anuncio_id: id })
      if (!res.success) {
        const key = res.error.replace('messages.errors.', '') as
          | 'envio_fallo'
          | 'ya_anulado'
          | 'no_autorizado'
          | 'ventana_anulacion_expirada'
        toast.error(tErr(key))
        setOpen(false)
        return
      }
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant={inline ? 'ghost' : 'outline'} size={inline ? 'sm' : 'default'}>
            <AlertTriangleIcon className="size-4" />
            <span className="ml-1">{t('boton')}</span>
          </Button>
        }
      />

      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('confirm_title')}</DialogTitle>
          <DialogDescription>{t('confirm_descripcion')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {t('cancelar')}
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={pending}>
            {pending ? t('anulando') : t('confirm_si')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
