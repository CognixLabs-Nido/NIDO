'use client'

import { useMemo, useState, useTransition } from 'react'

import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

import {
  despublicarInforme,
  guardarBorradorInforme,
  publicarInforme,
} from '../actions/gestionar-informe'
import { idsDeItems, todosValorados } from '../lib/estructura'
import type { InformeEvolucionDetalle, RespuestasInforme, ValoracionItem } from '../types'

const VALORACIONES: readonly ValoracionItem[] = ['conseguido', 'en_proceso', 'no_iniciado']

/**
 * Formulario de un informe: pinta la estructura CONGELADA (áreas→ítems) con el
 * selector de la escala de 3 + comentario por ítem y observaciones generales.
 * Editable solo para redactor (coordinadora/profesora) y en estado borrador; en
 * publicado o para tecnico/apoyo se muestra en solo lectura.
 */
export function InformeEditor({ informe }: { informe: InformeEvolucionDetalle }) {
  const t = useTranslations('informes')
  const tRoot = useTranslations()
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const editable = informe.puedeRedactar && informe.estado === 'borrador'

  const [respuestas, setRespuestas] = useState<RespuestasInforme>(informe.respuestas)
  const [observaciones, setObservaciones] = useState(informe.observaciones_generales ?? '')

  const valoracionItems = useMemo(
    () => VALORACIONES.map((v) => ({ value: v, label: t(`escala.${v}`) })),
    [t]
  )

  function setValoracion(itemId: string, valoracion: ValoracionItem) {
    setRespuestas((prev) => ({
      ...prev,
      [itemId]: { ...prev[itemId], valoracion },
    }))
  }
  function setComentario(itemId: string, comentario: string) {
    setRespuestas((prev) => {
      const actual = prev[itemId]
      if (!actual) return prev // sin valoración aún: el comentario se ignora hasta valorar
      return { ...prev, [itemId]: { ...actual, comentario } }
    })
  }

  function payload() {
    return { respuestas, observaciones_generales: observaciones.trim() || null }
  }

  function onGuardar() {
    startTransition(async () => {
      const res = await guardarBorradorInforme({ informe_id: informe.id, ...payload() })
      if (!res.success) {
        toast.error(tRoot(res.error))
        return
      }
      toast.success(t('detalle.guardado_toast'))
      router.refresh()
    })
  }

  function onPublicar() {
    if (!todosValorados(informe.estructura_snapshot, respuestas)) {
      toast.error(t('detalle.faltan_valoraciones'))
      return
    }
    startTransition(async () => {
      const res = await publicarInforme({ informe_id: informe.id, ...payload() })
      if (!res.success) {
        toast.error(tRoot(res.error))
        return
      }
      toast.success(t('detalle.publicado_toast'))
      router.refresh()
    })
  }

  function onDespublicar() {
    startTransition(async () => {
      const res = await despublicarInforme({ informe_id: informe.id })
      if (!res.success) {
        toast.error(tRoot(res.error))
        return
      }
      toast.success(t('detalle.despublicado_toast'))
      router.refresh()
    })
  }

  const totalItems = idsDeItems(informe.estructura_snapshot).length
  const valorados = idsDeItems(informe.estructura_snapshot).filter(
    (id) => !!respuestas[id]?.valoracion
  ).length

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge variant={informe.estado === 'publicado' ? 'default' : 'secondary'}>
          {t(`estado.${informe.estado}`)}
        </Badge>
        {editable && (
          <span className="text-muted-foreground text-sm">
            {t('detalle.progreso', { valorados, total: totalItems })}
          </span>
        )}
        {informe.estado === 'publicado' && !informe.puedeRedactar && (
          <span className="text-muted-foreground text-sm">{t('detalle.solo_lectura')}</span>
        )}
      </div>

      <div className="space-y-6">
        {informe.estructura_snapshot.map((area, ai) => (
          <section key={ai} className="space-y-3">
            <h2 className="text-h2 text-foreground">{area.titulo}</h2>
            <ul className="space-y-4">
              {area.items.map((item) => {
                const r = respuestas[item.id]
                return (
                  <li key={item.id} className="space-y-2 rounded-lg border p-3">
                    <p className="font-medium">{item.texto}</p>
                    {editable ? (
                      <>
                        <div className="space-y-1.5">
                          <Label>{t('detalle.valoracion')}</Label>
                          <Select
                            items={valoracionItems}
                            value={r?.valoracion ?? ''}
                            onValueChange={(v) => v && setValoracion(item.id, v as ValoracionItem)}
                          >
                            <SelectTrigger className="w-full sm:w-72">
                              <SelectValue placeholder={t('detalle.valoracion_placeholder')} />
                            </SelectTrigger>
                            <SelectContent>
                              {valoracionItems.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value}>
                                  {opt.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor={`com-${item.id}`}>{t('detalle.comentario')}</Label>
                          <Textarea
                            id={`com-${item.id}`}
                            value={r?.comentario ?? ''}
                            onChange={(e) => setComentario(item.id, e.target.value)}
                            rows={2}
                            maxLength={1000}
                            disabled={!r?.valoracion}
                            placeholder={t('detalle.comentario_placeholder')}
                          />
                        </div>
                      </>
                    ) : (
                      <div className="space-y-1 text-sm">
                        <p>
                          <span className="text-muted-foreground">{t('detalle.valoracion')}: </span>
                          {r?.valoracion ? t(`escala.${r.valoracion}`) : '—'}
                        </p>
                        {r?.comentario && (
                          <p className="text-muted-foreground whitespace-pre-wrap">
                            {r.comentario}
                          </p>
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>

      <div className="space-y-2">
        <Label htmlFor="observaciones">{t('detalle.observaciones')}</Label>
        {editable ? (
          <Textarea
            id="observaciones"
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            rows={4}
            maxLength={4000}
            placeholder={t('detalle.observaciones_placeholder')}
          />
        ) : (
          <p className="text-muted-foreground text-sm whitespace-pre-wrap">
            {informe.observaciones_generales || '—'}
          </p>
        )}
      </div>

      {informe.puedeRedactar && (
        <div className="flex flex-wrap gap-2">
          {editable ? (
            <>
              <Button variant="outline" onClick={onGuardar} disabled={pending}>
                {pending ? t('detalle.guardando') : t('detalle.guardar_borrador')}
              </Button>
              <Button onClick={onPublicar} disabled={pending}>
                {pending ? t('detalle.publicando') : t('detalle.publicar')}
              </Button>
            </>
          ) : (
            <div className="space-y-2">
              <Button variant="outline" onClick={onDespublicar} disabled={pending}>
                {pending ? t('detalle.despublicando') : t('detalle.despublicar')}
              </Button>
              <p className="text-muted-foreground text-xs">{t('detalle.despublicar_nota')}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
