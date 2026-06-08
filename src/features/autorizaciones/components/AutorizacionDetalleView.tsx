import { ArrowLeftIcon } from 'lucide-react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

import { hoyMadridYmd } from '@/features/autorizaciones/lib/server-helpers'
import { getAdministracionesPorAutorizacion } from '@/features/autorizaciones/queries/get-administraciones'
import { getAutorizacionDetalle } from '@/features/autorizaciones/queries/get-autorizacion-detalle'
import { createClient } from '@/lib/supabase/server'

import { AccesoDenegado } from './AccesoDenegado'
import { AccionesAdmin } from './AccionesAdmin'
import { EditarTextoDialog } from './EditarTextoDialog'
import { EstadoDocBadge } from './EstadoFirmaBadge'
import { MedicacionFicha } from './MedicacionFicha'
import { RecogidaLista } from './RecogidaLista'
import { RegistrarAdministracionDialog } from './RegistrarAdministracionDialog'
import { RegistroAdministracionLista } from './RegistroAdministracionLista'
import { RosterFirmas } from './RosterFirmas'

/**
 * Detalle de una instancia/plantilla de autorización, compartido por la ruta
 * admin (`/admin/autorizaciones/[id]`) y la de profe (`/teacher/autorizaciones/[id]`).
 * La lógica es idéntica para ambos roles (la RLS y los guards de cada page acotan
 * el acceso); lo único que cambia es `volverHref` (a dónde vuelve el enlace de
 * retorno y el mensaje "sin acceso"). Mantiene la doble confirmación de medicación
 * (F8-3b) y el roster de firmas.
 */
export async function AutorizacionDetalleView({
  id,
  volverHref,
}: {
  id: string
  volverHref: string
}) {
  const t = await getTranslations('autorizaciones')

  // Sin acceso (instancia fuera de su ámbito, p. ej. profe abriendo algo de otra
  // aula): mensaje en la misma página, nunca cerrar sesión ni página aparte.
  const aut = await getAutorizacionDetalle(id)
  if (!aut) return <AccesoDenegado volverHref={volverHref} />

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
          href={volverHref}
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
