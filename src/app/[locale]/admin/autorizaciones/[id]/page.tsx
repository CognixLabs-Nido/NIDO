import { ArrowLeftIcon } from 'lucide-react'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { AccionesAdmin } from '@/features/autorizaciones/components/AccionesAdmin'
import { EditarTextoDialog } from '@/features/autorizaciones/components/EditarTextoDialog'
import { EstadoDocBadge } from '@/features/autorizaciones/components/EstadoFirmaBadge'
import { MedicacionFicha } from '@/features/autorizaciones/components/MedicacionFicha'
import { RecogidaLista } from '@/features/autorizaciones/components/RecogidaLista'
import { RegistrarAdministracionDialog } from '@/features/autorizaciones/components/RegistrarAdministracionDialog'
import { RegistroAdministracionLista } from '@/features/autorizaciones/components/RegistroAdministracionLista'
import { RosterFirmas } from '@/features/autorizaciones/components/RosterFirmas'
import { hoyMadridYmd } from '@/features/autorizaciones/lib/server-helpers'
import { getAdministracionesPorAutorizacion } from '@/features/autorizaciones/queries/get-administraciones'
import { getAutorizacionDetalle } from '@/features/autorizaciones/queries/get-autorizacion-detalle'
import { getCentroActualId, getRolEnCentro } from '@/features/centros/queries/get-centro-actual'
import { createClient } from '@/lib/supabase/server'

interface PageProps {
  params: Promise<{ locale: string; id: string }>
}

export default async function AdminAutorizacionDetallePage({ params }: PageProps) {
  const { locale, id } = await params
  const t = await getTranslations('autorizaciones')

  const centroId = await getCentroActualId()
  if (!centroId) redirect(`/${locale}/login`)
  const rol = await getRolEnCentro(centroId)
  if (rol !== 'admin' && rol !== 'profe') redirect(`/${locale}/forbidden`)

  const aut = await getAutorizacionDetalle(id)
  if (!aut) notFound()

  const editable = aut.estado === 'borrador'

  // Medicación (instancia): registro de administraciones (F8-3b). El staff registra
  // sobre una medicación firmada + VIGENTE hoy y un 2.º staff distinto confirma.
  const esMedicacionInstancia = !aut.es_plantilla && aut.tipo === 'medicacion'
  const med = aut.medicacion_vigente ?? null
  const hoy = hoyMadridYmd()
  const medVigenteHoy = !!med && hoy >= med.fecha_inicio && hoy <= med.fecha_fin
  const administraciones = esMedicacionInstancia
    ? await getAdministracionesPorAutorizacion(aut.id)
    : []
  let currentUserId: string | null = null
  if (esMedicacionInstancia) {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    currentUserId = user?.id ?? null
  }

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/${locale}/admin/autorizaciones`}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeftIcon className="size-4" />
          {t('volver')}
        </Link>
      </div>

      <header className="space-y-2">
        <div className="flex items-center gap-3">
          <h1 className="text-h1 text-foreground">{aut.titulo}</h1>
          <EstadoDocBadge estado={aut.estado} />
        </div>
        <p className="text-muted-foreground text-xs">
          {t('detalle.version', { v: aut.texto_version })}
        </p>
        {aut.es_plantilla && (
          <p className="text-muted-foreground text-sm">{t('detalle.es_plantilla')}</p>
        )}
        {!aut.es_plantilla && aut.ambito && (
          <p className="text-muted-foreground text-xs">
            {t('detalle.ambito_label', { ambito: t(`ambito.${aut.ambito}`) })}
          </p>
        )}
      </header>

      <section className="space-y-2">
        <h2 className="text-h3">{t('detalle.texto')}</h2>
        <div className="bg-muted/40 rounded-lg border p-4 text-sm whitespace-pre-wrap">
          {aut.texto === 'PENDIENTE' ? (
            <span className="text-muted-foreground">{t('detalle.texto_pendiente')}</span>
          ) : (
            aut.texto
          )}
        </div>
        {!aut.texto_definitivo && (
          <p className="text-accent-yellow-700 text-xs">{t('detalle.texto_no_definitivo')}</p>
        )}
      </section>

      <div className="flex flex-wrap gap-2">
        {editable && (
          <EditarTextoDialog
            autorizacionId={aut.id}
            titulo={aut.titulo}
            texto={aut.texto}
            textoDefinitivo={aut.texto_definitivo}
            vigenciaHasta={aut.vigencia_hasta}
          />
        )}
        <AccionesAdmin
          autorizacionId={aut.id}
          estado={aut.estado}
          textoDefinitivo={aut.texto_definitivo}
        />
      </div>

      {/* Recogida: lista de personas autorizadas vigente (lectura para profes del
          aula + dirección) + flag de integridad del hash. */}
      {!aut.es_plantilla && aut.tipo === 'recogida' && (
        <section>
          <RecogidaLista personas={aut.personas_vigentes ?? []} integridadOk={aut.integridad_ok} />
        </section>
      )}

      {/* Medicación: ficha vigente + registro de administración (doble confirmación). */}
      {esMedicacionInstancia && (
        <section className="space-y-4">
          <MedicacionFicha medicacion={med} integridadOk={aut.integridad_ok} />
          {medVigenteHoy && (
            <RegistrarAdministracionDialog
              autorizacionId={aut.id}
              medicamento={med!.medicamento}
              dosis={med!.dosis}
            />
          )}
          <RegistroAdministracionLista
            administraciones={administraciones}
            currentUserId={currentUserId}
            canConfirm
          />
        </section>
      )}

      {/* El roster solo aplica a instancias firmables; una plantilla del catálogo
          no se firma (se envía a una audiencia o la inicia la familia). */}
      {!aut.es_plantilla && (
        <section className="space-y-3">
          <h2 className="text-h3">{t('detalle.roster')}</h2>
          <RosterFirmas roster={aut.roster} />
        </section>
      )}
    </div>
  )
}
