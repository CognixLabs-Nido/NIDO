import { UtensilsCrossedIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { Card, CardContent } from '@/components/ui/card'

import type { MenuDelDia } from '../types'

/**
 * Widget compacto que muestra los 4 momentos del menú del día. Server
 * Component — recibe el menú ya resuelto desde el padre. Si `menu`
 * es null, no renderiza nada (se oculta).
 *
 * Reusado en la sección Agenda de /family/nino/[id] y disponible para
 * cualquier otra superficie en el futuro.
 */
export async function MenuDelDiaWidget({ menu }: { menu: MenuDelDia | null }) {
  if (!menu) return null

  const t = await getTranslations('menu_del_dia_widget')
  const tMenus = await getTranslations('menus')

  const items: Array<[string, string | null]> = [
    [tMenus('momento.desayuno'), menu.desayuno],
    [tMenus('momento.media_manana'), menu.media_manana],
    [tMenus('momento.comida'), menu.comida],
    [tMenus('momento.merienda'), menu.merienda],
  ]

  // Si todos los momentos están null, no mostramos el widget (caso edge:
  // plantilla con día creado pero todos los momentos vacíos).
  const algunoDefinido = items.some(([, v]) => v && v.trim().length > 0)
  if (!algunoDefinido) return null

  return (
    <Card data-testid="menu-del-dia-widget">
      <CardContent className="space-y-2">
        <div className="flex items-center gap-2">
          <UtensilsCrossedIcon className="text-accent-warm-600 size-4" />
          <h3 className="text-foreground text-sm font-semibold">{t('title')}</h3>
        </div>
        <ul className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
          {items.map(([label, value]) =>
            value ? (
              <li key={label} className="flex flex-col gap-0.5">
                <span className="text-muted-foreground text-xs tracking-wide uppercase">
                  {label}
                </span>
                <span className="text-foreground">{value}</span>
              </li>
            ) : null
          )}
        </ul>
      </CardContent>
    </Card>
  )
}
