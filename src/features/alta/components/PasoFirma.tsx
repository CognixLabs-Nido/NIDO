'use client'

import { useState, useTransition } from 'react'

import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FirmaPad } from '@/features/autorizaciones/components/FirmaPad'

import { abrirFichaParaFirmar, firmarFicha } from '../actions/firmar-ficha'
import type { BloqueAlta } from '../lib/gate-alta'
import type { SeccionLegible } from '../lib/ficha-legible'

interface Props {
  ninoId: string
  /**
   * `alta`: el último paso del alta, firmar es finalizar. `refirma`: volver a firmar una ficha cuya
   * firma dejó de valer o que Dirección pidió volver a firmar.
   */
  contexto: 'alta' | 'refirma'
  /**
   * `false`: el tutor legal no puede leer la ficha médica. No se lee nada y se dice en claro, con lo
   * que tiene que hacer («Nadie firma lo que no puede leer», 2026-11-18).
   */
  puedeLeerFichaMedica: boolean
  nombreInicial: string
  /** Lo que falta para cerrar el alta, si la base o el gate lo dicen. */
  onFaltan?: (faltan: BloqueAlta[]) => void
  onFirmado: () => void
  onBack?: () => void
}

/**
 * Firmar la ficha (fase 10b-2). Se abre con un botón (la base deja la lectura en el registro de la
 * ficha médica), se lee entera, lo médico incluido, y se firma con el nombre y el trazo. Lo que se
 * firma es el sello de lo que se vio: si algo cambió entre medias, la base lo dice
 * (`ficha_cambiada`) y hay que volver a abrirla.
 */
export function PasoFirma({
  ninoId,
  contexto,
  puedeLeerFichaMedica,
  nombreInicial,
  onFaltan,
  onFirmado,
  onBack,
}: Props) {
  const t = useTranslations('alta.firma')
  const tRoot = useTranslations()
  const [pending, start] = useTransition()
  const [ficha, setFicha] = useState<{ hash: string; secciones: SeccionLegible[] } | null>(null)
  const [nombre, setNombre] = useState(nombreInicial)
  const [firma, setFirma] = useState<string | null>(null)

  if (!puedeLeerFichaMedica) {
    return (
      <div className="space-y-4" data-testid="firma-sin-acceso">
        <p
          role="note"
          className="border-accent-warm-300 bg-accent-warm-50 text-accent-warm-800 rounded-lg border p-3 text-sm"
        >
          {t('sin_acceso')}
        </p>
        {onBack && (
          <Button type="button" variant="outline" onClick={onBack}>
            {tRoot('alta.wizard.atras')}
          </Button>
        )}
      </div>
    )
  }

  const abrir = () =>
    start(async () => {
      const r = await abrirFichaParaFirmar(ninoId)
      if (r.success) setFicha(r.data)
      else toast.error(tRoot(r.error))
    })

  const firmar = () => {
    if (!ficha || !firma) return
    start(async () => {
      const r = await firmarFicha({
        ninoId,
        hashVisto: ficha.hash,
        nombreTecleado: nombre,
        firmaImagen: firma,
      })
      if (r.success) {
        toast.success(t(contexto === 'alta' ? 'firmado_alta' : 'firmado'))
        onFirmado()
        return
      }
      if (r.faltan && r.faltan.length > 0) {
        onFaltan?.(r.faltan)
        toast.error(tRoot('alta.finalizar.incompleto_titulo'))
        return
      }
      // Ya firmada y sigue valiendo (revisó sin cambiar nada, o firmó el otro tutor): no hay nada que
      // firmar, y se sigue como si acabara de firmar.
      if (r.error === 'alta.firma.errors.ya_firmada') {
        toast.info(tRoot(r.error))
        onFirmado()
        return
      }
      // Algo cambió entre leerla y firmarla: se vuelve a abrir, para firmar lo que hay.
      if (r.error === 'alta.firma.errors.ficha_cambiada') setFicha(null)
      toast.error(tRoot(r.error))
    })
  }

  return (
    <div className="space-y-4" data-testid="paso-firma">
      <p className="text-sm">{t(contexto === 'alta' ? 'intro_alta' : 'intro_refirma')}</p>
      {!ficha ? (
        <div className="flex flex-wrap justify-between gap-2">
          {onBack ? (
            <Button type="button" variant="outline" onClick={onBack} disabled={pending}>
              {tRoot('alta.wizard.atras')}
            </Button>
          ) : (
            <span />
          )}
          <Button type="button" onClick={abrir} disabled={pending} data-testid="abrir-ficha">
            {t('abrir')}
          </Button>
        </div>
      ) : (
        <>
          <div className="space-y-4 rounded-lg border p-3" data-testid="ficha-para-firmar">
            {ficha.secciones.map((s, i) => (
              <section key={`${s.seccion}-${i}`} className="space-y-1">
                <h3 className="text-sm font-semibold">{t(`secciones.${s.seccion}`)}</h3>
                <dl className="grid grid-cols-1 gap-x-4 gap-y-0.5 text-sm sm:grid-cols-[minmax(0,14rem)_1fr]">
                  {s.filas.map((f, j) => (
                    <div key={j} className="contents">
                      <dt className="text-muted-foreground">{f.etiqueta}</dt>
                      <dd className="break-words">{f.valor}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
          <p className="text-muted-foreground text-xs">{t('aviso')}</p>
          <div className="space-y-2">
            <Label htmlFor="nombre-firma-ficha">{t('nombre')}</Label>
            <Input
              id="nombre-firma-ficha"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              maxLength={200}
            />
          </div>
          <div className="space-y-1">
            <Label>{t('trazo')}</Label>
            <FirmaPad onChange={setFirma} disabled={pending} />
          </div>
          <div className="flex flex-wrap justify-between gap-2">
            {onBack ? (
              <Button type="button" variant="outline" onClick={onBack} disabled={pending}>
                {tRoot('alta.wizard.atras')}
              </Button>
            ) : (
              <span />
            )}
            <Button
              type="button"
              onClick={firmar}
              disabled={pending || nombre.trim() === '' || !firma}
              data-testid="firmar-ficha"
            >
              {t(contexto === 'alta' ? 'firmar_alta' : 'firmar')}
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
