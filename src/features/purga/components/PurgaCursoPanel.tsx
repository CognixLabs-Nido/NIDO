'use client'

import { useState, useTransition } from 'react'

import { Trash2Icon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { safeTranslateError } from '@/shared/lib/safe-translate'

import { purgarCurso } from '../actions/purgar-curso'
import type { CursoPurgable } from '../queries/get-cursos-purgables'

interface Props {
  cursos: CursoPurgable[]
}

/**
 * F11-G-3 (decisión H) — panel de purga semimanual de documentos sensibles de un curso
 * (≥5 años desde su fin). **Doble validación en UI**: el admin elige el curso y teclea su
 * nombre EXACTO antes de habilitar el botón; el server re-verifica el corte de 5 años. Manual.
 */
export function PurgaCursoPanel({ cursos }: Props) {
  const t = useTranslations('admin.purga')
  const tErrors = useTranslations()
  const [cursoId, setCursoId] = useState<string | null>(null)
  const [confirmacion, setConfirmacion] = useState('')
  const [pending, startTransition] = useTransition()

  const curso = cursos.find((c) => c.id === cursoId) ?? null
  const confirmado = curso !== null && confirmacion.trim() === curso.nombre

  if (cursos.length === 0) {
    return <p className="text-muted-foreground text-sm">{t('sin_cursos')}</p>
  }

  function ejecutar() {
    if (!curso || !confirmado) return
    startTransition(async () => {
      const r = await purgarCurso({ cursoId: curso.id, confirmacionNombre: confirmacion.trim() })
      if (!r.success) {
        toast.error(safeTranslateError(tErrors, r.error))
        return
      }
      toast.success(t('purgado', { documentos: r.data.documentos, ninos: r.data.ninos }))
      setCursoId(null)
      setConfirmacion('')
    })
  }

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-xs">{t('descripcion')}</p>

      <Select
        value={cursoId ?? undefined}
        onValueChange={(v) => {
          setCursoId(v)
          setConfirmacion('')
        }}
      >
        <SelectTrigger>
          <SelectValue placeholder={t('seleccionar_curso')} />
        </SelectTrigger>
        <SelectContent>
          {cursos.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.nombre} · {t('fin', { fecha: c.fechaFin })}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {curso && (
        <div className="space-y-2">
          <p className="text-xs">{t('confirmar_label', { nombre: curso.nombre })}</p>
          <Input
            value={confirmacion}
            onChange={(e) => setConfirmacion(e.target.value)}
            placeholder={curso.nombre}
            disabled={pending}
            data-testid="purga-confirmacion"
          />
          <Button
            type="button"
            variant="destructive"
            disabled={!confirmado || pending}
            onClick={ejecutar}
            data-testid="purga-ejecutar"
          >
            <Trash2Icon className="size-4" />
            <span className="ml-1">{pending ? t('purgando') : t('purgar')}</span>
          </Button>
        </div>
      )}
    </div>
  )
}
