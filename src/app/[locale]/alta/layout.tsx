import { SignOutButton } from '@/features/auth/components/SignOutButton'
import { AvisoSuperusuario } from '@/features/centros/components/AvisoSuperusuario'
import { getEstadoCentro } from '@/features/centros/contexto/get-contexto-centro'
import { getCentroLogo } from '@/features/centros/queries/get-centro-logo'
import { CentroLogo } from '@/shared/components/brand/CentroLogo'

interface LayoutProps {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}

/**
 * Layout FOCALIZADO del asistente de alta tutor-driven (P3b-2/P3c). A diferencia
 * de `/family`, NO pinta `SidebarNav`: durante el alta el tutor no debe poder navegar
 * a otras secciones. El wizard vive fuera de `/family` precisamente para no heredar su
 * layout/nav ni entrar en bucle con el gate del panel (`family/layout`). Solo cabecera
 * con logo del centro + cerrar sesión.
 */
export default async function AltaLayout({ children, params }: LayoutProps) {
  const { locale } = await params
  // Solo la cabecera: con centro activo, su logo; si no (sin elegir aún), «NIDO». La página del
  // alta autoriza por el niño, no por esto.
  const estado = await getEstadoCentro()
  const logo = estado.tipo === 'activo' ? await getCentroLogo(estado.contexto.centroId) : null

  return (
    <div className="bg-background flex min-h-[100dvh] flex-col">
      <header className="flex items-center justify-between border-b px-4 py-3 md:px-8">
        {logo ? (
          <CentroLogo url={logo.logoUrl} name={logo.nombre} width={120} height={32} />
        ) : (
          <span className="text-foreground text-sm font-semibold">NIDO</span>
        )}
        <SignOutButton locale={locale} />
      </header>
      {estado.tipo === 'activo' && <AvisoSuperusuario contexto={estado.contexto} locale={locale} />}
      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-2xl px-4 py-6 md:px-8 md:py-8">{children}</div>
      </main>
    </div>
  )
}
