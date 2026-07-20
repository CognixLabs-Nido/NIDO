'use client'

import { useCallback, useState, useTransition } from 'react'

import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

import { finalizarAlta, type BloqueAlta } from '../actions/finalizar-alta'
import { PASOS_ALTA, PASO_MIN_AUTENTICADO, type PasoAlta } from '../lib/estado-alta'
import { PasoAcuses } from './PasoAcuses'
import { PasoCuenta } from './PasoCuenta'
import { PasoMedico } from './PasoMedico'
import { PasoMenor, type DireccionInicial } from './PasoMenor'
import { PasoSepa, type MandatoSepaInicial } from './PasoSepa'
import { PasoTutor, type DatosTutorInicial } from './PasoTutor'
import type { IdentidadInicial } from './PasoIdentidad'
import type { MandatoFamiliaActivo } from '../queries/get-mandato-familia'

import type { DatosPedagogicosInput } from '@/features/datos-pedagogicos/schemas/datos-pedagogicos'
import type { EstadoCivil } from '../schemas/alta-documentos'
import type { FirmaPanelData, ImagenPanelData, MedicaInicial } from '../lib/tipos'

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
  direccionInicial: DireccionInicial
  datosPedagogicosInicial: DatosPedagogicosInput | null
  libroFamiliaUrl: string | null
  consintioDatosMedicos: boolean
  medicaInicial: MedicaInicial | null
  fotoInicialUrl: string | null
  imagenPanel: ImagenPanelData | null
  imagenSinPlantilla: boolean
  normasPanel: FirmaPanelData | null
  normasSinPlantilla: boolean
  /** ¿Ya hay fila en `acuses_alta` para este niño? (acuse por checkbox de normas/imagen, vía B). */
  normasAceptado: boolean
  imagenAceptado: boolean
  familiaEstadoCivil: EstadoCivil | null
  datosTutor1: DatosTutorInicial | null
  datosTutor2: DatosTutorInicial | null
  /** Datos del centro (acreedor) y mandato SEPA previo para el paso 8 (G-2). */
  centroId: string
  centroNombre: string
  centroDireccion: string
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
  direccionInicial,
  datosPedagogicosInicial,
  libroFamiliaUrl,
  consintioDatosMedicos,
  medicaInicial,
  fotoInicialUrl,
  imagenPanel,
  imagenSinPlantilla,
  normasPanel,
  normasSinPlantilla,
  normasAceptado,
  imagenAceptado,
  familiaEstadoCivil,
  datosTutor1,
  datosTutor2,
  centroId,
  centroNombre,
  centroDireccion,
  mandatoSepaInicial,
  mandatoFamilia,
  currentUserId,
  currentUserNombre,
  modoDireccion = false,
}: Props) {
  const t = useTranslations('alta')
  const tErrors = useTranslations()
  const router = useRouter()
  const searchParams = useSearchParams()
  const total = PASOS_ALTA.length
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

  const paso: PasoAlta = PASOS_ALTA[step]
  const goNext = () => setStep((s) => Math.min(s + 1, total - 1))
  const goBack = () => setStep((s) => Math.max(s - 1, pasoMin))

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
      setFaltan(null)
      toast.success(t('finalizar.exito'))
      if (searchParams.get('editar')) {
        router.replace(`/${locale}/alta/${ninoId}`)
      } else {
        router.refresh()
      }
    })
  }

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
          {PASOS_ALTA.map((p, i) => (
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
            normasPanel={normasPanel}
            normasSinPlantilla={normasSinPlantilla}
            normasAceptado={normasAceptado}
            currentUserId={currentUserId}
            currentUserNombre={currentUserNombre}
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
            direccionInicial={direccionInicial}
            datosPedagogicosInicial={datosPedagogicosInicial}
            libroFamiliaUrl={libroFamiliaUrl}
            fotoInicialUrl={fotoInicialUrl}
            imagenPanel={imagenPanel}
            imagenSinPlantilla={imagenSinPlantilla}
            imagenAceptado={imagenAceptado}
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
            onNext={goNext}
            onBack={goBack}
          />
        )}

        {paso === 'sepa' && (
          <PasoSepa
            locale={locale}
            ninoId={ninoId}
            centroId={centroId}
            centroNombre={centroNombre}
            centroDireccion={centroDireccion}
            currentUserId={currentUserId}
            inicial={mandatoSepaInicial}
            mandatoFamilia={mandatoFamilia}
            firma={sepaFirma}
            onFirmaChange={setSepaFirma}
            iban={sepaIban}
            onIbanChange={setSepaIban}
            titular={sepaTitular}
            onTitularChange={setSepaTitular}
            nombreTecleado={sepaNombreTecleado}
            onNombreTecleadoChange={setSepaNombreTecleado}
            modoDireccion={modoDireccion}
            onFinalizar={finalizar}
            onBack={goBack}
          />
        )}
      </CardContent>
    </Card>
  )
}
