import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { getAutorizacionDetalle } from '@/features/autorizaciones/queries/get-autorizacion-detalle'
import { getCurrentUser } from '@/features/auth/queries/get-current-user'
import { getRolEnCentro } from '@/features/centros/queries/get-centro-actual'
import { createClient } from '@/lib/supabase/server'
import { getDatosPedagogicos } from '@/features/datos-pedagogicos/queries/get-datos-pedagogicos'
import { firmarFotoNino } from '@/features/ninos/queries/get-foto-nino'
import { getInfoMedica, getNinoById } from '@/features/ninos/queries/get-ninos'
import {
  BUCKET_DNI_TUTORES,
  BUCKET_LIBRO_FAMILIA,
  BUCKET_MANDATO_SEPA,
  firmarRuta,
} from '@/shared/lib/adjuntos/storage'

import { AltaCompletadaScreen } from '@/features/alta/components/AltaCompletadaScreen'
import { AltaTutorWizard } from '@/features/alta/components/AltaTutorWizard'
import { familiaTieneMandatoActivo } from '@/features/alta/queries/get-mandato-familia'
import { resolverEntradaAlta } from '@/features/alta/lib/entrada-alta'
import { pasoInicialAlta } from '@/features/alta/lib/estado-alta'
import { leerTutoresDeNino } from '@/features/alta/lib/tutores-familia'

import type { MandatoSepaInicial } from '@/features/alta/components/PasoSepa'
import type { DatosTutorInicial } from '@/features/alta/components/PasoTutor'
import type { DatosPedagogicosInput } from '@/features/datos-pedagogicos/schemas/datos-pedagogicos'
import type { EstadoCivil } from '@/features/alta/schemas/alta-documentos'
import type { FirmaPanelData, MedicaInicial } from '@/features/alta/lib/tipos'

interface PageProps {
  params: Promise<{ locale: string; ninoId: string }>
  searchParams: Promise<{ editar?: string }>
}

export const dynamic = 'force-dynamic'

/**
 * Wizard de alta del tutor (F11-G, 8 pasos). Esta ruta es la **entrada de reanudación**
 * (post-login): el paso `cuenta` se hizo en `/invitation/[token]`. Verifica tutela, gatea
 * por estado de matrícula y pre-carga lo persistido de cada paso (identidad + dirección,
 * pedagógicos, libro de familia, foto, paneles de firma de normas e imagen, datos de los
 * tutores con sus DNIs, y los valores de familia que se propagan entre hermanos).
 */
export default async function AltaTutorPage({ params, searchParams }: PageProps) {
  const { locale, ninoId } = await params
  const { editar } = await searchParams

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) notFound()

  const nino = await getNinoById(ninoId)
  if (!nino) notFound()

  // Gate de entrada (PR-3b-2 · B1). Con vínculo activo usuario↔niño → entrada normal de
  // tutor. Sin vínculo, admin DEL CENTRO DEL NIÑO → MODO DIRECCIÓN (carga de
  // documentación en papel; la firma va a nombre de la Directora, presencial — eso lo
  // cablea B2). Profe → su panel; resto (admin de OTRO centro, sin rol) → notFound. El
  // rol se ata a `nino.centro_id`, NO al centro genérico, para que un admin de otro
  // centro no entre. La decisión pura vive en `resolverEntradaAlta` (testeada aislada).
  const { data: vinculo } = await supabase
    .from('vinculos_familiares')
    .select('id')
    .eq('nino_id', ninoId)
    .eq('usuario_id', user.id)
    .is('deleted_at', null)
    .maybeSingle()

  const tieneVinculo = vinculo !== null
  const entrada = resolverEntradaAlta({
    tieneVinculo,
    // Solo consultamos el rol si NO hay vínculo (el tutor no necesita el lookup).
    rolEnCentroNino: tieneVinculo ? null : await getRolEnCentro(nino.centro_id),
  })
  if (entrada.tipo === 'redirect') redirect(`/${locale}/${entrada.destino}`)
  if (entrada.tipo === 'notfound') notFound()
  const modoDireccion = entrada.tipo === 'direccion'

  const { data: matricula } = await supabase
    .from('matriculas')
    .select('estado')
    .eq('nino_id', ninoId)
    .is('fecha_baja', null)
    .is('deleted_at', null)
    .maybeSingle()

  // Alta YA validada (matrícula 'activa'): el wizard solo se reabre en modo edición
  // (`?editar=1`). Sin ese flag, el tutor va a su panel. En modo edición, los write-paths
  // detectan `activa` y encolan en `cambios_pendientes` (decisión J) en vez de aplicar.
  if (matricula?.estado === 'activa' && editar !== '1') redirect(`/${locale}/family`)
  if (matricula?.estado === 'lista' && editar !== '1') {
    return (
      <AltaCompletadaScreen
        ninoNombre={nino.nombre}
        editarHref={`/${locale}/alta/${ninoId}?editar=1`}
      />
    )
  }

  // Columnas nuevas de `ninos` (G-0): dirección del menor, libro de familia, estado civil.
  const { data: ninoExtra } = await supabase
    .from('ninos')
    .select(
      'direccion_calle, direccion_numero, direccion_cp, direccion_ciudad, libro_familia_path, estado_civil_familia, familia_id'
    )
    .eq('id', ninoId)
    .maybeSingle()

  // Propagación entre hermanos: si el niño no tiene dirección/estado civil, se rellena por
  // defecto con el de otro hijo del tutor (riesgo de divergencia aceptado, decisión G-1).
  const { data: hermanosVinc } = await supabase
    .from('vinculos_familiares')
    .select('nino_id')
    .eq('usuario_id', user.id)
    .is('deleted_at', null)
    .neq('nino_id', ninoId)
  const hermanosIds = (hermanosVinc ?? []).map((h) => h.nino_id)

  let hermanoEstadoCivil: EstadoCivil | null = null
  let hermanoDireccion: {
    direccion_calle: string | null
    direccion_numero: string | null
    direccion_cp: string | null
    direccion_ciudad: string | null
  } | null = null
  if (hermanosIds.length > 0) {
    const { data: hermanos } = await supabase
      .from('ninos')
      .select(
        'direccion_calle, direccion_numero, direccion_cp, direccion_ciudad, estado_civil_familia'
      )
      .in('id', hermanosIds)
      .is('deleted_at', null)
    for (const h of hermanos ?? []) {
      if (!hermanoEstadoCivil && h.estado_civil_familia) hermanoEstadoCivil = h.estado_civil_familia
      if (!hermanoDireccion && h.direccion_calle) hermanoDireccion = h
    }
  }

  const direccionInicial = {
    direccion_calle: ninoExtra?.direccion_calle ?? hermanoDireccion?.direccion_calle ?? null,
    direccion_numero: ninoExtra?.direccion_numero ?? hermanoDireccion?.direccion_numero ?? null,
    direccion_cp: ninoExtra?.direccion_cp ?? hermanoDireccion?.direccion_cp ?? null,
    direccion_ciudad: ninoExtra?.direccion_ciudad ?? hermanoDireccion?.direccion_ciudad ?? null,
  }
  const familiaEstadoCivil: EstadoCivil | null =
    ninoExtra?.estado_civil_familia ?? hermanoEstadoCivil

  const libroFamiliaUrl = ninoExtra?.libro_familia_path
    ? await firmarRuta(supabase, BUCKET_LIBRO_FAMILIA, ninoExtra.libro_familia_path)
    : null

  // Datos de los tutores (principal/secundario) con su DNI firmado, desde el perfil
  // COMPARTIDO `familia_tutores` (F-2b-3), resuelto por la familia del niño.
  const { tutores: tutoresRows } = await leerTutoresDeNino(supabase, ninoId)

  async function aDatosTutor(
    tipo: 'tutor_legal_principal' | 'tutor_legal_secundario'
  ): Promise<DatosTutorInicial | null> {
    const row = tutoresRows.find((r) => r.tipo_vinculo === tipo)
    if (!row) return null
    const dniUrl = row.dni_documento_path
      ? await firmarRuta(supabase, BUCKET_DNI_TUTORES, row.dni_documento_path)
      : null
    return {
      email: row.email,
      nombre_completo: row.nombre_completo,
      direccion_calle: row.direccion_calle,
      direccion_numero: row.direccion_numero,
      direccion_cp: row.direccion_cp,
      direccion_ciudad: row.direccion_ciudad,
      dni_url: dniUrl,
    }
  }
  let datosTutor1 = await aDatosTutor('tutor_legal_principal')
  const datosTutor2 = await aDatosTutor('tutor_legal_secundario')

  // Prefill del tutor 1: nombre/email de su cuenta; dirección heredada de un hermano si falta.
  const perfil = await getCurrentUser()
  if (!datosTutor1) {
    datosTutor1 = {
      email: user.email ?? null,
      nombre_completo: perfil?.nombreCompleto ?? null,
      direccion_calle: hermanoDireccion?.direccion_calle ?? null,
      direccion_numero: hermanoDireccion?.direccion_numero ?? null,
      direccion_cp: hermanoDireccion?.direccion_cp ?? null,
      direccion_ciudad: hermanoDireccion?.direccion_ciudad ?? null,
      dni_url: null,
    }
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

  const { data: consentMedico } = await supabase
    .from('consentimientos')
    .select('id')
    .eq('usuario_id', user.id)
    .eq('tipo', 'datos_medicos')
    .is('revocado_en', null)
    .limit(1)
    .maybeSingle()
  const consintioDatosMedicos = consentMedico !== null

  let medicaInicial: MedicaInicial | null = null
  try {
    medicaInicial = await getInfoMedica(ninoId)
  } catch {
    medicaInicial = null
  }

  const foto = await firmarFotoNino(nino.foto_url)

  // Panel de firma de imagen (instancia por niño, igual que el flujo previo).
  const imagenPanel = await panelFirma(supabase, ninoId, 'autorizacion_imagenes', false)
  const imagenSinPlantilla =
    imagenPanel === null && (await sinPlantilla(supabase, nino.centro_id, 'autorizacion_imagenes'))

  // Panel de firma de NORMAS (reglas_regimen_interno, patrón A: la dirección la publica;
  // la familia la firma). La RLS de `autorizaciones` filtra a las aplicables al niño.
  const normasPanel = await panelFirma(supabase, ninoId, 'reglas_regimen_interno', true)
  const normasSinPlantilla = normasPanel === null

  // SEPA (G-2): datos del centro (acreedor) y mandato activo previo del tutor 1 (titular).
  const { data: centro } = await supabase
    .from('centros')
    .select('nombre, direccion')
    .eq('id', nino.centro_id)
    .maybeSingle()

  // El IBAN va cifrado (G-2bis) y no se pre-rellena: solo titular/identificador/PDF para el preview.
  const { data: mandatoRow } = await supabase
    .from('mandatos_sepa')
    .select('titular, identificador_mandato, documento_path')
    .eq('nino_id', ninoId)
    .eq('usuario_id', user.id)
    .eq('estado', 'activo')
    .is('deleted_at', null)
    .maybeSingle()
  const mandatoSepaInicial: MandatoSepaInicial | null = mandatoRow
    ? {
        titular: mandatoRow.titular,
        identificador: mandatoRow.identificador_mandato,
        documentoUrl: await firmarRuta(supabase, BUCKET_MANDATO_SEPA, mandatoRow.documento_path),
      }
    : null

  // F-2c-2: el mandato es de la FAMILIA. Si la familia del niño YA tiene uno activo (p. ej.
  // el 2º hijo, o un reintento del 1º), el paso 8 muestra un INFORMATIVO enmascarado
  // (****{ultimos4}) sin re-pedir IBAN/firma. Se resuelve por familia (RLS del tutor).
  const mandatoFamilia = ninoExtra?.familia_id
    ? await familiaTieneMandatoActivo(ninoExtra.familia_id)
    : null

  const pasoInicial = pasoInicialAlta({
    identidadCompleta: Boolean(nino.apellidos && nino.fecha_nacimiento),
    consintioDatosMedicos,
  })

  const t = await getTranslations('alta')
  const enEdicionValidada = matricula?.estado === 'activa' && editar === '1'

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-h2">{t('titulo')}</h1>
        <p className="text-muted-foreground text-sm">{t('subtitulo', { nombre: nino.nombre })}</p>
      </header>
      {enEdicionValidada && (
        <p className="border-accent-warm-300 bg-accent-warm-50 text-accent-warm-800 rounded-xl border p-3 text-sm">
          {t('edicion_validada_aviso')}
        </p>
      )}
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
        direccionInicial={direccionInicial}
        datosPedagogicosInicial={datosPedagogicosInicial}
        libroFamiliaUrl={libroFamiliaUrl}
        consintioDatosMedicos={consintioDatosMedicos}
        medicaInicial={medicaInicial}
        fotoInicialUrl={foto.url ?? foto.urlMiniatura}
        imagenPanel={imagenPanel}
        imagenSinPlantilla={imagenSinPlantilla}
        normasPanel={normasPanel}
        normasSinPlantilla={normasSinPlantilla}
        familiaEstadoCivil={familiaEstadoCivil}
        datosTutor1={datosTutor1}
        datosTutor2={datosTutor2}
        centroId={nino.centro_id}
        centroNombre={centro?.nombre ?? ''}
        centroDireccion={centro?.direccion ?? ''}
        mandatoSepaInicial={mandatoSepaInicial}
        mandatoFamilia={mandatoFamilia}
        currentUserId={user.id}
        currentUserNombre={perfil?.nombreCompleto ?? ''}
        modoDireccion={modoDireccion}
      />
    </div>
  )
}

type ServerClient = Awaited<ReturnType<typeof createClient>>

/** Busca una instancia publicada del tipo dado, visible para el tutor (RLS), y devuelve
 * su panel de firma (firmable + roster). `porNino=false` → patrón A (reglas, ámbito
 * aula/centro, sin nino_id). Null si no hay ninguna. */
async function panelFirma(
  supabase: ServerClient,
  ninoId: string,
  tipo: 'autorizacion_imagenes' | 'reglas_regimen_interno',
  patronA: boolean
): Promise<FirmaPanelData | null> {
  let query = supabase
    .from('autorizaciones')
    .select('id')
    .eq('tipo', tipo)
    .eq('es_plantilla', false)
    .eq('estado', 'publicada')
    .limit(1)
  if (!patronA) query = query.eq('nino_id', ninoId)
  const { data: instancia } = await query.maybeSingle()
  if (!instancia) return null
  const detalle = await getAutorizacionDetalle(instancia.id)
  if (!detalle) return null
  return { autorizacionId: detalle.id, firmable: detalle.firmable, roster: detalle.roster }
}

/** ¿El centro NO tiene plantilla publicada del tipo? → el paso de firma se omite. */
async function sinPlantilla(
  supabase: ServerClient,
  centroId: string,
  tipo: 'autorizacion_imagenes' | 'reglas_regimen_interno'
): Promise<boolean> {
  const { data: plantilla } = await supabase
    .from('autorizaciones')
    .select('id')
    .eq('centro_id', centroId)
    .eq('tipo', tipo)
    .eq('es_plantilla', true)
    .eq('estado', 'publicada')
    .eq('texto_definitivo', true)
    .limit(1)
    .maybeSingle()
  return plantilla === null
}
