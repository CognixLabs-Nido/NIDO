import {
  BookOpenIcon,
  CalendarDaysIcon,
  CalendarOffIcon,
  ChevronLeftIcon,
  GraduationCapIcon,
  HeartIcon,
  ImageIcon,
  InfoIcon,
  MessageCircleIcon,
  PencilIcon,
} from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { createClient } from '@/lib/supabase/server'
import { AltaEnCursoCard } from '@/features/alta/components/AltaEnCursoCard'
import { estadoAltaFamilia } from '@/features/alta/lib/gate-familia'
import { ambitoFamiliar, esDelAmbito } from '@/features/centros/contexto/ambito-familiar'
import { requireContextoCentro } from '@/features/centros/contexto/get-contexto-centro'
import { getNinoById, leerInfoMedicaParaEditar } from '@/features/ninos/queries/get-ninos'
import { leerTarjetaSanitariaDe } from '@/features/ninos/lib/tarjeta-sanitaria'
import { TarjetaSanitariaCard } from '@/features/ninos/components/TarjetaSanitariaCard'
import { BUCKET_SIP_NINOS, firmarRuta } from '@/shared/lib/adjuntos/storage'
import { getRecorridoNinoFamilia } from '@/features/ninos/queries/get-recorrido-familia'
import { RecorridoFamilia } from '@/features/ninos/components/RecorridoFamilia'
import { firmarFotoNino } from '@/features/ninos/queries/get-foto-nino'
import { SubirFotoNino } from '@/features/ninos/components/SubirFotoNino'
import { ImagenAutorizacionTutor } from '@/features/ninos/components/ImagenAutorizacionTutor'
import { getEstadoImagenNino } from '@/features/ninos/queries/get-estado-imagen-nino'
import { BorrarInfoMedica } from '@/features/ninos/components/BorrarInfoMedica'
import { FichaMedicaBloqueada } from '@/features/ninos/components/FichaMedicaBloqueada'
import { EditarInfoMedica } from '@/features/ninos/components/EditarInfoMedica'
import { LecturasFichaMedica } from '@/features/ninos/components/LecturasFichaMedica'
import { getLecturasFichaMedica } from '@/features/ninos/queries/get-lecturas-ficha-medica'
import { leerCamposAltaFicha } from '@/features/ninos/lib/campos-ficha-familia'
import { DatosPedagogicosReadOnly } from '@/features/datos-pedagogicos/components/DatosPedagogicosReadOnly'
import { getDatosPedagogicos } from '@/features/datos-pedagogicos/queries/get-datos-pedagogicos'
import { AgendaFamiliaSinPermiso } from '@/features/agenda-diaria/components/AgendaFamiliaSinPermiso'
import { AgendaFamiliaView } from '@/features/agenda-diaria/components/AgendaFamiliaView'
import { hoyMadrid } from '@/features/agenda-diaria/lib/fecha'
import { getAgendaDelDia } from '@/features/agenda-diaria/queries/get-agenda-del-dia'
import { AusenciasFamiliaSection } from '@/features/ausencias/components/AusenciasFamiliaSection'
import { getAusenciasNino } from '@/features/ausencias/queries/get-ausencias-nino'
import { MenuDelDiaWidget } from '@/features/menus/components/MenuDelDiaWidget'
import { etiquetaIdiomaPrincipal } from '@/shared/lib/idioma-centinela'
import { DocumentosCentroNino } from '@/features/documentos-centro/components/DocumentosCentroNino'
import { leerDocumentosNino } from '@/features/documentos-centro/lib/firmar-documentos'

interface PageProps {
  params: Promise<{ id: string; locale: string }>
  searchParams: Promise<{ fecha?: string }>
}

export default async function FamilyNinoPage({ params, searchParams }: PageProps) {
  const { id, locale } = await params
  const { fecha: fechaQuery } = await searchParams

  // El gate del alta (P3c) es per-hijo: el layout solo redirige si no hay ningún hijo
  // activo. Si ESTE hijo tiene el alta en curso, la ficha (que asume matrícula activa)
  // se sustituye por la tarjeta «alta en curso» con acceso a su asistente.
  const t = await getTranslations('family.nino')
  const tNav = await getTranslations('family.nav')
  const tTabs = await getTranslations('family.nino.tabs')
  const tAusencia = await getTranslations('ausencia')
  const tFicha = await getTranslations('messages.ficha_nino')
  const tFotos = await getTranslations('fotos.nino')
  const tPed = await getTranslations('pedagogico')
  const nino = await getNinoById(id)
  if (!nino) notFound()
  // Multicentro · Fase 2: un hijo de otro centro no se abre aquí, aunque sea suyo.
  const { centroId } = await requireContextoCentro(locale)
  if (!esDelAmbito(await ambitoFamiliar(centroId), nino.centro_id)) notFound()

  const { ninosEnAlta } = await estadoAltaFamilia(centroId)
  if (ninosEnAlta.includes(id)) {
    return (
      <div className="space-y-6">
        <Link
          href={`/${locale}/family`}
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm font-medium"
        >
          <ChevronLeftIcon className="size-4" />
          {tNav('dashboard')}
        </Link>
        <AltaEnCursoCard ninoId={id} nombre={nino.nombre} locale={locale} />
      </div>
    )
  }

  // Default: hoy hora Madrid. Si llega ?fecha=YYYY-MM-DD válida, la usamos.
  const fecha = fechaQuery && /^\d{4}-\d{2}-\d{2}$/.test(fechaQuery) ? fechaQuery : hoyMadrid()

  // Una sola lectura (cada una queda registrada), que distingue «no hay ficha» de «no se leyó». El
  // editor guarda en modo reemplazar: sobre una ficha que no se leyó (fallo, o el tutor legal sin
  // `puede_ver_info_medica`), una alergia tecleada vaciaba el resto (2026-11-12, medido). Sin leerla
  // no se ofrece editar, y se dice. Bloqueada (20261204120000): ni se lee ni se edita, y se dice
  // desde cuándo.
  const medica = await leerInfoMedicaParaEditar(id, 'ficha')
  const medicaBloqueadaDesde = medica.leida ? null : medica.bloqueadaDesde
  const medicaNoLeida = !medica.leida && !medicaBloqueadaDesde
  const infoMedica = medica.leida ? medica.ficha : null

  const lecturaPed = await getDatosPedagogicos(id)
  const datosPed = lecturaPed.leidos ? lecturaPed.datos : null

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const userId = userData.user?.id

  let permisos: Record<string, boolean> = {}
  // Tutor legal (principal/secundario) → puede retirar la info médica voluntaria
  // (Flag-2 / F11-F2). Mismo criterio que el gate de la RPC `es_tutor_legal_de`.
  let esTutorLegal = false
  if (userId) {
    const { data: vinculo } = await supabase
      .from('vinculos_familiares')
      .select('permisos, tipo_vinculo')
      .eq('usuario_id', userId)
      .eq('nino_id', id)
      .is('deleted_at', null)
      .maybeSingle()
    permisos = (vinculo?.permisos as Record<string, boolean> | null) ?? {}
    esTutorLegal =
      vinculo?.tipo_vinculo === 'tutor_legal_principal' ||
      vinculo?.tipo_vinculo === 'tutor_legal_secundario'
  }

  // Autorización de imagen: solo la gestiona el tutor legal (revocar / volver a autorizar).
  const estadoImagen =
    esTutorLegal && userId
      ? await getEstadoImagenNino(id, nino.puede_aparecer_en_fotos === true, userId)
      : null

  // Agenda del día: cargamos siempre la estructura (RLS filtra si no hay
  // permiso); el render decide qué mostrar.
  const agendaDelDia = permisos.puede_ver_agenda ? await getAgendaDelDia(id, fecha) : null

  // Ausencias: dependen de `puede_ver_agenda` (compartido con la agenda)
  // para leer; `puede_reportar_ausencias` para reportar/cancelar.
  const ausencias = permisos.puede_ver_agenda ? await getAusenciasNino(id) : []
  const puedeReportarAusencias = Boolean(permisos.puede_reportar_ausencias)

  // F-8 (familia): el recorrido por cursos/aulas solo lo ve el tutor legal (la RPC lo
  // vuelve a comprobar con `es_tutor_legal_de`).
  const recorrido = esTutorLegal ? await getRecorridoNinoFamilia(id) : null

  // Quién ha leído la ficha médica de su hijo: lo ve el tutor legal (la RPC lo vuelve a comprobar).
  const lecturas = esTutorLegal ? await getLecturasFichaMedica(id) : null

  const foto = await firmarFotoNino(nino.foto_url)

  // Los documentos del centro, para firmarlos fuera del alta (fase 4, 4c): los firma el tutor legal
  // (la base vuelve a mirarlo). El autorizado ni los lee.
  const documentosCentro = esTutorLegal ? await leerDocumentosNino(supabase, id) : null

  // Fase 5 (decisión del 2026-11-11): el lugar de nacimiento, todos; el resto, el tutor legal.
  const camposAlta = await leerCamposAltaFicha(supabase, id, esTutorLegal)
  // Fase 7: la tarjeta sanitaria, al tutor legal (`sip_de_ninos`; el autorizado no recibe filas).
  const tarjeta = esTutorLegal ? ((await leerTarjetaSanitariaDe(supabase, id)) ?? null) : undefined
  const urlTarjeta = tarjeta?.sip_documento_path
    ? await firmarRuta(supabase, BUCKET_SIP_NINOS, tarjeta.sip_documento_path)
    : null
  const tMenor = await getTranslations('alta.menor')
  const comoNosConocio = camposAlta?.como_nos_conocio
    ? camposAlta.como_nos_conocio === 'otro'
      ? `${tMenor('como_nos_conocio_opciones.otro')}: ${camposAlta.como_nos_conocio_otro ?? ''}`
      : tMenor(`como_nos_conocio_opciones.${camposAlta.como_nos_conocio}`)
    : '—'

  return (
    <div className="space-y-6">
      <Link
        href={`/${locale}/family`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm font-medium"
      >
        <ChevronLeftIcon className="size-4" />
        {tNav('dashboard')}
      </Link>

      <header className="bg-card border-border/60 flex flex-wrap items-center gap-4 rounded-2xl border p-5 shadow-md">
        {/* IU-3: mismo gate que enforza el route handler (`puede_aparecer_en_fotos`).
            Avisado ANTES de subir: si no, el navegador sube la foto entera para recibir
            un 403 (15-20 s con una foto de móvil). */}
        <SubirFotoNino
          ninoId={id}
          locale={locale}
          initialUrl={foto.urlMiniatura ?? foto.url}
          alt={`${nino.nombre} ${nino.apellidos ?? ''}`.trim()}
          bloqueado={!nino.puede_aparecer_en_fotos}
          motivoBloqueo={tFotos('requiere_autorizacion')}
        />
        <div className="min-w-0 flex-1">
          <h1 className="text-h2 text-foreground truncate">
            {nino.nombre}
            {nino.apellidos ? ` ${nino.apellidos}` : ''}
          </h1>
          <p className="text-muted-foreground text-sm">
            {t('fecha_nacimiento')}: {nino.fecha_nacimiento ?? '—'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {esTutorLegal && (
            <Button
              variant="outline"
              render={<Link href={`/${locale}/alta/${id}?editar=1`} />}
              data-testid="editar-datos-button"
            >
              <PencilIcon className="size-4" />
              <span className="ml-1">{t('editar_datos')}</span>
            </Button>
          )}
          {permisos.puede_recibir_mensajes && (
            <Button
              variant="default"
              render={<Link href={`/${locale}/messages/nino/${id}`} />}
              data-testid="escribir-profe-button"
            >
              <MessageCircleIcon className="size-4" />
              <span className="ml-1">{tFicha('escribir_profe')}</span>
            </Button>
          )}
        </div>
      </header>

      <section className="space-y-4">
        <h2 className="text-h3 text-foreground flex items-center gap-2">
          <InfoIcon className="size-5" />
          {t('basicos')}
        </h2>
        <Card>
          <CardContent className="space-y-2 text-sm">
            <Row k={t('fecha_nacimiento')} v={nino.fecha_nacimiento ?? '—'} />
            <Row k={t('idioma_principal')} v={etiquetaIdiomaPrincipal(nino.idioma_principal)} />
            <Row k={t('nacionalidad')} v={nino.nacionalidad ?? '—'} />
            {!camposAlta ? (
              <p className="text-muted-foreground text-xs">{t('campos_alta_sin_lectura')}</p>
            ) : (
              <>
                <Row k={t('lugar_nacimiento')} v={camposAlta.lugar_nacimiento ?? '—'} />
                {esTutorLegal && (
                  <>
                    <Row k={t('dni')} v={camposAlta.dni ?? '—'} />
                    <Row
                      k={t('hermanos')}
                      v={
                        camposAlta.hermanos_total != null && camposAlta.hermanos_lugar != null
                          ? t('hermanos_valor', {
                              lugar: camposAlta.hermanos_lugar,
                              total: camposAlta.hermanos_total,
                            })
                          : '—'
                      }
                    />
                    <Row k={t('provincia')} v={camposAlta.direccion_provincia ?? '—'} />
                    <Row
                      k={t('observaciones_familia')}
                      v={camposAlta.observaciones_familia ?? '—'}
                    />
                    <Row k={t('como_nos_conocio')} v={comoNosConocio} />
                  </>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </section>

      {tarjeta !== undefined && (
        <TarjetaSanitariaCard
          locale={locale}
          ninoId={id}
          tarjeta={tarjeta}
          urlImagen={urlTarjeta}
        />
      )}

      {documentosCentro && (
        <DocumentosCentroNino
          locale={locale}
          ninoId={id}
          lectura={documentosCentro}
          modoDireccion={false}
        />
      )}

      {estadoImagen && (
        <section className="space-y-4">
          <h2 className="text-h3 text-foreground flex items-center gap-2">
            <ImageIcon className="text-primary-600 size-5" />
            {t('imagen.titulo')}
          </h2>
          <Card>
            <CardContent>
              <ImagenAutorizacionTutor
                ninoId={id}
                nombreCompleto={`${nino.nombre} ${nino.apellidos ?? ''}`.trim()}
                estado={estadoImagen}
              />
            </CardContent>
          </Card>
        </section>
      )}

      {recorrido && (
        <section className="space-y-4">
          <h2 className="text-h3 text-foreground flex items-center gap-2">
            <GraduationCapIcon className="text-primary-600 size-5" />
            {t('recorrido.titulo')}
          </h2>
          <RecorridoFamilia tramos={recorrido} />
        </section>
      )}

      {permisos.puede_ver_datos_pedagogicos && (datosPed || !lecturaPed.leidos) && (
        <section className="space-y-4">
          <h2 className="text-h3 text-foreground flex items-center gap-2">
            <BookOpenIcon className="text-accent-warm-600 size-5" />
            {t('pedagogico')}
          </h2>
          {datosPed ? (
            <DatosPedagogicosReadOnly data={datosPed} />
          ) : (
            // Solo lectura, pero un fallo no es «sin datos»: se dice.
            <p className="text-muted-foreground text-sm" data-testid="pedagogicos-no-leidos">
              {tPed('no_leidos_lectura')}
            </p>
          )}
        </section>
      )}

      <section className="space-y-4">
        <h2 className="text-h3 text-foreground flex items-center gap-2">
          <CalendarDaysIcon className="text-primary-600 size-5" />
          {tTabs('agenda')}
        </h2>
        {permisos.puede_ver_agenda ? (
          <>
            <MenuDelDiaWidget centroId={nino.centro_id} fecha={fecha} />
            {agendaDelDia && (
              <AgendaFamiliaView ninoId={id} locale={locale} fecha={fecha} agenda={agendaDelDia} />
            )}
          </>
        ) : (
          <AgendaFamiliaSinPermiso />
        )}
      </section>

      <section className="space-y-4">
        <h2 className="text-h3 text-foreground flex items-center gap-2">
          <CalendarOffIcon className="text-accent-warm-600 size-5" />
          {tAusencia('title')}
        </h2>
        <AusenciasFamiliaSection
          ninoId={id}
          ausencias={ausencias}
          puedeReportar={puedeReportarAusencias}
        />
      </section>

      {(permisos.puede_ver_info_medica || esTutorLegal) && (
        <section className="space-y-4">
          <h2 className="text-h3 text-foreground flex items-center gap-2">
            <HeartIcon className="text-coral-500 size-5" />
            {t('info_medica')}
          </h2>
          {medicaBloqueadaDesde ? (
            <FichaMedicaBloqueada desde={medicaBloqueadaDesde} />
          ) : medicaNoLeida ? (
            <p
              className="text-destructive text-sm"
              role="alert"
              data-testid="ficha-medica-no-leida"
            >
              {t('info_medica_no_leida')}
            </p>
          ) : permisos.puede_ver_info_medica && infoMedica ? (
            <Card>
              <CardContent className="space-y-2 text-sm">
                <Row k={t('alergias_graves')} v={infoMedica.alergias_graves ?? '—'} />
                <Row k={t('alergias_leves')} v={infoMedica.alergias_leves ?? '—'} />
                <Row k={t('notas_emergencia')} v={infoMedica.notas_emergencia ?? '—'} />
                <Row k={t('medicacion_habitual')} v={infoMedica.medicacion_habitual ?? '—'} />
                <Row k={t('medico_familia')} v={infoMedica.medico_familia ?? '—'} />
                <Row k={t('telefono_emergencia')} v={infoMedica.telefono_emergencia ?? '—'} />
              </CardContent>
            </Card>
          ) : (
            <p className="text-muted-foreground text-sm">{t('sin_info_medica')}</p>
          )}
          {esTutorLegal && medica.leida && (
            <div className="flex justify-end gap-2">
              <EditarInfoMedica ninoId={id} inicial={infoMedica} />
              {infoMedica && <BorrarInfoMedica ninoId={id} />}
            </div>
          )}
          {lecturas && (
            <LecturasFichaMedica
              registro={lecturas}
              descarga={{ href: `/${locale}/export/lecturas-ficha-medica/${id}`, para: 'guardar' }}
            />
          )}
        </section>
      )}
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col gap-1 border-b border-dashed border-neutral-200 pb-2 last:border-b-0 last:pb-0 sm:flex-row sm:items-baseline sm:gap-4">
      <span className="text-muted-foreground w-40 shrink-0 text-xs font-medium tracking-wide uppercase">
        {k}
      </span>
      <span className="text-foreground break-words">{v}</span>
    </div>
  )
}
