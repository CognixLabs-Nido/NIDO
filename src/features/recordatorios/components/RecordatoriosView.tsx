'use client'

import { useCallback, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'

import { ListaRecordatorios } from './ListaRecordatorios'
import { RecordatorioFormDialog } from './RecordatorioFormDialog'
import { useRecordatoriosRealtime } from '../lib/use-recordatorios-realtime'
import type { RecordatorioDestinatarioInput } from '../schemas/recordatorios'
import type { AulaParaRecordatorio } from '../queries/get-aulas-para-recordatorios'
import type { NinoParaRecordatorio } from '../queries/get-ninos-para-recordatorios'
import type { ProfeParaRecordatorio } from '../queries/get-profes-para-recordatorios'
import type { RecordatorioListItem } from '../types'

interface Props {
  locale: string
  userId: string
  /** Destinos que el rol puede crear (para el form). Vacío = tutor (solo lee). */
  destinos: RecordatorioDestinatarioInput[]
  ninos: NinoParaRecordatorio[]
  aulas: AulaParaRecordatorio[]
  profes: ProfeParaRecordatorio[]
  pendientes: RecordatorioListItem[]
  completados: RecordatorioListItem[]
}

type Filtro = 'todos' | RecordatorioDestinatarioInput

export function RecordatoriosView({
  locale,
  userId,
  destinos,
  ninos,
  aulas,
  profes,
  pendientes,
  completados,
}: Props) {
  const t = useTranslations('recordatorios')
  const tDestinos = useTranslations('recordatorios.destinos')
  const router = useRouter()
  const [filtro, setFiltro] = useState<Filtro>('todos')

  // Refresca el SSR ante cualquier cambio Realtime (otro usuario crea/completa/anula).
  const onChange = useCallback(() => router.refresh(), [router])
  useRecordatoriosRealtime({ channel: 'recordatorios', onChange })

  // Destinos presentes en lo que el usuario ve → chips de filtro.
  const destinosVisibles = useMemo(() => {
    const set = new Set<RecordatorioDestinatarioInput>()
    for (const r of [...pendientes, ...completados]) {
      set.add(r.destinatario as RecordatorioDestinatarioInput)
    }
    return Array.from(set)
  }, [pendientes, completados])

  const aplica = (r: RecordatorioListItem) => filtro === 'todos' || r.destinatario === filtro
  const pendientesFiltrados = pendientes.filter(aplica)
  const completadosFiltrados = completados.filter(aplica)

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('titulo_pagina')}</h1>
        {/* Tutor/autorizado solo reciben: sin destinos → sin botón crear. */}
        {destinos.length > 0 && (
          <RecordatorioFormDialog
            locale={locale}
            destinos={destinos}
            ninos={ninos}
            aulas={aulas}
            profes={profes}
          />
        )}
      </header>

      {destinosVisibles.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('filtros_aria')}>
          <Button
            size="sm"
            variant={filtro === 'todos' ? 'secondary' : 'ghost'}
            onClick={() => setFiltro('todos')}
          >
            {t('filtros.todos')}
          </Button>
          {destinosVisibles.map((d) => (
            <Button
              key={d}
              size="sm"
              variant={filtro === d ? 'secondary' : 'ghost'}
              onClick={() => setFiltro(d)}
            >
              {tDestinos(d)}
            </Button>
          ))}
        </div>
      )}

      {pendientes.length === 0 && completados.length === 0 ? (
        <p className="text-muted-foreground rounded-lg border border-dashed p-8 text-center text-sm">
          {t(destinos.length > 0 ? 'empty' : 'empty_solo_lectura')}
        </p>
      ) : (
        <div className="space-y-6">
          <ListaRecordatorios
            titulo={t('pendientes')}
            items={pendientesFiltrados}
            userId={userId}
            locale={locale}
            emptyLabel={t('empty_pendientes')}
            testid="lista-pendientes"
          />

          {completados.length > 0 && (
            <details className="group">
              <summary className="cursor-pointer text-sm font-semibold tracking-wide uppercase opacity-70">
                {t('completados')}{' '}
                <span className="opacity-60">({completadosFiltrados.length})</span>
              </summary>
              <div className="mt-2">
                <ListaRecordatorios
                  titulo=""
                  items={completadosFiltrados}
                  userId={userId}
                  locale={locale}
                  emptyLabel={t('empty_completados')}
                  testid="lista-completados"
                />
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  )
}
