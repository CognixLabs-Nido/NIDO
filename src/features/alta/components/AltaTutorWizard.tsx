'use client'

import { useCallback, useState, useTransition } from 'react'

import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

import { finalizarAlta } from '../actions/finalizar-alta'
import type { BloqueAlta } from '../lib/gate-alta'
import { PASO_MIN_AUTENTICADO, pasosAlta, type PasoAlta } from '../lib/estado-alta'
import { PasoAcuses } from './PasoAcuses'
import { PasoCuenta } from './PasoCuenta'
import { PasoFirma } from './PasoFirma'
import { PasoGastos } from './PasoGastos'
import { PasoMedico } from './PasoMedico'
import { PasoMenor, type DireccionInicial } from './PasoMenor'
import { PasoSepa, type MandatoSepaInicial } from './PasoSepa'
import { PasoServicios } from './PasoServicios'
import { PasoTutor, type DatosTutorInicial } from './PasoTutor'
import type { MandatoFamiliaActivo } from '../queries/get-mandato-familia'
import type { OpcionServicio, RespuestaServicio } from '@/features/peticion-servicios/lib/peticion'
import type { GastosCurso } from '@/features/gastos-gestion/lib/gastos'

import type { DatosPedagogicosInput } from '@/features/datos-pedagogicos/schemas/datos-pedagogicos'
import type { ReutilizacionFamilia } from '../lib/reutilizacion-familia'
import type { EstadoCivil } from '../schemas/alta-documentos'
import type { RespuestaImagen } from '../lib/respuesta-imagen'
import type { TutorImagenPapel } from './RespuestaImagenAlta'
import type { IdentidadInicial, ImagenPanelData, MedicaInicial } from '../lib/tipos'
import type { DocumentoParaFirmarFila } from '@/features/documentos-centro/components/DocumentosParaFirmar'

/** Datos de la invitación para el paso `cuenta` (solo en `/invitation/[token]`). */
export interface ModoInvitacion {
  token: string
  email: string
  nombreInicial: string
  requiereParentesco: boolean
}

interface Props {
  locale: string
  ninoId: string
  ninoNombre: string
  /** Índice (0-based sobre PASOS_ALTA) en el que reanudar (lo deriva la ruta). */
  pasoInicial: number
  /** Presente solo en `/invitation/[token]`: el wizard muestra el paso `cuenta`. */
  modoInvitacion?: ModoInvitacion
  identidadInicial: IdentidadInicial
  /** Fase 5b: «cómo nos has conocido», solo a familias nuevas en el centro (lo decide la página). */
  mostrarComoNosConocio: boolean
  direccionInicial: DireccionInicial
  datosPedagogicosInicial: DatosPedagogicosInput | null
  /** `false`: no se pudieron leer; el paso del menor no ofrece el formulario. */
  datosPedagogicosLeidos: boolean
  libroFamiliaUrl: string | null
  consintioDatosMedicos: boolean
  medicaInicial: MedicaInicial | null
  /** `false` si la ficha médica no se pudo leer: los pasos médicos no guardan (no pisan lo que no se vio). */
  medicaLeida: boolean
  fotoInicialUrl: string | null
  imagenPanel: ImagenPanelData | null
  imagenSinPlantilla: boolean
  /** Los documentos del centro que le tocan al niño (fase 4; las normas, entre ellos); en la
   *  invitación no hay. */
  documentosCentro?: DocumentoParaFirmarFila[]
  /** ¿El niño puede salir en fotos? (un «sí» vigente y ningún «no», desde la 10a-2). */
  imagenAceptado: boolean
  /** La respuesta de quien hace el alta a la imagen (fase 10, 10a-2). */
  miRespuestaImagen: RespuestaImagen
  /** Alta en papel (10b-2): los tutores legales con cuenta y su respuesta de imagen. */
  tutoresImagenPapel?: TutorImagenPapel[] | null
  familiaEstadoCivil: EstadoCivil | null
  datosTutor1: DatosTutorInicial | null
  datosTutor2: DatosTutorInicial | null
  /** Datos del centro (acreedor) y mandato SEPA previo para el paso 8 (G-2). */
  centroId: string
  centroNombre: string
  centroDireccion: string
  /**
   * El CID del centro, o null. Sin él no se firma ningún mandato (0c, 2026-11-04): el paso de
   * domiciliación no aparece y el alta se completa en efectivo, como cuando la familia omite.
   */
  centroCid: string | null
  /**
   * Si el centro tiene CID, para contar los pasos. En `/alta` es `Boolean(centroCid)`; en la
   * invitación (antes de entrar) el CID no llega al cliente y llega solo esto.
   */
  centroTieneCid: boolean
  /**
   * Fase 8b: si el centro ofrece algún servicio en Cuotas, para contar los pasos (en la invitación,
   * antes de entrar, también llega solo esto).
   */
  centroTieneServicios: boolean
  /** Lo que el centro ofrece al niño y lo ya contestado; `null` si no se pudo leer. En `/alta`. */
  peticionServicios?: { opciones: OpcionServicio[]; respuestas: RespuestaServicio[] } | null
  /**
   * Fase 9: si el curso del alta tiene importe de gastos de gestión, para contar los pasos (en la
   * invitación, antes de entrar, llega solo esto).
   */
  cursoTieneGastos: boolean
  /** Los gastos del curso del alta y lo ya contestado; `null` si no se pudo leer. En `/alta`. */
  gastosGestion?: GastosCurso[] | null
  mandatoSepaInicial: MandatoSepaInicial | null
  /** F-2c-2: mandato SEPA activo de la FAMILIA (o null). Si existe → paso 8 informativo. */
  mandatoFamilia: MandatoFamiliaActivo | null
  currentUserId: string
  currentUserNombre: string
  /**
   * PR-3b-2 · B1: `true` cuando quien abre el wizard es la Dirección del centro del niño
   * (sin vínculo, admin del centro) cargando la documentación en papel. Lo deriva el gate
   * server-side (NO de la URL). En B1 solo pinta el banner; los write-paths se cablean en B2.
   */
  modoDireccion?: boolean
  /** ¿Puede dar el consentimiento de imagen? (tutor legal o modo Dirección). Si no, el paso
   *  del menor oculta la sección de imagen entera. Por defecto true (comportamiento previo). */
  puedeConsentirImagen?: boolean
  /**
   * U-3: reparto reutilizar-vs-pedir cuando el niño es el 2.º (o 3.º…) de una familia con
   * tutor YA existente. Lo calcula la ruta (`resolverReutilizacionFamilia`). Ausente en
   * `/invitation/[token]` (alta de familia nueva) → nada se da por resuelto.
   */
  reutilizacion?: ReutilizacionFamilia
  /**
   * Fase 10b-2: `false` si el tutor legal no puede leer la ficha médica (`estado_firma_ficha`); el paso
   * de firma lo dice en claro en vez de dar un error. Por defecto true.
   */
  puedeLeerFichaMedica?: boolean
}

const SIN_REUTILIZACION: ReutilizacionFamilia = {
  tutor: false,
  sepa: false,
  hayReutilizacion: false,
}

/**
 * Wizard de alta del tutor (F11-G) — 8 pasos guardables/reanudables, DOS entradas al
 * MISMO componente: `/invitation/[token]` (paso `cuenta`, pre-login) y `/alta/[ninoId]`
 * (pasos 2-8, post-login; reanudación). En `/alta` el paso `cuenta` es inalcanzable
 * (`PASO_MIN_AUTENTICADO`). El último paso (`sepa`: IBAN + mandato SEPA, G-2) finaliza el
 * alta (`finalizarAlta`, matrícula → 'lista') tanto al guardar el mandato como al omitirlo,
 * y la ruta sirve la pantalla "pendiente de validación".
 */
export function AltaTutorWizard({
  locale,
  ninoId,
  ninoNombre,
  pasoInicial,
  modoInvitacion,
  identidadInicial,
  mostrarComoNosConocio,
  direccionInicial,
  datosPedagogicosInicial,
  datosPedagogicosLeidos,
  libroFamiliaUrl,
  consintioDatosMedicos,
  medicaInicial,
  medicaLeida,
  fotoInicialUrl,
  imagenPanel,
  imagenSinPlantilla,
  documentosCentro = [],
  imagenAceptado,
  miRespuestaImagen,
  tutoresImagenPapel = null,
  familiaEstadoCivil,
  datosTutor1,
  datosTutor2,
  centroId,
  centroNombre,
  centroDireccion,
  centroCid,
  centroTieneCid,
  centroTieneServicios,
  peticionServicios = null,
  cursoTieneGastos,
  gastosGestion = null,
  mandatoSepaInicial,
  mandatoFamilia,
  currentUserId,
  currentUserNombre,
  modoDireccion = false,
  puedeConsentirImagen = true,
  reutilizacion = SIN_REUTILIZACION,
  puedeLeerFichaMedica = true,
}: Props) {
  const t = useTranslations('alta')
  const tErrors = useTranslations()
  const router = useRouter()
  const searchParams = useSearchParams()
  // Sin CID del centro el paso `sepa` no se monta: el último es `emergencia`, que finaliza.
  // Los pasos se fijan UNA vez, al empezar (decisión del 2026-11-04): sin CID el alta tiene 7 desde
  // el principio («1 de 7»), también en la invitación, y no cambian aunque la página se vuelva a
  // pintar con otro dato del centro a mitad del alta. Sin CID el último es `emergencia`; los
  // índices de los demás no cambian (`sepa` es el último).
  // Fase 10b-2: la familia termina firmando la ficha; el alta en papel, con «Finalizar» (su firma en
  // papel llega con la 10b-3).
  const [pasos] = useState(() =>
    pasosAlta(centroTieneCid, centroTieneServicios, cursoTieneGastos, !modoDireccion)
  )
  const conSepa = pasos.includes('sepa')
  const conServicios = pasos.includes('servicios')
  const conGastos = pasos.includes('gastos')
  const conFirma = pasos.includes('firma')
  // El CID también, con los pasos: si el centro lo quita a mitad del alta, el paso no se queda en
  // blanco; la ruta rechaza la firma (`centro_sin_cid`, con su mensaje) y «Omitir» finaliza.
  const [cidDelAlta] = useState(centroCid)
  const total = pasos.length
  const pasoMin = modoInvitacion ? 0 : PASO_MIN_AUTENTICADO
  const [step, setStep] = useState<number>(
    Math.min(Math.max(modoInvitacion ? 0 : pasoInicial, pasoMin), total - 1)
  )
  const [consintio, setConsintio] = useState(consintioDatosMedicos)
  const [, startFinalizar] = useTransition()

  // Dirección del NIÑO elevada al contenedor (BUG 5 / PR-4d), mismo patrón que SEPA: el
  // paso del menor se desmonta al navegar, pero los pasos de tutor necesitan leerla para
  // el botón "misma dirección que el niño". PasoMenor la sincroniza en vivo; solo memoria.
  const [direccionNino, setDireccionNino] = useState<DireccionInicial>(direccionInicial)
  // Bloques obligatorios que faltan al intentar finalizar (checklist "qué falta"). null =
  // aún no se ha intentado o el último intento fue completo (PR-4b).
  const [faltan, setFaltan] = useState<BloqueAlta[] | null>(null)

  // SEPA (paso 8): su estado tecleado vive ELEVADO aquí, en el contenedor, para que
  // sobreviva al desmontaje del paso al navegar (BUG 2 / PR-4a-2). Solo memoria: NO se
  // persiste a BD; el mandato se registra igual que antes al finalizar (misma RPC/cifrado).
  const sepaTitularInicial =
    mandatoSepaInicial?.titular ?? datosTutor1?.nombre_completo ?? currentUserNombre
  const [sepaFirma, setSepaFirma] = useState<string | null>(null)
  const [sepaIban, setSepaIban] = useState('')
  const [sepaTitular, setSepaTitular] = useState(sepaTitularInicial)
  const [sepaNombreTecleado, setSepaNombreTecleado] = useState(sepaTitularInicial)
  // 0c-2: el documento y la dirección del titular. La dirección parte de la del tutor 1, que es
  // quien suele ser el titular; el documento no se guarda en ningún otro sitio y se teclea.
  const [sepaDocumento, setSepaDocumento] = useState('')
  const [sepaDireccion, setSepaDireccion] = useState(() => direccionDe(datosTutor1))

  // MÉDICO (pasos `medico` + `emergencia`): su estado tecleado vive ELEVADO aquí, igual que
  // SEPA (BUG 2 / PR-4a-2) y la dirección del niño (PR-4d). Los dos pasos médicos se desmontan
  // al navegar; sin elevar, lo tecleado y no guardado se perdía al retroceder (BUG 5a). Solo
  // memoria: cada paso sigue persistiendo su subconjunto a BD por su cuenta (NULL=preserva).
  const [medicaValores, setMedicaValores] = useState<MedicaInicial>(
    () =>
      medicaInicial ?? {
        alergias_graves: null,
        notas_emergencia: null,
        medicacion_habitual: null,
        alergias_leves: null,
        medico_familia: null,
        telefono_emergencia: null,
      }
  )
  // Cada paso médico sincroniza SOLO su subconjunto (general/emergencia); se fusionan sin
  // pisarse. Estable (useCallback) para no re-suscribir el watch de `PasoMedico` en cada render.
  const mergeMedica = useCallback((subset: Partial<MedicaInicial>) => {
    setMedicaValores((prev) => ({ ...prev, ...subset }))
  }, [])

  const paso: PasoAlta = pasos[step]!
  const goNext = () => setStep((s) => Math.min(s + 1, total - 1))
  const goBack = () => setStep((s) => Math.max(s - 1, pasoMin))

  /** Tras el alta cerrada (con «Finalizar» o al firmar), la ruta sirve la pantalla «completado». */
  function cerrado() {
    setFaltan(null)
    if (searchParams.get('editar')) {
      router.replace(`/${locale}/alta/${ninoId}`)
    } else {
      router.refresh()
    }
  }

  function finalizar() {
    startFinalizar(async () => {
      const r = await finalizarAlta(ninoId)
      if (!r.success) {
        if (r.faltan && r.faltan.length > 0) {
          // Gate de completitud: no se finaliza; se muestra el checklist de lo que falta.
          setFaltan(r.faltan)
          toast.error(t('finalizar.incompleto_titulo'))
        } else {
          toast.error(tErrors(r.error))
        }
        return
      }
      // Éxito explícito: confirmación + la ruta sirve la pantalla "completado" tras navegar.
      toast.success(t('finalizar.exito'))
      cerrado()
    })
  }

  // El último paso de datos: con la familia lleva a la firma; en papel, finaliza.
  const terminar = conFirma ? goNext : finalizar

  return (
    <Card className="mx-auto max-w-2xl">
      {modoDireccion && (
        <div
          role="note"
          className="border-accent-warm-300 bg-accent-warm-50 text-accent-warm-800 mx-6 mt-6 rounded-xl border p-3 text-sm"
        >
          {t('modo_direccion_aviso')}
        </div>
      )}
      {reutilizacion.hayReutilizacion && (
        // U-3: el tutor ya existe → se le dice de entrada QUÉ se reutiliza de su familia y
        // qué tiene que rellenar por este hijo, para que el wizard no parezca "todo otra vez".
        <div
          role="note"
          className="border-primary-200 bg-primary-50 text-primary-900 mx-6 mt-6 rounded-xl border p-3 text-sm"
        >
          <p className="font-medium">{t('familia_existente.titulo')}</p>
          <p className="mt-1">{t('familia_existente.reutilizado')}</p>
          <p className="mt-1">{t('familia_existente.por_nino', { nombre: ninoNombre })}</p>
        </div>
      )}
      <CardHeader>
        <CardTitle>{t(`wizard.paso.${paso}`)}</CardTitle>
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {t('wizard.step')} {step + 1}/{total}
        </p>
        <div
          className="mt-2 flex gap-1.5"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={total}
          aria-valuenow={step + 1}
          aria-label={t('wizard.progress')}
        >
          {pasos.map((p, i) => (
            <span
              key={p}
              className={
                i <= step
                  ? 'bg-primary h-1.5 flex-1 rounded-full transition-colors'
                  : 'bg-primary-100 h-1.5 flex-1 rounded-full transition-colors'
              }
            />
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {faltan && faltan.length > 0 && (
          <div
            role="alert"
            className="border-destructive/40 bg-destructive/5 mb-4 rounded-lg border p-3 text-sm"
          >
            <p className="text-destructive font-medium">{t('finalizar.incompleto_titulo')}</p>
            <ul className="text-muted-foreground mt-2 list-disc space-y-0.5 pl-5">
              {faltan.map((bloque) => (
                <li key={bloque}>{t(`finalizar.bloques.${bloque}`)}</li>
              ))}
            </ul>
          </div>
        )}

        {paso === 'cuenta' && modoInvitacion && (
          <PasoCuenta
            locale={locale}
            token={modoInvitacion.token}
            email={modoInvitacion.email}
            ninoId={ninoId}
            nombreInicial={modoInvitacion.nombreInicial}
            requiereParentesco={modoInvitacion.requiereParentesco}
          />
        )}

        {paso === 'acuses' && (
          <PasoAcuses
            locale={locale}
            ninoId={ninoId}
            documentosCentro={documentosCentro}
            modoDireccion={modoDireccion}
            onNext={goNext}
            onBack={goBack}
          />
        )}

        {paso === 'menor' && (
          <PasoMenor
            locale={locale}
            ninoId={ninoId}
            ninoNombre={ninoNombre}
            identidadInicial={identidadInicial}
            mostrarComoNosConocio={mostrarComoNosConocio}
            direccionInicial={direccionInicial}
            datosPedagogicosInicial={datosPedagogicosInicial}
            datosPedagogicosLeidos={datosPedagogicosLeidos}
            libroFamiliaUrl={libroFamiliaUrl}
            fotoInicialUrl={fotoInicialUrl}
            imagenPanel={imagenPanel}
            imagenSinPlantilla={imagenSinPlantilla}
            imagenAceptado={imagenAceptado}
            miRespuestaImagen={miRespuestaImagen}
            tutoresImagenPapel={tutoresImagenPapel}
            puedeConsentirImagen={puedeConsentirImagen}
            currentUserId={currentUserId}
            currentUserNombre={currentUserNombre}
            modoDireccion={modoDireccion}
            onDireccionChange={setDireccionNino}
            onNext={goNext}
            onBack={goBack}
          />
        )}

        {paso === 'tutor1' && (
          <PasoTutor
            locale={locale}
            ninoId={ninoId}
            tipoVinculo="tutor_legal_principal"
            inicial={datosTutor1}
            estadoCivilInicial={familiaEstadoCivil}
            mostrarEstadoCivil
            emailReadonly
            opcional={false}
            yaResuelto={reutilizacion.tutor}
            direccionNino={direccionNino}
            onNext={goNext}
            onBack={goBack}
          />
        )}

        {paso === 'tutor2' && (
          <PasoTutor
            locale={locale}
            ninoId={ninoId}
            tipoVinculo="tutor_legal_secundario"
            inicial={datosTutor2}
            estadoCivilInicial={null}
            mostrarEstadoCivil={false}
            emailReadonly={false}
            opcional
            // Tutor 2 solo se da por resuelto si REALMENTE hay uno guardado en la familia;
            // si la familia nunca lo registró, el paso sigue en blanco y sigue siendo opcional.
            yaResuelto={reutilizacion.tutor && datosTutor2 !== null}
            direccionNino={direccionNino}
            onNext={goNext}
            onBack={goBack}
          />
        )}

        {paso === 'medico' && (
          <PasoMedico
            ninoId={ninoId}
            inicial={medicaValores}
            onCambio={mergeMedica}
            variante="general"
            fichaNoLeida={!medicaLeida}
            mostrarConsentimiento
            consintioInicial={consintio}
            onConsentir={() => setConsintio(true)}
            onNext={goNext}
            onBack={goBack}
          />
        )}

        {paso === 'emergencia' && (
          <PasoMedico
            ninoId={ninoId}
            inicial={medicaValores}
            onCambio={mergeMedica}
            variante="emergencia"
            fichaNoLeida={!medicaLeida}
            esUltimo={!conFirma && !conSepa && !conServicios && !conGastos}
            onNext={conSepa || conServicios || conGastos ? goNext : terminar}
            onBack={goBack}
          />
        )}

        {paso === 'servicios' && (
          <PasoServicios
            locale={locale}
            ninoId={ninoId}
            peticion={peticionServicios}
            esUltimo={!conFirma && !conSepa && !conGastos}
            onNext={conSepa || conGastos ? goNext : terminar}
            onBack={goBack}
          />
        )}

        {paso === 'gastos' && (
          <PasoGastos
            locale={locale}
            ninoId={ninoId}
            gastos={gastosGestion}
            esUltimo={!conFirma && !conSepa}
            onNext={conSepa ? goNext : terminar}
            onBack={goBack}
          />
        )}

        {paso === 'sepa' && cidDelAlta && (
          <PasoSepa
            locale={locale}
            ninoId={ninoId}
            centroId={centroId}
            centroNombre={centroNombre}
            centroDireccion={centroDireccion}
            centroCid={cidDelAlta}
            currentUserId={currentUserId}
            inicial={mandatoSepaInicial}
            mandatoFamilia={mandatoFamilia}
            firma={sepaFirma}
            onFirmaChange={setSepaFirma}
            iban={sepaIban}
            onIbanChange={setSepaIban}
            titular={sepaTitular}
            onTitularChange={setSepaTitular}
            titularDocumento={sepaDocumento}
            onTitularDocumentoChange={setSepaDocumento}
            titularDireccion={sepaDireccion}
            onTitularDireccionChange={setSepaDireccion}
            nombreTecleado={sepaNombreTecleado}
            onNombreTecleadoChange={setSepaNombreTecleado}
            modoDireccion={modoDireccion}
            onFinalizar={terminar}
            esUltimo={!conFirma}
            onBack={goBack}
          />
        )}

        {paso === 'firma' && (
          <PasoFirma
            ninoId={ninoId}
            contexto="alta"
            puedeLeerFichaMedica={puedeLeerFichaMedica}
            nombreInicial={currentUserNombre}
            onFaltan={setFaltan}
            onFirmado={cerrado}
            onBack={goBack}
          />
        )}
      </CardContent>
    </Card>
  )
}

/** «Calle número, CP ciudad» del tutor, con lo que tenga; vacía si no tiene nada. */
function direccionDe(t: DatosTutorInicial | null): string {
  if (!t) return ''
  const calle = [t.direccion_calle, t.direccion_numero].filter(Boolean).join(' ')
  const ciudad = [t.direccion_cp, t.direccion_ciudad].filter(Boolean).join(' ')
  return [calle, ciudad].filter(Boolean).join(', ')
}
