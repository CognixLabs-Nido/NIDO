import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { createClient } from '@/lib/supabase/server'
import { getDatosPedagogicos } from '@/features/datos-pedagogicos/queries/get-datos-pedagogicos'
import { getNinoById } from '@/features/ninos/queries/get-ninos'

import { AltaTutorWizard } from '@/features/alta/components/AltaTutorWizard'
import { pasoInicialAlta } from '@/features/alta/lib/estado-alta'

import type { DatosPedagogicosInput } from '@/features/datos-pedagogicos/schemas/datos-pedagogicos'

interface PageProps {
  params: Promise<{ locale: string; ninoId: string }>
}

export const dynamic = 'force-dynamic'

/**
 * Wizard de alta del tutor (Pieza 3b-2). El tutor completa la matrícula de su hijo en
 * pasos guardables y reanudables. Esta ruta server-side:
 *  1. verifica que el usuario es tutor del niño (vínculo activo; las RPCs/RLS de cada
 *     paso reenforzan `es_tutor_de`),
 *  2. pre-carga lo persistido (identidad, datos pedagógicos, consentimiento médico),
 *  3. deriva el paso inicial (reanuda donde se dejó; único gate duro = identidad).
 */
export default async function AltaTutorPage({ params }: PageProps) {
  const { locale, ninoId } = await params

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

  const estado = {
    identidadCompleta: Boolean(nino.apellidos && nino.fecha_nacimiento),
    pedagogicosCompletos: datosPed !== null,
    consintioDatosMedicos: consentMedico !== null,
  }
  const pasoInicial = pasoInicialAlta(estado)

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
        pasoInicial={pasoInicial}
        identidadInicial={{
          apellidos: nino.apellidos,
          fecha_nacimiento: nino.fecha_nacimiento,
          sexo: nino.sexo,
          nacionalidad: nino.nacionalidad,
          idioma_principal: nino.idioma_principal,
        }}
        datosPedagogicosInicial={datosPedagogicosInicial}
        consintioDatosMedicos={estado.consintioDatosMedicos}
      />
    </div>
  )
}
