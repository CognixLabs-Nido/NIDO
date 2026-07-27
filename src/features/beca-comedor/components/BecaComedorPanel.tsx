import { getTranslations } from 'next-intl/server'

import { Card } from '@/components/ui/card'

import { CargasBeca } from './CargasBeca'
import { ElegibilidadList } from './ElegibilidadList'
import type { CargaBecaItem } from '../queries/get-cargas-beca'
import type { AlumnoElegibilidad } from '../queries/get-elegibilidad-becados'
import type { MesCurso } from '../lib/cargas'

interface Props {
  /** null = no hay curso activo → se muestra el aviso. */
  hayCurso: boolean
  alumnos: AlumnoElegibilidad[]
  cargas: CargaBecaItem[]
  meses: MesCurso[]
  mesesCerrados: MesCurso[]
}

/**
 * V2-2 + V2-3 — pestaña "Beca comedor" del hub de cuotas. Arriba, la elegibilidad por alumno
 * (quién tiene beca en el curso activo); abajo, las cargas por mes (el importe único de cada
 * mes para todos los becados). Todo sobre el curso ACTIVO, sin selector.
 */
export async function BecaComedorPanel({ hayCurso, alumnos, cargas, meses, mesesCerrados }: Props) {
  const t = await getTranslations('admin.cuotas.beca_comedor')

  if (!hayCurso) {
    return (
      <Card className="p-6">
        <p className="text-muted-foreground text-sm">{t('sin_curso')}</p>
      </Card>
    )
  }

  const hayBecados = alumnos.some((a) => a.elegible)

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div className="space-y-0.5">
          <h2 className="text-sm font-medium">{t('elegibilidad_title')}</h2>
          <p className="text-muted-foreground text-xs">{t('elegibilidad_hint')}</p>
        </div>
        <ElegibilidadList alumnos={alumnos} />
      </section>

      <section className="space-y-2">
        <div className="space-y-0.5">
          <h2 className="text-sm font-medium">{t('cargas_title')}</h2>
          <p className="text-muted-foreground text-xs">{t('cargas_hint')}</p>
        </div>
        <CargasBeca
          cargas={cargas}
          meses={meses}
          mesesCerrados={mesesCerrados}
          hayBecados={hayBecados}
        />
      </section>
    </div>
  )
}
