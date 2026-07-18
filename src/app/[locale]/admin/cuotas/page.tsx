import { getTranslations } from 'next-intl/server'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { BecaComedorMesPanel } from '@/features/beca-comedor-mes/components/BecaComedorMesPanel'
import { getBecasComedorMes } from '@/features/beca-comedor-mes/queries/get-becas-comedor-mes'
import { BecasPanel } from '@/features/becas/components/BecasPanel'
import { getBecas } from '@/features/becas/queries/get-becas'
import { getTiposBeca } from '@/features/becas/queries/get-tipos-beca'
import { getCentroActualId } from '@/features/centros/queries/get-centro-actual'
import { ConceptosCatalogo } from '@/features/conceptos-cobro/components/ConceptosCatalogo'
import { getConceptosCobro } from '@/features/conceptos-cobro/queries/get-conceptos-cobro'
import { AsignacionPermanentePanel } from '@/features/cuotas-config/components/AsignacionPermanentePanel'
import { getAsignacionPermanente } from '@/features/cuotas-config/queries/get-asignacion-permanente'
import { getNinosPorCentro } from '@/features/ninos/queries/get-ninos'
import { PanelMesRecibos } from '@/features/recibos/components/PanelMesRecibos'
import { PivotePanel } from '@/features/recibos/components/PivotePanel'
import { getPivotePeriodo } from '@/features/recibos/queries/get-pivote-periodo'
import { getRecibosMesPanel } from '@/features/recibos/queries/get-recibos-mes-panel'
import { RemesasPanel } from '@/features/remesas/components/RemesasPanel'
import { getDatosAcreedor } from '@/features/remesas/queries/get-datos-acreedor'
import { getRecibosGestion } from '@/features/remesas/queries/get-recibos-gestion'
import { getRecibosSepaRemesables } from '@/features/remesas/queries/get-recibos-sepa-remesables'
import { getRemesasMes } from '@/features/remesas/queries/get-remesas-mes'

interface PageProps {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ tab?: string; anio?: string; mes?: string }>
}

const TABS = ['mes', 'conceptos', 'asignacion', 'becas', 'remesas', 'resumen'] as const

// F-4-4: hub de cuotas. Tab por defecto = Panel del mes (revisión + confirmación de
// recibos a grano familia). Otros tabs: catálogo de conceptos, asignación permanente
// (alumno + familia), becas, remesas y resumen (pivote a grano familia + CSV). El layout
// admin valida rol + centro.
export default async function AdminCuotasPage({ params, searchParams }: PageProps) {
  const t = await getTranslations('admin.cuotas')
  const { locale } = await params
  const sp = await searchParams
  const centroId = (await getCentroActualId())!

  const ahora = new Date()
  const anio = clamp(Number(sp.anio), 2024, 2100) ?? ahora.getFullYear()
  const mes = clamp(Number(sp.mes), 1, 12) ?? ahora.getMonth() + 1
  const tab = (TABS as readonly string[]).includes(sp.tab ?? '') ? (sp.tab as string) : 'mes'

  const [
    conceptos,
    asignacion,
    tipos,
    becas,
    ninosCentro,
    panelMes,
    acreedor,
    recibosSepa,
    remesas,
    recibosGestion,
    pivote,
    becasComedor,
  ] = await Promise.all([
    getConceptosCobro(centroId),
    getAsignacionPermanente(centroId),
    getTiposBeca(centroId),
    getBecas(centroId),
    getNinosPorCentro(centroId),
    getRecibosMesPanel(centroId, anio, mes),
    getDatosAcreedor(centroId),
    getRecibosSepaRemesables(centroId, anio, mes),
    getRemesasMes(centroId, anio, mes),
    getRecibosGestion(centroId, anio, mes),
    getPivotePeriodo(centroId, anio, mes),
    getBecasComedorMes(centroId, anio, mes),
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
          <TabsTrigger value="mes">{t('tab_mes')}</TabsTrigger>
          <TabsTrigger value="conceptos">{t('tab_conceptos')}</TabsTrigger>
          <TabsTrigger value="asignacion">{t('tab_asignacion')}</TabsTrigger>
          <TabsTrigger value="becas">{t('tab_becas')}</TabsTrigger>
          <TabsTrigger value="remesas">{t('tab_remesas')}</TabsTrigger>
          <TabsTrigger value="resumen">{t('tab_resumen')}</TabsTrigger>
        </TabsList>

        <TabsContent value="mes" className="pt-4">
          <PanelMesRecibos
            centroId={centroId}
            anio={anio}
            mes={mes}
            data={panelMes}
            ninos={ninosActivos}
          />
          <BecaComedorMesPanel
            anio={anio}
            mes={mes}
            ninos={ninosActivos}
            becas={becasComedor}
            cerrado={panelMes.cerrado}
          />
        </TabsContent>

        <TabsContent value="conceptos" className="pt-4">
          <ConceptosCatalogo centroId={centroId} conceptos={conceptos} />
        </TabsContent>

        <TabsContent value="asignacion" className="pt-4">
          <AsignacionPermanentePanel centroId={centroId} data={asignacion} />
        </TabsContent>

        <TabsContent value="becas" className="pt-4">
          <BecasPanel centroId={centroId} becas={becas} tipos={tipos} ninos={ninosActivos} />
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
