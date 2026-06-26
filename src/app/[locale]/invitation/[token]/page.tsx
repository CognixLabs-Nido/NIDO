import { useTranslations } from 'next-intl'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AltaTutorWizard } from '@/features/alta/components/AltaTutorWizard'
import { AcceptInvitationForm } from '@/features/auth/components/AcceptInvitationForm'
import { notifyExistingAccountInvitation } from '@/features/auth/actions/accept-invitation'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { debeMostrarB8 } from '@/features/auth/lib/clasificar-cuenta'
import { createClient } from '@/lib/supabase/server'
import { AuthShell } from '@/shared/components/AuthShell'

interface PageProps {
  params: Promise<{ locale: string; token: string }>
}

export default async function InvitationPage({ params }: PageProps) {
  const { locale, token } = await params

  // Validar formato UUID antes de pegar DB.
  if (!/^[0-9a-f-]{36}$/i.test(token)) {
    redirect(`/${locale}/invitation/expired`)
  }

  const service = createServiceRoleClient()
  const { data: invitation } = await service
    .from('invitaciones')
    .select('email, rol_objetivo, nombre_completo, nino_id, expires_at, accepted_at, rejected_at')
    .eq('token', token)
    .maybeSingle()

  if (!invitation) redirect(`/${locale}/invitation/expired`)

  const caducada = new Date(invitation.expires_at) < new Date()
  const yaUsada = Boolean(invitation.accepted_at || invitation.rejected_at)

  if (yaUsada || caducada) {
    // Defensivo (C): si el enlace YA se usó (aceptado, no caducado) y quien lo re-pulsa es
    // el PROPIO invitado con sesión válida (email de sesión == email de la invitación),
    // mándalo a su panel en vez de a "enlace inválido" —que confunde al usuario legítimo
    // que vuelve a clicar el correo—. Cualquier otro caso (caducado, rechazado, sin sesión
    // o sesión de otra cuenta) sigue yendo a /expired.
    if (invitation.accepted_at && !caducada) {
      const userClient = await createClient()
      const {
        data: { user },
      } = await userClient.auth.getUser()
      if (user?.email && user.email.toLowerCase() === invitation.email.toLowerCase()) {
        redirect(dashboardPorRol(locale, invitation.rol_objetivo))
      }
    }
    redirect(`/${locale}/invitation/expired`)
  }

  // ¿Email ya en auth.users? Hay que distinguir una cuenta REAL (con roles) de un
  // STUB de `inviteUserByEmail` (fila pre-creada al enviar el correo, aún sin roles):
  // el stub debe ver el FORMULARIO de alta; solo la cuenta real va a B8. Sin esto, el
  // alta tutor-driven (y cualquier invitación) caía SIEMPRE en B8 → onboarding roto.
  // La decisión es por roles, NO por sesión: la posible sesión-de-verify de GoTrue es
  // irrelevante (la page la ignora), así que stub→form funciona con o sin ella.
  const { data: usersList } = await service.auth.admin.listUsers()
  const authUser = usersList?.users.find(
    (u) => u.email?.toLowerCase() === invitation.email.toLowerCase()
  )

  let tieneRoles = false
  if (authUser) {
    const { data: roles } = await service
      .from('roles_usuario')
      .select('usuario_id')
      .eq('usuario_id', authUser.id)
      .is('deleted_at', null)
      .limit(1)
    tieneRoles = (roles?.length ?? 0) > 0
  }

  if (debeMostrarB8(Boolean(authUser), tieneRoles)) {
    // Cuenta real existente: dispara aviso (best-effort) y render flujo B8.
    await notifyExistingAccountInvitation(token).catch(() => {})
    return <ExistingAccountNotice locale={locale} email={invitation.email} />
  }

  const requiereParentesco =
    invitation.rol_objetivo === 'tutor_legal' || invitation.rol_objetivo === 'autorizado'

  // Alta con documentos (F11-G): el tutor legal con niño entra al wizard de 8 pasos en su
  // paso `cuenta` (pre-login). Al crear la cuenta, el MISMO wizard reanuda en `/alta`. El
  // resto de invitaciones (autorizado, profe, admin) siguen el alta de cuenta clásica.
  if (invitation.rol_objetivo === 'tutor_legal' && invitation.nino_id) {
    return (
      <AltaInvitacionFlow
        locale={locale}
        token={token}
        email={invitation.email}
        ninoId={invitation.nino_id}
        nombreInicial={invitation.nombre_completo ?? ''}
      />
    )
  }

  return (
    <NewAccountFlow
      locale={locale}
      token={token}
      email={invitation.email}
      nombreInicial={invitation.nombre_completo ?? ''}
      requiereParentesco={requiereParentesco}
    />
  )
}

/**
 * Entrada al wizard de alta (F11-G) por el paso `cuenta`. Pre-login: solo se renderiza ese
 * paso (los preloads autenticados van vacíos; el wizard no los usa en modo invitación). Al
 * crear la cuenta, `PasoCuenta` navega a `/alta/[ninoId]`, donde el MISMO wizard reanuda.
 */
function AltaInvitacionFlow({
  locale,
  token,
  email,
  ninoId,
  nombreInicial,
}: {
  locale: string
  token: string
  email: string
  ninoId: string
  nombreInicial: string
}) {
  return (
    <AuthShell locale={locale}>
      <AltaTutorWizard
        locale={locale}
        ninoId={ninoId}
        ninoNombre=""
        pasoInicial={0}
        modoInvitacion={{ token, email, nombreInicial, requiereParentesco: true }}
        identidadInicial={{
          apellidos: null,
          fecha_nacimiento: null,
          sexo: null,
          nacionalidad: null,
          idioma_principal: locale,
        }}
        direccionInicial={{
          direccion_calle: null,
          direccion_numero: null,
          direccion_cp: null,
          direccion_ciudad: null,
        }}
        datosPedagogicosInicial={null}
        libroFamiliaUrl={null}
        consintioDatosMedicos={false}
        medicaInicial={null}
        fotoInicialUrl={null}
        imagenPanel={null}
        imagenSinPlantilla={false}
        normasPanel={null}
        normasSinPlantilla={false}
        familiaEstadoCivil={null}
        datosTutor1={null}
        datosTutor2={null}
        centroId=""
        centroNombre=""
        centroDireccion=""
        mandatoSepaInicial={null}
        currentUserId=""
        currentUserNombre=""
      />
    </AuthShell>
  )
}

function NewAccountFlow({
  locale,
  token,
  email,
  nombreInicial,
  requiereParentesco,
}: {
  locale: string
  token: string
  email: string
  nombreInicial: string
  requiereParentesco: boolean
}) {
  const t = useTranslations('auth.invitation')
  return (
    <AuthShell locale={locale}>
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('subtitle_new')}</CardDescription>
        </CardHeader>
        <CardContent>
          <AcceptInvitationForm
            locale={locale}
            token={token}
            email={email}
            nombreInicial={nombreInicial}
            requiereParentesco={requiereParentesco}
          />
        </CardContent>
      </Card>
    </AuthShell>
  )
}

function ExistingAccountNotice({ locale, email }: { locale: string; email: string }) {
  const t = useTranslations('auth.invitation')
  const obfuscated = obfuscateEmail(email)
  return (
    <AuthShell locale={locale}>
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('subtitle_existing')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-muted-foreground text-sm">
            {t('existing_email_notice', { email: obfuscated })}
          </p>
          <Link
            href={`/${locale}/login?returnTo=/${locale}/profile/invitations`}
            className={buttonVariants({ className: 'h-11 w-full text-base' })}
          >
            {t('go_to_login')}
          </Link>
          <p className="text-center text-sm">
            <Link
              href={`/${locale}/forgot-password`}
              className="text-primary hover:text-primary-800 font-medium hover:underline"
            >
              {t('forgot_password_hint')}
            </Link>
          </p>
        </CardContent>
      </Card>
    </AuthShell>
  )
}

/** Panel inicial según el rol objetivo de la invitación (espejo de la action). */
function dashboardPorRol(locale: string, rolObjetivo: string): string {
  if (rolObjetivo === 'admin') return `/${locale}/admin`
  if (rolObjetivo === 'profe') return `/${locale}/teacher`
  return `/${locale}/family`
}

function obfuscateEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain || !local) return email
  const visible = local.slice(0, 2)
  return `${visible}${'*'.repeat(Math.max(local.length - 2, 1))}@${domain}`
}
