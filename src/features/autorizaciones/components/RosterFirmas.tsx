'use client'

import { useTranslations } from 'next-intl'

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import type { RosterFirmaNino } from '../types'
import { EstadoFirmaBadge } from './EstadoFirmaBadge'

/**
 * Roster de firmas por niño (vista admin/profe): estado agregado + el detalle de
 * cada firmante requerido con su decisión vigente. Solo presentación; los datos
 * vienen filtrados por RLS en la query.
 */
export function RosterFirmas({ roster }: { roster: RosterFirmaNino[] }) {
  const t = useTranslations('autorizaciones')

  if (roster.length === 0) {
    return <p className="text-muted-foreground text-sm">{t('roster.sin_ninos')}</p>
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('roster.nino')}</TableHead>
          <TableHead>{t('roster.estado')}</TableHead>
          <TableHead>{t('roster.firmantes')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {roster.map((r) => (
          <TableRow key={r.nino_id}>
            <TableCell className="font-medium">{r.nino_nombre}</TableCell>
            <TableCell>
              <EstadoFirmaBadge estado={r.estado} />
            </TableCell>
            <TableCell>
              <ul className="space-y-0.5 text-sm">
                {r.firmantes.length === 0 && (
                  <li className="text-muted-foreground">{t('roster.sin_firmantes')}</li>
                )}
                {r.firmantes.map((f) => (
                  <li key={f.firmante_id} className="flex items-center gap-2">
                    <span>{f.firmante_nombre || t('roster.tutor_anon')}</span>
                    <span className="text-muted-foreground text-xs">
                      {f.decision ? t(`estado_firma.${f.decision}`) : t('estado_firma.pendiente')}
                    </span>
                  </li>
                ))}
              </ul>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
