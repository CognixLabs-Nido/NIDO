import { destinosParaRol, type RecordatorioPreset } from '../lib/form-helpers'
import { getAulasParaRecordatorios } from '../queries/get-aulas-para-recordatorios'
import { getNinosParaRecordatorios } from '../queries/get-ninos-para-recordatorios'
import { getProfesParaRecordatorios } from '../queries/get-profes-para-recordatorios'
import { RecordatorioFormDialog } from './RecordatorioFormDialog'
import { LimiteSeccion } from '@/shared/components/LimiteSeccion'

interface Props {
  locale: string
  /** Rol del usuario en el centro. Solo admin/profe crean (tutor/autorizado: null). */
  rol: 'admin' | 'profe'
  centroId: string
  /** Destino + referencia preseleccionados al abrir el Dialog (F6-C-3). */
  preset: RecordatorioPreset
}

/**
 * Entry point contextual de recordatorios (F6-C-3). Server Component que reúne
 * los datos del form (los mismos que `/reminders`) y renderiza el
 * `RecordatorioFormDialog` de F6-C-1 con un `preset`. No duplica lógica de
 * creación ni de destinatarios — solo precarga y preselecciona.
 *
 * Se monta desde `/admin/ninos/[id]` (preset `familia_individual` + niño) y
 * `/teacher/aula/[id]` (preset `familias_aula` + aula). El preselect es
 * conveniencia: el usuario puede cambiar el destino tras abrir.
 */
async function NuevoRecordatorioContextualContenido({ locale, rol, centroId, preset }: Props) {
  const destinos = destinosParaRol(rol)
  if (destinos.length === 0) return null

  const [ninos, aulas, profes] = await Promise.all([
    getNinosParaRecordatorios(centroId),
    getAulasParaRecordatorios(rol, centroId),
    rol === 'admin' ? getProfesParaRecordatorios(centroId) : Promise.resolve([]),
  ])

  return (
    <RecordatorioFormDialog
      locale={locale}
      centroId={centroId}
      destinos={destinos}
      ninos={ninos}
      aulas={aulas}
      profes={profes}
      preset={preset}
    />
  )
}

/**
 * Una SECCIÓN (censo C, 2026-11-25): si su lectura falla, esta parte dice «no se ha podido leer» y el
 * resto de la pantalla sigue (`LimiteSeccion`). El contenido es `NuevoRecordatorioContextualContenido`.
 */
export function NuevoRecordatorioContextual(props: Props) {
  return (
    <LimiteSeccion>
      <NuevoRecordatorioContextualContenido {...props} />
    </LimiteSeccion>
  )
}
