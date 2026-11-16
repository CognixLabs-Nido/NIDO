'use client'

import { useState, useTransition } from 'react'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { eurosACentimos, formatEuros } from '@/shared/lib/format-money'

import { fijarImporteCursoGastos, marcarCobroGastos } from '../actions/direccion-gastos'
import type { GastosCentro } from '../queries/get-gastos-centro'

interface Props {
  locale: string
  /** `null` si no se pudo leer: se dice, no se pinta como «no falta nadie». */
  datos: GastosCentro | null
}

/**
 * Fase 9 — Cuotas → Gastos de gestión: el importe que fija el centro para cada curso (una
 * propuesta; sin importe, el centro no los pide en el alta) y la lista de los que faltan por
 * cobrar, con la marca de cobro. Ningún recibo (D6).
 */
export function GastosGestionCentro({ locale, datos }: Props) {
  const t = useTranslations('gastos_gestion')
  const tErrors = useTranslations()
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [importes, setImportes] = useState<Record<string, string>>({})

  function correr(f: () => Promise<{ success: boolean; error?: string }>, okMsg: string) {
    startTransition(async () => {
      const r = await f()
      if (!r.success) toast.error(tErrors(r.error ?? 'gastos_gestion.errors.guardar'))
      else {
        toast.success(t(okMsg))
        router.refresh()
      }
    })
  }

  if (datos === null)
    return (
      <p role="alert" className="text-accent-warm-800 text-sm">
        {t('no_leidos')}
      </p>
    )

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-h3">{t('cursos_titulo')}</h2>
        <p className="text-muted-foreground text-sm">{t('cursos_ayuda')}</p>
        {datos.cursos.length === 0 && (
          <p className="text-muted-foreground text-sm">{t('sin_cursos')}</p>
        )}
        {datos.cursos.map((k) => (
          <div key={k.id} className="flex flex-wrap items-end gap-2 rounded-lg border p-3">
            <div className="min-w-40 text-sm">
              <p className="font-medium">{k.nombre}</p>
              <p className="text-muted-foreground">
                {k.importeCentimos === null
                  ? t('curso_sin_importe')
                  : t('importe', { importe: formatEuros(k.importeCentimos, locale) })}
              </p>
            </div>
            <label className="text-sm">
              <span className="text-muted-foreground block text-xs">{t('importe_curso')}</span>
              <Input
                inputMode="decimal"
                className="w-32"
                value={importes[k.id] ?? ''}
                onChange={(e) => setImportes((p) => ({ ...p, [k.id]: e.target.value }))}
                disabled={pending}
              />
            </label>
            <Button
              type="button"
              size="sm"
              disabled={pending || !(importes[k.id] ?? '').trim()}
              onClick={() => {
                const c = eurosACentimos(Number((importes[k.id] ?? '').replace(',', '.')))
                if (!Number.isFinite(c) || c <= 0) {
                  toast.error(tErrors('gastos_gestion.errors.importe'))
                  return
                }
                correr(
                  () => fijarImporteCursoGastos({ curso_academico_id: k.id, importe_centimos: c }),
                  'importe_guardado'
                )
              }}
            >
              {t('guardar_importe')}
            </Button>
            {k.importeCentimos !== null && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  correr(
                    () =>
                      fijarImporteCursoGastos({ curso_academico_id: k.id, importe_centimos: null }),
                    'importe_quitado'
                  )
                }
              >
                {t('quitar_importe')}
              </Button>
            )}
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="text-h3">{t('pendientes_titulo')}</h2>
        {datos.pendientes.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('pendientes_ninguno')}</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {datos.pendientes.map((p) => (
              <li
                key={`${p.ninoId}:${p.cursoId}`}
                className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
              >
                <div>
                  <Link
                    href={`/${locale}/admin/ninos/${p.ninoId}`}
                    className="font-medium underline"
                  >
                    {p.nombre}
                  </Link>
                  <span className="text-muted-foreground">
                    {' · '}
                    {p.cursoNombre} · {formatEuros(p.importe, locale)} ·{' '}
                    {p.forma ? t(`forma.${p.forma}`) : t('sin_contestar_aun')}
                    {p.conJustificante && ` · ${t('con_justificante')}`}
                    {p.enAlta && ` · ${t('alta_en_curso')}`}
                  </span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    correr(
                      () =>
                        marcarCobroGastos({
                          nino_id: p.ninoId,
                          curso_academico_id: p.cursoId,
                          cobrado: true,
                        }),
                      'marcado'
                    )
                  }
                >
                  {t('marcar_cobro')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
