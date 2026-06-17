import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { getAutorizacionDetalle } from '@/features/autorizaciones/queries/get-autorizacion-detalle'
import { getCurrentUser } from '@/features/auth/queries/get-current-user'
import { createClient } from '@/lib/supabase/server'
import { getDatosPedagogicos } from '@/features/datos-pedagogicos/queries/get-datos-pedagogicos'
import { firmarFotoNino } from '@/features/ninos/queries/get-foto-nino'
import { getInfoMedica, getNinoById } from '@/features/ninos/queries/get-ninos'

import { AltaCompletadaScreen } from '@/features/alta/components/AltaCompletadaScreen'
import { AltaTutorWizard } from '@/features/alta/components/AltaTutorWizard'
import { pasoInicialAlta } from '@/features/alta/lib/estado-alta'

import type { DatosPedagogicosInput } from '@/features/datos-pedagogicos/schemas/datos-pedagogicos'
import type { ImagenPanelData, MedicaInicial } from '@/features/alta/lib/tipos'

interface PageProps {
  params: Promise<{ locale: string; ninoId: string }>
  searchParams: Promise<{ editar?: string }>
}

export const dynamic = 'force-dynamic'

/**
 * Wizard de alta del tutor (Pieza 3b-2). El tutor completa la matrícula de su hijo en
 * pasos guardables y reanudables. Esta ruta server-side:
 *  1. verifica que el usuario es tutor del niño (vínculo activo; las RPCs/RLS de cada
 *     paso reenforzan `es_tutor_de`),
 *  2. pre-carga lo persistido (identidad, datos pedagógicos, consentimiento médico,
 *     info médica, foto, y el panel de firma de imagen si ya hay instancia),
 *  3. deriva el paso inicial (reanuda donde se dejó; único gate duro = identidad).
 *
 * La instancia de imagen NO se crea aquí (crearImagenAutorizacion llama revalidatePath,
 * prohibido durante el render): solo se LEE. Si no existe, `PasoImagen` la instancia con
 * una action al entrar al paso, y `router.refresh()` re-ejecuta esta ruta para poblar el
 * panel (que así refleja el estado tras firmar).
 */
export default async function AltaTutorPage({ params, searchParams }: PageProps) {
  const { locale, ninoId } = await params
  const { editar } = await searchParams

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) notFound()

  // Vínculo activo con el niño (la edición real la gatean las RPCs por `es_tutor_de`).
  const { data: vinculo } = await supabase
    .from('vinculos_familiares')
    .select('id')
    .eq('nino_id', ninoId)
    .eq('usuario_id', user.id)
    .is('deleted_at', null)
    .maybeSingle()
  if (!vinculo) notFound()

  const nino = await getNinoById(ninoId)
  if (!nino) notFound()

  // Estado de la matrícula vigente → gate del flujo (Comportamiento 7):
  //  - 'activa'  → ya validada por la dirección: al panel.
  //  - 'lista'   → finalizada por el tutor, pendiente de validación: pantalla de cierre
  //                (salvo ?editar=1, que reentra al wizard para corregir).
  //  - resto ('pendiente'/sin matrícula) → wizard.
  const { data: matricula } = await supabase
    .from('matriculas')
    .select('estado')
    .eq('nino_id', ninoId)
    .is('fecha_baja', null)
    .is('deleted_at', null)
    .maybeSingle()

  if (matricula?.estado === 'activa') redirect(`/${locale}/family`)

  if (matricula?.estado === 'lista' && editar !== '1') {
    return (
      <AltaCompletadaScreen
        ninoNombre={nino.nombre}
        editarHref={`/${locale}/family/alta/${ninoId}?editar=1`}
      />
    )
  }

  const datosPed = await getDatosPedagogicos(ninoId)
  const datosPedagogicosInicial: DatosPedagogicosInput | null = datosPed
    ? {
        nino_id: datosPed.nino_id,
        lactancia_estado: datosPed.lactancia_estado,
        lactancia_observaciones: datosPed.lactancia_observaciones,
        control_esfinteres: datosPed.control_esfinteres,
        control_esfinteres_observaciones: datosPed.control_esfinteres_observaciones,
        siesta_horario_habitual: datosPed.siesta_horario_habitual,
        siesta_numero_diario: datosPed.siesta_numero_diario,
        siesta_observaciones: datosPed.siesta_observaciones,
        tipo_alimentacion: datosPed.tipo_alimentacion,
        alimentacion_observaciones: datosPed.alimentacion_observaciones,
        idiomas_casa: datosPed.idiomas_casa,
        tiene_hermanos_en_centro: datosPed.tiene_hermanos_en_centro,
      }
    : null

  // Consentimiento de datos médicos vigente (RLS `consentimientos_self_select`).
  const { data: consentMedico } = await supabase
    .from('consentimientos')
    .select('id')
    .eq('usuario_id', user.id)
    .eq('tipo', 'datos_medicos')
    .is('revocado_en', null)
    .limit(1)
    .maybeSingle()
  const consintioDatosMedicos = consentMedico !== null

  // Info médica descifrada (si el tutor tiene acceso de lectura; prefill del paso).
  let medicaInicial: MedicaInicial | null = null
  try {
    medicaInicial = await getInfoMedica(ninoId)
  } catch {
    medicaInicial = null
  }

  // Foto actual del niño (enlace firmado ~1h) para SubirFotoNino.
  const foto = await firmarFotoNino(nino.foto_url)

  // Panel de firma de imagen: solo si YA existe la instancia (no se crea en render).
  const { data: imagenInstancia } = await supabase
    .from('autorizaciones')
    .select('id')
    .eq('nino_id', ninoId)
    .eq('tipo', 'autorizacion_imagenes')
    .eq('es_plantilla', false)
    .eq('estado', 'publicada')
    .limit(1)
    .maybeSingle()

  let imagenPanel: ImagenPanelData | null = null
  if (imagenInstancia) {
    const detalle = await getAutorizacionDetalle(imagenInstancia.id)
    if (detalle) {
      imagenPanel = {
        autorizacionId: detalle.id,
        firmable: detalle.firmable,
        roster: detalle.roster,
      }
    }
  }

  // Sin instancia: ¿hay plantilla de imagen publicada? Si no, el paso se omite.
  let imagenSinPlantilla = false
  if (!imagenInstancia) {
    const { data: plantilla } = await supabase
      .from('autorizaciones')
      .select('id')
      .eq('centro_id', nino.centro_id)
      .eq('tipo', 'autorizacion_imagenes')
      .eq('es_plantilla', true)
      .eq('estado', 'publicada')
      .eq('texto_definitivo', true)
      .limit(1)
      .maybeSingle()
    imagenSinPlantilla = plantilla === null
  }

  const perfil = await getCurrentUser()

  const pasoInicial = pasoInicialAlta({
    identidadCompleta: Boolean(nino.apellidos && nino.fecha_nacimiento),
    pedagogicosCompletos: datosPed !== null,
    consintioDatosMedicos,
  })

  const t = await getTranslations('alta')

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-h2">{t('titulo')}</h1>
        <p className="text-muted-foreground text-sm">{t('subtitulo', { nombre: nino.nombre })}</p>
      </header>
      <AltaTutorWizard
        locale={locale}
        ninoId={ninoId}
        ninoNombre={nino.nombre}
        pasoInicial={pasoInicial}
        identidadInicial={{
          apellidos: nino.apellidos,
          fecha_nacimiento: nino.fecha_nacimiento,
          sexo: nino.sexo,
          nacionalidad: nino.nacionalidad,
          idioma_principal: nino.idioma_principal,
        }}
        datosPedagogicosInicial={datosPedagogicosInicial}
        consintioDatosMedicos={consintioDatosMedicos}
        medicaInicial={medicaInicial}
        fotoInicialUrl={foto.url ?? foto.urlMiniatura}
        imagenPanel={imagenPanel}
        imagenSinPlantilla={imagenSinPlantilla}
        currentUserId={user.id}
        currentUserNombre={perfil?.nombreCompleto ?? ''}
      />
    </div>
  )
}
