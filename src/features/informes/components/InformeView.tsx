import { getTranslations } from 'next-intl/server'

import { Badge } from '@/components/ui/badge'

import type { InformeEvolucionDetalle } from '../types'

/**
 * Vista de lectura del informe para la familia (F9-3): pinta la estructura
 * CONGELADA (áreas → ítems) con la valoración de cada ítem (escala de 3) + sus
 * comentarios + las observaciones generales. SOLO LECTURA: sin ningún control de
 * edición ni botones. Los textos del informe van en castellano (como se guardaron);
 * la interfaz (etiquetas) en el idioma del usuario. Server component.
 */
export async function InformeView({ informe }: { informe: InformeEvolucionDetalle }) {
  const t = await getTranslations('informes')

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Badge className="border-success-200 bg-success-50 text-success-800">
          {t(`estado.${informe.estado}`)}
        </Badge>
        <span className="text-muted-foreground text-sm">{t(`periodos.${informe.periodo}`)}</span>
      </div>

      <div className="space-y-6">
        {informe.estructura_snapshot.map((area, ai) => (
          <section key={ai} className="space-y-3">
            <h2 className="text-h2 text-foreground">{area.titulo}</h2>
            <ul className="space-y-3">
              {area.items.map((item) => {
                const r = informe.respuestas[item.id]
                return (
                  <li key={item.id} className="space-y-1 rounded-lg border p-3">
                    <p className="font-medium">{item.texto}</p>
                    <p className="text-sm">
                      <span className="text-muted-foreground">{t('detalle.valoracion')}: </span>
                      {r?.valoracion ? t(`escala.${r.valoracion}`) : '—'}
                    </p>
                    {r?.comentario && (
                      <p className="text-muted-foreground text-sm whitespace-pre-wrap">
                        {r.comentario}
                      </p>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        ))}
      </div>

      <div className="space-y-2">
        <h2 className="text-h3 text-foreground">{t('detalle.observaciones')}</h2>
        <p className="text-muted-foreground text-sm whitespace-pre-wrap">
          {informe.observaciones_generales || '—'}
        </p>
      </div>
    </div>
  )
}
