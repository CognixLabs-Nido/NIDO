import { getTranslations } from 'next-intl/server'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { BecaComedorPanel } from '@/features/beca-comedor/components/BecaComedorPanel'
import { getCargasBeca } from '@/features/beca-comedor/queries/get-cargas-beca'
import { getElegibilidadBecados } from '@/features/beca-comedor/queries/get-elegibilidad-becados'
import { getPanelBecas } from '@/features/beca-comedor/queries/get-panel-becas'
import { getTransferenciasBeca } from '@/features/beca-comedor/queries/get-transferencias-beca'
import { requireContextoCentro } from '@/features/centros/contexto/get-contexto-centro'
import { getCentroLogo } from '@/features/centros/queries/get-centro-logo'
import { ConceptosCatalogo } from '@/features/conceptos-cobro/components/ConceptosCatalogo'
import { getConceptosCobro } from '@/features/conceptos-cobro/queries/get-conceptos-cobro'
import { getTarifasConceptoAnioDeCentro } from '@/features/conceptos-cobro/queries/get-tarifas-concepto-anio'
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

const TABS = ['mes', 'conceptos', 'beca-comedor', 'asignacion', 'remesas', 'resumen'] as const

// F-4-4: hub de cuotas. Tab por defecto = Panel del mes (revisión + confirmación de
// recibos a grano familia). Otros tabs: catálogo de conceptos, asignación permanente
// (alumno + familia), remesas y resumen (pivote a grano familia + CSV). El layout
// admin valida rol + centro.
export default async function AdminCuotasPage({ params, searchParams }: PageProps) {
  const t = await getTranslations('admin.cuotas')
  const { locale } = await params
  const sp = await searchParams
  const { centroId, esResponsable } = await requireContextoCentro(locale)

  const ahora = new Date()
  const anio = clamp(Number(sp.anio), 2024, 2100) ?? ahora.getFullYear()
  const mes = clamp(Number(sp.mes), 1, 12) ?? ahora.getMonth() + 1
  const tab = (TABS as readonly string[]).includes(sp.tab ?? '') ? (sp.tab as string) : 'mes'

  const [
    conceptos,
    asignacion,
    ninosCentro,
    panelMes,
    acreedor,
    recibosSepa,
    remesas,
    recibosGestion,
    pivote,
    tarifasPorConcepto,
    elegibilidad,
    cargasBeca,
    transferenciasBeca,
    panelBecas,
  ] = await Promise.all([
    getConceptosCobro(centroId),
    getAsignacionPermanente(centroId),
    getNinosPorCentro(centroId),
    getRecibosMesPanel(centroId, anio, mes),
    getDatosAcreedor(centroId),
    getRecibosSepaRemesables(centroId, anio, mes),
    getRemesasMes(centroId, anio, mes),
    getRecibosGestion(centroId, anio, mes),
    getPivotePeriodo(centroId, anio, mes),
    getTarifasConceptoAnioDeCentro(centroId),
    getElegibilidadBecados(centroId),
    getCargasBeca(centroId),
    getTransferenciasBeca(centroId),
    getPanelBecas(centroId),
  ])

  const centroLogoInfo = await getCentroLogo(centroId)
  const centroLogo = centroLogoInfo
    ? { url: centroLogoInfo.logoUrl, name: centroLogoInfo.nombre }
    : null

  const ninosActivos = ninosCentro
    .filter((n) => n.estado_matricula === 'activa')
    .map((n) => ({
      id: n.id,
      nombre: [n.nombre, n.apellidos].filter(Boolean).join(' '),
      aula: n.aula_actual,
    }))

  // Cada concepto se gestiona desde el concepto: los mismos niños y familias que la pestaña
  // Asignación permanente (matrícula activa), con la clase del niño, y quién tiene cada concepto.
  const aulaPorNino = new Map(ninosCentro.map((n) => [n.id, n.aula_actual]))
  const destinatarios = {
    ninos: asignacion.alumnos.map((a) => ({
      id: a.ninoId,
      nombre: a.nombre,
      aula: aulaPorNino.get(a.ninoId) ?? null,
    })),
    familias: asignacion.familias.map((f) => ({ id: f.familiaId, nombre: f.etiqueta, aula: null })),
  }
  const asignadosPorConcepto: Record<string, string[]> = {}
  for (const d of [
    ...asignacion.alumnos.map((a) => ({ id: a.ninoId, conceptos: a.conceptosAsignados })),
    ...asignacion.familias.map((f) => ({ id: f.familiaId, conceptos: f.conceptosAsignados })),
  ]) {
    for (const c of d.conceptos) (asignadosPorConcepto[c] ??= []).push(d.id)
  }

  // PR-13: lo puntual del catálogo (excursiones y similares), para el cargo a varios niños.
  const conceptosPuntuales = conceptos
    .filter((c) => c.activo && c.tipo_concepto === 'esporadico' && c.signo === 1)
    .map((c) => ({ id: c.id, nombre: c.nombre, importeCentimos: c.importe_centimos }))

  // B1-2: años de nacimiento distintos presentes en el centro (para el editor de tarifas por
  // año). Se lee el año del string 'YYYY-MM-DD' directamente (sin Date, para no depender del
  // huso). Descendente: el más nuevo arriba.
  const aniosNacimientoCentro = [
    ...new Set(
      ninosCentro
        .map((n) => n.fecha_nacimiento)
        .filter((f): f is string => f != null)
        .map((f) => Number(f.slice(0, 4)))
        .filter((y) => Number.isInteger(y) && y >= 2000 && y <= 2100)
    ),
  ].sort((a, b) => b - a)

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
          <TabsTrigger value="beca-comedor">{t('tab_beca_comedor')}</TabsTrigger>
          <TabsTrigger value="asignacion">{t('tab_asignacion')}</TabsTrigger>
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
            conceptosPuntuales={conceptosPuntuales}
            centroLogo={centroLogo}
          />
        </TabsContent>

        <TabsContent value="conceptos" className="pt-4">
          <ConceptosCatalogo
            centroId={centroId}
            conceptos={conceptos}
            aniosNacimientoCentro={aniosNacimientoCentro}
            tarifasPorConcepto={tarifasPorConcepto}
            editable={esResponsable}
            destinatarios={destinatarios}
            asignadosPorConcepto={asignadosPorConcepto}
          />
        </TabsContent>

        <TabsContent value="beca-comedor" className="pt-4">
          <BecaComedorPanel
            centroId={centroId}
            hayCurso={cargasBeca.curso != null}
            alumnos={elegibilidad.alumnos}
            cargas={cargasBeca.cargas}
            meses={cargasBeca.meses}
            mesesCerrados={cargasBeca.mesesCerrados}
            nombres={cargasBeca.nombres}
            recibosValidados={cargasBeca.recibosValidados}
            panel={panelBecas}
          />
        </TabsContent>

        <TabsContent value="asignacion" className="pt-4">
          <AsignacionPermanentePanel centroId={centroId} data={asignacion} />
        </TabsContent>

        <TabsContent value="remesas" className="pt-4">
          <RemesasPanel
            centroId={centroId}
            anio={anio}
            mes={mes}
            acreedor={acreedor}
            editarAcreedor={esResponsable}
            recibos={recibosSepa}
            remesas={remesas}
            recibosGestion={recibosGestion}
            transferenciasBeca={transferenciasBeca}
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
