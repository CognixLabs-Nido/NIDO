'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

import { upsertPlantillaDia } from '../actions/upsert-plantilla-dia'
import type { DiaSemana } from '../schemas/menu'
import type { PlantillaMenuDiaRow } from '../types'

type DiasIniciales = Record<DiaSemana, PlantillaMenuDiaRow | null>

interface Props {
  plantillaId: string
  readOnly: boolean
  diasIniciales: DiasIniciales
}

const DIAS: DiaSemana[] = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes']

type DiaState = {
  desayuno: string
  media_manana: string
  comida: string
  merienda: string
}

function rowToState(row: PlantillaMenuDiaRow | null): DiaState {
  return {
    desayuno: row?.desayuno ?? '',
    media_manana: row?.media_manana ?? '',
    comida: row?.comida ?? '',
    merienda: row?.merienda ?? '',
  }
}

export function PlantillaMenuEditor({ plantillaId, readOnly, diasIniciales }: Props) {
  const t = useTranslations('menus')
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [savingDia, setSavingDia] = useState<DiaSemana | null>(null)
  const [savedDia, setSavedDia] = useState<DiaSemana | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dias, setDias] = useState<Record<DiaSemana, DiaState>>({
    lunes: rowToState(diasIniciales.lunes),
    martes: rowToState(diasIniciales.martes),
    miercoles: rowToState(diasIniciales.miercoles),
    jueves: rowToState(diasIniciales.jueves),
    viernes: rowToState(diasIniciales.viernes),
  })

  function setCampo(dia: DiaSemana, campo: keyof DiaState, value: string) {
    setDias((prev) => ({ ...prev, [dia]: { ...prev[dia], [campo]: value } }))
    setSavedDia(null)
  }

  function guardarDia(dia: DiaSemana) {
    if (readOnly) return
    setError(null)
    setSavingDia(dia)
    const state = dias[dia]
    startTransition(async () => {
      const result = await upsertPlantillaDia({
        plantilla_id: plantillaId,
        dia_semana: dia,
        desayuno: state.desayuno.trim() === '' ? null : state.desayuno,
        media_manana: state.media_manana.trim() === '' ? null : state.media_manana,
        comida: state.comida.trim() === '' ? null : state.comida,
        merienda: state.merienda.trim() === '' ? null : state.merienda,
      })
      setSavingDia(null)
      if (result.success) {
        setSavedDia(dia)
        router.refresh()
      } else {
        setError(result.error)
      }
    })
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}
      {DIAS.map((dia) => {
        const s = dias[dia]
        return (
          <Card key={dia} data-testid={`plantilla-dia-${dia}`}>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-h3 text-foreground">{t(`dia.${dia}`)}</h2>
                {!readOnly && (
                  <Button
                    type="button"
                    size="xs"
                    variant={savedDia === dia ? 'outline' : 'default'}
                    onClick={() => guardarDia(dia)}
                    disabled={pending && savingDia === dia}
                    data-testid={`guardar-dia-${dia}`}
                  >
                    {pending && savingDia === dia
                      ? t('guardando')
                      : savedDia === dia
                        ? t('guardado')
                        : t('guardar')}
                  </Button>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <CampoMomento
                  label={t('momento.desayuno')}
                  value={s.desayuno}
                  onChange={(v) => setCampo(dia, 'desayuno', v)}
                  readOnly={readOnly}
                  testId={`campo-${dia}-desayuno`}
                />
                <CampoMomento
                  label={t('momento.media_manana')}
                  value={s.media_manana}
                  onChange={(v) => setCampo(dia, 'media_manana', v)}
                  readOnly={readOnly}
                  testId={`campo-${dia}-media_manana`}
                />
                <CampoMomento
                  label={t('momento.comida')}
                  value={s.comida}
                  onChange={(v) => setCampo(dia, 'comida', v)}
                  readOnly={readOnly}
                  testId={`campo-${dia}-comida`}
                />
                <CampoMomento
                  label={t('momento.merienda')}
                  value={s.merienda}
                  onChange={(v) => setCampo(dia, 'merienda', v)}
                  readOnly={readOnly}
                  testId={`campo-${dia}-merienda`}
                />
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

function CampoMomento({
  label,
  value,
  onChange,
  readOnly,
  testId,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  readOnly: boolean
  testId: string
}) {
  return (
    <div>
      <Label className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {label}
      </Label>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={500}
        disabled={readOnly}
        data-testid={testId}
        rows={2}
      />
    </div>
  )
}
