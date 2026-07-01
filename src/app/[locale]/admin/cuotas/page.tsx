import { getTranslations } from 'next-intl/server'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { BecasPanel } from '@/features/becas/components/BecasPanel'
import { getBecas } from '@/features/becas/queries/get-becas'
import { getTiposBeca } from '@/features/becas/queries/get-tipos-beca'
import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { CierrePanel } from '@/features/cierre-cobros/components/CierrePanel'
import { getCierreMes } from '@/features/cierre-cobros/queries/get-cierre-mes'
import { ConceptosCatalogo } from '@/features/conceptos-cobro/components/ConceptosCatalogo'
import { getConceptosCobro } from '@/features/conceptos-cobro/queries/get-conceptos-cobro'
import { AsignacionMensualPanel } from '@/features/cuotas-config/components/AsignacionMensualPanel'
import { getConceptosAsignables } from '@/features/cuotas-config/queries/get-conceptos-asignables'
import { getConfigMes } from '@/features/cuotas-config/queries/get-config-mes'
import { getNinosPorCentro } from '@/features/ninos/queries/get-ninos'
import { PivotePanel } from '@/features/recibos/components/PivotePanel'
import { getPivotePeriodo } from '@/features/recibos/queries/get-pivote-periodo'
import { RemesasPanel } from '@/features/remesas/components/RemesasPanel'
import { getDatosAcreedor } from '@/features/remesas/queries/get-datos-acreedor'
import { getRecibosGestion } from '@/features/remesas/queries/get-recibos-gestion'
import { getRecibosSepaRemesables } from '@/features/remesas/queries/get-recibos-sepa-remesables'
import { getRemesasMes } from '@/features/remesas/queries/get-remesas-mes'

interface PageProps {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ tab?: string; anio?: string; mes?: string }>
}

// F12-B-2/7: configuración de cobro por niño y mes + gestión de remesas + resumen pivote.
// Tabs: catálogo de conceptos (B-1), asignación mensual, becas, cierre, remesas y resumen
// (pivote de recibos del período, B-7). El layout admin valida rol + centro.
export default async function AdminCuotasPage({ params, searchParams }: PageProps) {
  const t = await getTranslations('admin.cuotas')
  const { locale } = await params
  const sp = await searchParams
  const centroId = (await getCentroActualId())!

  const ahora = new Date()
  const anio = clamp(Number(sp.anio), 2024, 2100) ?? ahora.getFullYear()
  const mes = clamp(Number(sp.mes), 1, 12) ?? ahora.getMonth() + 1
  const tab = ['conceptos', 'asignacion', 'becas', 'cierre', 'remesas', 'resumen'].includes(
    sp.tab ?? ''
  )
    ? (sp.tab as string)
    : 'conceptos'

  const [
    conceptos,
    conceptosAsignables,
    configMes,
    tipos,
    becas,
    ninosCentro,
    cierre,
    acreedor,
    recibosSepa,
    remesas,
    recibosGestion,
    pivote,
  ] = await Promise.all([
    getConceptosCobro(centroId),
    getConceptosAsignables(centroId),
    getConfigMes(centroId, anio, mes),
    getTiposBeca(centroId),
    getBecas(centroId),
    getNinosPorCentro(centroId),
    getCierreMes(centroId, anio, mes),
    getDatosAcreedor(centroId),
    getRecibosSepaRemesables(centroId, anio, mes),
    getRemesasMes(centroId, anio, mes),
    getRecibosGestion(centroId, anio, mes),
    getPivotePeriodo(centroId, anio, mes),
  ])

  const ninosActivos = ninosCentro
    .filter((n) => n.estado_matricula === 'activa')
    .map((n) => ({ id: n.id, nombre: [n.nombre, n.apellidos].filter(Boolean).join(' ') }))

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-h1">{t('title')}</h1>
        <p className="text-muted-foreground text-sm">{t('subtitle')}</p>
      </header>

      <Tabs defaultValue={tab}>
        <TabsList>
          <TabsTrigger value="conceptos">{t('tab_conceptos')}</TabsTrigger>
          <TabsTrigger value="asignacion">{t('tab_asignacion')}</TabsTrigger>
          <TabsTrigger value="becas">{t('tab_becas')}</TabsTrigger>
          <TabsTrigger value="cierre">{t('tab_cierre')}</TabsTrigger>
          <TabsTrigger value="remesas">{t('tab_remesas')}</TabsTrigger>
          <TabsTrigger value="resumen">{t('tab_resumen')}</TabsTrigger>
        </TabsList>

        <TabsContent value="conceptos" className="pt-4">
          <ConceptosCatalogo centroId={centroId} conceptos={conceptos} />
        </TabsContent>

        <TabsContent value="asignacion" className="pt-4">
          <AsignacionMensualPanel
            centroId={centroId}
            anio={anio}
            mes={mes}
            conceptos={conceptosAsignables}
            config={configMes}
          />
        </TabsContent>

        <TabsContent value="becas" className="pt-4">
          <BecasPanel centroId={centroId} becas={becas} tipos={tipos} ninos={ninosActivos} />
        </TabsContent>

        <TabsContent value="cierre" className="pt-4">
          <CierrePanel
            centroId={centroId}
            anio={anio}
            mes={mes}
            resumen={cierre}
            ninos={ninosActivos}
          />
        </TabsContent>

        <TabsContent value="remesas" className="pt-4">
          <RemesasPanel
            anio={anio}
            mes={mes}
            acreedor={acreedor}
            recibos={recibosSepa}
            remesas={remesas}
            recibosGestion={recibosGestion}
          />
        </TabsContent>

        <TabsContent value="resumen" className="pt-4">
          <PivotePanel locale={locale} anio={anio} mes={mes} pivote={pivote} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// Devuelve n si es un entero válido dentro de [min,max]; null si no (→ fallback).
function clamp(n: number, min: number, max: number): number | null {
  return Number.isInteger(n) && n >= min && n <= max ? n : null
}
