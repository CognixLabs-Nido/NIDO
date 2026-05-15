import { LockIcon } from 'lucide-react'
import { getTranslations } from 'next-intl/server'

import { Card } from '@/components/ui/card'
import { EmptyState } from '@/shared/components/EmptyState'

/**
 * Empty state mostrado a un tutor cuyo vínculo no tiene
 * `permisos.puede_ver_agenda = true`. Server Component: no necesita
 * interactividad.
 */
export async function AgendaFamiliaSinPermiso() {
  const t = await getTranslations('family.nino.agenda.sin_permiso')
  return (
    <Card>
      <EmptyState
        icon={<LockIcon strokeWidth={1.75} />}
        title={t('title')}
        description={t('description')}
      />
    </Card>
  )
}
