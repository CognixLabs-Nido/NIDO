import { destinosParaRol, type RecordatorioPreset } from '../lib/form-helpers'
import { getAulasParaRecordatorios } from '../queries/get-aulas-para-recordatorios'
import { getNinosParaRecordatorios } from '../queries/get-ninos-para-recordatorios'
import { getProfesParaRecordatorios } from '../queries/get-profes-para-recordatorios'
import { RecordatorioFormDialog } from './RecordatorioFormDialog'

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
export async function NuevoRecordatorioContextual({ locale, rol, centroId, preset }: Props) {
  const destinos = destinosParaRol(rol)
  if (destinos.length === 0) return null

  const [ninos, aulas, profes] = await Promise.all([
    getNinosParaRecordatorios(),
    getAulasParaRecordatorios(rol, centroId),
    rol === 'admin' ? getProfesParaRecordatorios(centroId) : Promise.resolve([]),
  ])

  return (
    <RecordatorioFormDialog
      locale={locale}
      destinos={destinos}
      ninos={ninos}
      aulas={aulas}
      profes={profes}
      preset={preset}
    />
  )
}
