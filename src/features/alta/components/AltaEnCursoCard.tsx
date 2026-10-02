import { ClipboardListIcon } from 'lucide-react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

/**
 * Tarjeta «alta en curso» de la ficha de un hijo cuya matrícula aún no está activa
 * (gate per-hijo de `/family`). Sustituye al contenido de la ficha —que asume una
 * matrícula activa— por el acceso al asistente de alta de ese hijo.
 */
export async function AltaEnCursoCard({
  ninoId,
  nombre,
  locale,
}: {
  ninoId: string
  nombre: string
  locale: string
}) {
  const t = await getTranslations('family.alta_en_curso')
  return (
    <Card data-testid="alta-en-curso-card">
      <CardContent className="flex flex-col items-start gap-3">
        <h1 className="text-h2 text-foreground flex items-center gap-2">
          <ClipboardListIcon className="text-primary-600 size-6" />
          {t('titulo', { nombre })}
        </h1>
        <p className="text-muted-foreground text-sm">{t('descripcion')}</p>
        <Button
          render={<Link href={`/${locale}/alta/${ninoId}`} />}
          data-testid="continuar-alta-button"
        >
          {t('cta')}
        </Button>
      </CardContent>
    </Card>
  )
}
