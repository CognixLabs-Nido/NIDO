import { CheckCircle2Icon } from 'lucide-react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'

import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

import type { EstadoFirmaFicha } from '../lib/ficha-firmada'
import type { SalidaAlta } from '../lib/salida-alta'
import { EditarAltaFirmada, RefirmaFicha } from './AvisoFichaFirmada'

interface Props {
  ninoNombre: string
  /** Reentra al wizard para revisar/editar mientras la dirección valida (estado 'lista'). */
  editarHref: string
  /** Salida de la pantalla, según quién completó el alta (`resolverSalidaAlta`). */
  salida: SalidaAlta
  ninoId: string
  /**
   * Fase 10b-2: el estado de la firma de la ficha, o null si no se pudo leer (entonces no se ofrece
   * firmar ni se avisa: no se sabe). En el alta en papel no hay firma de la ficha hasta la 10b-3.
   */
  firma: EstadoFirmaFicha | null
  modoDireccion: boolean
  nombreUsuario: string
}

/**
 * Pantalla "completado, pendiente de validación" (P3c, DEC-A→b). Se muestra cuando la
 * matrícula está en `'lista'`: el tutor finalizó el alta y espera la activación de la
 * dirección. NO es el panel (que solo se abre al activar). Editable: el botón reentra
 * al wizard (cada paso ya persiste por su cuenta; re-finalizar es no-op).
 */
export async function AltaCompletadaScreen({
  ninoNombre,
  editarHref,
  salida,
  ninoId,
  firma,
  modoDireccion,
  nombreUsuario,
}: Props) {
  const t = await getTranslations('alta')
  return (
    <Card className="mx-auto max-w-2xl">
      <CardContent className="space-y-3 py-10 text-center">
        <CheckCircle2Icon
          className="text-success-700 mx-auto size-12"
          strokeWidth={1.75}
          aria-hidden
        />
        <h2 className="text-h3">{t('completado.titulo')}</h2>
        <p className="text-muted-foreground mx-auto max-w-md text-sm">
          {t('completado.texto', { nombre: ninoNombre })}
        </p>
        {/* La salida va PRIMERO y como acción principal: terminado el alta, lo que casi
            siempre se quiere es volver a la lista, no reentrar al wizard. "Revisar o
            editar" se queda al lado, en secundario. */}
        <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
          <Link href={salida.href} className={buttonVariants({ size: 'sm' })}>
            {t(`completado.${salida.claveEtiqueta}`)}
          </Link>
          <EditarAltaFirmada
            href={editarHref}
            firmaVigente={firma?.vigente === true}
            etiqueta={t('completado.editar')}
          />
        </div>
        {/* La firma de la ficha dejó de valer (cambió un dato firmado) o el alta se cerró sin ella:
            se vuelve a firmar aquí, sin recorrer el asistente. Solo la familia (el papel, 10b-3). */}
        {firma && !firma.vigente && !modoDireccion && firma.puedeFirmar !== 'no' && (
          <div className="mx-auto max-w-xl pt-4">
            <RefirmaFicha
              ninoId={ninoId}
              puedeLeerFichaMedica={firma.puedeFirmar !== 'sin_acceso_ficha_medica'}
              nombreInicial={nombreUsuario}
              motivo={firma.firmada ? 'invalidada' : 'sin_firma'}
            />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
