import { ShieldOffIcon } from 'lucide-react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

import { Card, CardContent } from '@/components/ui/card'

import { getPeticionesCentro, resumenPorRevisar } from '../queries/get-peticiones'

/**
 * Aviso del Inicio de la titular: cuántas peticiones de borrado esperan su revisión y cuántos días
 * lleva la más antigua (el plazo legal de respuesta es un mes). Sin pendientes, no sale.
 */
export async function AvisoPeticionesOlvido({
  centroId,
  locale,
}: {
  centroId: string
  locale: string
}) {
  const peticiones = await getPeticionesCentro(centroId)
  if (!peticiones) return null
  const { pendientes, diasMasAntigua } = resumenPorRevisar(peticiones)
  if (pendientes === 0) return null
  const t = await getTranslations('olvido.admin')

  return (
    <Link href={`/${locale}/admin/olvido`} className="block">
      <Card className="hover:bg-muted/50 transition-colors">
        <CardContent className="flex items-center gap-3 text-sm">
          <ShieldOffIcon className="text-muted-foreground size-5 shrink-0" />
          <span>{t('aviso_inicio', { n: pendientes, dias: diasMasAntigua })}</span>
        </CardContent>
      </Card>
    </Link>
  )
}
