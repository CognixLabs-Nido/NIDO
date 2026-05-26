'use client'

import { CheckCircle2Icon, CircleDashedIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

import type { LectorAnuncioItem } from '../queries/get-lectores-anuncio'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  locale: string
  lectores: LectorAnuncioItem[]
  total: number
  leidos: number
}

/**
 * Modal con el desglose "X marcado leído / Y sin leer" para el autor del
 * anuncio. Los datos se cargan SSR (vía `getLectoresAnuncio`) y se pasan
 * aquí, así no hay loading state. Realtime + router.refresh garantizan que
 * cuando un destinatario marca leído mientras el modal está abierto, la
 * página se re-renderiza y el contenido del modal se actualiza sin
 * intervención del usuario.
 *
 * Lista ordenada en la query: primero los que leyeron (más recientes
 * arriba), después los pendientes alfabéticos.
 */
export function LectoresAnuncioModal({
  open,
  onOpenChange,
  locale,
  lectores,
  total,
  leidos,
}: Props) {
  const t = useTranslations('messages.anuncio')

  const formatFechaHora = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('lectores_modal_titulo')}</DialogTitle>
          <DialogDescription>{t('lectores_modal_subtitulo', { leidos, total })}</DialogDescription>
        </DialogHeader>

        {lectores.length === 0 ? (
          <p className="text-muted-foreground py-6 text-center text-sm">
            {t('lectores_lista_vacia')}
          </p>
        ) : (
          <ul className="max-h-[60vh] divide-y overflow-y-auto">
            {lectores.map((l) => {
              const leido = l.leido_en !== null
              return (
                <li
                  key={l.usuario_id}
                  className="flex items-start gap-3 py-2"
                  data-testid={`lector-${l.usuario_id}`}
                >
                  {leido ? (
                    <CheckCircle2Icon
                      className="mt-0.5 size-4 shrink-0 text-green-600"
                      aria-hidden
                    />
                  ) : (
                    <CircleDashedIcon
                      className="text-muted-foreground mt-0.5 size-4 shrink-0"
                      aria-hidden
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        'truncate text-sm font-medium',
                        !leido && 'text-muted-foreground'
                      )}
                    >
                      {l.nombre_completo}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {leido && l.leido_en
                        ? t('lectores_leido_en', { fechaHora: formatFechaHora(l.leido_en) })
                        : t('lectores_sin_leer')}
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{t('lectores_cerrar')}</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
