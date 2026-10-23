'use client'

import { useState, useTransition } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { centimosAEuros, eurosACentimos, formatEuros } from '@/shared/lib/format-money'
import { formatPorcentaje } from '@/shared/lib/format-percent'

import { fijarImportePropio } from '../actions/fijar-importe-propio'
import { admiteImportePropio, admitePorcentajePropio } from '../lib/importe-propio'
import type {
  ConceptoCatalogo,
  ImportesPropios,
  ValorPropio,
} from '../queries/get-asignacion-permanente'

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
// Retocar la línea del recibo sigue siendo la corrección de un solo mes. PR-8: en un descuento
// con base (el descuento por hermano) se elige además el tipo: importe o porcentaje de la base.
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
            valorPropio={importes[c.id] ?? null}
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
  valorPropio,
}: {
  centroId: string
  destino: Props['destino']
  concepto: ConceptoCatalogo
  valorPropio: ValorPropio | null
}) {
  const t = useTranslations('admin.cuotas.importe_propio')
  const tErrors = useTranslations()
  const locale = useLocale()
  const [pending, startTransition] = useTransition()
  const conPorcentaje = admitePorcentajePropio(concepto)
  const [guardado, setGuardado] = useState<ValorPropio | null>(valorPropio)
  // Sin valor propio, el tipo de partida es el del concepto.
  const [tipo, setTipo] = useState<ValorPropio['tipo']>(
    valorPropio?.tipo ?? (concepto.tipo_valor === 'porcentaje' ? 'porcentaje' : 'fijo')
  )
  const [valor, setValor] = useState(textoDe(valorPropio))

  const precio = concepto.tarifa_por_anio_nacimiento
    ? t('precio_tarifa')
    : concepto.porcentaje_bp != null && concepto.concepto_base_nombre
      ? t('precio_concepto_porcentaje', {
          porcentaje: formatPorcentaje(concepto.porcentaje_bp, locale),
          base: concepto.concepto_base_nombre,
        })
      : concepto.importe_centimos == null
        ? null
        : t(concepto.tipo_concepto === 'diario' ? 'precio_concepto_dia' : 'precio_concepto', {
            precio: formatEuros(concepto.importe_centimos, locale),
          })

  function guardar(nuevo: ValorPropio | null) {
    startTransition(async () => {
      const r = await fijarImportePropio({
        centroId,
        conceptoId: concepto.id,
        ninoId: destino.ninoId,
        familiaId: destino.familiaId,
        importeEuros: nuevo?.tipo === 'fijo' ? centimosAEuros(nuevo.centimos) : null,
        porcentaje: nuevo?.tipo === 'porcentaje' ? nuevo.bp / 100 : null,
      })
      if (!r.success) {
        toast.error(tErrors(r.error))
        return
      }
      setGuardado(nuevo)
      setValor(textoDe(nuevo))
      if (nuevo) setTipo(nuevo.tipo)
      toast.success(nuevo == null ? t('quitado') : t('guardado'))
    })
  }

  const numero = valor.trim() === '' ? null : Number(valor)
  const invalido =
    numero != null &&
    (Number.isNaN(numero) || numero < 0 || (tipo === 'porcentaje' && numero > 100))
  const nuevo: ValorPropio | null =
    numero == null || invalido
      ? null
      : tipo === 'porcentaje'
        ? { tipo: 'porcentaje', bp: Math.round(numero * 100) }
        : { tipo: 'fijo', centimos: eurosACentimos(numero) }
  const sinCambios =
    (numero == null && guardado == null) ||
    (nuevo != null && guardado != null && mismoValor(nuevo, guardado))

  return (
    <li className="space-y-1">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm">{concepto.nombre}</span>
        {precio && <span className="text-muted-foreground text-xs">{precio}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {conPorcentaje && (
          <div
            role="group"
            aria-label={t('tipo_aria', { concepto: concepto.nombre })}
            className="flex"
          >
            <Button
              type="button"
              size="sm"
              variant={tipo === 'fijo' ? 'secondary' : 'ghost'}
              aria-pressed={tipo === 'fijo'}
              disabled={pending}
              onClick={() => setTipo('fijo')}
            >
              {t('tipo_fijo')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={tipo === 'porcentaje' ? 'secondary' : 'ghost'}
              aria-pressed={tipo === 'porcentaje'}
              disabled={pending}
              onClick={() => setTipo('porcentaje')}
            >
              {t('tipo_porcentaje', { base: concepto.concepto_base_nombre ?? '' })}
            </Button>
          </div>
        )}
        <Input
          type="number"
          min={0}
          max={tipo === 'porcentaje' ? 100 : undefined}
          step={0.01}
          inputMode="decimal"
          className="h-8 w-32"
          aria-label={t(tipo === 'porcentaje' ? 'aria_porcentaje' : 'aria', {
            concepto: concepto.nombre,
          })}
          placeholder={t(tipo === 'porcentaje' ? 'placeholder_porcentaje' : 'placeholder')}
          value={valor}
          onChange={(e) => setValor(e.target.value)}
        />
        <Button
          type="button"
          size="sm"
          disabled={pending || invalido || sinCambios}
          onClick={() => guardar(nuevo)}
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

/** Lo que enseña el campo para un valor guardado: euros o porcentaje, sin unidad. */
function textoDe(v: ValorPropio | null): string {
  if (!v) return ''
  return String(v.tipo === 'fijo' ? centimosAEuros(v.centimos) : v.bp / 100)
}

function mismoValor(a: ValorPropio, b: ValorPropio): boolean {
  if (a.tipo === 'fijo' && b.tipo === 'fijo') return a.centimos === b.centimos
  if (a.tipo === 'porcentaje' && b.tipo === 'porcentaje') return a.bp === b.bp
  return false
}
