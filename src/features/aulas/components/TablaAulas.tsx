import Link from 'next/link'

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { GestionarPersonalDialog } from '@/features/profes-aulas/components/GestionarPersonalDialog'
import type { PersonalAulaItem } from '@/features/profes-aulas/queries/get-personal-aula'
import type { ProfeCandidato } from '@/features/profes-aulas/queries/get-profes-candidatos'

import type { AulaConPersonal } from '../queries/get-aulas-con-personal'

/**
 * F5B-#36 (B3) — Tabla de listado de aulas para `/admin/aulas`.
 *
 * Componente puramente presentacional (Server Component sin hooks): la
 * página padre traduce las strings con `getTranslations` y las pasa
 * como `labels`, lo que permite testar el render con jsdom + RTL sin
 * envolver en `NextIntlClientProvider` ni mockear `useTranslations`.
 *
 * Decisiones cerradas (Checkpoint B PR #36):
 *  - D2 Apoyos: sin columna. ANAIA no tiene apoyos hoy.
 *  - D3 Coordinadora: `Badge variant="warm"` con `title` (tooltip).
 *  - Wrapper con `overflow-x-auto` para evitar overflow en mobile
 *    (gotcha #1 de la spec; ancho mínimo afecta a 6 columnas + badges).
 *  - `data-testid="admin-aula-link-${id}"` se preserva sobre el Link
 *    de Nombre para no romper E2E previos (Nota B).
 */
export interface TablaAulasLabels {
  fields: {
    nombre: string
    anio_nacimiento: string
    capacidad: string
    num_alumnos: string
    profesoras: string
    tecnicos: string
    descripcion: string
    acciones: string
  }
  label_coordinadora: string
}

interface Props {
  aulas: AulaConPersonal[]
  labels: TablaAulasLabels
  locale: string
  /** Personal activo por aula (id de asignación incluido) para el diálogo de gestión. */
  personalPorAula: Record<string, PersonalAulaItem[]>
  /** Pool de profes del centro (candidatos a asignar). */
  candidatos: ProfeCandidato[]
}

export function TablaAulas({ aulas, labels, locale, personalPorAula, candidatos }: Props) {
  // Destinos para "Mover": todas las aulas del listado (el diálogo excluye la propia).
  const aulasDestino = aulas.map((a) => ({ id: a.id, nombre: a.nombre }))
  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{labels.fields.nombre}</TableHead>
              <TableHead>{labels.fields.anio_nacimiento}</TableHead>
              <TableHead>{labels.fields.capacidad}</TableHead>
              <TableHead>{labels.fields.num_alumnos}</TableHead>
              <TableHead>{labels.fields.profesoras}</TableHead>
              <TableHead>{labels.fields.tecnicos}</TableHead>
              <TableHead>{labels.fields.descripcion}</TableHead>
              <TableHead>{labels.fields.acciones}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {aulas.map((a) => (
              <TableRow key={a.id} className="hover:bg-muted/30 transition-colors">
                <TableCell className="font-medium">
                  <Link
                    href={`/${locale}/teacher/aula/${a.id}`}
                    className="hover:text-primary inline-block w-full"
                    data-testid={`admin-aula-link-${a.id}`}
                  >
                    {a.nombre}
                  </Link>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {a.cohorte_anos_nacimiento.map((anio) => (
                      <Badge key={anio} variant="warm">
                        {anio}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>{a.capacidad_maxima}</TableCell>
                <TableCell>{a.num_alumnos}</TableCell>
                <TableCell>
                  {a.profesoras.length === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {a.profesoras.map((p) => (
                        <Badge
                          key={p.id}
                          variant={p.tipo_personal_aula === 'coordinadora' ? 'warm' : 'secondary'}
                          title={
                            p.tipo_personal_aula === 'coordinadora'
                              ? labels.label_coordinadora
                              : undefined
                          }
                        >
                          {p.nombre_completo}
                        </Badge>
                      ))}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  {a.tecnicos.length === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <div className="flex flex-col gap-1">
                      {a.tecnicos.map((p) => (
                        <Badge key={p.id} variant="secondary">
                          {p.nombre_completo}
                        </Badge>
                      ))}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {a.descripcion ?? '—'}
                </TableCell>
                <TableCell>
                  <GestionarPersonalDialog
                    aula={{ id: a.id, nombre: a.nombre }}
                    personal={personalPorAula[a.id] ?? []}
                    candidatos={candidatos}
                    aulasDestino={aulasDestino}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  )
}
