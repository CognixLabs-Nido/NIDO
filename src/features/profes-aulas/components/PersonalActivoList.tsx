import { getTranslations } from 'next-intl/server'

import { Card, CardContent } from '@/components/ui/card'
import type { TipoPersonalAula } from '@/features/profes-aulas/types'

export interface PersonalActivoVista {
  profe_id: string
  nombre_completo: string
  email: string | null
  /** URL ya FIRMADA del avatar (la firma la hace la página); null → iniciales. */
  fotoUrl: string | null
  asignaciones: { aula_nombre: string; tipo_personal_aula: TipoPersonalAula }[]
}

/** Iniciales (máx. 2) para el placeholder cuando no hay avatar. */
function iniciales(nombre: string): string {
  return nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
}

/**
 * Listado de personal activo del centro (Fallo 1). **Una fila por persona**;
 * si está en varias aulas, los pares "rol · aula" se listan en la misma fila.
 * Server Component (solo presenta) — mismo estilo que `InvitacionesProfeList`.
 */
export async function PersonalActivoList({ items }: { items: PersonalActivoVista[] }) {
  const t = await getTranslations('admin.personal.activos')
  const tTipos = await getTranslations('admin.personal.tipo_personal')

  if (items.length === 0) {
    return <p className="text-muted-foreground text-sm">{t('empty')}</p>
  }

  return (
    <div className="space-y-3">
      {items.map((p) => (
        <Card key={p.profe_id}>
          <CardContent className="flex flex-wrap items-center gap-3 py-4">
            <div className="bg-primary-100 text-primary-700 flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-bold">
              {p.fotoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- enlace firmado (cross-origin, caduca)
                <img src={p.fotoUrl} alt={p.nombre_completo} className="size-full object-cover" />
              ) : (
                iniciales(p.nombre_completo)
              )}
            </div>
            <div className="min-w-0 space-y-0.5">
              <p className="text-foreground truncate font-medium">{p.nombre_completo}</p>
              {p.email && <p className="text-muted-foreground truncate text-sm">{p.email}</p>}
              <p className="text-muted-foreground text-sm">
                {p.asignaciones
                  .map((a) => `${tTipos(a.tipo_personal_aula)} · ${a.aula_nombre}`)
                  .join(' / ')}
              </p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
