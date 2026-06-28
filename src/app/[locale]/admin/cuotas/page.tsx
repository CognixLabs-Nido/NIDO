import { getTranslations } from 'next-intl/server'

import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { ConceptosCatalogo } from '@/features/conceptos-cobro/components/ConceptosCatalogo'
import { getConceptosCobro } from '@/features/conceptos-cobro/queries/get-conceptos-cobro'

// F12-B-1: hub del módulo de cobros (/admin/cuotas). Estrena con el catálogo de
// conceptos de cobro; subfases B-2…B-7 colgarán de aquí (asignación, parte, cierre,
// remesas). El layout admin ya valida rol admin + centro.
export default async function AdminCuotasPage() {
  const t = await getTranslations('admin.cuotas')
  const centroId = (await getCentroActualId())!
  const conceptos = await getConceptosCobro(centroId)

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-h1">{t('title')}</h1>
        <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
      </header>
      <ConceptosCatalogo centroId={centroId} conceptos={conceptos} />
    </div>
  )
}
