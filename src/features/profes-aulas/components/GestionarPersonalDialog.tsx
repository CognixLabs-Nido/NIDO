'use client'

import { useMemo, useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { hoyMadrid } from '@/features/agenda-diaria/lib/fecha'

import { asignarProfeAula } from '../actions/asignar-profe-aula'
import { cambiarTipoPersonal } from '../actions/cambiar-tipo-personal'
import { moverProfeAula } from '../actions/mover-profe-aula'
import { sustituirCoordinadora } from '../actions/sustituir-coordinadora'
import { terminarAsignacion } from '../actions/terminar-asignacion'
import type { PersonalAulaItem } from '../queries/get-personal-aula'
import type { ProfeCandidato } from '../queries/get-profes-candidatos'
import { TIPO_PERSONAL_AULA, type TipoPersonalAula } from '../types'

interface Props {
  aula: { id: string; nombre: string }
  /** Personal activo del aula (con id de asignación). */
  personal: PersonalAulaItem[]
  /** Pool de profes del centro (D8). El diálogo excluye a los ya activos. */
  candidatos: ProfeCandidato[]
  /** Resto de aulas del curso, para "Mover a…". */
  aulasDestino: { id: string; nombre: string }[]
}

// Confirmación de sustitución de coordinadora (ADR-0034). Dos orígenes:
//  - 'add':     se está añadiendo una persona nueva como coordinadora.
//  - 'cambiar': se está promocionando una asignación ya existente del aula.
type SustituirState =
  | { mode: 'add'; profeId: string; coordNombre: string }
  | { mode: 'cambiar'; asignacionId: string; coordNombre: string }
  | null

export function GestionarPersonalDialog({ aula, personal, candidatos, aulasDestino }: Props) {
  const t = useTranslations('admin.aulas.personal')
  const tErrors = useTranslations()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const [addProfeId, setAddProfeId] = useState<string | null>(null)
  const [addTipo, setAddTipo] = useState<TipoPersonalAula>('profesora')
  const [retirarConfirm, setRetirarConfirm] = useState<string | null>(null)
  const [sustituir, setSustituir] = useState<SustituirState>(null)

  const coordinadoraActual = personal.find((p) => p.tipo_personal_aula === 'coordinadora') ?? null

  // Candidatos no asignados ya activamente a esta aula (D8).
  const candidatosDisponibles = useMemo(() => {
    const enAula = new Set(personal.map((p) => p.profe_id))
    return candidatos.filter((c) => !enAula.has(c.id))
  }, [candidatos, personal])

  const otrasAulas = useMemo(
    () => aulasDestino.filter((a) => a.id !== aula.id),
    [aulasDestino, aula.id]
  )

  // TODO(item4): confirmar etiquetas VA de tipos con el usuario.
  const tipoItems = TIPO_PERSONAL_AULA.map((v) => ({ value: v, label: t(`tipo.${v}`) }))
  const candidatoItems = candidatosDisponibles.map((c) => ({
    value: c.id,
    label: c.nombre_completo,
  }))
  const aulaItems = otrasAulas.map((a) => ({ value: a.id, label: a.nombre }))

  function run(action: () => Promise<{ success: boolean; error?: string }>, successKey: string) {
    startTransition(async () => {
      const r = await action()
      if (r.success) {
        toast.success(t(successKey))
        setRetirarConfirm(null)
        setSustituir(null)
        setAddProfeId(null)
        setAddTipo('profesora')
      } else {
        toast.error(tErrors(r.error ?? 'profeAula.errors.cambiar_tipo_fallo'))
      }
    })
  }

  function handleAdd() {
    if (!addProfeId) return
    if (addTipo === 'coordinadora' && coordinadoraActual) {
      setSustituir({
        mode: 'add',
        profeId: addProfeId,
        coordNombre: coordinadoraActual.nombre_completo,
      })
      return
    }
    run(
      () =>
        asignarProfeAula(aula.id, {
          profe_id: addProfeId,
          fecha_inicio: hoyMadrid(),
          tipo_personal_aula: addTipo,
        }),
      'added'
    )
  }

  function handleMover(asignacionId: string, destinoId: string) {
    run(() => moverProfeAula({ asignacion_id: asignacionId, aula_destino_id: destinoId }), 'movido')
  }

  function handleCambiarTipo(asignacionId: string, nuevoTipo: TipoPersonalAula) {
    if (
      nuevoTipo === 'coordinadora' &&
      coordinadoraActual &&
      coordinadoraActual.asignacion_id !== asignacionId
    ) {
      setSustituir({
        mode: 'cambiar',
        asignacionId,
        coordNombre: coordinadoraActual.nombre_completo,
      })
      return
    }
    run(
      () => cambiarTipoPersonal({ asignacion_id: asignacionId, tipo_personal_aula: nuevoTipo }),
      'tipo_cambiado'
    )
  }

  function confirmarSustitucion() {
    if (!sustituir) return
    if (sustituir.mode === 'cambiar') {
      run(
        () =>
          sustituirCoordinadora({ aula_id: aula.id, nueva_asignacion_id: sustituir.asignacionId }),
        'sustituida'
      )
      return
    }
    // mode 'add': crear la asignación como profesora y luego promocionarla.
    startTransition(async () => {
      const creada = await asignarProfeAula(aula.id, {
        profe_id: sustituir.profeId,
        fecha_inicio: hoyMadrid(),
        tipo_personal_aula: 'profesora',
      })
      if (!creada.success) {
        toast.error(tErrors(creada.error))
        return
      }
      const promo = await sustituirCoordinadora({
        aula_id: aula.id,
        nueva_asignacion_id: creada.data.id,
      })
      if (promo.success) {
        toast.success(t('sustituida'))
        setSustituir(null)
        setAddProfeId(null)
        setAddTipo('profesora')
      } else {
        toast.error(tErrors(promo.error))
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant="outline" size="sm" data-testid={`admin-aula-gestionar-${aula.id}`}>
            {t('gestionar')}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t('dialog_title', { aula: aula.nombre })}</DialogTitle>
        </DialogHeader>

        {/* Confirmación de sustitución de coordinadora (ADR-0034) */}
        {sustituir && (
          <div
            className="border-border bg-muted space-y-3 rounded-lg border p-3"
            data-testid="personal-dialog-sustituir-confirm"
          >
            <p className="text-sm">
              {t('sustituir_desc', { coordinadora: sustituir.coordNombre })}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSustituir(null)}
                disabled={pending}
              >
                {t('cancelar')}
              </Button>
              <Button
                size="sm"
                onClick={confirmarSustitucion}
                disabled={pending}
                data-testid="personal-dialog-sustituir-confirm-button"
              >
                {t('sustituir')}
              </Button>
            </div>
          </div>
        )}

        {/* Personal actual */}
        <section className="space-y-2">
          <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {t('personal_actual')}
          </h3>
          {personal.length === 0 ? (
            <p className="text-muted-foreground text-sm" data-testid="personal-dialog-empty">
              {t('empty')}
            </p>
          ) : (
            <ul className="divide-border divide-y">
              {personal.map((p) => (
                <li
                  key={p.asignacion_id}
                  className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between"
                  data-testid={`personal-dialog-row-${p.profe_id}`}
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    {p.nombre_completo}
                    {p.tipo_personal_aula === 'coordinadora' && (
                      <Badge variant="warm">{t('tipo.coordinadora')}</Badge>
                    )}
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      items={tipoItems}
                      value={p.tipo_personal_aula}
                      onValueChange={(v) =>
                        handleCambiarTipo(p.asignacion_id, v as TipoPersonalAula)
                      }
                    >
                      <SelectTrigger size="sm" aria-label={t('aria_cambiar_tipo')}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {tipoItems.map((item) => (
                          <SelectItem key={item.value} value={item.value}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {otrasAulas.length > 0 && (
                      <Select
                        items={aulaItems}
                        value={null}
                        onValueChange={(v) => v && handleMover(p.asignacion_id, v as string)}
                      >
                        <SelectTrigger size="sm" aria-label={t('aria_mover')}>
                          <SelectValue placeholder={t('mover_a')} />
                        </SelectTrigger>
                        <SelectContent>
                          {aulaItems.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {retirarConfirm === p.asignacion_id ? (
                      <span className="flex items-center gap-1">
                        <span className="text-muted-foreground text-xs">
                          {t('confirmar_retirar')}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={pending}
                          onClick={() =>
                            run(
                              () => terminarAsignacion({ asignacion_id: p.asignacion_id }),
                              'retirado'
                            )
                          }
                          data-testid={`personal-dialog-retirar-confirm-${p.profe_id}`}
                        >
                          {t('si')}
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => setRetirarConfirm(null)}>
                          {t('no')}
                        </Button>
                      </span>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setRetirarConfirm(p.asignacion_id)}
                        data-testid={`personal-dialog-retirar-${p.profe_id}`}
                      >
                        {t('retirar')}
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Añadir persona */}
        <section className="space-y-2 border-t pt-3">
          <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {t('anadir_persona')}
          </h3>
          {candidatosDisponibles.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('sin_candidatos')}</p>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="flex-1">
                <Select
                  items={candidatoItems}
                  value={addProfeId}
                  onValueChange={(v) => setAddProfeId(v as string)}
                >
                  <SelectTrigger className="w-full" aria-label={t('campo_persona')}>
                    <SelectValue placeholder={t('placeholder_persona')} />
                  </SelectTrigger>
                  <SelectContent>
                    {candidatoItems.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Select
                items={tipoItems}
                value={addTipo}
                onValueChange={(v) => setAddTipo(v as TipoPersonalAula)}
              >
                <SelectTrigger aria-label={t('campo_tipo')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {tipoItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                onClick={handleAdd}
                disabled={pending || !addProfeId}
                data-testid="personal-dialog-add-button"
              >
                {pending ? t('saving') : t('anadir')}
              </Button>
            </div>
          )}
        </section>
      </DialogContent>
    </Dialog>
  )
}
