'use client'

import { useState, useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { centimosAEuros, eurosACentimos, formatEuros } from '@/shared/lib/format-money'

import { fijarImportePropio } from '../actions/fijar-importe-propio'
import { admiteImportePropio } from '../lib/importe-propio'
import type { ConceptoCatalogo, ImportesPropios } from '../queries/get-asignacion-permanente'

interface Props {
  centroId: string
  /** Exactamente uno: la asignación es de un niño o de una familia. */
  destino: { ninoId: string; familiaId: null } | { ninoId: null; familiaId: string }
  /** Conceptos asignados AHORA (también los automáticos). */
  asignados: string[]
  catalogo: ConceptoCatalogo[]
  importes: ImportesPropios
}

// PR-6: el importe propio se fija en la ASIGNACIÓN y se arrastra cada mes hasta que se cambie.
// Retocar la línea del recibo sigue siendo la corrección de un solo mes.
export function ImportesPropios({ centroId, destino, asignados, catalogo, importes }: Props) {
  const t = useTranslations('admin.cuotas.importe_propio')
  const conceptos = catalogo.filter((c) => asignados.includes(c.id) && admiteImportePropio(c))
  if (conceptos.length === 0) return null

  return (
    <section className="space-y-2 border-t pt-3">
      <h3 className="text-sm font-semibold">{t('titulo')}</h3>
      <p className="text-muted-foreground text-xs">{t('hint')}</p>
      <ul className="space-y-3">
        {conceptos.map((c) => (
          <ImportePropioFila
            key={c.id}
            centroId={centroId}
            destino={destino}
            concepto={c}
            importeCentimos={importes[c.id] ?? null}
          />
        ))}
      </ul>
    </section>
  )
}

function ImportePropioFila({
  centroId,
  destino,
  concepto,
  importeCentimos,
}: {
  centroId: string
  destino: Props['destino']
  concepto: ConceptoCatalogo
  importeCentimos: number | null
}) {
  const t = useTranslations('admin.cuotas.importe_propio')
  const tErrors = useTranslations()
  const locale = useLocale()
  const [pending, startTransition] = useTransition()
  const [guardado, setGuardado] = useState<number | null>(importeCentimos)
  const [valor, setValor] = useState(
    importeCentimos == null ? '' : String(centimosAEuros(importeCentimos))
  )

  const precio = concepto.tarifa_por_anio_nacimiento
    ? t('precio_tarifa')
    : concepto.importe_centimos == null
      ? null
      : t(concepto.tipo_concepto === 'diario' ? 'precio_concepto_dia' : 'precio_concepto', {
          precio: formatEuros(concepto.importe_centimos, locale),
        })

  function guardar(euros: number | null) {
    startTransition(async () => {
      const r = await fijarImportePropio({
        centroId,
        conceptoId: concepto.id,
        ninoId: destino.ninoId,
        familiaId: destino.familiaId,
        importeEuros: euros,
      })
      if (!r.success) {
        toast.error(tErrors(r.error))
        return
      }
      const centimos = euros == null ? null : eurosACentimos(euros)
      setGuardado(centimos)
      setValor(centimos == null ? '' : String(centimosAEuros(centimos)))
      toast.success(euros == null ? t('quitado') : t('guardado'))
    })
  }

  const numero = valor.trim() === '' ? null : Number(valor)
  const invalido = numero != null && (Number.isNaN(numero) || numero < 0)
  const sinCambios =
    (numero == null && guardado == null) ||
    (numero != null && guardado != null && eurosACentimos(numero) === guardado)

  return (
    <li className="space-y-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm">{concepto.nombre}</span>
        {precio && <span className="text-muted-foreground text-xs">{precio}</span>}
      </div>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={0}
          step={0.01}
          inputMode="decimal"
          className="h-8 w-32"
          aria-label={t('aria', { concepto: concepto.nombre })}
          placeholder={t('placeholder')}
          value={valor}
          onChange={(e) => setValor(e.target.value)}
        />
        <Button
          type="button"
          size="sm"
          disabled={pending || invalido || sinCambios}
          onClick={() => guardar(numero)}
        >
          {t('guardar')}
        </Button>
        {guardado != null && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => guardar(null)}
          >
            {t('quitar')}
          </Button>
        )}
      </div>
    </li>
  )
}
