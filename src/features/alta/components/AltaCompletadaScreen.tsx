import { CheckCircle2Icon } from 'lucide-react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

interface Props {
  ninoNombre: string
  /** Reentra al wizard para revisar/editar mientras la dirección valida (estado 'lista'). */
  editarHref: string
}

/**
 * Pantalla "completado, pendiente de validación" (P3c, DEC-A→b). Se muestra cuando la
 * matrícula está en `'lista'`: el tutor finalizó el alta y espera la activación de la
 * dirección. NO es el panel (que solo se abre al activar). Editable: el botón reentra
 * al wizard (cada paso ya persiste por su cuenta; re-finalizar es no-op).
 */
export async function AltaCompletadaScreen({ ninoNombre, editarHref }: Props) {
  const t = await getTranslations('alta')
  return (
    <Card className="mx-auto max-w-2xl">
      <CardContent className="space-y-3 py-10 text-center">
        <CheckCircle2Icon
          className="text-success-700 mx-auto size-12"
          strokeWidth={1.75}
          aria-hidden
        />
        <h2 className="text-h3">{t('completado.titulo')}</h2>
        <p className="text-muted-foreground mx-auto max-w-md text-sm">
          {t('completado.texto', { nombre: ninoNombre })}
        </p>
        <Link href={editarHref} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          {t('completado.editar')}
        </Link>
      </CardContent>
    </Card>
  )
}
