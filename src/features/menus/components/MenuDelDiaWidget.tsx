import { UtensilsIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { Card, CardContent } from '@/components/ui/card'

import { getMenuDelDia } from '../queries/get-menu-del-dia'

interface Props {
  centroId: string
  fecha: string
}

/**
 * Widget "Menú del día" para la sección Agenda en /family/nino/[id].
 *
 * Muestra el menú estándar del centro para la fecha consultada (NO los
 * overrides individuales por niño — eso ya se ve en la sección Comidas).
 *
 * Empty state amable si no hay plantilla publicada para el mes o si la
 * plantilla no tiene fila para esa fecha (B56).
 */
export async function MenuDelDiaWidget({ centroId, fecha }: Props) {
  const t = await getTranslations('menus.widget_familia')
  const tEmpty = await getTranslations('menus.empty')

  const menu = await getMenuDelDia(centroId, fecha)

  return (
    <Card data-testid="widget-menu-del-dia">
      <CardContent className="space-y-3">
        <header className="flex items-center gap-2">
          <UtensilsIcon className="text-primary-600 size-5" />
          <h3 className="text-foreground font-semibold">{t('title')}</h3>
        </header>
        {!menu ? (
          <p className="text-muted-foreground text-sm" data-testid="widget-menu-vacio">
            {tEmpty('sin_plantilla_publicada.descripcion')}
          </p>
        ) : (
          <div className="grid gap-2 text-sm">
            <Linea label={t('campos.desayuno')} valor={menu.desayuno} />
            <Linea label={t('campos.media_manana')} valor={menu.media_manana} />
            <ComidaLinea
              labelPrimero={t('campos.comida_primero')}
              labelSegundo={t('campos.comida_segundo')}
              labelPostre={t('campos.comida_postre')}
              primero={menu.comida_primero}
              segundo={menu.comida_segundo}
              postre={menu.comida_postre}
            />
            <Linea label={t('campos.merienda')} valor={menu.merienda} />
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Linea({ label, valor }: { label: string; valor: string | null }) {
  if (!valor) return null
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <span className="text-muted-foreground w-28 text-xs font-medium tracking-wide uppercase">
        {label}
      </span>
      <span className="text-foreground break-words">{valor}</span>
    </div>
  )
}

function ComidaLinea({
  labelPrimero,
  labelSegundo,
  labelPostre,
  primero,
  segundo,
  postre,
}: {
  labelPrimero: string
  labelSegundo: string
  labelPostre: string
  primero: string | null
  segundo: string | null
  postre: string | null
}) {
  if (!primero && !segundo && !postre) return null
  return (
    <div className="bg-muted/30 border-border/40 rounded-md border p-2">
      <Linea label={labelPrimero} valor={primero} />
      <Linea label={labelSegundo} valor={segundo} />
      <Linea label={labelPostre} valor={postre} />
    </div>
  )
}
