'use client'

import { useTransition } from 'react'

import { AlertTriangleIcon } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'

import { borrarFicheroSueltoAccion } from '../actions/versiones'

/**
 * Los ficheros del bucket del centro que ya no son de ninguna versión: un borrado cuyo fichero no se
 * fue (J5). Un PDF subido por error puede llevar datos de otra familia, así que no se deja sin
 * decirlo: sale arriba, con «reintentar».
 */
export function FicherosSueltos({ centroId, rutas }: { centroId: string; rutas: string[] }) {
  const t = useTranslations('documentos_centro.pantalla')
  const tRoot = useTranslations()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  if (rutas.length === 0) return null

  function reintentar() {
    startTransition(async () => {
      let quedan = 0
      for (const ruta of rutas) {
        const r = await borrarFicheroSueltoAccion(centroId, ruta)
        if (!r.success) {
          toast.error(tRoot(r.error))
          quedan++
        } else if (!r.data.ficheroBorrado) quedan++
      }
      if (quedan === 0) toast.success(t('sueltos_borrados'))
      else toast.warning(t('sueltos_quedan', { n: quedan }))
      router.refresh()
    })
  }

  return (
    <div
      role="alert"
      className="border-accent-yellow-200 bg-accent-yellow-100 text-accent-yellow-700 flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm"
    >
      <span className="flex items-center gap-2">
        <AlertTriangleIcon className="size-4 shrink-0" />
        {t('sueltos', { n: rutas.length })}
      </span>
      <Button size="sm" variant="outline" disabled={pending} onClick={reintentar}>
        {t('reintentar')}
      </Button>
    </div>
  )
}
